"""Create or rotate a kitchen-staff or manager password without storing it in source control."""

import argparse
from datetime import datetime, timezone
import getpass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select

from app.core.password_policy import validate_password_strength, validate_staff_email
from app.core.security import hash_password
from app.db.database import SessionLocal
from app.db.models.staff import Role, StaffUser
from app.services.audit_service import record_audit_event
from app.services.staff_service import ALLOWED_STAFF_ROLES


def _read_password(prompt: str) -> str:
    if sys.stdin.isatty():
        return getpass.getpass(prompt)
    line = sys.stdin.readline()
    if not line:
        raise ValueError("Password input was empty or EOF reached.")
    return line.rstrip("\r\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision a kitchen staff or manager account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--role", choices=sorted(ALLOWED_STAFF_ROLES), required=True)
    arguments = parser.parse_args()

    valid_email, email_err = validate_staff_email(arguments.email)
    if not valid_email:
        raise SystemExit(f"[-] Invalid email: {email_err}")

    try:
        password = _read_password("Password: ")
        confirmation = _read_password("Confirm password: ")
    except Exception as exc:
        raise SystemExit(f"[-] Failed to read password: {exc}")

    if password != confirmation:
        raise SystemExit("[-] Passwords must match.")

    valid_pwd, pwd_err = validate_password_strength(password)
    if not valid_pwd:
        raise SystemExit(f"[-] Password does not meet security requirements: {pwd_err}")

    with SessionLocal() as db:
        role = db.scalar(select(Role).where(Role.name == arguments.role))
        if role is None:
            raise SystemExit(f"[-] The role '{arguments.role}' does not exist.")

        staff_user = db.scalar(select(StaffUser).where(StaffUser.email == arguments.email.lower()))
        password_hash = hash_password(password)
        now = datetime.now(timezone.utc)

        if staff_user is None:
            staff_user = StaffUser(
                role_id=role.id,
                name=arguments.name.strip(),
                email=arguments.email.lower(),
                legacy_password=password_hash,
                password_hash=password_hash,
                status="active",
                created_at=now,
                updated_at=now,
            )
            db.add(staff_user)
            db.flush()
            event_type = "staff.create"
        else:
            # Check last active manager demotion protection
            if staff_user.role.name == "manager" and arguments.role != "manager" and staff_user.status == "active":
                active_mgrs = db.scalar(
                    select(func.count(StaffUser.id)).join(Role).where(Role.name == "manager", StaffUser.status == "active")
                ) or 0
                if active_mgrs <= 1:
                    raise SystemExit("[-] Cannot demote the last active Manager account.")

            staff_user.role_id = role.id
            staff_user.name = arguments.name.strip()
            staff_user.legacy_password = password_hash
            staff_user.password_hash = password_hash
            staff_user.status = "active"
            staff_user.updated_at = now
            event_type = "staff.credential_rotation"

        record_audit_event(
            db=db,
            event_type=event_type,
            actor_type="cli",
            actor_email=arguments.email.lower(),
            target_type="staff",
            target_id=str(staff_user.id),
            outcome="success",
            details={"assigned_role": arguments.role, "name": staff_user.name},
        )
        db.commit()

    print("[+] Staff account provisioned. Password securely hashed and audit event recorded.")


if __name__ == "__main__":
    main()
