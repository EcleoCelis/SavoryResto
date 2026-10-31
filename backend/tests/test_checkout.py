from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import create_access_token, get_current_customer
from app.core.order_status import OrderStatus, parse_order_status, transition_order_status
from app.db.database import Base
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.schemas.checkout import CheckoutLineRequest, CheckoutQuoteRequest
from app.schemas.order import PlaceOrderRequest
from app.services.checkout_service import quote_checkout_items
from app.services.order_service import cancel_customer_order, list_customer_orders, place_order
from app.services.payment_method_service import get_active_payment_method, list_active_payment_methods


class CheckoutServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session: Session = sessionmaker(bind=self.engine)()
        now = datetime.now(timezone.utc)
        self.customer = Customer(customer_id=1, full_name="Test Customer", email="test@example.com")
        category = MenuCategory(id=1, name="Burgers", display_order=1, is_active=True, created_at=now, updated_at=now)
        self.product = MenuProduct(id=1, category_id=1, name="Classic Burger", price=Decimal("120.00"), is_available=True, created_at=now, updated_at=now)
        self.session.add_all([
            self.customer,
            category,
            self.product,
            MenuItemSize(id=1, product_id=1, code="Regular", label="Regular", price_adjustment=Decimal("0"), display_order=1, is_active=True),
            MenuItemSize(id=2, product_id=1, code="Large", label="Large", price_adjustment=Decimal("40"), display_order=2, is_active=True),
            MenuItemAddon(id=1, product_id=1, code="Extra cheese", label="Extra cheese", price_adjustment=Decimal("30"), display_order=1, is_active=True),
            MenuItemAddon(id=2, product_id=1, code="Extra sauce", label="Extra sauce", price_adjustment=Decimal("15"), display_order=2, is_active=True),
            PaymentMethod(id=1, code="cash", label="Cash", description="Pay at pickup.", is_active=True, display_order=1, created_at=now, updated_at=now),
            PaymentMethod(id=2, code="gcash", label="GCash", description="Pay with GCash.", is_active=False, display_order=2, created_at=now, updated_at=now),
        ])
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_quote_uses_database_option_prices(self):
        lines = quote_checkout_items(self.session, [
            CheckoutLineRequest(cart_line_id="1:large", product_id=1, quantity=2, size="Large", addons=["Extra cheese", "Extra sauce"])
        ])

        self.assertEqual(lines[0].unit_price, Decimal("205.00"))
        self.assertEqual(lines[0].subtotal, Decimal("410.00"))

    def test_quote_rejects_unavailable_options_and_products(self):
        with self.assertRaisesRegex(ValueError, "selected size"):
            quote_checkout_items(self.session, [CheckoutLineRequest(cart_line_id="bad-size", product_id=1, quantity=1, size="Family", addons=[])])
        with self.assertRaisesRegex(ValueError, "selected add-ons"):
            quote_checkout_items(self.session, [CheckoutLineRequest(cart_line_id="bad-addon", product_id=1, quantity=1, size="Regular", addons=["Bacon"])])
        with self.assertRaisesRegex(ValueError, "cart items are unavailable"):
            quote_checkout_items(self.session, [CheckoutLineRequest(cart_line_id="missing", product_id=999, quantity=1, size="Regular", addons=[])])

    def test_checkout_schema_rejects_empty_duplicate_and_invalid_quantities(self):
        with self.assertRaises(ValueError):
            CheckoutQuoteRequest(items=[])
        with self.assertRaises(ValueError):
            CheckoutQuoteRequest(items=[
                {"cart_line_id": "one", "product_id": 1, "quantity": 1, "size": "Regular", "addons": []},
                {"cart_line_id": "one", "product_id": 1, "quantity": 1, "size": "Regular", "addons": []},
            ])
        with self.assertRaises(ValueError):
            CheckoutLineRequest(cart_line_id="quantity", product_id=1, quantity=0, size="Regular", addons=[])

    def test_payment_methods_only_expose_active_methods_and_use_stable_codes(self):
        methods = list_active_payment_methods(self.session)
        self.assertEqual([method.code for method in methods], ["cash"])
        self.assertEqual(get_active_payment_method(self.session, "cash").label, "Cash")
        self.assertIsNone(get_active_payment_method(self.session, "gcash"))

    def test_order_status_transitions_are_validated_and_persisted(self):
        now = datetime.now(timezone.utc)
        order = Order(id=300, order_number="SB-STATUS", customer_id=1, order_type="takeout", status="pending", subtotal=Decimal("120"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("120"), ordered_at=now, created_at=now, updated_at=now)
        self.session.add(order)
        self.session.commit()

        self.assertEqual(transition_order_status(order, OrderStatus.CONFIRMED), OrderStatus.CONFIRMED)
        self.session.commit()
        self.assertEqual(self.session.get(Order, 300).status, OrderStatus.CONFIRMED.value)

        with self.assertRaisesRegex(ValueError, "cannot transition"):
            transition_order_status(order, OrderStatus.COMPLETED)
        with self.assertRaisesRegex(ValueError, "status is invalid"):
            parse_order_status("paid")

    def test_customer_cancellation_preserves_order_and_rejects_ineligible_states(self):
        now = datetime.now(timezone.utc)
        cancellable = Order(id=301, order_number="SB-CANCEL", customer_id=1, order_type="takeout", status="confirmed", subtotal=Decimal("120"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("120"), ordered_at=now, created_at=now, updated_at=now)
        preparing = Order(id=302, order_number="SB-PREPARING", customer_id=1, order_type="takeout", status="preparing", subtotal=Decimal("120"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("120"), ordered_at=now, created_at=now, updated_at=now)
        self.session.add_all([
            cancellable,
            preparing,
            Order(id=303, order_number="SB-OTHER", customer_id=2, order_type="takeout", status="pending", subtotal=Decimal("120"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("120"), ordered_at=now, created_at=now, updated_at=now),
            Customer(customer_id=2, full_name="Other Customer", email="other@example.com"),
            OrderItem(id=301, order_id=301, menu_item_id=1, quantity=1, unit_price=Decimal("120"), discount_amount=Decimal("0"), line_total=Decimal("120"), status="confirmed", created_at=now, updated_at=now),
        ])
        self.session.commit()

        cancelled = cancel_customer_order(self.session, self.customer, cancellable.id, "Changed my mind")
        self.assertEqual(cancelled.status, OrderStatus.CANCELLED)
        self.assertTrue(cancelled.is_cancellable is False)
        self.assertEqual(cancelled.cancellation_reason, "Changed my mind")
        persisted = self.session.get(Order, cancellable.id)
        self.assertEqual(persisted.status, OrderStatus.CANCELLED.value)
        self.assertEqual(persisted.cancelled_by_customer_id, self.customer.customer_id)
        self.assertIsNotNone(persisted.cancelled_at)
        self.assertEqual(self.session.get(OrderItem, 301).status, OrderStatus.CANCELLED.value)
        self.assertIsNone(cancel_customer_order(self.session, self.customer, 303, None))
        with self.assertRaisesRegex(ValueError, "can no longer"):
            cancel_customer_order(self.session, self.customer, preparing.id, None)

    def test_access_token_resolves_only_the_authenticated_customer(self):
        token = create_access_token(self.customer.customer_id, timedelta(minutes=5))
        resolved = get_current_customer(token, None, self.session)
        self.assertEqual(resolved.customer_id, self.customer.customer_id)

        expired = create_access_token(self.customer.customer_id, timedelta(seconds=-1))
        with self.assertRaises(HTTPException) as error:
            get_current_customer(expired, None, self.session)
        self.assertEqual(error.exception.status_code, 401)

    @patch("app.services.order_service.get_active_payment_method")
    @patch("app.services.order_service.validate_fulfillment")
    @patch("app.services.order_service.quote_checkout_items")
    def test_order_creation_rolls_back_when_a_database_write_fails(self, quote_checkout_items_mock, validate_fulfillment_mock, payment_method_mock):
        quote_checkout_items_mock.return_value = [MagicMock(cart_line_id="line", product_id=1, name="Classic Burger", quantity=1, unit_price=Decimal("120"), subtotal=Decimal("120"))]
        validate_fulfillment_mock.return_value = None
        payment_method_mock.return_value = MagicMock(id=1)
        failing_session = MagicMock()
        failing_session.scalar.return_value = None
        failing_session.flush.side_effect = RuntimeError("database write failed")

        with self.assertRaisesRegex(RuntimeError, "database write failed"):
            place_order(
                failing_session,
                self.customer,
                PlaceOrderRequest(items=[{"cart_line_id": "line", "product_id": 1, "quantity": 1, "size": "Regular", "addons": []}], payment_method_code="cash", order_type="takeout", fulfillment_type="counter_pickup"),
                "e830b9bd-95cd-4e3b-a794-f2cc05e83a29",
            )
        failing_session.rollback.assert_called_once()

    def test_order_rejects_invalid_or_inactive_payment_methods(self):
        request_data = {"items": [{"cart_line_id": "line", "product_id": 1, "quantity": 1, "size": "Regular", "addons": []}], "order_type": "takeout", "fulfillment_type": "counter_pickup"}
        with self.assertRaisesRegex(ValueError, "payment method"):
            place_order(self.session, self.customer, PlaceOrderRequest(**request_data, payment_method_code="missing"), "4a2a58e1-9d26-4aa9-8d1d-8dcd8a41f12a")
        with self.assertRaisesRegex(ValueError, "payment method"):
            place_order(self.session, self.customer, PlaceOrderRequest(**request_data, payment_method_code="gcash"), "2fc25f7a-5d2d-47df-8459-1b980e64ca49")

    def test_history_is_customer_scoped_and_newest_first(self):
        now = datetime.now(timezone.utc)
        other_customer = Customer(customer_id=2, full_name="Other Customer", email="other@example.com")
        older = Order(id=100, order_number="SB-OLD", customer_id=1, order_type="takeout", status="completed", subtotal=Decimal("120"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("120"), ordered_at=now - timedelta(days=1), created_at=now, updated_at=now)
        newer = Order(id=101, order_number="SB-NEW", customer_id=1, order_type="takeout", status="pending", subtotal=Decimal("240"), discount_amount=Decimal("0"), tax_amount=Decimal("0"), total_amount=Decimal("240"), ordered_at=now, created_at=now, updated_at=now)
        self.session.add_all([other_customer, older, newer, OrderItem(id=100, order_id=100, menu_item_id=1, quantity=1, unit_price=Decimal("120"), discount_amount=Decimal("0"), line_total=Decimal("120"), status="completed", created_at=now, updated_at=now), OrderItem(id=101, order_id=101, menu_item_id=1, quantity=2, unit_price=Decimal("120"), discount_amount=Decimal("0"), line_total=Decimal("240"), status="pending", created_at=now, updated_at=now)])
        self.session.commit()

        history = list_customer_orders(self.session, self.customer, page=1, page_size=10)
        self.assertEqual([order.id for order in history.items], [101, 100])
        self.assertEqual(history.total, 2)
        self.assertEqual(history.items[0].item_count, 1)
        self.assertEqual(list_customer_orders(self.session, other_customer, page=1, page_size=10).items, [])
