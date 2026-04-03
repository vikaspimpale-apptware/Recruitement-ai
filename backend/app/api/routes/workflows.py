from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.workflow import Workflow, WorkflowRun, WorkflowStepConfig
from app.models.candidate import Candidate, CandidateEvent
from app.models.outreach import OutreachEmail
from app.schemas.workflow import (
    WorkflowCreateRequest,
    WorkflowUpdateRequest,
    WorkflowResponse,
    WorkflowRunResponse,
    ResumeWorkflowRequest,
    RegenerateStepRequest,
)
from app.services.workflow_runner import WorkflowRunner

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _to_workflow_response(workflow: Workflow) -> WorkflowResponse:
    return WorkflowResponse(
        id=workflow.id,
        name=workflow.name,
        job_title=workflow.job_title,
        job_description=workflow.job_description,
        location=workflow.location,
        seniority=workflow.seniority,
        keywords=workflow.keywords or [],
        is_active=workflow.is_active,
        created_at=workflow.created_at,
        step_configs=[
            {
                "step_name": s.step_name,
                "enabled": s.enabled,
                "order_index": s.order_index,
                "config": s.config or {},
            }
            for s in sorted(workflow.step_configs, key=lambda x: x.order_index)
        ],
    )


@router.post("", response_model=WorkflowResponse, status_code=201)
async def create_workflow(
    data: WorkflowCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workflow = Workflow(
        owner_id=current_user.id,
        name=data.name,
        job_title=data.job_title,
        job_description=data.job_description,
        location=data.location,
        seniority=data.seniority,
        keywords=data.keywords,
    )
    db.add(workflow)
    await db.flush()

    for step in data.step_configs:
        db.add(WorkflowStepConfig(
            workflow_id=workflow.id,
            step_name=step.step_name,
            enabled=step.enabled,
            order_index=step.order_index,
            config=step.config,
        ))

    await db.commit()
    await db.refresh(workflow)
    result = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.step_configs))
        .where(Workflow.id == workflow.id)
    )
    hydrated = result.scalar_one()
    return _to_workflow_response(hydrated)


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.step_configs))
        .where(Workflow.owner_id == current_user.id)
        .order_by(Workflow.created_at.desc())
    )
    return [_to_workflow_response(w) for w in result.scalars().all()]


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.step_configs))
        .where(Workflow.id == workflow_id, Workflow.owner_id == current_user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _to_workflow_response(workflow)


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: int,
    data: WorkflowUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.step_configs))
        .where(Workflow.id == workflow_id, Workflow.owner_id == current_user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if data.name is not None:
        workflow.name = data.name
    if data.job_title is not None:
        workflow.job_title = data.job_title
    if data.job_description is not None:
        workflow.job_description = data.job_description
    if data.location is not None:
        workflow.location = data.location
    if data.seniority is not None:
        workflow.seniority = data.seniority
    if data.keywords is not None:
        workflow.keywords = data.keywords

    if data.step_configs is not None:
        await db.execute(
            delete(WorkflowStepConfig).where(WorkflowStepConfig.workflow_id == workflow_id)
        )
        for step in data.step_configs:
            db.add(WorkflowStepConfig(
                workflow_id=workflow_id,
                step_name=step.step_name,
                enabled=step.enabled,
                order_index=step.order_index,
                config=step.config,
            ))

    await db.commit()

    refreshed = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.step_configs))
        .where(Workflow.id == workflow_id)
    )
    return _to_workflow_response(refreshed.scalar_one())


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a workflow and all its runs, candidates, events and emails."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.owner_id == current_user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Get all runs for this workflow
    runs_result = await db.execute(
        select(WorkflowRun.id).where(WorkflowRun.workflow_id == workflow_id)
    )
    run_ids = [row[0] for row in runs_result.all()]

    for run_id in run_ids:
        await WorkflowRunner.delete_run(db, run_id)

    # Delete step configs and workflow
    await db.execute(delete(WorkflowStepConfig).where(WorkflowStepConfig.workflow_id == workflow_id))
    await db.execute(delete(Workflow).where(Workflow.id == workflow_id))
    await db.commit()


@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse, status_code=201)
async def launch_workflow_run(
    workflow_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.owner_id == current_user.id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run = WorkflowRun(
        workflow_id=workflow_id,
        status="pending",
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(WorkflowRunner.execute, run.id)
    return run


@router.get("/{workflow_id}/runs", response_model=list[WorkflowRunResponse])
async def list_workflow_runs(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(Workflow.id == workflow_id, Workflow.owner_id == current_user.id)
        .order_by(WorkflowRun.created_at.desc())
    )
    return result.scalars().all()


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
async def get_workflow_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return run


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a specific run and all its candidates, events and emails."""
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    await WorkflowRunner.delete_run(db, run_id)


@router.post("/runs/{run_id}/rerun", response_model=WorkflowRunResponse, status_code=201)
async def rerun_workflow(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a fresh new run for the same workflow configuration (does not modify the original run)."""
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    original_run = result.scalar_one_or_none()
    if not original_run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    new_run = WorkflowRun(
        workflow_id=original_run.workflow_id,
        status="pending",
        started_at=datetime.now(timezone.utc),
    )
    db.add(new_run)
    await db.commit()
    await db.refresh(new_run)

    background_tasks.add_task(WorkflowRunner.execute, new_run.id)
    return new_run


@router.post("/runs/{run_id}/regenerate", response_model=WorkflowRunResponse)
async def regenerate_workflow_run(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status in ("running", "pending"):
        raise HTTPException(status_code=400, detail="Run is already in progress")

    run.status = "pending"
    run.current_step = None
    run.error_message = None
    run.completed_at = None
    run.started_at = datetime.now(timezone.utc)
    run.state_data = {}
    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(WorkflowRunner.regenerate, run.id)
    return run


@router.post("/runs/{run_id}/regenerate-step", response_model=WorkflowRunResponse)
async def regenerate_workflow_step(
    run_id: int,
    data: RegenerateStepRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status in ("running", "pending"):
        raise HTTPException(status_code=400, detail="Run is already in progress")

    try:
        await WorkflowRunner.regenerate_step(
            run_id=run_id,
            step_name=data.step_name,
            skip_filtering=data.skip_filtering,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    refreshed = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
    return refreshed.scalar_one()


@router.post("/runs/{run_id}/resume", response_model=WorkflowRunResponse)
async def resume_workflow_run(
    run_id: int,
    data: ResumeWorkflowRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkflowRun)
        .join(Workflow)
        .where(WorkflowRun.id == run_id, Workflow.owner_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    # Allow resume from waiting_review OR if it's already at checkpoint_2 (idempotent)
    if run.status not in ("waiting_review", "running"):
        raise HTTPException(status_code=400, detail=f"Run cannot be resumed (status: {run.status})")

    run.status = "running"
    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(WorkflowRunner.resume, run_id, data.checkpoint, data.action)
    return run
