"""Unit and HTTP integration tests for public response caching, ETag 304, and invalidation."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import delete, select

from app.core.security import create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.category import MenuCategory
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemSize
from app.db.models.staff import Role, StaffUser
from app.services.response_cache import ResponseCacheStore


class ResponseCacheTests(TestCase):
    def test_store_ttl_lru_and_namespace_invalidation(self):
        store = ResponseCacheStore(max_entries=2)
        store.set("catalog", "k1", b'{"v":1}', ttl_seconds=60)
        store.set("catalog", "k2", b'{"v":2}', ttl_seconds=60)
        self.assertIsNotNone(store.get("k1"))  # promotes k1 as most recent
        store.set("settings", "k3", b'{"v":3}', ttl_seconds=60)  # evicts k2
        self.assertIsNone(store.get("k2"))
        self.assertIsNotNone(store.get("k1"))
        self.assertIsNotNone(store.get("k3"))

        removed = store.invalidate_namespace("catalog")
        self.assertEqual(removed, 1)
        self.assertIsNone(store.get("k1"))
        self.assertIsNotNone(store.get("k3"))


class ResponseCacheHttpTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex[:8]
        cls.suffix = suffix
        now = datetime.now(timezone.utc)
        pwd_hash = hash_password("CacheTestPass2026!")

        with SessionLocal() as db:
            mgr_role = db.scalar(select(Role).where(Role.name == "manager"))
            mgr = StaffUser(
                role_id=mgr_role.id,
                name="Cache Test Manager",
                email=f"cache-mgr-{suffix}@savorybites.staging",
                legacy_password=pwd_hash,
                password_hash=pwd_hash,
                status="active",
            )
            cat = MenuCategory(
                name=f"Cache Cat {suffix}",
                display_order=96,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add_all([mgr, cat])
            db.flush()

            prod = MenuProduct(
                category_id=cat.id,
                name=f"Cache Dish {suffix}",
                description="Test cached dish",
                price=Decimal("180.00"),
                is_available=True,
                created_at=now,
                updated_at=now,
            )
            db.add(prod)
            db.flush()
            db.add(
                MenuItemSize(
                    product_id=prod.id,
                    code="Regular",
                    label="Regular",
                    price_adjustment=Decimal("0.00"),
                    display_order=1,
                    is_active=True,
                )
            )
            db.commit()

            cls.mgr_id = mgr.id
            cls.cat_id = cat.id
            cls.prod_id = prod.id
            cls.mgr_token = create_staff_access_token(mgr.id, timedelta(minutes=15), role="manager")

        backend_dir = Path(__file__).resolve().parents[1]
        cls.proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(cls.port),
            ],
            cwd=str(backend_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline:
            try:
                with urlopen(f"http://127.0.0.1:{cls.port}/health", timeout=1.0) as res:
                    if res.status == 200:
                        break
            except Exception:
                time.sleep(0.2)
        else:
            cls.proc.terminate()
            raise RuntimeError("Test server failed to start for ResponseCacheHttpTests")

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "proc", None):
            cls.proc.terminate()
            cls.proc.wait(timeout=10)
        with SessionLocal() as db:
            db.execute(delete(MenuItemSize).where(MenuItemSize.product_id == cls.prod_id))
            db.execute(delete(MenuProduct).where(MenuProduct.id == cls.prod_id))
            db.execute(delete(MenuCategory).where(MenuCategory.id == cls.cat_id))
            db.execute(delete(StaffUser).where(StaffUser.id == cls.mgr_id))
            db.commit()

    def _req(
        self,
        path: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: dict | None = None,
    ):
        req_headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        req = Request(
            f"http://127.0.0.1:{self.port}{path}",
            method=method,
            headers=req_headers,
            data=data,
        )
        try:
            with urlopen(req, timeout=5.0) as res:
                raw = res.read().decode("utf-8")
                hdrs = {k.lower(): v for k, v in res.headers.items()}
                return res.status, json.loads(raw) if raw else None, hdrs
        except HTTPError as err:
            raw = err.read().decode("utf-8")
            hdrs = {k.lower(): v for k, v in err.headers.items()}
            return err.code, json.loads(raw) if raw else None, hdrs

    def test_public_endpoints_cache_etag_304_and_mutate_invalidation(self):
        # 1. Categories + Products + Settings emit public Cache-Control & ETag
        st_cat, cats, hdr_cat = self._req("/api/v1/categories")
        self.assertEqual(st_cat, 200)
        self.assertTrue(any(c["id"] == self.cat_id for c in cats))
        self.assertIn("max-age=60", hdr_cat.get("cache-control", ""))
        self.assertTrue(hdr_cat.get("etag"))

        st_304, body_304, _ = self._req(
            "/api/v1/categories",
            headers={"If-None-Match": hdr_cat["etag"]},
        )
        self.assertEqual(st_304, 304)
        self.assertIsNone(body_304)

        st_prod, prod, hdr_prod = self._req(f"/api/v1/products/{self.prod_id}")
        self.assertEqual(st_prod, 200)
        self.assertEqual(prod["is_available"], True)
        prod_etag = hdr_prod["etag"]

        st_prod_304, _, _ = self._req(
            f"/api/v1/products/{self.prod_id}",
            headers={"If-None-Match": prod_etag},
        )
        self.assertEqual(st_prod_304, 304)

        # 2. Manager mutation immediately invalidates cached product & updates ETag
        st_mut, updated_prod, _ = self._req(
            f"/api/v1/products/{self.prod_id}/availability",
            method="PATCH",
            headers={"Cookie": f"staff_access_token={self.mgr_token}"},
            body={"is_available": False},
        )
        self.assertEqual(st_mut, 200)
        self.assertEqual(updated_prod["is_available"], False)

        st_after, prod_after, hdr_after = self._req(
            f"/api/v1/products/{self.prod_id}",
            headers={"If-None-Match": prod_etag},
        )
        self.assertEqual(st_after, 200)
        self.assertEqual(prod_after["is_available"], False)
        self.assertNotEqual(hdr_after["etag"], prod_etag)

        # 3. Settings endpoint emits ETag + 304, while Manager endpoint enforces no-store
        st_set, _, hdr_set = self._req("/api/v1/restaurant/settings")
        self.assertEqual(st_set, 200)
        self.assertIn("max-age=30", hdr_set.get("cache-control", ""))
        self.assertEqual(
            self._req("/api/v1/restaurant/settings", headers={"If-None-Match": hdr_set["etag"]})[0],
            304,
        )

        st_mgr, _, hdr_mgr = self._req(
            "/api/v1/manager/settings",
            headers={"Cookie": f"staff_access_token={self.mgr_token}"},
        )
        self.assertEqual(st_mgr, 200)
        self.assertIn("no-store", hdr_mgr.get("cache-control", ""))
