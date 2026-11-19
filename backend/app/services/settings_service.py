"""Authoritative service layer for SavoryBites restaurant configuration & cross-module rules."""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as app_config
from app.db.models.restaurant_settings import RestaurantBusinessHour, RestaurantSettings
from app.db.models.staff import StaffUser
from app.schemas.settings import (
    BusinessHourItem,
    BusinessHoursUpdateRequest,
    ManagerSettingsResponse,
    NotificationSettingsOut,
    NotificationSettingsUpdateRequest,
    OrderingSettingsOut,
    OrderingSettingsUpdateRequest,
    PublicRestaurantSettingsResponse,
    RestaurantInfoOut,
    RestaurantInfoUpdateRequest,
    SystemInfoOut,
)
from app.services.audit_service import record_audit_event
from app.services.payment_method_service import list_manager_payment_methods
from app.services.response_cache import invalidate_namespace

MANILA_TZ = ZoneInfo("Asia/Manila")

DAY_METADATA: tuple[tuple[int, str, str], ...] = (
    (0, "Sunday", "Sun"),
    (1, "Monday", "Mon"),
    (2, "Tuesday", "Tue"),
    (3, "Wednesday", "Wed"),
    (4, "Thursday", "Thu"),
    (5, "Friday", "Fri"),
    (6, "Saturday", "Sat"),
)
DAY_BY_INDEX = {idx: (name, short) for idx, name, short in DAY_METADATA}

DEFAULT_HOURS: tuple[tuple[int, bool, time, time], ...] = (
    (0, True, time(10, 0), time(21, 0)),
    (1, True, time(10, 0), time(21, 0)),
    (2, True, time(10, 0), time(21, 0)),
    (3, True, time(10, 0), time(21, 0)),
    (4, True, time(10, 0), time(21, 0)),
    (5, True, time(10, 0), time(22, 0)),
    (6, True, time(10, 0), time(22, 0)),
)


class SettingsConflictError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_hhmm(t: time) -> str:
    return f"{t.hour:02d}:{t.minute:02d}"


def _format_12h(t: time) -> str:
    dt = datetime(2026, 1, 1, t.hour, t.minute)
    return dt.strftime("%I:%M %p").lstrip("0")


def _parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def _py_weekday_to_day_of_week(py_weekday: int) -> int:
    """Convert Python weekday (0=Monday..6=Sunday) to schedule day_of_week (0=Sunday..6=Saturday)."""
    return (py_weekday + 1) % 7


def ensure_restaurant_settings(
    db: Session,
    *,
    for_update: bool = False,
    persist_if_missing: bool | None = None,
) -> tuple[RestaurantSettings, list[RestaurantBusinessHour]]:
    """Load singleton settings & 7-day schedule, provisioning safe defaults if missing."""
    should_persist = for_update if persist_if_missing is None else persist_if_missing
    stmt = select(RestaurantSettings).where(RestaurantSettings.id == 1)
    if for_update:
        stmt = stmt.with_for_update()
    cfg = db.scalar(stmt)
    created_any = False

    if cfg is None:
        now = _utc_now()
        cfg = RestaurantSettings(
            id=1,
            name="SavoryBites",
            tagline="Freshly made. Simply delicious.",
            locality="Buenavista, Bohol",
            full_address="Poblacion, Buenavista, Bohol, 6333 Philippines",
            phone="+63 917 123 4567",
            email="hello@savorybites.ph",
            timezone="Asia/Manila",
            kitchen_cutoff_minutes=30,
            kitchen_notice="Last food and beverage orders are accepted 30 minutes before closing time.",
            holiday_notice="Hours may vary on official national and municipal holidays. Please call ahead to confirm special holiday schedules.",
            online_ordering_enabled=True,
            online_ordering_pause_reason=None,
            dine_in_enabled=True,
            takeout_enabled=True,
            enforce_operating_hours=False,
            minimum_order_amount=Decimal("0.00"),
            send_order_confirmation_emails=True,
            send_contact_inquiry_emails=True,
            version=1,
            updated_at=now,
        )
        if should_persist:
            db.add(cfg)
            db.flush()
            created_any = True

    hours_stmt = select(RestaurantBusinessHour).order_by(RestaurantBusinessHour.day_of_week.asc())
    if for_update:
        hours_stmt = hours_stmt.with_for_update()
    hours_result = db.scalars(hours_stmt).all()
    hours = list(hours_result) if isinstance(hours_result, (list, tuple)) else []
    by_day = {h.day_of_week: h for h in hours}

    if len(by_day) < 7:
        now = _utc_now()
        added_hours = False
        for day_idx, is_open, open_t, close_t in DEFAULT_HOURS:
            if day_idx not in by_day:
                row = RestaurantBusinessHour(
                    day_of_week=day_idx,
                    is_open=is_open,
                    open_time=open_t,
                    close_time=close_t,
                    updated_at=now,
                )
                if should_persist:
                    db.add(row)
                    added_hours = True
                by_day[day_idx] = row
        if should_persist and added_hours:
            db.flush()
            created_any = True

    if created_any and not for_update:
        db.commit()
        db.refresh(cfg)

    ordered_hours = [by_day[idx] for idx in range(7)]
    return cfg, ordered_hours


