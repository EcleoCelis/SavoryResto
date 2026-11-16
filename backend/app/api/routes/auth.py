import logging
import time
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, get_client_ip, get_current_customer, get_optional_current_customer
from app.db.database import get_db
from app.db.models.customer import Customer
from app.schemas.auth import (
    CustomerMeResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from app.services.auth_service import authenticate_customer, register_customer
from app.services.password_reset_service import (
    request_password_reset,
    reset_password_with_token,
)

logger = logging.getLogger("savorybites.auth")

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Authentication"],
)

# Sliding window rate limiter for failed login attempts
_failed_login_attempts: dict[str, list[float]] = defaultdict(list)
LOGIN_FAILURE_WINDOW_SECONDS = 300  # 5 minutes
MAX_FAILED_LOGIN_ATTEMPTS = 10


def _check_login_rate_limit(client_ip: str) -> None:
    now = time.time()
    cutoff = now - LOGIN_FAILURE_WINDOW_SECONDS
    recent = [ts for ts in _failed_login_attempts.get(client_ip, []) if ts >= cutoff]
    if len(recent) >= MAX_FAILED_LOGIN_ATTEMPTS:
        logger.warning("Failed login rate limit exceeded for IP: %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Please wait 5 minutes before trying again.",
        )


def _record_failed_login(client_ip: str) -> None:
    now = time.time()
    cutoff = now - LOGIN_FAILURE_WINDOW_SECONDS
    recent = [ts for ts in _failed_login_attempts.get(client_ip, []) if ts >= cutoff]
    recent.append(now)
    _failed_login_attempts[client_ip] = recent


def _clear_failed_logins(client_ip: str) -> None:
    _failed_login_attempts.pop(client_ip, None)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    registration: RegisterRequest,
    db: Session = Depends(get_db),
):
    try:
        customer = register_customer(
            db=db,
            registration=registration,
        )

        return RegisterResponse(
            message="Account created successfully.",
            customer_id=customer.customer_id,
            email=customer.email,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        )

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address or mobile number already exists.",
        )


@router.get(
    "/me",
    response_model=CustomerMeResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Missing, invalid, expired, or unauthorized access token."
        }
    },
)
def get_me(
    current_customer: Customer = Depends(get_current_customer),
):
    return CustomerMeResponse(
        customer_id=current_customer.customer_id,
        full_name=current_customer.full_name,
        email=current_customer.email,
        phone=current_customer.phone,
        address=current_customer.address,
        avatar_url=current_customer.avatar_url,
        is_active=current_customer.is_active,
        created_at=current_customer.created_at,
        preferred_payment_code=current_customer.preferred_payment_code,
        default_order_type=current_customer.default_order_type,
        theme_preference=current_customer.theme_preference or "system",
    )


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
)
def login(
    login_request: LoginRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = get_client_ip(request)
    _check_login_rate_limit(client_ip)

    customer = authenticate_customer(
        db=db,
        login=login_request,
    )

    if customer is None:
        _record_failed_login(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Unable to sign in. "
                "Please check your email and password "
                "and try again."
            ),
        )

    _clear_failed_logins(client_ip)

    if login_request.remember_me:
        expires_delta = timedelta(
            days=settings.REMEMBER_ME_EXPIRE_DAYS
        )
    else:
        expires_delta = timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    access_token = create_access_token(
        customer_id=customer.customer_id,
        expires_delta=expires_delta,
    )

    max_age = int(
        expires_delta.total_seconds()
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=max_age,
        path="/",
    )
    # Prevent session confusion between customer and staff sessions
    if request.cookies.get("staff_access_token"):
        response.delete_cookie(
            key="staff_access_token",
            path="/",
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )

    return LoginResponse(
        message="Signed in successfully.",
        customer_id=customer.customer_id,
        email=customer.email,
        full_name=customer.full_name,
        access_token=access_token,
        token_type="bearer",
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Missing, invalid, expired, or unauthorized access token."
        }
    },
)
def logout(
    response: Response,
    current_customer: Customer | None = Depends(get_optional_current_customer),
):
    response.delete_cookie(
        key="access_token",
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )

    return LogoutResponse(message="Signed out successfully.")


@router.post(
    "/password/forgot",
    response_model=ForgotPasswordResponse,
    status_code=status.HTTP_200_OK,
)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Extract client IP and user agent safely respecting proxy trust
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent")

    message = request_password_reset(
        db=db,
        email=payload.email,
        request_ip=client_ip,
        user_agent=user_agent,
    )

    return ForgotPasswordResponse(message=message)


@router.post(
    "/password/reset",
    response_model=ResetPasswordResponse,
    status_code=status.HTTP_200_OK,
)
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    reset_password_with_token(
        db=db,
        raw_token=payload.token,
        new_password=payload.new_password,
    )

    return ResetPasswordResponse(
        message="Your password has been successfully reset. You can now sign in with your new password."
    )
