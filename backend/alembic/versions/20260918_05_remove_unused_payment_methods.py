"""Restrict restaurant payment methods to cash, GCash, and card."""

from alembic import op


revision = "20260918_05"
down_revision = "20260918_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep historical selections if one of these methods was already used.
    op.execute("""
        UPDATE payment_methods
        SET is_active = FALSE
        WHERE code IN ('maya', 'bank_transfer')
    """)
    op.execute("""
        DELETE FROM payment_methods AS method
        WHERE method.code IN ('maya', 'bank_transfer')
          AND NOT EXISTS (
              SELECT 1 FROM orders WHERE orders.payment_method_id = method.id
          )
    """)


def downgrade() -> None:
    raise RuntimeError(
        "Restoring removed payment methods requires an explicit restaurant configuration decision."
    )
