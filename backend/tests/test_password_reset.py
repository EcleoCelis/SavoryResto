import hashlib
from datetime import datetime, timedelta, timezone
from unittest import TestCase

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.database import Base
from app.db.models.customer import Customer
from app.db.models.password_reset_token import PasswordResetToken
from app.services.email_service import email_service
from app.services.password_reset_service import (
    GENERIC_FORGOT_PASSWORD_MESSAGE,
    hash_reset_token,
    request_password_reset,
    reset_password_with_token,
)


class PasswordResetServiceUnitTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.db = sessionmaker(bind=self.engine)()
        Base.metadata.create_all(self.engine)
        email_service.clear_outbox()

        now = datetime.now(timezone.utc)
        self.initial_password = "InitialPassword123!"

        self.customer = Customer(
            customer_id=1,
            full_name="Maria Santos",
            email="maria@example.com",
            phone="09171112233",
            password_hash=hash_password(self.initial_password),
            created_at=now,
        )
        self.db.add(self.customer)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        email_service.clear_outbox()

    def test_request_password_reset_creates_hashed_token_and_dispatches_email(self):
        message = request_password_reset(
            db=self.db,
            email="maria@example.com",
            request_ip="192.168.1.10",
            user_agent="TestAgent/1.0",
        )
        self.assertEqual(message, GENERIC_FORGOT_PASSWORD_MESSAGE)

        # Email in outbox
        self.assertEqual(len(email_service.outbox), 1)
        outbox_msg = email_service.outbox[0]
        self.assertEqual(outbox_msg.to_email, "maria@example.com")
        self.assertIn("token=", outbox_msg.reset_url)
        raw_token = outbox_msg.reset_url.split("token=")[-1]

        # Token persisted in DB as SHA-256 hash
        token_record = self.db.scalar(
            select(PasswordResetToken).where(PasswordResetToken.customer_id == 1)
        )
        self.assertIsNotNone(token_record)
        expected_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        self.assertEqual(token_record.token_hash, expected_hash)
        self.assertNotEqual(token_record.token_hash, raw_token)
        self.assertIsNone(token_record.used_at)
        self.assertEqual(token_record.request_ip, "192.168.1.10")

    def test_account_enumeration_protection_for_nonexistent_email(self):
        message = request_password_reset(
            db=self.db,
            email="nonexistent@example.com",
            request_ip="192.168.1.20",
        )
        # Returns identical message
        self.assertEqual(message, GENERIC_FORGOT_PASSWORD_MESSAGE)
        # No email dispatched
        self.assertEqual(len(email_service.outbox), 0)
        # No token in DB
        tokens = self.db.scalars(select(PasswordResetToken)).all()
        self.assertEqual(len(tokens), 0)

    def test_new_request_invalidates_prior_active_tokens(self):
        # First request
        request_password_reset(db=self.db, email="maria@example.com")
        self.assertEqual(len(email_service.outbox), 1)
        first_token_url = email_service.outbox[0].reset_url
        first_raw_token = first_token_url.split("token=")[-1]

        # Second request
        request_password_reset(db=self.db, email="maria@example.com")
        self.assertEqual(len(email_service.outbox), 2)
        second_token_url = email_service.outbox[1].reset_url
        second_raw_token = second_token_url.split("token=")[-1]

        # First token record should now be marked used/invalidated
        first_record = self.db.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == hash_reset_token(first_raw_token)
            )
        )
        self.assertIsNotNone(first_record.used_at)

        # Attempting reset with the older token fails
        with self.assertRaises(HTTPException) as ctx:
            reset_password_with_token(
                db=self.db,
                raw_token=first_raw_token,
                new_password="NewPassword123!",
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already been used", ctx.exception.detail)

        # Second token succeeds
        updated_customer = reset_password_with_token(
            db=self.db,
            raw_token=second_raw_token,
            new_password="NewPassword123!",
        )
        self.assertTrue(verify_password("NewPassword123!", updated_customer.password_hash))

    def test_reset_password_updates_hash_and_invalidates_session(self):
        request_password_reset(db=self.db, email="maria@example.com")
        raw_token = email_service.outbox[0].reset_url.split("token=")[-1]

        reset_password_with_token(
            db=self.db,
            raw_token=raw_token,
            new_password="UpdatedPassword123!",
        )

        customer = self.db.scalar(select(Customer).where(Customer.customer_id == 1))
        # Password changed
        self.assertTrue(verify_password("UpdatedPassword123!", customer.password_hash))
        self.assertFalse(verify_password(self.initial_password, customer.password_hash))
        # password_changed_at timestamp set
        self.assertIsNotNone(customer.password_changed_at)

    def test_expired_token_rejected(self):
        now = datetime.now(timezone.utc)
        raw_token = "some_expired_token_abc"
        expired_token = PasswordResetToken(
            customer_id=1,
            token_hash=hash_reset_token(raw_token),
            expires_at=now - timedelta(minutes=10),
            created_at=now - timedelta(minutes=40),
        )
        self.db.add(expired_token)
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            reset_password_with_token(
                db=self.db,
                raw_token=raw_token,
                new_password="ValidNewPassword123!",
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("expired", ctx.exception.detail)

    def test_invalid_token_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            reset_password_with_token(
                db=self.db,
                raw_token="completely_random_invalid_token",
                new_password="ValidNewPassword123!",
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("invalid or has expired", ctx.exception.detail)

    def test_ip_rate_limiting_exceeded(self):
        now = datetime.now(timezone.utc)
        test_ip = "203.0.113.42"

        # Pre-seed MAX requests for this IP
        for i in range(settings.PASSWORD_RESET_MAX_PER_IP):
            self.db.add(
                PasswordResetToken(
                    customer_id=1,
                    token_hash=f"token_hash_ip_{i}",
                    expires_at=now + timedelta(minutes=30),
                    created_at=now,
                    request_ip=test_ip,
                )
            )
        self.db.commit()

        # Next request from same IP should raise 429
        with self.assertRaises(HTTPException) as ctx:
            request_password_reset(
                db=self.db,
                email="maria@example.com",
                request_ip=test_ip,
            )
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("Too many password reset requests", ctx.exception.detail)
