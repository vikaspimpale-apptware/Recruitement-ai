from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db, AsyncSessionLocal
from app.core.deps import get_current_user
from app.core.security import decode_token
from app.models.user import User
from app.models.workflow import Workflow, WorkflowRun
from app.models.candidate import Candidate
from app.models.outreach import OutreachEmail
from app.schemas.outreach import ChatRequest
from app.agents.orchestrator import OrchestratorAgent
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


async def _build_pipeline_context(user_id: int) -> dict:
    """
    Fetch real pipeline data for the authenticated user and return it as a
    structured dict that the orchestrator can embed in its system prompt.
    """
    async with AsyncSessionLocal() as db:
        # Workflows
        wf_result = await db.execute(
            select(Workflow)
            .where(Workflow.owner_id == user_id, Workflow.is_active == True)
            .order_by(Workflow.created_at.desc())
            .limit(10)
        )
        workflows = wf_result.scalars().all()

        # Active runs (pending / running / waiting_review)
        active_runs_result = await db.execute(
            select(WorkflowRun, Workflow.name.label("workflow_name"))
            .join(Workflow)
            .where(
                Workflow.owner_id == user_id,
                WorkflowRun.status.in_(["pending", "running", "waiting_review"]),
            )
            .order_by(WorkflowRun.created_at.desc())
            .limit(10)
        )
        active_run_rows = active_runs_result.all()

        # Recent completed runs (for context)
        recent_runs_result = await db.execute(
            select(WorkflowRun, Workflow.name.label("workflow_name"))
            .join(Workflow)
            .where(Workflow.owner_id == user_id)
            .order_by(WorkflowRun.created_at.desc())
            .limit(5)
        )
        recent_run_rows = recent_runs_result.all()

        # Candidate stats
        cand_stats_result = await db.execute(
            select(
                func.count(Candidate.id).label("total"),
                Candidate.recruiter_decision,
            )
            .join(WorkflowRun)
            .join(Workflow)
            .where(Workflow.owner_id == user_id)
            .group_by(Candidate.recruiter_decision)
        )
        cand_stats_rows = cand_stats_result.all()

        total_candidates = sum(r.total for r in cand_stats_rows)
        approved = next((r.total for r in cand_stats_rows if r.recruiter_decision == "approved"), 0)
        rejected = next((r.total for r in cand_stats_rows if r.recruiter_decision == "rejected"), 0)
        pending = next((r.total for r in cand_stats_rows if r.recruiter_decision is None), 0)

        # Recent candidates for the most active run
        recent_candidates = []
        if active_run_rows:
            latest_run_id = active_run_rows[0][0].id
            cand_result = await db.execute(
                select(Candidate)
                .where(Candidate.workflow_run_id == latest_run_id)
                .order_by(Candidate.ai_score.desc().nullslast())
                .limit(10)
            )
            recent_candidates = cand_result.scalars().all()

        # Email stats
        email_stats = await db.execute(
            select(func.count(OutreachEmail.id), OutreachEmail.status)
            .join(Candidate)
            .join(WorkflowRun)
            .join(Workflow)
            .where(Workflow.owner_id == user_id)
            .group_by(OutreachEmail.status)
        )
        email_rows = email_stats.all()
        emails_sent = next((r[0] for r in email_rows if r[1] == "sent"), 0)
        emails_draft = next((r[0] for r in email_rows if r[1] == "draft"), 0)

        return {
            "workflows": [
                {
                    "id": w.id,
                    "name": w.name,
                    "job_title": w.job_title,
                    "location": w.location,
                    "seniority": w.seniority,
                    "keywords": w.keywords,
                }
                for w in workflows
            ],
            "active_runs": [
                {
                    "id": row[0].id,
                    "workflow_name": row[1],
                    "status": row[0].status,
                    "current_step": row[0].current_step,
                    "started_at": row[0].started_at.isoformat() if row[0].started_at else None,
                }
                for row in active_run_rows
            ],
            "recent_runs": [
                {
                    "id": row[0].id,
                    "workflow_name": row[1],
                    "status": row[0].status,
                    "current_step": row[0].current_step,
                    "created_at": row[0].created_at.isoformat() if row[0].created_at else None,
                }
                for row in recent_run_rows
            ],
            "recent_candidates": [
                {
                    "full_name": c.full_name,
                    "headline": c.headline,
                    "skills": c.skills[:5],
                    "experience_years": c.experience_years,
                    "ai_score": c.ai_score,
                    "recruiter_decision": c.recruiter_decision,
                    "location": c.location,
                }
                for c in recent_candidates
            ],
            "stats": {
                "total_workflows": len(workflows),
                "total_runs": len(recent_run_rows),
                "total_candidates": total_candidates,
                "approved": approved,
                "rejected": rejected,
                "pending": pending,
                "emails_sent": emails_sent,
                "emails_draft": emails_draft,
            },
        }


