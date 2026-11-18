"""Unit and integration tests for Manager Tables and Payments/Billing APIs."""

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

from sqlalchemy import BigInteger, create_engine, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker


@compiles(BigInteger, "sqlite")
def _compile_big_int_sqlite(type_, compiler, **kw):
    return "INTEGER"

from app.core.order_status import OrderStatus
from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import Base, SessionLocal
from app.db.models.audit_log import AuditLog
from app.db.models.customer import Customer
from app.db.models.order import Order
from app.db.models.payment_method import PaymentMethod
from app.db.models.restaurant_table import RestaurantTable
from app.db.models.staff import Role, StaffUser
from app.schemas.fulfillment import ManagerTableCreateRequest, ManagerTableUpdateRequest
from app.schemas.payment_method import (
    ManagerPaymentMethodCreateRequest,
    ManagerPaymentMethodUpdateRequest,
)
from app.services.fulfillment_service import (
    StaleTableUpdateError,
    TableConflictError,
    create_manager_table,
    list_manager_tables,
    list_restaurant_tables,
    update_manager_table,
)
from app.services.kds_service import update_manager_order_status
from app.services.payment_method_service import (
    PaymentMethodConflictError,
    create_manager_payment_method,
    get_manager_payments_ledger,
    list_manager_payment_methods,
    update_manager_payment_method,
)


class ManagerTablesAndPaymentsServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db: Session = sessionmaker(bind=self.engine)()

        manila_day1_utc = datetime(2026, 11, 14, 4, 0, tzinfo=timezone.utc)
        manila_day2_utc = datetime(2026, 11, 15, 2, 0, tzinfo=timezone.utc)

        mgr_role = Role(id=1, name="manager", created_at=manila_day1_utc, updated_at=manila_day1_utc)
        mgr_hash = hash_password("TablesPayPass2026!")
        self.manager = StaffUser(
            id=1,
            role_id=1,
            name="Floor & Billing Manager",
            email="floor-mgr@example.com",
            legacy_password=mgr_hash,
            password_hash=mgr_hash,
            status="active",
            created_at=manila_day1_utc,
            updated_at=manila_day1_utc,
        )
        self.customer = Customer(customer_id=1, full_name="Clara Reyes", email="clara@example.com")

        self.table1 = RestaurantTable(
            id=1, table_number="Table 1", seats=4, is_active=True, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        self.table2 = RestaurantTable(
            id=2, table_number="Table 2", seats=2, is_active=True, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        self.table10 = RestaurantTable(
            id=3, table_number="Table 10", seats=6, is_active=False, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )

        self.cash = PaymentMethod(
            id=1, code="cash", label="Cash", description="Pay at counter", is_active=True, display_order=1, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )
        self.gcash = PaymentMethod(
            id=2, code="gcash", label="GCash", description="GCash wallet", is_active=True, display_order=2, created_at=manila_day1_utc, updated_at=manila_day1_utc
        )

        self.order_completed = Order(
            id=1,
            order_number="SB-20261114-001",
            customer_id=1,
            order_type="dine_in",
            fulfillment_type="table_service",
            restaurant_table_id=2,
            status=OrderStatus.COMPLETED.value,
            subtotal=Decimal("300.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("300.00"),
            payment_method_id=1,
            ordered_at=manila_day1_utc,
            completed_at=manila_day1_utc + timedelta(minutes=25),
            created_at=manila_day1_utc,
            updated_at=manila_day1_utc + timedelta(minutes=25),
        )
        self.order_active = Order(
            id=2,
            order_number="SB-20261115-002",
            customer_id=1,
            order_type="dine_in",
            fulfillment_type="table_service",
            restaurant_table_id=1,
            status=OrderStatus.PREPARING.value,
            subtotal=Decimal("520.00"),
            discount_amount=Decimal("20.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("500.00"),
            payment_method_id=2,
            ordered_at=manila_day2_utc,
            created_at=manila_day2_utc,
            updated_at=manila_day2_utc,
        )
        self.order_cancelled = Order(
            id=3,
            order_number="SB-20261115-003",
            customer_id=1,
            order_type="takeout",
            fulfillment_type="counter_pickup",
            restaurant_table_id=None,
            status=OrderStatus.CANCELLED.value,
            subtotal=Decimal("180.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("180.00"),
            payment_method_id=1,
            ordered_at=manila_day2_utc,
            cancelled_at=manila_day2_utc + timedelta(minutes=5),
            created_at=manila_day2_utc,
            updated_at=manila_day2_utc + timedelta(minutes=5),
        )

        self.db.add_all([
            mgr_role,
            self.manager,
            self.customer,
            self.table1,
            self.table2,
            self.table10,
            self.cash,
            self.gcash,
            self.order_completed,
            self.order_active,
            self.order_cancelled,
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_tables_management_lifecycle_and_active_order_safeguard(self):
        overview = list_manager_tables(self.db)
        self.assertEqual(overview.total_tables, 3)
        self.assertEqual(overview.active_tables, 2)
        self.assertEqual(overview.occupied_tables, 1)
        self.assertEqual(overview.available_tables, 1)
        self.assertEqual(overview.total_active_seats, 6)
        self.assertEqual([t.table_number for t in overview.items], ["Table 1", "Table 2", "Table 10"])
        self.assertTrue(overview.items[0].is_occupied)
        self.assertEqual(overview.items[0].active_order.order_number, "SB-20261115-002")

        # Cannot deactivate occupied Table 1
        with self.assertRaisesRegex(ValueError, "Cannot deactivate"):
            update_manager_table(
                self.db,
                table_id=1,
                request=ManagerTableUpdateRequest(is_active=False),
                staff_user=self.manager,
            )

        # Create Table 11 cleanly and check public table list reflects it
        created = create_manager_table(
            self.db,
            request=ManagerTableCreateRequest(table_number="Table 11", seats=8, is_active=True),
            staff_user=self.manager,
        )
        self.assertEqual(created.table_number, "Table 11")
        with self.assertRaises(TableConflictError):
            create_manager_table(
                self.db,
                request=ManagerTableCreateRequest(table_number="table 11", seats=4),
                staff_user=self.manager,
            )

        public_tables = [t.table_number for t, _ in list_restaurant_tables(self.db)]
        self.assertIn("Table 11", public_tables)
        self.assertNotIn("Table 10", public_tables)

        # Optimistic concurrency control: stale expected_updated_at rejected without overwriting
        stale_ts = created.updated_at - timedelta(seconds=5)
        with self.assertRaises(StaleTableUpdateError):
            update_manager_table(
                self.db,
                table_id=created.id,
                request=ManagerTableUpdateRequest(seats=10, expected_updated_at=stale_ts),
                staff_user=self.manager,
            )

        fresh_updated = update_manager_table(
            self.db,
            table_id=created.id,
            request=ManagerTableUpdateRequest(seats=10, expected_updated_at=created.updated_at),
            staff_user=self.manager,
        )
        self.assertEqual(fresh_updated.seats, 10)

        # Completing the active dine-in order on Table 1 releases occupancy while preserving history count
        self.order_active.status = OrderStatus.READY.value
        self.db.commit()
        update_manager_order_status(self.db, self.manager, self.order_active.id, OrderStatus.COMPLETED)
        after_release = list_manager_tables(self.db)
        table1_after = next(t for t in after_release.items if t.id == 1)
        self.assertFalse(table1_after.is_occupied)
        self.assertIsNone(table1_after.active_order)
        self.assertEqual(table1_after.total_orders_count, 1)

    def test_payments_ledger_breakdown_and_last_method_safeguard(self):
        ledger = get_manager_payments_ledger(self.db)
        self.assertEqual(ledger.collected_revenue, Decimal("300.00"))
        self.assertEqual(ledger.completed_count, 1)
        self.assertEqual(ledger.pending_revenue, Decimal("500.00"))
        self.assertEqual(ledger.pending_count, 1)
        self.assertEqual(ledger.voided_revenue, Decimal("180.00"))
        self.assertEqual(ledger.voided_count, 1)
        self.assertEqual(ledger.total, 3)

        nov15_only = get_manager_payments_ledger(
            self.db,
            date_from=date(2026, 11, 15),
            date_to=date(2026, 11, 15),
            settlement="pending",
        )
        self.assertEqual([item.order_number for item in nov15_only.items], ["SB-20261115-002"])

        methods = list_manager_payment_methods(self.db)
        self.assertEqual(len(methods), 2)
        self.assertEqual(methods[0].collected_revenue, Decimal("300.00"))

        with self.assertRaises(PaymentMethodConflictError):
            create_manager_payment_method(
                self.db,
                request=ManagerPaymentMethodCreateRequest(code="cash", label="Cash Dup"),
                staff_user=self.manager,
            )

        # Disable gcash -> ok; disable last active cash -> rejected
        disabled_gcash = update_manager_payment_method(
            self.db,
            method_id=2,
            request=ManagerPaymentMethodUpdateRequest(is_active=False),
            staff_user=self.manager,
        )
        self.assertFalse(disabled_gcash.is_active)

        with self.assertRaisesRegex(ValueError, "At least one active payment method"):
            update_manager_payment_method(
                self.db,
                method_id=1,
                request=ManagerPaymentMethodUpdateRequest(is_active=False),
                staff_user=self.manager,
            )


class ManagerTablesAndPaymentsApiTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.manager_email = f"mgr-tp-{suffix}@savorybites.staging"
        cls.kitchen_email = f"kit-tp-{suffix}@savorybites.staging"
        pwd_hash = hash_password("TablesPayApiPass2026!")

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()
            cls.customer_token = create_access_token(customer.customer_id, timedelta(minutes=10))
            db.add_all([
                StaffUser(role_id=mgr_role.id, name="TP Manager", email=cls.manager_email, legacy_password=pwd_hash, password_hash=pwd_hash, status="active"),
                StaffUser(role_id=kit_role.id, name="TP Kitchen", email=cls.kitchen_email, legacy_password=pwd_hash, password_hash=pwd_hash, status="active"),
            ])
            db.commit()
            cls.manager_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.manager_email))
            cls.kitchen_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.kitchen_email))

        cls.mgr_cookie = f"staff_access_token={create_staff_access_token(cls.manager_id, timedelta(hours=1), role='manager')}"
        cls.kit_cookie = f"staff_access_token={create_staff_access_token(cls.kitchen_id, timedelta(hours=1), role='kitchen_staff')}"
        cls.created_table_ids: list[int] = []
        cls.created_method_ids: list[int] = []

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
            db.query(AuditLog).filter(AuditLog.actor_id.in_([cls.manager_id, cls.kitchen_id])).delete(synchronize_session=False)
            if cls.created_table_ids:
                db.query(RestaurantTable).filter(RestaurantTable.id.in_(cls.created_table_ids)).delete(synchronize_session=False)
            if cls.created_method_ids:
                db.query(PaymentMethod).filter(PaymentMethod.id.in_(cls.created_method_ids)).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.id.in_([cls.manager_id, cls.kitchen_id])).delete(synchronize_session=False)
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

    def test_rbac_and_crud_tables_and_payments(self):
        # Unauth & customer -> 401; Kitchen Staff -> 403
        for endpoint in ["/api/v1/manager/tables", "/api/v1/manager/payments/ledger", "/api/v1/manager/payments/methods"]:
            self.assertEqual(self._request(endpoint)[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Authorization": f"Bearer {self.customer_token}"})[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Cookie": self.kit_cookie})[0], 403)

        # Tables GET/POST/PATCH
        st, tables_resp, _ = self._request("/api/v1/manager/tables", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(st, 200)
        self.assertGreaterEqual(tables_resp["total_tables"], 1)

        uniq_label = f"Patio-{uuid4().hex[:5]}"
        c_st, created_tbl, _ = self._request(
            "/api/v1/manager/tables",
            method="POST",
            body={"table_number": uniq_label, "seats": 6, "is_active": True},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(c_st, 201)
        self.created_table_ids.append(created_tbl["id"])

        u_st, updated_tbl, _ = self._request(
            f"/api/v1/manager/tables/{created_tbl['id']}",
            method="PATCH",
            body={
                "seats": 8,
                "is_active": False,
                "expected_updated_at": created_tbl["updated_at"],
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(u_st, 200)
        self.assertEqual(updated_tbl["seats"], 8)
        self.assertFalse(updated_tbl["is_active"])

        # Re-submitting with stale updated_at -> 409 Conflict
        stale_st, _, _ = self._request(
            f"/api/v1/manager/tables/{created_tbl['id']}",
            method="PATCH",
            body={
                "seats": 2,
                "expected_updated_at": created_tbl["updated_at"],
            },
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(stale_st, 409)

        # Validation & 404 boundaries
        self.assertEqual(
            self._request(
                "/api/v1/manager/tables",
                method="POST",
                body={"table_number": "   ", "seats": 4},
                headers={"Cookie": self.mgr_cookie},
            )[0],
            422,
        )
        self.assertEqual(
            self._request(
                "/api/v1/manager/tables",
                method="POST",
                body={"table_number": f"BadSeats-{uuid4().hex[:4]}", "seats": 0},
                headers={"Cookie": self.mgr_cookie},
            )[0],
            422,
        )
        self.assertEqual(
            self._request(
                "/api/v1/manager/tables/99999999",
                method="PATCH",
                body={"seats": 4},
                headers={"Cookie": self.mgr_cookie},
            )[0],
            404,
        )

        # Payments Ledger & Methods GET/POST/PATCH
        l_st, ledger, _ = self._request("/api/v1/manager/payments/ledger?page=1&page_size=10", headers={"Cookie": self.mgr_cookie})
        self.assertEqual(l_st, 200)
        self.assertIn("collected_revenue", ledger)
        self.assertIn("items", ledger)

        self.assertEqual(
            self._request(
                "/api/v1/manager/payments/ledger?date_from=2026-11-20&date_to=2026-11-10",
                headers={"Cookie": self.mgr_cookie},
            )[0],
            422,
        )

        m_code = f"maya_{uuid4().hex[:6]}"
        mc_st, created_method, _ = self._request(
            "/api/v1/manager/payments/methods",
            method="POST",
            body={"code": m_code, "label": "Maya Wallet", "description": "Pay via Maya", "is_active": True, "display_order": 99},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(mc_st, 201)
        self.created_method_ids.append(created_method["id"])

        mu_st, updated_method, _ = self._request(
            f"/api/v1/manager/payments/methods/{created_method['id']}",
            method="PATCH",
            body={"label": "Maya QR", "is_active": False, "expected_updated_at": created_method["updated_at"]},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(mu_st, 200)
        self.assertEqual(updated_method["label"], "Maya QR")
        self.assertFalse(updated_method["is_active"])

        # Stale expected_updated_at must conflict with 409; literal '%' search must return 0 unrelated orders
        conflict_st, conflict_body, _ = self._request(
            f"/api/v1/manager/payments/methods/{created_method['id']}",
            method="PATCH",
            body={"label": "Stale Overwrite", "expected_updated_at": created_method["updated_at"]},
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(conflict_st, 409)
        self.assertIn("detail", conflict_body)

        wild_st, wild_ledger, _ = self._request(
            "/api/v1/manager/payments/ledger?search=%25",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(wild_st, 200)
        self.assertEqual(wild_ledger["total"], 0)
