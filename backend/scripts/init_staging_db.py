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
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
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


def init_database(db_url: str) -> None:
    print(f"[*] Initializing staging database at: {db_url.split('@')[-1]}")
    engine = create_engine(db_url, pool_pre_ping=True)

    # 1. Create all relational tables from SQLAlchemy declarative models
    print("[*] Creating relational tables and schema...")
    Base.metadata.create_all(engine)

    # 2. Stamp with Alembic head
    print("[*] Stamping Alembic migration version to head...")
    alembic_ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
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
            table_str = str(table_num)
            existing_tbl = session.scalar(select(RestaurantTable).where(RestaurantTable.table_number == table_str))
            if not existing_tbl:
                session.add(RestaurantTable(
                    table_number=table_str,
                    seats=4,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ))
        session.commit()
        print("[+] Restaurant tables (1-10) seeded.")

        # D. Categories
        categories_data = [
            (1, "Burgers", "Juicy, artisanal grilled burgers made with fresh premium ingredients.", 1),
            (2, "Chicken", "Crispy fried and grilled seasoned chicken selections.", 2),
            (3, "Pasta", "Handcrafted Italian pasta favorites with rich savory sauces.", 3),
            (4, "Beverages", "Refreshing iced teas, natural juices, and specialty coffees.", 4),
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

        # E. Starter Products
        products_data = [
            (1, 1, "Classic Cheeseburger", "Grilled beef patty with melted cheddar, crisp lettuce, and signature sauce.", Decimal("199.00")),
            (2, 1, "Bacon BBQ Burger", "Double smoked bacon, sharp cheddar, onion rings, and smoky BBQ drizzle.", Decimal("249.00")),
            (3, 2, "Crispy Fried Chicken (2 pcs)", "Golden crunchy chicken served with savory gravy and seasoned rice.", Decimal("189.00")),
            (4, 3, "Creamy Truffle Carbonara", "Al dente fettuccine in rich truffle cream with smoked bacon crisps.", Decimal("279.00")),
            (5, 4, "Signature Iced Tea", "Freshly brewed house blend black tea with natural citrus infusion.", Decimal("89.00")),
        ]
        for prod_id, cat_id, prod_name, prod_desc, prod_price in products_data:
            existing_prod = session.scalar(select(MenuProduct).where(MenuProduct.id == prod_id))
            if not existing_prod:
                session.add(MenuProduct(
                    id=prod_id,
                    category_id=cat_id,
                    name=prod_name,
                    description=prod_desc,
                    price=prod_price,
                    is_available=True,
                    created_at=now,
                    updated_at=now,
                ))
        session.commit()
        print("[+] Starter products seeded.")

        # F. Starter Product Options (Sizes and Add-ons)
        for prod_id in range(1, 6):
            has_regular = session.scalar(select(MenuItemSize).where(MenuItemSize.product_id == prod_id, MenuItemSize.code == "regular"))
            if not has_regular:
                session.add(MenuItemSize(product_id=prod_id, code="regular", label="Regular", price_adjustment=Decimal("0.00"), display_order=1))

        has_double = session.scalar(select(MenuItemSize).where(MenuItemSize.product_id == 1, MenuItemSize.code == "double"))
        if not has_double:
            session.add(MenuItemSize(product_id=1, code="double", label="Double Patty", price_adjustment=Decimal("80.00"), display_order=2))

        existing_addons = session.scalar(select(MenuItemAddon).where(MenuItemAddon.product_id == 1))
        if not existing_addons:
            session.add(MenuItemAddon(product_id=1, code="extra_cheese", label="Extra Cheddar Cheese", price_adjustment=Decimal("35.00"), display_order=1))
            session.add(MenuItemAddon(product_id=1, code="extra_bacon", label="Crispy Bacon Strips", price_adjustment=Decimal("50.00"), display_order=2))
        session.commit()
        print("[+] Product sizes and addons seeded.")

        # G. Inventory Items & Recipes
        inventory_data = [
            ("Beef Patty (150g)", "ING-BEEF-01", "pcs", Decimal("100.00"), Decimal("20.00"), Decimal("45.00")),
            ("Brioche Burger Bun", "ING-BUN-01", "pcs", Decimal("100.00"), Decimal("20.00"), Decimal("15.00")),
            ("Cheddar Cheese Slice", "ING-CHEESE-01", "pcs", Decimal("150.00"), Decimal("30.00"), Decimal("10.00")),
            ("Bacon Strips", "ING-BACON-01", "slices", Decimal("200.00"), Decimal("40.00"), Decimal("12.00")),
            ("Chicken Thigh / Drumstick", "ING-CHK-01", "pcs", Decimal("120.00"), Decimal("25.00"), Decimal("35.00")),
            ("Fettuccine Pasta", "ING-PASTA-01", "grams", Decimal("5000.00"), Decimal("1000.00"), Decimal("0.25")),
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

        # H. Link recipes
        existing_recipes = session.scalar(select(MenuItemIngredient).where(MenuItemIngredient.menu_item_id == 1))
        if not existing_recipes and "ING-BEEF-01" in created_inv and "ING-BUN-01" in created_inv and "ING-CHEESE-01" in created_inv:
            session.add(MenuItemIngredient(menu_item_id=1, inventory_item_id=created_inv["ING-BEEF-01"], quantity_required=Decimal("1.00")))
            session.add(MenuItemIngredient(menu_item_id=1, inventory_item_id=created_inv["ING-BUN-01"], quantity_required=Decimal("1.00")))
            session.add(MenuItemIngredient(menu_item_id=1, inventory_item_id=created_inv["ING-CHEESE-01"], quantity_required=Decimal("1.00")))
            session.commit()
            print("[+] Recipes linked.")

        # I. Staging Staff Accounts
        now = datetime.now(timezone.utc)
        staging_staff = [
            ("manager@savorybites.staging", "Staging Operations Manager", 4, "StagingManagerPass2026!"),
            ("kitchen@savorybites.staging", "Staging Line Cook", 3, "StagingKitchenPass2026!"),
        ]
        for email, name, role_id, pwd in staging_staff:
            user = session.scalar(select(StaffUser).where(StaffUser.email == email))
            pwd_hash = hash_password(pwd)
            if not user:
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
            else:
                user.password_hash = pwd_hash
                user.status = "active"
                user.updated_at = now
        session.commit()
        print("[+] Staging staff accounts provisioned.")

        # J. Synchronize PostgreSQL Sequences for auto-increment IDs
        session.execute(text("""
            SELECT setval(pg_get_serial_sequence('menu_categories', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_categories), 1), true);
            SELECT setval(pg_get_serial_sequence('menu_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_items), 1), true);
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
    target_url = os.environ.get("DATABASE_URL")
    if not target_url:
        target_url = settings.DATABASE_URL.rsplit("/", 1)[0] + "/restaurant_db_staging"
    init_database(target_url)
