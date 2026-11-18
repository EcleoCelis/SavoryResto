"""Add PostgreSQL analytics indexes for order window and completion range scans.

Revision ID: 20261119_16
Revises: 20261115_15
Create Date: 2026-11-19
"""

from alembic import op


revision = "20261119_16"
down_revision = "20261115_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orders_ordered_at ON orders (ordered_at DESC);"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orders_completed_effective_ts
        ON orders (COALESCE(completed_at, ordered_at) DESC)
        WHERE status = 'completed';
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orders_completed_effective_ts;")
    op.execute("DROP INDEX IF EXISTS ix_orders_ordered_at;")
