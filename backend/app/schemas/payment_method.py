from pydantic import BaseModel, ConfigDict


class PaymentMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    label: str
    description: str | None
