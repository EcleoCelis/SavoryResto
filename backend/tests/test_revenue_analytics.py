"""Unit and PostgreSQL/API integration tests for Manager revenue trend analytics."""

import json
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import Base, SessionLocal
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.inventory import InventoryItem
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.staff import Role, StaffUser
from app.services.analytics_service import (
    get_kpi_summary,
    get_operational_alerts,
    get_order_distribution,
    get_order_volume,
    get_revenue_trend,
    get_top_selling_dishes,
)


class RevenueAnalyticsServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db: Session = sessionmaker(bind=self.engine)()

        now = datetime(2026, 11, 16, 10, 0, tzinfo=timezone.utc)
        self.customer = Customer(customer_id=1, full_name="Analytics Customer", email="analytics@example.com")
        self.payment_method = PaymentMethod(
            id=1,
            code="cash",
            label="Cash",
            is_active=True,
            display_order=1,
            created_at=now,
            updated_at=now,
        )
        self.db.add_all([self.customer, self.payment_method])
        self.db.commit()
        self._seq = 1

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _add_order(
        self,
        *,
        status: str,
        total_amount: str,
        ordered_at: datetime,
        completed_at: datetime | None = None,
    ) -> Order:
        idx = self._seq
        self._seq += 1
        amt = Decimal(total_amount)
        order = Order(
            id=idx,
            order_number=f"SB-REV-{idx:04d}",
            customer_id=self.customer.customer_id,
            order_type="takeout",
            fulfillment_type="pickup",
            status=status,
            subtotal=amt,
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=amt,
            payment_method_id=self.payment_method.id,
            ordered_at=ordered_at,
            completed_at=completed_at,
            created_at=ordered_at,
            updated_at=ordered_at,
        )
        self.db.add(order)
        self.db.commit()
        return order

    def test_period_buckets_zero_fill_and_status_exclusions(self):
        # Reference point: Monday 2026-11-16 14:00 Asia/Manila (06:00 UTC)
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)

        # Included completed orders:
        # 1) 2026-11-16 00:30 Manila (2026-11-15 16:30 UTC) via completed_at
        self._add_order(
            status="completed",
            total_amount="350.50",
            ordered_at=datetime(2026, 11, 15, 16, 0, tzinfo=timezone.utc),
            completed_at=datetime(2026, 11, 15, 16, 30, tzinfo=timezone.utc),
        )
        # 2) 2026-11-15 23:30 Manila (2026-11-15 15:30 UTC) with completed_at=None -> ordered_at fallback
        self._add_order(
            status="completed",
            total_amount="199.50",
            ordered_at=datetime(2026, 11, 15, 15, 30, tzinfo=timezone.utc),
            completed_at=None,
        )
        # 3) 2026-08-12 14:42 Manila (within 12 months, outside 30 days)
        self._add_order(
            status="completed",
            total_amount="1405.00",
            ordered_at=datetime(2026, 8, 12, 6, 42, tzinfo=timezone.utc),
            completed_at=None,
        )

        # Excluded non-completed statuses inside the 7-day window
        for excluded_status in ("pending", "confirmed", "preparing", "ready", "cancelled"):
            self._add_order(
                status=excluded_status,
                total_amount="999.00",
                ordered_at=datetime(2026, 11, 16, 4, 0, tzinfo=timezone.utc),
                completed_at=None,
            )

        trend_7d = get_revenue_trend(self.db, "last_7_days", now=ref_now)
        self.assertEqual(len(trend_7d.data), 7)
        self.assertEqual([p.date for p in trend_7d.data], [
            "2026-11-10",
            "2026-11-11",
            "2026-11-12",
            "2026-11-13",
            "2026-11-14",
            "2026-11-15",
            "2026-11-16",
        ])
        self.assertEqual([p.label for p in trend_7d.data], ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"])
        self.assertEqual(trend_7d.data[0].revenue, Decimal("0.00"))
        self.assertEqual(trend_7d.data[5].revenue, Decimal("199.50"))
        self.assertEqual(trend_7d.data[6].revenue, Decimal("350.50"))
        self.assertEqual(trend_7d.total_revenue, Decimal("550.00"))
        self.assertEqual(trend_7d.total_orders, 2)

        trend_30d = get_revenue_trend(self.db, "last_30_days", now=ref_now)
        self.assertEqual(len(trend_30d.data), 30)
        self.assertEqual(trend_30d.data[0].date, "2026-10-18")
        self.assertEqual(trend_30d.data[-1].date, "2026-11-16")
        self.assertEqual(trend_30d.total_revenue, Decimal("550.00"))

        trend_12m = get_revenue_trend(self.db, "last_12_months", now=ref_now)
        self.assertEqual(len(trend_12m.data), 12)
        self.assertEqual(trend_12m.data[0].date, "2025-12")
        self.assertEqual(trend_12m.data[-1].date, "2026-11")
        aug_bucket = next(p for p in trend_12m.data if p.date == "2026-08")
        nov_bucket = next(p for p in trend_12m.data if p.date == "2026-11")
        self.assertEqual(aug_bucket.revenue, Decimal("1405.00"))
        self.assertEqual(nov_bucket.revenue, Decimal("550.00"))
        self.assertEqual(trend_12m.total_revenue, Decimal("1955.00"))
        self.assertEqual(trend_12m.total_orders, 3)

    def test_confirmed_zero_revenue_period_returns_full_zero_filled_series(self):
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)
        for period, expected_len in (("last_7_days", 7), ("last_30_days", 30), ("last_12_months", 12)):
            trend = get_revenue_trend(self.db, period, now=ref_now)
            self.assertEqual(len(trend.data), expected_len)
            self.assertEqual(trend.total_revenue, Decimal("0.00"))
            self.assertEqual(trend.total_orders, 0)
            self.assertTrue(all(point.revenue == Decimal("0.00") for point in trend.data))
            self.assertTrue(all(point.order_count == 0 for point in trend.data))

            dist = get_order_distribution(self.db, period, now=ref_now)
            self.assertEqual(dist.total_orders, 0)
            self.assertEqual(len(dist.distribution), 6)
            self.assertTrue(all(item.count == 0 for item in dist.distribution))

    def test_order_distribution_groups_by_status_within_manila_window(self):
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)  # 14:00 Asia/Manila
        # 7-day window starts 2026-11-10 00:00 Manila (2026-11-09 16:00 UTC)
        self._add_order(status="pending", total_amount="100.00", ordered_at=datetime(2026, 11, 15, 17, 0, tzinfo=timezone.utc))
        self._add_order(status="pending", total_amount="110.00", ordered_at=datetime(2026, 11, 14, 5, 0, tzinfo=timezone.utc))
        self._add_order(status="confirmed", total_amount="120.00", ordered_at=datetime(2026, 11, 13, 5, 0, tzinfo=timezone.utc))
        self._add_order(status="preparing", total_amount="130.00", ordered_at=datetime(2026, 11, 12, 5, 0, tzinfo=timezone.utc))
        self._add_order(status="completed", total_amount="140.00", ordered_at=datetime(2026, 11, 10, 1, 0, tzinfo=timezone.utc))
        # Outside 7-day window (2026-11-09 23:30 Manila = 2026-11-09 15:30 UTC), inside 30-day
        self._add_order(status="ready", total_amount="150.00", ordered_at=datetime(2026, 11, 9, 15, 30, tzinfo=timezone.utc))
        # Outside 30-day window, inside 12-month window
        self._add_order(status="cancelled", total_amount="160.00", ordered_at=datetime(2026, 8, 12, 6, 0, tzinfo=timezone.utc))

        dist_7d = get_order_distribution(self.db, "last_7_days", now=ref_now)
        counts_7d = {item.status: item.count for item in dist_7d.distribution}
        self.assertEqual(dist_7d.total_orders, 5)
        self.assertEqual(sum(counts_7d.values()), dist_7d.total_orders)
        self.assertEqual(
            counts_7d,
            {"pending": 2, "confirmed": 1, "preparing": 1, "ready": 0, "completed": 1, "cancelled": 0},
        )

        dist_30d = get_order_distribution(self.db, "last_30_days", now=ref_now)
        self.assertEqual(dist_30d.total_orders, 6)
        self.assertEqual(next(i.count for i in dist_30d.distribution if i.status == "ready"), 1)

        dist_12m = get_order_distribution(self.db, "last_12_months", now=ref_now)
        self.assertEqual(dist_12m.total_orders, 7)
        self.assertEqual(next(i.count for i in dist_12m.distribution if i.status == "cancelled"), 1)

    def test_top_selling_dishes_ranking_soft_deletes_variants_and_exclusions(self):
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)
        created = ref_now - timedelta(days=2)
        cat = MenuCategory(
            id=1,
            name="Mains",
            display_order=1,
            is_active=True,
            created_at=created,
            updated_at=created,
        )
        products = [
            MenuProduct(id=1, category_id=1, name="Chicken Meal", price=Decimal("150.00"), is_available=True, created_at=created, updated_at=created),
            MenuProduct(id=2, category_id=1, name="Cheeseburger", price=Decimal("120.00"), is_available=True, created_at=created, updated_at=created),
            # Soft-deleted product must preserve historical sales
            MenuProduct(id=3, category_id=1, name="Archived Pasta", price=Decimal("140.00"), is_available=False, created_at=created, updated_at=created, deleted_at=ref_now),
            MenuProduct(id=4, category_id=1, name="Rice Bowl", price=Decimal("110.00"), is_available=True, created_at=created, updated_at=created),
            MenuProduct(id=5, category_id=1, name="Fries", price=Decimal("60.00"), is_available=True, created_at=created, updated_at=created),
            MenuProduct(id=6, category_id=1, name="Sixth Place Tea", price=Decimal("50.00"), is_available=True, created_at=created, updated_at=created),
        ]
        self.db.add(cat)
        self.db.add_all(products)
        self.db.commit()

        # Empty period -> empty items list, zero errors
        empty_dishes = get_top_selling_dishes(self.db, "last_7_days", now=ref_now)
        self.assertEqual(empty_dishes.items, [])

        # Completed orders with multiple variants/sizes for Chicken Meal + tie on units_sold
        o1 = self._add_order(status="completed", total_amount="1500.00", ordered_at=ref_now - timedelta(hours=3), completed_at=ref_now - timedelta(hours=2))
        o2 = self._add_order(status="completed", total_amount="800.00", ordered_at=ref_now - timedelta(days=1), completed_at=ref_now - timedelta(days=1))
        # Excluded non-completed order with huge item qty
        o3 = self._add_order(status="cancelled", total_amount="9999.00", ordered_at=ref_now - timedelta(hours=1))

        self.db.add_all([
            # Product 1 across 2 sizes + addons -> merged 3 + 4 = 7 units
            OrderItem(id=1, order_id=o1.id, menu_item_id=1, quantity=3, unit_price=Decimal("150.00"), discount_amount=Decimal("0.00"), line_total=Decimal("450.00"), status="completed", product_name="Chicken Meal", size_code="regular", created_at=created, updated_at=created),
            OrderItem(id=2, order_id=o2.id, menu_item_id=1, quantity=4, unit_price=Decimal("180.00"), discount_amount=Decimal("0.00"), line_total=Decimal("720.00"), status="completed", product_name="Old Chicken Name", size_code="large", selected_addons=["Extra Gravy"], created_at=created, updated_at=created),
            # Product 2: 5 units
            OrderItem(id=3, order_id=o1.id, menu_item_id=2, quantity=5, unit_price=Decimal("120.00"), discount_amount=Decimal("0.00"), line_total=Decimal("600.00"), status="completed", product_name="Cheeseburger", created_at=created, updated_at=created),
            # Product 3 (soft-deleted): 4 units
            OrderItem(id=4, order_id=o1.id, menu_item_id=3, quantity=4, unit_price=Decimal("140.00"), discount_amount=Decimal("0.00"), line_total=Decimal("560.00"), status="completed", product_name="Archived Pasta", created_at=created, updated_at=created),
            # Product 4 vs Product 5 tied at 2 units -> tie-breaker revenue DESC puts Product 4 ahead of Product 5
            OrderItem(id=5, order_id=o1.id, menu_item_id=4, quantity=2, unit_price=Decimal("110.00"), discount_amount=Decimal("0.00"), line_total=Decimal("220.00"), status="completed", product_name="Rice Bowl", created_at=created, updated_at=created),
            OrderItem(id=6, order_id=o2.id, menu_item_id=5, quantity=2, unit_price=Decimal("60.00"), discount_amount=Decimal("0.00"), line_total=Decimal("120.00"), status="completed", product_name="Fries", created_at=created, updated_at=created),
            # 6th product ranked last -> excluded by Top 5 limit
            OrderItem(id=7, order_id=o2.id, menu_item_id=6, quantity=1, unit_price=Decimal("50.00"), discount_amount=Decimal("0.00"), line_total=Decimal("50.00"), status="completed", product_name="Sixth Place Tea", created_at=created, updated_at=created),
            # Cancelled item on completed order & cancelled order item must be excluded
            OrderItem(id=8, order_id=o1.id, menu_item_id=6, quantity=99, unit_price=Decimal("50.00"), discount_amount=Decimal("0.00"), line_total=Decimal("4950.00"), status="cancelled", product_name="Sixth Place Tea", created_at=created, updated_at=created),
            OrderItem(id=9, order_id=o3.id, menu_item_id=6, quantity=50, unit_price=Decimal("50.00"), discount_amount=Decimal("0.00"), line_total=Decimal("2500.00"), status="cancelled", product_name="Sixth Place Tea", created_at=created, updated_at=created),
        ])
        self.db.commit()

        top = get_top_selling_dishes(self.db, "last_7_days", now=ref_now)
        self.assertEqual(len(top.items), 5)
        self.assertEqual([(i.product_id, i.name, i.units_sold) for i in top.items], [
            (1, "Chicken Meal", 7),
            (2, "Cheeseburger", 5),
            (3, "Archived Pasta", 4),
            (4, "Rice Bowl", 2),
            (5, "Fries", 2),
        ])
        self.assertEqual(top.items[0].revenue, Decimal("1170.00"))

    def test_order_volume_counts_all_placed_orders_in_manila_and_zero_fills(self):
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)
        empty_vol = get_order_volume(self.db, "last_7_days", now=ref_now)
        self.assertEqual(len(empty_vol.data), 7)
        self.assertEqual(empty_vol.total_orders, 0)
        self.assertTrue(all(p.orders == 0 for p in empty_vol.data))

        # Both completed and cancelled/pending orders placed in Manila are counted in orders_placed
        self._add_order(status="pending", total_amount="100.00", ordered_at=datetime(2026, 11, 15, 16, 30, tzinfo=timezone.utc))  # Nov 16 00:30 Manila
        self._add_order(status="cancelled", total_amount="150.00", ordered_at=datetime(2026, 11, 15, 17, 0, tzinfo=timezone.utc))  # Nov 16 01:00 Manila
        self._add_order(status="completed", total_amount="200.00", ordered_at=datetime(2026, 11, 15, 15, 30, tzinfo=timezone.utc))  # Nov 15 23:30 Manila

        vol_7d = get_order_volume(self.db, "last_7_days", now=ref_now)
        dist_7d = get_order_distribution(self.db, "last_7_days", now=ref_now)
        self.assertEqual(len(vol_7d.data), 7)
        self.assertEqual(vol_7d.total_orders, 3)
        self.assertEqual(vol_7d.total_orders, dist_7d.total_orders)
        self.assertEqual(vol_7d.data[-2].date, "2026-11-15")
        self.assertEqual(vol_7d.data[-2].orders, 1)
        self.assertEqual(vol_7d.data[-1].date, "2026-11-16")
        self.assertEqual(vol_7d.data[-1].orders, 2)

        vol_30d = get_order_volume(self.db, "last_30_days", now=ref_now)
        vol_12m = get_order_volume(self.db, "last_12_months", now=ref_now)
        self.assertEqual(len(vol_30d.data), 30)
        self.assertEqual(len(vol_12m.data), 12)
        self.assertEqual(vol_12m.data[-1].orders, 3)

    def test_kpi_summary_and_operational_alerts_service(self):
        ref_now = datetime(2026, 11, 16, 6, 0, tzinfo=timezone.utc)
        empty_kpi = get_kpi_summary(self.db, "last_7_days", now=ref_now)
        self.assertEqual(empty_kpi.total_revenue, Decimal("0.00"))
        self.assertEqual(empty_kpi.total_orders, 0)
        self.assertEqual(empty_kpi.completed_orders, 0)
        self.assertEqual(empty_kpi.completion_rate, Decimal("0.0"))
        self.assertEqual(empty_kpi.average_order_value, Decimal("0.00"))

        self._add_order(status="completed", total_amount="300.00", ordered_at=ref_now - timedelta(hours=4), completed_at=ref_now - timedelta(hours=3))
        self._add_order(status="completed", total_amount="200.00", ordered_at=ref_now - timedelta(hours=2), completed_at=ref_now - timedelta(hours=1))
        self._add_order(status="ready", total_amount="150.00", ordered_at=ref_now - timedelta(minutes=45))
        self._add_order(status="pending", total_amount="100.00", ordered_at=ref_now - timedelta(minutes=15))

        kpi_7d = get_kpi_summary(self.db, "last_7_days", now=ref_now)
        self.assertEqual(kpi_7d.total_revenue, Decimal("500.00"))
        self.assertEqual(kpi_7d.total_orders, 4)
        self.assertEqual(kpi_7d.completed_orders, 2)
        self.assertEqual(kpi_7d.placed_completed_orders, 2)
        self.assertEqual(kpi_7d.completion_rate, Decimal("50.0"))
        self.assertEqual(kpi_7d.average_order_value, Decimal("250.00"))

        self.db.add_all([
            InventoryItem(id=1, name="Chicken Thigh", sku="CHK-1", unit="kg", current_stock=Decimal("0.00"), reorder_level=Decimal("5.00"), is_active=True, created_at=ref_now, updated_at=ref_now),
            InventoryItem(id=2, name="Cooking Oil", sku="OIL-1", unit="L", current_stock=Decimal("2.50"), reorder_level=Decimal("5.00"), is_active=True, created_at=ref_now, updated_at=ref_now),
            InventoryItem(id=3, name="Rice", sku="RCE-1", unit="kg", current_stock=Decimal("20.00"), reorder_level=Decimal("5.00"), is_active=True, created_at=ref_now, updated_at=ref_now),
            # Inactive & deleted items must be ignored
            InventoryItem(id=4, name="Archived Spice", sku="ARC-1", unit="g", current_stock=Decimal("0.00"), reorder_level=Decimal("5.00"), is_active=True, deleted_at=ref_now, created_at=ref_now, updated_at=ref_now),
            InventoryItem(id=5, name="Inactive Sauce", sku="INA-1", unit="L", current_stock=Decimal("0.00"), reorder_level=Decimal("5.00"), is_active=False, created_at=ref_now, updated_at=ref_now),
        ])
        self.db.commit()

        alerts = get_operational_alerts(self.db)
        self.assertEqual(alerts.ready_orders_count, 1)
        self.assertEqual(alerts.pending_orders_count, 1)
        self.assertEqual(alerts.out_of_stock_count, 1)
        self.assertEqual(alerts.low_stock_count, 1)
        self.assertEqual(alerts.low_stock_names, ["Chicken Thigh", "Cooking Oil"])


class RevenueAnalyticsApiTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.manager_email = f"mgr-rev-{suffix}@savorybites.staging"
        cls.kitchen_email = f"kit-rev-{suffix}@savorybites.staging"
        cls.customer_email = f"cust-rev-{suffix}@savorybites.staging"
        cls.order_prefix = f"SB-REVTST-{suffix}"
        password_hash = hash_password("RevAnalyticsPass2026!")

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            kit_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            payment_method = db.scalar(select(PaymentMethod).order_by(PaymentMethod.id))

            mgr = StaffUser(
                role_id=mgr_role.id,
                name="Revenue Test Manager",
                email=cls.manager_email,
                legacy_password=password_hash,
                password_hash=password_hash,
                status="active",
            )
            kit = StaffUser(
                role_id=kit_role.id,
                name="Revenue Test Kitchen",
                email=cls.kitchen_email,
                legacy_password=password_hash,
                password_hash=password_hash,
                status="active",
            )
            cust = Customer(
                full_name="Revenue Test Customer",
                email=cls.customer_email,
            )
            db.add_all([mgr, kit, cust])
            db.flush()

            now_utc = datetime.now(timezone.utc)
            cls.baseline_7d_revenue = get_revenue_trend(db, "last_7_days", now=now_utc).total_revenue
            product = db.scalar(select(MenuProduct).order_by(MenuProduct.id))
            comp_order = Order(
                order_number=f"{cls.order_prefix}-1",
                customer_id=cust.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                status="completed",
                subtotal=Decimal("250.00"),
                discount_amount=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("250.00"),
                payment_method_id=payment_method.id if payment_method else None,
                ordered_at=now_utc - timedelta(minutes=15),
                completed_at=now_utc - timedelta(minutes=5),
                created_at=now_utc,
                updated_at=now_utc,
            )
            canc_order = Order(
                order_number=f"{cls.order_prefix}-2",
                customer_id=cust.customer_id,
                order_type="takeout",
                fulfillment_type="counter_pickup",
                status="cancelled",
                subtotal=Decimal("888.00"),
                discount_amount=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("888.00"),
                payment_method_id=payment_method.id if payment_method else None,
                ordered_at=now_utc - timedelta(minutes=10),
                cancelled_at=now_utc - timedelta(minutes=2),
                created_at=now_utc,
                updated_at=now_utc,
            )
            db.add_all([comp_order, canc_order])
            db.flush()
            if product is not None:
                db.add(
                    OrderItem(
                        order_id=comp_order.id,
                        menu_item_id=product.id,
                        quantity=2,
                        unit_price=Decimal("125.00"),
                        discount_amount=Decimal("0.00"),
                        line_total=Decimal("250.00"),
                        status="completed",
                        product_name=product.name,
                        created_at=now_utc,
                        updated_at=now_utc,
                    )
                )
            db.commit()

            cls.manager_id = mgr.id
            cls.kitchen_id = kit.id
            cls.customer_id = cust.customer_id

        cls.mgr_cookie = f"staff_access_token={create_staff_access_token(cls.manager_id, timedelta(hours=1))}"
        cls.kit_cookie = f"staff_access_token={create_staff_access_token(cls.kitchen_id, timedelta(hours=1))}"
        cls.cust_cookie = f"access_token={create_access_token(cls.customer_id, timedelta(hours=1))}"

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(50):
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
            order_ids = list(db.scalars(select(Order.id).where(Order.order_number.like(f"{cls.order_prefix}-%"))))
            if order_ids:
                db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)).delete(synchronize_session=False)
            db.query(Order).filter(Order.order_number.like(f"{cls.order_prefix}-%")).delete(synchronize_session=False)
            db.query(Customer).filter(Customer.email == cls.customer_email).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email])).delete(synchronize_session=False)
            db.commit()

    @classmethod
    def _request(cls, path, headers=None):
        request = Request(f"http://127.0.0.1:{cls.port}{path}", headers=dict(headers or {}), method="GET")
        try:
            with urlopen(request, timeout=5) as response:
                content = response.read()
                parsed = json.loads(content) if content else None
                return response.status, parsed, response.headers
        except HTTPError as error:
            content = error.read()
            parsed = json.loads(content) if content else None
            return error.code, parsed, error.headers

    def test_revenue_trend_rbac_and_postgres_aggregation(self):
        # Unauthenticated & customer denied with 401; KDS denied with 403
        self.assertEqual(self._request("/api/v1/manager/analytics/revenue-trend")[0], 401)
        self.assertEqual(
            self._request("/api/v1/manager/analytics/revenue-trend", headers={"Cookie": self.cust_cookie})[0],
            401,
        )
        self.assertEqual(
            self._request("/api/v1/manager/analytics/revenue-trend", headers={"Cookie": self.kit_cookie})[0],
            403,
        )

        # Invalid period rejected cleanly
        self.assertEqual(
            self._request(
                "/api/v1/manager/analytics/revenue-trend?period=yearly",
                headers={"Cookie": self.mgr_cookie},
            )[0],
            422,
        )

        for period, expected_len in (("last_7_days", 7), ("last_30_days", 30), ("last_12_months", 12)):
            status, body, headers = self._request(
                f"/api/v1/manager/analytics/revenue-trend?period={period}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(status, 200)
            self.assertIn("no-store", headers.get("Cache-Control", ""))
            self.assertEqual(body["period"], period)
            self.assertEqual(body["currency"], "PHP")
            self.assertEqual(body["timezone"], "Asia/Manila")
            self.assertEqual(body["metric_basis"], "completed_orders")
            self.assertEqual(len(body["data"]), expected_len)
            self.assertGreaterEqual(Decimal(str(body["total_revenue"])), self.baseline_7d_revenue + Decimal("250.00"))
            if period == "last_7_days":
                self.assertEqual(Decimal(str(body["total_revenue"])), self.baseline_7d_revenue + Decimal("250.00"))
            self.assertGreaterEqual(body["data"][-1]["order_count"], 1)

    def test_order_distribution_rbac_and_postgres_aggregation(self):
        self.assertEqual(self._request("/api/v1/manager/analytics/order-distribution")[0], 401)
        self.assertEqual(
            self._request("/api/v1/manager/analytics/order-distribution", headers={"Cookie": self.cust_cookie})[0],
            401,
        )
        self.assertEqual(
            self._request("/api/v1/manager/analytics/order-distribution", headers={"Cookie": self.kit_cookie})[0],
            403,
        )
        self.assertEqual(
            self._request(
                "/api/v1/manager/analytics/order-distribution?period=invalid",
                headers={"Cookie": self.mgr_cookie},
            )[0],
            422,
        )

        for period in ("last_7_days", "last_30_days", "last_12_months"):
            status, body, headers = self._request(
                f"/api/v1/manager/analytics/order-distribution?period={period}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(status, 200)
            self.assertIn("no-store", headers.get("Cache-Control", ""))
            self.assertEqual(body["period"], period)
            self.assertEqual(body["timezone"], "Asia/Manila")
            self.assertEqual(body["cohort_basis"], "orders_placed")
            self.assertEqual(len(body["distribution"]), 6)
            counts = {item["status"]: item["count"] for item in body["distribution"]}
            self.assertEqual(sum(counts.values()), body["total_orders"])
            self.assertGreaterEqual(counts["completed"], 1)
            self.assertGreaterEqual(counts["cancelled"], 1)

    def test_top_dishes_and_order_volume_rbac_and_postgres_aggregation(self):
        for endpoint in ("/api/v1/manager/analytics/top-dishes", "/api/v1/manager/analytics/order-volume"):
            self.assertEqual(self._request(endpoint)[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Cookie": self.cust_cookie})[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Cookie": self.kit_cookie})[0], 403)
            self.assertEqual(
                self._request(f"{endpoint}?period=hourly", headers={"Cookie": self.mgr_cookie})[0],
                422,
            )

        for period, expected_len in (("last_7_days", 7), ("last_30_days", 30), ("last_12_months", 12)):
            status_d, body_d, hdrs_d = self._request(
                f"/api/v1/manager/analytics/top-dishes?period={period}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(status_d, 200)
            self.assertIn("no-store", hdrs_d.get("Cache-Control", ""))
            self.assertEqual(body_d["period"], period)
            self.assertEqual(body_d["metric"], "units_sold")
            self.assertLessEqual(len(body_d["items"]), 5)
            self.assertGreaterEqual(len(body_d["items"]), 1)
            units = [item["units_sold"] for item in body_d["items"]]
            self.assertEqual(units, sorted(units, reverse=True))

            status_v, body_v, hdrs_v = self._request(
                f"/api/v1/manager/analytics/order-volume?period={period}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(status_v, 200)
            self.assertIn("no-store", hdrs_v.get("Cache-Control", ""))
            self.assertEqual(body_v["period"], period)
            self.assertEqual(body_v["timezone"], "Asia/Manila")
            self.assertEqual(body_v["metric"], "orders_placed")
            self.assertEqual(len(body_v["data"]), expected_len)
            self.assertEqual(sum(p["orders"] for p in body_v["data"]), body_v["total_orders"])
            self.assertGreaterEqual(body_v["data"][-1]["orders"], 2)

    def test_kpi_summary_and_operational_alerts_rbac_and_postgres(self):
        for endpoint in ("/api/v1/manager/analytics/kpi-summary", "/api/v1/manager/analytics/operational-alerts"):
            self.assertEqual(self._request(endpoint)[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Cookie": self.cust_cookie})[0], 401)
            self.assertEqual(self._request(endpoint, headers={"Cookie": self.kit_cookie})[0], 403)

        self.assertEqual(
            self._request("/api/v1/manager/analytics/kpi-summary?period=bad", headers={"Cookie": self.mgr_cookie})[0],
            422,
        )

        for period in ("last_7_days", "last_30_days", "last_12_months"):
            status_k, body_k, hdrs_k = self._request(
                f"/api/v1/manager/analytics/kpi-summary?period={period}",
                headers={"Cookie": self.mgr_cookie},
            )
            self.assertEqual(status_k, 200)
            self.assertIn("no-store", hdrs_k.get("Cache-Control", ""))
            self.assertEqual(body_k["period"], period)
            self.assertEqual(body_k["currency"], "PHP")
            self.assertGreaterEqual(Decimal(str(body_k["total_revenue"])), Decimal("250.00"))
            self.assertGreaterEqual(body_k["total_orders"], 2)
            self.assertGreaterEqual(body_k["completed_orders"], 1)
            self.assertGreater(Decimal(str(body_k["average_order_value"])), Decimal("0.00"))

        status_a, body_a, hdrs_a = self._request(
            "/api/v1/manager/analytics/operational-alerts",
            headers={"Cookie": self.mgr_cookie},
        )
        self.assertEqual(status_a, 200)
        self.assertIn("no-store", hdrs_a.get("Cache-Control", ""))
        self.assertIsInstance(body_a["ready_orders_count"], int)
        self.assertIsInstance(body_a["pending_orders_count"], int)
        self.assertIsInstance(body_a["low_stock_count"], int)
        self.assertIsInstance(body_a["out_of_stock_count"], int)
        self.assertIsInstance(body_a["low_stock_names"], list)
