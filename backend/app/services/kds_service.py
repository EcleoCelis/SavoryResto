from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.order_status import OrderStatus, transition_order_status
from app.db.models.customer import Customer
from app.db.models.order import Order
from app.db.models.staff import StaffUser
from app.schemas.kds import (
    KdsOrderItemResponse,
    KdsOrderResponse,
    ManagerOrderDetailResponse,
    ManagerOrderItemDetailResponse,
    ManagerOrderListResponse,
    ManagerOrderStatusCounts,
    ManagerOrderSummaryResponse,
)
from app.services.inventory_service import (
    deduct_inventory_for_confirmed_order,
    restore_inventory_for_cancelled_order,
)


MANILA_TZ = ZoneInfo("Asia/Manila")
KDS_STATUSES = (OrderStatus.PENDING.value, OrderStatus.CONFIRMED.value, OrderStatus.PREPARING.value, OrderStatus.READY.value)
KITCHEN_TARGET_STATUSES = frozenset({OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY})
MANAGER_TARGET_STATUSES = frozenset({OrderStatus.COMPLETED, OrderStatus.CANCELLED})


def _resolve_fulfillment_destination(order: Order) -> str:
    if order.fulfillment_type == "table_service" and order.restaurant_table is not None:
        return order.restaurant_table.table_number
    return "Counter pickup"


def _quantize_money(amount: Decimal | None) -> Decimal:
    return Decimal(str(amount if amount is not None else "0.00")).quantize(Decimal("0.01"))


def serialize_kds_order(order: Order) -> KdsOrderResponse:
    return KdsOrderResponse(
        id=order.id,
        order_number=order.order_number,
        status=OrderStatus(order.status),
        order_type=order.order_type,
        fulfillment_type=order.fulfillment_type,
        fulfillment_destination=_resolve_fulfillment_destination(order),
        ordered_at=order.ordered_at,
        allergy_alert=order.kitchen_allergy_alert,
        notes=order.notes,
        items=[KdsOrderItemResponse(name=item.product_name or "Menu item", quantity=item.quantity, size=item.size_code, addons=item.selected_addons or []) for item in order.items],
    )


def _serialize_manager_order_summary(order: Order) -> ManagerOrderSummaryResponse:
    item_count = sum(item.quantity for item in order.items)
    customer_name = order.customer.full_name if order.customer is not None else f"Customer #{order.customer_id}"
    return ManagerOrderSummaryResponse(
        id=order.id,
        order_number=order.order_number,
        status=OrderStatus(order.status),
        order_type=order.order_type,
        fulfillment_type=order.fulfillment_type,
        fulfillment_destination=_resolve_fulfillment_destination(order),
        customer_id=order.customer_id,
        customer_name=customer_name,
        customer_email=order.customer.email if order.customer is not None else None,
        payment_method_label=order.payment_method.label if order.payment_method is not None else None,
        item_count=item_count,
        total_amount=_quantize_money(order.total_amount),
        ordered_at=order.ordered_at,
        completed_at=order.completed_at,
        cancelled_at=order.cancelled_at,
        allergy_alert=order.kitchen_allergy_alert,
    )


def _serialize_manager_order_detail(order: Order) -> ManagerOrderDetailResponse:
    current_status = OrderStatus(order.status)
    return ManagerOrderDetailResponse(
        id=order.id,
        order_number=order.order_number,
        status=current_status,
        order_type=order.order_type,
        fulfillment_type=order.fulfillment_type,
        fulfillment_destination=_resolve_fulfillment_destination(order),
        table_number=order.restaurant_table.table_number if order.restaurant_table is not None else None,
        customer_id=order.customer_id,
        customer_name=order.customer.full_name if order.customer is not None else f"Customer #{order.customer_id}",
        customer_email=order.customer.email if order.customer is not None else None,
        customer_phone=order.customer.phone if order.customer is not None else None,
        payment_method_code=order.payment_method.code if order.payment_method is not None else None,
        payment_method_label=order.payment_method.label if order.payment_method is not None else None,
        delivery_address_snapshot=order.delivery_address_snapshot,
        subtotal=_quantize_money(order.subtotal),
        discount_amount=_quantize_money(order.discount_amount),
        tax_amount=_quantize_money(order.tax_amount),
        total_amount=_quantize_money(order.total_amount),
        allergy_alert=order.kitchen_allergy_alert,
        notes=order.notes,
        cancellation_reason=order.cancellation_reason,
        ordered_at=order.ordered_at,
        completed_at=order.completed_at,
        cancelled_at=order.cancelled_at,
        updated_at=order.updated_at,
        can_complete=current_status is OrderStatus.READY,
        can_cancel=current_status in {OrderStatus.PENDING, OrderStatus.CONFIRMED},
        items=[
            ManagerOrderItemDetailResponse(
                id=item.id,
                menu_item_id=item.menu_item_id,
                name=item.product_name or "Menu item",
                quantity=item.quantity,
                size=item.size_code,
                addons=item.selected_addons or [],
                unit_price=_quantize_money(item.unit_price),
                discount_amount=_quantize_money(item.discount_amount),
                line_total=_quantize_money(item.line_total),
                status=item.status,
                special_instructions=item.special_instructions,
            )
            for item in order.items
        ],
    )


