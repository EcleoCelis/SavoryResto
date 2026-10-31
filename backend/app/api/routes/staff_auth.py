import logging
import time
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_staff_access_token,
    get_client_ip,
    get_current_staff,
    get_optional_current_staff,
)
from app.db.database import get_db
from app.db.models.staff import StaffUser
from app.schemas.staff import StaffLoginRequest, StaffLoginResponse, StaffResponse
from app.services.audit_service import record_audit_event
from app.services.staff_service import ALLOWED_STAFF_ROLES, authenticate_staff

logger = logging.getLogger("savorybites.staff_auth")

router = APIRouter(prefix="/api/v1/staff/auth", tags=["Staff Authentication"])

# Sliding window rate limiter for failed staff login attempts
_failed_staff_login_attempts: dict[str, list[float]] = defaultdict(list)
STAFF_LOGIN_FAILURE_WINDOW = 300  # 5 minutes
MAX_FAILED_STAFF_LOGINS = 10


def _check_staff_login_rate_limit(client_ip: str) -> None:
    now = time.time()
    cutoff = now - STAFF_LOGIN_FAILURE_WINDOW
    recent = [ts for ts in _failed_staff_login_attempts.get(client_ip, []) if ts >= cutoff]
    if len(recent) >= MAX_FAILED_STAFF_LOGINS:
        logger.warning("Failed staff login rate limit exceeded for IP: %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed staff sign-in attempts. Please wait 5 minutes before trying again.",
        )


def _record_failed_staff_login(client_ip: str) -> None:
    now = time.time()
    cutoff = now - STAFF_LOGIN_FAILURE_WINDOW
    recent = [ts for ts in _failed_staff_login_attempts.get(client_ip, []) if ts >= cutoff]
    recent.append(now)
    _failed_staff_login_attempts[client_ip] = recent


def _clear_failed_staff_logins(client_ip: str) -> None:
    _failed_staff_login_attempts.pop(client_ip, None)


def serialize_staff(staff_user: StaffUser) -> StaffResponse:
    return StaffResponse(id=staff_user.id, name=staff_user.name, email=staff_user.email, role=staff_user.role.name)


@router.post("/login", response_model=StaffLoginResponse)
def login(request: StaffLoginRequest, response: Response, req: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(req)
    _check_staff_login_rate_limit(client_ip)

    staff_user = authenticate_staff(db, request.email, request.password)
    if staff_user is None:
        _record_failed_staff_login(client_ip)
        logger.warning("Failed staff authentication attempt for email=%s from ip=%s", request.email, client_ip)
        record_audit_event(
            db=db,
            event_type="staff.login.failed",
            actor_type="staff",
            actor_email=str(request.email).lower(),
            outcome="failure",
            ip_address=client_ip,
            details={"reason": "invalid_credentials"},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid staff email or password.")
    if staff_user.role.name not in ALLOWED_STAFF_ROLES:
        _record_failed_staff_login(client_ip)
        logger.warning("Unauthorized staff access attempt by user_id=%s (role=%s) from ip=%s", staff_user.id, staff_user.role.name, client_ip)
        record_audit_event(
            db=db,
            event_type="staff.login.denied",
            actor_type="staff",
            actor_id=staff_user.id,
            actor_email=staff_user.email,
            outcome="denied",
            ip_address=client_ip,
            details={"reason": "unauthorized_role", "role": staff_user.role.name},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is not authorized for staff access.")

    # Server-enforced role and destination verification
    requested_role = request.requested_role.strip().lower() if request.requested_role else None
    if requested_role is not None:
        if requested_role not in ALLOWED_STAFF_ROLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid requested operational workspace destination.",
            )
        if staff_user.role.name != requested_role:
            logger.warning(
                "Staff role mismatch: user_id=%s (role=%s) attempted to access unauthorized destination '%s' from ip=%s",
                staff_user.id,
                staff_user.role.name,
                requested_role,
                client_ip,
            )
            dest_name = "Management Dashboard" if requested_role == "manager" else "Kitchen Display System (KDS)"
            record_audit_event(
                db=db,
                event_type="staff.login.denied",
                actor_type="staff",
                actor_id=staff_user.id,
                actor_email=staff_user.email,
                outcome="denied",
                ip_address=client_ip,
                details={"reason": "role_destination_mismatch", "assigned_role": staff_user.role.name, "requested_role": requested_role},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your staff account is not authorized for the {dest_name}.",
            )

    _clear_failed_staff_logins(client_ip)

    target_url = "/manager" if staff_user.role.name == "manager" else "/kds"
    logger.info(
        "Successful staff sign-in: user_id=%s, email=%s, role=%s, destination=%s from ip=%s",
        staff_user.id,
        staff_user.email,
        staff_user.role.name,
        target_url,
        client_ip,
    )
    record_audit_event(
        db=db,
        event_type="staff.login.success",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        outcome="success",
        ip_address=client_ip,
        details={"role": staff_user.role.name, "target_url": target_url},
    )

    expires = timedelta(days=7) if request.remember_me else timedelta(minutes=settings.STAFF_ACCESS_TOKEN_EXPIRE_MINUTES)
    token_str = create_staff_access_token(staff_user.id, expires)
    response.set_cookie(
        "staff_access_token",
        token_str,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(expires.total_seconds()),
        path="/",
    )
    return StaffLoginResponse(
        message="Staff sign-in successful.",
        target_url=target_url,
        authorized_roles=[staff_user.role.name],
        access_token=token_str,
        token_type="bearer",
        **serialize_staff(staff_user).model_dump(),
    )


@router.get("/me", response_model=StaffResponse)
def get_me(current_staff: StaffUser = Depends(get_current_staff)):
    return serialize_staff(current_staff)


@router.post("/logout")
def logout(
    response: Response,
    current_staff: StaffUser | None = Depends(get_optional_current_staff),
    db: Session = Depends(get_db),
):
    if current_staff:
        logger.info("Staff signed out: user_id=%s, role=%s", current_staff.id, current_staff.role.name)
        record_audit_event(
            db=db,
            event_type="staff.logout",
            actor_type="staff",
            actor_id=current_staff.id,
            actor_email=current_staff.email,
            outcome="success",
        )
    response.delete_cookie(
        "staff_access_token",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return {"message": "Staff signed out successfully."}
