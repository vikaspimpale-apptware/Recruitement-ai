from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field


class StepConfigIn(BaseModel):
    step_name: str
    enabled: bool = True
    order_index: int = 0
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowCreateRequest(BaseModel):
    name: str
    job_title: str
    job_description: Optional[str] = None
    location: str
    seniority: str
    keywords: list[str] = Field(default_factory=list)
    step_configs: list[StepConfigIn] = Field(default_factory=list)


class WorkflowUpdateRequest(BaseModel):
    name: Optional[str] = None
    job_title: Optional[str] = None
    job_description: Optional[str] = None
    location: Optional[str] = None
    seniority: Optional[str] = None
    keywords: Optional[list[str]] = None
    step_configs: Optional[list[StepConfigIn]] = None


class WorkflowResponse(BaseModel):
    id: int
    name: str
    job_title: str
    job_description: Optional[str]
    location: str
    seniority: str
    keywords: list[str]
    is_active: bool
    created_at: datetime
    step_configs: list[StepConfigIn] = Field(default_factory=list)

    class Config:
        from_attributes = True


class WorkflowRunResponse(BaseModel):
    id: int
    workflow_id: int
    status: str
    current_step: Optional[str]
    state_data: dict
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ResumeWorkflowRequest(BaseModel):
    action: str  # "approve" | "reject_all"
    checkpoint: str  # "shortlist_review" | "email_review"


class RegenerateStepRequest(BaseModel):
    step_name: str  # currently supports: "filtering"
    skip_filtering: bool = False
