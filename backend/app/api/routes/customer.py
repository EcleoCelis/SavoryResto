from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_customer
from app.db.database import get_db
from app.db.models.customer import Customer
from app.schemas.customer import (
    AddressCreateRequest,
    AddressResponse,
    AddressUpdateRequest,
    CustomerProfileResponse,
    CustomerProfileUpdateRequest,
)
from app.services.customer_service import (
    create_customer_address,
    delete_customer_address,
    list_customer_addresses,
    set_default_address,
    update_customer_address,
    update_customer_profile,
)


router = APIRouter(prefix="/api/v1/customers", tags=["Customer Profile & Addresses"])


@router.get("/me", response_model=CustomerProfileResponse)
def get_customer_profile(
    current_customer: Customer = Depends(get_current_customer),
):
    return current_customer


@router.put("/me", response_model=CustomerProfileResponse)
def update_profile(
    request: CustomerProfileUpdateRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        return update_customer_profile(db, current_customer, request)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))


@router.get("/me/addresses", response_model=list[AddressResponse])
def get_saved_addresses(
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    return list_customer_addresses(db, current_customer.customer_id)


@router.post("/me/addresses", response_model=AddressResponse, status_code=status.HTTP_201_CREATED)
def add_saved_address(
    request: AddressCreateRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    return create_customer_address(db, current_customer.customer_id, request)


@router.put("/me/addresses/{address_id}", response_model=AddressResponse)
def update_saved_address(
    address_id: int,
    request: AddressUpdateRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    address = update_customer_address(db, current_customer.customer_id, address_id, request)
    if address is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    return address


@router.patch("/me/addresses/{address_id}/default", response_model=AddressResponse)
def set_address_as_default(
    address_id: int,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    address = set_default_address(db, current_customer.customer_id, address_id)
    if address is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    return address


@router.delete("/me/addresses/{address_id}")
def delete_saved_address(
    address_id: int,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    deleted = delete_customer_address(db, current_customer.customer_id, address_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    return {"message": "Address deleted successfully."}
