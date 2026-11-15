"""Idempotent database initialization and seeding script for SavoryBites staging.

Performs:
1. Schema verification and table creation via SQLAlchemy models.
2. Alembic revision stamp to 'head' (20261023_13).
3. Core reference data population:
   - System roles (customer, cashier, kitchen_staff, manager)
   - Active payment methods (cash, gcash, card)
   - Restaurant tables (Tables 1 through 10)
   - Menu categories and items
   - Starter inventory items and recipes
4. Staging staff provisioning with secure credentials.
5. Connectivity and health verification.
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import normalize_database_url, settings
from app.core.security import hash_password
from app.db.database import Base
import app.db.models
from app.db.models.category import MenuCategory
from app.db.models.inventory import InventoryItem, MenuItemIngredient
from app.db.models.payment_method import PaymentMethod
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.db.models.restaurant_table import RestaurantTable
from app.db.models.staff import Role, StaffUser


def _ensure_postgresql_constraints_and_indexes(engine) -> None:
    """Apply migration-defined partial unique indexes and CHECK constraints on PostgreSQL."""
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_password_hash ON users (password_hash) WHERE password_hash IS NOT NULL"))
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_customer_idempotency_key
            ON orders (customer_id, idempotency_key)
            WHERE customer_id IS NOT NULL AND idempotency_key IS NOT NULL
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_orders_kds_active
            ON orders (status, ordered_at)
            WHERE status IN ('pending', 'confirmed', 'preparing', 'ready')
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_cancelled_by_customer_id ON orders (cancelled_by_customer_id) WHERE cancelled_by_customer_id IS NOT NULL"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_cancelled_at ON orders (cancelled_at DESC) WHERE cancelled_at IS NOT NULL"))
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transactions_order_sale
            ON inventory_transactions (inventory_item_id, transaction_type, reference_type, reference_id)
            WHERE transaction_type = 'sale' AND reference_type = 'order_confirmation' AND reference_id IS NOT NULL
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_has_customer_owner_check') THEN
                    ALTER TABLE orders ADD CONSTRAINT orders_has_customer_owner_check
                        CHECK (customer_id IS NOT NULL OR legacy_customer_user_id IS NOT NULL) NOT VALID;
                    ALTER TABLE orders VALIDATE CONSTRAINT orders_has_customer_owner_check;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_consistency_check') THEN
                    ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_consistency_check CHECK (
                        (fulfillment_type IS NULL AND restaurant_table_id IS NULL)
                        OR (order_type = 'dine_in' AND fulfillment_type = 'table_service' AND restaurant_table_id IS NOT NULL)
                        OR (order_type = 'takeout' AND fulfillment_type = 'counter_pickup' AND restaurant_table_id IS NULL)
                    ) NOT VALID;
                    ALTER TABLE orders VALIDATE CONSTRAINT orders_fulfillment_consistency_check;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_sizes_price_adjustment_check') THEN
                    ALTER TABLE menu_item_sizes ADD CONSTRAINT menu_item_sizes_price_adjustment_check CHECK (price_adjustment >= 0);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_addons_price_adjustment_check') THEN
                    ALTER TABLE menu_item_addons ADD CONSTRAINT menu_item_addons_price_adjustment_check CHECK (price_adjustment >= 0);
                END IF;
            END $$;
        """))


