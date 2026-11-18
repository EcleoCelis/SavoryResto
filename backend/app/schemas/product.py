from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.category import CategoryResponse

MAX_PRODUCT_PRICE = Decimal("99999999.99")


def _clean_product_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Product name cannot be empty or whitespace.")
    return cleaned


def _validate_money(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    if not value.is_finite():
        raise ValueError("Price must be a finite monetary value.")
    if value <= Decimal("0"):
        raise ValueError("Price must be greater than zero.")
    if value > MAX_PRODUCT_PRICE:
        raise ValueError(f"Price cannot exceed {MAX_PRODUCT_PRICE}.")
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if quantized <= Decimal("0"):
        raise ValueError("Price must be at least 0.01 PHP.")
    return quantized


class ProductOptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    label: str
    price_adjustment: Decimal


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    name: str
    description: str | None
    image_url: str | None
    price: Decimal
    is_available: bool
    updated_at: datetime | None = None
    category: CategoryResponse
    sizes: list[ProductOptionResponse]
    addons: list[ProductOptionResponse]
    ingredient_names: list[str] = Field(default_factory=list)


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category_id: int = Field(gt=0)
    price: Decimal = Field(gt=Decimal("0"))
    description: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        res = _clean_product_name(v)
        assert res is not None
        return res

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: Decimal) -> Decimal:
        res = _validate_money(v)
        assert res is not None
        return res


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    category_id: int | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, gt=Decimal("0"))
    description: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool | None = None
    expected_updated_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        return _clean_product_name(v)

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: Decimal | None) -> Decimal | None:
        return _validate_money(v)


class ProductAvailabilityUpdate(BaseModel):
    is_available: bool


class DishImageUploadResponse(BaseModel):
    filename: str
    image_url: str
    size_bytes: int
    width: int
    height: int
    content_type: str
