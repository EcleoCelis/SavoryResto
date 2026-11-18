import io
import json
import socket
import subprocess
import sys
import time
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.address import CustomerAddress
from app.db.models.audit_log import AuditLog
from app.db.models.customer import Customer
from app.db.models.favorite import CustomerFavorite
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemSize
from app.db.models.staff import Role, StaffUser
from app.services.media_storage_service import delete_stored_avatar_image


def _build_multipart(field_name: str, filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----SavoryBitesBoundary{uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


def _make_png_bytes(color: tuple[int, int, int] = (23, 63, 53)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (120, 120), color=color).save(buf, format="PNG")
    return buf.getvalue()


class CustomerProfileIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.password = "CustomerTest123!"
        pw_hash = hash_password(cls.password)

        cls.created_customer_ids: list[int] = []
        cls.created_staff_ids: list[int] = []
        cls.created_order_ids: list[int] = []
        cls.uploaded_avatars: list[str] = []

        with SessionLocal() as db:
            manager_role = db.scalar(select(Role).where(Role.name == "manager"))
            kitchen_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            product = db.scalars(
                select(MenuProduct).where(MenuProduct.is_available.is_(True)).order_by(MenuProduct.id)
            ).first()
            payment_method = db.scalars(
                select(PaymentMethod).where(PaymentMethod.is_active.is_(True)).order_by(PaymentMethod.id)
            ).first()
            if not manager_role or not kitchen_role or not product or not payment_method:
                raise RuntimeError("Integration DB requires manager, kitchen_staff, available product, and active payment method.")

            cls.product_id = product.id
            cls.payment_code = payment_method.code

            c1 = Customer(
                full_name="Maria Santos",
                email=f"cp-c1-{suffix}@example.com",
                phone=f"0917{uuid4().int % 10000000:07d}",
                password_hash=pw_hash,
                is_active=True,
            )
            c2 = Customer(
                full_name="Juan Dela Cruz",
                email=f"cp-c2-{suffix}@example.com",
                phone=f"0918{uuid4().int % 10000000:07d}",
                password_hash=pw_hash,
                is_active=True,
            )
            mgr = StaffUser(
                role_id=manager_role.id,
                name="Directory Manager",
                email=f"cp-mgr-{suffix}@example.com",
                legacy_password=pw_hash,
                password_hash=pw_hash,
                status="active",
            )
            kit = StaffUser(
                role_id=kitchen_role.id,
                name="KDS Chef",
                email=f"cp-kit-{suffix}@example.com",
                legacy_password=pw_hash,
                password_hash=pw_hash,
                status="active",
            )
            db.add_all([c1, c2, mgr, kit])
            db.commit()
            db.refresh(c1)
            db.refresh(c2)
            db.refresh(mgr)
            db.refresh(kit)

            cls.c1_id = c1.customer_id
            cls.c1_email = c1.email
            cls.c1_phone = c1.phone
            cls.c2_id = c2.customer_id
            cls.c2_email = c2.email
            cls.mgr_id = mgr.id
            cls.kit_id = kit.id

            cls.created_customer_ids.extend([c1.customer_id, c2.customer_id])
            cls.created_staff_ids.extend([mgr.id, kit.id])

            cls.c1_token = create_access_token(c1.customer_id, timedelta(minutes=15))
            cls.c2_token = create_access_token(c2.customer_id, timedelta(minutes=15))
            cls.mgr_token = create_staff_access_token(mgr.id, timedelta(minutes=15))
            cls.kit_token = create_staff_access_token(kit.id, timedelta(minutes=15))

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
        raise RuntimeError("FastAPI integration server did not start.")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        for avatar_url in cls.uploaded_avatars:
            delete_stored_avatar_image(avatar_url)

        with SessionLocal() as db:
            if cls.created_order_ids:
                db.execute(delete(OrderItem).where(OrderItem.order_id.in_(cls.created_order_ids)))
                db.execute(delete(Order).where(Order.id.in_(cls.created_order_ids)))
            if cls.created_customer_ids:
                # Also clean up any orders created during tests by these customers
                cust_order_ids = list(
                    db.scalars(select(Order.id).where(Order.customer_id.in_(cls.created_customer_ids)))
                )
                if cust_order_ids:
                    db.execute(delete(OrderItem).where(OrderItem.order_id.in_(cust_order_ids)))
                    db.execute(delete(Order).where(Order.id.in_(cust_order_ids)))
                db.execute(
                    delete(CustomerFavorite).where(CustomerFavorite.customer_id.in_(cls.created_customer_ids))
                )
                db.execute(
                    delete(CustomerAddress).where(CustomerAddress.customer_id.in_(cls.created_customer_ids))
                )
                db.execute(
                    delete(AuditLog).where(
                        AuditLog.actor_id.in_(cls.created_customer_ids + cls.created_staff_ids)
                    )
                )
                db.execute(delete(Customer).where(Customer.customer_id.in_(cls.created_customer_ids)))
            if cls.created_staff_ids:
                db.execute(delete(StaffUser).where(StaffUser.id.in_(cls.created_staff_ids)))
            db.commit()

    @classmethod
    def _request(cls, path: str, method: str = "GET", body=None, headers=None, raw_body: bytes | None = None):
        hdrs = dict(headers or {})
        payload = raw_body
        if body is not None and raw_body is None:
            hdrs.setdefault("Content-Type", "application/json")
            payload = json.dumps(body).encode("utf-8")
        req = Request(f"http://127.0.0.1:{cls.port}{path}", data=payload, headers=hdrs, method=method)
        try:
            with urlopen(req) as res:
                raw = res.read()
                ctype = res.headers.get("Content-Type", "")
                parsed = json.loads(raw.decode("utf-8")) if "application/json" in ctype else raw
                return res.status, parsed, res.headers
        except HTTPError as err:
            raw = err.read()
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                parsed = {"detail": raw.decode("utf-8", errors="ignore")}
            return err.code, parsed, err.headers

    def test_01_profile_split_names_phone_normalization_and_email_reauth(self):
        hdrs = {"Authorization": f"Bearer {self.c1_token}"}

        # First/last name update + +63 phone normalization
        status, res, _ = self._request(
            "/api/v1/customers/me",
            method="PUT",
            body={"first_name": "Maria Clara", "last_name": "Reyes", "phone": "+63 917 555 1122"},
            headers=hdrs,
        )
        self.assertEqual(status, 200)
        self.assertEqual(res["full_name"], "Maria Clara Reyes")
        self.assertEqual(res["first_name"], "Maria Clara")
        self.assertEqual(res["last_name"], "Reyes")
        self.assertEqual(res["phone"], "09175551122")

        # Duplicate phone check against c2 returns 409
        with SessionLocal() as db:
            c2_phone = db.get(Customer, self.c2_id).phone
        status, _, _ = self._request(
            "/api/v1/customers/me",
            method="PUT",
            body={"first_name": "Maria", "last_name": "Reyes", "phone": c2_phone},
            headers=hdrs,
        )
        self.assertEqual(status, 409)

        # Email change wrong password -> 403
        status, _, _ = self._request(
            "/api/v1/customers/me/email",
            method="PUT",
            body={"new_email": f"new-{self.c1_email}", "current_password": "WrongPassword1!"},
            headers=hdrs,
        )
        self.assertEqual(status, 403)

        # Duplicate email -> 409
        status, _, _ = self._request(
            "/api/v1/customers/me/email",
            method="PUT",
            body={"new_email": self.c2_email, "current_password": self.password},
            headers=hdrs,
        )
        self.assertEqual(status, 409)

        # Valid email change -> 200
        updated_email = f"updated-{self.c1_email}"
        status, res, _ = self._request(
            "/api/v1/customers/me/email",
            method="PUT",
            body={"new_email": updated_email, "current_password": self.password},
            headers=hdrs,
        )
        self.assertEqual(status, 200)
        self.assertEqual(res["email"], updated_email)

    def test_02_avatar_upload_preview_replace_delete_and_validation(self):
        hdrs = {"Authorization": f"Bearer {self.c1_token}"}

        # Reject invalid payload claiming image/png
        bad_body, bad_ctype = _build_multipart("file", "evil.png", "image/png", b"<script>alert(1)</script>")
        status, _, _ = self._request(
            "/api/v1/customers/me/avatar",
            method="POST",
            raw_body=bad_body,
            headers={**hdrs, "Content-Type": bad_ctype},
        )
        self.assertEqual(status, 400)

        # Upload valid PNG -> converted to WebP and readable over media endpoint
        good_body, good_ctype = _build_multipart("file", "avatar.png", "image/png", _make_png_bytes((23, 63, 53)))
        status, res1, _ = self._request(
            "/api/v1/customers/me/avatar",
            method="POST",
            raw_body=good_body,
            headers={**hdrs, "Content-Type": good_ctype},
        )
        self.assertEqual(status, 200)
        avatar1 = res1["avatar_url"]
        self.assertTrue(avatar1 and avatar1.startswith("/api/v1/media/avatars/"))
        self.uploaded_avatars.append(avatar1)

        img_status, img_bytes, _ = self._request(avatar1)
        self.assertEqual(img_status, 200)
        self.assertTrue(img_bytes.startswith(b"RIFF"))

        # Replace deletes previous file cleanly
        rep_body, rep_ctype = _build_multipart("file", "avatar2.png", "image/png", _make_png_bytes((196, 154, 74)))
        status, res2, _ = self._request(
            "/api/v1/customers/me/avatar",
            method="POST",
            raw_body=rep_body,
            headers={**hdrs, "Content-Type": rep_ctype},
        )
        self.assertEqual(status, 200)
        avatar2 = res2["avatar_url"]
        self.uploaded_avatars.append(avatar2)
        self.assertNotEqual(avatar1, avatar2)
        old_status, _, _ = self._request(avatar1)
        self.assertEqual(old_status, 404)

        # Delete removes file and clears avatar_url
        del_status, del_res, _ = self._request("/api/v1/customers/me/avatar", method="DELETE", headers=hdrs)
        self.assertEqual(del_status, 200)
        self.assertIsNone(del_res["avatar_url"])
        gone_status, _, _ = self._request(avatar2)
        self.assertEqual(gone_status, 404)

    def test_03_preferences_allergy_consent_and_favorites(self):
        hdrs = {"Authorization": f"Bearer {self.c1_token}"}

        # Submitting allergies without explicit consent -> 422
        status, _, _ = self._request(
            "/api/v1/customers/me/preferences",
            method="PUT",
            body={
                "preferred_payment_code": self.payment_code,
                "default_order_type": "takeout",
                "dietary_preferences": ["no_pork"],
                "allergy_flags": ["peanuts", "shellfish"],
                "disliked_ingredients": "cilantro",
                "allergy_consent_given": False,
                "share_allergy_with_kitchen": True,
                "email_order_updates": True,
                "email_promotions": True,
                "theme_preference": "dark",
            },
            headers=hdrs,
        )
        self.assertEqual(status, 422)

        # Valid consented save -> 200
        status, prefs, _ = self._request(
            "/api/v1/customers/me/preferences",
            method="PUT",
            body={
                "preferred_payment_code": self.payment_code,
                "default_order_type": "takeout",
                "dietary_preferences": ["no_pork"],
                "allergy_flags": ["peanuts", "shellfish"],
                "disliked_ingredients": "cilantro",
                "allergy_consent_given": True,
                "share_allergy_with_kitchen": True,
                "email_order_updates": True,
                "email_promotions": True,
                "theme_preference": "dark",
            },
            headers=hdrs,
        )
        self.assertEqual(status, 200)
        self.assertEqual(prefs["theme_preference"], "dark")
        self.assertEqual(prefs["default_order_type"], "takeout")
        self.assertTrue(prefs["allergy_consent_given"])

        # Add favorite twice -> idempotent deduplication; readable in list
        s1, fav1, _ = self._request(f"/api/v1/customers/me/favorites/{self.product_id}", method="POST", headers=hdrs)
        s2, fav2, _ = self._request(f"/api/v1/customers/me/favorites/{self.product_id}", method="POST", headers=hdrs)
        self.assertEqual(s1, 201)
        self.assertEqual(s2, 201)
        self.assertEqual(fav1["product_id"], fav2["product_id"])

        list_status, fav_list, _ = self._request("/api/v1/customers/me/favorites", headers=hdrs)
        self.assertEqual(list_status, 200)
        self.assertEqual(len([f for f in fav_list if f["product_id"] == self.product_id]), 1)

        # Cross-customer isolation: c2 does NOT see c1 favorites
        _, c2_favs, _ = self._request(
            "/api/v1/customers/me/favorites",
            headers={"Authorization": f"Bearer {self.c2_token}"},
        )
        self.assertEqual(len(c2_favs), 0)

    def test_04_checkout_address_snapshot_kds_isolation_and_reorder(self):
        hdrs = {"Authorization": f"Bearer {self.c1_token}"}

        # 1. Create saved address with Dumaguete + barangay (within local area)
        status, addr, _ = self._request(
            "/api/v1/customers/me/addresses",
            method="POST",
            body={
                "label": "Office",
                "recipient_name": "Maria Reyes",
                "phone": "09175551122",
                "street_address": "14 Rizal Boulevard",
                "barangay": "Poblacion 3",
                "city": "Dumaguete",
                "state_province": "Negros Oriental",
                "postal_code": "6200",
                "is_default": True,
            },
            headers=hdrs,
        )
        self.assertEqual(status, 201)
        self.assertTrue(addr["is_within_service_area"])
        addr_id = addr["id"]

        # 2. Place takeout order using saved address, consented allergy alert, and prep notes
        with SessionLocal() as db:
            size = db.scalar(
                select(MenuItemSize).where(
                    MenuItemSize.product_id == self.product_id,
                    MenuItemSize.is_active.is_(True),
                )
            )
            size_label = size.label if size else "Regular"

        status, order, _ = self._request(
            "/api/v1/orders",
            method="POST",
            body={
                "items": [
                    {
                        "cart_line_id": f"{self.product_id}:{size_label}:",
                        "product_id": self.product_id,
                        "quantity": 2,
                        "size": size_label,
                        "addons": [],
                    }
                ],
                "payment_method_code": self.payment_code,
                "order_type": "takeout",
                "fulfillment_type": "counter_pickup",
                "restaurant_table_id": None,
                "selected_address_id": addr_id,
                "include_allergy_alert": True,
                "preparation_notes": "Separate sauce cup please",
            },
            headers={**hdrs, "Idempotency-Key": f"idem-{uuid4().hex}"},
        )
        self.assertEqual(status, 201)
        order_id = order["id"]
        self.created_order_ids.append(order_id)
        self.assertIsNotNone(order["delivery_address_snapshot"])
        self.assertEqual(order["delivery_address_snapshot"]["barangay"], "Poblacion 3")
        self.assertIn("Peanuts", order["kitchen_allergy_alert"])
        self.assertEqual(order["notes"], "Separate sauce cup please")

        # 3. Delete saved address -> historical order snapshot remains intact!
        del_status, _, _ = self._request(f"/api/v1/customers/me/addresses/{addr_id}", method="DELETE", headers=hdrs)
        self.assertEqual(del_status, 200)
        get_status, fetched_order, _ = self._request(f"/api/v1/orders/{order_id}", headers=hdrs)
        self.assertEqual(get_status, 200)
        self.assertEqual(fetched_order["delivery_address_snapshot"]["street_address"], "14 Rizal Boulevard")

        # 4. KDS receives allergy_alert and notes with ZERO customer PII
        kds_status, kds_orders, _ = self._request(
            "/api/v1/kds/orders",
            headers={"Authorization": f"Bearer {self.kit_token}"},
        )
        self.assertEqual(kds_status, 200)
        kds_match = next((o for o in kds_orders if o["id"] == order_id), None)
        self.assertIsNotNone(kds_match)
        self.assertIn("Peanuts", kds_match["allergy_alert"])
        self.assertEqual(kds_match["notes"], "Separate sauce cup please")
        for forbidden_pii in ("email", "phone", "customer_id", "delivery_address_snapshot", "full_name"):
            self.assertNotIn(forbidden_pii, kds_match)

        # 5. Reorder preview validates live prices & enforces customer ownership
        reorder_status, preview, _ = self._request(
            f"/api/v1/orders/{order_id}/reorder-preview",
            method="POST",
            headers=hdrs,
        )
        self.assertEqual(reorder_status, 200)
        self.assertEqual(len(preview["available_items"]), 1)
        c2_reorder_status, _, _ = self._request(
            f"/api/v1/orders/{order_id}/reorder-preview",
            method="POST",
            headers={"Authorization": f"Bearer {self.c2_token}"},
        )
        self.assertEqual(c2_reorder_status, 404)

    def test_05_csrf_middleware_security_and_manager_customer_directory(self):
        # 1. Cookie-authenticated unsafe mutation with cross-site Origin/Sec-Fetch-Site is rejected with 403
        csrf_status, _, _ = self._request(
            "/api/v1/customers/me",
            method="PUT",
            body={"first_name": "Evil", "last_name": "CSRF", "phone": None},
            headers={
                "Cookie": f"access_token={self.c2_token}",
                "Origin": "https://evil-attacker.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(csrf_status, 403)

        # 2. Password change rotates session and invalidates old token issued before password_changed_at
        old_c2_token = self.c2_token
        new_pw = "BrandNewPass123!"
        time.sleep(1.1)  # Ensure password_changed_at iat timestamp advances cleanly
        pw_status, _, _ = self._request(
            "/api/v1/customers/me/password",
            method="PUT",
            body={
                "current_password": self.password,
                "new_password": new_pw,
                "confirm_password": new_pw,
            },
            headers={"Authorization": f"Bearer {old_c2_token}"},
        )
        self.assertEqual(pw_status, 200)

        stale_status, _, _ = self._request(
            "/api/v1/customers/me",
            headers={"Authorization": f"Bearer {old_c2_token}"},
        )
        self.assertEqual(stale_status, 401)

        # 3. Manager directory RBAC: kitchen staff & customer denied, manager allowed
        kit_status, _, _ = self._request(
            "/api/v1/manager/customers",
            headers={"Authorization": f"Bearer {self.kit_token}"},
        )
        self.assertEqual(kit_status, 403)

        cust_status, _, _ = self._request(
            "/api/v1/manager/customers",
            headers={"Authorization": f"Bearer {self.c1_token}"},
        )
        self.assertEqual(cust_status, 401)

        mgr_status, directory, _ = self._request(
            "/api/v1/manager/customers?search=Maria",
            headers={"Authorization": f"Bearer {self.mgr_token}"},
        )
        self.assertEqual(mgr_status, 200)
        self.assertTrue(any(c["customer_id"] == self.c1_id for c in directory["items"]))

        det_status, detail, _ = self._request(
            f"/api/v1/manager/customers/{self.c1_id}",
            headers={"Authorization": f"Bearer {self.mgr_token}"},
        )
        self.assertEqual(det_status, 200)
        self.assertIn("Peanuts", detail["operational_allergy_alert"])
        self.assertNotIn("favorites", detail)
        self.assertNotIn("password_hash", detail["customer"])

        # 4. Deactivate customer retains order history & blocks old JWT + login; Manager can reactivate
        deact_status, _, _ = self._request(
            "/api/v1/customers/me/deactivate",
            method="POST",
            body={
                "current_password": self.password,
                "confirm_deactivation": True,
                "reason": "Testing deactivation flow",
            },
            headers={"Authorization": f"Bearer {self.c1_token}"},
        )
        self.assertEqual(deact_status, 200)

        blocked_me_status, _, _ = self._request(
            "/api/v1/customers/me",
            headers={"Authorization": f"Bearer {self.c1_token}"},
        )
        self.assertEqual(blocked_me_status, 401)

        # Reactivate via Manager endpoint
        react_status, react_detail, _ = self._request(
            f"/api/v1/manager/customers/{self.c1_id}/status",
            method="PATCH",
            body={"is_active": True, "reason": "Verified customer reactivation"},
            headers={"Authorization": f"Bearer {self.mgr_token}"},
        )
        self.assertEqual(react_status, 200)
        self.assertTrue(react_detail["customer"]["is_active"])
        self.assertGreaterEqual(react_detail["customer"]["order_count"], 1)
        # Unsettled/pending order must not count as completed spend
        self.assertEqual(Decimal(str(react_detail["customer"]["total_spent"])), Decimal("0.00"))

        # Literal '%' search must not match unrelated customers, and blank deactivation reason is rejected 422
        wild_status, wild_dir, _ = self._request(
            "/api/v1/manager/customers?search=%25",
            headers={"Authorization": f"Bearer {self.mgr_token}"},
        )
        self.assertEqual(wild_status, 200)
        self.assertEqual(wild_dir["total"], 0)

        short_reason_st, _, _ = self._request(
            f"/api/v1/manager/customers/{self.c1_id}/status",
            method="PATCH",
            body={"is_active": False, "reason": "no"},
            headers={"Authorization": f"Bearer {self.mgr_token}"},
        )
        self.assertEqual(short_reason_st, 422)
