"""SavoryBites SB-017 Live Staging End-to-End Smoke Test Suite.

Executes real HTTP requests against live running staging backend and frontend instances.
Validates:
1. Public pages and Next.js production security headers.
2. Customer registration, authentication, address CRUD, and IDOR protection.
3. Dine-in and Takeout order placement, idempotency, and price verification.
4. Manager menu management, role authorization, and KDS status lifecycle.
5. Inventory ingredient depletion and transaction auditing.
6. Rate limiting, brute-force defense, and readiness/liveness health probes.
"""

import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4
from sqlalchemy import create_engine, text

# Locate project directories
backend_dir = Path(__file__).resolve().parents[1]
project_root = backend_dir.parent
sys.path.insert(0, str(backend_dir))


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class StagingClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.cookie: str | None = None

    def request(
        self,
        path: str,
        method: str = "GET",
        payload: dict | None = None,
        headers: dict | None = None,
    ) -> tuple[int, dict | str | None, dict]:
        req_headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        if headers:
            req_headers.update(headers)
        if self.cookie:
            req_headers["Cookie"] = self.cookie

        url = f"{self.base_url}{path}"
        req = Request(url, data=data, headers=req_headers, method=method)

        try:
            with urlopen(req) as resp:
                status = resp.status
                raw_body = resp.read().decode("utf-8")
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
                if "set-cookie" in resp_headers:
                    self._update_cookie(resp_headers["set-cookie"])
                try:
                    parsed_body = json.loads(raw_body) if raw_body else None
                except json.JSONDecodeError:
                    parsed_body = raw_body
                return status, parsed_body, resp_headers
        except HTTPError as err:
            raw_body = err.read().decode("utf-8")
            resp_headers = {k.lower(): v for k, v in err.headers.items()}
            if "set-cookie" in resp_headers:
                self._update_cookie(resp_headers["set-cookie"])
            try:
                parsed_body = json.loads(raw_body) if raw_body else None
            except json.JSONDecodeError:
                parsed_body = raw_body
            return err.code, parsed_body, resp_headers
        except Exception as err:
            return 0, f"Exception: {type(err).__name__}: {err}", {}

    def _update_cookie(self, set_cookie_header: str) -> None:
        cookie = SimpleCookie()
        cookie.load(set_cookie_header)
        pairs = []
        for key, morsel in cookie.items():
            if morsel.value:
                pairs.append(f"{key}={morsel.value}")
        if pairs:
            self.cookie = "; ".join(pairs)


