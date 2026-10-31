"""Synchronize the legacy users identifier sequence before staff provisioning."""

from alembic import op


revision = "20260920_07"
down_revision = "20260920_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        SELECT setval(
            pg_get_serial_sequence('users', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1),
            true
        )
    """)


def downgrade() -> None:
    raise RuntimeError("The users identifier sequence must remain synchronized with preserved staff records.")
