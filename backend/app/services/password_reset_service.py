import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.models.customer import Customer
from app.db.models.password_reset_token import PasswordResetToken
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

GENERIC_FORGOT_PASSWORD_MESSAGE = (
    "If an account exists with that email address, you will receive instructions to reset your password."
)


def hash_reset_token(raw_token: str) -> str:
    """Compute deterministic SHA-256 hash of the raw token for secure storage and lookup."""
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def ensure_utc(dt: datetime) -> datetime:
    """Normalize datetime to timezone-aware UTC datetime."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def request_password_reset(
    db: Session,
    email: str,
    request_ip: str | None = None,
    user_agent: str | None = None,
) -> str:
    """Initiate password recovery for a customer account.

    Enforces rate limits by IP and email account, invalidates prior active
    tokens, safely persists a token hash, and dispatches the recovery email.
    Always returns a generic message to prevent account enumeration.
    """
    normalized_email = email.strip().lower()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=settings.PASSWORD_RESET_RATE_LIMIT_MINUTES)

    # 1. IP-level rate limiting
    if request_ip:
        recent_ip_requests = db.scalar(
            select(func.count())
            .select_from(PasswordResetToken)
            .where(
                PasswordResetToken.request_ip == request_ip,
                PasswordResetToken.created_at >= cutoff,
            )
        ) or 0

        if recent_ip_requests >= settings.PASSWORD_RESET_MAX_PER_IP:
            logger.warning(
                "Password reset rate limit exceeded for IP: %s (%d requests)",
                request_ip,
                recent_ip_requests,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many password reset requests from this network. Please wait before trying again.",
            )

    # 2. Look up customer (case-insensitive normalized email)
    customer = db.scalar(
        select(Customer).where(Customer.email == normalized_email)
    )

    if customer is None or not customer.email:
        # Prevent account enumeration: do not disclose if the email is registered
        logger.info(
            "Password reset requested for non-existent email address (enumeration prevented)."
        )
        return GENERIC_FORGOT_PASSWORD_MESSAGE

    # 3. Account-level rate limiting (inbox bombing protection)
    recent_account_requests = db.scalar(
        select(func.count())
        .select_from(PasswordResetToken)
        .where(
            PasswordResetToken.customer_id == customer.customer_id,
            PasswordResetToken.created_at >= cutoff,
        )
    ) or 0

    if recent_account_requests >= settings.PASSWORD_RESET_MAX_PER_EMAIL:
        logger.warning(
            "Password reset request rate limit reached for customer_id: %d",
            customer.customer_id,
        )
        # Return generic message without issuing another token or sending duplicate emails
        return GENERIC_FORGOT_PASSWORD_MESSAGE

    # 4. Invalidate any previously unconsumed tokens for this customer
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.customer_id == customer.customer_id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    # 5. Generate cryptographically strong random token
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_reset_token(raw_token)
    expires_at = now + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)

    token_record = PasswordResetToken(
        customer_id=customer.customer_id,
        token_hash=token_hash,
        expires_at=expires_at,
        created_at=now,
        request_ip=request_ip,
        user_agent=user_agent[:255] if user_agent else None,
    )
    db.add(token_record)
    db.commit()

    # 6. Deliver the recovery email
    try:
        email_service.send_password_reset_email(
            to_email=customer.email,
            recipient_name=customer.full_name,
            raw_token=raw_token,
        )
    except Exception as exc:
        logger.error("Failed to dispatch password reset email: %s", exc)
        # We do not leak email provider failures to the user response

    return GENERIC_FORGOT_PASSWORD_MESSAGE


def reset_password_with_token(
    db: Session,
    raw_token: str,
    new_password: str,
) -> Customer:
    """Consume a valid reset token, update customer password hash, and invalidate sessions.

    Atomically locks the token row with SELECT ... FOR UPDATE to prevent
    concurrent race conditions on single-use token consumption.
    """
    token_hash = hash_reset_token(raw_token)
    now = datetime.now(timezone.utc)

    # Row lock to prevent concurrent double-consumption
    token_record = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == token_hash)
        .with_for_update()
    )

    if token_record is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired. Please request a new one.",
        )

    if token_record.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link has already been used. Please request a new one.",
        )

    if ensure_utc(token_record.expires_at) <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link has expired. Please request a new one.",
        )

    customer = db.scalar(
        select(Customer)
        .where(Customer.customer_id == token_record.customer_id)
        .with_for_update()
    )

    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to locate customer account for this password reset request.",
        )

    # 1. Update password hash
    customer.password_hash = hash_password(new_password)

    # 2. Invalidate existing sessions: tokens with iat < password_changed_at are rejected
    customer.password_changed_at = now

    # 3. Mark the consumed token as used
    token_record.used_at = now

    # 4. Invalidate any remaining tokens for this customer
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.customer_id == customer.customer_id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    db.commit()
    db.refresh(customer)

    logger.info("Password successfully reset for customer_id: %d", customer.customer_id)
    return customer
