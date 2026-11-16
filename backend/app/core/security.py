import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Callable

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.permissions import Permission, has_permission
from app.db.database import get_db
from app.db.models.customer import Customer
from app.db.models.staff import StaffUser


logger = logging.getLogger("savorybites.security")


# ============================================================
# Password hashing
# ============================================================

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(
    password: str,
    password_hash: str,
) -> bool:
    try:
        return password_hasher.verify(
            password_hash,
            password,
        )
    except VerificationError:
        return False


# ============================================================
# JWT
# ============================================================

def create_access_token(
    customer_id: int,
    expires_delta: timedelta,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload = {
        "sub": str(customer_id),
        "iat": now,
        "exp": expire,
        "type": "access",
        "role": "customer",
    }

    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_staff_access_token(
    staff_id: int,
    expires_delta: timedelta,
    role: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict = {
        "sub": str(staff_id),
        "iat": now,
        "exp": now + expires_delta,
        "type": "staff",
    }
    if role is not None:
        payload["role"] = role
    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )


# ============================================================
# Authentication
# ============================================================

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)


def get_current_customer(
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)],
    access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
) -> Customer:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate authentication credentials.",
        headers={
            "WWW-Authenticate": "Bearer",
        },
    )

    # Browser sessions use the HTTP-only cookie set at login. API clients can
    # continue to authenticate with a standard Authorization: Bearer header.
    token = bearer_token or access_token

    if token is None:
        raise credentials_exception

    try:
        payload = decode_access_token(token)

        customer_id = payload.get("sub")
        token_type = payload.get("type")
        token_role = payload.get("role")

        if customer_id is None or token_type != "access":
            raise credentials_exception
        if token_role is not None and token_role != "customer":
            raise credentials_exception

        customer_id = int(customer_id)

    except (JWTError, ValueError, TypeError):
        raise credentials_exception

    customer = (
        db.query(Customer)
        .filter(
            Customer.customer_id == customer_id
        )
        .first()
    )

    if customer is None or not getattr(customer, "is_active", True):
        raise credentials_exception

    if customer.password_changed_at is not None:
        iat = payload.get("iat")
        if iat is None:
            raise credentials_exception
        changed_dt = customer.password_changed_at
        if changed_dt.tzinfo is None:
            changed_dt = changed_dt.replace(tzinfo=timezone.utc)
        if iat < int(changed_dt.timestamp()):
            raise credentials_exception

    return customer


def get_optional_current_customer(
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)] = None,
    access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
) -> Customer | None:
    token = bearer_token or access_token
    if token is None:
        return None

    try:
        payload = decode_access_token(token)
        customer_id = payload.get("sub")
        token_type = payload.get("type")
        token_role = payload.get("role")

        if customer_id is None or token_type != "access":
            return None
        if token_role is not None and token_role != "customer":
            return None

        customer_id = int(customer_id)
    except (JWTError, ValueError, TypeError):
        return None

    customer = (
        db.query(Customer)
        .filter(Customer.customer_id == customer_id)
        .first()
    )
    if customer is None or not getattr(customer, "is_active", True):
        return None

    if customer.password_changed_at is not None:
        iat = payload.get("iat")
        if iat is None:
            return None
        changed_dt = customer.password_changed_at
        if changed_dt.tzinfo is None:
            changed_dt = changed_dt.replace(tzinfo=timezone.utc)
        if iat < int(changed_dt.timestamp()):
            return None

    return customer


