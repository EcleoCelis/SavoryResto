"""SavoryBites Administrative CLI.

Commands:
- create-initial-manager: One-time atomic initial Manager account provisioning.
- recover-manager: Authorized host-level emergency recovery of a Manager account.
- status: Health, role, and initial provisioning readiness report.
"""

import argparse
from datetime import datetime, timezone
import getpass
import os
import sys
from typing import NoReturn

from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.password_policy import validate_password_strength, validate_staff_email
from app.core.security import hash_password
from app.db.database import SessionLocal, engine
from app.db.models.staff import Role, StaffUser
from app.services.audit_service import record_audit_event


def _read_password(prompt: str) -> str:
    """Read password securely via terminal getpass or standard input if piped."""
    if sys.stdin.isatty():
        return getpass.getpass(prompt)
    line = sys.stdin.readline()
    if not line:
        raise ValueError("Password input was empty or EOF reached.")
    return line.rstrip("\r\n")


def check_initial_manager_exists(db) -> tuple[bool, str | None]:
    """Check whether an active Manager account is already provisioned in the database."""
    manager_role = db.scalar(select(Role).where(Role.name == "manager"))
    if not manager_role:
        return False, None
    mgr = db.scalar(
        select(StaffUser)
        .where(StaffUser.role_id == manager_role.id, StaffUser.status == "active")
        .order_by(StaffUser.id)
    )
    if mgr:
        return True, mgr.email
    return False, None


def cmd_create_initial_manager(args: argparse.Namespace) -> int:
    """Execute one-time, concurrency-safe initial Manager account creation."""
    print("=" * 65)
    print("  SAVORYBITES INITIAL MANAGER PROVISIONING")
    print("=" * 65)

    try:
        with SessionLocal() as db:
            # 1. Acquire exclusive lock on the manager role row to guarantee concurrency safety
            manager_role = db.scalar(
                select(Role).where(Role.name == "manager").with_for_update()
            )
            if not manager_role:
                print("[-] Fatal error: The 'manager' role does not exist in the database.")
                print("    Please run database migrations and seeds before provisioning.")
                return 1

            # 2. Check if an active Manager already exists
            existing_manager = db.scalar(
                select(StaffUser)
                .where(StaffUser.role_id == manager_role.id, StaffUser.status == "active")
                .with_for_update()
            )
            if existing_manager:
                print(f"[-] Refusing execution: An active Manager account already exists ({existing_manager.email}).")
                print("    Duplicate initial Manager provisioning is strictly prohibited.")
                return 1

            # 3. Securely collect email and name
            email = args.email.strip() if args.email else input("Manager Email: ").strip()
            valid_email, email_err = validate_staff_email(email)
            if not valid_email:
                print(f"[-] Invalid email: {email_err}")
                return 1

            # Verify email is not already taken by another account
            existing_email_user = db.scalar(select(StaffUser).where(StaffUser.email == email.lower()))
            if existing_email_user:
                print(f"[-] Account identifier '{email.lower()}' is already registered in the system.")
                print("    Cannot overwrite existing records during initial provisioning.")
                return 1

            name = args.name.strip() if args.name else input("Manager Full Name: ").strip()
            if not name:
                print("[-] Full name cannot be blank.")
                return 1

            # 4. Secure interactive password entry (never accepted via command line flags)
            try:
                password = _read_password("Initial Password: ")
                confirmation = _read_password("Confirm Password: ")
            except Exception as exc:
                print(f"[-] Failed to read password input: {exc}")
                return 1

            if password != confirmation:
                print("[-] Password confirmation does not match.")
                return 1

            valid_pwd, pwd_err = validate_password_strength(password)
            if not valid_pwd:
                print(f"[-] Password does not meet security requirements: {pwd_err}")
                return 1

            # 5. Cryptographic hash via Argon2id
            pwd_hash = hash_password(password)

            # 6. Insert new active Manager
            now = datetime.now(timezone.utc)
            new_manager = StaffUser(
                role_id=manager_role.id,
                name=name,
                email=email.lower(),
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
                created_at=now,
                updated_at=now,
            )
            db.add(new_manager)
            db.flush()

            # 7. Record immutable audit event
            record_audit_event(
                db=db,
                event_type="manager.initial_provisioning",
                actor_type="cli",
                actor_id=new_manager.id,
                actor_email=new_manager.email,
                target_type="staff",
                target_id=str(new_manager.id),
                outcome="success",
                details={"name": name, "assigned_role": "manager"},
            )

            db.commit()
            print(f"[+] Initial Manager provisioned successfully: {new_manager.email}")
            print(f"    Account ID: {new_manager.id} | Status: active | Role: manager")
            print("    You may now authenticate at: /staff/login")
            return 0

    except SQLAlchemyError as exc:
        print(f"[-] Database operation failed: {exc}")
        return 1


