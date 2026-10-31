from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.order_status import OrderStatus
from app.db.models.order import Order
from app.db.models.restaurant_table import RestaurantTable


ACTIVE_TABLE_STATUSES = (OrderStatus.PENDING.value, OrderStatus.CONFIRMED.value, OrderStatus.PREPARING.value, OrderStatus.READY.value)


def list_restaurant_tables(db: Session) -> list[tuple[RestaurantTable, bool]]:
    occupied_table_ids = set(db.scalars(
        select(Order.restaurant_table_id).where(
            Order.restaurant_table_id.is_not(None),
            Order.status.in_(ACTIVE_TABLE_STATUSES),
        )
    ))
    tables = db.scalars(select(RestaurantTable).where(RestaurantTable.is_active.is_(True)).order_by(RestaurantTable.table_number)).all()
    return [(table, table.id not in occupied_table_ids) for table in tables]


def validate_fulfillment(db: Session, order_type: str, fulfillment_type: str, restaurant_table_id: int | None) -> RestaurantTable | None:
    if order_type == "takeout":
        if fulfillment_type != "counter_pickup" or restaurant_table_id is not None:
            raise ValueError("Take out orders require counter pickup and cannot have a table.")
        return None
    if order_type != "dine_in" or fulfillment_type != "table_service" or restaurant_table_id is None:
        raise ValueError("Dine in orders require table service and an available table.")

    table = db.scalar(
        select(RestaurantTable)
        .where(RestaurantTable.id == restaurant_table_id, RestaurantTable.is_active.is_(True))
        .with_for_update()
    )
    if table is None:
        raise ValueError("The selected table is unavailable.")
    is_occupied = db.scalar(
        select(Order.id).where(
            Order.restaurant_table_id == table.id,
            Order.status.in_(ACTIVE_TABLE_STATUSES),
        ).limit(1)
    )
    if is_occupied is not None:
        raise ValueError("The selected table is currently occupied. Please choose another table.")
    return table
