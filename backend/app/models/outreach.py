from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class OutreachEmail(Base):
    __tablename__ = "outreach_emails"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), nullable=False)

    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tone: Mapped[str] = mapped_column(String(50), default="friendly")

    status: Mapped[str] = mapped_column(
        String(50), default="draft"
    )  # draft, approved, sent, replied, bounced
    sendgrid_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    opened: Mapped[bool] = mapped_column(Boolean, default=False)
    replied: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reply_sentiment: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    approved_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="emails")  # noqa: F821


class InterviewScheduleRequest(Base):
    __tablename__ = "interview_schedule_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    outreach_email_id: Mapped[int] = mapped_column(ForeignKey("outreach_emails.id"), nullable=False, unique=True)
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="open")  # open, booked, closed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    outreach_email: Mapped["OutreachEmail"] = relationship("OutreachEmail")
    slots: Mapped[list["InterviewSlot"]] = relationship(
        "InterviewSlot", back_populates="schedule_request", cascade="all, delete-orphan"
    )
    bookings: Mapped[list["InterviewBooking"]] = relationship(
        "InterviewBooking", back_populates="schedule_request", cascade="all, delete-orphan"
    )


class InterviewSlot(Base):
    __tablename__ = "interview_slots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    schedule_request_id: Mapped[int] = mapped_column(ForeignKey("interview_schedule_requests.id"), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_booked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    schedule_request: Mapped["InterviewScheduleRequest"] = relationship(
        "InterviewScheduleRequest", back_populates="slots"
    )


class InterviewBooking(Base):
    __tablename__ = "interview_bookings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    schedule_request_id: Mapped[int] = mapped_column(ForeignKey("interview_schedule_requests.id"), nullable=False)
    slot_id: Mapped[int] = mapped_column(ForeignKey("interview_slots.id"), nullable=False, unique=True)
    candidate_name: Mapped[str] = mapped_column(String(255), nullable=False)
    candidate_email: Mapped[str] = mapped_column(String(255), nullable=False)
    candidate_phone: Mapped[str] = mapped_column(String(80), nullable=False)
    resume_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    calendar_status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, synced, failed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    schedule_request: Mapped["InterviewScheduleRequest"] = relationship(
        "InterviewScheduleRequest", back_populates="bookings"
    )
