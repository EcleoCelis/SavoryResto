from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.order_status import OrderStatus
from app.core.security import create_access_token, create_staff_access_token, get_current_staff, get_optional_current_staff, hash_password, require_staff_roles
from app.db.database import Base
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.inventory import InventoryItem, InventoryTransaction, MenuItemIngredient
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.restaurant_table import RestaurantTable
from app.db.models.staff import Role, StaffUser
from app.services.fulfillment_service import validate_fulfillment
from app.services.inventory_service import deduct_inventory_for_confirmed_order, list_inventory_items, record_inventory_transaction
from app.services.kds_service import list_kds_orders, update_kds_order_status
from app.schemas.inventory import InventoryTransactionCreate
from app.services.checkout_service import quote_checkout_items
from app.schemas.checkout import CheckoutLineRequest
from app.services.staff_service import authenticate_staff


class StaffFulfillmentTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db: Session = sessionmaker(bind=self.engine)()
        now = datetime.now(timezone.utc)
        kitchen_role = Role(id=1, name="kitchen_staff", created_at=now, updated_at=now)
        manager_role = Role(id=2, name="manager", created_at=now, updated_at=now)
        cashier_role = Role(id=3, name="cashier", created_at=now, updated_at=now)
        kitchen_hash = hash_password("SecureKitchen123!"); manager_hash = hash_password("SecureManager123!"); cashier_hash = hash_password("SecureCashier123!")
        self.kitchen = StaffUser(id=1, role_id=1, name="Kitchen", email="kitchen@example.com", legacy_password=kitchen_hash, password_hash=kitchen_hash, status="active", created_at=now, updated_at=now)
        self.manager = StaffUser(id=2, role_id=2, name="Manager", email="manager@example.com", legacy_password=manager_hash, password_hash=manager_hash, status="active", created_at=now, updated_at=now)
        self.cashier = StaffUser(id=3, role_id=3, name="Cashier", email="cashier@example.com", legacy_password=cashier_hash, password_hash=cashier_hash, status="active", created_at=now, updated_at=now)
        self.customer = Customer(customer_id=1, full_name="Customer", email="customer@example.com")
        category = MenuCategory(id=1, name="Meals", display_order=1, is_active=True, created_at=now, updated_at=now)
        product = MenuProduct(id=1, category_id=1, name="Meal", price=Decimal("100"), is_available=True, created_at=now, updated_at=now)
        self.table = RestaurantTable(id=1, table_number="Table 1", seats=4, is_active=True, created_at=now, updated_at=now)
        payment_method = PaymentMethod(id=1, code="cash", label="Cash", is_active=True, display_order=1, created_at=now, updated_at=now)
        self.order = Order(id=1, order_number="SB-KDS", customer_id=1, order_type="dine_in", fulfillment_type="table_service", restaurant_table_id=1, status="pending", subtotal=Decimal("100"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("100"), payment_method_id=1, ordered_at=now, created_at=now, updated_at=now)
        self.db.add_all([kitchen_role, manager_role, cashier_role, self.kitchen, self.manager, self.cashier, self.customer, category, product, self.table, payment_method, self.order, OrderItem(id=1, order_id=1, menu_item_id=1, quantity=1, unit_price=Decimal("100"), discount_amount=Decimal("0"), line_total=Decimal("100"), status="pending", created_at=now, updated_at=now)])
        self.db.commit()

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def test_staff_authentication_uses_hashed_credentials_and_excludes_cashier(self):
        staff = authenticate_staff(self.db, "kitchen@example.com", "SecureKitchen123!")
        self.assertEqual(staff.role.name, "kitchen_staff")
        self.assertIsNone(authenticate_staff(self.db, "kitchen@example.com", "incorrect-password"))
        self.assertEqual(authenticate_staff(self.db, "cashier@example.com", "SecureCashier123!").role.name, "cashier")
        self.assertEqual(get_current_staff(create_staff_access_token(self.kitchen.id, timedelta(minutes=5)), None, self.db).id, self.kitchen.id)
        with self.assertRaises(Exception):
            get_current_staff(create_access_token(self.customer.customer_id, timedelta(minutes=5)), None, self.db)
        # Optional staff retrieval returns StaffUser when valid, None when expired/missing/invalid
        self.assertEqual(get_optional_current_staff(create_staff_access_token(self.kitchen.id, timedelta(minutes=5)), None, self.db).id, self.kitchen.id)
        self.assertIsNone(get_optional_current_staff(None, None, self.db))
        self.assertIsNone(get_optional_current_staff(create_staff_access_token(self.kitchen.id, timedelta(minutes=-5)), None, self.db))
        self.assertIsNone(get_optional_current_staff(create_access_token(self.customer.customer_id, timedelta(minutes=5)), None, self.db))

    def test_staff_user_generates_required_timestamps_when_provisioned(self):
        password_hash = hash_password("ProvisionedStaff123!")
        provisioned = StaffUser(
            id=4,
            role_id=1,
            name="Provisioned Kitchen Staff",
            email="provisioned-kitchen@example.com",
            legacy_password=password_hash,
            password_hash=password_hash,
            status="active",
        )
        self.db.add(provisioned)
        self.db.commit()

        self.assertIsNotNone(provisioned.created_at)
        self.assertIsNotNone(provisioned.updated_at)

    def test_manager_and_kitchen_have_distinct_authorized_interfaces(self):
        manager_access = require_staff_roles("manager")
        kitchen_access = require_staff_roles("kitchen_staff")
        self.assertEqual(manager_access(self.manager).id, self.manager.id)
        self.assertEqual(kitchen_access(self.kitchen).id, self.kitchen.id)
        with self.assertRaises(Exception) as kitchen_denied:
            manager_access(self.kitchen)
        self.assertEqual(kitchen_denied.exception.status_code, 403)
        with self.assertRaises(Exception) as manager_denied:
            kitchen_access(self.manager)
        self.assertEqual(manager_denied.exception.status_code, 403)

    def test_fulfillment_requires_correct_type_table_and_availability(self):
        self.assertIsNone(validate_fulfillment(self.db, "takeout", "counter_pickup", None))
        with self.assertRaisesRegex(ValueError, "cannot have a table"):
            validate_fulfillment(self.db, "takeout", "counter_pickup", self.table.id)
        with self.assertRaisesRegex(ValueError, "currently occupied"):
            validate_fulfillment(self.db, "dine_in", "table_service", self.table.id)
        self.order.status = OrderStatus.COMPLETED.value
        self.db.commit()
        self.assertEqual(validate_fulfillment(self.db, "dine_in", "table_service", self.table.id).id, self.table.id)

    def test_kds_exposes_fulfillment_without_customer_data_and_enforces_roles(self):
        queue = list_kds_orders(self.db)
        self.assertEqual(queue[0].fulfillment_destination, "Table 1")
        self.assertEqual(queue[0].items[0].name, "Menu item")
        self.assertEqual(update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.CONFIRMED).status, OrderStatus.CONFIRMED)
        self.assertEqual(update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.PREPARING).status, OrderStatus.PREPARING)
        self.assertEqual(update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.READY).status, OrderStatus.READY)
        with self.assertRaises(PermissionError):
            update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.COMPLETED)
        self.assertEqual(update_kds_order_status(self.db, self.manager, self.order.id, OrderStatus.COMPLETED).status, OrderStatus.COMPLETED)
        self.assertEqual(list_kds_orders(self.db), [])
        self.assertEqual(list_kds_orders(self.db, OrderStatus.COMPLETED)[0].id, self.order.id)

    def test_confirmation_deducts_recipe_stock_once_and_records_an_audit_transaction(self):
        ingredient = InventoryItem(id=1, name="Chicken", sku="CHICKEN", unit="kg", current_stock=Decimal("1"), reorder_level=Decimal("0.2"), unit_cost=Decimal("100"), is_active=True, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        recipe = MenuItemIngredient(menu_item_id=1, inventory_item_id=1, quantity_required=Decimal("0.2"))
        self.db.add_all([ingredient, recipe])
        self.db.commit()

        self.assertEqual(update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.CONFIRMED).status, OrderStatus.CONFIRMED)
        self.assertEqual(ingredient.current_stock, Decimal("0.8"))
        transactions = list(self.db.scalars(select(InventoryTransaction)))
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].quantity_change, Decimal("-0.2"))
        self.assertEqual(transactions[0].reference_id, self.order.id)

        deduct_inventory_for_confirmed_order(self.db, self.order, self.kitchen)
        self.assertEqual(ingredient.current_stock, Decimal("0.8"))
        self.assertEqual(len(list(self.db.scalars(select(InventoryTransaction)))), 1)

    def test_confirmation_rejects_insufficient_stock_without_partial_deduction(self):
        ingredient = InventoryItem(id=1, name="Chicken", sku="CHICKEN", unit="kg", current_stock=Decimal("0.1"), reorder_level=Decimal("0"), unit_cost=Decimal("100"), is_active=True, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        self.db.add_all([ingredient, MenuItemIngredient(menu_item_id=1, inventory_item_id=1, quantity_required=Decimal("0.2"))])
        self.db.commit()

        with self.assertRaisesRegex(ValueError, "Insufficient stock"):
            update_kds_order_status(self.db, self.kitchen, self.order.id, OrderStatus.CONFIRMED)
        self.db.rollback()
        self.assertEqual(self.db.get(Order, self.order.id).status, OrderStatus.PENDING.value)
        self.assertEqual(self.db.get(InventoryItem, ingredient.id).current_stock, Decimal("0.1"))
        self.assertEqual(list(self.db.scalars(select(InventoryTransaction))), [])

    def test_checkout_rejects_an_order_that_requires_more_stock_than_available(self):
        ingredient = InventoryItem(id=1, name="Chicken", sku="CHICKEN", unit="kg", current_stock=Decimal("0.1"), reorder_level=Decimal("0"), unit_cost=Decimal("100"), is_active=True, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        self.db.add_all([ingredient, MenuItemIngredient(menu_item_id=1, inventory_item_id=1, quantity_required=Decimal("0.2"))])
        self.db.commit()

        with self.assertRaisesRegex(ValueError, "Insufficient stock"):
            quote_checkout_items(self.db, [CheckoutLineRequest(cart_line_id="line", product_id=1, quantity=1, size="Regular", addons=[])])

    def test_manager_inventory_adjustments_are_auditable_and_cannot_make_stock_negative(self):
        ingredient = InventoryItem(id=1, name="Rice", sku="RICE", unit="kg", current_stock=Decimal("1"), reorder_level=Decimal("1"), unit_cost=Decimal("50"), is_active=True, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        self.db.add(ingredient)
        self.db.commit()

        recorded = record_inventory_transaction(self.db, ingredient.id, InventoryTransactionCreate(transaction_type="purchase", quantity_change=Decimal("2"), notes="Delivery received"), self.manager)
        self.assertEqual(recorded.stock_before, Decimal("1"))
        self.assertEqual(recorded.stock_after, Decimal("3"))
        self.assertEqual(list_inventory_items(self.db, low_stock_only=True), [])
        with self.assertRaisesRegex(ValueError, "negative"):
            record_inventory_transaction(self.db, ingredient.id, InventoryTransactionCreate(transaction_type="waste", quantity_change=Decimal("-4")), self.manager)
