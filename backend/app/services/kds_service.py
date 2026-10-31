from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.order_status import OrderStatus, transition_order_status
from app.db.models.order import Order
from app.db.models.staff import StaffUser
from app.schemas.kds import KdsOrderItemResponse, KdsOrderResponse
from app.services.inventory_service import deduct_inventory_for_confirmed_order


KDS_STATUSES = (OrderStatus.PENDING.value, OrderStatus.CONFIRMED.value, OrderStatus.PREPARING.value, OrderStatus.READY.value)
KITCHEN_TARGET_STATUSES = frozenset({OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY})


def serialize_kds_order(order: Order) -> KdsOrderResponse:
    if order.fulfillment_type == "table_service" and order.restaurant_table is not None:
        destination = order.restaurant_table.table_number
    else:
        destination = "Counter pickup"
    return KdsOrderResponse(
        id=order.id,
        order_number=order.order_number,
        status=OrderStatus(order.status),
        order_type=order.order_type,
        fulfillment_type=order.fulfillment_type,
        fulfillment_destination=destination,
        ordered_at=order.ordered_at,
        items=[KdsOrderItemResponse(name=item.product_name or "Menu item", quantity=item.quantity, size=item.size_code, addons=item.selected_addons or []) for item in order.items],
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


def update_kds_order_status(db: Session, staff_user: StaffUser, order_id: int, target_status: OrderStatus) -> KdsOrderResponse | None:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.restaurant_table))
        .where(Order.id == order_id)
        .with_for_update()
    )
    if order is None:
        return None
    if staff_user.role.name == "kitchen_staff" and target_status not in KITCHEN_TARGET_STATUSES:
        raise PermissionError("Kitchen staff can only update kitchen preparation statuses.")
    transition_order_status(order, target_status)
    if target_status is OrderStatus.CONFIRMED:
        deduct_inventory_for_confirmed_order(db, order, staff_user)
    db.commit()
    db.refresh(order)
    return serialize_kds_order(order)
