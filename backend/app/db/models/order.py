from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_number: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    # Legacy records retain their old users.id reference without treating it as a customer.
    legacy_customer_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.customer_id"), nullable=True, index=True)
    # A staff user may record an order; customer-originated orders have no staff creator.
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    order_type: Mapped[str] = mapped_column(String(50), nullable=False)
    fulfillment_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    restaurant_table_id: Mapped[int | None] = mapped_column(ForeignKey("restaurant_tables.id", ondelete="RESTRICT"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payment_method_id: Mapped[int | None] = mapped_column(ForeignKey("payment_methods.id", ondelete="RESTRICT"), nullable=True, index=True)
    delivery_address_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    kitchen_allergy_alert: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.customer_id", ondelete="RESTRICT"), nullable=True, index=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    customer: Mapped["Customer | None"] = relationship(foreign_keys=[customer_id])
    cancelled_by_customer: Mapped["Customer | None"] = relationship(foreign_keys=[cancelled_by_customer_id])
    payment_method: Mapped["PaymentMethod | None"] = relationship(back_populates="orders")
    restaurant_table: Mapped["RestaurantTable | None"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    special_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    size_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    selected_addons: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped["MenuProduct"] = relationship()
