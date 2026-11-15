import html
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailMessageRecord:
    def __init__(
        self,
        to_email: str,
        subject: str,
        text_body: str,
        html_body: str,
        reset_url: str = "",
    ):
        self.to_email = to_email
        self.subject = subject
        self.text_body = text_body
        self.html_body = html_body
        self.reset_url = reset_url


class EmailService:
    def __init__(self) -> None:
        # In-memory record of dispatched emails during testing/dev
        self.outbox: list[EmailMessageRecord] = []

    def clear_outbox(self) -> None:
        self.outbox.clear()

    def send_password_reset_email(
        self,
        to_email: str,
        recipient_name: str,
        raw_token: str,
    ) -> bool:
        """Construct and send password reset email via SMTP or dev test transport.

        The reset link is constructed strictly from the configured trusted
        FRONTEND_URL setting to prevent host header injection.
        """
        base_url = settings.FRONTEND_URL.rstrip("/")
        reset_url = f"{base_url}/reset-password?token={raw_token}"
        expire_minutes = settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES

        subject = "Reset your SavoryBites account password"

        first_name = recipient_name.split()[0] if recipient_name else "Valued Customer"

        text_body = (
            f"Hello {first_name},\n\n"
            f"We received a request to reset the password for your SavoryBites account.\n\n"
            f"To set a new password, visit the following link:\n"
            f"{reset_url}\n\n"
            f"This link will expire in {expire_minutes} minutes and can only be used once.\n\n"
            f"If you did not request this password reset, you can safely ignore this email. "
            f"Your account remains secure.\n\n"
            f"— The SavoryBites Team\n"
        )

        safe_first_name = html.escape(first_name)
        safe_reset_url = html.escape(reset_url, quote=True)
        html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{html.escape(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f4ec; margin: 0; padding: 32px 16px; color: #1c1c1c;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e0d6; overflow: hidden; box-shadow: 0 4px 18px rgba(23,63,53,0.06);">
    <tr>
      <td style="background-color: #173f35; padding: 24px 32px; text-align: left;">
        <span style="display: inline-block; color: #c49a4a; font-family: Georgia, serif; font-size: 22px; font-weight: bold; letter-spacing: 0.04em;">SavoryBites</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h2 style="font-family: Georgia, serif; font-size: 24px; color: #173f35; margin: 0 0 16px;">Password Reset Request</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4a4a44; margin: 0 0 20px;">
          Hello {safe_first_name},
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4a4a44; margin: 0 0 24px;">
          We received a request to reset the password for your SavoryBites account. Click the button below to choose a new password:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="{safe_reset_url}" style="background-color: #173f35; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">
            Reset Your Password
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.6; color: #6b6b63; margin: 24px 0 12px;">
          If the button above does not work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 12px; line-height: 1.5; color: #173f35; word-break: break-all; margin: 0 0 24px;">
          <a href="{safe_reset_url}" style="color: #2e6b5b;">{safe_reset_url}</a>
        </p>
        <p style="font-size: 13px; line-height: 1.6; color: #888880; border-top: 1px solid #eee; padding-top: 20px; margin: 0;">
          This link will expire in <strong>{expire_minutes} minutes</strong> and can only be used once.<br>
          If you did not request a password reset, you can safely ignore this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #f5f2eb; padding: 16px 32px; font-size: 12px; color: #8b8b82; text-align: center;">
        &copy; SavoryBites Restaurant. Freshly made. Simply delicious.
      </td>
    </tr>
  </table>
</body>
</html>"""

        # Record into outbox for audit / test verification
        record = EmailMessageRecord(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            reset_url=reset_url,
        )
        self.outbox.append(record)

        if not settings.SMTP_HOST:
            logger.info(
                "SMTP not configured. Mock delivery to %s for password reset (link generated).",
                to_email,
            )
            return True

        # Send via real SMTP server
        return self._send_smtp_message(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)

    def send_contact_inquiry_email(
        self,
        sender_name: str,
        sender_email: str,
        subject: str,
        message: str,
    ) -> bool:
        """Forward a validated customer contact inquiry to the restaurant email."""
        clean_name = sender_name.strip()
        clean_email = sender_email.strip()
        clean_subject = f"[SavoryBites Contact Inquiry] {subject.strip()}"
        to_email = settings.EMAILS_FROM_EMAIL

        text_body = (
            f"New customer inquiry submitted through website:\n\n"
            f"Sender Name: {clean_name}\n"
            f"Sender Email: {clean_email}\n"
            f"Subject: {subject.strip()}\n\n"
            f"Message Content:\n"
            f"----------------------------------------\n"
            f"{message.strip()}\n"
            f"----------------------------------------\n\n"
            f"— SavoryBites Automated Contact Service\n"
        )

        html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{html.escape(clean_subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f4ec; margin: 0; padding: 32px 16px; color: #1c1c1c;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e0d6; overflow: hidden; box-shadow: 0 4px 18px rgba(23,63,53,0.06);">
    <tr>
      <td style="background-color: #173f35; padding: 20px 32px; text-align: left;">
        <span style="display: inline-block; color: #c49a4a; font-family: Georgia, serif; font-size: 20px; font-weight: bold;">SavoryBites · Contact Inquiry</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h3 style="margin-top: 0; color: #173f35;">Customer Message Received</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #6b6b63; width: 120px;"><strong>From:</strong></td>
            <td style="padding: 8px 0; color: #1c1c1c;">{html.escape(clean_name)} ({html.escape(clean_email)})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b6b63;"><strong>Subject:</strong></td>
            <td style="padding: 8px 0; color: #1c1c1c;">{html.escape(subject.strip())}</td>
          </tr>
        </table>
        <div style="background-color: #fbf9f4; border: 1px solid #e5e0d6; border-radius: 8px; padding: 18px 20px; font-size: 14px; line-height: 1.6; color: #2e3b33; white-space: pre-wrap;">
{html.escape(message.strip())}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>"""

        record = EmailMessageRecord(
            to_email=to_email,
            subject=clean_subject,
            text_body=text_body,
            html_body=html_body,
        )
        self.outbox.append(record)

        if not settings.SMTP_HOST:
            logger.info(
                "SMTP not configured. Mock delivery of contact inquiry from %s (%s).",
                clean_name,
                clean_email,
            )
            return True

        return self._send_smtp_message(
            to_email=to_email,
            subject=clean_subject,
            text_body=text_body,
            html_body=html_body,
            reply_to=clean_email,
        )

    def send_order_confirmation_email(
        self,
        to_email: str,
        customer_name: str,
        order_number: str,
        total_formatted: str,
        fulfillment_summary: str,
    ) -> bool:
        """Send an order confirmation email when customer email updates are enabled."""
        first_name = customer_name.split()[0] if customer_name else "Valued Customer"
        subject = f"SavoryBites Order Confirmation #{order_number}"
        text_body = (
            f"Hello {first_name},\n\n"
            f"Thank you for your SavoryBites order #{order_number}.\n"
            f"Service: {fulfillment_summary}\n"
            f"Total: {total_formatted}\n\n"
            f"You can follow live kitchen status updates anytime in your SavoryBites account.\n\n"
            f"— The SavoryBites Team\n"
        )
        html_body = (
            f"<p>Hello {html.escape(first_name)},</p>"
            f"<p>Thank you for your SavoryBites order <strong>#{html.escape(order_number)}</strong>.</p>"
            f"<p><strong>Service:</strong> {html.escape(fulfillment_summary)}<br>"
            f"<strong>Total:</strong> {html.escape(total_formatted)}</p>"
            f"<p>You can follow live kitchen updates in your SavoryBites order history.</p>"
        )
        self.outbox.append(EmailMessageRecord(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body))
        if not settings.SMTP_HOST:
            logger.info("SMTP not configured. Mock order confirmation email logged for order %s.", order_number)
            return True
        return self._send_smtp_message(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)

    def send_security_alert_email(
        self,
        to_email: str,
        customer_name: str,
        event_summary: str,
    ) -> bool:
        """Send a security notice when customer password, email, or account status changes."""
        first_name = customer_name.split()[0] if customer_name else "Valued Customer"
        subject = "SavoryBites Security Notification"
        text_body = (
            f"Hello {first_name},\n\n"
            f"This is a security notification regarding your SavoryBites account:\n"
            f"{event_summary}\n\n"
            f"If you did not perform this change, please contact us or reset your password immediately.\n\n"
            f"— SavoryBites Security\n"
        )
        html_body = (
            f"<p>Hello {html.escape(first_name)},</p>"
            f"<p>Security notice for your SavoryBites account:</p>"
            f"<p><strong>{html.escape(event_summary)}</strong></p>"
            f"<p>If you did not authorize this change, please reset your password immediately.</p>"
        )
        self.outbox.append(EmailMessageRecord(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body))
        if not settings.SMTP_HOST:
            logger.info("SMTP not configured. Mock security alert email logged for %s.", to_email)
            return True
        return self._send_smtp_message(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)

    def _send_smtp_message(
        self,
        to_email: str,
        subject: str,
        text_body: str,
        html_body: str,
        reply_to: str | None = None,
    ) -> bool:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.EMAILS_FROM_NAME} <{settings.EMAILS_FROM_EMAIL}>"
        msg["To"] = to_email
        if reply_to:
            msg["Reply-To"] = reply_to

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        try:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                if settings.SMTP_TLS:
                    server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
            logger.info("Email '%s' sent successfully to %s via SMTP.", subject, to_email)
            return True
        except Exception as exc:
            logger.error("Failed to deliver email '%s' to %s: %s", subject, to_email, exc)
            return False


email_service = EmailService()
