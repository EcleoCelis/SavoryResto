from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_customer
from app.db.database import get_db
from app.db.models.customer import Customer
from app.schemas.checkout import CheckoutQuoteRequest, CheckoutQuoteResponse
from app.services.checkout_service import quote_checkout_items


router = APIRouter(prefix="/api/v1/checkout", tags=["Checkout"])


@router.post(
    "/quote",
    response_model=CheckoutQuoteResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Authentication is required."},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Cart validation failed."},
    },
)
def quote_checkout(
    checkout: CheckoutQuoteRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    del current_customer
    try:
        items = quote_checkout_items(db, checkout.items)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))

    subtotal = sum((item.subtotal for item in items), Decimal("0"))
    return CheckoutQuoteResponse(items=items, subtotal=subtotal, total=subtotal)
