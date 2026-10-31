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

    @field_validator("payment_method_code")
    @classmethod
    def normalize_payment_method_code(cls, code: str):
        return code.strip().lower()

    @field_validator("restaurant_table_id")
    @classmethod
    def validate_table_id(cls, table_id: int | None):
        return table_id


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
    total: Decimal
    ordered_at: datetime
    item_count: int


class OrderHistoryResponse(BaseModel):
    items: list[OrderHistoryItemResponse]
    page: int
    page_size: int
    total: int
