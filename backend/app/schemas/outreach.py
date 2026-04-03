from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class OutreachEmailResponse(BaseModel):
    id: int
    candidate_id: int
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    subject: str
    body: str
    tone: str
    status: str
    opened: bool
    replied: bool
    reply_body: Optional[str]
    reply_sentiment: Optional[str]
    sent_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class EmailUpdateRequest(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    tone: Optional[str] = None


class RegenerateEmailRequest(BaseModel):
    instruction: Optional[str] = None
    tone: Optional[str] = None


class BulkSendRequest(BaseModel):
    email_ids: list[int]


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