def get_current_staff(
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)],
    staff_access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
) -> StaffUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate staff authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = bearer_token or staff_access_token
    if token is None:
        logger.warning(
            "Staff auth failed: no token provided (bearer=%s, cookie=%s)",
            bool(bearer_token),
            bool(staff_access_token),
        )
        raise credentials_exception
    try:
        payload = decode_access_token(token)
        if payload.get("type") != "staff":
            logger.warning("Staff auth failed: invalid token type %s", payload.get("type"))
            raise credentials_exception
        staff_id = int(payload["sub"])
        token_role = payload.get("role")
    except (JWTError, ValueError, TypeError, KeyError) as e:
        logger.warning("Staff auth failed decoding token: %s", e)
        raise credentials_exception

    staff_user = db.query(StaffUser).options(joinedload(StaffUser.role)).filter(StaffUser.id == staff_id).first()
    if staff_user is None:
        logger.warning("Staff auth failed: staff user %s not found", staff_id)
        raise credentials_exception
    if staff_user.status != "active":
        logger.warning("Staff auth failed: staff user %s is not active (status=%s)", staff_id, staff_user.status)
        raise credentials_exception
    if staff_user.password_hash is None:
        logger.warning("Staff auth failed: staff user %s has no password hash", staff_id)
        raise credentials_exception
    if token_role is not None and token_role != staff_user.role.name:
        logger.warning(
            "Staff auth failed: token role claim '%s' does not match assigned role '%s' for staff user %s",
            token_role,
            staff_user.role.name,
            staff_id,
        )
        raise credentials_exception
    return staff_user


def get_optional_current_staff(
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)] = None,
    staff_access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
) -> StaffUser | None:
    token = bearer_token or staff_access_token
    if token is None:
        return None
    try:
        payload = decode_access_token(token)
        if payload.get("type") != "staff":
            return None
        staff_id = int(payload["sub"])
        token_role = payload.get("role")
    except (JWTError, ValueError, TypeError, KeyError):
        return None

    staff_user = db.query(StaffUser).options(joinedload(StaffUser.role)).filter(StaffUser.id == staff_id).first()
    if staff_user is None or staff_user.status != "active" or staff_user.password_hash is None:
        return None
    if token_role is not None and token_role != staff_user.role.name:
        return None
    return staff_user


def require_staff_roles(*allowed_roles: str) -> Callable:
    def dependency(current_staff: StaffUser = Depends(get_current_staff)) -> StaffUser:
        if current_staff.role.name not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not authorized for this staff operation.")
        return current_staff
    return dependency


def require_permission(permission: Permission | str) -> Callable:
    perm_obj = Permission(permission) if isinstance(permission, str) else permission

    def dependency(current_staff: StaffUser = Depends(get_current_staff)) -> StaffUser:
        if not has_permission(current_staff.role.name, perm_obj):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You lack the required '{perm_obj.value}' permission for this operation.",
            )
        return current_staff

    return dependency


def _parse_ip(ip_str: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if not ip_str:
        return None
    raw = ip_str.strip()
    # Strip brackets e.g. [2001:db8::1] or [::1]:8080
    if raw.startswith("["):
        bracket_end = raw.find("]")
        if bracket_end != -1:
            raw = raw[1:bracket_end]
    elif ":" in raw and raw.count(":") == 1:
        # IPv4 with port e.g. 192.168.1.1:54321
        raw = raw.split(":")[0]

    try:
        return ipaddress.ip_address(raw)
    except ValueError:
        return None


def _is_ip_in_trusted(
    ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address,
    trusted_list: list[str],
) -> bool:
    for entry in trusted_list:
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                net = ipaddress.ip_network(entry, strict=False)
                if ip_obj in net:
                    return True
            else:
                trusted_ip = ipaddress.ip_address(entry)
                if ip_obj == trusted_ip:
                    return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    """Safely extract client IP address respecting trusted proxy configuration, CIDR subnets, and IPv6."""
    direct_raw = request.client.host if request.client else "127.0.0.1"
    direct_obj = _parse_ip(direct_raw)
    if not direct_obj:
        return "127.0.0.1"

    if not settings.TRUSTED_PROXIES:
        return str(direct_obj)

    trusted = [ip.strip() for ip in settings.TRUSTED_PROXIES.split(",") if ip.strip()]
    if not _is_ip_in_trusted(direct_obj, trusted):
        return str(direct_obj)

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return str(direct_obj)

    candidates = [p.strip() for p in forwarded.split(",") if p.strip()]
    valid_ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []

    for item in reversed(candidates):
        obj = _parse_ip(item)
        if obj is None:
            # Skip invalid/malformed tokens
            continue
        valid_ips.append(obj)
        if not _is_ip_in_trusted(obj, trusted):
            return str(obj)

    if valid_ips:
        return str(valid_ips[-1])

    return str(direct_obj)

