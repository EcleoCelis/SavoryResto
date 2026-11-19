from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.permissions import Permission
from app.core.security import get_client_ip, require_permission
from app.db.database import get_db
from app.db.models.staff import StaffUser
from app.schemas.settings import (
    BusinessHoursUpdateRequest,
    ManagerSettingsResponse,
    NotificationSettingsUpdateRequest,
    OrderingSettingsUpdateRequest,
    PublicRestaurantSettingsResponse,
    RestaurantInfoUpdateRequest,
)
from app.services.response_cache import cached_json_response
from app.services.settings_service import (
    SettingsConflictError,
    get_manager_settings,
    get_public_restaurant_settings,
    update_business_hours,
    update_notification_settings,
    update_ordering_settings,
    update_restaurant_info,
)

router = APIRouter(tags=["Restaurant & Manager Settings"])

perm_system_config = require_permission(Permission.SYSTEM_CONFIG_MANAGE)


@router.get("/api/v1/restaurant/settings", response_model=PublicRestaurantSettingsResponse)
def read_public_restaurant_settings(request: Request, db: Session = Depends(get_db)):
    """Publicly expose non-sensitive SavoryBites restaurant info, hours, and ordering rules."""
    return cached_json_response(
        request,
        namespace="settings",
        cache_key="settings:public",
        ttl_seconds=15,
        max_age_seconds=30,
        swr_seconds=120,
        compute_json_bytes=lambda: get_public_restaurant_settings(db).model_dump_json().encode("utf-8"),
    )


@router.get("/api/v1/manager/settings", response_model=ManagerSettingsResponse)
def read_manager_settings(
    current_staff: StaffUser = Depends(perm_system_config),
    db: Session = Depends(get_db),
):
    del current_staff
    return get_manager_settings(db)


@router.patch("/api/v1/manager/settings/restaurant", response_model=ManagerSettingsResponse)
def patch_restaurant_info(
    payload: RestaurantInfoUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_system_config),
    db: Session = Depends(get_db),
):
    try:
        return update_restaurant_info(
            db,
            request=payload,
            staff_user=current_staff,
            ip_address=get_client_ip(req),
        )
    except SettingsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/api/v1/manager/settings/hours", response_model=ManagerSettingsResponse)
def patch_business_hours(
    payload: BusinessHoursUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_system_config),
    db: Session = Depends(get_db),
):
    try:
        return update_business_hours(
            db,
            request=payload,
            staff_user=current_staff,
            ip_address=get_client_ip(req),
        )
    except SettingsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/api/v1/manager/settings/ordering", response_model=ManagerSettingsResponse)
def patch_ordering_settings(
    payload: OrderingSettingsUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_system_config),
    db: Session = Depends(get_db),
):
    try:
        return update_ordering_settings(
            db,
            request=payload,
            staff_user=current_staff,
            ip_address=get_client_ip(req),
        )
    except SettingsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/api/v1/manager/settings/notifications", response_model=ManagerSettingsResponse)
def patch_notification_settings(
    payload: NotificationSettingsUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_system_config),
    db: Session = Depends(get_db),
):
    try:
        return update_notification_settings(
            db,
            request=payload,
            staff_user=current_staff,
            ip_address=get_client_ip(req),
        )
    except SettingsConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
