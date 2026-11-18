from datetime import datetime, time
from decimal import Decimal
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.schemas.payment_method import ManagerPaymentMethodSummary

PHONE_REGEX = re.compile(r"^[+0-9()\s-]{7,24}$")
TIME_HHMM_REGEX = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class BusinessHourItem(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    day_name: str
    short_day: str
    is_open: bool
    open_time: str = Field(pattern=TIME_HHMM_REGEX.pattern)
    close_time: str = Field(pattern=TIME_HHMM_REGEX.pattern)


class BusinessHourUpdateItem(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    is_open: bool
    open_time: str = Field(pattern=TIME_HHMM_REGEX.pattern)
    close_time: str = Field(pattern=TIME_HHMM_REGEX.pattern)

    @model_validator(mode="after")
    def validate_times_not_equal_when_open(self):
        if self.is_open and self.open_time == self.close_time:
            raise ValueError(f"Day {self.day_of_week}: opening and closing times cannot be identical when open.")
        return self


class RestaurantInfoOut(BaseModel):
    name: str
    tagline: str
    locality: str
    full_address: str
    phone: str
    email: EmailStr
    timezone: str
    kitchen_cutoff_minutes: int
    kitchen_notice: str
    holiday_notice: str


class OrderingSettingsOut(BaseModel):
    online_ordering_enabled: bool
    online_ordering_pause_reason: str | None
    dine_in_enabled: bool
    takeout_enabled: bool
    enforce_operating_hours: bool
    kitchen_cutoff_minutes: int
    minimum_order_amount: Decimal


class NotificationSettingsOut(BaseModel):
    send_order_confirmation_emails: bool
    send_contact_inquiry_emails: bool
    smtp_configured: bool


class SystemInfoOut(BaseModel):
    environment: str
    timezone: str
    staff_session_timeout_minutes: int
    version: int
    updated_at: datetime


class PublicRestaurantSettingsResponse(BaseModel):
    restaurant: RestaurantInfoOut
    hours: list[BusinessHourItem]
    ordering: OrderingSettingsOut
    is_currently_open: bool
    operating_status_text: str


class ManagerSettingsResponse(BaseModel):
    restaurant: RestaurantInfoOut
    hours: list[BusinessHourItem]
    ordering: OrderingSettingsOut
    notifications: NotificationSettingsOut
    payment_methods: list[ManagerPaymentMethodSummary]
    system_info: SystemInfoOut


class RestaurantInfoUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=120)
    tagline: str = Field(min_length=2, max_length=200)
    locality: str = Field(min_length=2, max_length=150)
    full_address: str = Field(min_length=5, max_length=300)
    phone: str = Field(min_length=7, max_length=40)
    email: EmailStr
    kitchen_notice: str = Field(min_length=5, max_length=500)
    holiday_notice: str = Field(min_length=5, max_length=500)
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if not PHONE_REGEX.match(value):
            raise ValueError("Please enter a valid contact telephone number.")
        digits = sum(ch.isdigit() for ch in value)
        if digits < 7 or digits > 15:
            raise ValueError("Contact number must contain between 7 and 15 digits.")
        return value


class BusinessHoursUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hours: list[BusinessHourUpdateItem] = Field(min_length=7, max_length=7)
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_complete_week(self):
        seen = {h.day_of_week for h in self.hours}
        if seen != {0, 1, 2, 3, 4, 5, 6}:
            raise ValueError("Weekly schedule must include all 7 days exactly once (0=Sunday..6=Saturday).")
        return self


class OrderingSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    online_ordering_enabled: bool
    online_ordering_pause_reason: str | None = Field(default=None, max_length=300)
    dine_in_enabled: bool
    takeout_enabled: bool
    enforce_operating_hours: bool
    kitchen_cutoff_minutes: int = Field(ge=0, le=180)
    minimum_order_amount: Decimal = Field(ge=Decimal("0.00"), le=Decimal("100000.00"))
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_channels_and_reason(self):
        if self.online_ordering_enabled and not (self.dine_in_enabled or self.takeout_enabled):
            raise ValueError("Enable at least Dine-In or Takeout when online ordering is active.")
        if self.online_ordering_pause_reason == "":
            self.online_ordering_pause_reason = None
        return self


class NotificationSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    send_order_confirmation_emails: bool
    send_contact_inquiry_emails: bool
    expected_version: int | None = Field(default=None, ge=1)


class StaffChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)
