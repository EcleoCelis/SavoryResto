from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models.category import MenuCategory
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemSize
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.schemas.checkout import CheckoutLineRequest
from app.schemas.product import ProductCreate, ProductUpdate
from app.services.catalog_service import (
    CatalogConflictError,
    create_category,
    create_product,
    delete_category,
    delete_product,
    get_product,
    list_manager_categories,
    list_manager_products,
    list_products,
    update_category,
    update_product,
    update_product_availability,
)
from app.services.checkout_service import quote_checkout_items


class CatalogServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.db = sessionmaker(bind=self.engine)()
        Base.metadata.create_all(self.engine)
        now = datetime.now(timezone.utc)
        burgers = MenuCategory(id=1, name="Burgers", display_order=1, is_active=True, created_at=now, updated_at=now)
        drinks = MenuCategory(id=2, name="Drinks", display_order=2, is_active=True, created_at=now, updated_at=now)
        self.available = MenuProduct(id=1, category_id=1, name="Classic Burger", description="Grilled beef patty", price=Decimal("120"), is_available=True, created_at=now, updated_at=now)
        self.unavailable = MenuProduct(id=2, category_id=1, name="Cheese Burger", description="Cheese and beef", price=Decimal("140"), is_available=False, created_at=now, updated_at=now)
        drink = MenuProduct(id=3, category_id=2, name="Iced Tea", description="Fresh brewed tea", price=Decimal("50"), is_available=True, created_at=now, updated_at=now)
        self.db.add_all([burgers, drinks, self.available, self.unavailable, drink, MenuItemSize(id=1, product_id=1, code="Regular", label="Regular", price_adjustment=Decimal("0"), display_order=1, is_active=True)])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_catalog_search_and_filters_combine_against_database_data(self):
        self.assertEqual([product.name for product in list_products(self.db)], ["Classic Burger", "Iced Tea"])
        self.assertEqual([product.name for product in list_products(self.db, search="burger", availability="all")], ["Cheese Burger", "Classic Burger"])
        self.assertEqual([product.name for product in list_products(self.db, category_id=1, search="burger", availability="unavailable")], ["Cheese Burger"])
        self.assertEqual(list_products(self.db, search="tea", availability="unavailable"), [])
        self.assertEqual(list_products(self.db, search="%", availability="all"), [])

    def test_unavailable_product_is_visible_for_display_but_rejected_at_checkout(self):
        self.assertFalse(get_product(self.db, self.unavailable.id).is_available)
        self.available.is_available = False
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "cart items are unavailable"):
            quote_checkout_items(self.db, [CheckoutLineRequest(cart_line_id="unavailable", product_id=self.available.id, quantity=1, size="Regular", addons=[])])

    def test_list_manager_categories_includes_product_counts(self):
        cats = list_manager_categories(self.db)
        self.assertEqual(len(cats), 2)
        burgers = next(c for c in cats if c["name"] == "Burgers")
        drinks = next(c for c in cats if c["name"] == "Drinks")
        self.assertEqual(burgers["product_count"], 2)
        self.assertEqual(drinks["product_count"], 1)

    def test_category_create_update_and_delete_lifecycle(self):
        created = create_category(self.db, CategoryCreate(name="Desserts", display_order=3))
        self.assertEqual(created.name, "Desserts")
        self.assertTrue(created.is_active)

        updated = update_category(self.db, created.id, CategoryUpdate(name="Sweet Desserts", is_active=False))
        self.assertIsNotNone(updated)
        self.assertEqual(updated.name, "Sweet Desserts")
        self.assertFalse(updated.is_active)

        # Deleting empty category succeeds
        deleted, message = delete_category(self.db, created.id)
        self.assertTrue(deleted)

    def test_delete_category_with_active_products_fails(self):
        deleted, message = delete_category(self.db, 1)
        self.assertFalse(deleted)
        self.assertIn("active dish(es)", message)

    def test_product_create_provisions_default_regular_size(self):
        new_prod = create_product(
            self.db,
            ProductCreate(
                category_id=1,
                name="Bacon Burger",
                price=Decimal("180"),
                description="Crispy bacon",
                image_url="/images/bacon.jpg",
                is_available=True,
            ),
        )
        self.assertIsNotNone(new_prod)
        self.assertEqual(new_prod.name, "Bacon Burger")
        self.assertEqual(len(new_prod.sizes), 1)
        self.assertEqual(new_prod.sizes[0].code, "Regular")
        self.assertEqual(new_prod.sizes[0].price_adjustment, Decimal("0"))

    def test_product_update_and_availability_toggle(self):
        updated = update_product(
            self.db,
            self.available.id,
            ProductUpdate(name="Classic Prime Burger", price=Decimal("150")),
        )
        self.assertEqual(updated.name, "Classic Prime Burger")
        self.assertEqual(updated.price, Decimal("150"))

        toggled = update_product_availability(self.db, self.available.id, False)
        self.assertFalse(toggled.is_available)

    def test_delete_product_is_soft_delete(self):
        deleted = delete_product(self.db, self.available.id)
        self.assertTrue(deleted)
        self.assertIsNone(get_product(self.db, self.available.id))
        self.assertNotIn(self.available.id, [p.id for p in list_manager_products(self.db)])

    def test_whitespace_names_and_excessive_prices_rejected(self):
        with self.assertRaises(ValidationError):
            CategoryCreate(name="   ", display_order=1)
        with self.assertRaises(ValidationError):
            ProductCreate(category_id=1, name="   ", price=Decimal("100.00"))
        with self.assertRaises(ValidationError):
            ProductCreate(category_id=1, name="Overpriced", price=Decimal("999999999.99"))

        quantized = ProductCreate(category_id=1, name="Trimmed Dish", price=Decimal("123.456"))
        self.assertEqual(quantized.price, Decimal("123.46"))

    def test_optimistic_locking_conflicts_on_stale_product_and_category_updates(self):
        stale_ts = datetime.now(timezone.utc) - timedelta(hours=1)
        with self.assertRaises(CatalogConflictError):
            update_product(
                self.db,
                self.available.id,
                ProductUpdate(name="Stale Attempt", expected_updated_at=stale_ts),
            )
        with self.assertRaises(CatalogConflictError):
            update_category(
                self.db,
                1,
                CategoryUpdate(name="Stale Category", expected_updated_at=stale_ts),
            )

        fresh = update_product(
            self.db,
            self.available.id,
            ProductUpdate(price=Decimal("135.50"), expected_updated_at=self.available.updated_at),
        )
        self.assertIsNotNone(fresh)
        self.assertEqual(fresh.price, Decimal("135.50"))

        quote = quote_checkout_items(
            self.db,
            [CheckoutLineRequest(cart_line_id="l1", product_id=self.available.id, quantity=2, size="Regular", addons=[])],
        )
        self.assertEqual(quote[0].subtotal, Decimal("271.00"))

    def test_inactive_category_hides_customer_products_and_soft_deactivates_when_archived_dishes_exist(self):
        cat = create_category(self.db, CategoryCreate(name="Seasonal Specials", display_order=30))
        prod = create_product(self.db, ProductCreate(category_id=cat.id, name="Seasonal Tart", price=Decimal("95.00")))

        # Deactivate category: customer listing & checkout must exclude it, manager keeps visibility
        update_category(self.db, cat.id, CategoryUpdate(is_active=False))
        self.assertIsNone(get_product(self.db, prod.id))
        self.assertNotIn(prod.id, [p.id for p in list_products(self.db, availability="all")])
        with self.assertRaisesRegex(ValueError, "unavailable"):
            quote_checkout_items(self.db, [CheckoutLineRequest(cart_line_id="l2", product_id=prod.id, quantity=1, size="Regular", addons=[])])

        # Archive the only product, then delete category -> soft-deactivates instead of deleting FK row
        self.assertTrue(delete_product(self.db, prod.id))
        ok, msg = delete_category(self.db, cat.id)
        self.assertTrue(ok)
        self.assertIn("deactivated", msg.lower())
        cats = list_manager_categories(self.db)
        found = next(c for c in cats if c["id"] == cat.id)
        self.assertFalse(found["is_active"])

