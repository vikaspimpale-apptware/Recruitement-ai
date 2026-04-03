from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.outreach import (
    OutreachEmail,
    InterviewScheduleRequest,
    InterviewSlot,
    InterviewBooking,
)
from app.models.candidate import Candidate, CandidateEvent
from app.models.workflow import Workflow, WorkflowRun
from app.schemas.scheduling import (
    CreateScheduleRequestInput,
    ScheduleRequestResponse,
    PublicScheduleResponse,
)

router = APIRouter(prefix="/scheduling", tags=["scheduling"])


def _save_resume_file(resume_file: UploadFile, request: Request) -> tuple[str, Path]:
    filename = resume_file.filename or "resume.pdf"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".doc", ".docx"}:
        raise HTTPException(status_code=400, detail="Resume must be PDF/DOC/DOCX")

    project_root = Path(__file__).resolve().parents[3]
    upload_dir = project_root / "uploads" / "resumes"
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(filename).stem).strip("._") or "resume"
    stored_name = f"{uuid4().hex}_{safe_stem[:80]}{suffix}"
    target_path = upload_dir / stored_name
    return str(request.base_url).rstrip("/") + f"/uploads/resumes/{stored_name}", target_path


@router.post("/requests", response_model=ScheduleRequestResponse)
async def create_schedule_request(
    data: CreateScheduleRequestInput,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not data.slots:
        raise HTTPException(status_code=400, detail="At least one slot is required")

    email_result = await db.execute(
        select(OutreachEmail)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(OutreachEmail.id == data.email_id, Workflow.owner_id == current_user.id)
    )
    email = email_result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Sent email not found")
    if email.status not in ("sent", "approved"):
        raise HTTPException(status_code=400, detail="Email must be approved or sent before scheduling")

    existing_result = await db.execute(
        select(InterviewScheduleRequest).where(InterviewScheduleRequest.outreach_email_id == email.id)
    )
    req = existing_result.scalar_one_or_none()
    if req is None:
        req = InterviewScheduleRequest(
            outreach_email_id=email.id,
            token=str(uuid4()),
            status="open",
        )
        db.add(req)
        await db.flush()

    # Replace slots each time recruiter reconfigures availability.
    old_slots_result = await db.execute(
        select(InterviewSlot).where(InterviewSlot.schedule_request_id == req.id)
    )
    for slot in old_slots_result.scalars().all():
        await db.delete(slot)

    for slot in data.slots:
        if slot.end_at <= slot.start_at:
            continue
        db.add(InterviewSlot(
            schedule_request_id=req.id,
            start_at=slot.start_at,
            end_at=slot.end_at,
            is_booked=False,
        ))

    await db.commit()

    refreshed = await db.execute(
        select(InterviewScheduleRequest)
        .options(
            selectinload(InterviewScheduleRequest.slots),
            selectinload(InterviewScheduleRequest.bookings),
        )
        .where(InterviewScheduleRequest.id == req.id)
    )
    return refreshed.scalar_one()


@router.get("/requests", response_model=list[ScheduleRequestResponse])
async def list_schedule_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(InterviewScheduleRequest)
        .options(
            selectinload(InterviewScheduleRequest.slots),
            selectinload(InterviewScheduleRequest.bookings),
            selectinload(InterviewScheduleRequest.outreach_email),
        )
        .join(OutreachEmail, InterviewScheduleRequest.outreach_email_id == OutreachEmail.id)
        .join(Candidate, OutreachEmail.candidate_id == Candidate.id)
        .join(WorkflowRun, Candidate.workflow_run_id == WorkflowRun.id)
        .join(Workflow, WorkflowRun.workflow_id == Workflow.id)
        .where(Workflow.owner_id == current_user.id)
        .order_by(InterviewScheduleRequest.created_at.desc())
    )
    return result.scalars().all()


