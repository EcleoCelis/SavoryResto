from datetime import datetime, timezone
from enum import StrEnum

from app.db.models.order import Order


class OrderStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    READY = "ready"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


STATUS_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.PENDING: frozenset({OrderStatus.CONFIRMED, OrderStatus.CANCELLED}),
    OrderStatus.CONFIRMED: frozenset({OrderStatus.PREPARING, OrderStatus.CANCELLED}),
    OrderStatus.PREPARING: frozenset({OrderStatus.READY}),
    OrderStatus.READY: frozenset({OrderStatus.COMPLETED}),
    OrderStatus.COMPLETED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
}


def parse_order_status(value: str | OrderStatus) -> OrderStatus:
    try:
        return OrderStatus(value)
    except ValueError as error:
        raise ValueError("The order status is invalid.") from error


def transition_order_status(order: Order, next_status: str | OrderStatus) -> OrderStatus:
    """Apply a validated transition; authorization belongs to a future staff workflow."""
    current_status = parse_order_status(order.status)
    target_status = parse_order_status(next_status)
    if target_status not in STATUS_TRANSITIONS[current_status]:
        raise ValueError(f"Orders cannot transition from {current_status.value} to {target_status.value}.")

    order.status = target_status.value
    order.updated_at = datetime.now(timezone.utc)
    if target_status is OrderStatus.COMPLETED:
        order.completed_at = order.updated_at
    return target_status
