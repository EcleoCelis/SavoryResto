import asyncio
import json
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fastapi import HTTPException, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.api.routes.auth import (
    _check_login_rate_limit,
    _clear_failed_logins,
    _failed_login_attempts,
    _record_failed_login,
)
from app.api.routes.staff_auth import (
    _check_staff_login_rate_limit,
    _clear_failed_staff_logins,
    _failed_staff_login_attempts,
    _record_failed_staff_login,
)
from app.core.config import Settings, settings
from app.core.security import get_client_ip, get_current_customer
from app.db.models.customer import Customer
from app.main import app, unhandled_exception_handler


class SettingsSecurityUnitTests(TestCase):
    def test_production_rejects_short_jwt_secret(self):
        with self.assertRaises(ValidationError) as ctx:
            Settings(
                DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/db",
                ENVIRONMENT="production",
                JWT_SECRET_KEY="short-secret",
            )
        self.assertIn("at least 32 characters", str(ctx.exception))

    def test_production_rejects_default_template_jwt_secret(self):
        with self.assertRaises(ValidationError) as ctx:
            Settings(
                DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/db",
                ENVIRONMENT="production",
                JWT_SECRET_KEY="ndkHD0154eXrBigjbbXDDiCncEcowPl-extra-padding-32chars",
            )
        self.assertIn("must be changed from the development template key", str(ctx.exception))

    def test_production_cookie_secure_defaults_to_true(self):
        prod_settings = Settings(
            DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/db",
            ENVIRONMENT="production",
            JWT_SECRET_KEY="production-super-strong-secret-key-at-least-32-chars",
        )
        self.assertTrue(prod_settings.cookie_secure)

    def test_development_cookie_secure_defaults_to_false(self):
        dev_settings = Settings(
            DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/db",
            ENVIRONMENT="development",
            JWT_SECRET_KEY="development-test-secret-key-32-chars-long",
        )
        self.assertFalse(dev_settings.cookie_secure)

    def test_cors_origins_includes_frontend_and_allowed_origins(self):
        settings_inst = Settings(
            DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/db",
            ENVIRONMENT="production",
            FRONTEND_URL="https://savorybites.com",
            ALLOWED_CORS_ORIGINS="https://admin.savorybites.com, https://pos.savorybites.com/",
            JWT_SECRET_KEY="production-super-strong-secret-key-at-least-32-chars",
        )
        origins = settings_inst.cors_origins
        self.assertIn("https://savorybites.com", origins)
        self.assertIn("https://admin.savorybites.com", origins)
        self.assertIn("https://pos.savorybites.com", origins)


class ClientIpResolutionUnitTests(TestCase):
    def test_direct_client_when_not_proxied(self):
        req = MagicMock()
        req.client.host = "203.0.113.195"
        req.headers = {}
        ip = get_client_ip(req)
        self.assertEqual(ip, "203.0.113.195")

    def test_spoofed_forwarded_for_from_untrusted_client_ignored(self):
        req = MagicMock()
        req.client.host = "203.0.113.195"  # Direct caller is not in TRUSTED_PROXIES
        req.headers = {"x-forwarded-for": "10.0.0.1, 1.1.1.1"}
        ip = get_client_ip(req)
        self.assertEqual(ip, "203.0.113.195")

    def test_trusted_proxy_resolves_real_client_ip(self):
        req = MagicMock()
        req.client.host = "127.0.0.1"  # In default TRUSTED_PROXIES
        req.headers = {"x-forwarded-for": "198.51.100.42"}
        ip = get_client_ip(req)
        self.assertEqual(ip, "198.51.100.42")

    def test_trusted_proxy_chain_resolves_last_untrusted_client(self):
        req = MagicMock()
        req.client.host = "127.0.0.1"
        # 198.51.100.42 -> trusted proxy 127.0.0.1 -> uvicorn 127.0.0.1
        req.headers = {"x-forwarded-for": "198.51.100.42, 127.0.0.1"}
        ip = get_client_ip(req)
        self.assertEqual(ip, "198.51.100.42")

    def test_cidr_trusted_proxy_subnet(self):
        with patch.object(settings, "TRUSTED_PROXIES", "10.0.0.0/8,127.0.0.1"):
            req = MagicMock()
            req.client.host = "10.15.2.100"  # Belongs to 10.0.0.0/8 CIDR
            req.headers = {"x-forwarded-for": "203.0.113.88, 10.15.2.100"}
            ip = get_client_ip(req)
            self.assertEqual(ip, "203.0.113.88")

    def test_ipv6_trusted_proxy_and_client(self):
        with patch.object(settings, "TRUSTED_PROXIES", "::1,fd00::/8"):
            req = MagicMock()
            req.client.host = "::1"
            req.headers = {"x-forwarded-for": "2001:db8::cafe:1"}
            ip = get_client_ip(req)
            self.assertEqual(ip, "2001:db8::cafe:1")

    def test_port_stripping_and_bracket_removal(self):
        req = MagicMock()
        req.client.host = "127.0.0.1"
        req.headers = {"x-forwarded-for": "198.51.100.77:54321"}
        ip = get_client_ip(req)
        self.assertEqual(ip, "198.51.100.77")

    def test_malformed_forwarded_headers_handled_safely(self):
        req = MagicMock()
        req.client.host = "127.0.0.1"
        req.headers = {"x-forwarded-for": "not-an-ip; <script>, 198.51.100.99"}
        ip = get_client_ip(req)
        self.assertEqual(ip, "198.51.100.99")

    def test_handles_missing_client_gracefully(self):
        req = MagicMock()
        req.client = None
        req.headers = {}
        ip = get_client_ip(req)
        self.assertEqual(ip, "127.0.0.1")


