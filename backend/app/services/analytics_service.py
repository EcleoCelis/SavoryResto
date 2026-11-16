from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.order_status import OrderStatus
from app.db.models.inventory import InventoryItem
from app.db.models.order import Order, OrderItem
from app.db.models.product import MenuProduct
from app.schemas.analytics import (
    KpiSummaryResponse,
    OperationalAlertsResponse,
    OrderDistributionItem,
    OrderDistributionResponse,
    OrderVolumePoint,
    OrderVolumeResponse,
    RevenuePeriod,
    RevenueTrendPoint,
    RevenueTrendResponse,
    TopSellingDishItem,
    TopSellingDishesResponse,
)

MANILA_TZ = ZoneInfo("Asia/Manila")
TWO_PLACES = Decimal("0.01")
ONE_PLACE = Decimal("0.1")

ORDER_STATUS_LABELS: tuple[tuple[OrderStatus, str], ...] = (
    (OrderStatus.PENDING, "Pending"),
    (OrderStatus.CONFIRMED, "Confirmed"),
    (OrderStatus.PREPARING, "Preparing"),
    (OrderStatus.READY, "Ready"),
    (OrderStatus.COMPLETED, "Completed"),
    (OrderStatus.CANCELLED, "Cancelled"),
)


def _quantize_money(amount: Decimal | int | float | None) -> Decimal:
    if amount is None:
        return Decimal("0.00")
    return Decimal(str(amount)).quantize(TWO_PLACES)


def _subtract_months(year: int, month: int, delta_months: int) -> tuple[int, int]:
    total_months = year * 12 + (month - 1) - delta_months
    target_year, zero_based_month = divmod(total_months, 12)
    return target_year, zero_based_month + 1


def _add_one_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _build_period_buckets(
    period: RevenuePeriod,
    now_manila: datetime,
) -> tuple[datetime, datetime, list[tuple[str, str, str]]]:
    """Return (start_utc, end_utc_exclusive, [(key, short_label, tooltip_label), ...])."""
    today = now_manila.date()

    if period == "last_7_days":
        start_date = today - timedelta(days=6)
        end_date_exclusive = today + timedelta(days=1)
        buckets = []
        for offset in range(7):
            day = start_date + timedelta(days=offset)
            key = day.isoformat()
            short_label = day.strftime("%a")
            tooltip_label = f"{day.strftime('%A, %B')} {day.day}, {day.year}"
            buckets.append((key, short_label, tooltip_label))
    elif period == "last_30_days":
        start_date = today - timedelta(days=29)
        end_date_exclusive = today + timedelta(days=1)
        buckets = []
        for offset in range(30):
            day = start_date + timedelta(days=offset)
            key = day.isoformat()
            short_label = f"{day.strftime('%b')} {day.day}"
            tooltip_label = f"{day.strftime('%A, %B')} {day.day}, {day.year}"
            buckets.append((key, short_label, tooltip_label))
    else:
        start_year, start_month = _subtract_months(today.year, today.month, 11)
        end_year, end_month = _add_one_month(today.year, today.month)
        start_date = date(start_year, start_month, 1)
        end_date_exclusive = date(end_year, end_month, 1)
        buckets = []
        cur_year, cur_month = start_year, start_month
        for _ in range(12):
            month_date = date(cur_year, cur_month, 1)
            key = f"{cur_year:04d}-{cur_month:02d}"
            short_label = month_date.strftime("%b '%y")
            tooltip_label = month_date.strftime("%B %Y")
            buckets.append((key, short_label, tooltip_label))
            cur_year, cur_month = _add_one_month(cur_year, cur_month)

    start_local = datetime.combine(start_date, time.min, tzinfo=MANILA_TZ)
    end_local = datetime.combine(end_date_exclusive, time.min, tzinfo=MANILA_TZ)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), buckets


