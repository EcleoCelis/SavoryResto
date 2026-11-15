from datetime import datetime
from decimal import Decimal
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.schemas.product import ProductResponse


ALLOWED_DIETARY_PREFERENCES = frozenset({
    "vegetarian",
    "vegan",
    "no_pork",
    "no_beef",
    "pescatarian",
    "halal_friendly",
    "low_carb",
})

ALLOWED_ALLERGENS = frozenset({
    "peanuts",
    "tree_nuts",
    "milk_dairy",
    "eggs",
    "shellfish",
    "fish",
    "soy",
    "wheat_gluten",
    "sesame",
})

ALLOWED_THEME_PREFERENCES = ("light", "dark", "system")

LOCAL_SERVICEABLE_CITIES = frozenset({
    "dumaguete",
    "dumaguete city",
    "valencia",
    "sibulan",
    "bacong",
    "dauin",
    "makati",
    "bgc",
    "taguig",
    "quezon city",
    "manila",
    "pasig",
    "mandaluyong",
    "cebu city",
})


def normalize_philippine_phone(value: str | None, *, required: bool = False) -> str | None:
    if value is None or not value.strip():
        if required:
            raise ValueError("Please enter a valid Philippine mobile number (e.g. 09171234567).")
        return None
    compact_value = re.sub(r"[\s()\-]", "", value)
    if re.fullmatch(r"\+639\d{9}", compact_value):
        compact_value = f"0{compact_value[3:]}"
    if not re.fullmatch(r"09\d{9}", compact_value):
        raise ValueError("Please enter a valid Philippine mobile number (e.g. 09171234567).")
    return compact_value


def split_full_name(full_name: str) -> tuple[str, str]:
    parts = [part for part in (full_name or "").strip().split() if part]
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (" ".join(parts[:-1]), parts[-1])


def is_city_in_service_area(city: str | None) -> bool:
    if not city:
        return False
    return city.strip().lower() in LOCAL_SERVICEABLE_CITIES


class CustomerProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(default=None, max_length=100)
    first_name: str | None = Field(default=None, max_length=60)
    last_name: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return normalize_philippine_phone(value, required=False)

    @model_validator(mode="after")
    def resolve_names(self) -> "CustomerProfileUpdateRequest":
        if self.first_name is not None or self.last_name is not None:
            combined = " ".join(
                part.strip() for part in (self.first_name or "", self.last_name or "") if part and part.strip()
            )
            if combined:
                self.full_name = combined

        if not self.full_name or len(self.full_name.strip()) < 2:
            raise ValueError("Full name must contain at least 2 characters.")
        if len(self.full_name.strip()) > 100:
            raise ValueError("Full name must not exceed 100 characters.")
        if not any(character.isalpha() for character in self.full_name):
            raise ValueError("Please enter a valid full name.")
        self.full_name = self.full_name.strip()
        return self


class CustomerEmailChangeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    new_email: EmailStr
    current_password: str = Field(min_length=1, max_length=128)


class CustomerPasswordChangeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_passwords(self) -> "CustomerPasswordChangeRequest":
        if self.new_password != self.confirm_password:
            raise ValueError("New password and confirmation do not match.")
        if self.current_password == self.new_password:
            raise ValueError("Your new password must be different from your current password.")
        return self


class CustomerDeactivateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    current_password: str = Field(min_length=1, max_length=128)
    confirm_deactivation: bool = True
    reason: str | None = Field(default=None, max_length=500)


class CustomerPreferencesUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    preferred_payment_code: str | None = Field(default=None, max_length=50)
    default_order_type: Literal["dine_in", "takeout"] | None = None
    dietary_preferences: list[str] = Field(default_factory=list, max_length=20)
    allergy_flags: list[str] = Field(default_factory=list, max_length=20)
    disliked_ingredients: str | None = Field(default=None, max_length=500)
    preferred_category_ids: list[int] = Field(default_factory=list, max_length=20)
    allergy_consent_given: bool = False
    share_allergy_with_kitchen: bool = True
    email_order_updates: bool = True
    email_promotions: bool = False
    theme_preference: Literal["light", "dark", "system"] = "system"

    @field_validator("preferred_payment_code")
    @classmethod
    def clean_payment_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return value.strip().lower()

    @field_validator("dietary_preferences")
    @classmethod
    def validate_dietary_preferences(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(v.strip().lower() for v in values if v.strip()))
        invalid = [v for v in normalized if v not in ALLOWED_DIETARY_PREFERENCES]
        if invalid:
            raise ValueError(f"Unsupported dietary preference(s): {', '.join(invalid)}.")
        return normalized

    @field_validator("allergy_flags")
    @classmethod
    def validate_allergy_flags(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(v.strip().lower() for v in values if v.strip()))
        invalid = [v for v in normalized if v not in ALLOWED_ALLERGENS]
        if invalid:
            raise ValueError(f"Unsupported allergen option(s): {', '.join(invalid)}.")
        return normalized

    @field_validator("preferred_category_ids")
    @classmethod
    def validate_category_ids(cls, values: list[int]) -> list[int]:
        clean = list(dict.fromkeys(v for v in values if isinstance(v, int) and v > 0))
        return clean

    @model_validator(mode="after")
    def validate_allergy_consent(self) -> "CustomerPreferencesUpdateRequest":
        has_allergy_info = bool(self.allergy_flags) or bool(self.disliked_ingredients)
        if has_allergy_info and not self.allergy_consent_given:
            raise ValueError(
                "Please confirm consent before saving food allergy or ingredient restriction information."
            )
        return self


class CustomerProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    customer_id: int
    full_name: str
    first_name: str = ""
    last_name: str = ""
    email: EmailStr | None
    phone: str | None
    address: str | None
    avatar_url: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    preferred_payment_code: str | None = None
    default_order_type: str | None = None
    dietary_preferences: list[str] = Field(default_factory=list)
    allergy_flags: list[str] = Field(default_factory=list)
    disliked_ingredients: str | None = None
    preferred_category_ids: list[int] = Field(default_factory=list)
    allergy_consent_given: bool = False
    allergy_consent_at: datetime | None = None
    share_allergy_with_kitchen: bool = True
    email_order_updates: bool = True
    email_promotions: bool = False
    marketing_consent_at: datetime | None = None
    theme_preference: str = "system"
    preferences_updated_at: datetime | None = None

    @field_validator("dietary_preferences", "allergy_flags", "preferred_category_ids", mode="before")
    @classmethod
    def coerce_null_list(cls, value: list | None) -> list:
        return list(value) if value is not None else []

    @field_validator(
        "is_active",
        "share_allergy_with_kitchen",
        "email_order_updates",
        mode="before",
    )
    @classmethod
    def coerce_null_default_true(cls, value: bool | None) -> bool:
        return True if value is None else bool(value)

    @field_validator("allergy_consent_given", "email_promotions", mode="before")
    @classmethod
    def coerce_null_default_false(cls, value: bool | None) -> bool:
        return False if value is None else bool(value)

    @model_validator(mode="after")
    def populate_split_names_and_defaults(self) -> "CustomerProfileResponse":
        first, last = split_full_name(self.full_name)
        self.first_name = first
        self.last_name = last
        if not self.theme_preference:
            self.theme_preference = "system"
        return self


class FavoriteProductResponse(BaseModel):
    product_id: int
    favorited_at: datetime
    product: ProductResponse


class AddressCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(default="Home", min_length=1, max_length=50)
    recipient_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    street_address: str = Field(min_length=3, max_length=255)
    barangay: str | None = Field(default=None, max_length=120)
    city: str = Field(min_length=2, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    delivery_instructions: str | None = Field(default=None, max_length=500)
    is_default: bool = False

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_philippine_phone(value, required=True) or ""

    @field_validator("postal_code")
    @classmethod
    def validate_postal(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        clean = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9\- ]{3,12}", clean):
            raise ValueError("Please enter a valid postal code.")
        return clean


class AddressUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str | None = Field(default=None, min_length=1, max_length=50)
    recipient_name: str | None = Field(default=None, min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    street_address: str | None = Field(default=None, min_length=3, max_length=255)
    barangay: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, min_length=2, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    delivery_instructions: str | None = Field(default=None, max_length=500)
    is_default: bool | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return normalize_philippine_phone(value, required=False)

    @field_validator("postal_code")
    @classmethod
    def validate_postal(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        clean = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9\- ]{3,12}", clean):
            raise ValueError("Please enter a valid postal code.")
        return clean


class AddressResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    label: str
    recipient_name: str
    phone: str
    street_address: str
    barangay: str | None = None
    city: str
    state_province: str | None
    postal_code: str | None
    delivery_instructions: str | None
    is_default: bool
    is_within_service_area: bool = False
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def populate_serviceability(self) -> "AddressResponse":
        self.is_within_service_area = is_city_in_service_area(self.city)
        return self


class ManagerCustomerSummaryResponse(BaseModel):
    customer_id: int
    full_name: str
    email: str | None
    phone: str | None
    is_active: bool
    created_at: datetime | None
    deactivated_at: datetime | None
    order_count: int
    total_spent: Decimal
    last_order_at: datetime | None


class ManagerCustomerListResponse(BaseModel):
    items: list[ManagerCustomerSummaryResponse]
    page: int
    page_size: int
    total: int


class ManagerCustomerOrderSummary(BaseModel):
    id: int
    order_number: str
    status: str
    order_type: str
    fulfillment_type: str | None
    table_number: str | None
    total: Decimal
    ordered_at: datetime


class ManagerCustomerDetailResponse(BaseModel):
    customer: ManagerCustomerSummaryResponse
    default_address: str | None = None
    saved_addresses_count: int = 0
    marketing_opt_in: bool = False
    operational_allergy_alert: str | None = None
    recent_orders: list[ManagerCustomerOrderSummary]


class ManagerCustomerStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    is_active: bool
    reason: str | None = Field(default=None, max_length=500)
