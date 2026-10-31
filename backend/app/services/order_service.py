from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.core.order_status import OrderStatus, transition_order_status
from app.schemas.payment_method import PaymentMethodResponse
from app.schemas.order import OrderHistoryItemResponse, OrderHistoryResponse, OrderItemResponse, OrderResponse, PlaceOrderRequest
from app.services.checkout_service import quote_checkout_items
from app.services.payment_method_service import get_active_payment_method
from app.services.fulfillment_service import validate_fulfillment


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
    db.commit()
    db.refresh(order)
    return _serialize_order(order)


def list_customer_orders(db: Session, customer: Customer, page: int, page_size: int) -> OrderHistoryResponse:
    total = db.scalar(select(func.count(Order.id)).where(Order.customer_id == customer.customer_id)) or 0
    rows = db.execute(
        select(Order, func.count(OrderItem.id).label("item_count"))
        .options(selectinload(Order.restaurant_table))
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

    quote_lines = quote_checkout_items(db, order_request.items)
    payment_method = get_active_payment_method(db, order_request.payment_method_code)
    if payment_method is None:
        raise ValueError("The selected payment method is unavailable. Please choose another method.")
    restaurant_table = validate_fulfillment(db, order_request.order_type, order_request.fulfillment_type, order_request.restaurant_table_id)
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
    return _serialize_order(created), True
