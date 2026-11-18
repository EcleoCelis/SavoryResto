from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RestaurantTableResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    table_number: str
    seats: int
    is_available: bool


class ManagerTableActiveOrderSummary(BaseModel):
    id: int
    order_number: str
    status: str
    customer_name: str
    total_amount: Decimal
    ordered_at: datetime


class ManagerTableSummary(BaseModel):
    id: int
    table_number: str
    seats: int
    is_active: bool
    is_occupied: bool
    active_order: ManagerTableActiveOrderSummary | None = None
    total_orders_count: int
    created_at: datetime
    updated_at: datetime


class ManagerTablesOverviewResponse(BaseModel):
    total_tables: int
    active_tables: int
    available_tables: int
    occupied_tables: int
    total_active_seats: int
    items: list[ManagerTableSummary]


class ManagerTableCreateRequest(BaseModel):
    table_number: str = Field(min_length=1, max_length=20)
    seats: int = Field(ge=1, le=30)
    is_active: bool = True

    @field_validator("table_number")
    @classmethod
    def normalize_table_number(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Table number or label cannot be blank.")
        return cleaned


class ManagerTableUpdateRequest(BaseModel):
    table_number: str | None = Field(default=None, min_length=1, max_length=20)
    seats: int | None = Field(default=None, ge=1, le=30)
    is_active: bool | None = None
    expected_updated_at: datetime | None = Field(
        default=None,
        description="Optimistic concurrency timestamp from the last loaded table snapshot.",
    )

    @field_validator("table_number")
    @classmethod
    def normalize_table_number(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Table number or label cannot be blank.")
        return cleaned