@router.get("/public/{token}", response_model=PublicScheduleResponse)
async def get_public_schedule(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InterviewScheduleRequest)
        .options(selectinload(InterviewScheduleRequest.slots))
        .where(InterviewScheduleRequest.token == token)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Scheduling link not found")

    email_result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == req.outreach_email_id)
    )
    email = email_result.scalar_one()
    cand_result = await db.execute(select(Candidate).where(Candidate.id == email.candidate_id))
    candidate = cand_result.scalar_one()
    available_slots = sorted(
        [s for s in req.slots if not s.is_booked],
        key=lambda x: x.start_at,
    )
    return PublicScheduleResponse(
        token=req.token,
        status=req.status,
        candidate_name=candidate.full_name,
        candidate_headline=candidate.headline,
        slots=available_slots,
    )


@router.post("/public/{token}/book", response_model=dict)
async def book_public_slot(
    token: str,
    request: Request,
    slot_id: int = Form(...),
    candidate_name: str = Form(...),
    candidate_email: str = Form(...),
    candidate_phone: str = Form(...),
    notes: str | None = Form(None),
    resume_file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
):
    req_result = await db.execute(
        select(InterviewScheduleRequest).where(InterviewScheduleRequest.token == token)
    )
    req = req_result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Scheduling link not found")
    if req.status != "open":
        raise HTTPException(status_code=400, detail="Scheduling request is closed")

    slot_result = await db.execute(
        select(InterviewSlot).where(
            InterviewSlot.id == slot_id,
            InterviewSlot.schedule_request_id == req.id,
        )
    )
    slot = slot_result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.is_booked:
        raise HTTPException(status_code=400, detail="Slot already booked")

    uploaded_resume_url = None
    if resume_file is not None:
        uploaded_resume_url, target_path = _save_resume_file(resume_file, request)
        file_bytes = await resume_file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Resume file too large (max 10 MB)")
        target_path.write_bytes(file_bytes)

    booking = InterviewBooking(
        schedule_request_id=req.id,
        slot_id=slot.id,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        candidate_phone=candidate_phone,
        resume_url=uploaded_resume_url,
        notes=notes,
        calendar_status="pending",
    )
    db.add(booking)
    slot.is_booked = True
    req.status = "booked"

    # Update candidate profile + status
    email_result = await db.execute(
        select(OutreachEmail).where(OutreachEmail.id == req.outreach_email_id)
    )
    email = email_result.scalar_one()
    cand_result = await db.execute(select(Candidate).where(Candidate.id == email.candidate_id))
    candidate = cand_result.scalar_one()
    candidate.full_name = candidate_name or candidate.full_name
    candidate.email = candidate_email
    candidate.phone = candidate_phone
    if uploaded_resume_url:
        candidate.resume_url = uploaded_resume_url
    candidate.status = "scheduled"
    candidate.scheduled_at = datetime.now(timezone.utc)
    db.add(CandidateEvent(
        candidate_id=candidate.id,
        event_type="interview_slot_booked",
        agent="candidate",
        description=f"Candidate booked slot {slot.start_at.isoformat()} - {slot.end_at.isoformat()}",
        event_metadata={"slot_id": slot.id},
    ))

    # If all scheduling requests in this run are booked/closed, mark run completed.
    run_result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == candidate.workflow_run_id))
    run = run_result.scalar_one()
    pending_req_result = await db.execute(
        select(InterviewScheduleRequest.id)
        .join(OutreachEmail, InterviewScheduleRequest.outreach_email_id == OutreachEmail.id)
        .join(Candidate, OutreachEmail.candidate_id == Candidate.id)
        .where(Candidate.workflow_run_id == run.id, InterviewScheduleRequest.status == "open")
        .limit(1)
    )
    has_open = pending_req_result.scalar_one_or_none() is not None
    if not has_open:
        run.current_step = "completed"
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)

    await db.commit()
    return {
        "status": "booked",
        "slot_id": slot.id,
        "message": "Interview slot booked successfully. Recruiter will send calendar invite.",
    }
