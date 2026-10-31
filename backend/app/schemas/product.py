from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.category import CategoryResponse

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
    category: CategoryResponse
    sizes: list[ProductOptionResponse]
    addons: list[ProductOptionResponse]


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category_id: int = Field(gt=0)
    price: Decimal = Field(gt=Decimal("0"))
    description: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool = True


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    category_id: int | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, gt=Decimal("0"))
    description: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)
    is_available: bool | None = None


class ProductAvailabilityUpdate(BaseModel):
    is_available: bool


class DishImageUploadResponse(BaseModel):
    filename: str
    image_url: str
    size_bytes: int
    width: int
    height: int
    content_type: str
