from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PaymentMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    label: str
    description: str | None


class ManagerPaymentMethodSummary(BaseModel):
    id: int
    code: str
    label: str
    description: str | None
    is_active: bool
    display_order: int
    orders_count: int
    collected_revenue: Decimal
    created_at: datetime
    updated_at: datetime


class ManagerPaymentMethodCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool = True
    display_order: int = Field(default=0, ge=0, le=9999)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Payment method label cannot be blank.")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ManagerPaymentMethodUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None
    display_order: int | None = Field(default=None, ge=0, le=9999)
    expected_updated_at: datetime | None = None

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Payment method label cannot be blank.")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class PaymentMethodBreakdownItem(BaseModel):
    method_id: int | None
    method_code: str
    method_label: str
    orders_count: int
    completed_count: int
    collected_revenue: Decimal
    pending_revenue: Decimal


class PaymentTransactionItem(BaseModel):
    order_id: int
    order_number: str
    customer_name: str
    customer_email: str | None = None
    order_type: str
    fulfillment_destination: str
    payment_method_code: str | None = None
    payment_method_label: str
    order_status: str
    settlement_state: Literal["settled", "pending", "voided"]
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    ordered_at: datetime
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None


class ManagerPaymentsLedgerResponse(BaseModel):
    currency: str = "PHP"
    timezone: str = "Asia/Manila"
    collected_revenue: Decimal
    completed_count: int
    pending_revenue: Decimal
    pending_count: int
    voided_revenue: Decimal
    voided_count: int
    method_breakdown: list[PaymentMethodBreakdownItem]
    items: list[PaymentTransactionItem]
    page: int
    page_size: int
    total: int
