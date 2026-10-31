from pydantic import BaseModel, ConfigDict


class RestaurantTableResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    table_number: str
    seats: int
    is_available: bool