@router.post("/message")
async def chat_message(
    data: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    """Stream a chat response via SSE (HTTP fallback for non-WebSocket clients)."""
    agent = OrchestratorAgent()
    pipeline_context = await _build_pipeline_context(current_user.id)

    async def generate():
        try:
            intent = await agent.classify_intent(
                data.message, [m.model_dump() for m in data.history]
            )
            yield f"data: {json.dumps({'type': 'intent', 'data': intent})}\n\n"

            async for chunk in agent.chat_stream(
                data.message,
                [m.model_dump() for m in data.history],
                pipeline_context=pipeline_context,
            ):
                yield f"data: {json.dumps({'type': 'chunk', 'data': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    """Primary WebSocket chat endpoint with real-time streaming and live pipeline context."""
    await websocket.accept()
    agent = OrchestratorAgent()
    authenticated = False
    user_id: int = 0

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "data": "Invalid JSON"}))
                continue

            msg_type = data.get("type", "chat")

            # ── Auth handshake ─────────────────────────────────────────────────
            if msg_type == "auth":
                token = data.get("token", "")
                payload = decode_token(token)
                if payload:
                    user_id = payload.get("sub") or payload.get("user_id") or 0
                    try:
                        user_id = int(user_id)
                    except (TypeError, ValueError):
                        user_id = 0
                    authenticated = True
                    await websocket.send_text(json.dumps({"type": "auth_ok"}))
                else:
                    await websocket.send_text(json.dumps({"type": "error", "data": "Invalid token"}))
                continue

            if not authenticated:
                await websocket.send_text(json.dumps({"type": "error", "data": "Not authenticated"}))
                continue

            # ── Chat message ───────────────────────────────────────────────────
            if msg_type == "chat":
                message = data.get("message", "").strip()
                history = data.get("history", [])

                if not message:
                    await websocket.send_text(json.dumps({"type": "error", "data": "Empty message"}))
                    continue

                try:
                    # Fetch live pipeline data for this user
                    pipeline_context = await _build_pipeline_context(user_id)
                    await websocket.send_text(json.dumps({"type": "context_loaded"}))

                    # Classify intent
                    intent = await agent.classify_intent(message, history)
                    await websocket.send_text(json.dumps({"type": "intent", "data": intent}))

                    # Stream response
                    has_content = False
                    async for chunk in agent.chat_stream(message, history, pipeline_context):
                        await websocket.send_text(json.dumps({"type": "chunk", "data": chunk}))
                        has_content = True

                    if not has_content:
                        await websocket.send_text(json.dumps({
                            "type": "chunk",
                            "data": "I processed your request but had no response to show.",
                        }))

                    await websocket.send_text(json.dumps({"type": "done"}))

                except Exception as e:
                    logger.error(f"WebSocket chat error: {e}")
                    await websocket.send_text(json.dumps({"type": "chunk", "data": str(e)}))
                    await websocket.send_text(json.dumps({"type": "done"}))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"type": "error", "data": str(e)}))
        except Exception:
            pass
