from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.models.customer import Customer
from app.schemas.auth import LoginRequest, RegisterRequest


def register_customer(
    db: Session,
    registration: RegisterRequest,
) -> Customer:
    normalized_email = registration.email.lower()

    existing_customer = db.scalar(
        select(Customer).where(Customer.email == normalized_email)
    )
    if existing_customer:
        raise ValueError("An account with this email address already exists.")

    existing_phone = db.scalar(
        select(Customer).where(Customer.phone == registration.phone)
    )
    if existing_phone:
        raise ValueError("An account with this mobile number already exists.")

    customer = Customer(
        full_name=registration.full_name,
        phone=registration.phone,
        email=normalized_email,
        password_hash=hash_password(registration.password),
        created_at=datetime.now(timezone.utc),
        is_active=True,
    )

    db.add(customer)
    db.commit()
    db.refresh(customer)

    return customer


def authenticate_customer(
    db: Session,
    login: LoginRequest,
) -> Customer | None:
    email = login.email.strip().lower()

    statement = select(Customer).where(Customer.email == email)
    customer = db.execute(statement).scalar_one_or_none()

    if customer is None or not getattr(customer, "is_active", True):
        return None

    if not customer.password_hash:
        return None

    if not verify_password(login.password, customer.password_hash):
        return None

    return customer