def evaluate_operating_status(
    cfg: RestaurantSettings,
    hours: list[RestaurantBusinessHour],
    *,
    now: datetime | None = None,
) -> tuple[bool, str, bool]:
    """Return (is_currently_open, human_status_text, is_within_cutoff_order_window)."""
    tz = ZoneInfo(cfg.timezone or "Asia/Manila")
    ref_utc = now.astimezone(timezone.utc) if now else _utc_now()
    local_now = ref_utc.astimezone(tz)
    cur_dow = _py_weekday_to_day_of_week(local_now.weekday())
    prev_dow = (cur_dow - 1) % 7
    by_day = {h.day_of_week: h for h in hours}

    cur_time = local_now.time().replace(tzinfo=None)
    today_row = by_day[cur_dow]
    prev_row = by_day[prev_dow]

    is_open_now = False
    is_within_order_window = False
    status_text = "Closed today"

    # Check if yesterday had an overnight schedule carrying into early today
    if prev_row.is_open and prev_row.close_time < prev_row.open_time:
        if cur_time < prev_row.close_time:
            is_open_now = True
            cutoff_dt = datetime.combine(local_now.date(), prev_row.close_time) - timedelta(minutes=cfg.kitchen_cutoff_minutes)
            is_within_order_window = local_now.replace(tzinfo=None) < cutoff_dt
            status_text = f"Open until {_format_12h(prev_row.close_time)}"

    if not is_open_now and today_row.is_open:
        open_t = today_row.open_time
        close_t = today_row.close_time
        if close_t > open_t:
            if open_t <= cur_time < close_t:
                is_open_now = True
                close_dt = datetime.combine(local_now.date(), close_t)
                cutoff_dt = close_dt - timedelta(minutes=cfg.kitchen_cutoff_minutes)
                is_within_order_window = local_now.replace(tzinfo=None) < cutoff_dt
                remaining = int((close_dt - local_now.replace(tzinfo=None)).total_seconds() // 60)
                if remaining <= 45:
                    status_text = f"Closing soon at {_format_12h(close_t)}"
                else:
                    status_text = f"Open today until {_format_12h(close_t)}"
            elif cur_time < open_t:
                status_text = f"Closed now · Opens at {_format_12h(open_t)}"
            else:
                status_text = f"Closed for the night"
        else:
            # Overnight shift starting today
            if cur_time >= open_t:
                is_open_now = True
                close_dt = datetime.combine(local_now.date() + timedelta(days=1), close_t)
                cutoff_dt = close_dt - timedelta(minutes=cfg.kitchen_cutoff_minutes)
                is_within_order_window = local_now.replace(tzinfo=None) < cutoff_dt
                status_text = f"Open until {_format_12h(close_t)}"
            else:
                status_text = f"Closed now · Opens at {_format_12h(open_t)}"

    return is_open_now, status_text, is_within_order_window


def validate_ordering_policy(
    db: Session,
    *,
    order_type: str,
    subtotal: Decimal,
    now: datetime | None = None,
) -> RestaurantSettings:
    """Enforce authoritative ordering, channel, hours, and minimum order policies."""
    cfg, hours = ensure_restaurant_settings(db)

    if not cfg.online_ordering_enabled:
        reason = cfg.online_ordering_pause_reason or "Please check back shortly or contact the restaurant."
        raise ValueError(f"Online ordering is currently paused. {reason}")

    if order_type == "dine_in" and not cfg.dine_in_enabled:
        raise ValueError("Dine-in table service is currently unavailable.")
    if order_type == "takeout" and not cfg.takeout_enabled:
        raise ValueError("Takeout counter pickup is currently unavailable.")

    if cfg.minimum_order_amount > Decimal("0.00") and subtotal < cfg.minimum_order_amount:
        raise ValueError(
            f"Minimum order amount is PHP {cfg.minimum_order_amount:,.2f}."
        )

    if cfg.enforce_operating_hours:
        is_open, _, within_order_window = evaluate_operating_status(cfg, hours, now=now)
        if not is_open:
            raise ValueError(
                "Ordering is currently closed outside operating hours."
            )
        if not within_order_window:
            raise ValueError(
                f"Kitchen cut-off reached ({cfg.kitchen_cutoff_minutes} minutes before closing). New orders are temporarily closed."
            )

    return cfg


def _serialize_restaurant_info(cfg: RestaurantSettings) -> RestaurantInfoOut:
    return RestaurantInfoOut(
        name=cfg.name,
        tagline=cfg.tagline,
        locality=cfg.locality,
        full_address=cfg.full_address,
        phone=cfg.phone,
        email=cfg.email,
        timezone=cfg.timezone,
        kitchen_cutoff_minutes=cfg.kitchen_cutoff_minutes,
        kitchen_notice=cfg.kitchen_notice,
        holiday_notice=cfg.holiday_notice,
    )


def _serialize_hours(hours: list[RestaurantBusinessHour]) -> list[BusinessHourItem]:
    result: list[BusinessHourItem] = []
    for row in hours:
        day_name, short_day = DAY_BY_INDEX[row.day_of_week]
        result.append(
            BusinessHourItem(
                day_of_week=row.day_of_week,
                day_name=day_name,
                short_day=short_day,
                is_open=row.is_open,
                open_time=_format_hhmm(row.open_time),
                close_time=_format_hhmm(row.close_time),
            )
        )
    return result


def _serialize_ordering(cfg: RestaurantSettings) -> OrderingSettingsOut:
    return OrderingSettingsOut(
        online_ordering_enabled=cfg.online_ordering_enabled,
        online_ordering_pause_reason=cfg.online_ordering_pause_reason,
        dine_in_enabled=cfg.dine_in_enabled,
        takeout_enabled=cfg.takeout_enabled,
        enforce_operating_hours=cfg.enforce_operating_hours,
        kitchen_cutoff_minutes=cfg.kitchen_cutoff_minutes,
        minimum_order_amount=Decimal(str(cfg.minimum_order_amount)).quantize(Decimal("0.01")),
    )


def get_public_restaurant_settings(
    db: Session,
    *,
    now: datetime | None = None,
) -> PublicRestaurantSettingsResponse:
    cfg, hours = ensure_restaurant_settings(db)
    is_open, status_text, _ = evaluate_operating_status(cfg, hours, now=now)
    return PublicRestaurantSettingsResponse(
        restaurant=_serialize_restaurant_info(cfg),
        hours=_serialize_hours(hours),
        ordering=_serialize_ordering(cfg),
        is_currently_open=is_open,
        operating_status_text=status_text,
    )


def get_manager_settings(db: Session) -> ManagerSettingsResponse:
    cfg, hours = ensure_restaurant_settings(db)
    payment_methods = list_manager_payment_methods(db)
    return ManagerSettingsResponse(
        restaurant=_serialize_restaurant_info(cfg),
        hours=_serialize_hours(hours),
        ordering=_serialize_ordering(cfg),
        notifications=NotificationSettingsOut(
            send_order_confirmation_emails=cfg.send_order_confirmation_emails,
            send_contact_inquiry_emails=cfg.send_contact_inquiry_emails,
            smtp_configured=bool(app_config.SMTP_HOST),
        ),
        payment_methods=payment_methods,
        system_info=SystemInfoOut(
            environment=app_config.ENVIRONMENT,
            timezone=cfg.timezone,
            staff_session_timeout_minutes=app_config.STAFF_ACCESS_TOKEN_EXPIRE_MINUTES,
            version=cfg.version,
            updated_at=cfg.updated_at,
        ),
    )


def _check_expected_version(cfg: RestaurantSettings, expected_version: int | None) -> None:
    if expected_version is not None and cfg.version != expected_version:
        raise SettingsConflictError(
            "Settings were modified by another administrator. Reload latest values before saving."
        )


def update_restaurant_info(
    db: Session,
    *,
    request: RestaurantInfoUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerSettingsResponse:
    cfg, _ = ensure_restaurant_settings(db, for_update=True)
    _check_expected_version(cfg, request.expected_version)

    previous = {
        "name": cfg.name,
        "phone": cfg.phone,
        "email": cfg.email,
        "locality": cfg.locality,
    }
    cfg.name = request.name
    cfg.tagline = request.tagline
    cfg.locality = request.locality
    cfg.full_address = request.full_address
    cfg.phone = request.phone
    cfg.email = str(request.email).strip().lower()
    cfg.kitchen_notice = request.kitchen_notice
    cfg.holiday_notice = request.holiday_notice
    cfg.version += 1
    cfg.updated_at = _utc_now()
    cfg.updated_by = staff_user.id

    db.flush()
    record_audit_event(
        db=db,
        event_type="manager.settings.restaurant_update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="restaurant_settings",
        target_id="1",
        outcome="success",
        ip_address=ip_address,
        details={
            "version": cfg.version,
            "previous": previous,
            "updated": {"name": cfg.name, "phone": cfg.phone, "email": cfg.email, "locality": cfg.locality},
        },
    )
    invalidate_namespace("settings")
    return get_manager_settings(db)


def update_business_hours(
    db: Session,
    *,
    request: BusinessHoursUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerSettingsResponse:
    cfg, hours = ensure_restaurant_settings(db, for_update=True)
    _check_expected_version(cfg, request.expected_version)

    by_day = {h.day_of_week: h for h in hours}
    now = _utc_now()
    open_days_summary: list[str] = []
    for item in request.hours:
        row = by_day[item.day_of_week]
        row.is_open = item.is_open
        row.open_time = _parse_hhmm(item.open_time)
        row.close_time = _parse_hhmm(item.close_time)
        row.updated_at = now
        if item.is_open:
            open_days_summary.append(f"{DAY_BY_INDEX[item.day_of_week][1]} {item.open_time}-{item.close_time}")
        else:
            open_days_summary.append(f"{DAY_BY_INDEX[item.day_of_week][1]} Closed")

    cfg.version += 1
    cfg.updated_at = now
    cfg.updated_by = staff_user.id

    db.flush()
    record_audit_event(
        db=db,
        event_type="manager.settings.hours_update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="restaurant_settings",
        target_id="1",
        outcome="success",
        ip_address=ip_address,
        details={"version": cfg.version, "schedule": open_days_summary},
    )
    invalidate_namespace("settings")
    return get_manager_settings(db)


def update_ordering_settings(
    db: Session,
    *,
    request: OrderingSettingsUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerSettingsResponse:
    cfg, _ = ensure_restaurant_settings(db, for_update=True)
    _check_expected_version(cfg, request.expected_version)

    previous = {
        "online_ordering_enabled": cfg.online_ordering_enabled,
        "dine_in_enabled": cfg.dine_in_enabled,
        "takeout_enabled": cfg.takeout_enabled,
        "enforce_operating_hours": cfg.enforce_operating_hours,
        "kitchen_cutoff_minutes": cfg.kitchen_cutoff_minutes,
        "minimum_order_amount": str(cfg.minimum_order_amount),
    }

    cfg.online_ordering_enabled = request.online_ordering_enabled
    cfg.online_ordering_pause_reason = request.online_ordering_pause_reason
    cfg.dine_in_enabled = request.dine_in_enabled
    cfg.takeout_enabled = request.takeout_enabled
    cfg.enforce_operating_hours = request.enforce_operating_hours
    cfg.kitchen_cutoff_minutes = request.kitchen_cutoff_minutes
    cfg.minimum_order_amount = request.minimum_order_amount.quantize(Decimal("0.01"))
    cfg.version += 1
    cfg.updated_at = _utc_now()
    cfg.updated_by = staff_user.id

    db.flush()
    record_audit_event(
        db=db,
        event_type="manager.settings.ordering_update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="restaurant_settings",
        target_id="1",
        outcome="success",
        ip_address=ip_address,
        details={
            "version": cfg.version,
            "previous": previous,
            "updated": {
                "online_ordering_enabled": cfg.online_ordering_enabled,
                "dine_in_enabled": cfg.dine_in_enabled,
                "takeout_enabled": cfg.takeout_enabled,
                "enforce_operating_hours": cfg.enforce_operating_hours,
                "kitchen_cutoff_minutes": cfg.kitchen_cutoff_minutes,
                "minimum_order_amount": str(cfg.minimum_order_amount),
            },
        },
    )
    invalidate_namespace("settings")
    return get_manager_settings(db)


def update_notification_settings(
    db: Session,
    *,
    request: NotificationSettingsUpdateRequest,
    staff_user: StaffUser,
    ip_address: str | None = None,
) -> ManagerSettingsResponse:
    cfg, _ = ensure_restaurant_settings(db, for_update=True)
    _check_expected_version(cfg, request.expected_version)

    previous = {
        "send_order_confirmation_emails": cfg.send_order_confirmation_emails,
        "send_contact_inquiry_emails": cfg.send_contact_inquiry_emails,
    }
    cfg.send_order_confirmation_emails = request.send_order_confirmation_emails
    cfg.send_contact_inquiry_emails = request.send_contact_inquiry_emails
    cfg.version += 1
    cfg.updated_at = _utc_now()
    cfg.updated_by = staff_user.id

    db.flush()
    record_audit_event(
        db=db,
        event_type="manager.settings.notifications_update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="restaurant_settings",
        target_id="1",
        outcome="success",
        ip_address=ip_address,
        details={
            "version": cfg.version,
            "previous": previous,
            "updated": {
                "send_order_confirmation_emails": cfg.send_order_confirmation_emails,
                "send_contact_inquiry_emails": cfg.send_contact_inquiry_emails,
            },
        },
    )
    invalidate_namespace("settings")
    return get_manager_settings(db)
