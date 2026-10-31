from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.order_status import OrderStatus
from app.core.security import require_staff_roles
from app.db.database import get_db
from app.db.models.staff import StaffUser
from app.schemas.kds import KdsOrderResponse, KdsStatusUpdateRequest
from app.services.kds_service import list_kds_orders, update_kds_order_status


router = APIRouter(prefix="/api/v1/kds", tags=["Kitchen Display System"])
staff_access = require_staff_roles("kitchen_staff", "manager")


@router.get("/orders", response_model=list[KdsOrderResponse])
def get_kds_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    current_staff: StaffUser = Depends(staff_access),
    db: Session = Depends(get_db),
):
    del current_staff
    return list_kds_orders(db, status_filter)


@router.patch("/orders/{order_id}/status", response_model=KdsOrderResponse)
def update_order_status(order_id: int, request: KdsStatusUpdateRequest, current_staff: StaffUser = Depends(staff_access), db: Session = Depends(get_db)):
    try:
        order = update_kds_order_status(db, current_staff, order_id, request.status)
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order