def list_kds_orders(db: Session, status_filter: OrderStatus | None = None) -> list[KdsOrderResponse]:
    statuses = (status_filter.value,) if status_filter is not None else KDS_STATUSES
    orders = db.scalars(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.restaurant_table))
        .where(Order.status.in_(statuses))
        .order_by(Order.ordered_at)
    ).all()
    return [serialize_kds_order(order) for order in orders]


def list_manager_orders_directory(
    db: Session,
    *,
    search: str | None = None,
    status_filter: Literal["all", "active", "pending", "confirmed", "preparing", "ready", "completed", "cancelled"] = "all",
    fulfillment_type: Literal["all", "table_service", "counter_pickup"] = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 15,
) -> ManagerOrderListResponse:
    """List paginated restaurant orders for Manager oversight with operational filters."""
    base_filters = []
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        base_filters.append(
            or_(
                Order.order_number.ilike(pattern),
                Customer.full_name.ilike(pattern),
                Customer.email.ilike(pattern),
            )
        )
    if fulfillment_type != "all":
        base_filters.append(Order.fulfillment_type == fulfillment_type)
    if date_from is not None:
        start_utc = datetime.combine(date_from, time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
        base_filters.append(Order.ordered_at >= start_utc)
    if date_to is not None:
        end_exclusive_utc = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
        base_filters.append(Order.ordered_at < end_exclusive_utc)

    count_rows = db.execute(
        select(Order.status, func.count(Order.id))
        .outerjoin(Customer, Customer.customer_id == Order.customer_id)
        .where(*base_filters)
        .group_by(Order.status)
    ).all()
    counts_by_status = {status_val: int(cnt) for status_val, cnt in count_rows}
    status_counts = ManagerOrderStatusCounts(
        all=sum(counts_by_status.values()),
        active=sum(counts_by_status.get(s, 0) for s in KDS_STATUSES),
        pending=counts_by_status.get(OrderStatus.PENDING.value, 0),
        confirmed=counts_by_status.get(OrderStatus.CONFIRMED.value, 0),
        preparing=counts_by_status.get(OrderStatus.PREPARING.value, 0),
        ready=counts_by_status.get(OrderStatus.READY.value, 0),
        completed=counts_by_status.get(OrderStatus.COMPLETED.value, 0),
        cancelled=counts_by_status.get(OrderStatus.CANCELLED.value, 0),
    )

    filters = list(base_filters)
    if status_filter == "active":
        filters.append(Order.status.in_(KDS_STATUSES))
    elif status_filter != "all":
        filters.append(Order.status == status_filter)

    total = db.scalar(
        select(func.count(Order.id))
        .outerjoin(Customer, Customer.customer_id == Order.customer_id)
        .where(*filters)
    ) or 0

    orders = list(
        db.scalars(
            select(Order)
            .outerjoin(Customer, Customer.customer_id == Order.customer_id)
            .options(
                selectinload(Order.items),
                selectinload(Order.restaurant_table),
                selectinload(Order.customer),
                selectinload(Order.payment_method),
            )
            .where(*filters)
            .order_by(Order.ordered_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )

    return ManagerOrderListResponse(
        items=[_serialize_manager_order_summary(order) for order in orders],
        status_counts=status_counts,
        page=page,
        page_size=page_size,
        total=int(total),
    )


def get_manager_order_detail(db: Session, order_id: int) -> ManagerOrderDetailResponse | None:
    order = db.scalar(
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.restaurant_table),
            selectinload(Order.customer),
            selectinload(Order.payment_method),
        )
        .where(Order.id == order_id)
    )
    if order is None:
        return None
    return _serialize_manager_order_detail(order)


def update_kds_order_status(db: Session, staff_user: StaffUser, order_id: int, target_status: OrderStatus) -> KdsOrderResponse | None:
    if staff_user.role.name != "kitchen_staff" or target_status not in KITCHEN_TARGET_STATUSES:
        raise PermissionError("Kitchen staff can only update kitchen preparation statuses.")
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.restaurant_table))
        .where(Order.id == order_id)
        .with_for_update()
    )
    if order is None:
        return None
    transition_order_status(order, target_status)
    if target_status is OrderStatus.CONFIRMED:
        deduct_inventory_for_confirmed_order(db, order, staff_user)
    db.commit()
    db.refresh(order)
    return serialize_kds_order(order)


def update_manager_order_status(
    db: Session,
    staff_user: StaffUser,
    order_id: int,
    target_status: OrderStatus,
    cancellation_reason: str | None = None,
) -> KdsOrderResponse | None:
    if staff_user.role.name != "manager":
        raise PermissionError("Only authorized managers may manage order fulfillment completion.")
    if target_status not in MANAGER_TARGET_STATUSES:
        raise PermissionError("Kitchen preparation statuses can only be updated by Kitchen Display System staff.")

    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.restaurant_table))
        .where(Order.id == order_id)
        .with_for_update()
    )
    if order is None:
        return None

    transition_order_status(order, target_status)
    if target_status is OrderStatus.CANCELLED:
        order.cancelled_at = order.updated_at
        if cancellation_reason and cancellation_reason.strip():
            order.cancellation_reason = cancellation_reason.strip()
        for item in order.items:
            item.status = OrderStatus.CANCELLED.value
            item.updated_at = order.updated_at
        restore_inventory_for_cancelled_order(db, order)

    db.commit()
    db.refresh(order)
    return serialize_kds_order(order)
