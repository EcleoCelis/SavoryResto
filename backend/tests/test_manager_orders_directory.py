"""Unit and integration tests for Manager Orders Directory, Receipt Detail, and Lifecycle RBAC."""

from datetime import date, datetime, timedelta, timezone
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

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.order_status import OrderStatus
from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import Base, SessionLocal
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.restaurant_table import RestaurantTable
from app.db.models.staff import Role, StaffUser
from app.services.kds_service import (
    OrderConflictError,
    get_manager_order_detail,
    list_manager_orders_directory,
    update_manager_order_status,
)


class ManagerOrdersDirectoryServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db: Session = sessionmaker(bind=self.engine)()

        manila_day1_utc = datetime(2026, 11, 10, 4, 0, tzinfo=timezone.utc)  # 12:00 Manila Nov 10
        manila_day2_utc = datetime(2026, 11, 11, 1, 0, tzinfo=timezone.utc)  # 09:00 Manila Nov 11

        mgr_role = Role(id=1, name="manager", created_at=manila_day1_utc, updated_at=manila_day1_utc)
        kit_role = Role(id=2, name="kitchen_staff", created_at=manila_day1_utc, updated_at=manila_day1_utc)
        mgr_hash = hash_password("SecureMgrPass123!")
        self.manager = StaffUser(
            id=1,
            role_id=1,
            name="Orders Manager",
            email="orders-mgr@example.com",
            legacy_password=mgr_hash,
            password_hash=mgr_hash,
            status="active",
            created_at=manila_day1_utc,
            updated_at=manila_day1_utc,
        )
        self.customer_a = Customer(
            customer_id=1,
            full_name="Elena Cruz",
            email="elena@example.com",
            phone="09171234567",
        )
        self.customer_b = Customer(
            customer_id=2,
            full_name="Marco Santos",
            email="marco@example.com",
        )
        category = MenuCategory(
            id=1, name="Mains", display_order=1, is_active=True, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        product = MenuProduct(
            id=1,
            category_id=1,
            name="Chicken Inasal",
            price=Decimal("245.00"),
            is_available=True,
            created_at=manila_day1_utc,
            updated_at=manila_day1_utc,
        )
        table = RestaurantTable(
            id=1, table_number="Table 4", seats=4, is_active=True, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        cash = PaymentMethod(
            id=1, code="cash", label="Cash", is_active=True, display_order=1, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        gcash = PaymentMethod(
            id=2, code="gcash", label="GCash", is_active=True, display_order=2, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )

        self.order_ready = Order(
            id=10,
            order_number="SB-20261110-001",
            customer_id=1,
            order_type="dine_in",
            fulfillment_type="table_service",
            restaurant_table_id=1,
            status=OrderStatus.READY.value,
            subtotal=Decimal("490.00"),
            discount_amount=Decimal("20.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("470.00"),
            payment_method_id=1,
            kitchen_allergy_alert="Allergens: Peanuts",
            notes="Serve hot",
            ordered_at=manila_day1_utc,
            created_at=manila_day1_utc,
            updated_at=manila_day1_utc,
        )
        self.order_pending = Order(
            id=11,
            order_number="SB-20261111-002",
            customer_id=2,
            order_type="takeout",
            fulfillment_type="counter_pickup",
            restaurant_table_id=None,
            status=OrderStatus.PENDING.value,
            subtotal=Decimal("245.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("245.00"),
            payment_method_id=2,
            ordered_at=manila_day2_utc,
            created_at=manila_day2_utc,
            updated_at=manila_day2_utc,
        )
        self.order_completed = Order(
            id=12,
            order_number="SB-20261110-003",
            customer_id=1,
            order_type="takeout",
            fulfillment_type="counter_pickup",
            restaurant_table_id=None,
            status=OrderStatus.COMPLETED.value,
            subtotal=Decimal("245.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("245.00"),
            payment_method_id=1,
            ordered_at=manila_day1_utc - timedelta(hours=2),
            completed_at=manila_day1_utc - timedelta(hours=1),
            created_at=manila_day1_utc - timedelta(hours=2),
            updated_at=manila_day1_utc - timedelta(hours=1),
        )

        items = [
            OrderItem(
                id=100,
                order_id=10,
                menu_item_id=1,
                product_name="Chicken Inasal",
                size_code="Large",
                selected_addons=["Extra Garlic Rice"],
                quantity=2,
                unit_price=Decimal("245.00"),
                discount_amount=Decimal("20.00"),
                line_total=Decimal("470.00"),
                status=OrderStatus.READY.value,
                created_at=manila_day1_utc,
                updated_at=manila_day1_utc,
            ),
            OrderItem(
                id=101,
                order_id=11,
                menu_item_id=1,
                product_name="Chicken Inasal",
                size_code="Regular",
                selected_addons=[],
                quantity=1,
                unit_price=Decimal("245.00"),
                discount_amount=Decimal("0.00"),
                line_total=Decimal("245.00"),
                status=OrderStatus.PENDING.value,
                created_at=manila_day2_utc,
                updated_at=manila_day2_utc,
            ),
            OrderItem(
                id=102,
                order_id=12,
                menu_item_id=1,
                product_name="Chicken Inasal",
                size_code="Regular",
                selected_addons=[],
                quantity=1,
                unit_price=Decimal("245.00"),
                discount_amount=Decimal("0.00"),
                line_total=Decimal("245.00"),
                status=OrderStatus.COMPLETED.value,
                created_at=manila_day1_utc - timedelta(hours=2),
                updated_at=manila_day1_utc - timedelta(hours=1),
            ),
        ]
        self.db.add_all(
            [
                mgr_role,
                kit_role,
                self.manager,
                self.customer_a,
                self.customer_b,
                category,
                product,
                table,
                cash,
                gcash,
                self.order_ready,
                self.order_pending,
                self.order_completed,
                *items,
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_directory_filtering_status_counts_and_pagination(self):
        res_all = list_manager_orders_directory(self.db, page=1, page_size=2)
        self.assertEqual(res_all.total, 3)
        self.assertEqual(len(res_all.items), 2)
        # Ordered newest first
        self.assertEqual(res_all.items[0].order_number, "SB-20261111-002")
        self.assertEqual(res_all.status_counts.all, 3)
        self.assertEqual(res_all.status_counts.active, 2)
        self.assertEqual(res_all.status_counts.ready, 1)
        self.assertEqual(res_all.status_counts.pending, 1)
        self.assertEqual(res_all.status_counts.completed, 1)

        # Search by customer name + active tab
        res_elena = list_manager_orders_directory(self.db, search="elena", status_filter="active")
        self.assertEqual(res_elena.total, 1)
        self.assertEqual(res_elena.items[0].id, 10)
        self.assertEqual(res_elena.status_counts.all, 2)
        self.assertEqual(res_elena.status_counts.completed, 1)

        # Filter by Manila date
        res_nov11 = list_manager_orders_directory(
            self.db, date_from=date(2026, 11, 11), date_to=date(2026, 11, 11)
        )
        self.assertEqual([o.id for o in res_nov11.items], [11])

        # Filter by fulfillment type
        res_dine_in = list_manager_orders_directory(self.db, fulfillment_type="table_service")
        self.assertEqual([o.id for o in res_dine_in.items], [10])

    def test_detail_receipt_and_cancellation_reason(self):
        detail = get_manager_order_detail(self.db, 10)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.customer_name, "Elena Cruz")
        self.assertEqual(detail.customer_phone, "09171234567")
        self.assertEqual(detail.payment_method_label, "Cash")
        self.assertEqual(detail.total_amount, Decimal("470.00"))
        self.assertTrue(detail.can_complete)
        self.assertFalse(detail.can_cancel)
        self.assertEqual(detail.items[0].addons, ["Extra Garlic Rice"])
        self.assertEqual(detail.items[0].unit_price, Decimal("245.00"))

        # Cancel pending order with reason
        cancelled = update_manager_order_status(
            self.db,
            self.manager,
            11,
            OrderStatus.CANCELLED,
            cancellation_reason="Customer requested walk-in cancellation",
        )
        self.assertEqual(cancelled.status, OrderStatus.CANCELLED)
        detail_cancelled = get_manager_order_detail(self.db, 11)
        self.assertEqual(
            detail_cancelled.cancellation_reason, "Customer requested walk-in cancellation"
        )
        self.assertFalse(detail_cancelled.can_complete)
        self.assertFalse(detail_cancelled.can_cancel)

    def test_search_wildcard_escaping_and_optimistic_concurrency(self):
        # Search for literal '%' must not match all orders
        res_pct = list_manager_orders_directory(self.db, search="%")
        self.assertEqual(res_pct.total, 0)

        # Stale expected_updated_at raises OrderConflictError without mutating order
        stale_ts = self.order_ready.updated_at - timedelta(minutes=10)
        with self.assertRaises(OrderConflictError):
            update_manager_order_status(
                self.db,
                self.manager,
                self.order_ready.id,
                OrderStatus.COMPLETED,
                expected_updated_at=stale_ts,
            )
        self.db.rollback()
        self.assertEqual(get_manager_order_detail(self.db, self.order_ready.id).status, OrderStatus.READY)

        # Fresh expected_updated_at completes cleanly, then duplicate retry fails deterministically
        done = update_manager_order_status(
            self.db,
            self.manager,
            self.order_ready.id,
            OrderStatus.COMPLETED,
            expected_updated_at=self.order_ready.updated_at,
        )
        self.assertEqual(done.status, OrderStatus.COMPLETED)
        with self.assertRaisesRegex(ValueError, "cannot transition"):
            update_manager_order_status(self.db, self.manager, self.order_ready.id, OrderStatus.COMPLETED)


class ManagerOrdersDirectoryApiTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.manager_email = f"mgr-orders-dir-{suffix}@savorybites.staging"
        cls.kitchen_email = f"kit-orders-dir-{suffix}@savorybites.staging"
        cls.password = "OrdersDirPass2026!"
        pwd_hash = hash_password(cls.password)

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()
            cls.customer_token = create_access_token(customer.customer_id, timedelta(minutes=10))
            db.add_all(
                [
                    StaffUser(
                        role_id=mgr_role.id,
                        name="Orders Dir Manager",
                        email=cls.manager_email,
                        legacy_password=pwd_hash,
                        password_hash=pwd_hash,
                        status="active",
                    ),
                    StaffUser(
                        role_id=kit_role.id,
                        name="Orders Dir Kitchen",
                        email=cls.kitchen_email,
                        legacy_password=pwd_hash,
                        password_hash=pwd_hash,
                        status="active",
                    ),
                ]
            )
            db.commit()
            cls.manager_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.manager_email))
            cls.kitchen_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.kitchen_email))

        cls.mgr_cookie = f"staff_access_token={create_staff_access_token(cls.manager_id, timedelta(hours=1), role='manager')}"
        cls.kit_cookie = f"staff_access_token={create_staff_access_token(cls.kitchen_id, timedelta(hours=1), role='kitchen_staff')}"

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(30):
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
        with SessionLocal() as db:
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email])).delete(
                synchronize_session=False
            )
            db.commit()

    @classmethod
    def _request(cls, path, method="GET", body=None, headers=None):
        req_headers = dict(headers or {})
        if body is not None:
            req_headers["Content-Type"] = "application/json"
        req = Request(
            f"http://127.0.0.1:{cls.port}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers=req_headers,
            method=method,
        )
        try:
            with urlopen(req, timeout=5) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw) if raw else None, resp.headers
        except HTTPError as err:
            raw = err.read()
            try:
                parsed = json.loads(raw) if raw else None
            except Exception:
                parsed = raw.decode("utf-8", errors="replace")
            return err.code, parsed, err.headers

    def test_directory_and_detail_rbac_and_validation(self):
        self.assertEqual(self._request("/api/v1/manager/orders/directory")[0], 401)
        self.assertEqual(
            self._request(
                "/api/v1/manager/orders/directory",
                headers={"Authorization": f"Bearer {self.customer_token}"},
            )[0],
            401,
        )
        self.assertEqual(
            self._request("/api/v1/manager/orders/directory", headers={"Cookie": self.kit_cookie})[0],
            403,
        )
        self.assertEqual(
            self._request("/api/v1/manager/orders/99999999", headers={"Cookie": self.kit_cookie})[0],
            403,
        )

        # Invalid date window -> 422
        status_bad_date, _, _ = self._request(
            "/api/v1/manager/orders/directory?date_from=2026-11-15&date_to=2026-11-10",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(status_bad_date, 422)

        # Valid directory query as manager
        status_ok, directory, _ = self._request(
            "/api/v1/manager/orders/directory?page=1&page_size=5",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(status_ok, 200)
        self.assertIn("items", directory)
        self.assertIn("status_counts", directory)
        self.assertEqual(directory["page"], 1)
        self.assertEqual(directory["page_size"], 5)

        if directory["items"]:
            first_id = directory["items"][0]["id"]
            detail_status, detail, _ = self._request(
                f"/api/v1/manager/orders/{first_id}", headers={"Cookie": self.mgr_cookie}
            )
            self.assertEqual(detail_status, 200)
            self.assertEqual(detail["id"], first_id)
            self.assertIn("items", detail)
            self.assertIn("can_complete", detail)
            self.assertIn("can_cancel", detail)

        self.assertEqual(
            self._request("/api/v1/manager/orders/99999999", headers={"Cookie": self.mgr_cookie})[0],
            404,
        )

        # Sending stale expected_updated_at against an existing order fails cleanly with 409 Conflict
        if directory["items"]:
            first_id = directory["items"][0]["id"]
            conflict_code, conflict_body, _ = self._request(
                f"/api/v1/manager/orders/{first_id}/status",
                method="PATCH",
                body={
                    "status": "completed",
                    "expected_updated_at": "2000-01-01T00:00:00Z",
                },
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(conflict_code, 409)
            self.assertIn("detail", conflict_body)
