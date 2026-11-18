"""Comprehensive unit, reconciliation, RBAC, and CSV export tests for Manager Reports."""

from datetime import datetime, timedelta, timezone
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
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.inventory import InventoryItem, InventoryTransaction
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.staff import Role, StaffUser
from app.services.analytics_service import get_kpi_summary
from app.services.payment_method_service import get_manager_payments_ledger
from app.services.reporting_service import (
    MANILA_TZ,
    get_manager_report_overview,
    sanitize_csv_cell,
)


class ManagerReportsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.suffix = suffix
        pwd_hash = hash_password("ReportAudit2026!")
        cls.now = datetime(2026, 11, 18, 12, 0, 0, tzinfo=timezone.utc)

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))

            mgr = StaffUser(
                role_id=mgr_role.id,
                name="Reports Audit Manager",
                email=f"rep-mgr-{suffix}@savorybites.staging",
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
            )
            kit = StaffUser(
                role_id=kit_role.id,
                name="Reports Audit KDS",
                email=f"rep-kit-{suffix}@savorybites.staging",
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
            )
            cust = Customer(
                full_name=f"Reports Guest {suffix}",
                email=f"rep-cust-{suffix}@savorybites.staging",
                is_active=True,
            )
            cat = MenuCategory(
                name=f"Reports Category {suffix}",
                display_order=99,
                is_active=True,
                created_at=cls.now,
                updated_at=cls.now,
            )
            pm = PaymentMethod(
                code=f"reppay_{suffix}",
                label=f"RepPay {suffix}",
                description="Audit payment method",
                is_active=True,
                display_order=99,
                created_at=cls.now,
                updated_at=cls.now,
            )
            db.add_all([mgr, kit, cust, cat, pm])
            db.flush()

            prod_active = MenuProduct(
                category_id=cat.id,
                name=f"Grilled Chicken {suffix}",
                price=Decimal("160.00"),
                is_available=True,
                created_at=cls.now,
                updated_at=cls.now,
            )
            prod_archived = MenuProduct(
                category_id=cat.id,
                name=f"=Archived Special {suffix}",
                price=Decimal("100.00"),
                is_available=False,
                created_at=cls.now,
                updated_at=cls.now,
                deleted_at=cls.now,
            )
            inv_item = InventoryItem(
                name=f"Audit Rice {suffix}",
                sku=f"SKU-{suffix.upper()}",
                unit="kg",
                current_stock=Decimal("25.000"),
                reorder_level=Decimal("5.000"),
                unit_cost=Decimal("55.00"),
                is_active=True,
                created_at=cls.now,
                updated_at=cls.now,
            )
            db.add_all([prod_active, prod_archived, inv_item])
            db.flush()

            # Real recent orders in Asia/Manila today (so both last_7_days and last_30_days capture them)
            now_utc = datetime.now(timezone.utc)
            ord_comp = Order(
                order_number=f"REPC-{suffix.upper()}",
                customer_id=cust.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                payment_method_id=pm.id,
                status="completed",
                subtotal=Decimal("320.00"),
                discount_amount=Decimal("20.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("300.00"),
                ordered_at=now_utc - timedelta(hours=2),
                completed_at=now_utc - timedelta(hours=1),
                created_at=now_utc - timedelta(hours=2),
                updated_at=now_utc - timedelta(hours=1),
            )
            ord_pend = Order(
                order_number=f"REPP-{suffix.upper()}",
                customer_id=cust.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                payment_method_id=pm.id,
                status="pending",
                subtotal=Decimal("500.00"),
                discount_amount=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("500.00"),
                ordered_at=now_utc - timedelta(minutes=30),
                created_at=now_utc - timedelta(minutes=30),
                updated_at=now_utc - timedelta(minutes=30),
            )
            ord_canc = Order(
                order_number=f"REPX-{suffix.upper()}",
                customer_id=cust.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                payment_method_id=pm.id,
                status="cancelled",
                subtotal=Decimal("250.00"),
                discount_amount=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("250.00"),
                ordered_at=now_utc - timedelta(minutes=20),
                cancelled_at=now_utc - timedelta(minutes=10),
                created_at=now_utc - timedelta(minutes=20),
                updated_at=now_utc - timedelta(minutes=10),
            )
            db.add_all([ord_comp, ord_pend, ord_canc])
            db.flush()

            oi1 = OrderItem(
                order_id=ord_comp.id,
                menu_item_id=prod_active.id,
                quantity=2,
                unit_price=Decimal("160.00"),
                discount_amount=Decimal("20.00"),
                line_total=Decimal("300.00"),
                status="completed",
                product_name=prod_active.name,
                created_at=now_utc - timedelta(hours=2),
                updated_at=now_utc - timedelta(hours=1),
            )
            oi2 = OrderItem(
                order_id=ord_comp.id,
                menu_item_id=prod_archived.id,
                quantity=1,
                unit_price=Decimal("100.00"),
                discount_amount=Decimal("0.00"),
                line_total=Decimal("100.00"),
                status="completed",
                product_name=prod_archived.name,
                created_at=now_utc - timedelta(hours=2),
                updated_at=now_utc - timedelta(hours=1),
            )
            tx_sale = InventoryTransaction(
                inventory_item_id=inv_item.id,
                performed_by=mgr.id,
                transaction_type="sale",
                quantity_change=Decimal("-2.500"),
                unit_cost=Decimal("55.00"),
                reference_type="order_confirmation",
                reference_id=ord_comp.id,
                notes=f"Usage {suffix}",
                created_at=now_utc - timedelta(minutes=50),
            )
            tx_waste = InventoryTransaction(
                inventory_item_id=inv_item.id,
                performed_by=mgr.id,
                transaction_type="waste",
                quantity_change=Decimal("-0.500"),
                unit_cost=Decimal("55.00"),
                notes=f"+SPILLAGE {suffix}",
                created_at=now_utc - timedelta(minutes=40),
            )
            tx_purchase = InventoryTransaction(
                inventory_item_id=inv_item.id,
                performed_by=mgr.id,
                transaction_type="purchase",
                quantity_change=Decimal("10.000"),
                unit_cost=Decimal("55.00"),
                notes=f"Delivery {suffix}",
                created_at=now_utc - timedelta(minutes=35),
            )
            db.add_all([oi1, oi2, tx_sale, tx_waste, tx_purchase])
            db.commit()

            cls.mgr_id = mgr.id
            cls.kit_id = kit.id
            cls.cust_id = cust.customer_id
            cls.cat_id = cat.id
            cls.pm_id = pm.id
            cls.prod_ids = [prod_active.id, prod_archived.id]
            cls.inv_id = inv_item.id
            cls.ord_ids = [ord_comp.id, ord_pend.id, ord_canc.id]
            cls.tx_ids = [tx_sale.id, tx_waste.id, tx_purchase.id]
            cls.pm_code = pm.code
            cls.comp_order_num = ord_comp.order_number

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
            db.execute(delete(InventoryTransaction).where(InventoryTransaction.id.in_(cls.tx_ids)))
            db.execute(delete(InventoryItem).where(InventoryItem.id == cls.inv_id))
            db.execute(delete(OrderItem).where(OrderItem.order_id.in_(cls.ord_ids)))
            db.execute(delete(Order).where(Order.id.in_(cls.ord_ids)))
            db.execute(delete(MenuProduct).where(MenuProduct.id.in_(cls.prod_ids)))
            db.execute(delete(MenuCategory).where(MenuCategory.id == cls.cat_id))
            db.execute(delete(PaymentMethod).where(PaymentMethod.id == cls.pm_id))
            db.execute(delete(Customer).where(Customer.customer_id == cls.cust_id))
            db.execute(delete(StaffUser).where(StaffUser.id.in_([cls.mgr_id, cls.kit_id])))
            db.commit()

    @classmethod
    def _request(cls, path, headers=None):
        req = Request(f"http://127.0.0.1:{cls.port}{path}", headers=dict(headers or {}), method="GET")
        try:
            with urlopen(req, timeout=5) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                if "application/json" in ctype:
                    return resp.status, json.loads(raw.decode("utf-8")), resp.headers
                return resp.status, raw.decode("utf-8"), resp.headers
        except HTTPError as err:
            raw = err.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else None
            return err.code, parsed, err.headers

    def test_01_rbac_enforcement_across_all_reporting_and_export_endpoints(self):
        endpoints = [
            "/api/v1/manager/reports/overview",
            "/api/v1/manager/reports/sales",
            "/api/v1/manager/reports/orders",
            "/api/v1/manager/reports/menu",
            "/api/v1/manager/reports/payments",
            "/api/v1/manager/reports/inventory",
            "/api/v1/manager/reports/export?report=sales",
        ]
        for ep in endpoints:
            self.assertEqual(self._request(ep)[0], 401, f"Unauth must be 401 for {ep}")
            self.assertEqual(self._request(ep, headers={"Cookie": self.cust_cookie})[0], 401, f"Customer must be 401 for {ep}")
            self.assertEqual(self._request(ep, headers={"Cookie": self.kit_cookie})[0], 403, f"KDS must be 403 for {ep}")
            self.assertEqual(self._request(ep, headers={"Cookie": self.mgr_cookie})[0], 200, f"Manager must be 200 for {ep}")

    def test_02_date_validation_and_zero_denominator_comparison(self):
        st_bad_order, body_bad, _ = self._request(
            "/api/v1/manager/reports/overview?preset=custom&date_from=2026-11-10&date_to=2026-11-01",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st_bad_order, 422)
        self.assertIn("date_from", body_bad["detail"])

        st_missing, _, _ = self._request(
            "/api/v1/manager/reports/sales?preset=custom",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st_missing, 422)

        st_too_wide, _, _ = self._request(
            "/api/v1/manager/reports/orders?preset=custom&date_from=2025-01-01&date_to=2026-11-18",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(st_too_wide, 422)

        # Zero prior baseline returns change_pct=None instead of dividing by zero
        with SessionLocal() as db:
            far_past = datetime(2020, 1, 5, 12, 0, tzinfo=timezone.utc)
            rep = get_manager_report_overview(db, preset="last_7_days", now=far_past)
            self.assertEqual(Decimal(rep.recognized_revenue.current), Decimal("0.00"))
            self.assertIsNone(rep.recognized_revenue.change_pct)

    def test_03_reconciliation_with_dashboard_and_payments_ledger(self):
        with SessionLocal() as db:
            fixed_now = datetime.now(timezone.utc)
            rep_7d = get_manager_report_overview(db, preset="last_7_days", now=fixed_now)
            dash_7d = get_kpi_summary(db, "last_7_days", now=fixed_now)
            self.assertEqual(rep_7d.recognized_revenue.current, dash_7d.total_revenue)
            self.assertEqual(rep_7d.completed_orders.current, dash_7d.completed_orders)
            self.assertEqual(rep_7d.total_placed_orders.current, dash_7d.total_orders)
            self.assertEqual(rep_7d.average_order_value.current, dash_7d.average_order_value)

            today_manila = fixed_now.astimezone(MANILA_TZ).date()
            from_d = today_manila - timedelta(days=29)
            pay_st, pay_rep, _ = self._request(
                f"/api/v1/manager/reports/payments?preset=custom&date_from={from_d.isoformat()}&date_to={today_manila.isoformat()}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(pay_st, 200)
            ledger = get_manager_payments_ledger(db, date_from=from_d, date_to=today_manila)
            self.assertEqual(Decimal(pay_rep["settled_revenue"]), ledger.collected_revenue)
            self.assertEqual(pay_rep["settled_count"], ledger.completed_count)
            self.assertEqual(Decimal(pay_rep["pending_revenue"]), ledger.pending_revenue)
            self.assertEqual(Decimal(pay_rep["voided_revenue"]), ledger.voided_revenue)

        # Method-specific filter confirms pending/cancelled excluded from settled collections
        pm_st, pm_rep, _ = self._request(
            f"/api/v1/manager/reports/payments?preset=last_7_days&method_code={self.pm_code}",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(pm_st, 200)
        self.assertEqual(Decimal(pm_rep["settled_revenue"]), Decimal("300.00"))
        self.assertEqual(pm_rep["settled_count"], 1)
        self.assertEqual(Decimal(pm_rep["pending_revenue"]), Decimal("500.00"))
        self.assertEqual(Decimal(pm_rep["voided_revenue"]), Decimal("250.00"))

    def test_04_menu_and_inventory_accuracy_plus_csv_formula_neutralization(self):
        menu_st, menu_rep, _ = self._request(
            f"/api/v1/manager/reports/menu?preset=last_7_days&category_id={self.cat_id}",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(menu_st, 200)
        self.assertEqual(menu_rep["total_units_sold"], 3)
        self.assertEqual(Decimal(menu_rep["total_item_sales_value"]), Decimal("400.00"))
        self.assertEqual(len(menu_rep["items"]), 2)
        self.assertTrue(any(i["is_deleted"] and i["units_sold"] == 1 for i in menu_rep["items"]))

        inv_st, inv_rep, _ = self._request(
            f"/api/v1/manager/reports/inventory?preset=last_7_days&search={self.suffix}",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(inv_st, 200)
        self.assertFalse(inv_rep["cost_reporting_supported"])
        self.assertEqual(len(inv_rep["item_summaries"]), 1)
        summary = inv_rep["item_summaries"][0]
        self.assertEqual(Decimal(summary["consumed_qty"]), Decimal("2.500"))
        self.assertEqual(Decimal(summary["waste_qty"]), Decimal("0.500"))
        self.assertEqual(Decimal(summary["restocked_qty"]), Decimal("10.000"))

        # Formula injection unit helper & live CSV export verification
        self.assertEqual(sanitize_csv_cell("=SUM(A1:A2)"), "'=SUM(A1:A2)")
        self.assertEqual(sanitize_csv_cell("+cmd"), "'+cmd")
        csv_menu_st, csv_menu, hdrs = self._request(
            f"/api/v1/manager/reports/export?report=menu&preset=last_7_days&category_id={self.cat_id}",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(csv_menu_st, 200)
        self.assertIn("text/csv", hdrs.get("Content-Type", ""))
        self.assertIn(f"'=Archived Special {self.suffix}", csv_menu)

        csv_inv_st, csv_inv, _ = self._request(
            f"/api/v1/manager/reports/export?report=inventory&preset=last_7_days&search={self.suffix}",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(csv_inv_st, 200)
        self.assertIn(f"'+SPILLAGE {self.suffix}", csv_inv)
