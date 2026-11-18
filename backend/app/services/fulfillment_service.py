from datetime import datetime, timezone
from decimal import Decimal
import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.order_status import OrderStatus
from app.db.models.order import Order
from app.db.models.restaurant_table import RestaurantTable
from app.db.models.staff import StaffUser
from app.schemas.fulfillment import (
    ManagerTableActiveOrderSummary,
    ManagerTableCreateRequest,
    ManagerTableSummary,
    ManagerTablesOverviewResponse,
    ManagerTableUpdateRequest,
)
from app.services.audit_service import record_audit_event


ACTIVE_TABLE_STATUSES = (OrderStatus.PENDING.value, OrderStatus.CONFIRMED.value, OrderStatus.PREPARING.value, OrderStatus.READY.value)


class TableConflictError(ValueError):
    pass


class StaleTableUpdateError(TableConflictError):
    pass


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _table_sort_key(table: RestaurantTable) -> tuple[int, int | str, str]:
    match = re.search(r"(\d+)$", table.table_number.strip())
    if match:
        prefix = table.table_number[: match.start()].strip().lower()
        return (0, int(match.group(1)), prefix)
    return (1, table.table_number.lower(), table.table_number.lower())


def list_restaurant_tables(db: Session) -> list[tuple[RestaurantTable, bool]]:
    occupied_table_ids = set(db.scalars(
        select(Order.restaurant_table_id).where(
            Order.restaurant_table_id.is_not(None),
            Order.status.in_(ACTIVE_TABLE_STATUSES),
        )
    ))
    tables = db.scalars(select(RestaurantTable).where(RestaurantTable.is_active.is_(True)).order_by(RestaurantTable.table_number)).all()
    tables_sorted = sorted(tables, key=_table_sort_key)
    return [(table, table.id not in occupied_table_ids) for table in tables_sorted]


def list_manager_tables(db: Session) -> ManagerTablesOverviewResponse:
    tables = sorted(
        list(db.scalars(select(RestaurantTable).order_by(RestaurantTable.id)).all()),
        key=_table_sort_key,
    )

    active_orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.customer))
            .where(
                Order.restaurant_table_id.is_not(None),
                Order.status.in_(ACTIVE_TABLE_STATUSES),
            )
            .order_by(Order.ordered_at.desc(), Order.id.desc())
        )
    )
    active_by_table: dict[int, Order] = {}
    for order in active_orders:
        if order.restaurant_table_id is not None and order.restaurant_table_id not in active_by_table:
            active_by_table[order.restaurant_table_id] = order

    total_counts_rows = db.execute(
        select(Order.restaurant_table_id, func.count(Order.id))
        .where(Order.restaurant_table_id.is_not(None))
        .group_by(Order.restaurant_table_id)
    ).all()
    counts_by_table = {int(tid): int(cnt) for tid, cnt in total_counts_rows if tid is not None}

    items: list[ManagerTableSummary] = []
    active_tables = 0
    available_tables = 0
    occupied_tables = 0
    total_active_seats = 0

    for table in tables:
        active_order = active_by_table.get(table.id)
        is_occupied = active_order is not None
        if table.is_active:
            active_tables += 1
            total_active_seats += table.seats
            if is_occupied:
                occupied_tables += 1
            else:
                available_tables += 1

        active_summary = None
        if active_order is not None:
            customer_name = (
                active_order.customer.full_name
                if active_order.customer is not None
                else f"Customer #{active_order.customer_id}"
            )
            active_summary = ManagerTableActiveOrderSummary(
                id=active_order.id,
                order_number=active_order.order_number,
                status=active_order.status,
                customer_name=customer_name,
                total_amount=Decimal(str(active_order.total_amount)).quantize(Decimal("0.01")),
                ordered_at=active_order.ordered_at,
            )

        items.append(
            ManagerTableSummary(
                id=table.id,
                table_number=table.table_number,
                seats=table.seats,
                is_active=table.is_active,
                is_occupied=is_occupied,
                active_order=active_summary,
                total_orders_count=counts_by_table.get(table.id, 0),
                created_at=table.created_at,
                updated_at=table.updated_at,
            )
        )

    return ManagerTablesOverviewResponse(
        total_tables=len(tables),
        active_tables=active_tables,
        available_tables=available_tables,
        occupied_tables=occupied_tables,
        total_active_seats=total_active_seats,
        items=items,
    )


