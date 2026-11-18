from datetime import datetime, time, timezone
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RestaurantSettings(Base):
    """Authoritative single-restaurant operational & public business configuration."""

    __tablename__ = "restaurant_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_restaurant_settings_singleton"),
        CheckConstraint("kitchen_cutoff_minutes >= 0 AND kitchen_cutoff_minutes <= 180", name="ck_restaurant_settings_cutoff"),
        CheckConstraint("minimum_order_amount >= 0", name="ck_restaurant_settings_min_order"),
        CheckConstraint("dine_in_enabled OR takeout_enabled OR NOT online_ordering_enabled", name="ck_restaurant_settings_channel_when_open"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    tagline: Mapped[str] = mapped_column(String(200), nullable=False)
    locality: Mapped[str] = mapped_column(String(150), nullable=False)
    full_address: Mapped[str] = mapped_column(String(300), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Manila")
    kitchen_cutoff_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    kitchen_notice: Mapped[str] = mapped_column(Text, nullable=False)
    holiday_notice: Mapped[str] = mapped_column(Text, nullable=False)

    online_ordering_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    online_ordering_pause_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    dine_in_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    takeout_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enforce_operating_hours: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    minimum_order_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))

    send_order_confirmation_emails: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    send_contact_inquiry_emails: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class RestaurantBusinessHour(Base):
    """Seven-day operating schedule interpreted in RestaurantSettings.timezone (Asia/Manila)."""

    __tablename__ = "restaurant_business_hours"
    __table_args__ = (
        CheckConstraint("day_of_week >= 0 AND day_of_week <= 6", name="ck_restaurant_business_hours_day"),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)  # 0=Sunday..6=Saturday
    is_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    open_time: Mapped[time] = mapped_column(Time, nullable=False)
    close_time: Mapped[time] = mapped_column(Time, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