def init_database(db_url: str, *, reset_passwords: bool = False) -> None:
    db_url = normalize_database_url(db_url)
    print(f"[*] Initializing staging database at: {db_url.split('@')[-1]}")
    engine = create_engine(db_url, pool_pre_ping=True)
    alembic_ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url.replace("%", "%%"))

    # 1. Run incremental Alembic migrations if already stamped; otherwise create schema & stamp head
    has_alembic = inspect(engine).has_table("alembic_version")
    if has_alembic:
        print("[*] Existing alembic_version found; applying incremental migrations (upgrade head)...")
        previous_db_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = db_url
        try:
            command.upgrade(alembic_cfg, "head")
        finally:
            if previous_db_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_db_url
    else:
        print("[*] Creating relational tables and schema...")
        Base.metadata.create_all(engine)

    # 2. Apply migration-only partial indexes & CHECK constraints, then stamp Alembic head
    print("[*] Ensuring PostgreSQL constraints and partial indexes...")
    _ensure_postgresql_constraints_and_indexes(engine)
    if not has_alembic:
        print("[*] Stamping Alembic migration version to head...")
        try:
            command.stamp(alembic_cfg, "head")
        except Exception as exc:
            print(f"[!] Note on alembic stamp: {exc}")

    # 3. Seed Reference Data
    with Session(engine) as session:
        # A. Roles
        roles_data = [
            (1, "customer", "Standard ordering customer account"),
            (2, "cashier", "Front counter cashier staff"),
            (3, "kitchen_staff", "Kitchen line and prep display staff"),
            (4, "manager", "Restaurant operations and menu manager"),
        ]
        for role_id, role_name, role_desc in roles_data:
            existing_role = session.scalar(select(Role).where(Role.id == role_id))
            if not existing_role:
                session.add(Role(id=role_id, name=role_name, description=role_desc))
        session.commit()
        print("[+] Roles seeded.")

        # B. Payment Methods
        now = datetime.now(timezone.utc)
        payment_data = [
            ("cash", "Cash on Counter / Dine-In", "Pay with cash at counter or table.", 1),
            ("gcash", "GCash", "Pay via GCash QR code / e-wallet.", 2),
            ("card", "Credit / Debit Card", "Visa, Mastercard, or debit cards via POS terminal.", 3),
        ]
        for code, label, desc, order in payment_data:
            existing_pm = session.scalar(select(PaymentMethod).where(PaymentMethod.code == code))
            if not existing_pm:
                session.add(PaymentMethod(
                    code=code,
                    label=label,
                    description=desc,
                    is_active=True,
                    display_order=order,
                    created_at=now,
                    updated_at=now,
                ))
        session.commit()
        print("[+] Payment methods seeded.")

        # C. Restaurant Tables
        for table_num in range(1, 11):
            table_str = f"Table {table_num}"
            legacy_str = str(table_num)
            existing_tbl = session.scalar(
                select(RestaurantTable).where(
                    RestaurantTable.table_number.in_([table_str, legacy_str])
                )
            )
            if not existing_tbl:
                session.add(RestaurantTable(
                    table_number=table_str,
                    seats=4,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ))
        session.commit()
        print("[+] Restaurant tables (Table 1-Table 10) seeded.")

        # D. Categories
        categories_data = [
            (1, "Burgers", "Juicy, artisanal grilled burgers made with fresh premium ingredients.", 1),
            (2, "Chicken", "Crispy fried and grilled seasoned chicken selections.", 2),
            (3, "Pasta", "Handcrafted Italian pasta favorites with rich savory sauces.", 3),
            (4, "Rice Meals", "Hearty Filipino-inspired rice bowls and savory mains.", 4),
            (5, "Pizza", "Hand-tossed pizzas baked golden with generous toppings.", 5),
            (6, "Salads", "Crisp garden greens tossed with house-made dressings.", 6),
            (7, "Desserts", "Indulgent cakes and sweet finishes crafted daily.", 7),
            (8, "Beverages", "Refreshing iced teas, natural juices, and specialty coffees.", 8),
            (9, "Breakfast", "Morning classics and coffee pairings.", 9),
            (10, "Snacks", "Crispy golden sides and shareable bites.", 10),
        ]
        for cat_id, cat_name, cat_desc, cat_order in categories_data:
            existing_cat = session.scalar(select(MenuCategory).where(MenuCategory.id == cat_id))
            if not existing_cat:
                session.add(MenuCategory(
                    id=cat_id,
                    name=cat_name,
                    description=cat_desc,
                    display_order=cat_order,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ))
        session.commit()
        print("[+] Menu categories seeded.")

        # E. Starter Products (with baked WebP dish photography under backend/media/dishes/)
        products_data = [
            (1, 1, "Classic Burger", "Grilled beef patty with melted cheddar, crisp lettuce, and signature house sauce.", Decimal("120.00"), True, "/api/v1/media/dishes/dish_ad8ef5c9cde74c50b44f22f6d212256a.webp"),
            (2, 1, "Cheese Burger", "Flame-seared beef patty layered with double cheddar, pickles, and brioche bun.", Decimal("150.00"), True, "/api/v1/media/dishes/dish_41f9dc72448742bcbe713f82392e0e21.webp"),
            (3, 2, "Crispy Chicken Meal", "Golden crunchy chicken served with savory gravy and seasoned steamed rice.", Decimal("155.00"), True, "/api/v1/media/dishes/dish_f08a32b070db4cf18bd4628d9923d1d1.webp"),
            (4, 3, "Chicken Alfredo", "Al dente fettuccine tossed in rich parmesan garlic cream with grilled chicken.", Decimal("180.00"), True, "/api/v1/media/dishes/dish_31c4bca5b08542c9a30a2debbb154cd7.webp"),
            (5, 4, "Chicken Adobo Rice", "Tender soy-vinegar braised chicken glazed with garlic over hot steamed rice.", Decimal("145.00"), True, "/api/v1/media/dishes/dish_3207c0d2232140c4859a4786f2aaedb1.webp"),
            (6, 5, "Hawaiian Pizza", "Hand-tossed crust topped with tangy tomato sauce, mozzarella, ham, and sweet pineapple.", Decimal("320.00"), True, "/api/v1/media/dishes/dish_2ca185930f5a4147966fbce0490ee5b0.webp"),
            (7, 6, "Garden Salad", "Crisp seasonal greens, cherry tomatoes, cucumber, and house vinaigrette.", Decimal("110.00"), True, "/api/v1/media/dishes/dish_6f1c9664fac4472d905e45f4871dfdc4.webp"),
            (8, 7, "Chocolate Cake", "Rich dark chocolate sponge layered with silky cocoa ganache.", Decimal("95.00"), True, "/api/v1/media/dishes/dish_0c6ae7ca4f4449bc84f282c8a6e2599d.webp"),
            (9, 8, "Iced Tea", "Freshly brewed house blend black tea with natural citrus infusion.", Decimal("55.00"), False, "/api/v1/media/dishes/dish_86fdfc1d39454775875fc80a870f5135.webp"),
            (10, 10, "French Fries", "Crispy golden potato fries lightly seasoned with sea salt.", Decimal("85.00"), True, "/api/v1/media/dishes/dish_d09846a7d1d84df890d642e010a5162e.webp"),
        ]
        for prod_id, cat_id, prod_name, prod_desc, prod_price, is_avail, img_url in products_data:
            existing_prod = session.scalar(select(MenuProduct).where(MenuProduct.id == prod_id))
            if not existing_prod:
                session.add(MenuProduct(
                    id=prod_id,
                    category_id=cat_id,
                    name=prod_name,
                    description=prod_desc,
                    price=prod_price,
                    is_available=is_avail,
                    image_url=img_url,
                    created_at=now,
                    updated_at=now,
                ))
            elif not existing_prod.image_url:
                existing_prod.image_url = img_url
                existing_prod.updated_at = now
        session.commit()
        print("[+] Menu products seeded.")

        # F. Starter Product Options (Sizes and Add-ons)
        for prod_id in range(1, 11):
            has_regular = session.scalar(select(MenuItemSize).where(MenuItemSize.product_id == prod_id, MenuItemSize.code == "Regular"))
            if not has_regular:
                session.add(MenuItemSize(product_id=prod_id, code="Regular", label="Regular", price_adjustment=Decimal("0.00"), display_order=1))
            has_large = session.scalar(select(MenuItemSize).where(MenuItemSize.product_id == prod_id, MenuItemSize.code == "Large"))
            if not has_large:
                session.add(MenuItemSize(product_id=prod_id, code="Large", label="Large", price_adjustment=Decimal("40.00"), display_order=2))

            existing_addons = session.scalar(select(MenuItemAddon).where(MenuItemAddon.product_id == prod_id))
            if not existing_addons:
                session.add(MenuItemAddon(product_id=prod_id, code="Extra cheese", label="Extra cheese", price_adjustment=Decimal("30.00"), display_order=1))
                session.add(MenuItemAddon(product_id=prod_id, code="Extra sauce", label="Extra sauce", price_adjustment=Decimal("15.00"), display_order=2))
        session.commit()
        print("[+] Product sizes and addons seeded.")

        # G. Inventory Items & Recipes
        inventory_data = [
            ("Ground Beef", "INV-BEEF-001", "kg", Decimal("18.50"), Decimal("5.00"), Decimal("420.00")),
            ("Burger Bun", "INV-BUN-001", "piece", Decimal("95.00"), Decimal("20.00"), Decimal("18.00")),
            ("Cheddar Cheese", "INV-CHEESE-001", "slice", Decimal("120.00"), Decimal("30.00"), Decimal("12.00")),
            ("Chicken Meat", "INV-CHICKEN-001", "kg", Decimal("24.00"), Decimal("7.00"), Decimal("280.00")),
            ("Rice", "INV-RICE-001", "kg", Decimal("35.00"), Decimal("10.00"), Decimal("58.00")),
            ("Cooking Oil", "INV-OIL-001", "liter", Decimal("20.00"), Decimal("5.00"), Decimal("95.00")),
            ("Pasta", "INV-PASTA-001", "kg", Decimal("12.00"), Decimal("3.00"), Decimal("115.00")),
            ("Pineapple", "INV-PINE-001", "kg", Decimal("9.00"), Decimal("2.00"), Decimal("130.00")),
            ("Iced Tea Syrup", "INV-TEA-001", "liter", Decimal("14.00"), Decimal("4.00"), Decimal("160.00")),
            ("Mixed Vegetables", "INV-VEG-001", "kg", Decimal("16.00"), Decimal("4.00"), Decimal("150.00")),
            ("Potatoes", "INV-POTATO-001", "kg", Decimal("30.00"), Decimal("8.00"), Decimal("55.00")),
            ("Flour", "INV-FLOUR-001", "kg", Decimal("15.00"), Decimal("4.00"), Decimal("58.00")),
            ("Cocoa Powder", "INV-COCOA-001", "kg", Decimal("5.00"), Decimal("1.00"), Decimal("350.00")),
            ("Sugar", "INV-SUGAR-001", "kg", Decimal("20.00"), Decimal("5.00"), Decimal("70.00")),
        ]
        created_inv: dict[str, int] = {}
        for name, sku, unit, stock, reorder, cost in inventory_data:
            item = session.scalar(select(InventoryItem).where(InventoryItem.sku == sku))
            if not item:
                item = InventoryItem(
                    name=name,
                    sku=sku,
                    unit=unit,
                    current_stock=stock,
                    reorder_level=reorder,
                    unit_cost=cost,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
                session.add(item)
                session.flush()
            created_inv[sku] = item.id
        session.commit()
        print("[+] Inventory items seeded.")

        # H. Link recipes for all seeded catalog dishes
        recipe_specs = [
            (1, "INV-BEEF-001", Decimal("0.15")),
            (1, "INV-BUN-001", Decimal("1.00")),
            (2, "INV-BEEF-001", Decimal("0.15")),
            (2, "INV-CHEESE-001", Decimal("1.00")),
            (3, "INV-CHICKEN-001", Decimal("0.20")),
            (3, "INV-RICE-001", Decimal("0.18")),
            (4, "INV-CHICKEN-001", Decimal("0.12")),
            (4, "INV-PASTA-001", Decimal("0.12")),
            (5, "INV-CHICKEN-001", Decimal("0.20")),
            (5, "INV-RICE-001", Decimal("0.18")),
            (5, "INV-OIL-001", Decimal("0.02")),
            (6, "INV-PINE-001", Decimal("0.08")),
            (7, "INV-OIL-001", Decimal("0.01")),
            (7, "INV-VEG-001", Decimal("0.25")),
            (8, "INV-FLOUR-001", Decimal("0.12")),
            (8, "INV-COCOA-001", Decimal("0.03")),
            (8, "INV-SUGAR-001", Decimal("0.09")),
            (9, "INV-TEA-001", Decimal("0.25")),
            (10, "INV-OIL-001", Decimal("0.03")),
            (10, "INV-POTATO-001", Decimal("0.25")),
        ]
        for prod_id, sku, qty in recipe_specs:
            inv_id = created_inv.get(sku)
            if inv_id is None:
                continue
            existing_link = session.scalar(
                select(MenuItemIngredient).where(
                    MenuItemIngredient.menu_item_id == prod_id,
                    MenuItemIngredient.inventory_item_id == inv_id,
                )
            )
            if not existing_link:
                session.add(MenuItemIngredient(menu_item_id=prod_id, inventory_item_id=inv_id, quantity_required=qty))
        session.commit()
        print("[+] Recipes linked for all seeded dishes.")

        # I. Staging Staff Accounts (preserve rotated credentials unless reset requested)
        now = datetime.now(timezone.utc)
        manager_pwd = os.environ.get("STAGING_MANAGER_PASSWORD", "StagingManagerPass2026!")
        kitchen_pwd = os.environ.get("STAGING_KITCHEN_PASSWORD", "StagingKitchenPass2026!")
        staging_staff = [
            ("manager@savorybites.staging", "Staging Operations Manager", 4, manager_pwd),
            ("kitchen@savorybites.staging", "Staging Line Cook", 3, kitchen_pwd),
        ]
        should_reset = reset_passwords or os.environ.get("RESET_STAGING_PASSWORDS", "").lower() in {"1", "true", "yes"}
        for email, name, role_id, pwd in staging_staff:
            user = session.scalar(select(StaffUser).where(StaffUser.email == email))
            if not user:
                pwd_hash = hash_password(pwd)
                session.add(StaffUser(
                    role_id=role_id,
                    name=name,
                    email=email,
                    legacy_password=pwd_hash,
                    password_hash=pwd_hash,
                    status="active",
                    created_at=now,
                    updated_at=now,
                ))
            elif should_reset or not user.password_hash:
                pwd_hash = hash_password(pwd)
                user.password_hash = pwd_hash
                user.status = "active"
                user.updated_at = now
        session.commit()
        print("[+] Staging staff accounts provisioned.")

        # J. Synchronize PostgreSQL Sequences for auto-increment IDs
        if engine.dialect.name == "postgresql":
            session.execute(text("""
                SELECT setval(pg_get_serial_sequence('menu_categories', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_categories), 1), true);
                SELECT setval(pg_get_serial_sequence('menu_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_items), 1), true);
                SELECT setval(pg_get_serial_sequence('menu_item_sizes', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_item_sizes), 1), true);
                SELECT setval(pg_get_serial_sequence('menu_item_addons', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_item_addons), 1), true);
                SELECT setval(pg_get_serial_sequence('restaurant_tables', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM restaurant_tables), 1), true);
                SELECT setval(pg_get_serial_sequence('roles', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM roles), 1), true);
                SELECT setval(pg_get_serial_sequence('payment_methods', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM payment_methods), 1), true);
                SELECT setval(pg_get_serial_sequence('inventory_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM inventory_items), 1), true);
                SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1), true);
                SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM audit_logs), 1), true);
            """))
            session.commit()
            print("[+] PostgreSQL sequences synchronized.")

    # 4. Final Health Verification
    with engine.connect() as conn:
        res = conn.execute(text("SELECT 1")).scalar()
        if res == 1:
            print("[OK] Database readiness probe verified successfully (SELECT 1 returned 1).")

    engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize and seed the SavoryBites staging database.")
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help="Reset staging default staff account passwords if the accounts already exist.",
    )
    args = parser.parse_args()
    target_url = os.environ.get("DATABASE_URL")
    if not target_url:
        target_url = settings.DATABASE_URL.rsplit("/", 1)[0] + "/restaurant_db_staging"
    init_database(target_url, reset_passwords=args.reset_passwords)
