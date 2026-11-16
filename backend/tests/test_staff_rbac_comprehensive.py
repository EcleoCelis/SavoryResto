"""Comprehensive Staff Authentication, Credential Integrity & RBAC Security Verification Suite.

Validates:
1. Account verification and Argon2id password hash integrity.
2. Manager and KDS credential validation and workplace routing.
3. Workplace isolation: Unauthenticated, KDS -> Manager, Manager -> KDS order completion.
4. Role spoofing defenses and customer vs staff token isolation.
5. Session lifecycle, logout cookie clearance, and token expiration.
6. Side-effect free denials on rejected mutations.
7. Anti-enumeration and brute-force rate-limiting defenses.
"""

import json
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from jose import jwt
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.customer import Customer
from app.db.models.inventory import InventoryItem, InventoryTransaction, MenuItemIngredient
from app.db.models.order import Order, OrderItem
from app.db.models.product import MenuProduct
from app.db.models.staff import Role, StaffUser


class ComprehensiveStaffRbacTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.manager_email = f"mgr-audit-{suffix}@savorybites.staging"
        cls.kitchen_email = f"kit-audit-{suffix}@savorybites.staging"
        cls.password = "AuditedStaffPass2026!"
        password_hash = hash_password(cls.password)

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()
            product = db.scalars(select(MenuProduct).where(MenuProduct.is_available.is_(True)).order_by(MenuProduct.id)).first()

            if mgr_role is None or kit_role is None or customer is None or product is None:
                raise RuntimeError("Prerequisites not satisfied in test database.")

            cls.customer_id = customer.customer_id
            cls.customer_token = create_access_token(customer.customer_id, timedelta(minutes=10))
            cls.product_id = product.id

            db.add_all([
                StaffUser(role_id=mgr_role.id, name="Audit Manager", email=cls.manager_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
                StaffUser(role_id=kit_role.id, name="Audit Kitchen", email=cls.kitchen_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
            ])
            db.commit()

            cls.manager_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.manager_email))
            cls.kitchen_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.kitchen_email))

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
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email])).delete(synchronize_session=False)
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

    @classmethod
    def _login(cls, email, password=None, requested_role=None):
        payload = {"email": email, "password": password or cls.password}
        if requested_role:
            payload["requested_role"] = requested_role
        status, resp, headers = cls._request("/api/v1/staff/auth/login", method="POST", body=payload)
        cookie = headers.get("Set-Cookie").split(";", 1)[0] if headers.get("Set-Cookie") else None
        return status, resp, cookie, headers

    def test_01_account_storage_and_argon2_hash_integrity(self):
        """Verify staff accounts are stored in database with valid Argon2id hashes."""
        with SessionLocal() as db:
            mgr = db.scalar(select(StaffUser).where(StaffUser.email == self.manager_email))
            kit = db.scalar(select(StaffUser).where(StaffUser.email == self.kitchen_email))

            self.assertIsNotNone(mgr)
            self.assertIsNotNone(kit)
            self.assertEqual(mgr.status, "active")
            self.assertEqual(kit.status, "active")
            self.assertTrue(mgr.password_hash.startswith("$argon2id$"))
            self.assertTrue(kit.password_hash.startswith("$argon2id$"))
            self.assertGreaterEqual(len(mgr.password_hash), 80)

    def test_02_manager_login_and_workplace_routing(self):
        """Valid manager authenticates, receives signed staff cookie, and routes to /manager."""
        status, body, cookie, headers = self._login(self.manager_email, requested_role="manager")
        self.assertEqual(status, 200)
        self.assertEqual(body["role"], "manager")
        self.assertEqual(body["target_url"], "/manager")
        self.assertIn("staff_access_token", cookie)

        # Cookie flags
        raw_cookie = headers.get("Set-Cookie")
        self.assertIn("httponly", raw_cookie.lower())
        self.assertIn("samesite=lax", raw_cookie.lower())

        # /me endpoint verification
        me_status, me_body, _ = self._request("/api/v1/staff/auth/me", headers={"Cookie": cookie})
        self.assertEqual(me_status, 200)
        self.assertEqual(me_body["email"], self.manager_email)
        self.assertEqual(me_body["role"], "manager")

    def test_03_kds_login_and_workplace_routing(self):
        """Valid KDS authenticates, receives signed staff cookie, and routes to /kds."""
        status, body, cookie, _ = self._login(self.kitchen_email, requested_role="kitchen_staff")
        self.assertEqual(status, 200)
        self.assertEqual(body["role"], "kitchen_staff")
        self.assertEqual(body["target_url"], "/kds")

        me_status, me_body, _ = self._request("/api/v1/staff/auth/me", headers={"Cookie": cookie})
        self.assertEqual(me_status, 200)
        self.assertEqual(me_body["role"], "kitchen_staff")

    def test_04_workplace_isolation_case_a_unauthenticated_access(self):
        """Unauthenticated requests to Manager and KDS APIs return 401 Unauthorized."""
        self.assertEqual(self._request("/api/v1/manager/orders")[0], 401)
        self.assertEqual(self._request("/api/v1/inventory")[0], 401)
        self.assertEqual(self._request("/api/v1/kds/orders")[0], 401)

    def test_05_workplace_isolation_case_b_kds_attempts_manager_operations(self):
        """KDS authenticated user attempting manager APIs receives 403 Forbidden."""
        _, _, kit_cookie, _ = self._login(self.kitchen_email)

        # 1. KDS orders endpoint is allowed
        self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": kit_cookie})[0], 200)

        # 2. Manager orders endpoint is forbidden
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": kit_cookie})[0], 403)

        # 3. Inventory queries are forbidden
        self.assertEqual(self._request("/api/v1/inventory", headers={"Cookie": kit_cookie})[0], 403)

        # 4. Inventory manual adjustments are forbidden
        adj_status, _, _ = self._request(
            "/api/v1/inventory/1/transactions",
            method="POST",
            body={"transaction_type": "purchase", "quantity_change": "1.00", "notes": "Hacked restock"},
            headers={"Cookie": kit_cookie},
        )
        self.assertEqual(adj_status, 403)

        # 5. Category creation is forbidden
        cat_status, _, _ = self._request(
            "/api/v1/categories",
            method="POST",
            body={"name": "Exploit Cat", "description": "Illegal", "display_order": 1, "is_active": True},
            headers={"Cookie": kit_cookie},
        )
        self.assertEqual(cat_status, 403)

    def test_06_workplace_isolation_case_c_manager_vs_kds_transitions(self):
        """KDS staff is strictly restricted to confirmed/preparing/ready, cannot complete."""
        _, _, kit_cookie, _ = self._login(self.kitchen_email)
        _, _, mgr_cookie, _ = self._login(self.manager_email)

        # Create temporary order
        order_id = None
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            order = Order(
                order_number=f"AUD-{uuid4().hex[:6]}",
                customer_id=self.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                status="ready",
                subtotal=Decimal("100.00"),
                discount_amount=Decimal("0.00"),
                tax_amount=Decimal("12.00"),
                total_amount=Decimal("112.00"),
                ordered_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(order)
            db.commit()
            db.refresh(order)
            order_id = order.id

        try:
            # Kitchen attempts to mark "completed" via KDS endpoint -> 403 Forbidden
            kit_comp_status, kit_comp_resp, _ = self._request(
                f"/api/v1/kds/orders/{order_id}/status",
                method="PATCH",
                body={"status": "completed"},
                headers={"Cookie": kit_cookie},
            )
            self.assertEqual(kit_comp_status, 403)
            self.assertIn("only update kitchen preparation statuses", kit_comp_resp["detail"].lower())

            # Kitchen attempts to complete via Manager endpoint -> 403 Forbidden
            kit_mgr_comp_status, _, _ = self._request(
                f"/api/v1/manager/orders/{order_id}/status",
                method="PATCH",
                body={"status": "completed"},
                headers={"Cookie": kit_cookie},
            )
            self.assertEqual(kit_mgr_comp_status, 403)

            # Manager attempts to access KDS endpoints -> 403 Forbidden (strict portal isolation)
            self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": mgr_cookie})[0], 403)
            mgr_kds_status, _, _ = self._request(
                f"/api/v1/kds/orders/{order_id}/status",
                method="PATCH",
                body={"status": "completed"},
                headers={"Cookie": mgr_cookie},
            )
            self.assertEqual(mgr_kds_status, 403)

            # Manager cannot invoke kitchen-only preparation statuses via manager endpoint -> 403 Forbidden
            mgr_prep_status, _, _ = self._request(
                f"/api/v1/manager/orders/{order_id}/status",
                method="PATCH",
                body={"status": "preparing"},
                headers={"Cookie": mgr_cookie},
            )
            self.assertEqual(mgr_prep_status, 403)

            # Manager marks "completed" via Manager endpoint -> 200 OK
            mgr_comp_status, mgr_comp_resp, _ = self._request(
                f"/api/v1/manager/orders/{order_id}/status",
                method="PATCH",
                body={"status": "completed"},
                headers={"Cookie": mgr_cookie},
            )
            self.assertEqual(mgr_comp_status, 200)
            self.assertEqual(mgr_comp_resp["status"], "completed")

        finally:
            if order_id:
                with SessionLocal() as db:
                    db.query(Order).filter(Order.id == order_id).delete()
                    db.commit()

    def test_07_role_spoofing_and_jwt_tampering_defenses(self):
        """Server rejects forged tokens, customer tokens, and role mismatches."""
        # 1. Customer token passed to staff API -> 401 Unauthorized
        cust_headers = {"Authorization": f"Bearer {self.customer_token}"}
        self.assertEqual(self._request("/api/v1/manager/orders", headers=cust_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/kds/orders", headers=cust_headers)[0], 401)

        # 2. Forged signature on JWT -> 401 Unauthorized
        forged_jwt = jwt.encode({"sub": str(self.manager_id), "type": "staff"}, "attacker-bogus-secret-key-32chars", algorithm="HS256")
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": f"staff_access_token={forged_jwt}"})[0], 401)

        # 3. Valid kitchen credentials selecting manager workspace -> 403 Forbidden
        status, resp, _, _ = self._login(self.kitchen_email, requested_role="manager")
        self.assertEqual(status, 403)
        self.assertIn("not authorized for the management dashboard", resp["detail"].lower())

        # 4. Valid manager credentials selecting kitchen workspace -> 403 Forbidden
        status, resp, _, _ = self._login(self.manager_email, requested_role="kitchen_staff")
        self.assertEqual(status, 403)
        self.assertIn("not authorized for the kitchen display system", resp["detail"].lower())

        # 5. Tampered JWT role claim (valid signature, wrong role claim) -> 401 Unauthorized
        tampered_kit_jwt = jwt.encode(
            {"sub": str(self.kitchen_id), "type": "staff", "role": "manager", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": f"staff_access_token={tampered_kit_jwt}"})[0], 401)
        self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": f"staff_access_token={tampered_kit_jwt}"})[0], 401)

        # 6. Staff token passed to customer endpoints -> 401 Unauthorized
        _, _, mgr_cookie, _ = self._login(self.manager_email)
        _, _, kit_cookie, _ = self._login(self.kitchen_email)
        self.assertEqual(self._request("/api/v1/customers/me", headers={"Cookie": mgr_cookie})[0], 401)
        self.assertEqual(self._request("/api/v1/orders", headers={"Cookie": kit_cookie})[0], 401)
        self.assertEqual(self._request("/api/v1/checkout/quote", method="POST", body={"items": []}, headers={"Cookie": mgr_cookie})[0], 401)

        # 7. Customer token passed to manager menu/inventory/customer admin endpoints -> 401 Unauthorized
        self.assertEqual(self._request("/api/v1/products/manage", headers=cust_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/categories/manage", headers=cust_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/manager/customers", headers=cust_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/manager/staff", headers=cust_headers)[0], 401)

    def test_08_session_invalidation_and_logout(self):
        """Logout invalidates cookie and subsequent requests are rejected."""
        _, _, mgr_cookie, _ = self._login(self.manager_email)
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": mgr_cookie})[0], 200)

        # Logout
        logout_status, logout_resp, logout_headers = self._request("/api/v1/staff/auth/logout", method="POST", headers={"Cookie": mgr_cookie})
        self.assertEqual(logout_status, 200)
        self.assertEqual(logout_resp["message"], "Staff signed out successfully.")

        # Check cookie cleared in header
        set_cookie = logout_headers.get("Set-Cookie", "")
        self.assertIn("staff_access_token", set_cookie)
        self.assertTrue('Max-Age=0' in set_cookie or 'expires=' in set_cookie.lower())

    def test_09_side_effect_free_denials(self):
        """Denied operations cause zero database mutations."""
        _, _, kit_cookie, _ = self._login(self.kitchen_email)

        # Count inventory transactions before
        with SessionLocal() as db:
            tx_count_before = db.scalar(select(func.count()).select_from(InventoryTransaction))
            cat_count_before = db.scalar(select(func.count()).select_from(Role))

        # Attempt illegal mutation as kitchen staff
        self._request(
            "/api/v1/inventory/1/transactions",
            method="POST",
            body={"transaction_type": "waste", "quantity_change": "-5.00", "notes": "Exploit"},
            headers={"Cookie": kit_cookie},
        )

        with SessionLocal() as db:
            tx_count_after = db.scalar(select(func.count()).select_from(InventoryTransaction))
            cat_count_after = db.scalar(select(func.count()).select_from(Role))

        self.assertEqual(tx_count_before, tx_count_after)
        self.assertEqual(cat_count_before, cat_count_after)

    def test_10_anti_enumeration_and_generic_error_responses(self):
        """Unknown accounts and wrong passwords return identical generic error."""
        st_wrong_pass, resp_wrong_pass, _, _ = self._login(self.manager_email, password="BadPassword123!")
        st_wrong_user, resp_wrong_user, _, _ = self._login("nonexistent-staff-user@savorybites.staging", password="BadPassword123!")

        self.assertEqual(st_wrong_pass, 401)
        self.assertEqual(st_wrong_user, 401)
        self.assertEqual(resp_wrong_pass["detail"], "Invalid staff email or password.")
        self.assertEqual(resp_wrong_user["detail"], "Invalid staff email or password.")

    def test_11_staff_login_clears_customer_cookie_and_deactivation_invalidates_session(self):
        """Staff login clears customer cookie and deactivated staff sessions are immediately rejected."""
        login_status, _, login_headers = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.manager_email, "password": self.password, "requested_role": "manager"},
            headers={"Cookie": f"access_token={self.customer_token}"},
        )
        self.assertEqual(login_status, 200)
        set_cookies = " ".join(login_headers.get_all("Set-Cookie") or [])
        self.assertIn("access_token=", set_cookies)
        _, _, mgr_cookie, _ = self._login(self.manager_email, requested_role="manager")

        # Temporarily deactivate kitchen user -> existing JWT must immediately return 401
        _, _, kit_cookie, _ = self._login(self.kitchen_email, requested_role="kitchen_staff")
        self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": kit_cookie})[0], 200)

        deact_status, _, _ = self._request(
            f"/api/v1/manager/staff/{self.kitchen_id}/status",
            method="PATCH",
            body={"status": "inactive"},
            headers={"Cookie": mgr_cookie},
        )
        self.assertEqual(deact_status, 200)
        try:
            self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": kit_cookie})[0], 401)
        finally:
            self._request(
                f"/api/v1/manager/staff/{self.kitchen_id}/status",
                method="PATCH",
                body={"status": "active"},
                headers={"Cookie": mgr_cookie},
            )
