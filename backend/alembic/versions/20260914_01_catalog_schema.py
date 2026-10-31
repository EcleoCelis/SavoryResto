"""Create the reproducible restaurant catalog schema and product media field."""

from alembic import op


revision = "20260914_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS menu_categories (
            id BIGINT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            display_order INTEGER NOT NULL,
            is_active BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS menu_items (
            id BIGINT PRIMARY KEY,
            category_id BIGINT NOT NULL REFERENCES menu_categories(id),
            name VARCHAR(150) NOT NULL,
            description TEXT,
            image_url VARCHAR(500),
            price NUMERIC(12, 2) NOT NULL,
            is_available BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMPTZ
        )
    """)
    op.execute("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)")


def downgrade() -> None:
    op.execute("ALTER TABLE menu_items DROP COLUMN IF EXISTS image_url")
