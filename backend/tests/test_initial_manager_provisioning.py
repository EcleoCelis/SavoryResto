"""Automated tests for initial Manager provisioning CLI and recovery mechanisms."""

import argparse
from io import StringIO
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.cli import (
    check_initial_manager_exists,
    cmd_create_initial_manager,
    cmd_recover_manager,
    cmd_status,
)
from app.core.security import verify_password
from app.db.database import SessionLocal
from app.db.models.audit_log import AuditLog
from app.db.models.staff import Role, StaffUser


class InitialManagerProvisioningTests(TestCase):
    def setUp(self):
        self.suffix = uuid4().hex[:8]
        self.test_email = f"initial-mgr-{self.suffix}@savorybites.staging"
        self.test_name = f"Initial Manager {self.suffix}"
        self.valid_password = "InitialManager2026!Secure"

    def tearDown(self):
        with SessionLocal() as db:
            db.query(AuditLog).filter(AuditLog.actor_email == self.test_email).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.email == self.test_email).delete(synchronize_session=False)
            db.commit()

    def test_status_reports_connectivity_and_roles(self):
        """Status command runs cleanly and reports canonical roles without secrets."""
        with patch("sys.stdout", new_callable=StringIO) as mock_out:
            code = cmd_status(argparse.Namespace())
            output = mock_out.getvalue()

        self.assertEqual(code, 0)
        self.assertIn("Database connectivity: CONNECTED", output)
        self.assertIn("Canonical Roles", output)
        self.assertIn("customer", output)
        self.assertIn("kitchen_staff", output)
        self.assertIn("manager", output)
        self.assertNotIn("password", output.lower())

    def test_provisioning_refuses_when_active_manager_already_exists(self):
        """Idempotency check: refuses duplicate provisioning when active manager exists."""
        with SessionLocal() as db:
            has_mgr, _ = check_initial_manager_exists(db)

        # In dev database, an active manager exists
        if not has_mgr:
            # Provision temporary manager to assert refusal
            with SessionLocal() as db:
                mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
                db.add(StaffUser(role_id=mgr_role.id, name="Temp", email=self.test_email, legacy_password="x", password_hash="x", status="active"))
                db.commit()

        args = argparse.Namespace(email=self.test_email, name=self.test_name)
        with patch("sys.stdout", new_callable=StringIO) as mock_out:
            code = cmd_create_initial_manager(args)
            output = mock_out.getvalue()

        self.assertEqual(code, 1)
        self.assertIn("Refusing execution", output)
        self.assertIn("An active Manager account already exists", output)

    def test_provisioning_succeeds_in_clean_environment(self):
        """When no active manager exists, initial manager is provisioned atomically."""
        # Temporarily deactivate active managers within a mock / isolated check
        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            active_manager_ids = list(db.scalars(select(StaffUser.id).where(StaffUser.role_id == mgr_role.id, StaffUser.status == "active")).all())
            for mid in active_manager_ids:
                u = db.get(StaffUser, mid)
                if u:
                    u.status = "inactive"
            db.commit()

        try:
            args = argparse.Namespace(email=self.test_email, name=self.test_name)
            mock_stdin = f"{self.valid_password}\n{self.valid_password}\n"

            with patch("sys.stdin", StringIO(mock_stdin)), patch("sys.stdout", new_callable=StringIO) as mock_out:
                code = cmd_create_initial_manager(args)
                output = mock_out.getvalue()

            self.assertEqual(code, 0)
            self.assertIn("Initial Manager provisioned successfully", output)

            # Verify in DB
            with SessionLocal() as db:
                user = db.scalar(select(StaffUser).where(StaffUser.email == self.test_email))
                self.assertIsNotNone(user)
                self.assertEqual(user.status, "active")
                self.assertEqual(user.role.name, "manager")
                self.assertTrue(user.password_hash.startswith("$argon2id$"))
                self.assertTrue(verify_password(self.valid_password, user.password_hash))

                # Verify Audit Log
                audit = db.scalar(select(AuditLog).where(AuditLog.event_type == "manager.initial_provisioning", AuditLog.actor_email == self.test_email))
                self.assertIsNotNone(audit)
                self.assertEqual(audit.outcome, "success")
                self.assertEqual(audit.actor_type, "cli")

        finally:
            # Restore active managers
            with SessionLocal() as db:
                for mid in active_manager_ids:
                    m_db = db.get(StaffUser, mid)
                    if m_db:
                        m_db.status = "active"
                db.commit()

    def test_password_policy_enforcement_in_cli(self):
        """CLI rejects passwords that violate complexity or length policy."""
        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            active_manager_ids = list(db.scalars(select(StaffUser.id).where(StaffUser.role_id == mgr_role.id, StaffUser.status == "active")).all())
            for mid in active_manager_ids:
                u = db.get(StaffUser, mid)
                if u:
                    u.status = "inactive"
            db.commit()

        try:
            # 1. Too short (< 12)
            args = argparse.Namespace(email=self.test_email, name=self.test_name)
            with patch("sys.stdin", StringIO("Short1!\nShort1!\n")), patch("sys.stdout", new_callable=StringIO) as mock_out:
                code = cmd_create_initial_manager(args)
                self.assertEqual(code, 1)
                self.assertIn("at least 12 characters", mock_out.getvalue())

            # 2. No special character
            with patch("sys.stdin", StringIO("NoSpecialChar123\nNoSpecialChar123\n")), patch("sys.stdout", new_callable=StringIO) as mock_out:
                code = cmd_create_initial_manager(args)
                self.assertEqual(code, 1)
                self.assertIn("special character", mock_out.getvalue())

            # 3. Confirmation mismatch
            with patch("sys.stdin", StringIO(f"{self.valid_password}\nDifferentPass123!\n")), patch("sys.stdout", new_callable=StringIO) as mock_out:
                code = cmd_create_initial_manager(args)
                self.assertEqual(code, 1)
                self.assertIn("does not match", mock_out.getvalue())

        finally:
            with SessionLocal() as db:
                for mid in active_manager_ids:
                    m_db = db.get(StaffUser, mid)
                    if m_db:
                        m_db.status = "active"
                db.commit()

    def test_emergency_manager_recovery(self):
        """Emergency recover-manager restores an inactive manager with a new password and logs audit event."""
        # Create inactive manager
        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            db.add(StaffUser(role_id=mgr_role.id, name=self.test_name, email=self.test_email, legacy_password="x", password_hash="x", status="inactive"))
            db.commit()

        new_password = "RecoveredManager2026!Key"
        args = argparse.Namespace(email=self.test_email)
        mock_stdin = f"{new_password}\n{new_password}\n"

        with patch("sys.stdin", StringIO(mock_stdin)), patch("sys.stdout", new_callable=StringIO) as mock_out:
            code = cmd_recover_manager(args)
            output = mock_out.getvalue()

        self.assertEqual(code, 0)
        self.assertIn("successfully restored to active status", output)

        with SessionLocal() as db:
            recovered = db.scalar(select(StaffUser).where(StaffUser.email == self.test_email))
            self.assertEqual(recovered.status, "active")
            self.assertTrue(verify_password(new_password, recovered.password_hash))

            # Audit event
            audit = db.scalar(select(AuditLog).where(AuditLog.event_type == "manager.recovery", AuditLog.actor_email == self.test_email))
            self.assertIsNotNone(audit)
            self.assertEqual(audit.outcome, "success")
