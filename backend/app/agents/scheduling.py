import json
import re
from typing import Any
from datetime import datetime, timezone
from langchain_core.messages import HumanMessage, SystemMessage
from app.agents.base import BaseAgent


DATE_EXTRACTION_PROMPT = """You are an expert at extracting date and time proposals from natural language text.
Given an email reply from a candidate, extract any proposed meeting times.

Return a JSON object with:
{
  "is_positive": <boolean — is the candidate interested in proceeding?>,
  "proposed_times": [
    {"raw": "<original text>", "parsed": "<ISO 8601 datetime or null>", "timezone": "<timezone string or null>"}
  ],
  "candidate_message": "<brief summary of what candidate said>",
  "requires_clarification": <boolean — is more info needed to schedule?>
}

Return ONLY valid JSON, no markdown.
"""


class SchedulingAgent(BaseAgent):
    name = "scheduling_agent"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Monitor replies and schedule interviews.
        
        Context keys:
        - replies: list[{candidate_id, email_body, received_at}]
        - interviewer_emails: list[str]
        - slot_duration_minutes: int
        - recruiter_calendar_id: str (optional)
        """
        replies = context.get("replies", [])
        interviewer_emails = context.get("interviewer_emails", [])
        slot_duration = context.get("slot_duration_minutes", 45)

        self._log(f"Processing {len(replies)} candidate replies")

        scheduled = []
        needs_action = []

        for reply in replies:
            result = await self._process_reply(reply, interviewer_emails, slot_duration)
            if result.get("scheduled"):
                scheduled.append(result)
            else:
                needs_action.append(result)

        self._log(f"Scheduled: {len(scheduled)}, Needs action: {len(needs_action)}")
        return {
            "scheduled": scheduled,
            "needs_action": needs_action,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _process_reply(self, reply: dict, interviewer_emails: list[str], slot_duration: int) -> dict:
        """Process a single candidate reply."""
        email_body = reply.get("email_body", "")
        candidate_id = reply.get("candidate_id")

        extraction = await self._extract_datetime(email_body)

        if not extraction.get("is_positive"):
            return {
                "candidate_id": candidate_id,
                "scheduled": False,
                "reason": "Candidate not interested",
                "extraction": extraction,
            }

        proposed_times = extraction.get("proposed_times", [])
        if not proposed_times:
            return {
                "candidate_id": candidate_id,
                "scheduled": False,
                "reason": "Positive reply but no times proposed",
                "extraction": extraction,
                "requires_clarification": True,
            }

        best_time = self._select_best_time(proposed_times)
        if not best_time:
            return {
                "candidate_id": candidate_id,
                "scheduled": False,
                "reason": "Could not parse proposed times",
                "extraction": extraction,
            }

        # In a real system this would check calendar availability via Google/Outlook API
        invite = self._create_invite(candidate_id, best_time, interviewer_emails, slot_duration)

        return {
            "candidate_id": candidate_id,
            "scheduled": True,
            "interview_time": best_time,
            "invite": invite,
            "extraction": extraction,
        }

    async def _extract_datetime(self, email_body: str) -> dict:
        """Use LLM to extract date/time proposals from email text."""
        messages = [
            SystemMessage(content=DATE_EXTRACTION_PROMPT),
            HumanMessage(content=f"Candidate email reply:\n{email_body}"),
        ]
        try:
            result = await self.llm.ainvoke(messages)
            return json.loads(result.content)
        except Exception as e:
            self._log(f"Date extraction failed: {e}")
            return {"is_positive": False, "proposed_times": [], "requires_clarification": False}

    def _select_best_time(self, proposed_times: list[dict]) -> str | None:
        """Select the first parseable proposed time."""
        for pt in proposed_times:
            parsed = pt.get("parsed")
            if parsed:
                return parsed
        return None

    def _create_invite(
        self, candidate_id: int, interview_time: str, interviewer_emails: list[str], duration_minutes: int
    ) -> dict:
        """Create a calendar invite payload."""
        return {
            "candidate_id": candidate_id,
            "start_time": interview_time,
            "duration_minutes": duration_minutes,
            "attendees": interviewer_emails,
            "title": "Interview — Recruitment Pipeline",
            "description": "Interview scheduled via AI Recruitment Platform",
            "status": "pending_send",
        }