def cmd_recover_manager(args: argparse.Namespace) -> int:
    """Execute authorized emergency recovery of a Manager account from the host server."""
    print("=" * 65)
    print("  SAVORYBITES AUTHORIZED MANAGER RECOVERY")
    print("=" * 65)

    email = args.email.strip().lower() if args.email else input("Manager Email to recover: ").strip().lower()
    if not email:
        print("[-] Email cannot be blank.")
        return 1

    try:
        with SessionLocal() as db:
            manager_role = db.scalar(select(Role).where(Role.name == "manager"))
            if not manager_role:
                print("[-] Manager role missing from database.")
                return 1

            manager_user = db.scalar(
                select(StaffUser)
                .where(StaffUser.email == email, StaffUser.role_id == manager_role.id)
                .with_for_update()
            )
            if not manager_user:
                print(f"[-] No Manager account found matching '{email}'.")
                return 1

            print(f"[*] Recovering Manager account ID {manager_user.id} ({manager_user.name}).")
            try:
                password = _read_password("New Manager Password: ")
                confirmation = _read_password("Confirm New Password: ")
            except Exception as exc:
                print(f"[-] Failed to read password: {exc}")
                return 1

            if password != confirmation:
                print("[-] Passwords do not match.")
                return 1

            valid_pwd, pwd_err = validate_password_strength(password)
            if not valid_pwd:
                print(f"[-] Password does not meet policy: {pwd_err}")
                return 1

            pwd_hash = hash_password(password)
            manager_user.password_hash = pwd_hash
            manager_user.legacy_password = pwd_hash
            manager_user.status = "active"
            manager_user.updated_at = datetime.now(timezone.utc)

            record_audit_event(
                db=db,
                event_type="manager.recovery",
                actor_type="cli",
                actor_id=manager_user.id,
                actor_email=manager_user.email,
                target_type="staff",
                target_id=str(manager_user.id),
                outcome="success",
                details={"action": "password_reset_and_reactivation"},
            )
            db.commit()
            print(f"[+] Manager account '{email}' successfully restored to active status with new credentials.")
            return 0

    except SQLAlchemyError as exc:
        print(f"[-] Database operation failed: {exc}")
        return 1


def cmd_status(_args: argparse.Namespace) -> int:
    """Report database connectivity, role schema, and initial provisioning status."""
    print("=" * 65)
    print("  SAVORYBITES AUTHENTICATION & PROVISIONING STATUS")
    print("=" * 65)
    try:
        with engine.connect() as conn:
            one = conn.execute(text("SELECT 1")).scalar()
            db_connected = one == 1
    except Exception as exc:
        print(f"[-] Database connectivity: OFFLINE ({exc})")
        return 1

    print("[+] Database connectivity: CONNECTED")

    with SessionLocal() as db:
        roles = list(db.scalars(select(Role).order_by(Role.id)).all())
        print(f"[+] Canonical Roles ({len(roles)}):")
        for r in roles:
            print(f"    - ID {r.id}: {r.name} ({r.description or 'No description'})")

        has_mgr, mgr_email = check_initial_manager_exists(db)
        if has_mgr:
            print(f"[+] Initial Manager Provisioning: COMPLETED (Active manager: {mgr_email})")
        else:
            print("[!] Initial Manager Provisioning: PENDING (No active manager found)")

        # Counts
        active_mgrs = db.scalar(
            select(func.count(StaffUser.id)).join(Role).where(Role.name == "manager", StaffUser.status == "active")
        ) or 0
        active_kit = db.scalar(
            select(func.count(StaffUser.id)).join(Role).where(Role.name == "kitchen_staff", StaffUser.status == "active")
        ) or 0
        print(f"[+] Staff Accounts: {active_mgrs} active Manager(s), {active_kit} active Kitchen Staff")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="SavoryBites Operational and Administrative CLI",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # create-initial-manager
    p_init = subparsers.add_parser(
        "create-initial-manager",
        help="One-time secure initial Manager account provisioning",
    )
    p_init.add_argument("--email", required=False, help="Manager email address")
    p_init.add_argument("--name", required=False, help="Manager full name")
    p_init.set_defaults(func=cmd_create_initial_manager)

    # recover-manager
    p_rec = subparsers.add_parser(
        "recover-manager",
        help="Authorized host-level emergency recovery of a Manager account",
    )
    p_rec.add_argument("--email", required=False, help="Manager email address to recover")
    p_rec.set_defaults(func=cmd_recover_manager)

    # status
    p_stat = subparsers.add_parser(
        "status",
        help="Display authentication, role schema, and provisioning status",
    )
    p_stat.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
