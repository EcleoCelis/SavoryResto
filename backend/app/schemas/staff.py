from datetime import datetime
from typing import Any
from pydantic import BaseModel, EmailStr, Field


class StaffLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    requested_role: str | None = Field(default=None, description="Requested destination/role: 'manager' or 'kitchen_staff'")
    remember_me: bool = False


class StaffResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str


class StaffLoginResponse(StaffResponse):
    message: str
    target_url: str = Field(default="/kds", description="Authoritative frontend route destination")
    authorized_roles: list[str] = Field(default_factory=list, description="Assigned roles for authenticated staff")
    access_token: str | None = Field(default=None, description="Staff bearer access token")
    token_type: str = Field(default="bearer", description="Token type")


class StaffCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    role: str = Field(pattern=r"^(kitchen_staff|manager)$", description="Assigned role: 'kitchen_staff' or 'manager'")
    password: str = Field(min_length=12, max_length=128)


class StaffStatusUpdateRequest(BaseModel):
    status: str = Field(pattern=r"^(active|inactive)$", description="Account status: 'active' or 'inactive'")


class StaffRoleUpdateRequest(BaseModel):
    role: str = Field(pattern=r"^(kitchen_staff|manager)$", description="Role to assign: 'kitchen_staff' or 'manager'")


class StaffDetailResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    status: str
    created_at: datetime
    updated_at: datetime


class AuditLogResponse(BaseModel):
    id: int
    event_type: str
    actor_type: str
    actor_id: int | None
    actor_email: str | None
    target_type: str | None
    target_id: str | None
    outcome: str
    created_at: datetime
    details: dict[str, Any] | None = None
