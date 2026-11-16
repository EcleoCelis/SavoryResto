from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

RevenuePeriod = Literal["last_7_days", "last_30_days", "last_12_months"]
OrderStatusLiteral = Literal[
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "completed",
    "cancelled",
]


class RevenueTrendPoint(BaseModel):
    date: str
    label: str
    tooltip_label: str
    revenue: Decimal
    order_count: int


class RevenueTrendResponse(BaseModel):
    period: RevenuePeriod
    currency: str = "PHP"
    timezone: str = "Asia/Manila"
    metric_basis: str = "completed_orders"
    total_revenue: Decimal
    total_orders: int
    data: list[RevenueTrendPoint]


class OrderDistributionItem(BaseModel):
    status: OrderStatusLiteral
    label: str
    count: int


class OrderDistributionResponse(BaseModel):
    period: RevenuePeriod
    timezone: str = "Asia/Manila"
    cohort_basis: str = "orders_placed"
    total_orders: int
    distribution: list[OrderDistributionItem]


class TopSellingDishItem(BaseModel):
    product_id: int
    name: str
    units_sold: int
    revenue: Decimal


class TopSellingDishesResponse(BaseModel):
    period: RevenuePeriod
    timezone: str = "Asia/Manila"
    metric: str = "units_sold"
    metric_basis: str = "completed_orders"
    items: list[TopSellingDishItem]


class OrderVolumePoint(BaseModel):
    date: str
    label: str
    tooltip_label: str
    orders: int


class OrderVolumeResponse(BaseModel):
    period: RevenuePeriod
    timezone: str = "Asia/Manila"
    metric: str = "orders_placed"
    total_orders: int
    data: list[OrderVolumePoint]


class KpiSummaryResponse(BaseModel):
    period: RevenuePeriod
    currency: str = "PHP"
    timezone: str = "Asia/Manila"
    total_revenue: Decimal
    total_orders: int
    completed_orders: int
    placed_completed_orders: int
    completion_rate: Decimal
    average_order_value: Decimal


class OperationalAlertsResponse(BaseModel):
    ready_orders_count: int
    pending_orders_count: int
    low_stock_count: int
    out_of_stock_count: int
    low_stock_names: list[str]