def get_revenue_trend(
    db: Session,
    period: RevenuePeriod = "last_7_days",
    *,
    now: datetime | None = None,
) -> RevenueTrendResponse:
    """Aggregate completed order revenue by calendar day or month in Asia/Manila."""
    reference_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    now_manila = reference_utc.astimezone(MANILA_TZ)
    start_utc, end_utc, buckets = _build_period_buckets(period, now_manila)

    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    totals_by_key: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    counts_by_key: dict[str, int] = defaultdict(int)

    dialect_name = db.bind.dialect.name if db.bind is not None else ""
    if dialect_name == "postgresql":
        local_dt = func.timezone("Asia/Manila", effective_ts)
        trunc_unit = "month" if period == "last_12_months" else "day"
        bucket_col = func.date_trunc(trunc_unit, local_dt).label("bucket")
        stmt = (
            select(
                bucket_col,
                func.coalesce(func.sum(Order.total_amount), 0).label("revenue"),
                func.count(Order.id).label("order_count"),
            )
            .where(
                Order.status == OrderStatus.COMPLETED.value,
                effective_ts >= start_utc,
                effective_ts < end_utc,
            )
            .group_by(bucket_col)
            .order_by(bucket_col)
        )
        for bucket_dt, revenue, order_count in db.execute(stmt).all():
            key = (
                bucket_dt.strftime("%Y-%m")
                if period == "last_12_months"
                else bucket_dt.strftime("%Y-%m-%d")
            )
            totals_by_key[key] += _quantize_money(revenue)
            counts_by_key[key] += int(order_count or 0)
    else:
        stmt = select(effective_ts, Order.total_amount).where(
            Order.status == OrderStatus.COMPLETED.value,
            effective_ts >= start_utc,
            effective_ts < end_utc,
        )
        for ts, amount in db.execute(stmt).all():
            if ts is None:
                continue
            aware_ts = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
            local_dt = aware_ts.astimezone(MANILA_TZ)
            key = (
                local_dt.strftime("%Y-%m")
                if period == "last_12_months"
                else local_dt.strftime("%Y-%m-%d")
            )
            totals_by_key[key] += _quantize_money(amount)
            counts_by_key[key] += 1

    points: list[RevenueTrendPoint] = []
    period_total_revenue = Decimal("0.00")
    period_total_orders = 0

    for key, short_label, tooltip_label in buckets:
        rev = _quantize_money(totals_by_key.get(key))
        cnt = counts_by_key.get(key, 0)
        period_total_revenue += rev
        period_total_orders += cnt
        points.append(
            RevenueTrendPoint(
                date=key,
                label=short_label,
                tooltip_label=tooltip_label,
                revenue=rev,
                order_count=cnt,
            )
        )

    return RevenueTrendResponse(
        period=period,
        currency="PHP",
        timezone="Asia/Manila",
        metric_basis="completed_orders",
        total_revenue=_quantize_money(period_total_revenue),
        total_orders=period_total_orders,
        data=points,
    )


def get_order_distribution(
    db: Session,
    period: RevenuePeriod = "last_7_days",
    *,
    now: datetime | None = None,
) -> OrderDistributionResponse:
    """Aggregate current order counts by status for orders placed within the Asia/Manila reporting window."""
    reference_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    now_manila = reference_utc.astimezone(MANILA_TZ)
    start_utc, end_utc, _ = _build_period_buckets(period, now_manila)

    stmt = (
        select(Order.status, func.count(Order.id))
        .where(
            Order.ordered_at >= start_utc,
            Order.ordered_at < end_utc,
        )
        .group_by(Order.status)
    )

    counts_by_status: dict[str, int] = defaultdict(int)
    for status_value, order_count in db.execute(stmt).all():
        if status_value is not None:
            counts_by_status[str(status_value)] += int(order_count or 0)

    distribution: list[OrderDistributionItem] = []
    total_orders = 0
    for status_enum, label in ORDER_STATUS_LABELS:
        cnt = counts_by_status.get(status_enum.value, 0)
        total_orders += cnt
        distribution.append(
            OrderDistributionItem(
                status=status_enum.value,
                label=label,
                count=cnt,
            )
        )

    return OrderDistributionResponse(
        period=period,
        timezone="Asia/Manila",
        cohort_basis="orders_placed",
        total_orders=total_orders,
        distribution=distribution,
    )


