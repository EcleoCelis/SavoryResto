from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.address import CustomerAddress
from app.db.models.customer import Customer
from app.schemas.customer import (
    AddressCreateRequest,
    AddressUpdateRequest,
    CustomerProfileUpdateRequest,
)


def update_customer_profile(
    db: Session,
    customer: Customer,
    request: CustomerProfileUpdateRequest,
) -> Customer:
    # If phone is changing, check uniqueness across other customers
    if request.phone and request.phone != customer.phone:
        existing = db.scalar(
            select(Customer).where(
                Customer.phone == request.phone,
                Customer.customer_id != customer.customer_id,
            )
        )
        if existing:
            raise ValueError("An account with this mobile number already exists.")
        customer.phone = request.phone
    elif request.phone is None:
        customer.phone = None

    customer.full_name = request.full_name.strip()
    db.commit()
    db.refresh(customer)
    return customer


def list_customer_addresses(db: Session, customer_id: int) -> list[CustomerAddress]:
    statement = (
        select(CustomerAddress)
        .where(CustomerAddress.customer_id == customer_id)
        .order_by(CustomerAddress.is_default.desc(), CustomerAddress.created_at.desc())
    )
    return list(db.scalars(statement))


def get_customer_address(db: Session, customer_id: int, address_id: int) -> CustomerAddress | None:
    statement = select(CustomerAddress).where(
        CustomerAddress.id == address_id,
        CustomerAddress.customer_id == customer_id,
    )
    return db.scalar(statement)


def create_customer_address(
    db: Session,
    customer_id: int,
    request: AddressCreateRequest,
) -> CustomerAddress:
    # Check if this is the customer's first address
    count = db.scalar(
        select(func.count(CustomerAddress.id)).where(CustomerAddress.customer_id == customer_id)
    ) or 0

    should_be_default = count == 0 or request.is_default
    if should_be_default:
        db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
            {CustomerAddress.is_default: False}
        )

    now = datetime.now(timezone.utc)
    address = CustomerAddress(
        customer_id=customer_id,
        label=request.label.strip(),
        recipient_name=request.recipient_name.strip(),
        phone=request.phone.strip(),
        street_address=request.street_address.strip(),
        city=request.city.strip(),
        state_province=request.state_province.strip() if request.state_province else None,
        postal_code=request.postal_code.strip() if request.postal_code else None,
        delivery_instructions=request.delivery_instructions.strip() if request.delivery_instructions else None,
        is_default=should_be_default,
        created_at=now,
        updated_at=now,
    )
    db.add(address)

    # Sync summary address on customer
    if should_be_default:
        customer = db.get(Customer, customer_id)
        if customer:
            customer.address = f"{address.street_address}, {address.city}"

    db.commit()
    db.refresh(address)
    return address


def update_customer_address(
    db: Session,
    customer_id: int,
    address_id: int,
    request: AddressUpdateRequest,
) -> CustomerAddress | None:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return None

    if request.is_default is True:
        db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
            {CustomerAddress.is_default: False}
        )
        address.is_default = True

    if request.label is not None:
        address.label = request.label.strip()
    if request.recipient_name is not None:
        address.recipient_name = request.recipient_name.strip()
    if request.phone is not None:
        address.phone = request.phone.strip()
    if request.street_address is not None:
        address.street_address = request.street_address.strip()
    if request.city is not None:
        address.city = request.city.strip()
    if request.state_province is not None:
        address.state_province = request.state_province.strip() or None
    if request.postal_code is not None:
        address.postal_code = request.postal_code.strip() or None
    if request.delivery_instructions is not None:
        address.delivery_instructions = request.delivery_instructions.strip() or None

    address.updated_at = datetime.now(timezone.utc)

    if address.is_default:
        customer = db.get(Customer, customer_id)
        if customer:
            customer.address = f"{address.street_address}, {address.city}"

    db.commit()
    db.refresh(address)
    return address


def set_default_address(
    db: Session,
    customer_id: int,
    address_id: int,
) -> CustomerAddress | None:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return None

    db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
        {CustomerAddress.is_default: False}
    )
    address.is_default = True
    address.updated_at = datetime.now(timezone.utc)

    customer = db.get(Customer, customer_id)
    if customer:
        customer.address = f"{address.street_address}, {address.city}"

    db.commit()
    db.refresh(address)
    return address


def delete_customer_address(
    db: Session,
    customer_id: int,
    address_id: int,
) -> bool:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return False

    was_default = address.is_default
    db.delete(address)
    db.flush()

    if was_default:
        # Designate the next remaining address as default
        next_addr = db.scalars(
            select(CustomerAddress)
            .where(CustomerAddress.customer_id == customer_id)
            .order_by(CustomerAddress.created_at.desc())
        ).first()

        customer = db.get(Customer, customer_id)
        if next_addr:
            next_addr.is_default = True
            if customer:
                customer.address = f"{next_addr.street_address}, {next_addr.city}"
        else:
            if customer:
                customer.address = None

    db.commit()
    return True
