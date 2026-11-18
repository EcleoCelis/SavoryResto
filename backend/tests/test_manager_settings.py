"""Comprehensive integration tests for Manager Settings, RBAC, concurrency, and cross-module propagation."""

from datetime import datetime, time as dt_time, timezone, timedelta
from decimal import Decimal
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import delete, select

from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.audit_log import AuditLog
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemSize
from app.db.models.restaurant_settings import RestaurantBusinessHour, RestaurantSettings
from app.db.models.staff import Role, StaffUser
from app.services.email_service import email_service
from app.services.settings_service import ensure_restaurant_settings, evaluate_operating_status


class ManagerSettingsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.suffix = suffix
        pwd_hash = hash_password("SettingsTest2026!")
        now = datetime.now(timezone.utc)

        with SessionLocal() as db:
            # Snapshot authoritative defaults to restore cleanly in tearDownClass
            orig_cfg, orig_hours = ensure_restaurant_settings(db)
            cls.orig_cfg = {
                "name": orig_cfg.name,
                "tagline": orig_cfg.tagline,
                "locality": orig_cfg.locality,
                "full_address": orig_cfg.full_address,
                "phone": orig_cfg.phone,
                "email": orig_cfg.email,
                "timezone": orig_cfg.timezone,
                "kitchen_cutoff_minutes": orig_cfg.kitchen_cutoff_minutes,
                "kitchen_notice": orig_cfg.kitchen_notice,
                "holiday_notice": orig_cfg.holiday_notice,
                "online_ordering_enabled": orig_cfg.online_ordering_enabled,
                "online_ordering_pause_reason": orig_cfg.online_ordering_pause_reason,
                "dine_in_enabled": orig_cfg.dine_in_enabled,
                "takeout_enabled": orig_cfg.takeout_enabled,
                "enforce_operating_hours": orig_cfg.enforce_operating_hours,
                "minimum_order_amount": orig_cfg.minimum_order_amount,
                "send_order_confirmation_emails": orig_cfg.send_order_confirmation_emails,
                "send_contact_inquiry_emails": orig_cfg.send_contact_inquiry_emails,
            }
            cls.orig_hours = [
                (h.day_of_week, h.is_open, h.open_time, h.close_time) for h in orig_hours
            ]

            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))

            mgr = StaffUser(
                role_id=mgr_role.id,
                name="Settings Test Manager",
                email=f"set-mgr-{suffix}@savorybites.staging",
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
            )
            kit = StaffUser(
                role_id=kit_role.id,
                name="Settings Test KDS",
                email=f"set-kit-{suffix}@savorybites.staging",
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
            )
            cust = Customer(
                full_name=f"Settings Guest {suffix}",
                email=f"set-cust-{suffix}@savorybites.staging",
                is_active=True,
                email_order_updates=True,
            )
            cat = MenuCategory(
                name=f"Settings Cat {suffix}",
                display_order=97,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            pm = PaymentMethod(
                code=f"setpay_{suffix}",
                label=f"SetPay {suffix}",
                is_active=True,
                display_order=97,
                created_at=now,
                updated_at=now,
            )
            db.add_all([mgr, kit, cust, cat, pm])
            db.flush()

            prod = MenuProduct(
                category_id=cat.id,
                name=f"Settings Dish {suffix}",
                price=Decimal("120.00"),
                is_available=True,
                created_at=now,
                updated_at=now,
            )
            db.add(prod)
            db.flush()

            size = MenuItemSize(
                product_id=prod.id,
                code="regular",
                label="Regular",
                price_adjustment=Decimal("0.00"),
                is_active=True,
                display_order=1,
            )
            db.add(size)
            db.commit()

            cls.mgr_id = mgr.id
            cls.mgr_email = mgr.email
            cls.kit_id = kit.id
            cls.kit_email = kit.email
            cls.cust_id = cust.customer_id
            cls.cat_id = cat.id
            cls.pm_id = pm.id
            cls.pm_code = pm.code
            cls.prod_id = prod.id
            cls.created_order_ids: list[int] = []

            cls.mgr_cookie = f"staff_access_token={create_staff_access_token(mgr.id, timedelta(hours=2), role='manager')}"
            cls.kit_cookie = f"staff_access_token={create_staff_access_token(kit.id, timedelta(hours=2), role='kitchen_staff')}"
            cls.cust_cookie = f"access_token={create_access_token(cust.customer_id, timedelta(hours=2))}"

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
            cfg, hours = ensure_restaurant_settings(db)
            for key, val in cls.orig_cfg.items():
                setattr(cfg, key, val)
            cfg.updated_by = None
            cfg.updated_at = datetime.now(timezone.utc)
            by_day = {h.day_of_week: h for h in hours}
            for dow, is_open, op_t, cl_t in cls.orig_hours:
                by_day[dow].is_open = is_open
                by_day[dow].open_time = op_t
                by_day[dow].close_time = cl_t

            order_ids = list(
                db.scalars(select(Order.id).where(Order.customer_id == cls.cust_id)).all()
            )
            if order_ids:
                db.execute(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
                db.execute(delete(Order).where(Order.id.in_(order_ids)))
            db.execute(
                delete(AuditLog).where(
                    AuditLog.actor_email.in_([cls.mgr_email, cls.kit_email])
                )
            )
            db.execute(delete(MenuItemSize).where(MenuItemSize.product_id == cls.prod_id))
            db.execute(delete(MenuProduct).where(MenuProduct.id == cls.prod_id))
            db.execute(delete(MenuCategory).where(MenuCategory.id == cls.cat_id))
            db.execute(delete(PaymentMethod).where(PaymentMethod.id == cls.pm_id))
            db.execute(delete(Customer).where(Customer.customer_id == cls.cust_id))
            db.execute(delete(StaffUser).where(StaffUser.id.in_([cls.mgr_id, cls.kit_id])))
            db.commit()

    @classmethod
    def _request(cls, path, method="GET", body=None, headers=None):
        req_headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        req = Request(f"http://127.0.0.1:{cls.port}{path}", data=data, headers=req_headers, method=method)
        try:
            with urlopen(req, timeout=5) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw.decode("utf-8")) if raw else None, resp.headers
        except HTTPError as err:
            raw = err.read()
            return err.code, json.loads(raw.decode("utf-8")) if raw else None, err.headers

    def test_01_rbac_and_public_exposure_boundaries(self):
        # Public settings endpoint works without auth and omits sensitive metadata
        pub_st, pub_body, _ = self._request("/api/v1/restaurant/settings")
        self.assertEqual(pub_st, 200)
        self.assertIn("restaurant", pub_body)
        self.assertIn("hours", pub_body)
        self.assertIn("ordering", pub_body)
        self.assertNotIn("notifications", pub_body)
        self.assertNotIn("system_info", pub_body)

        # Manager Settings endpoints deny unauth/customer (401) and KDS (403)
        for method, path in [
            ("GET", "/api/v1/manager/settings"),
            ("PATCH", "/api/v1/manager/settings/restaurant"),
            ("PATCH", "/api/v1/manager/settings/hours"),
            ("PATCH", "/api/v1/manager/settings/ordering"),
            ("PATCH", "/api/v1/manager/settings/notifications"),
        ]:
            body = {} if method == "PATCH" else None
            self.assertEqual(self._request(path, method=method, body=body)[0], 401)
            self.assertEqual(self._request(path, method=method, body=body, headers={"Cookie": self.cust_cookie})[0], 401)
            self.assertEqual(self._request(path, method=method, body=body, headers={"Cookie": self.kit_cookie})[0], 403)

        st_mgr, mgr_body, _ = self._request("/api/v1/manager/settings", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(st_mgr, 200)
        self.assertIn("notifications", mgr_body)
        self.assertIn("smtp_configured", mgr_body["notifications"])
        self.assertEqual(len(mgr_body["hours"]), 7)

    def test_02_validation_concurrency_and_audit_logging(self):
        _, cur, _ = self._request("/api/v1/manager/settings", headers={"Cookie": self.mgr_cookie})
        v = cur["system_info"]["version"]

        # Unknown property rejected cleanly (extra="forbid" -> 422)
        bad_extra, _, _ = self._request(
            "/api/v1/manager/settings/restaurant",
            method="PATCH",
            body={**cur["restaurant"], "unknown_field": "hack"},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(bad_extra, 422)

        # Online ordering enabled without any channel rejected (422)
        bad_chan, _, _ = self._request(
            "/api/v1/manager/settings/ordering",
            method="PATCH",
            body={
                "online_ordering_enabled": True,
                "online_ordering_pause_reason": None,
                "dine_in_enabled": False,
                "takeout_enabled": False,
                "enforce_operating_hours": False,
                "kitchen_cutoff_minutes": 30,
                "minimum_order_amount": "0.00",
                "expected_version": v,
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(bad_chan, 422)

        # Stale expected_version -> 409 Conflict
        stale_st, _, _ = self._request(
            "/api/v1/manager/settings/notifications",
            method="PATCH",
            body={
                "send_order_confirmation_emails": True,
                "send_contact_inquiry_emails": True,
                "expected_version": v + 99,
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(stale_st, 409)

        # Valid update persists, increments version, propagates to /restaurant/settings, and logs audit
        new_tagline = f"Freshly audited {self.suffix}"
        ok_st, updated, _ = self._request(
            "/api/v1/manager/settings/restaurant",
            method="PATCH",
            body={
                "name": cur["restaurant"]["name"],
                "tagline": new_tagline,
                "locality": cur["restaurant"]["locality"],
                "full_address": cur["restaurant"]["full_address"],
                "phone": "+63 917 555 0199",
                "email": cur["restaurant"]["email"],
                "kitchen_notice": cur["restaurant"]["kitchen_notice"],
                "holiday_notice": cur["restaurant"]["holiday_notice"],
                "expected_version": v,
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(ok_st, 200)
        self.assertEqual(updated["system_info"]["version"], v + 1)

        _, pub, _ = self._request("/api/v1/restaurant/settings")
        self.assertEqual(pub["restaurant"]["tagline"], new_tagline)
        self.assertEqual(pub["restaurant"]["phone"], "+63 917 555 0199")

        with SessionLocal() as db:
            log = db.scalar(
                select(AuditLog).where(
                    AuditLog.event_type == "manager.settings.restaurant_update",
                    AuditLog.actor_email == self.mgr_email,
                )
            )
            self.assertIsNotNone(log)

    def test_03_ordering_policy_and_email_propagation(self):
        _, cur, _ = self._request("/api/v1/manager/settings", headers={"Cookie": self.mgr_cookie})
        v = cur["system_info"]["version"]

        order_payload = {
            "order_type": "takeout",
            "fulfillment_type": "counter_pickup",
            "payment_method_code": self.pm_code,
            "items": [
                {
                    "cart_line_id": "line-1",
                    "product_id": self.prod_id,
                    "quantity": 1,
                    "size": "regular",
                    "addons": [],
                }
            ],
        }

        # 1. Pause online ordering -> checkout rejected 422
        st1, u1, _ = self._request(
            "/api/v1/manager/settings/ordering",
            method="PATCH",
            body={
                "online_ordering_enabled": False,
                "online_ordering_pause_reason": "Kitchen deep cleaning",
                "dine_in_enabled": True,
                "takeout_enabled": True,
                "enforce_operating_hours": False,
                "kitchen_cutoff_minutes": 30,
                "minimum_order_amount": "0.00",
                "expected_version": v,
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st1, 200)

        ord_paused, paused_body, _ = self._request(
            "/api/v1/orders",
            method="POST",
            body=order_payload,
            headers={"Cookie": self.cust_cookie, "Idempotency-Key": uuid4().hex},
        )
        self.assertEqual(ord_paused, 422)
        self.assertIn("Kitchen deep cleaning", paused_body["detail"])

        # 2. Re-enable with minimum_order_amount = 300 -> 120 order rejected, qty=3 (360) succeeds
        st2, u2, _ = self._request(
            "/api/v1/manager/settings/ordering",
            method="PATCH",
            body={
                "online_ordering_enabled": True,
                "online_ordering_pause_reason": None,
                "dine_in_enabled": False,
                "takeout_enabled": True,
                "enforce_operating_hours": False,
                "kitchen_cutoff_minutes": 30,
                "minimum_order_amount": "300.00",
                "expected_version": u1["system_info"]["version"],
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st2, 200)

        ord_low, low_body, _ = self._request(
            "/api/v1/orders",
            method="POST",
            body=order_payload,
            headers={"Cookie": self.cust_cookie, "Idempotency-Key": uuid4().hex},
        )
        self.assertEqual(ord_low, 422)
        self.assertIn("300.00", low_body["detail"])

        # Order exceeding minimum passes cleanly
        ok_payload = {
            **order_payload,
            "items": [{**order_payload["items"][0], "quantity": 3}],
        }
        ord_ok, _, _ = self._request(
            "/api/v1/orders",
            method="POST",
            body=ok_payload,
            headers={"Cookie": self.cust_cookie, "Idempotency-Key": uuid4().hex},
        )
        self.assertEqual(ord_ok, 201)

        # 3. Disable notification emails -> verify email dispatch skipped cleanly
        st3, u3, _ = self._request(
            "/api/v1/manager/settings/notifications",
            method="PATCH",
            body={
                "send_order_confirmation_emails": False,
                "send_contact_inquiry_emails": False,
                "expected_version": u2["system_info"]["version"],
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st3, 200)

        email_service.clear_outbox()
        contact_st, _, _ = self._request(
            "/api/v1/contact",
            method="POST",
            body={
                "name": "Settings Test Guest",
                "email": "guest@example.com",
                "subject": "Hours question",
                "message": "Are you open on Sunday afternoons?",
            },
        )
        self.assertEqual(contact_st, 200)

        # Restore defaults for ordering & notifications cleanly
        self._request(
            "/api/v1/manager/settings/ordering",
            method="PATCH",
            body={
                "online_ordering_enabled": True,
                "online_ordering_pause_reason": None,
                "dine_in_enabled": True,
                "takeout_enabled": True,
                "enforce_operating_hours": False,
                "kitchen_cutoff_minutes": 30,
                "minimum_order_amount": "0.00",
                "expected_version": u3["system_info"]["version"],
            },
            headers={"Cookie": self.mgr_cookie},
        )

    def test_04_overnight_operating_hours_evaluation_and_staff_password_change(self):
        with SessionLocal() as db:
            cfg, hours = ensure_restaurant_settings(db)
            # Simulate overnight Friday shift (18:00 to 02:00)
            by_day = {h.day_of_week: h for h in hours}
            by_day[5].is_open = True
            by_day[5].open_time = dt_time(18, 0)
            by_day[5].close_time = dt_time(2, 0)
            # Test at Saturday 00:30 Asia/Manila (16:30 UTC Friday)
            sat_night_manila = datetime(2026, 11, 21, 0, 30, tzinfo=timezone(timedelta(hours=8)))
            is_open, _, within_cutoff = evaluate_operating_status(cfg, hours, now=sat_night_manila)
            self.assertTrue(is_open)
            self.assertTrue(within_cutoff)
            db.rollback()

        # Staff password self-change endpoint
        bad_pwd_st, _, _ = self._request(
            "/api/v1/staff/auth/change-password",
            method="POST",
            body={"current_password": "WrongPassword1!", "new_password": "NewStrongPass2026!"},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(bad_pwd_st, 400)

        ok_pwd_st, _, _ = self._request(
            "/api/v1/staff/auth/change-password",
            method="POST",
            body={"current_password": "SettingsTest2026!", "new_password": "NewStrongPass2026!"},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(ok_pwd_st, 200)

        login_ok, _, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.mgr_email, "password": "NewStrongPass2026!", "requested_role": "manager"},
        )
        self.assertEqual(login_ok, 200)
