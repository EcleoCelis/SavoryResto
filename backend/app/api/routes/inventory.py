from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.security import require_staff_roles
from app.db.database import get_db
from app.db.models.staff import StaffUser
from app.schemas.inventory import InventoryItemResponse, InventoryTransactionCreate, InventoryTransactionResponse
from app.services.inventory_service import list_inventory_items, list_inventory_transactions, record_inventory_transaction


router = APIRouter(prefix="/api/v1/inventory", tags=["Inventory"])
manager_access = require_staff_roles("manager")


@router.get("", response_model=list[InventoryItemResponse])
def get_inventory(
    low_stock_only: bool = Query(default=False),
    current_staff: StaffUser = Depends(manager_access),
    db: Session = Depends(get_db),
):
    del current_staff
    return list_inventory_items(db, low_stock_only)


@router.get("/low-stock", response_model=list[InventoryItemResponse])
def get_low_stock_inventory(
    current_staff: StaffUser = Depends(manager_access),
    db: Session = Depends(get_db),
):
    del current_staff
    return list_inventory_items(db, low_stock_only=True)


@router.get("/transactions", response_model=list[InventoryTransactionResponse])
def get_inventory_transactions(
    item_id: int | None = Query(default=None, gt=0),
    current_staff: StaffUser = Depends(manager_access),
    db: Session = Depends(get_db),
):
    del current_staff
    return list_inventory_transactions(db, item_id)


@router.post("/{item_id}/transactions", response_model=InventoryTransactionResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_transaction(
    item_id: int,
    transaction: InventoryTransactionCreate,
    current_staff: StaffUser = Depends(manager_access),
    db: Session = Depends(get_db),
):
    try:
        recorded = record_inventory_transaction(db, item_id, transaction, current_staff)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    if recorded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    return recorded
