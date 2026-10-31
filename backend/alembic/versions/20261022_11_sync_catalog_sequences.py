"""Synchronize catalog identifier sequences for menu categories and menu items."""

from alembic import op


revision = "20261022_11"
down_revision = "20260921_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        SELECT setval(
            pg_get_serial_sequence('menu_categories', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_categories), 1),
            true
        );
        SELECT setval(
            pg_get_serial_sequence('menu_items', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM menu_items), 1),
            true
        );
    """)


def downgrade() -> None:
    raise RuntimeError("Catalog identifier sequences must remain synchronized with existing items.")
