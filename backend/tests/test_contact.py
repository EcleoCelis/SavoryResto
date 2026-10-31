from unittest import TestCase

from fastapi import HTTPException

from app.api.routes.contact import _check_ip_rate_limit, _contact_rate_limits
from app.main import app
from app.schemas.contact import ContactInquiryRequest
from app.services.email_service import email_service


class ContactInquiryUnitTests(TestCase):
    def setUp(self):
        email_service.clear_outbox()
        _contact_rate_limits.clear()

    def tearDown(self):
        email_service.clear_outbox()
        _contact_rate_limits.clear()

    def test_schema_sanitizes_crlf_headers(self):
        req = ContactInquiryRequest(
            name="Maria Santos\r\nBcc: evil@attacker.com",
            email="maria@example.com",
            subject="Special Dietary Inquiry\r\nInjected-Header: 123",
            message="Do you have gluten-free or peanut-free options on the menu?",
        )
        self.assertNotIn("\r", req.name)
        self.assertNotIn("\n", req.name)
        self.assertNotIn("\r", req.subject)
        self.assertNotIn("\n", req.subject)
        self.assertIn("Maria Santos", req.name)
        self.assertIn("Special Dietary Inquiry", req.subject)

    def test_send_contact_inquiry_records_to_email_outbox(self):
        success = email_service.send_contact_inquiry_email(
            sender_name="Juan Dela Cruz",
            sender_email="juan@example.com",
            subject="Table Reservation Question",
            message="Hi, do we need to reserve a table ahead of time for a party of 6?",
        )
        self.assertTrue(success)
        self.assertEqual(len(email_service.outbox), 1)
        record = email_service.outbox[0]
        self.assertIn("Table Reservation Question", record.subject)
        self.assertIn("Juan Dela Cruz", record.text_body)
        self.assertIn("party of 6", record.text_body)

    def test_ip_rate_limiting_enforcement(self):
        test_ip = "192.168.10.50"
        for _ in range(5):
            _check_ip_rate_limit(test_ip)

        # 6th attempt within window must raise 429
        with self.assertRaises(HTTPException) as ctx:
            _check_ip_rate_limit(test_ip)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("several messages recently", ctx.exception.detail)
