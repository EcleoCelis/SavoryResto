from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.payment_method import PaymentMethod


def list_active_payment_methods(db: Session) -> list[PaymentMethod]:
    return list(db.scalars(
        select(PaymentMethod)
        .where(PaymentMethod.is_active.is_(True))
        .order_by(PaymentMethod.display_order, PaymentMethod.id)
    ))


def get_active_payment_method(db: Session, code: str) -> PaymentMethod | None:
    return db.scalar(
        select(PaymentMethod).where(
            PaymentMethod.code == code,
            PaymentMethod.is_active.is_(True),
        )
    )
