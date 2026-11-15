from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.db.models.address import CustomerAddress
    from app.db.models.favorite import CustomerFavorite
    from app.db.models.password_reset_token import PasswordResetToken


class Customer(Base):
    __tablename__ = "customers"

    customer_id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    phone: Mapped[str | None] = mapped_column(
        String(20),
        unique=True,
        nullable=True,
    )

    email: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
    )

    address: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    deactivated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    preferred_payment_code: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    default_order_type: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    dietary_preferences: Mapped[list[str] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    allergy_flags: Mapped[list[str] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    disliked_ingredients: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    preferred_category_ids: Mapped[list[int] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    allergy_consent_given: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    allergy_consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    share_allergy_with_kitchen: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    email_order_updates: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    email_promotions: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    marketing_consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    theme_preference: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="system",
    )

    preferences_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    password_hash: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    addresses: Mapped[list["CustomerAddress"]] = relationship(
        "CustomerAddress",
        back_populates="customer",
        cascade="all, delete-orphan",
    )

    favorites: Mapped[list["CustomerFavorite"]] = relationship(
        "CustomerFavorite",
        back_populates="customer",
        cascade="all, delete-orphan",
    )

    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        "PasswordResetToken",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
