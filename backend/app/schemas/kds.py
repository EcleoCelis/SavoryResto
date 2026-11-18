from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.core.order_status import OrderStatus


class KdsOrderItemResponse(BaseModel):
    name: str
    quantity: int
    size: str | None
    addons: list[str]


class KdsOrderResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    fulfillment_destination: str
    ordered_at: datetime
    allergy_alert: str | None = None
    notes: str | None = None
    items: list[KdsOrderItemResponse]


class KdsStatusUpdateRequest(BaseModel):
    status: OrderStatus
    cancellation_reason: str | None = Field(default=None, max_length=500)
    expected_updated_at: datetime | None = None


class ManagerOrderItemDetailResponse(BaseModel):
    id: int
    menu_item_id: int
    name: str
    quantity: int
    size: str | None
    addons: list[str]
    unit_price: Decimal
    discount_amount: Decimal
    line_total: Decimal
    status: str
    special_instructions: str | None = None


class ManagerOrderStatusCounts(BaseModel):
    all: int
    active: int
    pending: int
    confirmed: int
    preparing: int
    ready: int
    completed: int
    cancelled: int


class ManagerOrderSummaryResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    fulfillment_destination: str
    customer_id: int
    customer_name: str
    customer_email: str | None = None
    payment_method_label: str | None = None
    item_count: int
    total_amount: Decimal
    ordered_at: datetime
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    allergy_alert: str | None = None


class ManagerOrderListResponse(BaseModel):
    items: list[ManagerOrderSummaryResponse]
    status_counts: ManagerOrderStatusCounts
    page: int
    page_size: int
    total: int


class ManagerOrderDetailResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    fulfillment_destination: str
    table_number: str | None = None
    customer_id: int
    customer_name: str
    customer_email: str | None = None
    customer_phone: str | None = None
    payment_method_code: str | None = None
    payment_method_label: str | None = None
    delivery_address_snapshot: dict[str, Any] | None = None
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    allergy_alert: str | None = None
    notes: str | None = None
    cancellation_reason: str | None = None
    ordered_at: datetime
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    updated_at: datetime
    can_complete: bool
    can_cancel: bool
    items: list[ManagerOrderItemDetailResponse]
