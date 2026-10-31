from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


InventoryStatus = Literal["normal", "low_stock", "out_of_stock"]
ManualTransactionType = Literal["purchase", "waste", "adjustment", "return"]


class InventoryItemResponse(BaseModel):
    id: int
    name: str
    sku: str | None
    unit: str
    current_stock: Decimal
    reorder_level: Decimal
    unit_cost: Decimal
    is_active: bool
    stock_status: InventoryStatus
    updated_at: datetime


class InventoryTransactionResponse(BaseModel):
    id: int
    inventory_item_id: int
    inventory_item_name: str
    transaction_type: str
    quantity_change: Decimal
    stock_before: Decimal
    stock_after: Decimal
    unit_cost: Decimal | None
    reference_type: str | None
    reference_id: int | None
    notes: str | None
    performed_by: int
    created_at: datetime


class InventoryTransactionCreate(BaseModel):
    transaction_type: ManualTransactionType
    quantity_change: Decimal
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_transaction_direction(self):
        if self.quantity_change == 0:
            raise ValueError("The stock change cannot be zero.")
        if self.transaction_type in {"purchase", "return"} and self.quantity_change < 0:
            raise ValueError(f"{self.transaction_type.title()} transactions must increase stock.")
        if self.transaction_type == "waste" and self.quantity_change > 0:
            raise ValueError("Waste transactions must reduce stock.")
        return self

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, notes: str | None):
        if notes is None:
            return None
        normalized = notes.strip()
        return normalized or None
