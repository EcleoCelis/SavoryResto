"""Protect per-order ingredient deductions from duplicate processing."""

from alembic import op


revision = "20260921_09"
down_revision = "20260921_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transactions_order_sale
        ON inventory_transactions (inventory_item_id, transaction_type, reference_type, reference_id)
        WHERE transaction_type = 'sale' AND reference_type = 'order_confirmation' AND reference_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_inventory_transactions_order_sale")
