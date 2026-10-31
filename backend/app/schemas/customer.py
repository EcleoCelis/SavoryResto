from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class CustomerProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        if not any(character.isalpha() for character in value):
            raise ValueError("Please enter a valid full name.")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        compact_value = re.sub(r"[\s()\-]", "", value)
        if re.fullmatch(r"\+639\d{9}", compact_value):
            compact_value = f"0{compact_value[3:]}"
        if not re.fullmatch(r"09\d{9}", compact_value):
            raise ValueError("Please enter a valid Philippine mobile number (e.g. 09171234567).")
        return compact_value


class CustomerProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    customer_id: int
    full_name: str
    email: EmailStr | None
    phone: str | None
    address: str | None


class AddressCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(default="Home", min_length=1, max_length=50)
    recipient_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    street_address: str = Field(min_length=3, max_length=255)
    city: str = Field(min_length=2, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    delivery_instructions: str | None = Field(default=None, max_length=500)
    is_default: bool = False

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        compact_value = re.sub(r"[\s()\-]", "", value)
        if re.fullmatch(r"\+639\d{9}", compact_value):
            compact_value = f"0{compact_value[3:]}"
        if not re.fullmatch(r"09\d{9}", compact_value):
            raise ValueError("Please enter a valid Philippine mobile number (e.g. 09171234567).")
        return compact_value


class AddressUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str | None = Field(default=None, min_length=1, max_length=50)
    recipient_name: str | None = Field(default=None, min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    street_address: str | None = Field(default=None, min_length=3, max_length=255)
    city: str | None = Field(default=None, min_length=2, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    delivery_instructions: str | None = Field(default=None, max_length=500)
    is_default: bool | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        compact_value = re.sub(r"[\s()\-]", "", value)
        if re.fullmatch(r"\+639\d{9}", compact_value):
            compact_value = f"0{compact_value[3:]}"
        if not re.fullmatch(r"09\d{9}", compact_value):
            raise ValueError("Please enter a valid Philippine mobile number (e.g. 09171234567).")
        return compact_value


class AddressResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    label: str
    recipient_name: str
    phone: str
    street_address: str
    city: str
    state_province: str | None
    postal_code: str | None
    delivery_instructions: str | None
    is_default: bool
    created_at: datetime
    updated_at: datetime
