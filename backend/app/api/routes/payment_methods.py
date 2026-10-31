from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.payment_method import PaymentMethodResponse
from app.services.payment_method_service import list_active_payment_methods


router = APIRouter(prefix="/api/v1/payment-methods", tags=["Payment Methods"])


@router.get("", response_model=list[PaymentMethodResponse])
def get_payment_methods(db: Session = Depends(get_db)):
    """Expose only payment methods the restaurant currently accepts."""
    return list_active_payment_methods(db)
