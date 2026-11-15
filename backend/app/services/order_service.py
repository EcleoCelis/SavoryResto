from datetime import datetime, timezone
from decimal import Decimal
import logging
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.order_status import OrderStatus, transition_order_status
from app.db.models.address import CustomerAddress
from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.schemas.order import (
    OrderHistoryItemResponse,
    OrderHistoryResponse,
    OrderItemResponse,
    OrderResponse,
    PlaceOrderRequest,
    ReorderAvailableItemResponse,
    ReorderPreviewResponse,
    ReorderUnavailableItemResponse,
)
from app.schemas.payment_method import PaymentMethodResponse
from app.services.checkout_service import quote_checkout_items
from app.services.customer_service import format_operational_allergy_alert
from app.services.email_service import email_service
from app.services.fulfillment_service import validate_fulfillment
from app.services.inventory_service import restore_inventory_for_cancelled_order
from app.services.payment_method_service import get_active_payment_method

logger = logging.getLogger("savorybites.orders")


def _serialize_order(order: Order) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        order_number=order.order_number,
        status=OrderStatus(order.status),
        order_type=order.order_type,
        fulfillment_type=order.fulfillment_type,
        table_number=order.restaurant_table.table_number if order.restaurant_table else None,
        customer_id=order.customer_id,
        subtotal=order.subtotal,
        total=order.total_amount,
        payment_method=PaymentMethodResponse.model_validate(order.payment_method) if order.payment_method else None,
        delivery_address_snapshot=order.delivery_address_snapshot,
        kitchen_allergy_alert=order.kitchen_allergy_alert,
        notes=order.notes,
        ordered_at=order.ordered_at,
        completed_at=order.completed_at,
        cancelled_at=order.cancelled_at,
        cancellation_reason=order.cancellation_reason,
        is_cancellable=OrderStatus(order.status) in {OrderStatus.PENDING, OrderStatus.CONFIRMED},
        items=[
            OrderItemResponse(
                product_id=item.menu_item_id,
                name=item.product_name or "Menu item",
                size=item.size_code,
                addons=item.selected_addons or [],
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.line_total,
            )
            for item in order.items
        ],
    )


def _load_customer_order(db: Session, customer_id: int, order_id: int) -> Order | None:
    return db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.payment_method), selectinload(Order.restaurant_table))
        .where(Order.id == order_id, Order.customer_id == customer_id)
    )


def get_customer_order(db: Session, customer: Customer, order_id: int) -> OrderResponse | None:
    order = _load_customer_order(db, customer.customer_id, order_id)
    return _serialize_order(order) if order is not None else None


def cancel_customer_order(db: Session, customer: Customer, order_id: int, reason: str | None) -> OrderResponse | None:
    """Cancel an eligible order while preserving it and its cancellation audit data."""
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.payment_method), selectinload(Order.restaurant_table))
        .where(Order.id == order_id, Order.customer_id == customer.customer_id)
        .with_for_update()
    )
    if order is None:
        return None

    try:
        transition_order_status(order, OrderStatus.CANCELLED)
    except ValueError as error:
        raise ValueError("This order can no longer be cancelled.") from error

    order.cancelled_at = order.updated_at
    order.cancelled_by_customer_id = customer.customer_id
    order.cancellation_reason = reason
    for item in order.items:
        item.status = OrderStatus.CANCELLED.value
        item.updated_at = order.updated_at
    restore_inventory_for_cancelled_order(db, order)
    db.commit()
    db.refresh(order)
    return _serialize_order(order)


