from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.order_status import OrderStatus
from app.db.models.customer import Customer
from app.db.models.order import Order
from app.db.models.payment_method import PaymentMethod
from app.db.models.staff import StaffUser
from app.schemas.payment_method import (
    ManagerPaymentMethodCreateRequest,
    ManagerPaymentMethodSummary,
    ManagerPaymentMethodUpdateRequest,
    ManagerPaymentsLedgerResponse,
    PaymentMethodBreakdownItem,
    PaymentTransactionItem,
)
from app.services.audit_service import record_audit_event


MANILA_TZ = ZoneInfo("Asia/Manila")
ACTIVE_ORDER_STATUSES = frozenset({
    OrderStatus.PENDING.value,
    OrderStatus.CONFIRMED.value,
    OrderStatus.PREPARING.value,
    OrderStatus.READY.value,
})


class PaymentMethodConflictError(ValueError):
    pass


def _timestamps_match(actual: datetime, expected: datetime) -> bool:
    actual_utc = actual if actual.tzinfo else actual.replace(tzinfo=timezone.utc)
    expected_utc = expected if expected.tzinfo else expected.replace(tzinfo=timezone.utc)
    return abs((actual_utc - expected_utc).total_seconds()) < 0.001


def _contains_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _quantize_money(amount: Decimal | int | float | None) -> Decimal:
    if amount is None:
        return Decimal("0.00")
    return Decimal(str(amount)).quantize(Decimal("0.01"))


def _derive_settlement_state(order_status: str) -> Literal["settled", "pending", "voided"]:
    if order_status == OrderStatus.COMPLETED.value:
        return "settled"
    if order_status == OrderStatus.CANCELLED.value:
        return "voided"
    return "pending"


def list_active_payment_methods(db: Session) -> list[PaymentMethod]:
    return list(db.scalars(
        select(PaymentMethod)
        .where(PaymentMethod.is_active.is_(True))
        .order_by(PaymentMethod.display_order, PaymentMethod.id)
    ))


def get_active_payment_method(db: Session, code: str) -> PaymentMethod | None:
    return db.scalar(
        select(PaymentMethod).where(
            PaymentMethod.code == code,
            PaymentMethod.is_active.is_(True),
        )
    )


