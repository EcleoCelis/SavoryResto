"""Preserve customer cancellation audit information on orders."""

from alembic import op


revision = "20260921_08"
down_revision = "20260920_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by_customer_id BIGINT")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_cancelled_by_customer_id_fkey') THEN
                ALTER TABLE orders
                    ADD CONSTRAINT orders_cancelled_by_customer_id_fkey
                    FOREIGN KEY (cancelled_by_customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT;
            END IF;
        END $$;
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_cancelled_by_customer_id ON orders (cancelled_by_customer_id) WHERE cancelled_by_customer_id IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_cancelled_at ON orders (cancelled_at DESC) WHERE cancelled_at IS NOT NULL")


def downgrade() -> None:
    raise RuntimeError("Order cancellation audit records require an explicit data-retention plan to remove.")
