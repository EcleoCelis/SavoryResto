import json
import socket
import subprocess
import sys
import time
from uuid import uuid4
from datetime import timedelta
from pathlib import Path
from unittest import TestCase
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from sqlalchemy import select

from app.core.security import create_access_token
from app.core.order_status import OrderStatus, transition_order_status
from app.db.database import SessionLocal
from app.db.models.customer import Customer
from app.db.models.product import MenuProduct
from app.db.models.order import Order, OrderItem


class CheckoutApiIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]

        with SessionLocal() as db:
            customer = db.scalars(select(Customer).order_by(Customer.customer_id)).first()
            product = db.scalars(select(MenuProduct).where(MenuProduct.is_available.is_(True)).order_by(MenuProduct.id)).first()
            if customer is None or product is None:
                raise RuntimeError("The integration database requires a customer and an available product.")
            cls.token = create_access_token(customer.customer_id, timedelta(minutes=5))
            cls.product_id = product.id

        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
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

    @classmethod
    def _request(cls, path, method="GET", token=None, body=None, headers=None):
        headers = dict(headers or {})
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(
            f"http://127.0.0.1:{cls.port}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_authenticated_customer_can_receive_an_authoritative_quote(self):
        status, payment_methods = self._request("/api/v1/payment-methods")
        self.assertEqual(status, 200)
        self.assertGreater(len(payment_methods), 0)
        self.assertTrue(all(method["code"] and method["label"] for method in payment_methods))
        self.assertTrue(all("is_active" not in method for method in payment_methods))
        self.__class__.payment_method_code = payment_methods[0]["code"]

        status, product = self._request(f"/api/v1/products/{self.product_id}")
        self.assertEqual(status, 200)
        self.assertEqual(product["sizes"], [
            {"code": "Regular", "label": "Regular", "price_adjustment": "0.00"},
            {"code": "Large", "label": "Large", "price_adjustment": "40.00"},
        ])
        self.assertEqual(product["addons"], [
            {"code": "Extra cheese", "label": "Extra cheese", "price_adjustment": "30.00"},
            {"code": "Extra sauce", "label": "Extra sauce", "price_adjustment": "15.00"},
        ])

        status, customer = self._request("/api/v1/auth/me", token=self.token)
        self.assertEqual(status, 200)
        self.assertIn("customer_id", customer)
        self.assertNotIn("password_hash", customer)

        status, quote = self._request(
            "/api/v1/checkout/quote",
            method="POST",
            token=self.token,
            body={"items": [{
                "cart_line_id": "quote-line",
                "product_id": self.product_id,
                "quantity": 2,
                "size": "Large",
                "addons": ["Extra cheese", "Extra sauce"],
            }]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(quote["items"][0]["unit_price"], "205.00")
        self.assertEqual(quote["total"], "410.00")

    def test_catalog_search_and_filter_query_parameters(self):
        status, products = self._request("/api/v1/products?search=burger&availability=available")
        self.assertEqual(status, 200)
        self.assertGreater(len(products), 0)
        self.assertTrue(all("burger" in product["name"].lower() or "burger" in (product["description"] or "").lower() or "burger" in product["category"]["name"].lower() for product in products))

        category_id = products[0]["category_id"]
        status, category_products = self._request(f"/api/v1/products?category_id={category_id}&availability=available")
        self.assertEqual(status, 200)
        self.assertTrue(all(product["category_id"] == category_id for product in category_products))
        self.assertEqual(self._request("/api/v1/products?availability=invalid")[0], 422)

    def test_quote_rejects_missing_authentication_and_invalid_options(self):
        payload = {"items": [{"cart_line_id": "line", "product_id": self.product_id, "quantity": 1, "size": "Regular", "addons": []}]}
        self.assertEqual(self._request("/api/v1/checkout/quote", method="POST", body=payload)[0], 401)
        self.assertEqual(self._request("/api/v1/orders")[0], 401)
        self.assertEqual(self._request("/api/v1/orders/999999", token=self.token)[0], 404)

        order_payload = {"items": payload["items"], "payment_method_code": "unknown_method"}
        self.assertEqual(self._request("/api/v1/orders", method="POST", token=self.token, body=order_payload, headers={"Idempotency-Key": str(uuid4())})[0], 422)

        payload["items"][0]["addons"] = ["Unknown option"]
        self.assertEqual(self._request("/api/v1/checkout/quote", method="POST", token=self.token, body=payload)[0], 422)

    def test_place_order_persists_authoritative_snapshot_and_is_idempotent(self):
        idempotency_key = str(uuid4())
        status, payment_methods = self._request("/api/v1/payment-methods")
        self.assertEqual(status, 200)
        payload = {"items": [{
            "cart_line_id": "order-line",
            "product_id": self.product_id,
            "quantity": 2,
            "size": "Large",
            "addons": ["Extra cheese", "Extra sauce"],
        }], "payment_method_code": payment_methods[0]["code"], "order_type": "takeout", "fulfillment_type": "counter_pickup", "total": "0.01"}
        try:
            status, order = self._request(
                "/api/v1/orders",
                method="POST",
                token=self.token,
                body=payload,
                headers={"Idempotency-Key": idempotency_key},
            )
            self.assertEqual(status, 201)
            self.assertEqual(order["status"], "pending")
            self.assertEqual(order["total"], "410.00")
            self.assertEqual(order["payment_method"]["code"], payment_methods[0]["code"])

            duplicate_status, duplicate = self._request(
                "/api/v1/orders",
                method="POST",
                token=self.token,
                body=payload,
                headers={"Idempotency-Key": idempotency_key},
            )
            self.assertEqual(duplicate_status, 200)
            self.assertEqual(duplicate["id"], order["id"])

            history_status, history = self._request("/api/v1/orders", token=self.token)
            self.assertEqual(history_status, 200)
            self.assertIn(order["id"], [history_item["id"] for history_item in history["items"]])

            with SessionLocal() as db:
                persisted = db.get(Order, order["id"])
                self.assertEqual(persisted.customer_id, order["customer_id"])
                self.assertIsNone(persisted.created_by)
                self.assertIsNotNone(persisted.payment_method_id)
                transition_order_status(persisted, OrderStatus.CONFIRMED)
                db.commit()
                item = db.scalars(select(OrderItem).where(OrderItem.order_id == persisted.id)).one()
                self.assertEqual(item.product_name, "Classic Burger")
                self.assertEqual(item.size_code, "Large")
            self.assertEqual(item.selected_addons, ["Extra cheese", "Extra sauce"])
            self.assertEqual(item.line_total, 410)

            status_detail, status_order = self._request(f"/api/v1/orders/{order['id']}", token=self.token)
            self.assertEqual(status_detail, 200)
            self.assertEqual(status_order["status"], "confirmed")

            self.assertEqual(self._request(f"/api/v1/orders/{order['id']}", token="invalid")[0], 401)
            with SessionLocal() as db:
                other_customer = db.scalars(select(Customer).where(Customer.customer_id != order["customer_id"]).order_by(Customer.customer_id)).first()
                other_token = create_access_token(other_customer.customer_id, timedelta(minutes=5))
            self.assertEqual(self._request(f"/api/v1/orders/{order['id']}", token=other_token)[0], 404)
            self.assertEqual(self._request(f"/api/v1/orders/{order['id']}/cancel", method="PATCH", token=other_token, body={"reason": "Not mine"})[0], 404)
            self.assertEqual(self._request(f"/api/v1/orders/{order['id']}/cancel", method="PATCH", body={})[0], 401)

            cancel_status, cancelled = self._request(f"/api/v1/orders/{order['id']}/cancel", method="PATCH", token=self.token, body={"reason": "Customer request"})
            self.assertEqual(cancel_status, 200)
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(cancelled["cancellation_reason"], "Customer request")
            self.assertIsNotNone(cancelled["cancelled_at"])
            self.assertFalse(cancelled["is_cancellable"])
            self.assertEqual(self._request(f"/api/v1/orders/{order['id']}/cancel", method="PATCH", token=self.token, body={})[0], 422)

            status_detail, status_order = self._request(f"/api/v1/orders/{order['id']}", token=self.token)
            self.assertEqual(status_detail, 200)
            self.assertEqual(status_order["status"], "cancelled")
            other_history_status, other_history = self._request("/api/v1/orders", token=other_token)
            self.assertEqual(other_history_status, 200)
            self.assertNotIn(order["id"], [history_item["id"] for history_item in other_history["items"]])
        finally:
            with SessionLocal() as db:
                order_id = locals().get("order", {}).get("id")
                if order_id is not None:
                    db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
                    db.query(Order).filter(Order.id == order_id).delete()
                    db.commit()
