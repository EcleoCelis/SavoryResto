from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.order_status import OrderStatus
from app.schemas.checkout import CheckoutQuoteRequest
from app.schemas.payment_method import PaymentMethodResponse


class PlaceOrderRequest(CheckoutQuoteRequest):
    order_type: Literal["dine_in", "takeout"]
    fulfillment_type: Literal["table_service", "counter_pickup"]
    restaurant_table_id: int | None = Field(default=None, gt=0)
    payment_method_code: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    selected_address_id: int | None = Field(default=None, gt=0)
    include_allergy_alert: bool = True
    preparation_notes: str | None = Field(default=None, max_length=300)

    @field_validator("payment_method_code")
    @classmethod
    def normalize_payment_method_code(cls, code: str):
        return code.strip().lower()

    @field_validator("restaurant_table_id")
    @classmethod
    def validate_table_id(cls, table_id: int | None):
        return table_id

    @field_validator("preparation_notes")
    @classmethod
    def normalize_notes(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class OrderItemResponse(BaseModel):
    product_id: int
    name: str
    size: str | None
    addons: list[str]
    quantity: int
    unit_price: Decimal
    subtotal: Decimal


class OrderResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    table_number: str | None
    customer_id: int
    subtotal: Decimal
    total: Decimal
    payment_method: PaymentMethodResponse | None
    delivery_address_snapshot: dict | None = None
    kitchen_allergy_alert: str | None = None
    notes: str | None = None
    ordered_at: datetime
    completed_at: datetime | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    is_cancellable: bool
    items: list[OrderItemResponse]


class CancelOrderRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, reason: str | None):
        if reason is None:
            return None
        normalized = reason.strip()
        return normalized or None


class OrderHistoryItemResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    table_number: str | None
    payment_method_label: str | None = None
    total: Decimal
    ordered_at: datetime
    item_count: int


class OrderHistoryResponse(BaseModel):
    items: list[OrderHistoryItemResponse]
    page: int
    page_size: int
    total: int


class ReorderAvailableItemResponse(BaseModel):
    product_id: int
    name: str
    image_url: str | None
    size: str
    addons: list[str]
    quantity: int
    current_unit_price: Decimal
    previous_unit_price: Decimal
    price_changed: bool


class ReorderUnavailableItemResponse(BaseModel):
    product_id: int
    name: str
    reason: str


class ReorderPreviewResponse(BaseModel):
    order_id: int
    order_number: str
    available_items: list[ReorderAvailableItemResponse]
    unavailable_items: list[ReorderUnavailableItemResponse]
    has_price_changes: bool