def list_customer_orders(db: Session, customer: Customer, page: int, page_size: int) -> OrderHistoryResponse:
    total = db.scalar(select(func.count(Order.id)).where(Order.customer_id == customer.customer_id)) or 0
    rows = db.execute(
        select(Order, func.count(OrderItem.id).label("item_count"))
        .options(selectinload(Order.restaurant_table), selectinload(Order.payment_method))
        .outerjoin(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.customer_id == customer.customer_id)
        .group_by(Order.id)
        .order_by(Order.ordered_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return OrderHistoryResponse(
        items=[
            OrderHistoryItemResponse(
                id=order.id,
                order_number=order.order_number,
                status=OrderStatus(order.status),
                order_type=order.order_type,
                fulfillment_type=order.fulfillment_type,
                table_number=order.restaurant_table.table_number if order.restaurant_table else None,
                payment_method_label=order.payment_method.label if order.payment_method else None,
                total=order.total_amount,
                ordered_at=order.ordered_at,
                item_count=item_count,
            )
            for order, item_count in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


def preview_reorder(db: Session, customer: Customer, order_id: int) -> ReorderPreviewResponse | None:
    """Revalidate a historical order against current menu availability, options, and pricing."""
    order = _load_customer_order(db, customer.customer_id, order_id)
    if order is None:
        return None

    available_items: list[ReorderAvailableItemResponse] = []
    unavailable_items: list[ReorderUnavailableItemResponse] = []
    has_price_changes = False

    product_ids = {item.menu_item_id for item in order.items}
    products_by_id: dict[int, MenuProduct] = {}
    if product_ids:
        products_by_id = {
            prod.id: prod
            for prod in db.scalars(
                select(MenuProduct)
                .join(MenuProduct.category)
                .options(
                    joinedload(MenuProduct.category),
                    selectinload(MenuProduct.sizes.and_(MenuItemSize.is_active.is_(True))),
                    selectinload(MenuProduct.addons.and_(MenuItemAddon.is_active.is_(True))),
                )
                .where(MenuProduct.id.in_(product_ids))
            ).unique()
        }

    for item in order.items:
        prod = products_by_id.get(item.menu_item_id)
        label_name = item.product_name or (prod.name if prod else f"Dish #{item.menu_item_id}")

        if prod is None or prod.deleted_at is not None or not prod.category.is_active:
            unavailable_items.append(
                ReorderUnavailableItemResponse(
                    product_id=item.menu_item_id,
                    name=label_name,
                    reason="This dish is no longer on the menu.",
                )
            )
            continue

        if not prod.is_available:
            unavailable_items.append(
                ReorderUnavailableItemResponse(
                    product_id=prod.id,
                    name=prod.name,
                    reason="Currently sold out / unavailable.",
                )
            )
            continue

        active_sizes = {size.code: size for size in prod.sizes}
        chosen_size_code = item.size_code or ""
        if chosen_size_code not in active_sizes:
            if not active_sizes:
                unavailable_items.append(
                    ReorderUnavailableItemResponse(
                        product_id=prod.id,
                        name=prod.name,
                        reason="No active sizes are configured for this dish.",
                    )
                )
                continue
            unavailable_items.append(
                ReorderUnavailableItemResponse(
                    product_id=prod.id,
                    name=prod.name,
                    reason=f"Previously selected size '{chosen_size_code}' is no longer available.",
                )
            )
            continue

        active_addons = {addon.code: addon for addon in prod.addons}
        requested_addons = item.selected_addons or []
        missing_addons = [code for code in requested_addons if code not in active_addons]
        if missing_addons:
            unavailable_items.append(
                ReorderUnavailableItemResponse(
                    product_id=prod.id,
                    name=prod.name,
                    reason=f"Add-on(s) no longer available: {', '.join(missing_addons)}.",
                )
            )
            continue

        size_adj = Decimal(active_sizes[chosen_size_code].price_adjustment)
        addons_adj = sum((Decimal(active_addons[code].price_adjustment) for code in requested_addons), Decimal("0"))
        current_unit_price = Decimal(prod.price) + size_adj + addons_adj
        previous_unit_price = Decimal(item.unit_price)
        price_changed = current_unit_price != previous_unit_price
        if price_changed:
            has_price_changes = True

        available_items.append(
            ReorderAvailableItemResponse(
                product_id=prod.id,
                name=prod.name,
                image_url=prod.image_url,
                size=chosen_size_code,
                addons=requested_addons,
                quantity=item.quantity,
                current_unit_price=current_unit_price,
                previous_unit_price=previous_unit_price,
                price_changed=price_changed,
            )
        )

    return ReorderPreviewResponse(
        order_id=order.id,
        order_number=order.order_number,
        available_items=available_items,
        unavailable_items=unavailable_items,
        has_price_changes=has_price_changes,
    )


def place_order(
    db: Session,
    customer: Customer,
    order_request: PlaceOrderRequest,
    idempotency_key: str,
) -> tuple[OrderResponse, bool]:
    existing = db.scalar(
        select(Order.id).where(
            Order.customer_id == customer.customer_id,
            Order.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        order = _load_customer_order(db, customer.customer_id, existing)
        return _serialize_order(order), False

    address_snapshot: dict | None = None
    if order_request.selected_address_id is not None:
        saved_addr = db.scalar(
            select(CustomerAddress).where(
                CustomerAddress.id == order_request.selected_address_id,
                CustomerAddress.customer_id == customer.customer_id,
            )
        )
        if saved_addr is None:
            raise ValueError("Selected saved address was not found.")
        address_snapshot = {
            "label": saved_addr.label,
            "recipient_name": saved_addr.recipient_name,
            "phone": saved_addr.phone,
            "street_address": saved_addr.street_address,
            "barangay": saved_addr.barangay,
            "city": saved_addr.city,
            "state_province": saved_addr.state_province,
            "postal_code": saved_addr.postal_code,
            "delivery_instructions": saved_addr.delivery_instructions,
        }

    kitchen_allergy_alert = (
        format_operational_allergy_alert(customer)
        if order_request.include_allergy_alert
        else None
    )

    quote_lines = quote_checkout_items(db, order_request.items)
    payment_method = get_active_payment_method(db, order_request.payment_method_code)
    if payment_method is None:
        raise ValueError("The selected payment method is unavailable. Please choose another method.")
    restaurant_table = validate_fulfillment(
        db, order_request.order_type, order_request.fulfillment_type, order_request.restaurant_table_id
    )
    subtotal = sum((line.subtotal for line in quote_lines), Decimal("0"))
    now = datetime.now(timezone.utc)
    quoted_by_line = {line.cart_line_id: line for line in quote_lines}

    try:
        order = Order(
            order_number=f"TMP-{uuid4().hex[:20]}",
            customer_id=customer.customer_id,
            created_by=None,
            order_type=order_request.order_type,
            fulfillment_type=order_request.fulfillment_type,
            restaurant_table_id=restaurant_table.id if restaurant_table else None,
            status=OrderStatus.PENDING.value,
            subtotal=subtotal,
            discount_amount=Decimal("0"),
            tax_amount=Decimal("0"),
            total_amount=subtotal,
            idempotency_key=idempotency_key,
            payment_method_id=payment_method.id,
            delivery_address_snapshot=address_snapshot,
            kitchen_allergy_alert=kitchen_allergy_alert,
            notes=order_request.preparation_notes,
            ordered_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(order)
        db.flush()
        order.order_number = f"SB-{now:%Y%m%d}-{order.id:06d}"

        for requested_item in order_request.items:
            quote_line = quoted_by_line[requested_item.cart_line_id]
            db.add(OrderItem(
                order_id=order.id,
                menu_item_id=quote_line.product_id,
                product_name=quote_line.name,
                size_code=requested_item.size,
                selected_addons=requested_item.addons,
                quantity=quote_line.quantity,
                unit_price=quote_line.unit_price,
                discount_amount=Decimal("0"),
                line_total=quote_line.subtotal,
                status=OrderStatus.PENDING.value,
                created_at=now,
                updated_at=now,
            ))
        db.commit()
    except Exception:
        db.rollback()
        raise

    created = _load_customer_order(db, customer.customer_id, order.id)
    if customer.email and getattr(customer, "email_order_updates", True):
        try:
            fulfillment_summary = (
                f"Dine-In ({restaurant_table.table_number})"
                if restaurant_table
                else "Take Out · Counter Pickup"
            )
            email_service.send_order_confirmation_email(
                to_email=customer.email,
                customer_name=customer.full_name,
                order_number=created.order_number,
                total_formatted=f"PHP {created.total_amount:,.2f}",
                fulfillment_summary=fulfillment_summary,
            )
        except Exception as exc:
            logger.warning("Order confirmation email dispatch failed for %s: %s", created.order_number, exc)

    return _serialize_order(created), True
