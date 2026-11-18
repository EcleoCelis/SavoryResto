"""Authoritative reporting service for SavoryBites Manager Reports."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
import csv
import io
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.order_status import OrderStatus
from app.db.models.category import MenuCategory
from app.db.models.inventory import InventoryItem, InventoryTransaction
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.schemas.reports import (
    ComparisonCountMetric,
    ComparisonMetric,
    InventoryItemMovementRow,
    InventoryTopConsumedItem,
    InventoryTransactionLedgerRow,
    ManagerInventoryReportResponse,
    ManagerMenuReportResponse,
    ManagerOrderReportRow,
    ManagerOrdersReportResponse,
    ManagerPaymentsReportResponse,
    ManagerReportOverviewResponse,
    ManagerSalesReportResponse,
    MenuCategoryOption,
    MenuCategorySummaryItem,
    MenuPerformanceItem,
    MenuSortBy,
    OrdersStatusBreakdownItem,
    OrdersTimeBucketItem,
    OrdersTypeBreakdownItem,
    OverviewPaymentMethodItem,
    OverviewTopDishItem,
    OverviewTrendPoint,
    PaymentsMethodSummaryRow,
    PaymentsTransactionReportRow,
    ReportDatePreset,
    ReportExportType,
    ReportGranularity,
    ReportWindowMeta,
    SalesCategoryShareItem,
    SalesIntervalRow,
    SortDirection,
)

MANILA_TZ = ZoneInfo("Asia/Manila")
TWO_PLACES = Decimal("0.01")
ONE_PLACE = Decimal("0.1")
MAX_CUSTOM_RANGE_DAYS = 366
MAX_CSV_ROWS = 5000

ACTIVE_ORDER_STATUSES = frozenset({
    OrderStatus.PENDING.value,
    OrderStatus.CONFIRMED.value,
    OrderStatus.PREPARING.value,
    OrderStatus.READY.value,
})

ORDER_STATUS_LABELS: tuple[tuple[OrderStatus, str], ...] = (
    (OrderStatus.PENDING, "Pending"),
    (OrderStatus.CONFIRMED, "Confirmed"),
    (OrderStatus.PREPARING, "Preparing"),
    (OrderStatus.READY, "Ready"),
    (OrderStatus.COMPLETED, "Completed"),
    (OrderStatus.CANCELLED, "Cancelled"),
)

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


@dataclass(frozen=True)
class ResolvedReportWindow:
    preset: ReportDatePreset
    date_from: date
    date_to: date
    prev_date_from: date
    prev_date_to: date
    start_utc: datetime
    end_utc: datetime
    prev_start_utc: datetime
    prev_end_utc: datetime

    def to_meta(self) -> ReportWindowMeta:
        return ReportWindowMeta(
            preset=self.preset,
            date_from=self.date_from,
            date_to=self.date_to,
            previous_date_from=self.prev_date_from,
            previous_date_to=self.prev_date_to,
        )


def _quantize_money(amount: Decimal | int | float | None) -> Decimal:
    if amount is None:
        return Decimal("0.00")
    return Decimal(str(amount)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _quantize_qty(qty: Decimal | int | float | None) -> Decimal:
    if qty is None:
        return Decimal("0.000")
    return Decimal(str(qty)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _quantize_pct(numerator: Decimal | int, denominator: Decimal | int) -> Decimal:
    den = Decimal(str(denominator))
    if den <= 0:
        return Decimal("0.0")
    num = Decimal(str(numerator))
    return ((num * Decimal("100")) / den).quantize(ONE_PLACE, rounding=ROUND_HALF_UP)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _to_manila_iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    aware = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return aware.astimezone(MANILA_TZ).strftime("%Y-%m-%d %H:%M:%S %z")


def sanitize_csv_cell(value: object) -> str:
    """Neutralize spreadsheet formula injection payloads on untrusted string fields."""
    if value is None:
        return ""
    if isinstance(value, (int, Decimal)):
        return str(value)
    text = str(value)
    stripped = text.lstrip()
    if stripped and stripped[0] in FORMULA_PREFIXES:
        return f"'{text}"
    return text


def _subtract_one_month_bounds(anchor_year: int, anchor_month: int) -> tuple[date, date]:
    if anchor_month == 1:
        prev_year, prev_month = anchor_year - 1, 12
    else:
        prev_year, prev_month = anchor_year, anchor_month - 1
    first_day = date(prev_year, prev_month, 1)
    if prev_month == 12:
        next_first = date(prev_year + 1, 1, 1)
    else:
        next_first = date(prev_year, prev_month + 1, 1)
    return first_day, next_first - timedelta(days=1)


def resolve_report_window(
    preset: ReportDatePreset = "last_30_days",
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    now: datetime | None = None,
) -> ResolvedReportWindow:
    """Resolve an inclusive Asia/Manila calendar window and its half-open UTC boundaries."""
    ref_utc = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    today = ref_utc.astimezone(MANILA_TZ).date()

    if preset == "today":
        start_d, end_d = today, today
    elif preset == "yesterday":
        start_d = today - timedelta(days=1)
        end_d = start_d
    elif preset == "last_7_days":
        start_d = today - timedelta(days=6)
        end_d = today
    elif preset == "last_30_days":
        start_d = today - timedelta(days=29)
        end_d = today
    elif preset == "this_month":
        start_d = date(today.year, today.month, 1)
        end_d = today
    elif preset == "last_month":
        start_d, end_d = _subtract_one_month_bounds(today.year, today.month)
    else:
        if date_from is None or date_to is None:
            raise ValueError("Custom date range requires both date_from and date_to.")
        start_d, end_d = date_from, date_to

    if start_d > end_d:
        raise ValueError("date_from must be on or before date_to.")
    span_days = (end_d - start_d).days + 1
    if span_days > MAX_CUSTOM_RANGE_DAYS:
        raise ValueError(f"Date range cannot exceed {MAX_CUSTOM_RANGE_DAYS} days.")

    if preset == "last_month":
        prev_start, prev_end = _subtract_one_month_bounds(start_d.year, start_d.month)
    else:
        prev_end = start_d - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span_days - 1)

    start_utc = datetime.combine(start_d, time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
    end_utc = datetime.combine(end_d + timedelta(days=1), time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
    prev_start_utc = datetime.combine(prev_start, time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)
    prev_end_utc = datetime.combine(prev_end + timedelta(days=1), time.min, tzinfo=MANILA_TZ).astimezone(timezone.utc)

    return ResolvedReportWindow(
        preset=preset,
        date_from=start_d,
        date_to=end_d,
        prev_date_from=prev_start,
        prev_date_to=prev_end,
        start_utc=start_utc,
        end_utc=end_utc,
        prev_start_utc=prev_start_utc,
        prev_end_utc=prev_end_utc,
    )


def _iter_buckets(
    start_d: date,
    end_d: date,
    granularity: ReportGranularity,
) -> list[tuple[str, str, str]]:
    buckets: list[tuple[str, str, str]] = []
    if granularity == "monthly":
        cur_year, cur_month = start_d.year, start_d.month
        while (cur_year, cur_month) <= (end_d.year, end_d.month):
            m_date = date(cur_year, cur_month, 1)
            buckets.append(
                (
                    f"{cur_year:04d}-{cur_month:02d}",
                    m_date.strftime("%b '%y"),
                    m_date.strftime("%B %Y"),
                )
            )
            if cur_month == 12:
                cur_year += 1
                cur_month = 1
            else:
                cur_month += 1
        return buckets

    span_days = (end_d - start_d).days + 1
    for offset in range(span_days):
        day = start_d + timedelta(days=offset)
        short_lbl = day.strftime("%a") if span_days <= 7 else f"{day.strftime('%b')} {day.day}"
        tooltip_lbl = f"{day.strftime('%A, %B')} {day.day}, {day.year}"
        buckets.append((day.isoformat(), short_lbl, tooltip_lbl))
    return buckets


def _build_money_comparison(current: Decimal, previous: Decimal) -> ComparisonMetric:
    cur_q = _quantize_money(current)
    prev_q = _quantize_money(previous)
    delta = _quantize_money(cur_q - prev_q)
    change_pct = (
        ((delta * Decimal("100")) / prev_q).quantize(ONE_PLACE, rounding=ROUND_HALF_UP)
        if prev_q > 0
        else None
    )
    return ComparisonMetric(
        current=cur_q,
        previous=prev_q,
        delta=delta,
        change_pct=change_pct,
    )


def _build_count_comparison(current: int, previous: int) -> ComparisonCountMetric:
    delta = current - previous
    change_pct = (
        ((Decimal(delta) * Decimal("100")) / Decimal(previous)).quantize(ONE_PLACE, rounding=ROUND_HALF_UP)
        if previous > 0
        else None
    )
    return ComparisonCountMetric(
        current=current,
        previous=previous,
        delta=delta,
        change_pct=change_pct,
    )


def _completed_period_summary(
    db: Session,
    start_utc: datetime,
    end_utc: datetime,
) -> tuple[Decimal, int]:
    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    row = db.execute(
        select(
            func.coalesce(func.sum(Order.total_amount), 0),
            func.count(Order.id),
        ).where(
            Order.status == OrderStatus.COMPLETED.value,
            effective_ts >= start_utc,
            effective_ts < end_utc,
        )
    ).one()
    return _quantize_money(row[0]), int(row[1] or 0)


def _placed_counts_summary(
    db: Session,
    start_utc: datetime,
    end_utc: datetime,
) -> dict[str, int]:
    rows = db.execute(
        select(Order.status, func.count(Order.id))
        .where(
            Order.ordered_at >= start_utc,
            Order.ordered_at < end_utc,
        )
        .group_by(Order.status)
    ).all()
    counts: dict[str, int] = defaultdict(int)
    for st, cnt in rows:
        if st:
            counts[str(st)] += int(cnt or 0)
    return counts


def _aggregate_daily_completed_and_placed(
    db: Session,
    start_utc: datetime,
    end_utc: datetime,
    granularity: ReportGranularity,
) -> tuple[dict[str, tuple[int, Decimal, Decimal, Decimal, Decimal]], dict[str, int]]:
    """Aggregate completed order financials & placed order counts per bucket."""
    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    completed_by_key: dict[str, list] = {}
    placed_by_key: dict[str, int] = defaultdict(int)
    dialect_name = db.bind.dialect.name if db.bind is not None else ""

    if dialect_name == "postgresql":
        trunc_unit = "month" if granularity == "monthly" else "day"
        completed_bucket = func.date_trunc(trunc_unit, func.timezone("Asia/Manila", effective_ts)).label("bucket")
        comp_stmt = (
            select(
                completed_bucket,
                func.count(Order.id),
                func.coalesce(func.sum(Order.subtotal), 0),
                func.coalesce(func.sum(Order.discount_amount), 0),
                func.coalesce(func.sum(Order.tax_amount), 0),
                func.coalesce(func.sum(Order.total_amount), 0),
            )
            .where(
                Order.status == OrderStatus.COMPLETED.value,
                effective_ts >= start_utc,
                effective_ts < end_utc,
            )
            .group_by(completed_bucket)
            .order_by(completed_bucket)
        )
        for b_dt, cnt, gross, disc, tax, net in db.execute(comp_stmt).all():
            key = b_dt.strftime("%Y-%m") if granularity == "monthly" else b_dt.strftime("%Y-%m-%d")
            completed_by_key[key] = [
                int(cnt or 0),
                _quantize_money(gross),
                _quantize_money(disc),
                _quantize_money(tax),
                _quantize_money(net),
            ]

        placed_bucket = func.date_trunc(trunc_unit, func.timezone("Asia/Manila", Order.ordered_at)).label("bucket")
        placed_stmt = (
            select(placed_bucket, func.count(Order.id))
            .where(Order.ordered_at >= start_utc, Order.ordered_at < end_utc)
            .group_by(placed_bucket)
            .order_by(placed_bucket)
        )
        for b_dt, cnt in db.execute(placed_stmt).all():
            key = b_dt.strftime("%Y-%m") if granularity == "monthly" else b_dt.strftime("%Y-%m-%d")
            placed_by_key[key] += int(cnt or 0)
    else:
        comp_rows = db.execute(
            select(
                effective_ts,
                Order.subtotal,
                Order.discount_amount,
                Order.tax_amount,
                Order.total_amount,
            ).where(
                Order.status == OrderStatus.COMPLETED.value,
                effective_ts >= start_utc,
                effective_ts < end_utc,
            )
        ).all()
        for ts, gross, disc, tax, net in comp_rows:
            if ts is None:
                continue
            aware = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
            local_dt = aware.astimezone(MANILA_TZ)
            key = local_dt.strftime("%Y-%m") if granularity == "monthly" else local_dt.strftime("%Y-%m-%d")
            cur = completed_by_key.setdefault(
                key,
                [0, Decimal("0.00"), Decimal("0.00"), Decimal("0.00"), Decimal("0.00")],
            )
            cur[0] += 1
            cur[1] += _quantize_money(gross)
            cur[2] += _quantize_money(disc)
            cur[3] += _quantize_money(tax)
            cur[4] += _quantize_money(net)

        for (ts,) in db.execute(
            select(Order.ordered_at).where(Order.ordered_at >= start_utc, Order.ordered_at < end_utc)
        ).all():
            if ts is None:
                continue
            aware = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
            local_dt = aware.astimezone(MANILA_TZ)
            key = local_dt.strftime("%Y-%m") if granularity == "monthly" else local_dt.strftime("%Y-%m-%d")
            placed_by_key[key] += 1

    normalized_comp = {
        k: (v[0], _quantize_money(v[1]), _quantize_money(v[2]), _quantize_money(v[3]), _quantize_money(v[4]))
        for k, v in completed_by_key.items()
    }
    return normalized_comp, dict(placed_by_key)


def get_manager_report_overview(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    now: datetime | None = None,
) -> ManagerReportOverviewResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)

    cur_rev, cur_completed = _completed_period_summary(db, window.start_utc, window.end_utc)
    prev_rev, prev_completed = _completed_period_summary(db, window.prev_start_utc, window.prev_end_utc)

    cur_aov = _quantize_money(cur_rev / cur_completed) if cur_completed > 0 else Decimal("0.00")
    prev_aov = _quantize_money(prev_rev / prev_completed) if prev_completed > 0 else Decimal("0.00")

    cur_placed_map = _placed_counts_summary(db, window.start_utc, window.end_utc)
    prev_placed_map = _placed_counts_summary(db, window.prev_start_utc, window.prev_end_utc)
    cur_total_placed = sum(cur_placed_map.values())
    prev_total_placed = sum(prev_placed_map.values())
    placed_completed = cur_placed_map.get(OrderStatus.COMPLETED.value, 0)
    cancelled_orders = cur_placed_map.get(OrderStatus.CANCELLED.value, 0)
    pending_orders = sum(cur_placed_map.get(st, 0) for st in ACTIVE_ORDER_STATUSES)

    granularity: ReportGranularity = (
        "monthly" if (window.date_to - window.date_from).days + 1 > 62 else "daily"
    )
    buckets = _iter_buckets(window.date_from, window.date_to, granularity)
    comp_map, placed_map = _aggregate_daily_completed_and_placed(
        db, window.start_utc, window.end_utc, granularity
    )
    trend = [
        OverviewTrendPoint(
            date=b_key,
            label=b_lbl,
            tooltip_label=b_tip,
            recognized_revenue=comp_map[b_key][4] if b_key in comp_map else Decimal("0.00"),
            placed_orders=placed_map.get(b_key, 0),
            completed_orders=comp_map[b_key][0] if b_key in comp_map else 0,
        )
        for b_key, b_lbl, b_tip in buckets
    ]

    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    units_col = func.coalesce(func.sum(OrderItem.quantity), 0).label("units")
    val_col = func.coalesce(func.sum(OrderItem.line_total), 0).label("sales_val")
    dish_name_col = func.coalesce(func.max(MenuProduct.name), func.max(OrderItem.product_name)).label("dish_name")
    cat_name_col = func.coalesce(func.max(MenuCategory.name), "Uncategorized").label("cat_name")

    top_dish_rows = db.execute(
        select(OrderItem.menu_item_id, dish_name_col, cat_name_col, units_col, val_col)
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(MenuProduct, MenuProduct.id == OrderItem.menu_item_id)
        .outerjoin(MenuCategory, MenuCategory.id == MenuProduct.category_id)
        .where(
            Order.status == OrderStatus.COMPLETED.value,
            OrderItem.status != OrderStatus.CANCELLED.value,
            effective_ts >= window.start_utc,
            effective_ts < window.end_utc,
        )
        .group_by(OrderItem.menu_item_id)
        .order_by(units_col.desc(), val_col.desc(), OrderItem.menu_item_id.asc())
        .limit(5)
    ).all()

    top_dishes = [
        OverviewTopDishItem(
            product_id=int(pid),
            name=(dname or "").strip() or f"Menu Item #{int(pid)}",
            category_name=(cname or "Uncategorized").strip(),
            units_sold=int(units or 0),
            sales_value=_quantize_money(sval),
        )
        for pid, dname, cname, units, sval in top_dish_rows
    ]

    pm_rows = db.execute(
        select(
            func.coalesce(PaymentMethod.code, "unassigned"),
            func.coalesce(PaymentMethod.label, "Unrecorded Method"),
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .select_from(Order)
        .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
        .where(
            Order.status == OrderStatus.COMPLETED.value,
            Order.ordered_at >= window.start_utc,
            Order.ordered_at < window.end_utc,
        )
        .group_by(PaymentMethod.code, PaymentMethod.label)
        .order_by(func.coalesce(func.sum(Order.total_amount), 0).desc())
    ).all()

    payment_mix = [
        OverviewPaymentMethodItem(
            method_code=str(mcode),
            method_label=str(mlabel),
            settled_orders=int(cnt or 0),
            settled_revenue=_quantize_money(rev),
        )
        for mcode, mlabel, cnt, rev in pm_rows
    ]

    return ManagerReportOverviewResponse(
        window=window.to_meta(),
        recognized_revenue=_build_money_comparison(cur_rev, prev_rev),
        total_placed_orders=_build_count_comparison(cur_total_placed, prev_total_placed),
        completed_orders=_build_count_comparison(cur_completed, prev_completed),
        average_order_value=_build_money_comparison(cur_aov, prev_aov),
        cancelled_orders=cancelled_orders,
        pending_orders=pending_orders,
        completion_rate=_quantize_pct(placed_completed, cur_total_placed),
        trend=trend,
        top_dishes=top_dishes,
        payment_mix=payment_mix,
    )


def get_manager_sales_report(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    granularity: ReportGranularity = "daily",
    page: int = 1,
    page_size: int = 15,
    now: datetime | None = None,
) -> ManagerSalesReportResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)
    buckets = _iter_buckets(window.date_from, window.date_to, granularity)
    comp_map, _ = _aggregate_daily_completed_and_placed(
        db, window.start_utc, window.end_utc, granularity
    )

    series: list[SalesIntervalRow] = []
    gross_sales = Decimal("0.00")
    discount_total = Decimal("0.00")
    tax_total = Decimal("0.00")
    recognized_revenue = Decimal("0.00")
    qualifying_orders = 0

    for b_key, b_lbl, b_tip in buckets:
        cnt, gross, disc, tax, net = comp_map.get(
            b_key, (0, Decimal("0.00"), Decimal("0.00"), Decimal("0.00"), Decimal("0.00"))
        )
        gross_sales += gross
        discount_total += disc
        tax_total += tax
        recognized_revenue += net
        qualifying_orders += cnt
        aov = _quantize_money(net / cnt) if cnt > 0 else Decimal("0.00")
        series.append(
            SalesIntervalRow(
                bucket=b_key,
                label=b_lbl,
                tooltip_label=b_tip,
                qualifying_orders=cnt,
                gross_sales=gross,
                discount_total=disc,
                tax_total=tax,
                recognized_revenue=net,
                average_order_value=aov,
            )
        )

    voided_raw = db.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.status == OrderStatus.CANCELLED.value,
            Order.ordered_at >= window.start_utc,
            Order.ordered_at < window.end_utc,
        )
    )
    voided_amount = _quantize_money(voided_raw)

    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)
    cat_rows = db.execute(
        select(
            MenuCategory.id,
            func.coalesce(MenuCategory.name, "Uncategorized"),
            func.coalesce(func.sum(OrderItem.quantity), 0),
            func.coalesce(func.sum(OrderItem.line_total), 0),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(MenuProduct, MenuProduct.id == OrderItem.menu_item_id)
        .outerjoin(MenuCategory, MenuCategory.id == MenuProduct.category_id)
        .where(
            Order.status == OrderStatus.COMPLETED.value,
            OrderItem.status != OrderStatus.CANCELLED.value,
            effective_ts >= window.start_utc,
            effective_ts < window.end_utc,
        )
        .group_by(MenuCategory.id, MenuCategory.name)
        .order_by(func.coalesce(func.sum(OrderItem.line_total), 0).desc())
    ).all()

    total_cat_sales = sum((_quantize_money(r[3]) for r in cat_rows), Decimal("0.00"))
    category_breakdown = [
        SalesCategoryShareItem(
            category_id=int(cid) if cid is not None else None,
            category_name=str(cname),
            units_sold=int(units or 0),
            sales_value=_quantize_money(sval),
            share_pct=_quantize_pct(_quantize_money(sval), total_cat_sales),
        )
        for cid, cname, units, sval in cat_rows
    ]

    # Show newest intervals first in detailed sales ledger table
    reversed_ledger = list(reversed(series))
    total = len(reversed_ledger)
    start_idx = (page - 1) * page_size
    ledger_page = reversed_ledger[start_idx : start_idx + page_size]

    return ManagerSalesReportResponse(
        window=window.to_meta(),
        granularity=granularity,
        gross_sales=_quantize_money(gross_sales),
        discount_total=_quantize_money(discount_total),
        tax_total=_quantize_money(tax_total),
        recognized_revenue=_quantize_money(recognized_revenue),
        voided_amount=voided_amount,
        qualifying_orders=qualifying_orders,
        average_order_value=_quantize_money(recognized_revenue / qualifying_orders)
        if qualifying_orders > 0
        else Decimal("0.00"),
        series=series,
        category_breakdown=category_breakdown,
        ledger_items=ledger_page,
        page=page,
        page_size=page_size,
        total=total,
    )


def get_manager_orders_report(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    status_filter: str | None = None,
    order_type: str | None = None,
    page: int = 1,
    page_size: int = 15,
    now: datetime | None = None,
) -> ManagerOrdersReportResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)

    base_filters = [
        Order.ordered_at >= window.start_utc,
        Order.ordered_at < window.end_utc,
    ]
    if order_type and order_type.strip() and order_type != "all":
        base_filters.append(Order.order_type == order_type.strip())

    # Status & type aggregates over selected order_type cohort
    status_rows = db.execute(
        select(Order.status, func.count(Order.id))
        .where(*base_filters)
        .group_by(Order.status)
    ).all()
    counts_by_status = {str(st): int(cnt or 0) for st, cnt in status_rows if st}
    total_placed = sum(counts_by_status.values())
    completed_count = counts_by_status.get(OrderStatus.COMPLETED.value, 0)
    cancelled_count = counts_by_status.get(OrderStatus.CANCELLED.value, 0)
    active_pending_count = sum(counts_by_status.get(st, 0) for st in ACTIVE_ORDER_STATUSES)

    status_breakdown = [
        OrdersStatusBreakdownItem(
            status=st_enum.value,
            label=label,
            count=counts_by_status.get(st_enum.value, 0),
            share_pct=_quantize_pct(counts_by_status.get(st_enum.value, 0), total_placed),
        )
        for st_enum, label in ORDER_STATUS_LABELS
    ]

    type_rows = db.execute(
        select(Order.order_type, func.count(Order.id))
        .where(*base_filters)
        .group_by(Order.order_type)
        .order_by(func.count(Order.id).desc())
    ).all()
    type_labels = {"dine_in": "Dine-in", "takeout": "Takeout", "delivery": "Delivery", "pickup": "Pickup"}
    type_breakdown = [
        OrdersTypeBreakdownItem(
            order_type=str(otype),
            label=type_labels.get(str(otype), str(otype).replace("_", " ").title()),
            count=int(cnt or 0),
            share_pct=_quantize_pct(int(cnt or 0), total_placed),
        )
        for otype, cnt in type_rows
        if otype
    ]

    list_filters = list(base_filters)
    if status_filter and status_filter.strip() and status_filter != "all":
        list_filters.append(Order.status == status_filter.strip())

    # Weekday and Hourly buckets computed across the filtered cohort
    weekday_counts = [0] * 7
    hourly_counts = [0] * 24
    for (ordered_ts,) in db.execute(select(Order.ordered_at).where(*list_filters)).all():
        if ordered_ts is None:
            continue
        aware = ordered_ts.replace(tzinfo=timezone.utc) if ordered_ts.tzinfo is None else ordered_ts
        local_dt = aware.astimezone(MANILA_TZ)
        weekday_counts[local_dt.weekday()] += 1
        hourly_counts[local_dt.hour] += 1

    weekday_volume = [
        OrdersTimeBucketItem(key=str(idx), label=WEEKDAY_NAMES[idx], count=weekday_counts[idx])
        for idx in range(7)
    ]
    hourly_volume = [
        OrdersTimeBucketItem(key=f"{hr:02d}", label=f"{hr:02d}:00", count=hourly_counts[hr])
        for hr in range(24)
    ]

    total = db.scalar(select(func.count(Order.id)).where(*list_filters)) or 0
    order_rows = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.restaurant_table))
            .where(*list_filters)
            .order_by(Order.ordered_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    items = [
        ManagerOrderReportRow(
            id=order.id,
            order_number=order.order_number,
            status=order.status,
            order_type=order.order_type,
            fulfillment_destination=(
                order.restaurant_table.table_number
                if order.fulfillment_type == "table_service" and order.restaurant_table is not None
                else "Counter pickup"
            ),
            total_amount=_quantize_money(order.total_amount),
            ordered_at=order.ordered_at,
            completed_at=order.completed_at,
            cancelled_at=order.cancelled_at,
        )
        for order in order_rows
    ]

    return ManagerOrdersReportResponse(
        window=window.to_meta(),
        total_placed=total_placed,
        completed_count=completed_count,
        cancelled_count=cancelled_count,
        active_pending_count=active_pending_count,
        completion_rate=_quantize_pct(completed_count, total_placed),
        cancellation_rate=_quantize_pct(cancelled_count, total_placed),
        status_breakdown=status_breakdown,
        type_breakdown=type_breakdown,
        weekday_volume=weekday_volume,
        hourly_volume=hourly_volume,
        items=items,
        page=page,
        page_size=page_size,
        total=int(total),
    )


def get_manager_menu_report(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: int | None = None,
    search: str | None = None,
    sort_by: MenuSortBy = "units_sold",
    sort_dir: SortDirection = "desc",
    page: int = 1,
    page_size: int = 15,
    now: datetime | None = None,
) -> ManagerMenuReportResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)
    effective_ts = func.coalesce(Order.completed_at, Order.ordered_at)

    categories = [
        MenuCategoryOption(id=int(cat.id), name=cat.name)
        for cat in db.scalars(
            select(MenuCategory)
            .where(MenuCategory.is_active.is_(True))
            .order_by(MenuCategory.display_order, MenuCategory.name)
        )
    ]

    sales_rows = db.execute(
        select(
            OrderItem.menu_item_id,
            func.max(MenuProduct.name),
            func.max(OrderItem.product_name),
            MenuProduct.category_id,
            MenuCategory.name,
            MenuProduct.is_available,
            MenuProduct.deleted_at,
            func.coalesce(func.sum(OrderItem.quantity), 0),
            func.count(func.distinct(OrderItem.order_id)),
            func.coalesce(func.sum(OrderItem.line_total), 0),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(MenuProduct, MenuProduct.id == OrderItem.menu_item_id)
        .outerjoin(MenuCategory, MenuCategory.id == MenuProduct.category_id)
        .where(
            Order.status == OrderStatus.COMPLETED.value,
            OrderItem.status != OrderStatus.CANCELLED.value,
            effective_ts >= window.start_utc,
            effective_ts < window.end_utc,
        )
        .group_by(
            OrderItem.menu_item_id,
            MenuProduct.category_id,
            MenuCategory.name,
            MenuProduct.is_available,
            MenuProduct.deleted_at,
        )
    ).all()

    sold_by_id: dict[int, dict] = {}
    for pid, p_name, snap_name, cid, cname, is_avail, deleted_at, units, ord_cnt, sval in sales_rows:
        item_id = int(pid)
        resolved_name = (p_name or snap_name or "").strip() or f"Menu Item #{item_id}"
        sold_by_id[item_id] = {
            "product_id": item_id,
            "dish_name": resolved_name,
            "category_id": int(cid) if cid is not None else None,
            "category_name": (cname or "Uncategorized").strip(),
            "is_available": bool(is_avail) if is_avail is not None else False,
            "is_deleted": deleted_at is not None,
            "units_sold": int(units or 0),
            "order_count": int(ord_cnt or 0),
            "sales_value": _quantize_money(sval),
        }

    # Include zero-sale active products for low-volume operational visibility
    active_products = db.execute(
        select(
            MenuProduct.id,
            MenuProduct.name,
            MenuProduct.category_id,
            MenuCategory.name,
            MenuProduct.is_available,
        )
        .select_from(MenuProduct)
        .outerjoin(MenuCategory, MenuCategory.id == MenuProduct.category_id)
        .where(MenuProduct.deleted_at.is_(None))
    ).all()
    for pid, p_name, cid, cname, is_avail in active_products:
        item_id = int(pid)
        if item_id not in sold_by_id:
            sold_by_id[item_id] = {
                "product_id": item_id,
                "dish_name": p_name.strip(),
                "category_id": int(cid) if cid is not None else None,
                "category_name": (cname or "Uncategorized").strip(),
                "is_available": bool(is_avail),
                "is_deleted": False,
                "units_sold": 0,
                "order_count": 0,
                "sales_value": Decimal("0.00"),
            }

    all_records = list(sold_by_id.values())
    total_units_sold = sum(r["units_sold"] for r in all_records)
    total_item_sales_value = sum((r["sales_value"] for r in all_records), Decimal("0.00"))
    distinct_products_sold = sum(1 for r in all_records if r["units_sold"] > 0)

    # Category rollup strictly from sold records
    cat_agg: dict[tuple[int | None, str], dict] = {}
    for rec in all_records:
        if rec["units_sold"] <= 0:
            continue
        key = (rec["category_id"], rec["category_name"])
        bucket = cat_agg.setdefault(
            key,
            {
                "category_id": rec["category_id"],
                "category_name": rec["category_name"],
                "units_sold": 0,
                "order_count": 0,
                "sales_value": Decimal("0.00"),
            },
        )
        bucket["units_sold"] += rec["units_sold"]
        bucket["order_count"] += rec["order_count"]
        bucket["sales_value"] += rec["sales_value"]

    category_summary = [
        MenuCategorySummaryItem(
            category_id=b["category_id"],
            category_name=b["category_name"],
            units_sold=b["units_sold"],
            order_count=b["order_count"],
            sales_value=_quantize_money(b["sales_value"]),
            share_pct=_quantize_pct(b["sales_value"], total_item_sales_value),
        )
        for b in sorted(cat_agg.values(), key=lambda x: (-x["sales_value"], -x["units_sold"], x["category_name"]))
    ]

    def _to_item(rec: dict) -> MenuPerformanceItem:
        return MenuPerformanceItem(
            product_id=rec["product_id"],
            dish_name=rec["dish_name"],
            category_id=rec["category_id"],
            category_name=rec["category_name"],
            is_available=rec["is_available"],
            is_deleted=rec["is_deleted"],
            units_sold=rec["units_sold"],
            order_count=rec["order_count"],
            sales_value=rec["sales_value"],
            share_pct=_quantize_pct(rec["sales_value"], total_item_sales_value),
        )

    top_selling = [
        _to_item(r)
        for r in sorted(
            (r for r in all_records if r["units_sold"] > 0),
            key=lambda x: (-x["units_sold"], -x["sales_value"], x["product_id"]),
        )[:8]
    ]
    lowest_active = [
        _to_item(r)
        for r in sorted(
            (r for r in all_records if not r["is_deleted"] and r["is_available"]),
            key=lambda x: (x["units_sold"], x["sales_value"], x["product_id"]),
        )[:5]
    ]

    filtered = all_records
    if category_id is not None:
        filtered = [r for r in filtered if r["category_id"] == category_id]
    if search and search.strip():
        q = search.strip().lower()
        filtered = [
            r for r in filtered
            if q in r["dish_name"].lower() or q in r["category_name"].lower()
        ]

    reverse = sort_dir == "desc"
    if sort_by == "name":
        filtered.sort(key=lambda x: (x["dish_name"].lower(), x["product_id"]), reverse=reverse)
    elif sort_by == "sales_value":
        filtered.sort(
            key=lambda x: (x["sales_value"], x["units_sold"], -x["product_id"] if reverse else x["product_id"]),
            reverse=reverse,
        )
    elif sort_by == "order_count":
        filtered.sort(
            key=lambda x: (x["order_count"], x["units_sold"], -x["product_id"] if reverse else x["product_id"]),
            reverse=reverse,
        )
    else:
        filtered.sort(
            key=lambda x: (x["units_sold"], x["sales_value"], -x["product_id"] if reverse else x["product_id"]),
            reverse=reverse,
        )

    total = len(filtered)
    start_idx = (page - 1) * page_size
    paginated_items = [_to_item(r) for r in filtered[start_idx : start_idx + page_size]]

    return ManagerMenuReportResponse(
        window=window.to_meta(),
        total_units_sold=total_units_sold,
        total_item_sales_value=_quantize_money(total_item_sales_value),
        distinct_products_sold=distinct_products_sold,
        categories=categories,
        category_summary=category_summary,
        top_selling_dishes=top_selling,
        lowest_selling_active_dishes=lowest_active,
        items=paginated_items,
        page=page,
        page_size=page_size,
        total=total,
    )


def _derive_settlement(order_status: str) -> Literal["settled", "pending", "voided"]:
    if order_status == OrderStatus.COMPLETED.value:
        return "settled"
    if order_status == OrderStatus.CANCELLED.value:
        return "voided"
    return "pending"


def get_manager_payments_report(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    settlement: Literal["all", "settled", "pending", "voided"] = "all",
    method_code: str | None = None,
    page: int = 1,
    page_size: int = 15,
    now: datetime | None = None,
) -> ManagerPaymentsReportResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)
    base_filters = [
        Order.ordered_at >= window.start_utc,
        Order.ordered_at < window.end_utc,
    ]
    if method_code and method_code.strip() and method_code != "all":
        if method_code == "unassigned":
            base_filters.append(Order.payment_method_id.is_(None))
        else:
            base_filters.append(PaymentMethod.code == method_code.strip().lower())

    agg_rows = db.execute(
        select(
            PaymentMethod.id,
            PaymentMethod.code,
            PaymentMethod.label,
            Order.status,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .select_from(Order)
        .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
        .where(*base_filters)
        .group_by(PaymentMethod.id, PaymentMethod.code, PaymentMethod.label, Order.status)
    ).all()

    settled_rev = Decimal("0.00")
    settled_cnt = 0
    pending_rev = Decimal("0.00")
    pending_cnt = 0
    voided_rev = Decimal("0.00")
    voided_cnt = 0
    by_method: dict[str, dict] = {}

    for mid, mcode, mlabel, st, cnt, total_sum in agg_rows:
        c = int(cnt or 0)
        amt = _quantize_money(total_sum)
        key = mcode or "unassigned"
        entry = by_method.setdefault(
            key,
            {
                "method_id": int(mid) if mid is not None else None,
                "method_code": key,
                "method_label": mlabel or "Unrecorded Method",
                "settled_count": 0,
                "pending_count": 0,
                "voided_count": 0,
                "settled_revenue": Decimal("0.00"),
                "pending_revenue": Decimal("0.00"),
                "voided_revenue": Decimal("0.00"),
            },
        )
        if st == OrderStatus.COMPLETED.value:
            settled_rev += amt
            settled_cnt += c
            entry["settled_count"] += c
            entry["settled_revenue"] += amt
        elif st == OrderStatus.CANCELLED.value:
            voided_rev += amt
            voided_cnt += c
            entry["voided_count"] += c
            entry["voided_revenue"] += amt
        else:
            pending_rev += amt
            pending_cnt += c
            entry["pending_count"] += c
            entry["pending_revenue"] += amt

    method_breakdown = [
        PaymentsMethodSummaryRow(
            **item,
            share_pct=_quantize_pct(item["settled_revenue"], settled_rev),
        )
        for item in sorted(
            by_method.values(),
            key=lambda x: (-x["settled_revenue"], -x["pending_revenue"], x["method_label"]),
        )
    ]

    row_filters = list(base_filters)
    if settlement == "settled":
        row_filters.append(Order.status == OrderStatus.COMPLETED.value)
    elif settlement == "voided":
        row_filters.append(Order.status == OrderStatus.CANCELLED.value)
    elif settlement == "pending":
        row_filters.append(Order.status.in_(ACTIVE_ORDER_STATUSES))

    total = db.scalar(
        select(func.count(Order.id))
        .select_from(Order)
        .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
        .where(*row_filters)
    ) or 0

    orders = list(
        db.scalars(
            select(Order)
            .outerjoin(PaymentMethod, PaymentMethod.id == Order.payment_method_id)
            .options(selectinload(Order.payment_method))
            .where(*row_filters)
            .order_by(Order.ordered_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )

    items = [
        PaymentsTransactionReportRow(
            order_id=order.id,
            order_number=order.order_number,
            method_code=order.payment_method.code if order.payment_method else None,
            method_label=order.payment_method.label if order.payment_method else "Unrecorded Method",
            order_type=order.order_type,
            order_status=order.status,
            settlement_state=_derive_settlement(order.status),
            subtotal=_quantize_money(order.subtotal),
            discount_amount=_quantize_money(order.discount_amount),
            tax_amount=_quantize_money(order.tax_amount),
            total_amount=_quantize_money(order.total_amount),
            ordered_at=order.ordered_at,
            completed_at=order.completed_at,
        )
        for order in orders
    ]

    non_voided_total = settled_rev + pending_rev
    return ManagerPaymentsReportResponse(
        window=window.to_meta(),
        settled_revenue=_quantize_money(settled_rev),
        settled_count=settled_cnt,
        pending_revenue=_quantize_money(pending_rev),
        pending_count=pending_cnt,
        voided_revenue=_quantize_money(voided_rev),
        voided_count=voided_cnt,
        collection_rate_pct=_quantize_pct(settled_rev, non_voided_total),
        method_breakdown=method_breakdown,
        items=items,
        page=page,
        page_size=page_size,
        total=int(total),
    )


def get_manager_inventory_report(
    db: Session,
    *,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    transaction_type: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 15,
    now: datetime | None = None,
) -> ManagerInventoryReportResponse:
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)

    active_items = list(
        db.scalars(
            select(InventoryItem)
            .where(InventoryItem.deleted_at.is_(None), InventoryItem.is_active.is_(True))
            .order_by(InventoryItem.name.asc())
        )
    )
    normal_cnt = 0
    low_cnt = 0
    out_cnt = 0
    items_by_id: dict[int, InventoryItem] = {}
    for item in active_items:
        items_by_id[item.id] = item
        if item.current_stock <= 0:
            out_cnt += 1
        elif item.current_stock <= item.reorder_level:
            low_cnt += 1
        else:
            normal_cnt += 1

    # Movement aggregation inside window by item + transaction_type (preserves native units)
    tx_agg = db.execute(
        select(
            InventoryTransaction.inventory_item_id,
            InventoryTransaction.transaction_type,
            func.coalesce(func.sum(InventoryTransaction.quantity_change), 0),
        )
        .where(
            InventoryTransaction.created_at >= window.start_utc,
            InventoryTransaction.created_at < window.end_utc,
        )
        .group_by(InventoryTransaction.inventory_item_id, InventoryTransaction.transaction_type)
    ).all()

    movement_stats: dict[int, dict[str, Decimal]] = defaultdict(
        lambda: {
            "consumed": Decimal("0.000"),
            "restocked": Decimal("0.000"),
            "waste": Decimal("0.000"),
            "returned": Decimal("0.000"),
            "adjusted": Decimal("0.000"),
        }
    )
    for iid, ttype, qty_sum in tx_agg:
        st = movement_stats[int(iid)]
        val = _quantize_qty(qty_sum)
        if ttype == "sale":
            st["consumed"] += abs(val)
        elif ttype == "purchase":
            st["restocked"] += val
        elif ttype == "waste":
            st["waste"] += abs(val)
        elif ttype == "return":
            st["returned"] += val
        else:
            st["adjusted"] += val

    search_q = search.strip().lower() if search and search.strip() else ""
    item_summaries: list[InventoryItemMovementRow] = []
    for item in active_items:
        if search_q and search_q not in item.name.lower() and not (item.sku and search_q in item.sku.lower()):
            continue
        st = movement_stats[item.id]
        status_str = "out_of_stock" if item.current_stock <= 0 else ("low_stock" if item.current_stock <= item.reorder_level else "normal")
        item_summaries.append(
            InventoryItemMovementRow(
                inventory_item_id=item.id,
                name=item.name,
                sku=item.sku,
                unit=item.unit,
                current_stock=_quantize_qty(item.current_stock),
                reorder_level=_quantize_qty(item.reorder_level),
                stock_status=status_str,
                consumed_qty=_quantize_qty(st["consumed"]),
                restocked_qty=_quantize_qty(st["restocked"]),
                waste_qty=_quantize_qty(st["waste"]),
                returned_qty=_quantize_qty(st["returned"]),
                adjusted_qty=_quantize_qty(st["adjusted"]),
            )
        )

    item_summaries.sort(key=lambda r: (-r.consumed_qty, r.current_stock, r.name))
    top_consumed = [
        InventoryTopConsumedItem(
            inventory_item_id=r.inventory_item_id,
            name=r.name,
            unit=r.unit,
            consumed_qty=r.consumed_qty,
            current_stock=r.current_stock,
        )
        for r in sorted((r for r in item_summaries if r.consumed_qty > 0), key=lambda x: (-x.consumed_qty, x.name))[:8]
    ]

    ledger_filters = [
        InventoryTransaction.created_at >= window.start_utc,
        InventoryTransaction.created_at < window.end_utc,
    ]
    if transaction_type and transaction_type.strip() and transaction_type != "all":
        ledger_filters.append(InventoryTransaction.transaction_type == transaction_type.strip())
    if search_q:
        pattern = f"%{_escape_like(search.strip())}%"
        ledger_filters.append(
            or_(
                InventoryItem.name.ilike(pattern, escape="\\"),
                InventoryTransaction.notes.ilike(pattern, escape="\\"),
            )
        )

    total_movements_count = int(
        db.scalar(
            select(func.count(InventoryTransaction.id)).where(
                InventoryTransaction.created_at >= window.start_utc,
                InventoryTransaction.created_at < window.end_utc,
            )
        )
        or 0
    )

    total = int(
        db.scalar(
            select(func.count(InventoryTransaction.id))
            .select_from(InventoryTransaction)
            .join(InventoryItem, InventoryItem.id == InventoryTransaction.inventory_item_id)
            .where(*ledger_filters)
        )
        or 0
    )

    tx_rows = db.execute(
        select(InventoryTransaction, InventoryItem.name, InventoryItem.unit)
        .join(InventoryItem, InventoryItem.id == InventoryTransaction.inventory_item_id)
        .where(*ledger_filters)
        .order_by(InventoryTransaction.created_at.desc(), InventoryTransaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    ledger_items = [
        InventoryTransactionLedgerRow(
            id=tx.id,
            inventory_item_id=tx.inventory_item_id,
            item_name=iname,
            unit=iunit,
            transaction_type=tx.transaction_type,
            quantity_change=_quantize_qty(tx.quantity_change),
            reference_type=tx.reference_type,
            reference_id=tx.reference_id,
            notes=tx.notes,
            created_at=tx.created_at,
        )
        for tx, iname, iunit in tx_rows
    ]

    return ManagerInventoryReportResponse(
        window=window.to_meta(),
        cost_reporting_supported=False,
        profitability_note=(
            "Quantity-only operational tracking: dish COGS, food cost percentage, and net profit margins are "
            "not calculated because historical order-item cost snapshots and labor/overhead ledgers are not recorded."
        ),
        active_items_count=len(active_items),
        normal_stock_count=normal_cnt,
        low_stock_count=low_cnt,
        out_of_stock_count=out_cnt,
        total_movements_count=total_movements_count,
        top_consumed_items=top_consumed,
        item_summaries=item_summaries,
        ledger_items=ledger_items,
        page=page,
        page_size=page_size,
        total=total,
    )


def generate_report_csv(
    db: Session,
    *,
    report_type: ReportExportType,
    preset: ReportDatePreset = "last_30_days",
    date_from: date | None = None,
    date_to: date | None = None,
    granularity: ReportGranularity = "daily",
    status_filter: str | None = None,
    order_type: str | None = None,
    category_id: int | None = None,
    search: str | None = None,
    sort_by: MenuSortBy = "units_sold",
    sort_dir: SortDirection = "desc",
    settlement: Literal["all", "settled", "pending", "voided"] = "all",
    method_code: str | None = None,
    transaction_type: str | None = None,
    now: datetime | None = None,
) -> tuple[str, str]:
    """Generate formula-safe CSV matching the exact visible report filters & definitions."""
    window = resolve_report_window(preset, date_from=date_from, date_to=date_to, now=now)
    filename = f"savorybites-{report_type}-report-{window.date_from.isoformat()}-to-{window.date_to.isoformat()}.csv"

    buf = io.StringIO()
    writer = csv.writer(buf)

    if report_type == "sales":
        data = get_manager_sales_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            granularity=granularity,
            page=1,
            page_size=MAX_CSV_ROWS,
            now=now,
        )
        writer.writerow([
            "Interval",
            "Period Label",
            "Qualifying Orders",
            "Gross Sales (PHP)",
            "Discounts (PHP)",
            "Tax (PHP)",
            "Recognized Revenue (PHP)",
            "Average Order Value (PHP)",
        ])
        for row in data.ledger_items:
            writer.writerow([
                sanitize_csv_cell(row.bucket),
                sanitize_csv_cell(row.tooltip_label),
                row.qualifying_orders,
                f"{row.gross_sales:.2f}",
                f"{row.discount_total:.2f}",
                f"{row.tax_total:.2f}",
                f"{row.recognized_revenue:.2f}",
                f"{row.average_order_value:.2f}",
            ])
    elif report_type == "orders":
        data = get_manager_orders_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            status_filter=status_filter,
            order_type=order_type,
            page=1,
            page_size=MAX_CSV_ROWS,
            now=now,
        )
        writer.writerow([
            "Order Number",
            "Status",
            "Order Type",
            "Destination",
            "Total Amount (PHP)",
            "Ordered At (Asia/Manila)",
            "Completed At (Asia/Manila)",
            "Cancelled At (Asia/Manila)",
        ])
        for row in data.items:
            writer.writerow([
                sanitize_csv_cell(row.order_number),
                sanitize_csv_cell(row.status),
                sanitize_csv_cell(row.order_type),
                sanitize_csv_cell(row.fulfillment_destination),
                f"{row.total_amount:.2f}",
                _to_manila_iso(row.ordered_at),
                _to_manila_iso(row.completed_at),
                _to_manila_iso(row.cancelled_at),
            ])
    elif report_type == "menu":
        data = get_manager_menu_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            category_id=category_id,
            search=search,
            sort_by=sort_by,
            sort_dir=sort_dir,
            page=1,
            page_size=MAX_CSV_ROWS,
            now=now,
        )
        writer.writerow([
            "Product ID",
            "Dish Name",
            "Category",
            "Catalog Status",
            "Units Sold",
            "Order Count",
            "Sales Value (PHP)",
            "Share of Item Sales (%)",
        ])
        for row in data.items:
            cat_status = "Archived" if row.is_deleted else ("Available" if row.is_available else "Unavailable")
            writer.writerow([
                row.product_id,
                sanitize_csv_cell(row.dish_name),
                sanitize_csv_cell(row.category_name),
                cat_status,
                row.units_sold,
                row.order_count,
                f"{row.sales_value:.2f}",
                f"{row.share_pct:.1f}",
            ])
    elif report_type == "payments":
        data = get_manager_payments_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            settlement=settlement,
            method_code=method_code,
            page=1,
            page_size=MAX_CSV_ROWS,
            now=now,
        )
        writer.writerow([
            "Order Number",
            "Payment Method",
            "Order Type",
            "Order Status",
            "Settlement State",
            "Subtotal (PHP)",
            "Discount (PHP)",
            "Tax (PHP)",
            "Total Amount (PHP)",
            "Ordered At (Asia/Manila)",
            "Completed At (Asia/Manila)",
        ])
        for row in data.items:
            writer.writerow([
                sanitize_csv_cell(row.order_number),
                sanitize_csv_cell(row.method_label),
                sanitize_csv_cell(row.order_type),
                sanitize_csv_cell(row.order_status),
                sanitize_csv_cell(row.settlement_state),
                f"{row.subtotal:.2f}",
                f"{row.discount_amount:.2f}",
                f"{row.tax_amount:.2f}",
                f"{row.total_amount:.2f}",
                _to_manila_iso(row.ordered_at),
                _to_manila_iso(row.completed_at),
            ])
    else:
        data = get_manager_inventory_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            transaction_type=transaction_type,
            search=search,
            page=1,
            page_size=MAX_CSV_ROWS,
            now=now,
        )
        writer.writerow([
            "Timestamp (Asia/Manila)",
            "Ingredient",
            "Unit",
            "Transaction Type",
            "Quantity Change",
            "Reference Type",
            "Reference ID",
            "Notes",
        ])
        for row in data.ledger_items:
            writer.writerow([
                _to_manila_iso(row.created_at),
                sanitize_csv_cell(row.item_name),
                sanitize_csv_cell(row.unit),
                sanitize_csv_cell(row.transaction_type),
                f"{row.quantity_change:.3f}",
                sanitize_csv_cell(row.reference_type),
                row.reference_id if row.reference_id is not None else "",
                sanitize_csv_cell(row.notes),
            ])

    return filename, buf.getvalue()
