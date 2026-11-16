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

from sqlalchemy import select

from app.core.security import create_access_token, create_staff_access_token, hash_password
from app.db.database import SessionLocal
from app.db.models.customer import Customer
from app.db.models.order import Order, OrderItem
from app.db.models.inventory import InventoryItem, InventoryTransaction
from app.db.models.inventory import MenuItemIngredient
from app.db.models.product import MenuProduct
from app.db.models.staff import Role, StaffUser


class StaffApiIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        suffix = uuid4().hex
        cls.manager_email = f"manager-routing-{suffix}@example.com"
        cls.kitchen_email = f"kitchen-routing-{suffix}@example.com"
        cls.cashier_email = f"cashier-routing-{suffix}@example.com"
        cls.password = "RoleRoutingTest123!"
        password_hash = hash_password(cls.password)
        with SessionLocal() as db:
            manager_role = db.scalar(select(Role).where(Role.name == "manager"))
            kitchen_role = db.scalar(select(Role).where(Role.name == "kitchen_staff"))
            cashier_role = db.scalar(select(Role).where(Role.name == "cashier"))
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()
            product = db.scalars(select(MenuProduct).where(MenuProduct.is_available.is_(True)).order_by(MenuProduct.id)).first()
            if manager_role is None or kitchen_role is None or cashier_role is None or customer is None or product is None:
                raise RuntimeError("The integration database requires manager, kitchen_staff, and customer records.")
            cls.customer_token = create_access_token(customer.customer_id, timedelta(minutes=5))
            cls.product_id = product.id
            db.add_all([
                StaffUser(role_id=manager_role.id, name="Routing Manager", email=cls.manager_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
                StaffUser(role_id=kitchen_role.id, name="Routing Kitchen", email=cls.kitchen_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
                StaffUser(role_id=cashier_role.id, name="Routing Cashier", email=cls.cashier_email, legacy_password=password_hash, password_hash=password_hash, status="active"),
            ])
            db.commit()
            cls.manager_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.manager_email))
            cls.kitchen_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.kitchen_email))
            cls.cashier_id = db.scalar(select(StaffUser.id).where(StaffUser.email == cls.cashier_email))

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)], cwd=backend_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                if cls._request("/health")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        cls.server.terminate()
        raise RuntimeError("FastAPI integration server did not start.")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        with SessionLocal() as db:
            transactions = list(db.scalars(select(InventoryTransaction).where(InventoryTransaction.performed_by.in_([cls.manager_id, cls.kitchen_id, cls.cashier_id]))))
            for transaction in transactions:
                item = db.get(InventoryItem, transaction.inventory_item_id)
                if item is not None:
                    item.current_stock -= transaction.quantity_change
            db.query(InventoryTransaction).filter(InventoryTransaction.id.in_([transaction.id for transaction in transactions] or [-1])).delete(synchronize_session=False)
            db.query(StaffUser).filter(StaffUser.email.in_([cls.manager_email, cls.kitchen_email, cls.cashier_email])).delete(synchronize_session=False)
            db.commit()

    @classmethod
    def _request(cls, path, method="GET", body=None, headers=None):
        request_headers = dict(headers or {})
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        request = Request(f"http://127.0.0.1:{cls.port}{path}", data=json.dumps(body).encode() if body is not None else None, headers=request_headers, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                content = response.read()
                try:
                    return response.status, json.loads(content) if content else None, response.headers
                except Exception:
                    return response.status, content.decode("utf-8", errors="replace"), response.headers
        except HTTPError as error:
            content = error.read()
            try:
                return error.code, json.loads(content) if content else None, error.headers
            except Exception:
                return error.code, content.decode("utf-8", errors="replace"), error.headers

    @classmethod
    def _login(cls, email):
        status, response, headers = cls._request("/api/v1/staff/auth/login", method="POST", body={"email": email, "password": cls.password})
        return status, response, headers.get("Set-Cookie").split(";", 1)[0]

    @classmethod
    def _delete_test_order(cls, order_id):
        with SessionLocal() as db:
            transactions = list(db.scalars(select(InventoryTransaction).where(
                InventoryTransaction.reference_type == "order_confirmation",
                InventoryTransaction.reference_id == order_id,
            )))
            for transaction in transactions:
                item = db.get(InventoryItem, transaction.inventory_item_id)
                if item is not None:
                    item.current_stock -= transaction.quantity_change
            db.query(InventoryTransaction).filter(InventoryTransaction.reference_type == "order_confirmation", InventoryTransaction.reference_id == order_id).delete(synchronize_session=False)
            db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
            db.query(Order).filter(Order.id == order_id).delete()
            db.commit()

    def test_staff_login_returns_authoritative_role_and_enforces_interfaces(self):
        status, manager, manager_cookie = self._login(self.manager_email)
        self.assertEqual(status, 200)
        self.assertEqual(manager["role"], "manager")
        self.assertEqual(self._request("/api/v1/staff/auth/me", headers={"Cookie": manager_cookie})[1]["role"], "manager")
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": manager_cookie})[0], 200)
        # Strict portal isolation: manager is denied access to KDS endpoints
        self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": manager_cookie})[0], 403)
        inventory_status, inventory, _ = self._request("/api/v1/inventory", headers={"Cookie": manager_cookie})
        self.assertEqual(inventory_status, 200)
        transaction_status, transaction, _ = self._request(
            f"/api/v1/inventory/{inventory[0]['id']}/transactions",
            method="POST",
            body={"transaction_type": "purchase", "quantity_change": "0.01", "notes": "Integration test restock"},
            headers={"Cookie": manager_cookie},
        )
        self.assertEqual(transaction_status, 201)
        self.assertEqual(transaction["transaction_type"], "purchase")

        status, kitchen, kitchen_cookie = self._login(self.kitchen_email)
        self.assertEqual(status, 200)
        self.assertEqual(kitchen["role"], "kitchen_staff")
        self.assertEqual(self._request("/api/v1/staff/auth/me", headers={"Cookie": kitchen_cookie})[1]["role"], "kitchen_staff")
        self.assertEqual(self._request("/api/v1/kds/orders", headers={"Cookie": kitchen_cookie})[0], 200)
        self.assertEqual(self._request("/api/v1/manager/orders", headers={"Cookie": kitchen_cookie})[0], 403)
        self.assertEqual(self._request("/api/v1/inventory", headers={"Cookie": kitchen_cookie})[0], 403)
        cashier_cookie = f"staff_access_token={create_staff_access_token(self.cashier_id, timedelta(minutes=5))}"
        self.assertEqual(self._request("/api/v1/inventory", headers={"Cookie": cashier_cookie})[0], 403)

        customer_headers = {"Authorization": f"Bearer {self.customer_token}"}
        self.assertEqual(self._request("/api/v1/manager/orders", headers=customer_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/kds/orders", headers=customer_headers)[0], 401)
        self.assertEqual(self._request("/api/v1/inventory", headers=customer_headers)[0], 401)

        # Logout succeeds and clears cookie when authenticated, and remains safe when unauthenticated or expired
        logout_status, logout_body, logout_headers = self._request("/api/v1/staff/auth/logout", method="POST", headers={"Cookie": kitchen_cookie})
        self.assertEqual(logout_status, 200)
        self.assertIn("staff_access_token", logout_headers.get("Set-Cookie", ""))
        self.assertEqual(self._request("/api/v1/staff/auth/logout", method="POST")[0], 200)
        expired_cookie = f"staff_access_token={create_staff_access_token(self.kitchen_id, timedelta(minutes=-10))}"
        self.assertEqual(self._request("/api/v1/staff/auth/logout", method="POST", headers={"Cookie": expired_cookie})[0], 200)

    def test_unified_staff_login_with_role_selection_and_rbac_enforcement(self):
        # 1. Valid manager selects Management -> 200 OK, target_url /manager
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.manager_email, "password": self.password, "requested_role": "manager"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(resp["role"], "manager")
        self.assertEqual(resp["target_url"], "/manager")

        # 2. Valid kitchen staff selects Kitchen Staff -> 200 OK, target_url /kds
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.kitchen_email, "password": self.password, "requested_role": "kitchen_staff"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(resp["role"], "kitchen_staff")
        self.assertEqual(resp["target_url"], "/kds")

        # 3. Kitchen staff account attempts to select Management -> 403 Forbidden
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.kitchen_email, "password": self.password, "requested_role": "manager"},
        )
        self.assertEqual(status, 403)
        self.assertIn("not authorized", resp["detail"].lower())

        # 4. Manager account attempts to select Kitchen Staff -> 403 Forbidden (strict RBAC)
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.manager_email, "password": self.password, "requested_role": "kitchen_staff"},
        )
        self.assertEqual(status, 403)
        self.assertIn("not authorized", resp["detail"].lower())

        # 5. Invalid destination string -> 400 Bad Request
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.manager_email, "password": self.password, "requested_role": "super_admin_bypass"},
        )
        self.assertEqual(status, 400)

        # 6. Invalid credentials with role requested -> 401 Unauthorized (generic error)
        status, resp, _ = self._request(
            "/api/v1/staff/auth/login",
            method="POST",
            body={"email": self.manager_email, "password": "WrongPassword123!", "requested_role": "manager"},
        )
        self.assertEqual(status, 401)
        self.assertIn("invalid staff email or password", resp["detail"].lower())

    def test_every_active_catalog_product_has_an_inventory_recipe(self):
        with SessionLocal() as db:
            active_product_ids = set(db.scalars(select(MenuProduct.id).where(MenuProduct.is_available.is_(True), MenuProduct.deleted_at.is_(None))))
            mapped_product_ids = set(db.scalars(select(MenuItemIngredient.menu_item_id).where(MenuItemIngredient.menu_item_id.in_(active_product_ids))))
        self.assertEqual(mapped_product_ids, active_product_ids)

    def test_dine_in_order_persists_fulfillment_and_reaches_kds_ready(self):
        _, manager, manager_cookie = self._login(self.manager_email)
        _, kitchen, kitchen_cookie = self._login(self.kitchen_email)
        self.assertEqual(manager["role"], "manager")
        self.assertEqual(kitchen["role"], "kitchen_staff")

        customer_headers = {"Authorization": f"Bearer {self.customer_token}"}
        _, tables, _ = self._request("/api/v1/restaurant-tables")
        table = next(table for table in tables if table["is_available"])
        _, product, _ = self._request(f"/api/v1/products/{self.product_id}")
        _, payment_methods, _ = self._request("/api/v1/payment-methods")
        payload = {
            "items": [{"cart_line_id": "dine-in-line", "product_id": self.product_id, "quantity": 1, "size": product["sizes"][0]["code"], "addons": []}],
            "payment_method_code": payment_methods[0]["code"],
            "order_type": "dine_in",
            "fulfillment_type": "table_service",
            "restaurant_table_id": table["id"],
        }
        order_id = None
        try:
            created_status, created, _ = self._request("/api/v1/orders", method="POST", body=payload, headers={**customer_headers, "Idempotency-Key": uuid4().hex})
            self.assertEqual(created_status, 201)
            order_id = created["id"]
            self.assertEqual(created["order_type"], "dine_in")
            self.assertEqual(created["fulfillment_type"], "table_service")
            self.assertEqual(created["table_number"], table["table_number"])

            _, queue, _ = self._request("/api/v1/kds/orders", headers={"Cookie": kitchen_cookie})
            self.assertIn(order_id, [entry["id"] for entry in queue])
            _, manager_queue, _ = self._request("/api/v1/manager/orders", headers={"Cookie": manager_cookie})
            self.assertIn(order_id, [entry["id"] for entry in manager_queue])
            _, history, _ = self._request("/api/v1/orders", headers=customer_headers)
            self.assertIn(order_id, [entry["id"] for entry in history["items"]])
            for next_status in ("confirmed", "preparing", "ready"):
                status, updated, _ = self._request(f"/api/v1/kds/orders/{order_id}/status", method="PATCH", body={"status": next_status}, headers={"Cookie": kitchen_cookie})
                self.assertEqual(status, 200)
                self.assertEqual(updated["status"], next_status)

            _, customer_order, _ = self._request(f"/api/v1/orders/{order_id}", headers=customer_headers)
            self.assertEqual(customer_order["status"], "ready")
            self.assertEqual(customer_order["table_number"], table["table_number"])
            self.assertEqual(self._request(f"/api/v1/kds/orders/{order_id}/status", method="PATCH", body={"status": "completed"}, headers={"Cookie": kitchen_cookie})[0], 403)
            self.assertEqual(self._request(f"/api/v1/kds/orders/{order_id}/status", method="PATCH", body={"status": "completed"}, headers={"Cookie": manager_cookie})[0], 403)
            self.assertEqual(self._request(f"/api/v1/manager/orders/{order_id}/status", method="PATCH", body={"status": "completed"}, headers={"Cookie": kitchen_cookie})[0], 403)
            self.assertEqual(self._request(f"/api/v1/manager/orders/{order_id}/status", method="PATCH", body={"status": "completed"}, headers={"Cookie": manager_cookie})[0], 200)
            _, completed_queue, _ = self._request("/api/v1/kds/orders?status=completed", headers={"Cookie": kitchen_cookie})
            self.assertIn(order_id, [entry["id"] for entry in completed_queue])
        finally:
            if order_id is not None:
                self._delete_test_order(order_id)

    def test_takeout_order_persists_counter_pickup_and_reaches_completion(self):
        _, manager, manager_cookie = self._login(self.manager_email)
        _, kitchen, kitchen_cookie = self._login(self.kitchen_email)
        self.assertEqual(manager["role"], "manager")
        self.assertEqual(kitchen["role"], "kitchen_staff")

        customer_headers = {"Authorization": f"Bearer {self.customer_token}"}
        _, product, _ = self._request(f"/api/v1/products/{self.product_id}")
        _, payment_methods, _ = self._request("/api/v1/payment-methods")
        payload = {
            "items": [{"cart_line_id": "takeout-line", "product_id": self.product_id, "quantity": 1, "size": product["sizes"][0]["code"], "addons": []}],
            "payment_method_code": payment_methods[0]["code"],
            "order_type": "takeout",
            "fulfillment_type": "counter_pickup",
            "restaurant_table_id": None,
        }
        order_id = None
        try:
            created_status, created, _ = self._request("/api/v1/orders", method="POST", body=payload, headers={**customer_headers, "Idempotency-Key": uuid4().hex})
            self.assertEqual(created_status, 201)
            order_id = created["id"]
            self.assertEqual(created["order_type"], "takeout")
            self.assertEqual(created["fulfillment_type"], "counter_pickup")
            self.assertIsNone(created["table_number"])

            _, queue, _ = self._request("/api/v1/kds/orders", headers={"Cookie": kitchen_cookie})
            queued_order = next(entry for entry in queue if entry["id"] == order_id)
            self.assertEqual(queued_order["fulfillment_destination"], "Counter pickup")
            for next_status in ("confirmed", "preparing", "ready"):
                status, updated, _ = self._request(f"/api/v1/kds/orders/{order_id}/status", method="PATCH", body={"status": next_status}, headers={"Cookie": kitchen_cookie})
                self.assertEqual(status, 200)
                self.assertEqual(updated["status"], next_status)

            completed_status, completed, _ = self._request(f"/api/v1/manager/orders/{order_id}/status", method="PATCH", body={"status": "completed"}, headers={"Cookie": manager_cookie})
            self.assertEqual(completed_status, 200)
            self.assertEqual(completed["status"], "completed")
            _, customer_order, _ = self._request(f"/api/v1/orders/{order_id}", headers=customer_headers)
            self.assertEqual(customer_order["status"], "completed")
            self.assertEqual(customer_order["fulfillment_type"], "counter_pickup")
        finally:
            if order_id is not None:
                self._delete_test_order(order_id)

    def test_manager_menu_management_crud_and_rbac(self):
        _, manager, manager_cookie = self._login(self.manager_email)
        _, kitchen, kitchen_cookie = self._login(self.kitchen_email)

        # RBAC: Non-managers cannot access manager catalog endpoints
        self.assertEqual(self._request("/api/v1/categories/manage")[0], 401)
        self.assertEqual(self._request("/api/v1/categories/manage", headers={"Cookie": kitchen_cookie})[0], 403)
        self.assertEqual(self._request("/api/v1/products/manage", headers={"Cookie": kitchen_cookie})[0], 403)

        # Manager can list categories
        status, categories, _ = self._request("/api/v1/categories/manage", headers={"Cookie": manager_cookie})
        self.assertEqual(status, 200)
        self.assertIsInstance(categories, list)

        # Manager creates a new category
        cat_suffix = uuid4().hex[:6]
        cat_name = f"Specialties {cat_suffix}"
        status, created_cat, _ = self._request(
            "/api/v1/categories",
            method="POST",
            body={"name": cat_name, "description": "House specials", "display_order": 99},
            headers={"Cookie": manager_cookie},
        )
        self.assertEqual(status, 201)
        cat_id = created_cat["id"]

        try:
            # Manager creates a product in this category
            prod_name = f"Chef Special {cat_suffix}"
            status, created_prod, _ = self._request(
                "/api/v1/products",
                method="POST",
                body={
                    "category_id": cat_id,
                    "name": prod_name,
                    "description": "Signature chef recipe",
                    "price": "350.00",
                    "is_available": True,
                },
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 201)
            self.assertEqual(created_prod["name"], prod_name)
            self.assertEqual(len(created_prod["sizes"]), 1)
            self.assertEqual(created_prod["sizes"][0]["code"], "Regular")
            prod_id = created_prod["id"]

            try:
                # Deleting category with active product must fail with 409 Conflict
                del_cat_status, del_cat_err, _ = self._request(
                    f"/api/v1/categories/{cat_id}",
                    method="DELETE",
                    headers={"Cookie": manager_cookie},
                )
                self.assertEqual(del_cat_status, 409)

                # Manager updates product availability
                status, toggled, _ = self._request(
                    f"/api/v1/products/{prod_id}/availability",
                    method="PATCH",
                    body={"is_available": False},
                    headers={"Cookie": manager_cookie},
                )
                self.assertEqual(status, 200)
                self.assertFalse(toggled["is_available"])

                # Manager updates product price and description
                status, updated_prod, _ = self._request(
                    f"/api/v1/products/{prod_id}",
                    method="PUT",
                    body={"price": "380.00", "description": "Updated signature recipe"},
                    headers={"Cookie": manager_cookie},
                )
                self.assertEqual(status, 200)
                self.assertEqual(updated_prod["description"], "Updated signature recipe")

                # Manager soft-deletes the product
                status, del_resp, _ = self._request(
                    f"/api/v1/products/{prod_id}",
                    method="DELETE",
                    headers={"Cookie": manager_cookie},
                )
                self.assertEqual(status, 200)
            finally:
                pass

            # Now that product is deleted, category deletion succeeds
            status, del_cat_resp, _ = self._request(
                f"/api/v1/categories/{cat_id}",
                method="DELETE",
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 200)
        finally:
            # Clean up category directly if still present
            with SessionLocal() as db:
                from app.db.models.category import MenuCategory
                from app.db.models.product import MenuProduct
                db.query(MenuProduct).filter(MenuProduct.category_id == cat_id).delete(synchronize_session=False)
                db.query(MenuCategory).filter(MenuCategory.id == cat_id).delete(synchronize_session=False)
                db.commit()

    def test_manager_product_lifecycle_to_customer_order(self):
        _, manager, manager_cookie = self._login(self.manager_email)
        customer_headers = {"Authorization": f"Bearer {self.customer_token}"}
        suffix = uuid4().hex[:6]

        # 1. Manager creates a category
        cat_name = f"E2E Cat {suffix}"
        status, cat, _ = self._request(
            "/api/v1/categories",
            method="POST",
            body={"name": cat_name, "display_order": 50},
            headers={"Cookie": manager_cookie},
        )
        self.assertEqual(status, 201)
        cat_id = cat["id"]

        order_id = None
        prod_id = None
        try:
            # 2. Manager creates a product
            prod_name = f"E2E Dish {suffix}"
            status, prod, _ = self._request(
                "/api/v1/products",
                method="POST",
                body={
                    "category_id": cat_id,
                    "name": prod_name,
                    "price": "225.50",
                    "description": "Lifecycle test product",
                    "is_available": True,
                },
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 201)
            prod_id = prod["id"]

            # 3. Product has default "Regular" size
            self.assertTrue(len(prod["sizes"]) >= 1)
            self.assertEqual(prod["sizes"][0]["code"], "Regular")

            # 4. Customer-facing menu retrieves the product
            status, customer_prods, _ = self._request(f"/api/v1/products?category_id={cat_id}")
            self.assertEqual(status, 200)
            self.assertIn(prod_id, [p["id"] for p in customer_prods])

            # 5. Customer quotes the product
            status, quote, _ = self._request(
                "/api/v1/checkout/quote",
                method="POST",
                body={"items": [{"cart_line_id": f"quote-{suffix}", "product_id": prod_id, "quantity": 1, "size": "Regular", "addons": []}]},
                headers=customer_headers,
            )
            self.assertEqual(status, 200)
            self.assertEqual(float(quote["subtotal"]), 225.50)

            # 6. Customer places an order
            _, payment_methods, _ = self._request("/api/v1/payment-methods")
            status, order, _ = self._request(
                "/api/v1/orders",
                method="POST",
                body={
                    "items": [{"cart_line_id": f"order-{suffix}", "product_id": prod_id, "quantity": 1, "size": "Regular", "addons": []}],
                    "payment_method_code": payment_methods[0]["code"],
                    "order_type": "takeout",
                    "fulfillment_type": "counter_pickup",
                    "restaurant_table_id": None,
                },
                headers={**customer_headers, "Idempotency-Key": uuid4().hex},
            )
            self.assertEqual(status, 201)
            order_id = order["id"]
            self.assertEqual(len(order["items"]), 1)
            self.assertEqual(order["items"][0]["product_id"], prod_id)

            # 7. Manager marks the product unavailable
            status, toggled, _ = self._request(
                f"/api/v1/products/{prod_id}/availability",
                method="PATCH",
                body={"is_available": False},
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 200)
            self.assertFalse(toggled["is_available"])

            # 8. Customer catalog with availability=available omits it
            status, avail_prods, _ = self._request(f"/api/v1/products?category_id={cat_id}&availability=available")
            self.assertEqual(status, 200)
            self.assertNotIn(prod_id, [p["id"] for p in avail_prods])

            # 9. Subsequent checkout attempt for unavailable product is rejected
            status, err, _ = self._request(
                "/api/v1/orders",
                method="POST",
                body={
                    "items": [{"cart_line_id": f"fail-{suffix}", "product_id": prod_id, "quantity": 1, "size": "Regular", "addons": []}],
                    "payment_method_code": payment_methods[0]["code"],
                    "order_type": "takeout",
                    "fulfillment_type": "counter_pickup",
                    "restaurant_table_id": None,
                },
                headers={**customer_headers, "Idempotency-Key": uuid4().hex},
            )
            self.assertEqual(status, 422)
            self.assertIn("unavailable", str(err).lower())

            # 10. Existing order remains intact
            status, existing_order, _ = self._request(f"/api/v1/orders/{order_id}", headers=customer_headers)
            self.assertEqual(status, 200)
            self.assertEqual(existing_order["id"], order_id)

            # 11. Manager soft-deletes the product
            status, _, _ = self._request(
                f"/api/v1/products/{prod_id}",
                method="DELETE",
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 200)

            # 12. Historical order remains completely intact after product deletion
            status, existing_order_post_delete, _ = self._request(f"/api/v1/orders/{order_id}", headers=customer_headers)
            self.assertEqual(status, 200)
            self.assertEqual(existing_order_post_delete["items"][0]["name"], prod_name)

            # 13. Category deletion preserves integrity (safely deactivates)
            status, del_cat_resp, _ = self._request(
                f"/api/v1/categories/{cat_id}",
                method="DELETE",
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 200)

        finally:
            if order_id is not None:
                self._delete_test_order(order_id)
            with SessionLocal() as db:
                from app.db.models.category import MenuCategory
                from app.db.models.product import MenuProduct
                if prod_id:
                    db.query(MenuProduct).filter(MenuProduct.id == prod_id).delete(synchronize_session=False)
                db.query(MenuCategory).filter(MenuCategory.id == cat_id).delete(synchronize_session=False)
                db.commit()

    def test_manager_inventory_workflow_and_transaction_recording(self):
        _, manager, manager_cookie = self._login(self.manager_email)

        # 1. Fetch inventory items
        status, items, _ = self._request("/api/v1/inventory", headers={"Cookie": manager_cookie})
        self.assertEqual(status, 200)
        self.assertTrue(len(items) > 0)
        target_item = items[0]
        initial_stock = Decimal(str(target_item["current_stock"]))

        created_tx_ids = []
        try:
            # 2. Purchase (restock) increases stock
            status, tx_purchase, _ = self._request(
                f"/api/v1/inventory/{target_item['id']}/transactions",
                method="POST",
                body={"transaction_type": "purchase", "quantity_change": "15.00", "notes": "Bulk restock delivery"},
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 201)
            created_tx_ids.append(tx_purchase["id"])
            self.assertEqual(Decimal(str(tx_purchase["stock_after"])), initial_stock + Decimal("15.00"))

            # 3. Waste transaction reduces stock
            status, tx_waste, _ = self._request(
                f"/api/v1/inventory/{target_item['id']}/transactions",
                method="POST",
                body={"transaction_type": "waste", "quantity_change": "-3.00", "notes": "Expired packaging"},
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 201)
            created_tx_ids.append(tx_waste["id"])
            self.assertEqual(Decimal(str(tx_waste["stock_after"])), initial_stock + Decimal("12.00"))

            # 4. Waste with positive quantity must fail validation
            status, _, _ = self._request(
                f"/api/v1/inventory/{target_item['id']}/transactions",
                method="POST",
                body={"transaction_type": "waste", "quantity_change": "5.00", "notes": "Invalid positive waste"},
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 422)

            # 5. Over-reduction causing negative stock must fail
            status, _, _ = self._request(
                f"/api/v1/inventory/{target_item['id']}/transactions",
                method="POST",
                body={"transaction_type": "waste", "quantity_change": "-999999.00", "notes": "Impossible deduction"},
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 422)

            # 6. Verify transaction log listing
            status, tx_logs, _ = self._request(
                f"/api/v1/inventory/transactions?item_id={target_item['id']}",
                headers={"Cookie": manager_cookie},
            )
            self.assertEqual(status, 200)
            log_ids = [tx["id"] for tx in tx_logs]
            self.assertIn(tx_purchase["id"], log_ids)
            self.assertIn(tx_waste["id"], log_ids)

        finally:
            # Revert stock balance and clean up transactions
            with SessionLocal() as db:
                from app.db.models.inventory import InventoryItem, InventoryTransaction
                db.query(InventoryTransaction).filter(InventoryTransaction.id.in_(created_tx_ids or [-1])).delete(synchronize_session=False)
                item = db.get(InventoryItem, target_item["id"])
                if item:
                    item.current_stock = initial_stock
                db.commit()

    def test_customer_profile_and_saved_address_endpoints_and_isolation(self):
        customer1_headers = {"Authorization": f"Bearer {self.customer_token}"}
        suffix = uuid4().hex[:6]

        # 1. Update customer profile
        status, updated_profile, _ = self._request(
            "/api/v1/customers/me",
            method="PUT",
            body={"full_name": f"Customer {suffix}", "phone": "09171239999"},
            headers=customer1_headers,
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated_profile["full_name"], f"Customer {suffix}")
        self.assertEqual(updated_profile["phone"], "09171239999")

        # 2. Create second customer to test cross-customer isolation
        with SessionLocal() as db:
            cust2 = Customer(
                full_name=f"Other Customer {suffix}",
                email=f"other-{suffix}@example.com",
                phone=f"0918{suffix[:7]}",
            )
            db.add(cust2)
            db.commit()
            db.refresh(cust2)
            cust2_id = cust2.customer_id
            cust2_token = create_access_token(cust2_id, timedelta(minutes=10))

        customer2_headers = {"Authorization": f"Bearer {cust2_token}"}

        created_address_ids = []
        try:
            # 3. Customer 1 adds first address -> automatically becomes default
            status, addr1, _ = self._request(
                "/api/v1/customers/me/addresses",
                method="POST",
                body={
                    "label": "Home",
                    "recipient_name": f"Customer {suffix}",
                    "phone": "09171239999",
                    "street_address": "123 Greenbelt Drive",
                    "city": "Makati",
                    "is_default": False,
                },
                headers=customer1_headers,
            )
            self.assertEqual(status, 201)
            self.assertTrue(addr1["is_default"])
            addr1_id = addr1["id"]
            created_address_ids.append(addr1_id)

            # 4. Customer 1 adds second address as default
            status, addr2, _ = self._request(
                "/api/v1/customers/me/addresses",
                method="POST",
                body={
                    "label": "Office",
                    "recipient_name": f"Customer {suffix}",
                    "phone": "09171239999",
                    "street_address": "456 BGC High St",
                    "city": "Taguig",
                    "is_default": True,
                },
                headers=customer1_headers,
            )
            self.assertEqual(status, 201)
            self.assertTrue(addr2["is_default"])
            addr2_id = addr2["id"]
            created_address_ids.append(addr2_id)

            # 5. List addresses for Customer 1 -> default comes first
            status, addr_list, _ = self._request("/api/v1/customers/me/addresses", headers=customer1_headers)
            self.assertEqual(status, 200)
            self.assertEqual(len(addr_list), 2)
            self.assertEqual(addr_list[0]["id"], addr2_id)
            self.assertTrue(addr_list[0]["is_default"])
            self.assertFalse(addr_list[1]["is_default"])

            # 6. IDOR prevention: Customer 2 attempts to update, set default, or delete Customer 1's address
            self.assertEqual(
                self._request(f"/api/v1/customers/me/addresses/{addr1_id}", method="PUT", body={"label": "Hacked"}, headers=customer2_headers)[0],
                404,
            )
            self.assertEqual(
                self._request(f"/api/v1/customers/me/addresses/{addr1_id}/default", method="PATCH", headers=customer2_headers)[0],
                404,
            )
            self.assertEqual(
                self._request(f"/api/v1/customers/me/addresses/{addr1_id}", method="DELETE", headers=customer2_headers)[0],
                404,
            )

            # 7. Customer 1 sets addr1 back to default
            status, toggled, _ = self._request(
                f"/api/v1/customers/me/addresses/{addr1_id}/default",
                method="PATCH",
                headers=customer1_headers,
            )
            self.assertEqual(status, 200)
            self.assertTrue(toggled["is_default"])

            # 8. Customer 1 deletes addr1 -> addr2 promoted to default
            status, _, _ = self._request(
                f"/api/v1/customers/me/addresses/{addr1_id}",
                method="DELETE",
                headers=customer1_headers,
            )
            self.assertEqual(status, 200)
            created_address_ids.remove(addr1_id)

            status, remaining_list, _ = self._request("/api/v1/customers/me/addresses", headers=customer1_headers)
            self.assertEqual(status, 200)
            self.assertEqual(len(remaining_list), 1)
            self.assertEqual(remaining_list[0]["id"], addr2_id)
            self.assertTrue(remaining_list[0]["is_default"])

        finally:
            with SessionLocal() as db:
                from app.db.models.address import CustomerAddress
                db.query(CustomerAddress).filter(CustomerAddress.id.in_(created_address_ids or [-1])).delete(synchronize_session=False)
                db.query(Customer).filter(Customer.customer_id == cust2_id).delete(synchronize_session=False)
                db.commit()

