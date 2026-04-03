from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Float, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_run_id: Mapped[int] = mapped_column(ForeignKey("workflow_runs.id"), nullable=False)

    # Profile data
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    headline: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    linkedin_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    experience_years: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    experience: Mapped[list] = mapped_column(JSON, default=list)
    education: Mapped[list] = mapped_column(JSON, default=list)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    current_company: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    profile_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    profile_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    # Filtering
    ai_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ai_score_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recruiter_score_override: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recruiter_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Pipeline status
    status: Mapped[str] = mapped_column(
        String(50), default="sourced"
    )  # sourced, filtered, approved, rejected, flagged, contacted, replied, scheduled
    recruiter_decision: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Deduplication
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_of_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidates.id"), nullable=True
    )

    # Timestamps
    sourced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    filtered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    contacted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    workflow_run: Mapped["WorkflowRun"] = relationship(  # noqa: F821
        "WorkflowRun", back_populates="candidates"
    )
    emails: Mapped[list["OutreachEmail"]] = relationship(  # noqa: F821
        "OutreachEmail", back_populates="candidate"
    )
    events: Mapped[list["CandidateEvent"]] = relationship(
        "CandidateEvent", back_populates="candidate", cascade="all, delete-orphan"
    )


class CandidateEvent(Base):
    __tablename__ = "candidate_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    agent: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="events")
