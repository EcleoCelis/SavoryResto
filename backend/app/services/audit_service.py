"""Audit logging service for administrative accountability and security monitoring."""

import json
import logging
from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.audit_log import AuditLog

logger = logging.getLogger("savorybites.audit")

SENSITIVE_KEYS = frozenset({
    "password", "password_hash", "legacy_password", "token", "access_token",
    "refresh_token", "secret", "cookie", "jwt", "authorization",
})


def _sanitize_details(details: dict[str, Any] | None) -> dict[str, Any] | None:
    if not details:
        return None
    sanitized = {}
    for key, value in details.items():
        if any(sens in key.lower() for sens in SENSITIVE_KEYS):
            sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_details(value)
        else:
            sanitized[key] = value
    return sanitized


def record_audit_event(
    db: Session,
    event_type: str,
    actor_type: str,
    actor_id: int | None = None,
    actor_email: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    outcome: str = "success",
    ip_address: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Record an immutable audit event in both PostgreSQL and structured logs."""
    clean_details = _sanitize_details(details)
    entry = AuditLog(
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_email=actor_email,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        outcome=outcome,
        ip_address=ip_address,
        user_agent=user_agent,
        details=clean_details,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # Emit structured log for SIEM / external audit pipelines
    log_payload = {
        "audit_id": entry.id,
        "event_type": event_type,
        "actor_type": actor_type,
        "actor_email": actor_email,
        "target_type": target_type,
        "target_id": target_id,
        "outcome": outcome,
        "ip_address": ip_address,
        "details": clean_details,
    }
    logger.info("AUDIT_EVENT: %s", json.dumps(log_payload))
    return entry


def list_audit_logs(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    event_type: str | None = None,
) -> list[AuditLog]:
    """Retrieve audit logs in descending chronological order."""
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    if event_type:
        query = query.where(AuditLog.event_type == event_type)
    return list(db.scalars(query).all())
