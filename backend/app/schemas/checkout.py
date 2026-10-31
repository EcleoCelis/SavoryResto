from decimal import Decimal
from pydantic import BaseModel, Field, field_validator


class CheckoutLineRequest(BaseModel):
    cart_line_id: str = Field(min_length=1, max_length=200)
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=99)
    size: str = Field(min_length=1, max_length=50)
    addons: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("size")
    @classmethod
    def normalize_size(cls, size: str):
        return size.strip()

    @field_validator("addons")
    @classmethod
    def validate_unique_addons(cls, addons: list[str]):
        normalized = [addon.strip() for addon in addons]
        if any(not addon or len(addon) > 50 for addon in normalized):
            raise ValueError("Selected add-ons must be valid option codes.")
        if len(normalized) != len(set(normalized)):
            raise ValueError("Selected add-ons must be unique.")
        return normalized


class CheckoutQuoteRequest(BaseModel):
    items: list[CheckoutLineRequest] = Field(min_length=1, max_length=99)

    @field_validator("items")
    @classmethod
    def validate_unique_cart_lines(cls, items: list[CheckoutLineRequest]):
        line_ids = [item.cart_line_id for item in items]
        if len(line_ids) != len(set(line_ids)):
            raise ValueError("Cart items must have unique line identifiers.")
        return items


class CheckoutQuoteLine(BaseModel):
    cart_line_id: str
    product_id: int
    name: str
    quantity: int
    unit_price: Decimal
    subtotal: Decimal


class CheckoutQuoteResponse(BaseModel):
    items: list[CheckoutQuoteLine]
    subtotal: Decimal
    total: Decimal
