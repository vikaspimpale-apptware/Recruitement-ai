"""
LangGraph-based recruitment pipeline workflow.
Manages the state machine for the full sourcing → filtering → outreach → scheduling pipeline.
"""
import asyncio
from datetime import datetime, timezone
from typing import TypedDict, Annotated, Optional, Any
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from app.agents.sourcing import SourcingAgent
from app.agents.filtering import FilteringAgent
from app.agents.outreach import OutreachAgent
from app.agents.scheduling import SchedulingAgent


class PipelineState(TypedDict):
    workflow_run_id: int
    workflow_config: dict
    step_configs: dict  # step_name -> config
    current_step: str
    status: str  # pending, running, waiting_review, completed, failed

    # Sourcing outputs
    raw_candidates: list[dict]
    sourced_count: int

    # Filtering outputs
    scored_candidates: list[dict]
    approved_candidates: list[dict]  # set after human review checkpoint 1

    # Outreach outputs
    email_drafts: list[dict]
    sent_emails: list[dict]  # set after human review checkpoint 2

    # Scheduling outputs
    scheduled_interviews: list[dict]

    # Checkpoints
    checkpoint_1_complete: bool
    checkpoint_2_complete: bool

    # Errors and metadata
    errors: list[str]
    run_log: list[dict]


def log_step(state: PipelineState, step: str, message: str, data: dict = None) -> list[dict]:
    """Append a log entry to run_log."""
    entry = {
        "step": step,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data or {},
    }
    return state.get("run_log", []) + [entry]


async def sourcing_node(state: PipelineState) -> dict:
    """Run the sourcing agent."""
    config = state["workflow_config"]
    step_cfg = state["step_configs"].get("sourcing", {})

    agent = SourcingAgent()
    result = await agent.run({
        "job_title": config.get("job_title", ""),
        "location": config.get("location", ""),
        "seniority": config.get("seniority", ""),
        "keywords": config.get("keywords", []),
        "max_candidates": step_cfg.get("max_candidates", 20),
    })

    return {
        "current_step": "sourcing",
        "raw_candidates": result["candidates"],
        "sourced_count": result["total_found"],
        "run_log": log_step(state, "sourcing", f"Sourced {result['total_found']} candidates"),
    }


async def filtering_node(state: PipelineState) -> dict:
    """Run the filtering agent, or skip if disabled."""
    step_cfg = state["step_configs"].get("filtering", {})

    if not step_cfg.get("enabled", True):
        return {
            "current_step": "filtering_skipped",
            "scored_candidates": state["raw_candidates"],
            "run_log": log_step(state, "filtering", "Filtering step skipped — passing raw list"),
        }

    config = state["workflow_config"]
    agent = FilteringAgent()
    result = await agent.run({
        "candidates": state["raw_candidates"],
        "job_title": config.get("job_title", ""),
        "required_skills": step_cfg.get("required_skills", []),
        "min_experience_years": step_cfg.get("min_experience_years", 0),
        "min_score_threshold": step_cfg.get("min_score_threshold", 5.0),
    })

    return {
        "current_step": "filtering",
        "scored_candidates": result["candidates"],
        "run_log": log_step(
            state,
            "filtering",
            f"Scored {len(result['candidates'])} candidates. {result['passed_count']} passed.",
        ),
    }


async def checkpoint_1_node(state: PipelineState) -> dict:
    """Pause for human review of the shortlist."""
    return {
        "current_step": "checkpoint_1",
        "status": "waiting_review",
        "run_log": log_step(state, "checkpoint_1", "Waiting for recruiter shortlist review"),
    }


async def outreach_node(state: PipelineState) -> dict:
    """Run the outreach agent for approved candidates."""
    config = state["workflow_config"]
    step_cfg = state["step_configs"].get("outreach", {})
    approved = state.get("approved_candidates", [])

    if not approved:
        return {
            "current_step": "outreach_skipped",
            "email_drafts": [],
            "run_log": log_step(state, "outreach", "No approved candidates — skipping outreach"),
        }

    agent = OutreachAgent()
    result = await agent.run({
        "candidates": approved,
        "job_title": config.get("job_title", ""),
        "company_name": config.get("company_name", "Our Company"),
        "tone": step_cfg.get("tone", "friendly"),
        "custom_template_seed": step_cfg.get("custom_template_seed", ""),
        "recruiter_name": config.get("recruiter_name", "The Recruitment Team"),
    })

    return {
        "current_step": "outreach",
        "email_drafts": result["emails"],
        "run_log": log_step(state, "outreach", f"Generated {len(result['emails'])} email drafts"),
    }


async def checkpoint_2_node(state: PipelineState) -> dict:
    """Pause for human review of email drafts."""
    return {
        "current_step": "checkpoint_2",
        "status": "waiting_review",
        "run_log": log_step(state, "checkpoint_2", "Waiting for recruiter email review"),
    }


async def scheduling_node(state: PipelineState) -> dict:
    """Run the scheduling agent to process replies."""
    step_cfg = state["step_configs"].get("scheduling", {})

    return {
        "current_step": "scheduling",
        "status": "running",
        "run_log": log_step(state, "scheduling", "Monitoring inbox for candidate replies"),
    }


async def complete_node(state: PipelineState) -> dict:
    """Mark workflow as complete."""
    return {
        "current_step": "completed",
        "status": "completed",
        "run_log": log_step(state, "complete", "Workflow pipeline completed"),
    }


def should_skip_filtering(state: PipelineState) -> str:
    step_cfg = state["step_configs"].get("filtering", {})
    return "skip_to_checkpoint_1" if not step_cfg.get("enabled", True) else "filtering"


def after_checkpoint_1(state: PipelineState) -> str:
    """Route after checkpoint 1 based on completion."""
    if state.get("checkpoint_1_complete"):
        return "outreach"
    return "wait"


def after_checkpoint_2(state: PipelineState) -> str:
    """Route after checkpoint 2 based on completion."""
    if state.get("checkpoint_2_complete"):
        return "scheduling"
    return "wait"


def build_pipeline_graph() -> StateGraph:
    """Build the LangGraph state machine for the recruitment pipeline."""
    graph = StateGraph(PipelineState)

    graph.add_node("sourcing", sourcing_node)
    graph.add_node("filtering", filtering_node)
    graph.add_node("checkpoint_1", checkpoint_1_node)
    graph.add_node("outreach", outreach_node)
    graph.add_node("checkpoint_2", checkpoint_2_node)
    graph.add_node("scheduling", scheduling_node)
    graph.add_node("complete", complete_node)

    graph.set_entry_point("sourcing")
    graph.add_edge("sourcing", "filtering")
    graph.add_edge("filtering", "checkpoint_1")
    graph.add_edge("checkpoint_1", END)  # Pipeline pauses here; resumed via API
    graph.add_edge("outreach", "checkpoint_2")
    graph.add_edge("checkpoint_2", END)  # Pipeline pauses here; resumed via API
    graph.add_edge("scheduling", "complete")
    graph.add_edge("complete", END)

    return graph.compile()


# Global pipeline instance
pipeline = build_pipeline_graph()