def list_manager_payment_methods(db: Session) -> list[ManagerPaymentMethodSummary]:
    methods = list(
        db.scalars(
            select(PaymentMethod).order_by(PaymentMethod.display_order, PaymentMethod.id)
        )
    )

    stats_rows = db.execute(
        select(
            Order.payment_method_id,
            Order.status,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .where(Order.payment_method_id.is_not(None))
        .group_by(Order.payment_method_id, Order.status)
    ).all()

    counts_by_method: dict[int, int] = {}
    revenue_by_method: dict[int, Decimal] = {}
    for mid, order_status, cnt, total_sum in stats_rows:
        if mid is None:
            continue
        method_id = int(mid)
        counts_by_method[method_id] = counts_by_method.get(method_id, 0) + int(cnt)
        if order_status == OrderStatus.COMPLETED.value:
            revenue_by_method[method_id] = revenue_by_method.get(method_id, Decimal("0.00")) + _quantize_money(total_sum)

    return [
        ManagerPaymentMethodSummary(
            id=method.id,
            code=method.code,
            label=method.label,
            description=method.description,
            is_active=method.is_active,
            display_order=method.display_order,
            orders_count=counts_by_method.get(method.id, 0),
            collected_revenue=revenue_by_method.get(method.id, Decimal("0.00")),
            created_at=method.created_at,
            updated_at=method.updated_at,
        )
        for method in methods
    ]


def create_manager_payment_method(
    db: Session,
    *,
    request: ManagerPaymentMethodCreateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerPaymentMethodSummary:
    existing = db.scalar(
        select(PaymentMethod).where(func.lower(PaymentMethod.code) == request.code.lower())
    )
    if existing is not None:
        raise PaymentMethodConflictError(f"Payment method code '{request.code}' already exists.")

    now = datetime.now(timezone.utc)
    method = PaymentMethod(
        code=request.code,
        label=request.label,
        description=request.description,
        is_active=request.is_active,
        display_order=request.display_order,
        created_at=now,
        updated_at=now,
    )
    db.add(method)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise PaymentMethodConflictError(f"Payment method code '{request.code}' already exists.") from exc
    db.refresh(method)

    record_audit_event(
        db=db,
        event_type="manager.payment_method.create",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="payment_method",
        target_id=str(method.id),
        outcome="success",
        ip_address=ip_address,
        details={
            "code": method.code,
            "label": method.label,
            "is_active": method.is_active,
            "display_order": method.display_order,
        },
    )

    return ManagerPaymentMethodSummary(
        id=method.id,
        code=method.code,
        label=method.label,
        description=method.description,
        is_active=method.is_active,
        display_order=method.display_order,
        orders_count=0,
        collected_revenue=Decimal("0.00"),
        created_at=method.created_at,
        updated_at=method.updated_at,
    )


def update_manager_payment_method(
    db: Session,
    *,
    method_id: int,
    request: ManagerPaymentMethodUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerPaymentMethodSummary | None:
    method = db.scalar(
        select(PaymentMethod).where(PaymentMethod.id == method_id).with_for_update()
    )
    if method is None:
        return None
    if request.expected_updated_at is not None and not _timestamps_match(method.updated_at, request.expected_updated_at):
        raise PaymentMethodConflictError(
            "Payment method configuration was modified in another session. Refresh and try again."
        )

    if (
        "is_active" in request.model_fields_set
        and request.is_active is False
        and method.is_active
    ):
        active_count = db.scalar(
            select(func.count(PaymentMethod.id)).where(PaymentMethod.is_active.is_(True))
        ) or 0
        if active_count <= 1:
            raise ValueError(
                "At least one active payment method must remain enabled for customer checkout."
            )

    if "label" in request.model_fields_set and request.label is not None:
        method.label = request.label
    if "description" in request.model_fields_set:
        method.description = request.description
    if "is_active" in request.model_fields_set and request.is_active is not None:
        method.is_active = request.is_active
    if "display_order" in request.model_fields_set and request.display_order is not None:
        method.display_order = request.display_order

    method.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(method)

    record_audit_event(
        db=db,
        event_type="manager.payment_method.update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="payment_method",
        target_id=str(method.id),
        outcome="success",
        ip_address=ip_address,
        details={
            "code": method.code,
            "label": method.label,
            "is_active": method.is_active,
            "display_order": method.display_order,
        },
    )

    orders_count = db.scalar(
        select(func.count(Order.id)).where(Order.payment_method_id == method.id)
    ) or 0
    collected_revenue = db.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.payment_method_id == method.id,
            Order.status == OrderStatus.COMPLETED.value,
        )
    )

    return ManagerPaymentMethodSummary(
        id=method.id,
        code=method.code,
        label=method.label,
        description=method.description,
        is_active=method.is_active,
        display_order=method.display_order,
        orders_count=int(orders_count),
        collected_revenue=_quantize_money(collected_revenue),
        created_at=method.created_at,
        updated_at=method.updated_at,
    )


def get_manager_payments_ledger(
    db: Session,
    *,
    search: str | None = None,
    settlement: Literal["all", "settled", "pending", "voided"] = "all",
    method_code: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 15,
) -> ManagerPaymentsLedgerResponse:
    base_filters = []
    if search and search.strip():
        pattern = f"%{_contains_pattern(search.strip())}%"
        base_filters.append(
            or_(
                Order.order_number.ilike(pattern, escape="\\"),
                Customer.full_name.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
            )
        )
    if method_code and method_code.strip() and method_code != "all":
        base_filters.append(PaymentMethod.code == method_code.strip().lower())
    if date_from is not None:
        start_utc = datetime.combine(date_from, time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
        base_filters.append(Order.ordered_at >= start_utc)
    if date_to is not None:
        end_exclusive_utc = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
        base_filters.append(Order.ordered_at < end_exclusive_utc)

    agg_rows = db.execute(
        select(
            PaymentMethod.id,
            PaymentMethod.code,
            PaymentMethod.label,
            Order.status,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
        .outerjoin(Customer, Customer.customer_id == Order.customer_id)
        .where(*base_filters)
        .group_by(PaymentMethod.id, PaymentMethod.code, PaymentMethod.label, Order.status)
    ).all()

    collected_revenue = Decimal("0.00")
    completed_count = 0
    pending_revenue = Decimal("0.00")
    pending_count = 0
    voided_revenue = Decimal("0.00")
    voided_count = 0

    breakdown_map: dict[str, dict] = {}
    for mid, mcode, mlabel, order_status, cnt, total_sum in agg_rows:
        count_int = int(cnt)
        amount = _quantize_money(total_sum)
        code_key = mcode or "unassigned"
        label_val = mlabel or "Unrecorded Method"
        if code_key not in breakdown_map:
            breakdown_map[code_key] = {
                "method_id": int(mid) if mid is not None else None,
                "method_code": code_key,
                "method_label": label_val,
                "orders_count": 0,
                "completed_count": 0,
                "collected_revenue": Decimal("0.00"),
                "pending_revenue": Decimal("0.00"),
            }
        entry = breakdown_map[code_key]
        entry["orders_count"] += count_int
        if order_status == OrderStatus.COMPLETED.value:
            collected_revenue += amount
            completed_count += count_int
            entry["completed_count"] += count_int
            entry["collected_revenue"] += amount
        elif order_status == OrderStatus.CANCELLED.value:
            voided_revenue += amount
            voided_count += count_int
        else:
            pending_revenue += amount
            pending_count += count_int
            entry["pending_revenue"] += amount

    ledger_filters = list(base_filters)
    if settlement == "settled":
        ledger_filters.append(Order.status == OrderStatus.COMPLETED.value)
    elif settlement == "voided":
        ledger_filters.append(Order.status == OrderStatus.CANCELLED.value)
    elif settlement == "pending":
        ledger_filters.append(Order.status.in_(ACTIVE_ORDER_STATUSES))

    total = db.scalar(
        select(func.count(Order.id))
        .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
        .outerjoin(Customer, Customer.customer_id == Order.customer_id)
        .where(*ledger_filters)
    ) or 0

    orders = list(
        db.scalars(
            select(Order)
            .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
            .outerjoin(Customer, Customer.customer_id == Order.customer_id)
            .options(
                selectinload(Order.payment_method),
                selectinload(Order.customer),
                selectinload(Order.restaurant_table),
            )
            .where(*ledger_filters)
            .order_by(Order.ordered_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )

    items = []
    for order in orders:
        if order.fulfillment_type == "table_service" and order.restaurant_table is not None:
            destination = order.restaurant_table.table_number
        else:
            destination = "Counter pickup"
        customer_name = (
            order.customer.full_name
            if order.customer is not None
            else f"Customer #{order.customer_id}"
        )
        items.append(
            PaymentTransactionItem(
                order_id=order.id,
                order_number=order.order_number,
                customer_name=customer_name,
                customer_email=order.customer.email if order.customer is not None else None,
                order_type=order.order_type,
                fulfillment_destination=destination,
                payment_method_code=order.payment_method.code if order.payment_method else None,
                payment_method_label=order.payment_method.label if order.payment_method else "Unrecorded",
                order_status=order.status,
                settlement_state=_derive_settlement_state(order.status),
                subtotal=_quantize_money(order.subtotal),
                discount_amount=_quantize_money(order.discount_amount),
                tax_amount=_quantize_money(order.tax_amount),
                total_amount=_quantize_money(order.total_amount),
                ordered_at=order.ordered_at,
                completed_at=order.completed_at,
                cancelled_at=order.cancelled_at,
            )
        )

    method_breakdown = sorted(
        (PaymentMethodBreakdownItem(**item) for item in breakdown_map.values()),
        key=lambda item: (-item.collected_revenue, item.method_label),
    )

    return ManagerPaymentsLedgerResponse(
        collected_revenue=collected_revenue,
        completed_count=completed_count,
        pending_revenue=pending_revenue,
        pending_count=pending_count,
        voided_revenue=voided_revenue,
        voided_count=voided_count,
        method_breakdown=method_breakdown,
        items=items,
        page=page,
        page_size=page_size,
        total=int(total),
    )
