from datetime import datetime

from pydantic import BaseModel, Field

from app.core.order_status import OrderStatus


class KdsOrderItemResponse(BaseModel):
    name: str
    quantity: int
    size: str | None
    addons: list[str]


class KdsOrderResponse(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    order_type: str
    fulfillment_type: str | None
    fulfillment_destination: str
    ordered_at: datetime
    items: list[KdsOrderItemResponse]


class KdsStatusUpdateRequest(BaseModel):
    status: OrderStatus
