import io
import json
import socket
import subprocess
import sys
import time
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.product import MenuProduct
from app.db.models.staff import Role, StaffUser
from app.services.media_storage_service import (
    delete_stored_dish_image,
    get_dish_image_path,
    save_dish_image,
)


class MediaStorageUnitTests(TestCase):
    def test_save_valid_jpeg_and_convert_to_webp(self):
        # Create a valid JPEG
        img = Image.new("RGB", (200, 150), color=(200, 100, 50))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpeg_bytes = buf.getvalue()

        result = save_dish_image(jpeg_bytes, "test_dish.jpg")
        self.assertTrue(result["filename"].startswith("dish_"))
        self.assertTrue(result["filename"].endswith(".webp"))
        self.assertTrue(result["image_url"].startswith("/api/v1/media/dishes/"))
        self.assertEqual(result["content_type"], "image/webp")
        self.assertEqual(result["width"], 200)
        self.assertEqual(result["height"], 150)

        # Verify file exists on disk
        file_path = get_dish_image_path(result["filename"])
        self.assertIsNotNone(file_path)
        self.assertTrue(file_path.is_file())

        # Cleanup
        self.assertTrue(delete_stored_dish_image(result["image_url"]))
        self.assertIsNone(get_dish_image_path(result["filename"]))

    def test_save_valid_png_with_transparency(self):
        # Create a valid RGBA PNG
        img = Image.new("RGBA", (120, 120), color=(10, 50, 200, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        result = save_dish_image(png_bytes, "transparent_dish.png")
        self.assertEqual(result["content_type"], "image/webp")
        self.assertEqual(result["width"], 120)
        self.assertEqual(result["height"], 120)

        # Verify on disk
        file_path = get_dish_image_path(result["filename"])
        self.assertIsNotNone(file_path)
        with Image.open(file_path) as saved_img:
            self.assertEqual(saved_img.format, "WEBP")
            self.assertEqual(saved_img.mode, "RGBA")

        # Cleanup
        delete_stored_dish_image(result["filename"])

    def test_downscales_oversized_dimensions(self):
        # Create a large 2400x1200 image
        img = Image.new("RGB", (2400, 1200), color=(50, 150, 250))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")

        result = save_dish_image(buf.getvalue(), "huge_dish.jpg")
        self.assertEqual(result["width"], 1600)
        self.assertEqual(result["height"], 800)

        delete_stored_dish_image(result["filename"])

    def test_rejects_empty_file(self):
        with self.assertRaises(ValueError) as ctx:
            save_dish_image(b"")
        self.assertIn("empty", str(ctx.exception).lower())

    def test_rejects_oversized_file(self):
        from app.core.config import settings

        fake_large_file = b"\xff\xd8\xff" + b"\x00" * settings.MAX_UPLOAD_SIZE_BYTES
        with self.assertRaises(ValueError) as ctx:
            save_dish_image(fake_large_file)
        self.assertIn("exceeds", str(ctx.exception).lower())

    def test_rejects_spoofed_file_format(self):
        fake_text_as_jpg = b"This is not a real image at all."
        with self.assertRaises(ValueError) as ctx:
            save_dish_image(fake_text_as_jpg, "fake.jpg")
        self.assertIn("unsupported or invalid", str(ctx.exception).lower())

    def test_path_traversal_prevention_in_get_and_delete(self):
        self.assertIsNone(get_dish_image_path("../../etc/passwd"))
        self.assertIsNone(get_dish_image_path("dish_../..\\secret.webp"))
        self.assertFalse(delete_stored_dish_image("../../etc/passwd"))
        self.assertFalse(delete_stored_dish_image("/api/v1/media/dishes/../../../app/main.py"))


class MediaStorageApiIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex
        cls.manager_email = f"manager-media-{suffix}@example.com"
        cls.kitchen_email = f"kitchen-media-{suffix}@example.com"
        cls.password = "MediaSecPass2026!"
        password_hash = hash_password(cls.password)

        with SessionLocal() as db:
            manager_role = db.scalar(select(Role).where(Role.name == "manager"))
            kitchen_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()

            if manager_role is None or kitchen_role is None or customer is None:
                raise RuntimeError("Integration database requires manager, kitchen_staff, and customer records.")

            cls.customer_token = create_access_token(customer.customer_id, timedelta(minutes=10))

            db.add_all([
                StaffUser(
                    role_id=manager_role.id,
                    name="Media Manager",
                    email=cls.manager_email,
                    legacy_password=password_hash,
                    password_hash=password_hash,
                    status="active",
                ),
                StaffUser(
                    role_id=kitchen_role.id,
                    name="Media Kitchen",
                    email=cls.kitchen_email,
                    legacy_password=password_hash,
                    password_hash=password_hash,
                    status="active",
                ),
            ])

            # Ensure a test category exists
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            cat = MenuCategory(
                name=f"Media Test Cat {suffix[:8]}",
                description="Testing media category",
                display_order=99,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(cat)
            db.commit()
            db.refresh(cat)
            cls.category_id = cat.id

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server_process = subprocess.Popen(
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

        ready = False
        for _ in range(60):
            try:
                with urlopen(f"http://127.0.0.1:{cls.port}/health", timeout=1) as response:
                    if response.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.2)
        if not ready:
            cls.server_process.kill()
            cls.server_process.wait()
            raise RuntimeError("FastAPI test server failed to start within timeout.")

    @classmethod
    def tearDownClass(cls):
        cls.server_process.terminate()
        cls.server_process.wait()

        # Database cleanup to prevent test pollution in other suites
        with SessionLocal() as db:
            from app.db.models.product_option import MenuItemSize
            prod_ids = db.scalars(select(MenuProduct.id).where(MenuProduct.category_id == cls.category_id)).all()
            if prod_ids:
                db.query(MenuItemSize).filter(MenuItemSize.product_id.in_(prod_ids)).delete(synchronize_session=False)
                db.query(MenuProduct).filter(MenuProduct.id.in_(prod_ids)).delete(synchronize_session=False)
            db.query(MenuCategory).filter(MenuCategory.id == cls.category_id).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email])).delete(synchronize_session=False)
            db.commit()

    def _login(self, email: str, role: str) -> str:
        body = json.dumps({"email": email, "password": self.password, "requested_role": role}).encode("utf-8")
        req = Request(
            f"http://127.0.0.1:{self.port}/api/v1/staff/auth/login",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["access_token"]

    def _upload_multipart(self, token: str | None, filename: str, content: bytes, content_type: str = "image/jpeg") -> tuple[int, dict]:
        boundary = f"----WebKitFormBoundary{uuid4().hex}"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        req = Request(
            f"http://127.0.0.1:{self.port}/api/v1/products/upload-image",
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(req) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as err:
            err_body = err.read().decode("utf-8")
            try:
                parsed = json.loads(err_body)
            except Exception:
                parsed = {"detail": err_body}
            return err.code, parsed

    def test_rbac_upload_dish_image_permissions(self):
        # Create a small valid test JPEG
        img = Image.new("RGB", (100, 100), color=(100, 200, 50))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        test_bytes = buf.getvalue()

        # 1. Unauthenticated -> 401
        status, data = self._upload_multipart(None, "test.jpg", test_bytes)
        self.assertEqual(status, 401)

        # 2. Customer token -> 401 Unauthorized (not a staff token)
        status, data = self._upload_multipart(self.customer_token, "test.jpg", test_bytes)
        self.assertEqual(status, 401)

        # 3. Kitchen Staff token -> 403 Forbidden (staff token but lacks manager role)
        kitchen_token = self._login(self.kitchen_email, "kitchen_staff")
        status, data = self._upload_multipart(kitchen_token, "test.jpg", test_bytes)
        self.assertEqual(status, 403)

        # 4. Manager token -> 201 Created
        manager_token = self._login(self.manager_email, "manager")
        status, data = self._upload_multipart(manager_token, "valid_dish.jpg", test_bytes)
        self.assertEqual(status, 201)
        self.assertIn("image_url", data)
        self.assertIn("filename", data)
        self.assertEqual(data["content_type"], "image/webp")

        # Cleanup
        delete_stored_dish_image(data["filename"])

    def test_upload_and_serve_dish_image_lifecycle(self):
        manager_token = self._login(self.manager_email, "manager")

        # 1. Upload valid image
        img = Image.new("RGB", (150, 150), color=(255, 128, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        status, upload_data = self._upload_multipart(manager_token, "spicy_wings.jpg", buf.getvalue())
        self.assertEqual(status, 201)
        image_url = upload_data["image_url"]
        filename = upload_data["filename"]

        # 2. Verify media endpoint serves it publicly
        media_req = Request(f"http://127.0.0.1:{self.port}{image_url}")
        with urlopen(media_req) as media_resp:
            self.assertEqual(media_resp.status, 200)
            self.assertEqual(media_resp.headers.get("Content-Type"), "image/webp")
            self.assertIn("max-age", media_resp.headers.get("Cache-Control", ""))
            self.assertEqual(media_resp.headers.get("X-Content-Type-Options"), "nosniff")
            content = media_resp.read()
            self.assertTrue(len(content) > 0)

        # 3. Create product referencing this image
        create_req = Request(
            f"http://127.0.0.1:{self.port}/api/v1/products",
            data=json.dumps({
                "category_id": self.category_id,
                "name": f"Spicy Glazed Wings {uuid4().hex[:6]}",
                "description": "Crispy chicken wings in spicy glaze",
                "price": "280.00",
                "image_url": image_url,
                "is_available": True,
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {manager_token}",
            },
            method="POST",
        )
        with urlopen(create_req) as prod_resp:
            self.assertEqual(prod_resp.status, 201)
            created_prod = json.loads(prod_resp.read().decode("utf-8"))
            self.assertEqual(created_prod["image_url"], image_url)
            prod_id = created_prod["id"]

        # 4. Verify customer GET returns the dish with the image
        cust_req = Request(f"http://127.0.0.1:{self.port}/api/v1/products/{prod_id}")
        with urlopen(cust_req) as cust_resp:
            self.assertEqual(cust_resp.status, 200)
            cust_prod = json.loads(cust_resp.read().decode("utf-8"))
            self.assertEqual(cust_prod["image_url"], image_url)

        # 5. Compensating delete endpoint verification
        del_req = Request(
            f"http://127.0.0.1:{self.port}/api/v1/products/upload-image?image_url={image_url}",
            headers={"Authorization": f"Bearer {manager_token}"},
            method="DELETE",
        )
        with urlopen(del_req) as del_resp:
            self.assertEqual(del_resp.status, 200)
            del_data = json.loads(del_resp.read().decode("utf-8"))
            self.assertTrue(del_data["deleted"])

        # 6. Serving after deletion returns 404
        with self.assertRaises(HTTPError) as ctx:
            urlopen(media_req)
        self.assertEqual(ctx.exception.code, 404)
