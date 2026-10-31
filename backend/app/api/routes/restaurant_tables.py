from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.fulfillment import RestaurantTableResponse
from app.services.fulfillment_service import list_restaurant_tables


router = APIRouter(prefix="/api/v1/restaurant-tables", tags=["Fulfillment"])


@router.get("", response_model=list[RestaurantTableResponse])
def get_restaurant_tables(db: Session = Depends(get_db)):
    return [RestaurantTableResponse(id=table.id, table_number=table.table_number, seats=table.seats, is_available=is_available) for table, is_available in list_restaurant_tables(db)]