class SessionAndRateLimitUnitTests(TestCase):
    def setUp(self):
        _failed_login_attempts.clear()
        _failed_staff_login_attempts.clear()

    def tearDown(self):
        _failed_login_attempts.clear()
        _failed_staff_login_attempts.clear()

    def test_customer_login_brute_force_rate_limiting(self):
        test_ip = "198.51.100.12"
        for _ in range(10):
            _check_login_rate_limit(test_ip)
            _record_failed_login(test_ip)

        # 11th attempt must trigger 429
        with self.assertRaises(HTTPException) as ctx:
            _check_login_rate_limit(test_ip)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("Too many failed sign-in attempts", ctx.exception.detail)

        # Successful login clears rate limit
        _clear_failed_logins(test_ip)
        # Should not raise now
        _check_login_rate_limit(test_ip)

    def test_staff_login_brute_force_rate_limiting(self):
        test_ip = "198.51.100.15"
        for _ in range(10):
            _check_staff_login_rate_limit(test_ip)
            _record_failed_staff_login(test_ip)

        # 11th attempt must trigger 429
        with self.assertRaises(HTTPException) as ctx:
            _check_staff_login_rate_limit(test_ip)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("Too many failed staff sign-in attempts", ctx.exception.detail)

        _clear_failed_staff_logins(test_ip)
        _check_staff_login_rate_limit(test_ip)

    def test_jwt_missing_iat_rejected_if_password_changed(self):
        mock_db = MagicMock()
        mock_customer = Customer(
            customer_id=1,
            full_name="Test User",
            email="test@example.com",
            password_changed_at=datetime.now(timezone.utc),
        )
        mock_db.query.return_value.filter.return_value.first.return_value = mock_customer

        # Decode returns payload without 'iat'
        with patch("app.core.security.decode_access_token", return_value={"sub": "1", "type": "access"}):
            with self.assertRaises(HTTPException) as ctx:
                get_current_customer(bearer_token="dummy.token", access_token=None, db=mock_db)
            self.assertEqual(ctx.exception.status_code, 401)


class ProductionReadinessServerIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

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
        raise RuntimeError("Production readiness test server did not start in time.")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait()

    @classmethod
    def _request(
        cls,
        path: str,
        method: str = "GET",
        headers: dict | None = None,
    ) -> tuple[int, dict | None, dict]:
        request_headers = {}
        if headers:
            request_headers.update(headers)

        request = Request(
            f"http://127.0.0.1:{cls.port}{path}",
            headers=request_headers,
            method=method,
        )

        try:
            with urlopen(request) as response:
                body = response.read().decode("utf-8")
                response_headers = {k.lower(): v for k, v in response.headers.items()}
                return response.status, json.loads(body) if body else None, response_headers
        except HTTPError as error:
            body = error.read().decode("utf-8")
            response_headers = {k.lower(): v for k, v in error.headers.items()}
            return error.code, json.loads(body) if body else None, response_headers

    def test_liveness_probe_returns_ok(self):
        status, body, _ = self._request("/health")
        self.assertEqual(status, 200)
        self.assertIsInstance(body, dict)
        self.assertEqual(body.get("status"), "ok")
        self.assertIn("environment", body)

    def test_readiness_probe_returns_ready_and_database_connected(self):
        status, body, _ = self._request("/health/ready")
        self.assertEqual(status, 200)
        self.assertIsInstance(body, dict)
        self.assertEqual(body.get("status"), "ready")
        self.assertEqual(body.get("database"), "connected")

    def test_security_headers_present_on_http_responses(self):
        status, _, headers = self._request("/health")
        self.assertEqual(status, 200)

        # nosniff
        self.assertEqual(headers.get("x-content-type-options"), "nosniff")

        # clickjacking protection
        self.assertEqual(headers.get("x-frame-options"), "DENY")

        # referrer policy
        self.assertEqual(headers.get("referrer-policy"), "strict-origin-when-cross-origin")

        # permissions policy
        self.assertIn("geolocation=()", headers.get("permissions-policy", ""))

    def test_api_routes_emit_strict_api_csp(self):
        status, _, headers = self._request("/api/v1/categories")
        self.assertEqual(status, 200)
        csp = headers.get("content-security-policy", "")
        self.assertIn("default-src 'none'", csp)
        self.assertIn("frame-ancestors 'none'", csp)

    def test_sensitive_routes_emit_cache_prevention_headers(self):
        status, _, headers = self._request("/api/v1/auth/me")
        # Route returns 401 Unauthorized since no credentials provided, but headers must still be set
        self.assertEqual(status, 401)
        self.assertIn("no-store", headers.get("cache-control", ""))
        self.assertIn("no-cache", headers.get("cache-control", ""))
        self.assertEqual(headers.get("pragma"), "no-cache")

    def test_checkout_route_emits_cache_prevention_headers(self):
        status, _, headers = self._request("/api/v1/checkout/quote", method="POST")
        self.assertEqual(status, 401)
        self.assertIn("no-store", headers.get("cache-control", ""))
        self.assertIn("no-cache", headers.get("cache-control", ""))
        self.assertEqual(headers.get("pragma"), "no-cache")

    def test_global_exception_handler_sanitizes_unhandled_error(self):
        mock_req = MagicMock()
        mock_req.method = "GET"
        mock_req.url.path = "/api/v1/test-crash"
        sensitive_exception = RuntimeError("CRITICAL: database connection string postgresql://admin:secretPass@internal leaked!")

        response = asyncio.run(unhandled_exception_handler(mock_req, sensitive_exception))
        self.assertEqual(response.status_code, 500)
        response_body = json.loads(response.body.decode("utf-8"))

        # Verify no traceback or internal error detail is leaked
        self.assertNotIn("secretPass", response_body["detail"])
        self.assertNotIn("RuntimeError", response_body["detail"])
        self.assertEqual(
            response_body["detail"],
            "An internal error occurred while processing your request. Please try again later.",
        )

    def test_global_exception_handler_preserves_http_exceptions(self):
        mock_req = MagicMock()
        mock_req.method = "GET"
        mock_req.url.path = "/api/v1/not-found"
        http_exc = HTTPException(status_code=404, detail="Requested item was not found.")

        response = asyncio.run(unhandled_exception_handler(mock_req, http_exc))
        self.assertEqual(response.status_code, 404)
        response_body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(response_body["detail"], "Requested item was not found.")

    def test_global_exception_handler_preserves_validation_errors(self):
        mock_req = MagicMock()
        mock_req.method = "POST"
        mock_req.url.path = "/api/v1/items"
        val_exc = RequestValidationError(errors=[{"loc": ["body", "name"], "msg": "Field required", "type": "missing"}])

        response = asyncio.run(unhandled_exception_handler(mock_req, val_exc))
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_CONTENT)
        response_body = json.loads(response.body.decode("utf-8"))
        self.assertIn("detail", response_body)
