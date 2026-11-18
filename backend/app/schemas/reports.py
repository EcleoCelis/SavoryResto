from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

ReportDatePreset = Literal[
    "today",
    "yesterday",
    "last_7_days",
    "last_30_days",
    "this_month",
    "last_month",
    "custom",
]

ReportGranularity = Literal["daily", "monthly"]
ReportExportType = Literal["sales", "orders", "menu", "payments", "inventory"]
MenuSortBy = Literal["units_sold", "sales_value", "order_count", "name"]
SortDirection = Literal["asc", "desc"]


class ReportWindowMeta(BaseModel):
    preset: ReportDatePreset
    date_from: date
    date_to: date
    previous_date_from: date
    previous_date_to: date
    timezone: str = "Asia/Manila"
    currency: str = "PHP"


class ComparisonMetric(BaseModel):
    current: Decimal
    previous: Decimal
    delta: Decimal
    change_pct: Decimal | None = Field(
        default=None,
        description="Percentage change vs previous equivalent window; null when previous value is 0.",
    )


class ComparisonCountMetric(BaseModel):
    current: int
    previous: int
    delta: int
    change_pct: Decimal | None = Field(
        default=None,
        description="Percentage change vs previous equivalent window; null when previous value is 0.",
    )


class OverviewTrendPoint(BaseModel):
    date: str
    label: str
    tooltip_label: str
    recognized_revenue: Decimal
    placed_orders: int
    completed_orders: int


class OverviewTopDishItem(BaseModel):
    product_id: int
    name: str
    category_name: str
    units_sold: int
    sales_value: Decimal


class OverviewPaymentMethodItem(BaseModel):
    method_code: str
    method_label: str
    settled_orders: int
    settled_revenue: Decimal


class ManagerReportOverviewResponse(BaseModel):
    window: ReportWindowMeta
    recognized_revenue: ComparisonMetric
    total_placed_orders: ComparisonCountMetric
    completed_orders: ComparisonCountMetric
    average_order_value: ComparisonMetric
    cancelled_orders: int
    pending_orders: int
    completion_rate: Decimal
    trend: list[OverviewTrendPoint]
    top_dishes: list[OverviewTopDishItem]
    payment_mix: list[OverviewPaymentMethodItem]


class SalesIntervalRow(BaseModel):
    bucket: str
    label: str
    tooltip_label: str
    qualifying_orders: int
    gross_sales: Decimal
    discount_total: Decimal
    tax_total: Decimal
    recognized_revenue: Decimal
    average_order_value: Decimal


class SalesCategoryShareItem(BaseModel):
    category_id: int | None
    category_name: str
    units_sold: int
    sales_value: Decimal
    share_pct: Decimal


class ManagerSalesReportResponse(BaseModel):
    window: ReportWindowMeta
    granularity: ReportGranularity
    metric_basis: str = "completed_orders_effective_timestamp"
    gross_sales: Decimal
    discount_total: Decimal
    tax_total: Decimal
    recognized_revenue: Decimal
    voided_amount: Decimal
    qualifying_orders: int
    average_order_value: Decimal
    series: list[SalesIntervalRow]
    category_breakdown: list[SalesCategoryShareItem]
    ledger_items: list[SalesIntervalRow]
    page: int
    page_size: int
    total: int


class OrdersStatusBreakdownItem(BaseModel):
    status: str
    label: str
    count: int
    share_pct: Decimal


class OrdersTypeBreakdownItem(BaseModel):
    order_type: str
    label: str
    count: int
    share_pct: Decimal


class OrdersTimeBucketItem(BaseModel):
    key: str
    label: str
    count: int


class ManagerOrderReportRow(BaseModel):
    id: int
    order_number: str
    status: str
    order_type: str
    fulfillment_destination: str
    total_amount: Decimal
    ordered_at: datetime
    completed_at: datetime | None
    cancelled_at: datetime | None


