from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class RegisterRequest(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True
    )

    full_name: str = Field(
        min_length=2,
        max_length=100,
    )

    email: EmailStr

    phone: str = Field(
        min_length=10,
        max_length=20,
    )

    password: str = Field(
        min_length=8,
        max_length=128,
    )

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        if not any(character.isalpha() for character in value):
            raise ValueError(
                "Please enter a valid full name."
            )

        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        compact_value = re.sub(r"[\s()\-]", "", value)

        if re.fullmatch(r"\+639\d{9}", compact_value):
            compact_value = f"0{compact_value[3:]}"

        if not re.fullmatch(r"09\d{9}", compact_value):
            raise ValueError(
                "Please enter a valid Philippine mobile number."
            )

        return compact_value


class RegisterResponse(BaseModel):
    message: str
    customer_id: int
    email: EmailStr


class CustomerMeResponse(BaseModel):
    customer_id: int
    full_name: str
    email: EmailStr | None
    phone: str | None
    address: str | None
    avatar_url: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    preferred_payment_code: str | None = None
    default_order_type: str | None = None
    theme_preference: str = "system"


class LogoutResponse(BaseModel):
    message: str


class LoginRequest(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True
    )

    email: EmailStr

    password: str = Field(
        min_length=1,
        max_length=128,
    )

    remember_me: bool = False


class LoginResponse(BaseModel):
    message: str
    customer_id: int
    email: EmailStr
    full_name: str
    access_token: str | None = None
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True
    )

    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True
    )

    token: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def verify_passwords_match(self) -> "ResetPasswordRequest":
        if self.new_password != self.confirm_password:
            raise ValueError("The new password and confirm password do not match.")
        return self


class ResetPasswordResponse(BaseModel):
    message: str
