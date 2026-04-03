from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.candidate import Candidate, CandidateEvent
from app.models.workflow import WorkflowRun, Workflow
from app.schemas.candidate import (
    CandidateResponse,
    CandidateDecisionRequest,
    BulkDecisionRequest,
    CandidateEventResponse,
)
from datetime import datetime, timezone

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.get("/run/{run_id}", response_model=list[CandidateResponse])
async def list_candidates_for_run(
    run_id: int,
    status: str = None,
    post_filter_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    if status:
        query = query.where(Candidate.status == status)
    if post_filter_only:
        query = query.where(Candidate.status != "sourced")
    query = query.order_by(Candidate.ai_score.desc().nullslast())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{candidate_id}", response_model=CandidateResponse)
async def get_candidate(
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(Candidate.id == candidate_id, Workflow.owner_id == current_user.id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


@router.post("/{candidate_id}/decision", response_model=CandidateResponse)
async def set_candidate_decision(
    candidate_id: int,
    data: CandidateDecisionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(Candidate.id == candidate_id, Workflow.owner_id == current_user.id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    candidate.recruiter_decision = data.decision
    candidate.status = data.decision  # "approved", "rejected", "flagged"
    if data.score_override is not None:
        candidate.recruiter_score_override = data.score_override
    if data.notes:
        candidate.recruiter_notes = data.notes

    db.add(CandidateEvent(
        candidate_id=candidate.id,
        event_type="recruiter_decision",
        agent="recruiter",
        description=f"Recruiter set decision: {data.decision}",
        event_metadata={"decision": data.decision, "score_override": data.score_override},
    ))

    await db.commit()
    await db.refresh(candidate)
    return candidate


@router.post("/bulk-decision", response_model=dict)
async def bulk_candidate_decision(
    data: BulkDecisionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updated = 0
    for candidate_id in data.candidate_ids:
        result = await db.execute(
            select(Candidate)
            .join(WorkflowRun)
            .join(Workflow)
            .where(Candidate.id == candidate_id, Workflow.owner_id == current_user.id)
        )
        candidate = result.scalar_one_or_none()
        if candidate:
            candidate.recruiter_decision = data.decision
            candidate.status = data.decision
            db.add(CandidateEvent(
                candidate_id=candidate.id,
                event_type="recruiter_decision",
                agent="recruiter",
                description=f"Bulk decision: {data.decision}",
                event_metadata={"decision": data.decision, "bulk": True},
            ))
            updated += 1

    await db.commit()
    return {"updated": updated, "decision": data.decision}


@router.post("/{candidate_id}/rescore", response_model=CandidateResponse)
async def rescore_candidate(
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-run AI scoring on a single candidate."""
    result = await db.execute(
        select(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(Candidate.id == candidate_id, Workflow.owner_id == current_user.id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    wf_result = await db.execute(
        select(Workflow)
        .join(WorkflowRun)
        .where(WorkflowRun.id == candidate.workflow_run_id)
    )
    workflow = wf_result.scalar_one_or_none()

    from app.agents.filtering import FilteringAgent
    agent = FilteringAgent()
    result_data = await agent.run({
        "candidates": [{
            "id": candidate.id,
            "full_name": candidate.full_name,
            "headline": candidate.headline,
            "skills": candidate.skills,
            "experience_years": candidate.experience_years,
            "experience": candidate.experience,
            "education": candidate.education,
            "profile_summary": candidate.profile_summary,
            "location": candidate.location,
        }],
        "job_title": workflow.job_title if workflow else "",
        "required_skills": [],
        "min_experience_years": 0,
        "min_score_threshold": 0,
    })

    if result_data["candidates"]:
        scored = result_data["candidates"][0]
        candidate.ai_score = scored.get("ai_score")
        candidate.ai_score_reason = scored.get("ai_score_reason")
        candidate.recruiter_score_override = None  # reset override after rescore
        db.add(CandidateEvent(
            candidate_id=candidate.id,
            event_type="rescored",
            agent="filtering_agent",
            description=f"AI rescored: {scored.get('ai_score', 0):.1f}/10",
            event_metadata={"score": scored.get("ai_score"), "reason": scored.get("ai_score_reason")},
        ))
        await db.commit()
        await db.refresh(candidate)

    return candidate


@router.get("/{candidate_id}/events", response_model=list[CandidateEventResponse])
async def get_candidate_events(
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CandidateEvent)
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(CandidateEvent.candidate_id == candidate_id, Workflow.owner_id == current_user.id)
        .order_by(CandidateEvent.created_at.asc())
    )
    return result.scalars().all()