class ManagerOrdersReportResponse(BaseModel):
    window: ReportWindowMeta
    cohort_basis: str = "orders_placed_ordered_at"
    total_placed: int
    completed_count: int
    cancelled_count: int
    active_pending_count: int
    completion_rate: Decimal
    cancellation_rate: Decimal
    status_breakdown: list[OrdersStatusBreakdownItem]
    type_breakdown: list[OrdersTypeBreakdownItem]
    weekday_volume: list[OrdersTimeBucketItem]
    hourly_volume: list[OrdersTimeBucketItem]
    items: list[ManagerOrderReportRow]
    page: int
    page_size: int
    total: int


class MenuPerformanceItem(BaseModel):
    product_id: int
    dish_name: str
    category_id: int | None
    category_name: str
    is_available: bool
    is_deleted: bool
    units_sold: int
    order_count: int
    sales_value: Decimal
    share_pct: Decimal


class MenuCategoryOption(BaseModel):
    id: int
    name: str


class MenuCategorySummaryItem(BaseModel):
    category_id: int | None
    category_name: str
    units_sold: int
    order_count: int
    sales_value: Decimal
    share_pct: Decimal


class ManagerMenuReportResponse(BaseModel):
    window: ReportWindowMeta
    metric_basis: str = "completed_order_items_excluding_cancelled"
    total_units_sold: int
    total_item_sales_value: Decimal
    distinct_products_sold: int
    categories: list[MenuCategoryOption]
    category_summary: list[MenuCategorySummaryItem]
    top_selling_dishes: list[MenuPerformanceItem]
    lowest_selling_active_dishes: list[MenuPerformanceItem]
    items: list[MenuPerformanceItem]
    page: int
    page_size: int
    total: int


class PaymentsMethodSummaryRow(BaseModel):
    method_id: int | None
    method_code: str
    method_label: str
    settled_count: int
    pending_count: int
    voided_count: int
    settled_revenue: Decimal
    pending_revenue: Decimal
    voided_revenue: Decimal
    share_pct: Decimal


class PaymentsTransactionReportRow(BaseModel):
    order_id: int
    order_number: str
    method_code: str | None
    method_label: str
    order_type: str
    order_status: str
    settlement_state: Literal["settled", "pending", "voided"]
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    ordered_at: datetime
    completed_at: datetime | None


class ManagerPaymentsReportResponse(BaseModel):
    window: ReportWindowMeta
    reconciliation_basis: str = "orders_placed_ordered_at"
    settled_revenue: Decimal
    settled_count: int
    pending_revenue: Decimal
    pending_count: int
    voided_revenue: Decimal
    voided_count: int
    collection_rate_pct: Decimal
    method_breakdown: list[PaymentsMethodSummaryRow]
    items: list[PaymentsTransactionReportRow]
    page: int
    page_size: int
    total: int


class InventoryTopConsumedItem(BaseModel):
    inventory_item_id: int
    name: str
    unit: str
    consumed_qty: Decimal
    current_stock: Decimal


class InventoryItemMovementRow(BaseModel):
    inventory_item_id: int
    name: str
    sku: str | None
    unit: str
    current_stock: Decimal
    reorder_level: Decimal
    stock_status: str
    consumed_qty: Decimal
    restocked_qty: Decimal
    waste_qty: Decimal
    returned_qty: Decimal
    adjusted_qty: Decimal


class InventoryTransactionLedgerRow(BaseModel):
    id: int
    inventory_item_id: int
    item_name: str
    unit: str
    transaction_type: str
    quantity_change: Decimal
    reference_type: str | None
    reference_id: int | None
    notes: str | None
    created_at: datetime


class ManagerInventoryReportResponse(BaseModel):
    window: ReportWindowMeta
    cost_reporting_supported: bool = False
    profitability_note: str
    active_items_count: int
    normal_stock_count: int
    low_stock_count: int
    out_of_stock_count: int
    total_movements_count: int
    top_consumed_items: list[InventoryTopConsumedItem]
    item_summaries: list[InventoryItemMovementRow]
    ledger_items: list[InventoryTransactionLedgerRow]
    page: int
    page_size: int
    total: int