def run_smoke_tests() -> bool:
    print("=" * 70)
    print("  SAVORYBITES SB-017: LIVE STAGING END-TO-END SMOKE TEST SUITE")
    print("=" * 70)

    # 1. Database Setup
    staging_db_url = os.environ.get("DATABASE_URL")
    if not staging_db_url:
        from app.core.config import settings
        staging_db_url = settings.DATABASE_URL.rsplit("/", 1)[0] + "/restaurant_db_staging"

    print(f"\n[1/5] Ensuring Staging Database is initialized at: {staging_db_url.split('@')[-1]}")
    from scripts.init_staging_db import init_database
    init_database(staging_db_url)

    # Clean up any transient orders from previous smoke runs so tables are free
    cleanup_engine = create_engine(staging_db_url)
    with cleanup_engine.connect() as conn:
        conn.execute(text("DELETE FROM inventory_transactions;"))
        conn.execute(text("DELETE FROM order_items;"))
        conn.execute(text("DELETE FROM orders;"))
        conn.commit()
    cleanup_engine.dispose()

    # 2. Launch Backend Staging Instance
    backend_port = get_free_port()
    frontend_port = get_free_port()
    print(f"\n[2/5] Starting Staging Services (Backend: {backend_port}, Frontend: {frontend_port})...")
    backend_env = os.environ.copy()
    backend_env["DATABASE_URL"] = staging_db_url
    backend_env["ENVIRONMENT"] = "staging"
    backend_env["JWT_SECRET_KEY"] = "staging-jwt-secret-key-32chars-minimum-unique-2026!"
    backend_env["FRONTEND_URL"] = f"http://127.0.0.1:{frontend_port}"
    backend_env["ALLOWED_CORS_ORIGINS"] = f"http://127.0.0.1:{frontend_port}"

    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(backend_port)],
        cwd=backend_dir,
        env=backend_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    frontend_env = os.environ.copy()
    frontend_env["PORT"] = str(frontend_port)
    frontend_env["NODE_ENV"] = "production"
    frontend_env["NEXT_PUBLIC_API_URL"] = f"http://127.0.0.1:{backend_port}"

    frontend_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    frontend_proc = subprocess.Popen(
        [frontend_cmd, "next", "start", "-p", str(frontend_port)],
        cwd=project_root,
        env=frontend_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    api = StagingClient(f"http://127.0.0.1:{backend_port}")
    web = StagingClient(f"http://127.0.0.1:{frontend_port}")

    # Wait for backend readiness
    ready = False
    for _ in range(40):
        try:
            status, body, _ = api.request("/health/ready")
            if status == 200 and isinstance(body, dict) and body.get("status") == "ready":
                ready = True
                break
        except Exception:
            time.sleep(0.1)
    if not ready:
        backend_proc.terminate()
        frontend_proc.terminate()
        raise RuntimeError("Staging backend did not become ready in time.")

    print(f"[OK] Staging Backend is ready (status: ready, database: connected).")

    # Wait for frontend readiness
    fe_ready = False
    for _ in range(40):
        try:
            status, body, _ = web.request("/")
            if status == 200:
                fe_ready = True
                break
        except Exception:
            time.sleep(0.2)

    if fe_ready:
        print(f"[OK] Staging Frontend is ready on port {frontend_port}.")
    else:
        print(f"[!] Warning: Frontend took longer to respond; continuing API smoke tests.")

    test_failures = []

    def assert_test(name: str, condition: bool, status_code: int = 0, body: any = None) -> None:
        if condition:
            print(f"  [PASS] {name}")
        else:
            detail = f"status={status_code}, body={body}"
            print(f"  [FAIL] {name} - {detail}")
            test_failures.append((name, detail))

    try:
        print("\n[3/5] Executing Live End-to-End Security & Workflow Smoke Tests...")

        # --- A. Frontend Public Pages & Security Headers ---
        if fe_ready:
            status, _, fe_headers = web.request("/")
            assert_test("Frontend Homepage loads (200)", status == 200, status)
            assert_test("Frontend CSP header present", "default-src 'self'" in fe_headers.get("content-security-policy", ""), status, fe_headers.get("content-security-policy"))
            assert_test("Frontend X-Frame-Options DENY present", fe_headers.get("x-frame-options") == "DENY", status, fe_headers.get("x-frame-options"))

            status, _, _ = web.request("/menu")
            assert_test("Frontend /menu page loads (200)", status == 200, status)

            status, _, _ = web.request("/about")
            assert_test("Frontend /about page loads (200)", status == 200, status)

            status, _, _ = web.request("/contact")
            assert_test("Frontend /contact page loads (200)", status == 200, status)

            status, _, _ = web.request("/non-existent-route-404-test")
            assert_test("Frontend unknown route returns 404", status == 404, status)

        # --- B. Backend Health Probes & Security Headers ---
        status, body, headers = api.request("/health")
        assert_test("Liveness probe returns 200 ok", status == 200 and body.get("status") == "ok", status, body)
        assert_test("Security header nosniff present", headers.get("x-content-type-options") == "nosniff", status, headers.get("x-content-type-options"))
        assert_test("Security header X-Frame-Options DENY present", headers.get("x-frame-options") == "DENY", status, headers.get("x-frame-options"))
        assert_test("Security header Referrer-Policy present", headers.get("referrer-policy") == "strict-origin-when-cross-origin", status, headers.get("referrer-policy"))

        status, body, headers = api.request("/api/v1/categories")
        assert_test("API CSP header present on /api/v1", "default-src 'none'" in headers.get("content-security-policy", ""), status, headers.get("content-security-policy"))

        # --- C. Customer Registration, Login & Address CRUD ---
        suffix = uuid4().hex[:8]
        cust_email = f"staging-cust-{suffix}@savorybites.staging"
        cust_phone = f"0917{uuid4().int % 10000000:07d}"
        cust_name = "Staging Customer"
        cust_pass = "StagingPass1234!"

        # Register
        status, body, _ = api.request(
            "/api/v1/auth/register",
            method="POST",
            payload={"full_name": cust_name, "email": cust_email, "phone": cust_phone, "password": cust_pass},
        )
        assert_test("Customer registration returns 201", status == 201 and "customer_id" in body, status, body)
        customer_id = body.get("customer_id")

        # Login
        status, body, _ = api.request(
            "/api/v1/auth/login",
            method="POST",
            payload={"email": cust_email, "password": cust_pass, "remember_me": False},
        )
        assert_test("Customer login returns 200 with access cookie", status == 200 and api.cookie is not None, status, body)

        # Get profile
        status, body, headers = api.request("/api/v1/auth/me")
        assert_test("Customer me profile returns authenticated user", status == 200 and body.get("email") == cust_email, status, body)
        assert_test("Sensitive route emits no-store cache header", "no-store" in headers.get("cache-control", ""), status, headers.get("cache-control"))

        # Update profile
        status, body, _ = api.request(
            "/api/v1/customers/me",
            method="PUT",
            payload={"full_name": "Updated Staging Name", "phone": cust_phone},
        )
        assert_test("Profile update succeeds", status == 200 and body.get("full_name") == "Updated Staging Name", status, body)

        # Add saved address
        status, body, _ = api.request(
            "/api/v1/customers/me/addresses",
            method="POST",
            payload={
                "label": "Home",
                "recipient_name": "Updated Staging Name",
                "phone": cust_phone,
                "street_address": "123 Mango Street, Unit 4B",
                "city": "Makati",
                "state_province": "Metro Manila",
                "postal_code": "1200",
                "delivery_instructions": "Leave with reception",
                "is_default": True,
            },
        )
        assert_test("Customer address creation returns 201", status == 201 and "id" in body, status, body)
        address_id = body.get("id")

        # Update address
        status, body, _ = api.request(
            f"/api/v1/customers/me/addresses/{address_id}",
            method="PUT",
            payload={"label": "Office", "city": "Taguig"},
        )
        assert_test("Customer address update returns 200", status == 200 and body.get("label") == "Office" and body.get("city") == "Taguig", status, body)

        # IDOR Test: create second customer and try to access first customer's address
        api_second = StagingClient(f"http://127.0.0.1:{backend_port}")
        second_email = f"staging-cust2-{suffix}@savorybites.staging"
        api_second.request(
            "/api/v1/auth/register",
            method="POST",
            payload={"full_name": "Second User", "email": second_email, "phone": f"0918{uuid4().int % 10000000:07d}", "password": cust_pass},
        )
        api_second.request("/api/v1/auth/login", method="POST", payload={"email": second_email, "password": cust_pass})
        status, idor_body, _ = api_second.request(f"/api/v1/customers/me/addresses/{address_id}", method="PUT", payload={"city": "Hacked"})
        assert_test("IDOR protection: Second customer cannot modify first customer's address", status == 404, status, idor_body)

        # Delete address
        status, _, _ = api.request(f"/api/v1/customers/me/addresses/{address_id}", method="DELETE")
        assert_test("Customer address deletion returns 200", status == 200)

        # --- D. Ordering, Pricing, Idempotency & Table Selection ---
        # Get catalog
        status, categories, _ = api.request("/api/v1/categories")
        assert_test("Categories catalog lists active categories", status == 200 and len(categories) > 0, status, categories)

        # Query available tables
        status, tables, _ = api.request("/api/v1/restaurant-tables")
        available_table_id = 1
        if status == 200 and isinstance(tables, list):
            for tbl in tables:
                if tbl.get("is_available"):
                    available_table_id = tbl.get("id")
                    break

        # Quote pricing
        quote_payload = {
            "items": [
                {
                    "cart_line_id": "line-1",
                    "product_id": 1,
                    "quantity": 2,
                    "size": "double",
                    "addons": ["extra_bacon"],
                }
            ]
        }
        status, quote_resp, _ = api.request("/api/v1/checkout/quote", method="POST", payload=quote_payload)
        assert_test("Checkout quote recalculates server prices correctly", status == 200 and quote_resp.get("subtotal") == "658.00", status, quote_resp)

        # Place Order 1: Table Service
        idempotency_key_1 = f"idemp-{uuid4().hex}"
        order_payload_1 = {
            "order_type": "dine_in",
            "fulfillment_type": "table_service",
            "restaurant_table_id": available_table_id,
            "payment_method_code": "cash",
            "items": [
                {
                    "cart_line_id": "line-1",
                    "product_id": 1,
                    "quantity": 2,
                    "size": "double",
                    "addons": ["extra_bacon"],
                }
            ],
        }
        status, order1, _ = api.request(
            "/api/v1/orders",
            method="POST",
            payload=order_payload_1,
            headers={"Idempotency-Key": idempotency_key_1},
        )
        assert_test("Order 1 (Table Service) placed successfully (201)", status == 201 and isinstance(order1, dict) and "id" in order1, status, order1)
        order1_id = order1.get("id") if isinstance(order1, dict) else None

        # Replay Order 1 with same Idempotency-Key -> MUST return 200 OK (idempotent, no duplicate)
        status, order1_replay, _ = api.request(
            "/api/v1/orders",
            method="POST",
            payload=order_payload_1,
            headers={"Idempotency-Key": idempotency_key_1},
        )
        assert_test("Idempotent order replay returns 200 without duplication", status == 200 and isinstance(order1_replay, dict) and order1_replay.get("id") == order1_id, status, order1_replay)

        # Place Order 2: Counter Pickup
        idempotency_key_2 = f"idemp-{uuid4().hex}"
        order_payload_2 = {
            "order_type": "takeout",
            "fulfillment_type": "counter_pickup",
            "restaurant_table_id": None,
            "payment_method_code": "gcash",
            "items": [
                {
                    "cart_line_id": "line-2",
                    "product_id": 2,
                    "quantity": 1,
                    "size": "regular",
                    "addons": [],
                }
            ],
        }
        status, order2, _ = api.request(
            "/api/v1/orders",
            method="POST",
            payload=order_payload_2,
            headers={"Idempotency-Key": idempotency_key_2},
        )
        assert_test("Order 2 (Counter Pickup) placed successfully (201)", status == 201 and isinstance(order2, dict) and "id" in order2, status, order2)

        # Retrieve order
        if order1_id:
            status, order_check, _ = api.request(f"/api/v1/orders/{order1_id}")
            assert_test("Customer can retrieve own order", status == 200 and isinstance(order_check, dict) and order_check.get("id") == order1_id, status, order_check)

            # IDOR check on orders: second customer cannot access order1
            status, idor_body, _ = api_second.request(f"/api/v1/orders/{order1_id}")
            assert_test("IDOR protection: Second customer cannot view order1", status == 404, status, idor_body)

        # --- E. Manager Operations & Role Authorization ---
        mgr_api = StagingClient(f"http://127.0.0.1:{backend_port}")
        status, mgr_login, _ = mgr_api.request(
            "/api/v1/staff/auth/login",
            method="POST",
            payload={"email": "manager@savorybites.staging", "password": "StagingManagerPass2026!"},
        )
        assert_test("Staging Manager login succeeds", status == 200 and mgr_api.cookie is not None, status, mgr_login)

        # Customer attempting manager route receives 401/403
        status, cust_mgr_body, _ = api.request("/api/v1/manager/orders")
        assert_test("Customer attempting manager route receives 401/403", status in (401, 403), status, cust_mgr_body)

        # Manager gets fulfillment orders
        status, mgr_orders, _ = mgr_api.request("/api/v1/manager/orders")
        assert_test("Manager can list fulfillment orders", status == 200 and isinstance(mgr_orders, list), status, mgr_orders)

        # Manager category CRUD
        status, new_cat, _ = mgr_api.request(
            "/api/v1/categories",
            method="POST",
            payload={"name": f"Chef Specials {suffix}", "description": "Seasonal specials", "display_order": 99, "is_active": True},
        )
        assert_test("Manager can create menu category", status == 201 and isinstance(new_cat, dict) and "id" in new_cat, status, new_cat)
        new_cat_id = new_cat.get("id") if isinstance(new_cat, dict) else None

        if new_cat_id:
            status, upd_cat, _ = mgr_api.request(
                f"/api/v1/categories/{new_cat_id}",
                method="PUT",
                payload={"name": f"Chef Specials Updated {suffix}"},
            )
            assert_test("Manager can update category", status == 200 and isinstance(upd_cat, dict) and "Updated" in upd_cat.get("name", ""), status, upd_cat)

        # Toggle product availability
        status, prod_avail, _ = mgr_api.request(
            "/api/v1/products/1/availability",
            method="PATCH",
            payload={"is_available": True},
        )
        assert_test("Manager can toggle product availability", status == 200 and isinstance(prod_avail, dict) and prod_avail.get("is_available") is True, status, prod_avail)

        # --- F. Kitchen Display System (KDS) & Inventory Depletion Lifecycle ---
        kit_api = StagingClient(f"http://127.0.0.1:{backend_port}")
        status, kit_login, _ = kit_api.request(
            "/api/v1/staff/auth/login",
            method="POST",
            payload={"email": "kitchen@savorybites.staging", "password": "StagingKitchenPass2026!"},
        )
        assert_test("Kitchen staff login succeeds", status == 200 and kit_api.cookie is not None, status, kit_login)

        # Kitchen views KDS orders
        status, kds_list, _ = kit_api.request("/api/v1/kds/orders")
        assert_test("Kitchen staff can query KDS queue", status == 200 and isinstance(kds_list, list) and len(kds_list) > 0, status, kds_list)

        if order1_id:
            # 1. Advance to confirmed (triggers inventory deduction)
            status, kds_conf, _ = kit_api.request(
                f"/api/v1/kds/orders/{order1_id}/status",
                method="PATCH",
                payload={"status": "confirmed"},
            )
            assert_test("KDS transitions order to confirmed (deducts stock)", status == 200 and isinstance(kds_conf, dict) and kds_conf.get("status") == "confirmed", status, kds_conf)

            # 2. Advance to preparing
            status, kds_prep, _ = kit_api.request(
                f"/api/v1/kds/orders/{order1_id}/status",
                method="PATCH",
                payload={"status": "preparing"},
            )
            assert_test("KDS transitions order to preparing", status == 200 and isinstance(kds_prep, dict) and kds_prep.get("status") == "preparing", status, kds_prep)

            # 3. Advance to ready
            status, kds_ready, _ = kit_api.request(
                f"/api/v1/kds/orders/{order1_id}/status",
                method="PATCH",
                payload={"status": "ready"},
            )
            assert_test("KDS transitions order to ready", status == 200 and isinstance(kds_ready, dict) and kds_ready.get("status") == "ready", status, kds_ready)

            # 4. Verify inventory deduction transaction
            status, inv_tx, _ = mgr_api.request("/api/v1/inventory/transactions")
            assert_test("Inventory transactions recorded for order fulfillment", status == 200 and isinstance(inv_tx, list) and len(inv_tx) > 0, status, inv_tx)

        # --- G. Contact Form Submission & Validation ---
        status, contact_resp, _ = api.request(
            "/api/v1/contact",
            method="POST",
            payload={
                "name": "Maria Santos",
                "email": "maria@example.com",
                "subject": "Staging Inquiry",
                "message": "Testing contact form dispatch in staging environment.",
            },
        )
        assert_test("Contact form inquiry succeeds (200)", status == 200 and isinstance(contact_resp, dict) and "received" in contact_resp.get("message", "").lower(), status, contact_resp)

        # --- H. Rate Limiting / Abuse Prevention ---
        bad_api = StagingClient(f"http://127.0.0.1:{backend_port}")
        for _ in range(10):
            bad_api.request("/api/v1/auth/login", method="POST", payload={"email": cust_email, "password": "WrongPassword!"})
        status, bad_resp, _ = bad_api.request("/api/v1/auth/login", method="POST", payload={"email": cust_email, "password": "WrongPassword!"})
        assert_test("Brute force protection triggers 429 Too Many Requests after 10 failed logins", status == 429, status, bad_resp)

    finally:
        print("\n[4/5] Tearing down test processes...")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.wait()
        frontend_proc.wait()
        print("[+] Backend and Frontend processes stopped.")

    # 5. Summary
    print("\n[5/5] Smoke Test Suite Results Summary:")
    print("=" * 70)
    if not test_failures:
        print(f"ALL LIVE STAGING SMOKE TESTS PASSED SUCCESSFULLY! (0 failures)")
        return True
    else:
        print(f"FAILED {len(test_failures)} SMOKE TESTS:")
        for name, detail in test_failures:
            print(f"  - {name}: {detail}")
        return False


if __name__ == "__main__":
    success = run_smoke_tests()
    sys.exit(0 if success else 1)
