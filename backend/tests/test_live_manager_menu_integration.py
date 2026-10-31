import json
import unittest
import urllib.error
import urllib.request
import uuid

API_BASE = "http://127.0.0.1:8001/api/v1"

class TestLiveManagerMenuIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Login as manager
        req = urllib.request.Request(
            f"{API_BASE}/staff/auth/login",
            data=json.dumps({
                "email": "manager@savorybites.staging",
                "password": "StagingManagerPass2026!",
                "remember_me": False,
                "requested_role": "manager",
            }).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            res = urllib.request.urlopen(req)
        except urllib.error.URLError as e:
            raise unittest.SkipTest(f"Live server not running at {API_BASE}: {e}")
        body = json.loads(res.read().decode())
        cls.manager_token = body.get("access_token")
        cls.manager_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cls.manager_token}",
        }

        # 2. Login as kitchen staff to test RBAC
        req_kds = urllib.request.Request(
            f"{API_BASE}/staff/auth/login",
            data=json.dumps({
                "email": "kitchen@savorybites.staging",
                "password": "StagingKitchenPass2026!",
                "remember_me": False,
                "requested_role": "kitchen_staff",
            }).encode(),
            headers={"Content-Type": "application/json"},
        )
        res_kds = urllib.request.urlopen(req_kds)
        body_kds = json.loads(res_kds.read().decode())
        cls.kds_token = body_kds.get("access_token")
        cls.kds_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cls.kds_token}",
        }

    def test_01_manager_can_read_categories_and_products(self):
        req_cats = urllib.request.Request(
            f"{API_BASE}/categories/manage",
            headers=self.manager_headers,
        )
        with urllib.request.urlopen(req_cats) as res:
            self.assertEqual(res.status, 200)
            cats = json.loads(res.read().decode())
            self.assertIsInstance(cats, list)
            self.assertGreaterEqual(len(cats), 1)

        req_prods = urllib.request.Request(
            f"{API_BASE}/products/manage",
            headers=self.manager_headers,
        )
        with urllib.request.urlopen(req_prods) as res:
            self.assertEqual(res.status, 200)
            prods = json.loads(res.read().decode())
            self.assertIsInstance(prods, list)
            self.assertGreaterEqual(len(prods), 1)

    def test_02_kds_staff_cannot_access_manager_catalog(self):
        req = urllib.request.Request(
            f"{API_BASE}/categories/manage",
            headers=self.kds_headers,
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)

    def test_03_unauthenticated_cannot_access_manager_catalog(self):
        req = urllib.request.Request(
            f"{API_BASE}/categories/manage",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_04_full_category_and_product_crud_lifecycle(self):
        # A. Create Category with unique name
        cat_name = f"Test Starters {uuid.uuid4().hex[:8]}"
        create_cat_payload = {
            "name": cat_name,
            "description": "Seasonal starters test category",
            "display_order": 99,
        }
        req_create_cat = urllib.request.Request(
            f"{API_BASE}/categories",
            data=json.dumps(create_cat_payload).encode(),
            headers=self.manager_headers,
        )
        with urllib.request.urlopen(req_create_cat) as res:
            self.assertEqual(res.status, 201)
            created_cat = json.loads(res.read().decode())
            cat_id = created_cat["id"]
            self.assertEqual(created_cat["name"], cat_name)

        try:
            # B. Create Product in that Category
            create_prod_payload = {
                "name": "Crispy Spring Wontons",
                "category_id": cat_id,
                "price": 9.50,
                "description": "Freshly fried wontons with sweet chili sauce",
                "is_available": True,
            }
            req_create_prod = urllib.request.Request(
                f"{API_BASE}/products",
                data=json.dumps(create_prod_payload).encode(),
                headers=self.manager_headers,
            )
            with urllib.request.urlopen(req_create_prod) as res:
                self.assertEqual(res.status, 201)
                created_prod = json.loads(res.read().decode())
                prod_id = created_prod["id"]
                self.assertEqual(created_prod["name"], "Crispy Spring Wontons")
                self.assertEqual(float(created_prod["price"]), 9.50)

            # C. Update Product details
            update_prod_payload = {
                "name": "Golden Spring Wontons",
                "price": 10.25,
            }
            req_update_prod = urllib.request.Request(
                f"{API_BASE}/products/{prod_id}",
                data=json.dumps(update_prod_payload).encode(),
                headers=self.manager_headers,
                method="PUT",
            )
            with urllib.request.urlopen(req_update_prod) as res:
                self.assertEqual(res.status, 200)
                updated_prod = json.loads(res.read().decode())
                self.assertEqual(updated_prod["name"], "Golden Spring Wontons")
                self.assertEqual(float(updated_prod["price"]), 10.25)

            # D. Toggle Availability (Sales Status)
            req_toggle = urllib.request.Request(
                f"{API_BASE}/products/{prod_id}/availability",
                data=json.dumps({"is_available": False}).encode(),
                headers=self.manager_headers,
                method="PATCH",
            )
            with urllib.request.urlopen(req_toggle) as res:
                self.assertEqual(res.status, 200)
                toggled_prod = json.loads(res.read().decode())
                self.assertFalse(toggled_prod["is_available"])

            # E. Verify Safe Category Deletion Prevention (Category has active dish)
            req_del_cat_blocked = urllib.request.Request(
                f"{API_BASE}/categories/{cat_id}",
                headers=self.manager_headers,
                method="DELETE",
            )
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req_del_cat_blocked)
            self.assertEqual(ctx.exception.code, 409)

            # F. Delete Product (Soft delete / archival)
            req_del_prod = urllib.request.Request(
                f"{API_BASE}/products/{prod_id}",
                headers=self.manager_headers,
                method="DELETE",
            )
            with urllib.request.urlopen(req_del_prod) as res:
                self.assertEqual(res.status, 200)

        finally:
            # G. Clean up category
            req_del_cat = urllib.request.Request(
                f"{API_BASE}/categories/{cat_id}",
                headers=self.manager_headers,
                method="DELETE",
            )
            try:
                with urllib.request.urlopen(req_del_cat) as res:
                    self.assertEqual(res.status, 200)
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
