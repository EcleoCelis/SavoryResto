"""Complete starter ingredient recipes for the existing menu catalog."""

from alembic import op


revision = "20260921_10"
down_revision = "20260921_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # These are initial operational estimates. Managers can revise the recipe
    # quantities after kitchen validation without changing the application code.
    # The legacy seed loaded explicit IDs, so its identity sequence must be
    # advanced before the first application-managed inventory insert.
    op.execute("SELECT setval(pg_get_serial_sequence('inventory_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM inventory_items), 1), true)")
    op.execute("""
        INSERT INTO inventory_items (name, sku, unit, current_stock, reorder_level, unit_cost, is_active)
        VALUES
            ('Potatoes', 'INV-POTATO-001', 'kg', 30, 8, 55, TRUE),
            ('Flour', 'INV-FLOUR-001', 'kg', 15, 4, 58, TRUE),
            ('Cocoa Powder', 'INV-COCOA-001', 'kg', 5, 1, 350, TRUE),
            ('Sugar', 'INV-SUGAR-001', 'kg', 20, 5, 70, TRUE)
        ON CONFLICT (sku) DO NOTHING
    """)
    op.execute("""
        INSERT INTO menu_item_ingredients (menu_item_id, inventory_item_id, quantity_required)
        SELECT menu.id, ingredient.id, recipe.quantity_required
        FROM (
            VALUES
                ('Chicken Adobo Rice', 'Chicken Meat', 0.200::numeric),
                ('Chicken Adobo Rice', 'Rice', 0.180::numeric),
                ('Chicken Adobo Rice', 'Cooking Oil', 0.020::numeric),
                ('Garden Salad', 'Mixed Vegetables', 0.250::numeric),
                ('Garden Salad', 'Cooking Oil', 0.010::numeric),
                ('Chocolate Cake', 'Flour', 0.120::numeric),
                ('Chocolate Cake', 'Cocoa Powder', 0.030::numeric),
                ('Chocolate Cake', 'Sugar', 0.090::numeric),
                ('French Fries', 'Potatoes', 0.250::numeric),
                ('French Fries', 'Cooking Oil', 0.030::numeric)
        ) AS recipe(menu_name, ingredient_name, quantity_required)
        JOIN menu_items AS menu ON menu.name = recipe.menu_name
        JOIN inventory_items AS ingredient ON ingredient.name = recipe.ingredient_name
        ON CONFLICT (menu_item_id, inventory_item_id) DO UPDATE
        SET quantity_required = EXCLUDED.quantity_required
    """)


def downgrade() -> None:
    raise RuntimeError("Starter recipes may be referenced by inventory transactions; retain them unless an explicit data-retention plan is approved.")
