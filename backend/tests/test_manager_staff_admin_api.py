"""Automated integration tests for Manager Privileged Staff IAM & Audit Logging APIs."""

import json
import socket
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import select

from app.core.security import create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.audit_log import AuditLog
from app.db.models.staff import Role, StaffUser


class ManagerStaffAdminApiTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.manager_email = f"mgr-iam-{suffix}@savorybites.staging"
        cls.kitchen_email = f"kit-iam-{suffix}@savorybites.staging"
        cls.secondary_mgr_email = f"mgr2-iam-{suffix}@savorybites.staging"
        cls.password = "AdminAuditPass2026!"
        password_hash = hash_password(cls.password)

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))

            db.add_all([
                StaffUser(role_id=mgr_role.id, name="IAM Manager Primary", email=cls.manager_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
                StaffUser(role_id=mgr_role.id, name="IAM Manager Secondary", email=cls.secondary_mgr_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
                StaffUser(role_id=kit_role.id, name="IAM Kitchen Staff", email=cls.kitchen_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
            ])
            db.commit()

            cls.manager_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.manager_email))
            cls.secondary_mgr_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.secondary_mgr_email))
            cls.kitchen_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.kitchen_email))

        cls.mgr_cookie = f"staff_access_token={create_staff_access_token(cls.manager_id, timedelta(hours=2))}"
        cls.kit_cookie = f"staff_access_token={create_staff_access_token(cls.kitchen_id, timedelta(hours=2))}"

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(40):
            try:
                if cls._request("/health")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)

        cls.server.terminate()
        raise RuntimeError("FastAPI server failed to start.")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        with SessionLocal() as db:
            db.query(AuditLog).filter(AuditLog.actor_email.in_([cls.manager_email, cls.kitchen_email, cls.secondary_mgr_email])).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email, cls.secondary_mgr_email])).delete(synchronize_session=False)
            db.commit()

    @classmethod
    def _request(cls, path, method="GET", body=None, headers=None):
        req_headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        request = Request(f"http://127.0.0.1:{cls.port}{path}", data=data, headers=req_headers, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                content = response.read()
                parsed = json.loads(content) if content else None
                return response.status, parsed, response.headers
        except HTTPError as error:
            content = error.read()
            parsed = json.loads(content) if content else None
            return error.code, parsed, error.headers

    def test_01_staff_list_rbac_enforcement(self):
        """Manager can list staff accounts; KDS and Unauthenticated are denied."""
        # Unauthenticated -> 401
        self.assertEqual(self._request("/api/v1/manager/staff")[0], 401)

        # Kitchen Staff -> 403
        kit_status, kit_resp, _ = self._request("/api/v1/manager/staff", headers={"Cookie": self.kit_cookie})
        self.assertEqual(kit_status, 403)

        # Manager -> 200
        mgr_status, staff_list, _ = self._request("/api/v1/manager/staff", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(mgr_status, 200)
        self.assertIsInstance(staff_list, list)
        self.assertGreaterEqual(len(staff_list), 3)

        # Passwords / hashes must never be exposed
        first = staff_list[0]
        self.assertNotIn("password", first)
        self.assertNotIn("password_hash", first)
        self.assertIn("email", first)
        self.assertIn("role", first)

    def test_02_manager_creates_new_staff_account(self):
        """Manager creates a new kitchen staff account; audit event is recorded."""
        new_email = f"cook-{uuid4().hex[:6]}@savorybites.staging"
        payload = {
            "name": "Line Cook Automated",
            "email": new_email,
            "role": "kitchen_staff",
            "password": "LineCook2026!Secure",
        }

        # Kitchen staff attempting creation -> 403
        self.assertEqual(self._request("/api/v1/manager/staff", method="POST", body=payload, headers={"Cookie": self.kit_cookie})[0], 403)

        # Manager creates staff -> 201
        status, created, _ = self._request("/api/v1/manager/staff", method="POST", body=payload, headers={"Cookie": self.mgr_cookie})
        self.assertEqual(status, 201)
        self.assertEqual(created["email"], new_email)
        self.assertEqual(created["role"], "kitchen_staff")
        self.assertEqual(created["status"], "active")

        # Verify audit log in DB
        with SessionLocal() as db:
            audit = db.scalar(select(AuditLog).where(AuditLog.event_type == "staff.create", AuditLog.target_id == str(created["id"])))
            self.assertIsNotNone(audit)
            self.assertEqual(audit.actor_id, self.manager_id)
            self.assertEqual(audit.outcome, "success")

            # Clean up created user
            db.query(StaffUser).filter(StaffUser.id == created["id"]).delete()
            db.commit()

    def test_03_self_deactivation_protection(self):
        """A Manager cannot deactivate their own Manager account."""
        status, body, _ = self._request(
            f"/api/v1/manager/staff/{self.manager_id}/status",
            method="PATCH",
            body={"status": "inactive"},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(status, 400)
        self.assertIn("cannot deactivate your own manager account", body["detail"].lower())

    def test_04_last_active_manager_protection(self):
        """System prevents deactivating or demoting the last active Manager account."""
        # Secondary manager deactivates primary manager -> Allowed (2 active managers exist)
        sec_mgr_cookie = f"staff_access_token={create_staff_access_token(self.secondary_mgr_id, timedelta(hours=1))}"
        status1, _, _ = self._request(
            f"/api/v1/manager/staff/{self.manager_id}/status",
            method="PATCH",
            body={"status": "inactive"},
            headers={"Cookie": sec_mgr_cookie},
        )
        self.assertEqual(status1, 200)

        # Check DB active managers count
        with SessionLocal() as db:
            # Temporarily deactivate any other managers so secondary_mgr is the only active one
            other_active_ids = list(db.scalars(
                select(StaffUser.id).join(Role)
                .where(Role.name == "manager", StaffUser.status == "active", StaffUser.id != self.secondary_mgr_id)
            ).all())
            for oid in other_active_ids:
                u = db.get(StaffUser, oid)
                if u:
                    u.status = "inactive"
            db.commit()

        try:
            # Now secondary_mgr is the sole active manager in the system!
            # Attempting to deactivate secondary_mgr using another session or self -> Rejected!
            status2, body2, _ = self._request(
                f"/api/v1/manager/staff/{self.secondary_mgr_id}/status",
                method="PATCH",
                body={"status": "inactive"},
                headers={"Cookie": sec_mgr_cookie},
            )
            # Both self-deactivation and last manager protections trigger
            self.assertEqual(status2, 400)

            # Attempting to demote the sole active manager -> Rejected!
            status3, body3, _ = self._request(
                f"/api/v1/manager/staff/{self.secondary_mgr_id}/role",
                method="PATCH",
                body={"role": "kitchen_staff"},
                headers={"Cookie": sec_mgr_cookie},
            )
            self.assertEqual(status3, 400)
            self.assertIn("last active manager", body3["detail"].lower())

        finally:
            # Restore other active managers safely using integer IDs
            with SessionLocal() as db:
                for oid in other_active_ids:
                    u = db.get(StaffUser, oid)
                    if u:
                        u.status = "active"
                p_mgr = db.get(StaffUser, self.manager_id)
                if p_mgr:
                    p_mgr.status = "active"
                db.commit()

    def test_05_audit_logs_endpoint_rbac_and_data_integrity(self):
        """Manager can query immutable audit logs; KDS is rejected."""
        self.assertEqual(self._request("/api/v1/manager/audit-logs", headers={"Cookie": self.kit_cookie})[0], 403)

        status, logs, _ = self._request("/api/v1/manager/audit-logs", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(status, 200)
        self.assertIsInstance(logs, list)
        self.assertGreater(len(logs), 0)

        # Verify no secrets in audit logs
        first_log = logs[0]
        self.assertIn("event_type", first_log)
        self.assertIn("outcome", first_log)
        self.assertNotIn("password", str(first_log).lower())

    def test_06_security_overview_and_analytics_endpoints(self):
        """Security overview and analytics summary return operational status to Managers."""
        # Security overview
        sec_status, sec_body, _ = self._request("/api/v1/manager/security/overview", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(sec_status, 200)
        self.assertEqual(sec_body["status"], "secure")
        self.assertGreaterEqual(sec_body["active_managers_count"], 1)
        self.assertIn("max_failed_logins_before_lockout", sec_body)

        # Analytics summary
        ana_status, ana_body, _ = self._request("/api/v1/manager/analytics/summary", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(ana_status, 200)
        self.assertIn("total_orders", ana_body)
        self.assertIn("total_revenue", ana_body)

        # Kitchen Staff rejected from both
        self.assertEqual(self._request("/api/v1/manager/security/overview", headers={"Cookie": self.kit_cookie})[0], 403)
        self.assertEqual(self._request("/api/v1/manager/analytics/summary", headers={"Cookie": self.kit_cookie})[0], 403)
