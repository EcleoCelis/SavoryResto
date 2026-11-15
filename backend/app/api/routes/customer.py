from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, get_client_ip, get_current_customer
from app.db.database import get_db
from app.db.models.customer import Customer
from app.schemas.customer import (
    AddressCreateRequest,
    AddressResponse,
    AddressUpdateRequest,
    CustomerDeactivateRequest,
    CustomerEmailChangeRequest,
    CustomerPasswordChangeRequest,
    CustomerPreferencesUpdateRequest,
    CustomerProfileResponse,
    CustomerProfileUpdateRequest,
    FavoriteProductResponse,
)
from app.services.customer_service import (
    add_customer_favorite,
    change_customer_email,
    change_customer_password,
    create_customer_address,
    deactivate_customer_account,
    delete_customer_address,
    list_customer_addresses,
    list_customer_favorites,
    remove_customer_avatar,
    remove_customer_favorite,
    set_default_address,
    update_customer_address,
    update_customer_avatar,
    update_customer_preferences,
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


@router.put("/me/email", response_model=CustomerProfileResponse)
def change_email(
    payload: CustomerEmailChangeRequest,
    req: Request,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        return change_customer_email(db, current_customer, payload, get_client_ip(req))
    except PermissionError as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))


@router.post("/me/avatar", response_model=CustomerProfileResponse)
async def upload_profile_avatar(
    file: UploadFile = File(...),
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        content = await file.read()
        return update_customer_avatar(db, current_customer, content, file.filename)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.delete("/me/avatar", response_model=CustomerProfileResponse)
def delete_profile_avatar(
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    return remove_customer_avatar(db, current_customer)


@router.put("/me/preferences", response_model=CustomerProfileResponse)
def update_preferences(
    payload: CustomerPreferencesUpdateRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        return update_customer_preferences(db, current_customer, payload)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(err))


@router.put("/me/password")
def change_password(
    payload: CustomerPasswordChangeRequest,
    req: Request,
    response: Response,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        updated_customer = change_customer_password(
            db, current_customer, payload, get_client_ip(req)
        )
    except PermissionError as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(err))

    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    new_token = create_access_token(
        customer_id=updated_customer.customer_id,
        expires_delta=expires_delta,
    )
    response.set_cookie(
        key="access_token",
        value=new_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(expires_delta.total_seconds()),
        path="/",
    )
    return {"message": "Password updated successfully. Older sessions have been signed out."}


@router.post("/me/deactivate")
def deactivate_account(
    payload: CustomerDeactivateRequest,
    req: Request,
    response: Response,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        deactivate_customer_account(db, current_customer, payload, get_client_ip(req))
    except PermissionError as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(err))

    response.delete_cookie(
        key="access_token",
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    return {"message": "Your account has been deactivated."}


@router.get("/me/favorites", response_model=list[FavoriteProductResponse])
def get_favorites(
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    return list_customer_favorites(db, current_customer.customer_id)


@router.post("/me/favorites/{product_id}", response_model=FavoriteProductResponse, status_code=status.HTTP_201_CREATED)
def add_favorite(
    product_id: int,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        return add_customer_favorite(db, current_customer.customer_id, product_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))


@router.delete("/me/favorites/{product_id}")
def delete_favorite(
    product_id: int,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    removed = remove_customer_favorite(db, current_customer.customer_id, product_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Favorite dish not found.")
    return {"message": "Removed from favorites."}


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
