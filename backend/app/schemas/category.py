from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _clean_category_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Category name cannot be empty or whitespace.")
    return cleaned


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    display_order: int


class CategoryDetailResponse(CategoryResponse):
    is_active: bool
    product_count: int = 0
    updated_at: datetime | None = None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        res = _clean_category_name(v)
        assert res is not None
        return res


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    display_order: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    expected_updated_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        return _clean_category_name(v)
