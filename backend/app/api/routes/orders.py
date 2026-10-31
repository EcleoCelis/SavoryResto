from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_customer
from app.db.database import get_db
from app.db.models.customer import Customer
from app.schemas.order import CancelOrderRequest, OrderHistoryResponse, OrderResponse, PlaceOrderRequest
from app.services.order_service import cancel_customer_order, get_customer_order, list_customer_orders, place_order


router = APIRouter(prefix="/api/v1/orders", tags=["Orders"])


@router.get("", response_model=OrderHistoryResponse)
def get_orders(
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
):
    return list_customer_orders(db, current_customer, page, page_size)


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    response: Response,
    order_request: PlaceOrderRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=16, max_length=128),
):
    try:
        order, created = place_order(db, current_customer, order_request, idempotency_key)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An order with this request key is being processed. Please retry.")
    except Exception:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to place the order. Please try again.")

    if not created:
        response.status_code = status.HTTP_200_OK
    return order


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    order = get_customer_order(db, current_customer, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order


@router.patch("/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(
    order_id: int,
    cancellation: CancelOrderRequest,
    current_customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
):
    try:
        order = cancel_customer_order(db, current_customer, order_id, cancellation.reason)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order
