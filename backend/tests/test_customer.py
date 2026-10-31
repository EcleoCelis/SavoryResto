from datetime import datetime, timezone
from unittest import TestCase

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models.address import CustomerAddress
from app.db.models.customer import Customer
from app.schemas.customer import (
    AddressCreateRequest,
    AddressUpdateRequest,
    CustomerProfileUpdateRequest,
)
from app.services.customer_service import (
    create_customer_address,
    delete_customer_address,
    get_customer_address,
    list_customer_addresses,
    set_default_address,
    update_customer_address,
    update_customer_profile,
)


class CustomerServiceTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.db = sessionmaker(bind=self.engine)()
        Base.metadata.create_all(self.engine)
        now = datetime.now(timezone.utc)

        self.customer1 = Customer(
            customer_id=1,
            full_name="Maria Santos",
            email="maria@example.com",
            phone="09171112233",
            address=None,
            password_hash="test_hash",
            created_at=now,
        )
        self.customer2 = Customer(
            customer_id=2,
            full_name="Juan Dela Cruz",
            email="juan@example.com",
            phone="09182223344",
            address=None,
            password_hash="test_hash",
            created_at=now,
        )
        self.db.add_all([self.customer1, self.customer2])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_customer_profile_update_success_and_validation(self):
        updated = update_customer_profile(
            self.db,
            self.customer1,
            CustomerProfileUpdateRequest(full_name="Maria S. Santos", phone="09193334455"),
        )
        self.assertEqual(updated.full_name, "Maria S. Santos")
        self.assertEqual(updated.phone, "09193334455")

        # Duplicate phone check
        with self.assertRaisesRegex(ValueError, "already exists"):
            update_customer_profile(
                self.db,
                self.customer1,
                CustomerProfileUpdateRequest(full_name="Maria S. Santos", phone="09182223344"),
            )

    def test_saved_address_lifecycle_and_default_handling(self):
        # 1. First address automatically becomes default
        addr1 = create_customer_address(
            self.db,
            self.customer1.customer_id,
            AddressCreateRequest(
                label="Home",
                recipient_name="Maria Santos",
                phone="09171112233",
                street_address="123 Acacia St",
                city="Makati",
                is_default=False,
            ),
        )
        self.assertTrue(addr1.is_default)
        self.assertEqual(self.customer1.address, "123 Acacia St, Makati")

        # 2. Second address added as non-default
        addr2 = create_customer_address(
            self.db,
            self.customer1.customer_id,
            AddressCreateRequest(
                label="Office",
                recipient_name="Maria Santos",
                phone="09171112233",
                street_address="456 Ayala Ave",
                city="Makati",
                is_default=False,
            ),
        )
        self.assertFalse(addr2.is_default)
        self.assertTrue(self.db.get(CustomerAddress, addr1.id).is_default)

        # 3. Third address added as default -> demotes addr1
        addr3 = create_customer_address(
            self.db,
            self.customer1.customer_id,
            AddressCreateRequest(
                label="Condo",
                recipient_name="Maria Santos",
                phone="09171112233",
                street_address="789 BGC",
                city="Taguig",
                is_default=True,
            ),
        )
        self.assertTrue(addr3.is_default)
        self.assertFalse(self.db.get(CustomerAddress, addr1.id).is_default)
        self.assertFalse(self.db.get(CustomerAddress, addr2.id).is_default)
        self.assertEqual(self.customer1.address, "789 BGC, Taguig")

        # 4. Set addr2 as default explicitly
        set_default_address(self.db, self.customer1.customer_id, addr2.id)
        self.assertTrue(self.db.get(CustomerAddress, addr2.id).is_default)
        self.assertFalse(self.db.get(CustomerAddress, addr3.id).is_default)

        # 5. Delete default address -> another address promoted to default
        delete_customer_address(self.db, self.customer1.customer_id, addr2.id)
        remaining = list_customer_addresses(self.db, self.customer1.customer_id)
        self.assertEqual(len(remaining), 2)
        defaults = [a for a in remaining if a.is_default]
        self.assertEqual(len(defaults), 1)

    def test_cross_customer_address_isolation(self):
        addr1 = create_customer_address(
            self.db,
            self.customer1.customer_id,
            AddressCreateRequest(
                label="Home",
                recipient_name="Maria Santos",
                phone="09171112233",
                street_address="123 Acacia St",
                city="Makati",
            ),
        )

        # Customer 2 cannot access Customer 1's address
        self.assertIsNone(get_customer_address(self.db, self.customer2.customer_id, addr1.id))
        self.assertIsNone(
            update_customer_address(
                self.db,
                self.customer2.customer_id,
                addr1.id,
                AddressUpdateRequest(label="Hacked Home"),
            )
        )
        self.assertIsNone(set_default_address(self.db, self.customer2.customer_id, addr1.id))
        self.assertFalse(delete_customer_address(self.db, self.customer2.customer_id, addr1.id))

        # Customer 1's address remains intact
        intact = get_customer_address(self.db, self.customer1.customer_id, addr1.id)
        self.assertIsNotNone(intact)
        self.assertEqual(intact.label, "Home")
