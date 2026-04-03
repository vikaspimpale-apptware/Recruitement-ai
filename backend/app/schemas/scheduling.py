from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SlotInput(BaseModel):
    start_at: datetime
    end_at: datetime


class CreateScheduleRequestInput(BaseModel):
    email_id: int
    slots: list[SlotInput]


class InterviewSlotResponse(BaseModel):
    id: int
    start_at: datetime
    end_at: datetime
    is_booked: bool

    class Config:
        from_attributes = True


class InterviewBookingResponse(BaseModel):
    id: int
    slot_id: int
    candidate_name: str
    candidate_email: str
    candidate_phone: str
    resume_url: Optional[str]
    notes: Optional[str]
    calendar_status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ScheduleRequestResponse(BaseModel):
    id: int
    outreach_email_id: int
    token: str
    status: str
    created_at: datetime
    slots: list[InterviewSlotResponse]
    bookings: list[InterviewBookingResponse]

    class Config:
        from_attributes = True


class PublicScheduleResponse(BaseModel):
    token: str
    status: str
    candidate_name: str
    candidate_headline: Optional[str]
    slots: list[InterviewSlotResponse]


class BookSlotInput(BaseModel):
    slot_id: int
    candidate_name: str
    candidate_email: str
    candidate_phone: str
    resume_url: Optional[str] = None
    notes: Optional[str] = None
