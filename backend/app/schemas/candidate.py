from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CandidateResponse(BaseModel):
    id: int
    workflow_run_id: int
    full_name: str
    headline: Optional[str]
    linkedin_url: Optional[str]
    location: Optional[str]
    skills: list[str]
    experience_years: Optional[float]
    experience: list[dict]
    education: list[dict]
    email: Optional[str]
    phone: Optional[str]
    current_company: Optional[str]
    profile_description: Optional[str]
    profile_summary: Optional[str]
    resume_url: Optional[str]
    ai_score: Optional[float]
    ai_score_reason: Optional[str]
    recruiter_score_override: Optional[float]
    recruiter_notes: Optional[str]
    status: str
    recruiter_decision: Optional[str]
    sourced_at: Optional[datetime]
    filtered_at: Optional[datetime]
    contacted_at: Optional[datetime]
    scheduled_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class CandidateDecisionRequest(BaseModel):
    decision: str  # "approve" | "reject" | "flag"
    score_override: Optional[float] = None
    notes: Optional[str] = None


class BulkDecisionRequest(BaseModel):
    candidate_ids: list[int]
    decision: str  # "approve" | "reject"


class CandidateEventResponse(BaseModel):
    id: int
    event_type: str
    agent: Optional[str]
    description: str
    event_metadata: dict
    created_at: datetime

    class Config:
        from_attributes = True
