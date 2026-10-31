import hashlib
import json
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from jose import jwt
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token, create_staff_access_token, hash_password, verify_password
from app.db.database import SessionLocal
from app.db.models.customer import Customer
from app.db.models.password_reset_token import PasswordResetToken
from app.db.models.staff import Role, StaffUser


class AuthIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.test_email = f"auth-test-{suffix}@example.com"
        cls.test_phone = f"0917{uuid4().int % 10000000:07d}"
        cls.test_password = "SecurePassword123!"
        cls.test_name = "Auth Test Customer"

        # Pre-seed a known test customer
        with SessionLocal() as db:
            existing = Customer(
                full_name=cls.test_name,
                email=cls.test_email,
                phone=cls.test_phone,
                password_hash=hash_password(cls.test_password),
            )
            db.add(existing)
            db.commit()
            db.refresh(existing)
            cls.customer_id = existing.customer_id

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(30):
            try:
                status, _, _ = cls._request("/health")
                if status == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("Auth test server did not start in time.")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait()
        with SessionLocal() as db:
            # Clean up test customer
            customer = db.scalar(select(Customer).where(Customer.email == cls.test_email))
            if customer:
                db.delete(customer)
                db.commit()

    @classmethod
    def _request(
        cls,
        path: str,
        method: str = "GET",
        payload: dict | None = None,
        headers: dict | None = None,
        cookie: str | None = None,
    ) -> tuple[int, dict | None, dict]:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request_headers = {"Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)
        if cookie:
            request_headers["Cookie"] = cookie

        request = Request(
            f"http://127.0.0.1:{cls.port}{path}",
            data=data,
            headers=request_headers,
            method=method,
        )

        try:
            with urlopen(request) as response:
                body = response.read().decode("utf-8")
                response_headers = dict(response.headers.items())
                return response.status, json.loads(body) if body else None, response_headers
        except HTTPError as error:
            body = error.read().decode("utf-8")
            response_headers = dict(error.headers.items())
            return error.code, json.loads(body) if body else None, response_headers

    def test_01_registration_success(self):
        suffix = uuid4().hex[:8]
        reg_email = f"new-user-{suffix}@example.com"
        reg_phone = f"0918{uuid4().int % 10000000:07d}"
        payload = {
            "full_name": "Maria Clara",
            "email": reg_email,
            "phone": reg_phone,
            "password": "StrongPassword999!",
        }

        status, body, _ = self._request("/api/v1/auth/register", method="POST", payload=payload)
        self.assertEqual(status, 201)
        self.assertIn("customer_id", body)
        self.assertEqual(body["email"], reg_email.lower())

        # Verify password is encrypted in database with Argon2, not plain text
        with SessionLocal() as db:
            cust = db.scalar(select(Customer).where(Customer.email == reg_email.lower()))
            self.assertIsNotNone(cust)
            self.assertNotEqual(cust.password_hash, "StrongPassword999!")
            self.assertTrue(verify_password("StrongPassword999!", cust.password_hash))

    def test_02_registration_duplicate_email(self):
        payload = {
            "full_name": "Duplicate Person",
            "email": self.test_email.upper(),  # Case-insensitive duplicate check
            "phone": f"0920{uuid4().int % 10000000:07d}",
            "password": "Password123!",
        }
        status, body, _ = self._request("/api/v1/auth/register", method="POST", payload=payload)
        self.assertEqual(status, 409)
        self.assertIn("already exists", body["detail"].lower())

    def test_03_registration_duplicate_phone(self):
        payload = {
            "full_name": "Duplicate Phone Person",
            "email": f"unique-{uuid4().hex[:6]}@example.com",
            "phone": self.test_phone,
            "password": "Password123!",
        }
        status, body, _ = self._request("/api/v1/auth/register", method="POST", payload=payload)
        self.assertEqual(status, 409)
        self.assertIn("already exists", body["detail"].lower())

    def test_04_registration_validation_errors(self):
        # Invalid email
        status, _, _ = self._request("/api/v1/auth/register", method="POST", payload={
            "full_name": "Valid Name",
            "email": "invalid-email-format",
            "phone": "09171234567",
            "password": "ValidPassword123!",
        })
        self.assertEqual(status, 422)

        # Invalid phone (not PH mobile)
        status, _, _ = self._request("/api/v1/auth/register", method="POST", payload={
            "full_name": "Valid Name",
            "email": "test-valid@example.com",
            "phone": "123456",
            "password": "ValidPassword123!",
        })
        self.assertEqual(status, 422)

        # Short password (< 8 chars)
        status, _, _ = self._request("/api/v1/auth/register", method="POST", payload={
            "full_name": "Valid Name",
            "email": "test-valid2@example.com",
            "phone": "09179998888",
            "password": "short",
        })
        self.assertEqual(status, 422)

    def test_05_login_success(self):
        payload = {
            "email": self.test_email,
            "password": self.test_password,
            "remember_me": False,
        }
        status, body, headers = self._request("/api/v1/auth/login", method="POST", payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["customer_id"], self.customer_id)
        self.assertEqual(body["email"], self.test_email)
        self.assertEqual(body["token_type"], "bearer")
        self.assertIsNotNone(body.get("access_token"))

        # Verify cookie headers
        set_cookie = headers.get("set-cookie") or headers.get("Set-Cookie")
        self.assertIsNotNone(set_cookie)
        self.assertIn("access_token=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("Max-Age=3600", set_cookie)

    def test_06_login_case_insensitive_email(self):
        payload = {
            "email": self.test_email.upper(),
            "password": self.test_password,
        }
        status, body, _ = self._request("/api/v1/auth/login", method="POST", payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["customer_id"], self.customer_id)

    def test_07_login_remember_me_extended_expiration(self):
        payload = {
            "email": self.test_email,
            "password": self.test_password,
            "remember_me": True,
        }
        status, _, headers = self._request("/api/v1/auth/login", method="POST", payload=payload)
        self.assertEqual(status, 200)

        set_cookie = headers.get("set-cookie") or headers.get("Set-Cookie")
        expected_max_age = f"Max-Age={settings.REMEMBER_ME_EXPIRE_DAYS * 86400}"
        self.assertIn(expected_max_age, set_cookie)

    def test_08_login_invalid_credentials(self):
        # Wrong password
        status, body, _ = self._request("/api/v1/auth/login", method="POST", payload={
            "email": self.test_email,
            "password": "WrongPassword123!",
        })
        self.assertEqual(status, 401)
        self.assertIn("Unable to sign in", body["detail"])

        # Unknown email
        status, body, _ = self._request("/api/v1/auth/login", method="POST", payload={
            "email": "nonexistent-user@example.com",
            "password": self.test_password,
        })
        self.assertEqual(status, 401)

    def test_09_get_me_with_cookie(self):
        token = create_access_token(self.customer_id, timedelta(minutes=15))
        cookie = f"access_token={token}"

        status, body, _ = self._request("/api/v1/auth/me", method="GET", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(body["customer_id"], self.customer_id)
        self.assertEqual(body["email"], self.test_email)
        self.assertEqual(body["full_name"], self.test_name)

    def test_10_get_me_with_bearer_header(self):
        token = create_access_token(self.customer_id, timedelta(minutes=15))
        headers = {"Authorization": f"Bearer {token}"}

        status, body, _ = self._request("/api/v1/auth/me", method="GET", headers=headers)
        self.assertEqual(status, 200)
        self.assertEqual(body["customer_id"], self.customer_id)
        self.assertEqual(body["email"], self.test_email)

    def test_11_get_me_unauthorized_handling(self):
        # Missing token
        status, body, headers = self._request("/api/v1/auth/me", method="GET")
        self.assertEqual(status, 401)
        self.assertTrue(any(k.lower() == "www-authenticate" for k in headers))

        # Expired token
        expired_token = create_access_token(self.customer_id, timedelta(minutes=-10))
        status, _, _ = self._request("/api/v1/auth/me", method="GET", cookie=f"access_token={expired_token}")
        self.assertEqual(status, 401)

        # Invalid token signature
        tampered_token = expired_token[:-5] + "abcde"
        status, _, _ = self._request("/api/v1/auth/me", method="GET", cookie=f"access_token={tampered_token}")
        self.assertEqual(status, 401)

        # Staff token rejected on customer auth/me
        staff_token = create_staff_access_token(1, timedelta(minutes=15))
        status, _, _ = self._request("/api/v1/auth/me", method="GET", headers={"Authorization": f"Bearer {staff_token}"})
        self.assertEqual(status, 401)

    def test_12_logout_clears_cookie(self):
        token = create_access_token(self.customer_id, timedelta(minutes=15))
        status, body, headers = self._request(
            "/api/v1/auth/logout",
            method="POST",
            cookie=f"access_token={token}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["message"], "Signed out successfully.")

        set_cookie = headers.get("set-cookie") or headers.get("Set-Cookie")
        self.assertIsNotNone(set_cookie)
        # Cookie deletion sets max-age=0 or expires in past
        self.assertTrue("Max-Age=0" in set_cookie or "expires=" in set_cookie.lower())

    def test_13_logout_safe_when_unauthenticated(self):
        # Calling logout without cookie or with expired cookie still succeeds and clears cookie
        status, body, headers = self._request("/api/v1/auth/logout", method="POST")
        self.assertEqual(status, 200)
        set_cookie = headers.get("set-cookie") or headers.get("Set-Cookie")
        self.assertIsNotNone(set_cookie)

    def test_14_forgot_password_enumeration_protection(self):
        # 1. Registered email
        status_reg, body_reg, _ = self._request(
            "/api/v1/auth/password/forgot",
            method="POST",
            payload={"email": self.test_email},
        )
        self.assertEqual(status_reg, 200)
        self.assertIn("If an account exists with that email address", body_reg["message"])

        # 2. Unregistered email must receive exact same response
        status_unreg, body_unreg, _ = self._request(
            "/api/v1/auth/password/forgot",
            method="POST",
            payload={"email": "nobody_exists_here_999@example.com"},
        )
        self.assertEqual(status_unreg, 200)
        self.assertEqual(body_reg["message"], body_unreg["message"])

    def test_15_reset_password_e2e_and_session_invalidation(self):
        # Issue a session token before reset
        old_access_token = create_access_token(self.customer_id, timedelta(minutes=30))
        # Ensure session is valid prior to reset
        status_before, body_before, _ = self._request(
            "/api/v1/auth/me",
            method="GET",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        self.assertEqual(status_before, 200)

        # Wait 1.1s so token iat < password_changed_at
        time.sleep(1.1)

        # Insert a valid reset token record for self.customer_id
        raw_token = f"integration_token_{uuid4().hex}"
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            db.add(
                PasswordResetToken(
                    customer_id=self.customer_id,
                    token_hash=token_hash,
                    expires_at=now + timedelta(minutes=30),
                    created_at=now,
                )
            )
            db.commit()

        # Reset password
        new_password = "BrandNewSuperSecurePass456!"
        status_reset, body_reset, _ = self._request(
            "/api/v1/auth/password/reset",
            method="POST",
            payload={
                "token": raw_token,
                "new_password": new_password,
                "confirm_password": new_password,
            },
        )
        self.assertEqual(status_reset, 200)
        self.assertIn("successfully reset", body_reset["message"])

        # Old credentials fail login
        status_old_login, _, _ = self._request(
            "/api/v1/auth/login",
            method="POST",
            payload={"email": self.test_email, "password": self.test_password},
        )
        self.assertEqual(status_old_login, 401)

        # New credentials succeed login
        status_new_login, body_new_login, _ = self._request(
            "/api/v1/auth/login",
            method="POST",
            payload={"email": self.test_email, "password": new_password},
        )
        self.assertEqual(status_new_login, 200)
        self.assertIsNotNone(body_new_login.get("access_token"))

        # Pre-reset session token MUST now be rejected (401 Unauthorized)
        status_after, _, _ = self._request(
            "/api/v1/auth/me",
            method="GET",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        self.assertEqual(status_after, 401)

        # Update self.test_password so tearDown or later tests stay consistent if needed
        self.test_password = new_password

    def test_16_reset_password_validation_and_single_use(self):
        # 1. Password mismatch
        status_mismatch, body_mismatch, _ = self._request(
            "/api/v1/auth/password/reset",
            method="POST",
            payload={
                "token": "dummy_token_abc",
                "new_password": "ValidPassword123!",
                "confirm_password": "DifferentPassword123!",
            },
        )
        self.assertEqual(status_mismatch, 422)

        # 2. Password too short (<8 chars)
        status_short, _, _ = self._request(
            "/api/v1/auth/password/reset",
            method="POST",
            payload={
                "token": "dummy_token_abc",
                "new_password": "short",
                "confirm_password": "short",
            },
        )
        self.assertEqual(status_short, 422)

        # 3. Invalid token
        status_inv, body_inv, _ = self._request(
            "/api/v1/auth/password/reset",
            method="POST",
            payload={
                "token": "totally_invalid_nonexistent_token_999",
                "new_password": "ValidPassword123!",
                "confirm_password": "ValidPassword123!",
            },
        )
        self.assertEqual(status_inv, 400)
        self.assertIn("invalid or has expired", body_inv["detail"])

    def test_17_contact_endpoint_success_and_validation(self):
        # 1. Valid inquiry
        status_ok, body_ok, _ = self._request(
            "/api/v1/contact",
            method="POST",
            payload={
                "name": "Maria Santos",
                "email": "maria@example.com",
                "subject": "Large Group Dining Inquiry",
                "message": "Hello, we are planning a family dinner for 12 guests this Sunday. Can tables be joined?",
            },
        )
        self.assertEqual(status_ok, 200)
        self.assertIn("message has been received", body_ok["message"])

        # 2. Validation error: Message too short (<10 chars)
        status_short, _, _ = self._request(
            "/api/v1/contact",
            method="POST",
            payload={
                "name": "Maria Santos",
                "email": "maria@example.com",
                "subject": "Question",
                "message": "Too short",
            },
        )
        self.assertEqual(status_short, 422)

        # 3. Validation error: Invalid email format
        status_bad_email, _, _ = self._request(
            "/api/v1/contact",
            method="POST",
            payload={
                "name": "Maria Santos",
                "email": "not-a-valid-email",
                "subject": "Question About Menu",
                "message": "Do you have vegetarian options available on the menu?",
            },
        )
        self.assertEqual(status_bad_email, 422)


