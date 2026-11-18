"""Add singleton restaurant_settings and weekly restaurant_business_hours tables.

Revision ID: 20261119_18
Revises: 20261119_17
Create Date: 2026-11-19
"""

from alembic import op


revision = "20261119_18"
down_revision = "20261119_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS restaurant_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name VARCHAR(120) NOT NULL,
            tagline VARCHAR(200) NOT NULL,
            locality VARCHAR(150) NOT NULL,
            full_address VARCHAR(300) NOT NULL,
            phone VARCHAR(40) NOT NULL,
            email VARCHAR(255) NOT NULL,
            timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
            kitchen_cutoff_minutes INTEGER NOT NULL DEFAULT 30 CHECK (kitchen_cutoff_minutes >= 0 AND kitchen_cutoff_minutes <= 180),
            kitchen_notice TEXT NOT NULL,
            holiday_notice TEXT NOT NULL,
            online_ordering_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            online_ordering_pause_reason TEXT NULL,
            dine_in_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            takeout_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            enforce_operating_hours BOOLEAN NOT NULL DEFAULT FALSE,
            minimum_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (minimum_order_amount >= 0),
            send_order_confirmation_emails BOOLEAN NOT NULL DEFAULT TRUE,
            send_contact_inquiry_emails BOOLEAN NOT NULL DEFAULT TRUE,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT ck_restaurant_settings_channel_when_open CHECK (
                dine_in_enabled OR takeout_enabled OR NOT online_ordering_enabled
            )
        );
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS restaurant_business_hours (
            id BIGSERIAL PRIMARY KEY,
            day_of_week INTEGER NOT NULL UNIQUE CHECK (day_of_week >= 0 AND day_of_week <= 6),
            is_open BOOLEAN NOT NULL DEFAULT TRUE,
            open_time TIME NOT NULL,
            close_time TIME NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )

    op.execute(
        """
        INSERT INTO restaurant_settings (
            id, name, tagline, locality, full_address, phone, email, timezone,
            kitchen_cutoff_minutes, kitchen_notice, holiday_notice,
            online_ordering_enabled, online_ordering_pause_reason,
            dine_in_enabled, takeout_enabled, enforce_operating_hours,
            minimum_order_amount, send_order_confirmation_emails, send_contact_inquiry_emails,
            version, updated_at
        )
        VALUES (
            1,
            'SavoryBites',
            'Freshly made. Simply delicious.',
            'Buenavista, Bohol',
            'Poblacion, Buenavista, Bohol, 6333 Philippines',
            '+63 917 123 4567',
            'hello@savorybites.ph',
            'Asia/Manila',
            30,
            'Last food and beverage orders are accepted 30 minutes before closing time.',
            'Hours may vary on official national and municipal holidays. Please call ahead to confirm special holiday schedules.',
            TRUE,
            NULL,
            TRUE,
            TRUE,
            FALSE,
            0.00,
            TRUE,
            TRUE,
            1,
            NOW()
        )
        ON CONFLICT (id) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO restaurant_business_hours (day_of_week, is_open, open_time, close_time, updated_at)
        VALUES
            (0, TRUE, '10:00:00', '21:00:00', NOW()),
            (1, TRUE, '10:00:00', '21:00:00', NOW()),
            (2, TRUE, '10:00:00', '21:00:00', NOW()),
            (3, TRUE, '10:00:00', '21:00:00', NOW()),
            (4, TRUE, '10:00:00', '21:00:00', NOW()),
            (5, TRUE, '10:00:00', '22:00:00', NOW()),
            (6, TRUE, '10:00:00', '22:00:00', NOW())
        ON CONFLICT (day_of_week) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS restaurant_business_hours;")
    op.execute("DROP TABLE IF EXISTS restaurant_settings;")
