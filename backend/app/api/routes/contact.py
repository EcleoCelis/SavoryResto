import logging
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.security import get_client_ip
from app.db.database import get_db
from app.schemas.contact import ContactInquiryRequest, ContactInquiryResponse
from app.services.email_service import email_service
from app.services.settings_service import ensure_restaurant_settings

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/contact",
    tags=["Contact"],
)

# In-memory sliding window rate limiter: IP -> list of timestamps
_contact_rate_limits: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW_SECONDS = 900  # 15 minutes
MAX_REQUESTS_PER_WINDOW = 5


def _check_ip_rate_limit(client_ip: str | None) -> None:
    if not client_ip:
        return
    now = time.time()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS

    # Filter out timestamps older than cutoff
    recent = [ts for ts in _contact_rate_limits[client_ip] if ts >= cutoff]
    if len(recent) >= MAX_REQUESTS_PER_WINDOW:
        logger.warning("Contact form rate limit exceeded for IP: %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You have sent several messages recently. Please wait a few minutes before submitting another inquiry.",
        )
    recent.append(now)
    _contact_rate_limits[client_ip] = recent


@router.post(
    "",
    response_model=ContactInquiryResponse,
    status_code=status.HTTP_200_OK,
)
def submit_contact_inquiry(
    payload: ContactInquiryRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Determine client IP respecting proxy trust
    client_ip = get_client_ip(request)

    _check_ip_rate_limit(client_ip)

    # Dispatch inquiry notification via email service when enabled in restaurant settings
    cfg, _ = ensure_restaurant_settings(db)
    if cfg.send_contact_inquiry_emails:
        try:
            email_service.send_contact_inquiry_email(
                sender_name=payload.name,
                sender_email=payload.email,
                subject=payload.subject,
                message=payload.message,
            )
        except Exception as exc:
            logger.error("Failed to forward contact inquiry: %s", exc)
            # Avoid leaking internal delivery exceptions to user
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="We were unable to process your message at this moment. Please try again later or call our restaurant directly.",
            )

    return ContactInquiryResponse(
        message="Thank you for reaching out to SavoryBites. Your message has been received, and our team will get back to you shortly."
    )
