from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.outreach import OutreachEmail
from app.models.candidate import Candidate
from app.models.workflow import WorkflowRun, Workflow
from app.schemas.outreach import (
    OutreachEmailResponse,
    EmailUpdateRequest,
    RegenerateEmailRequest,
    BulkSendRequest,
)
from app.services.email_service import EmailService
from datetime import datetime, timezone
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/outreach", tags=["outreach"])


@router.get("/run/{run_id}", response_model=list[OutreachEmailResponse])
async def list_emails_for_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
        .order_by(OutreachEmail.created_at.asc())
    )
    return result.scalars().all()


@router.get("/sent", response_model=list[OutreachEmailResponse])
async def list_sent_emails(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OutreachEmail, Candidate.full_name, Candidate.email)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(
            Workflow.owner_id == current_user.id,
            OutreachEmail.status.in_(["sent", "replied", "bounced"]),
        )
        .order_by(OutreachEmail.sent_at.desc().nullslast(), OutreachEmail.created_at.desc())
    )
    rows = result.all()
    payload = []
    for email, candidate_name, candidate_email in rows:
        payload.append({
            "id": email.id,
            "candidate_id": email.candidate_id,
            "candidate_name": candidate_name,
            "candidate_email": candidate_email,
            "subject": email.subject,
            "body": email.body,
            "tone": email.tone,
            "status": email.status,
            "opened": email.opened,
            "replied": email.replied,
            "reply_body": email.reply_body,
            "reply_sentiment": email.reply_sentiment,
            "sent_at": email.sent_at,
            "created_at": email.created_at,
        })
    return payload


@router.put("/{email_id}", response_model=OutreachEmailResponse)
async def update_email(
    email_id: int,
    data: EmailUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(OutreachEmail.id == email_id, Workflow.owner_id == current_user.id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    if data.subject is not None:
        email.subject = data.subject
    if data.body is not None:
        email.body = data.body
    if data.tone is not None:
        email.tone = data.tone

    await db.commit()
    await db.refresh(email)
    return email


@router.post("/{email_id}/approve", response_model=OutreachEmailResponse)
async def approve_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(OutreachEmail.id == email_id, Workflow.owner_id == current_user.id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    email.status = "approved"
    email.approved_by_id = current_user.id
    await db.commit()
    await db.refresh(email)
    return email


@router.post("/{email_id}/regenerate", response_model=OutreachEmailResponse)
async def regenerate_email(
    email_id: int,
    data: RegenerateEmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(OutreachEmail.id == email_id, Workflow.owner_id == current_user.id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    cand_result = await db.execute(select(Candidate).where(Candidate.id == email.candidate_id))
    candidate = cand_result.scalar_one_or_none()

    from app.agents.outreach import OutreachAgent
    agent = OutreachAgent()

    run_result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == candidate.workflow_run_id)
    )
    run = run_result.scalar_one_or_none()
    wf_result = await db.execute(select(Workflow).where(Workflow.id == run.workflow_id))
    workflow = wf_result.scalar_one_or_none()

    new_email = await agent.regenerate_email(
        candidate={
            "id": candidate.id,
            "full_name": candidate.full_name,
            "headline": candidate.headline,
            "skills": candidate.skills,
            "experience_years": candidate.experience_years,
            "experience": candidate.experience,
            "profile_summary": candidate.profile_summary,
            "location": candidate.location,
        },
        job_title=workflow.job_title,
        company_name="Our Company",
        tone=data.tone or email.tone,
        recruiter_name=current_user.full_name,
        instruction=data.instruction or "",
    )

    email.subject = new_email.get("subject", email.subject)
    email.body = new_email.get("body", email.body)
    email.status = "draft"
    await db.commit()
    await db.refresh(email)
    return email


@router.post("/bulk-send", response_model=dict)
async def bulk_send_emails(
    data: BulkSendRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    emails_to_send = []
    for email_id in data.email_ids:
        result = await db.execute(
            select(OutreachEmail)
            .join(Candidate)
            .join(WorkflowRun)
            .join(Workflow)
            .where(OutreachEmail.id == email_id, Workflow.owner_id == current_user.id)
        )
        email = result.scalar_one_or_none()
        if email and email.status == "approved":
            emails_to_send.append(email_id)

    await EmailService.send_bulk(emails_to_send)
    status_result = await db.execute(
        select(OutreachEmail.status)
        .where(OutreachEmail.id.in_(emails_to_send))
    )
    statuses = [row[0] for row in status_result.all()]
    sent_count = sum(1 for s in statuses if s in ("sent", "replied"))
    bounced_count = sum(1 for s in statuses if s == "bounced")
    return {
        "queued": len(emails_to_send),
        "sent_count": sent_count,
        "bounced_count": bounced_count,
    }


@router.delete("/{email_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Discard a single email draft — removes it permanently."""
    result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(OutreachEmail.id == email_id, Workflow.owner_id == current_user.id)
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    await db.delete(email)
    await db.commit()


class BulkDeleteRequest(BaseModel):
    email_ids: List[int]


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_emails(
    data: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Discard multiple email drafts at once."""
    # Verify ownership before deleting
    result = await db.execute(
        select(OutreachEmail.id)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(
            OutreachEmail.id.in_(data.email_ids),
            Workflow.owner_id == current_user.id,
        )
    )
    owned_ids = [row[0] for row in result.all()]

    if owned_ids:
        await db.execute(delete(OutreachEmail).where(OutreachEmail.id.in_(owned_ids)))
        await db.commit()

    return {"deleted": len(owned_ids)}


@router.post("/webhook/sendgrid", include_in_schema=False)
async def sendgrid_inbound_webhook(request: dict):
    """Handle SendGrid inbound parse webhook for reply tracking."""
    return {"status": "ok"}
