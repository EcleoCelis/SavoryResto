"""Add PostgreSQL partial and composite indexes for menu categories and items.

Revision ID: 20261119_17
Revises: 20261119_16
Create Date: 2026-11-19
"""

from alembic import op


revision = "20261119_17"
down_revision = "20261119_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_menu_items_active_cat_name
        ON menu_items (category_id, is_available, name)
        WHERE deleted_at IS NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_menu_categories_active_order
        ON menu_categories (is_active, display_order, name);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_menu_categories_active_order;")
    op.execute("DROP INDEX IF EXISTS ix_menu_items_active_cat_name;")
