from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.candidate import Candidate
from app.models.outreach import OutreachEmail
from app.models.workflow import Workflow, WorkflowRun

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard")
async def get_dashboard_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return aggregated metrics for the recruiter dashboard."""
    # Total sourced
    sourced = await db.execute(
        select(func.count(Candidate.id))
        .join(WorkflowRun)
        .join(Workflow)
        .where(Workflow.owner_id == current_user.id)
    )
    total_sourced = sourced.scalar() or 0

    # Total contacted
    contacted = await db.execute(
        select(func.count(Candidate.id))
        .join(WorkflowRun)
        .join(Workflow)
        .where(Workflow.owner_id == current_user.id, Candidate.status == "contacted")
    )
    total_contacted = contacted.scalar() or 0

    # Total scheduled
    scheduled = await db.execute(
        select(func.count(Candidate.id))
        .join(WorkflowRun)
        .join(Workflow)
        .where(Workflow.owner_id == current_user.id, Candidate.status == "scheduled")
    )
    total_scheduled = scheduled.scalar() or 0

    # Email stats
    emails_sent = await db.execute(
        select(func.count(OutreachEmail.id))
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(Workflow.owner_id == current_user.id, OutreachEmail.status == "sent")
    )
    total_sent = emails_sent.scalar() or 0

    emails_replied = await db.execute(
        select(func.count(OutreachEmail.id))
        .join(Candidate)
        .join(WorkflowRun)
        .join(Workflow)
        .where(Workflow.owner_id == current_user.id, OutreachEmail.replied == True)  # noqa: E712
    )
    total_replied = emails_replied.scalar() or 0

    # Active workflow runs
    active_runs = await db.execute(
        select(func.count(WorkflowRun.id))
        .join(Workflow)
        .where(
            Workflow.owner_id == current_user.id,
            WorkflowRun.status.in_(["running", "waiting_review", "pending"]),
        )
    )
    total_active = active_runs.scalar() or 0

    return {
        "total_sourced": total_sourced,
        "total_contacted": total_contacted,
        "total_scheduled": total_scheduled,
        "emails_sent": total_sent,
        "emails_replied": total_replied,
        "reply_rate": round((total_replied / total_sent * 100) if total_sent > 0 else 0, 1),
        "conversion_to_interview": round((total_scheduled / total_sourced * 100) if total_sourced > 0 else 0, 1),
        "active_workflow_runs": total_active,
    }


@router.get("/pipeline-funnel")
async def get_pipeline_funnel(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return candidate counts per pipeline stage for funnel visualization."""
    stages = ["sourced", "filtered", "approved", "contacted", "replied", "scheduled"]
    funnel = []
    for stage in stages:
        result = await db.execute(
            select(func.count(Candidate.id))
            .join(WorkflowRun)
            .join(Workflow)
            .where(Workflow.owner_id == current_user.id, Candidate.status == stage)
        )
        funnel.append({"stage": stage, "count": result.scalar() or 0})
    return funnel
