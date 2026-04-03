import json
from typing import Any
from datetime import datetime, timezone
from langchain_core.messages import HumanMessage, SystemMessage
from app.agents.base import BaseAgent


OUTREACH_SYSTEM_PROMPT = """You are an expert recruitment copywriter. Write a personalised outreach email 
to a candidate based on their LinkedIn profile. The email should:
1. Be personalised — reference their actual experience and skills
2. Be concise — 3-4 short paragraphs max
3. Clearly state the opportunity without being pushy
4. Have a clear, natural call to action
5. Feel human and authentic, not templated

Return a JSON object with:
{
  "subject": "<compelling email subject line>",
  "body": "<full email body in plain text with \\n for line breaks>"
}

Return ONLY valid JSON, no markdown.
"""

TONE_INSTRUCTIONS = {
    "formal": "Use a professional, formal tone appropriate for senior executive roles.",
    "friendly": "Use a warm, conversational, and approachable tone.",
    "custom": "Use the tone described in the recruiter's instruction.",
}


class OutreachAgent(BaseAgent):
    name = "outreach_agent"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Generate personalised outreach emails for approved candidates.
        
        Context keys:
        - candidates: list[dict] (approved candidates)
        - job_title: str
        - company_name: str
        - tone: str (formal/friendly/custom)
        - custom_template_seed: str (optional)
        - recruiter_name: str
        """
        candidates = context.get("candidates", [])
        job_title = context.get("job_title", "")
        company_name = context.get("company_name", "Our Company")
        tone = context.get("tone", "friendly")
        template_seed = context.get("custom_template_seed", "")
        recruiter_name = context.get("recruiter_name", "The Recruitment Team")

        self._log(f"Generating emails for {len(candidates)} candidates")

        emails = []
        for candidate in candidates:
            email = await self._generate_email(
                candidate, job_title, company_name, tone, template_seed, recruiter_name
            )
            email["candidate_id"] = candidate.get("id") or candidate.get("temp_id")
            email["status"] = "draft"
            email["tone"] = tone
            email["created_at"] = datetime.now(timezone.utc).isoformat()
            emails.append(email)

        self._log(f"Generated {len(emails)} email drafts")
        return {"emails": emails, "generated_at": datetime.now(timezone.utc).isoformat()}

    async def _generate_email(
        self,
        candidate: dict,
        job_title: str,
        company_name: str,
        tone: str,
        template_seed: str,
        recruiter_name: str,
    ) -> dict:
        """Generate a single personalised email using the LLM."""
        tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["friendly"])
        if tone == "custom" and template_seed:
            tone_instruction = f"Use this style/tone as inspiration: {template_seed}"

        profile_context = f"""
Candidate Name: {candidate.get('full_name', 'there')}
Current Role / Headline: {candidate.get('headline', '')}
Location: {candidate.get('location', '')}
Key Skills: {', '.join(candidate.get('skills', [])[:8])}
Experience: {candidate.get('experience_years', 0)} years
Recent Experience: {json.dumps(candidate.get('experience', [])[:2])}
Profile Summary: {candidate.get('profile_summary', '')}
"""
        job_context = f"""
Job Title: {job_title}
Company: {company_name}
Recruiter Name: {recruiter_name}
Tone: {tone_instruction}
"""
        messages = [
            SystemMessage(content=OUTREACH_SYSTEM_PROMPT),
            HumanMessage(
                content=f"Job Context:\n{job_context}\n\nCandidate Profile:\n{profile_context}\n\nWrite a personalised outreach email."
            ),
        ]

        try:
            result = await self.llm.ainvoke(messages)
            data = json.loads(result.content)
            return {"subject": data.get("subject", ""), "body": data.get("body", "")}
        except Exception as e:
            self._log(f"Email generation failed for {candidate.get('full_name')}: {e}")
            name = candidate.get("full_name", "there")
            return {
                "subject": f"Exciting {job_title} opportunity at {company_name}",
                "body": f"Hi {name},\n\nWe came across your profile and think you'd be a great fit for a {job_title} role at {company_name}. Would you be open to a quick chat?\n\nBest,\n{recruiter_name}",
            }

    async def regenerate_email(
        self,
        candidate: dict,
        job_title: str,
        company_name: str,
        tone: str,
        recruiter_name: str,
        instruction: str = "",
    ) -> dict:
        """Regenerate a single email with optional instruction override."""
        context = {
            "candidates": [candidate],
            "job_title": job_title,
            "company_name": company_name,
            "tone": tone,
            "recruiter_name": recruiter_name,
            "custom_template_seed": instruction,
        }
        result = await self.run(context)
        return result["emails"][0] if result["emails"] else {}
