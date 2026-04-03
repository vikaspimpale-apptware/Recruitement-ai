"""SendGrid email delivery service."""
from datetime import datetime, timezone
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.outreach import OutreachEmail
from app.models.candidate import Candidate
from sqlalchemy import select


class EmailService:
    @staticmethod
    async def send_bulk(email_ids: list[int]):
        """Send a batch of approved emails via SendGrid."""
        if not settings.SENDGRID_API_KEY:
            print("[EmailService] No SendGrid key — simulating sends")
            await EmailService._simulate_sends(email_ids)
            return

        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail

        sg = SendGridAPIClient(settings.SENDGRID_API_KEY)

        async with AsyncSessionLocal() as db:
            for email_id in email_ids:
                result = await db.execute(
                    select(OutreachEmail).where(OutreachEmail.id == email_id)
                )
                email = result.scalar_one_or_none()
                if not email or email.status != "approved":
                    continue

                cand_result = await db.execute(
                    select(Candidate).where(Candidate.id == email.candidate_id)
                )
                candidate = cand_result.scalar_one_or_none()
                if not candidate or not candidate.email:
                    print(f"[EmailService] No email for candidate {email.candidate_id} — skipping")
                    email.status = "bounced"
                    email.reply_body = "Skipped: candidate email missing"
                    email.sent_at = datetime.now(timezone.utc)
                    await db.commit()
                    continue

                message = Mail(
                    from_email=settings.SENDGRID_FROM_EMAIL,
                    to_emails=candidate.email,
                    subject=email.subject,
                    plain_text_content=email.body,
                )

                try:
                    response = sg.send(message)
                    email.status = "sent"
                    email.sent_at = datetime.now(timezone.utc)
                    if hasattr(response, 'headers') and 'X-Message-Id' in response.headers:
                        email.sendgrid_message_id = response.headers['X-Message-Id']
                    await db.commit()
                except Exception as e:
                    print(f"[EmailService] Send failed for email {email_id}: {e}")
                    email.status = "bounced"
                    email.reply_body = f"Send failed: {str(e)[:500]}"
                    email.sent_at = datetime.now(timezone.utc)
                    await db.commit()

    @staticmethod
    async def _simulate_sends(email_ids: list[int]):
        """Simulate sending emails in development mode."""
        async with AsyncSessionLocal() as db:
            for email_id in email_ids:
                result = await db.execute(
                    select(OutreachEmail).where(OutreachEmail.id == email_id)
                )
                email = result.scalar_one_or_none()
                if email:
                    email.status = "sent"
                    email.sent_at = datetime.now(timezone.utc)
            await db.commit()
        print(f"[EmailService] Simulated sending {len(email_ids)} emails")