def get_top_selling_dishes(
    db: Session,
    period: RevenuePeriod = "last_7_days",
    *,
    limit: int = 5,
    now: datetime | None = None,
) -> TopSellingDishesResponse:
    """Rank top-selling dishes by qualifying completed order-item quantities in Asia/Manila."""
    reference_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    now_manila = reference_utc.astimezone(MANILA_TZ)
    start_utc, end_utc, _ = _build_period_buckets(period, now_manila)

    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    units_col = func.coalesce(func.sum(OrderItem.quantity), 0).label("units_sold")
    revenue_col = func.coalesce(func.sum(OrderItem.line_total), 0).label("revenue")
    name_col = func.coalesce(
        func.max(MenuProduct.name),
        func.max(OrderItem.product_name),
    ).label("dish_name")

    stmt = (
        select(
            OrderItem.menu_item_id,
            name_col,
            units_col,
            revenue_col,
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(MenuProduct, MenuProduct.id == OrderItem.menu_item_id)
        .where(
            Order.status == OrderStatus.COMPLETED.value,
            OrderItem.status != OrderStatus.CANCELLED.value,
            effective_ts >= start_utc,
            effective_ts < end_utc,
        )
        .group_by(OrderItem.menu_item_id)
        .order_by(units_col.desc(), revenue_col.desc(), OrderItem.menu_item_id.asc())
        .limit(limit)
    )

    items: list[TopSellingDishItem] = []
    for product_id, dish_name, units_sold, revenue in db.execute(stmt).all():
        clean_name = (dish_name or "").strip() or f"Menu Item #{int(product_id)}"
        items.append(
            TopSellingDishItem(
                product_id=int(product_id),
                name=clean_name,
                units_sold=int(units_sold or 0),
                revenue=_quantize_money(revenue),
            )
        )

    return TopSellingDishesResponse(
        period=period,
        timezone="Asia/Manila",
        metric="units_sold",
        metric_basis="completed_orders",
        items=items,
    )


def get_order_volume(
    db: Session,
    period: RevenuePeriod = "last_7_days",
    *,
    now: datetime | None = None,
) -> OrderVolumeResponse:
    """Count orders placed per chronological day or month bucket in Asia/Manila."""
    reference_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    now_manila = reference_utc.astimezone(MANILA_TZ)
    start_utc, end_utc, buckets = _build_period_buckets(period, now_manila)

    counts_by_key: dict[str, int] = defaultdict(int)
    dialect_name = db.bind.dialect.name if db.bind is not None else ""
    if dialect_name == "postgresql":
        local_dt = func.timezone("Asia/Manila", Order.ordered_at)
        trunc_unit = "month" if period == "last_12_months" else "day"
        bucket_col = func.date_trunc(trunc_unit, local_dt).label("bucket")
        stmt = (
            select(
                bucket_col,
                func.count(Order.id).label("order_count"),
            )
            .where(
                Order.ordered_at >= start_utc,
                Order.ordered_at < end_utc,
            )
            .group_by(bucket_col)
            .order_by(bucket_col)
        )
        for bucket_dt, order_count in db.execute(stmt).all():
            key = (
                bucket_dt.strftime("%Y-%m")
                if period == "last_12_months"
                else bucket_dt.strftime("%Y-%m-%d")
            )
            counts_by_key[key] += int(order_count or 0)
    else:
        stmt = select(Order.ordered_at).where(
            Order.ordered_at >= start_utc,
            Order.ordered_at < end_utc,
        )
        for (ts,) in db.execute(stmt).all():
            if ts is None:
                continue
            aware_ts = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
            local_dt = aware_ts.astimezone(MANILA_TZ)
            key = (
                local_dt.strftime("%Y-%m")
                if period == "last_12_months"
                else local_dt.strftime("%Y-%m-%d")
            )
            counts_by_key[key] += 1

    points: list[OrderVolumePoint] = []
    total_orders = 0
    for key, short_label, tooltip_label in buckets:
        cnt = counts_by_key.get(key, 0)
        total_orders += cnt
        points.append(
            OrderVolumePoint(
                date=key,
                label=short_label,
                tooltip_label=tooltip_label,
                orders=cnt,
            )
        )

    return OrderVolumeResponse(
        period=period,
        timezone="Asia/Manila",
        metric="orders_placed",
        total_orders=total_orders,
        data=points,
    )


def get_kpi_summary(
    db: Session,
    period: RevenuePeriod = "last_7_days",
    *,
    now: datetime | None = None,
) -> KpiSummaryResponse:
    """Compute period-synchronized revenue, order volume, completion rate, and AOV in Asia/Manila."""
    reference_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    now_manila = reference_utc.astimezone(MANILA_TZ)
    start_utc, end_utc, _ = _build_period_buckets(period, now_manila)

    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    rev_row = db.execute(
        select(
            func.coalesce(func.sum(Order.total_amount), 0),
            func.count(Order.id),
        ).where(
            Order.status == OrderStatus.COMPLETED.value,
            effective_ts >= start_utc,
            effective_ts < end_utc,
        )
    ).one()

    total_revenue = _quantize_money(rev_row[0])
    completed_orders = int(rev_row[1] or 0)

    placed_rows = db.execute(
        select(Order.status, func.count(Order.id))
        .where(
            Order.ordered_at >= start_utc,
            Order.ordered_at < end_utc,
        )
        .group_by(Order.status)
    ).all()

    total_orders = 0
    placed_completed_orders = 0
    for status_value, order_count in placed_rows:
        cnt = int(order_count or 0)
        total_orders += cnt
        if status_value == OrderStatus.COMPLETED.value:
            placed_completed_orders += cnt

    completion_rate = (
        ((Decimal(placed_completed_orders) * Decimal("100")) / Decimal(total_orders)).quantize(
            ONE_PLACE, rounding=ROUND_HALF_UP
        )
        if total_orders > 0
        else Decimal("0.0")
    )
    average_order_value = (
        (total_revenue / Decimal(completed_orders)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
        if completed_orders > 0
        else Decimal("0.00")
    )

    return KpiSummaryResponse(
        period=period,
        currency="PHP",
        timezone="Asia/Manila",
        total_revenue=total_revenue,
        total_orders=total_orders,
        completed_orders=completed_orders,
        placed_completed_orders=placed_completed_orders,
        completion_rate=completion_rate,
        average_order_value=average_order_value,
    )


def get_operational_alerts(db: Session) -> OperationalAlertsResponse:
    """Return real-time operational handoff and active inventory restock alert counts."""
    ready_orders_count = int(
        db.scalar(
            select(func.count(Order.id)).where(Order.status == OrderStatus.READY.value)
        )
        or 0
    )
    pending_orders_count = int(
        db.scalar(
            select(func.count(Order.id)).where(Order.status == OrderStatus.PENDING.value)
        )
        or 0
    )

    base_active_inventory = (
        InventoryItem.deleted_at.is_(None),
        InventoryItem.is_active.is_(True),
    )
    out_of_stock_count = int(
        db.scalar(
            select(func.count(InventoryItem.id)).where(
                *base_active_inventory,
                InventoryItem.current_stock <= 0,
            )
        )
        or 0
    )
    low_stock_count = int(
        db.scalar(
            select(func.count(InventoryItem.id)).where(
                *base_active_inventory,
                InventoryItem.current_stock > 0,
                InventoryItem.current_stock <= InventoryItem.reorder_level,
            )
        )
        or 0
    )
    low_stock_names = list(
        db.scalars(
            select(InventoryItem.name)
            .where(
                *base_active_inventory,
                InventoryItem.current_stock <= InventoryItem.reorder_level,
            )
            .order_by(InventoryItem.current_stock.asc(), InventoryItem.name.asc())
            .limit(3)
        ).all()
    )

    return OperationalAlertsResponse(
        ready_orders_count=ready_orders_count,
        pending_orders_count=pending_orders_count,
        low_stock_count=low_stock_count,
        out_of_stock_count=out_of_stock_count,
        low_stock_names=low_stock_names,
    )