def create_manager_table(
    db: Session,
    *,
    request: ManagerTableCreateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerTableSummary:
    existing = db.scalar(
        select(RestaurantTable).where(
            func.lower(RestaurantTable.table_number) == request.table_number.lower()
        )
    )
    if existing is not None:
        raise TableConflictError(f"A dining table named '{request.table_number}' already exists.")

    now = datetime.now(timezone.utc)
    table = RestaurantTable(
        table_number=request.table_number,
        seats=request.seats,
        is_active=request.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(table)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise TableConflictError(
            f"A dining table named '{request.table_number}' already exists."
        ) from err
    db.refresh(table)

    record_audit_event(
        db=db,
        event_type="manager.table.create",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="restaurant_table",
        target_id=str(table.id),
        outcome="success",
        ip_address=ip_address,
        details={
            "table_number": table.table_number,
            "seats": table.seats,
            "is_active": table.is_active,
        },
    )

    return ManagerTableSummary(
        id=table.id,
        table_number=table.table_number,
        seats=table.seats,
        is_active=table.is_active,
        is_occupied=False,
        active_order=None,
        total_orders_count=0,
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


def update_manager_table(
    db: Session,
    *,
    table_id: int,
    request: ManagerTableUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerTableSummary | None:
    table = db.scalar(
        select(RestaurantTable).where(RestaurantTable.id == table_id).with_for_update()
    )
    if table is None:
        return None

    if request.expected_updated_at is not None:
        if abs((_to_utc(table.updated_at) - _to_utc(request.expected_updated_at)).total_seconds()) > 0.001:
            raise StaleTableUpdateError(
                "This table was updated by another session. Refresh to load the latest state before saving."
            )

    changed_fields: dict[str, dict[str, object]] = {}

    if "table_number" in request.model_fields_set and request.table_number is not None:
        if request.table_number != table.table_number:
            conflict = db.scalar(
                select(RestaurantTable).where(
                    func.lower(RestaurantTable.table_number) == request.table_number.lower(),
                    RestaurantTable.id != table_id,
                )
            )
            if conflict is not None:
                raise TableConflictError(f"A dining table named '{request.table_number}' already exists.")
            changed_fields["table_number"] = {"from": table.table_number, "to": request.table_number}
            table.table_number = request.table_number

    if "seats" in request.model_fields_set and request.seats is not None:
        if request.seats != table.seats:
            changed_fields["seats"] = {"from": table.seats, "to": request.seats}
            table.seats = request.seats

    active_order = db.scalar(
        select(Order)
        .options(selectinload(Order.customer))
        .where(
            Order.restaurant_table_id == table.id,
            Order.status.in_(ACTIVE_TABLE_STATUSES),
        )
        .order_by(Order.ordered_at.desc(), Order.id.desc())
        .limit(1)
    )

    if "is_active" in request.model_fields_set and request.is_active is not None:
        if request.is_active is False and active_order is not None:
            raise ValueError(
                f"Cannot deactivate {table.table_number} while order {active_order.order_number} is active."
            )
        if request.is_active != table.is_active:
            changed_fields["is_active"] = {"from": table.is_active, "to": request.is_active}
            table.is_active = request.is_active

    if changed_fields:
        table.updated_at = datetime.now(timezone.utc)
        try:
            db.commit()
        except IntegrityError as err:
            db.rollback()
            raise TableConflictError(
                f"A dining table named '{table.table_number}' already exists."
            ) from err
        db.refresh(table)

        record_audit_event(
            db=db,
            event_type="manager.table.update",
            actor_type="staff",
            actor_id=staff_user.id,
            actor_email=staff_user.email,
            target_type="restaurant_table",
            target_id=str(table.id),
            outcome="success",
            ip_address=ip_address,
            details={
                "table_number": table.table_number,
                "changed_fields": changed_fields,
            },
        )

    total_orders_count = db.scalar(
        select(func.count(Order.id)).where(Order.restaurant_table_id == table.id)
    ) or 0

    active_summary = None
    if active_order is not None:
        customer_name = (
            active_order.customer.full_name
            if active_order.customer is not None
            else f"Customer #{active_order.customer_id}"
        )
        active_summary = ManagerTableActiveOrderSummary(
            id=active_order.id,
            order_number=active_order.order_number,
            status=active_order.status,
            customer_name=customer_name,
            total_amount=Decimal(str(active_order.total_amount)).quantize(Decimal("0.01")),
            ordered_at=active_order.ordered_at,
        )

    return ManagerTableSummary(
        id=table.id,
        table_number=table.table_number,
        seats=table.seats,
        is_active=table.is_active,
        is_occupied=active_summary is not None,
        active_order=active_summary,
        total_orders_count=int(total_orders_count),
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


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
