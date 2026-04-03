import json
import re
from typing import Any
from datetime import datetime, timezone
from langchain_core.messages import HumanMessage, SystemMessage
from app.agents.base import BaseAgent


SCORING_SYSTEM_PROMPT = """You are an expert technical recruiter. Your task is to score a candidate profile 
against a job description on a scale of 0 to 10.

Scoring criteria:
- 9-10: Exceptional match — has all required skills, ideal experience level, strong background
- 7-8: Good match — has most required skills, meets experience requirements
- 5-6: Partial match — has some required skills but gaps exist
- 3-4: Weak match — significant skill or experience gaps
- 0-2: Poor match — does not meet basic requirements

Return a JSON object with:
{
  "score": <float 0-10>,
  "reason": "<2-3 sentence explanation of the score>",
  "matched_skills": ["skill1", "skill2"],
  "missing_skills": ["skill3"],
  "passes_hard_filters": <boolean>
}

Return ONLY valid JSON, no markdown.
"""


class FilteringAgent(BaseAgent):
    name = "filtering_agent"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Score and rank candidates against job criteria.
        
        Context keys:
        - candidates: list[dict]
        - job_title: str
        - required_skills: list[str]
        - min_experience_years: float
        - min_score_threshold: float
        - job_description: str (optional)
        """
        candidates = context.get("candidates", [])
        job_title = context.get("job_title", "")
        required_skills = context.get("required_skills", [])
        preferred_skills = context.get("preferred_skills", [])
        strict_skill_match = bool(context.get("strict_skill_match", False))
        min_experience = context.get("min_experience_years", 0)
        max_experience = context.get("max_experience_years")
        min_score = context.get("min_score_threshold", 5.0)
        job_description = context.get("job_description", "")

        self._log(f"Scoring {len(candidates)} candidates for {job_title}")

        scored = []
        force_heuristic = False
        for candidate in candidates:
            result = await self._score_candidate(
                candidate=candidate,
                job_title=job_title,
                job_description=job_description,
                required_skills=required_skills,
                preferred_skills=preferred_skills,
                min_experience=min_experience,
                force_heuristic=force_heuristic,
            )
            if result.pop("__llm_unavailable", False):
                force_heuristic = True
            candidate.update(result)
            candidate["filtered_at"] = datetime.now(timezone.utc).isoformat()

            # Apply hard filters
            if not self._passes_hard_filters(
                candidate=candidate,
                required_skills=required_skills,
                min_experience=min_experience,
                max_experience=max_experience,
                strict_skill_match=strict_skill_match,
            ):
                candidate["status"] = "rejected"
                candidate["ai_score_reason"] = (
                    candidate.get("ai_score_reason", "") + " [Auto-excluded: failed hard filters]"
                )
            elif candidate.get("ai_score", 0) < min_score:
                candidate["status"] = "rejected"
                candidate["ai_score_reason"] = (
                    candidate.get("ai_score_reason", "") + f" [Auto-excluded: score {candidate['ai_score']:.1f} below threshold {min_score}]"
                )
            else:
                candidate["status"] = "filtered"

            scored.append(candidate)

        scored.sort(key=lambda c: c.get("ai_score", 0), reverse=True)

        passed = [c for c in scored if c["status"] == "filtered"]
        rejected = [c for c in scored if c["status"] == "rejected"]

        self._log(f"Scoring complete: {len(passed)} passed, {len(rejected)} auto-excluded")

        return {
            "candidates": scored,
            "passed_count": len(passed),
            "rejected_count": len(rejected),
            "filtered_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _score_candidate(
        self,
        candidate: dict,
        job_title: str,
        job_description: str,
        required_skills: list[str],
        preferred_skills: list[str],
        min_experience: float,
        force_heuristic: bool = False,
    ) -> dict:
        """Score a single candidate using the LLM."""
        if force_heuristic:
            heuristic = self._heuristic_score(
                candidate=candidate,
                required_skills=required_skills,
                preferred_skills=preferred_skills,
                min_experience=min_experience,
            )
            return {
                "ai_score": heuristic["score"],
                "ai_score_reason": heuristic["reason"],
                "matched_skills": heuristic["matched_skills"],
                "missing_skills": heuristic["missing_skills"],
            }

        profile_text = f"""
Candidate: {candidate.get('full_name', 'Unknown')}
Headline: {candidate.get('headline', '')}
Location: {candidate.get('location', '')}
Experience: {candidate.get('experience_years', 0)} years
Skills: {', '.join(candidate.get('skills', []))}
Summary: {candidate.get('profile_summary', '')}
Description: {candidate.get('profile_description', '')}
Experience: {json.dumps(candidate.get('experience', [])[:3])}
Education: {json.dumps(candidate.get('education', [])[:2])}
"""
        job_context = f"""
Job Title: {job_title}
Job Description: {job_description or 'Not provided'}
Required Skills: {', '.join(required_skills) if required_skills else 'Not specified'}
Preferred Skills: {', '.join(preferred_skills) if preferred_skills else 'Not specified'}
Minimum Experience: {min_experience} years
"""
        messages = [
            SystemMessage(content=SCORING_SYSTEM_PROMPT),
            HumanMessage(content=f"Job Requirements:\n{job_context}\n\nCandidate Profile:\n{profile_text}"),
        ]

        try:
            if self.llm is None:
                raise RuntimeError("LLM not configured")
            result = await self.llm.ainvoke(messages)
            raw = (result.content or "").strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            if not raw.startswith("{"):
                match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
                if match:
                    raw = match.group(0)
            data = json.loads(raw)
            return {
                "ai_score": float(data.get("score", 5.0)),
                "ai_score_reason": data.get("reason", ""),
                "matched_skills": data.get("matched_skills", []),
                "missing_skills": data.get("missing_skills", []),
            }
        except Exception as e:
            self._log(f"Scoring failed for {candidate.get('full_name')}: {e}")
            heuristic = self._heuristic_score(
                candidate=candidate,
                required_skills=required_skills,
                preferred_skills=preferred_skills,
                min_experience=min_experience,
            )
            msg = str(e).lower()
            llm_unavailable = any(token in msg for token in [
                "insufficient_quota",
                "exceeded your current quota",
                "rate limit",
                "credit balance too low",
                "api key",
            ])
            return {
                "ai_score": heuristic["score"],
                "ai_score_reason": heuristic["reason"],
                "matched_skills": heuristic["matched_skills"],
                "missing_skills": heuristic["missing_skills"],
                "__llm_unavailable": llm_unavailable,
            }

    def _passes_hard_filters(
        self,
        candidate: dict,
        required_skills: list[str],
        min_experience: float,
        max_experience: float | None,
        strict_skill_match: bool,
    ) -> bool:
        """Check if candidate passes all hard filters."""
        exp = candidate.get("experience_years", 0) or 0
        if min_experience > 0:
            if exp < min_experience:
                return False
        if max_experience is not None and max_experience >= 0 and exp > max_experience:
            return False

        if required_skills:
            candidate_skills_lower = self._candidate_skill_set(candidate)
            if not candidate_skills_lower:
                return False
            req_norm = [self._normalize_skill(s) for s in required_skills if str(s).strip()]
            if strict_skill_match:
                for skill in req_norm:
                    if not self._skill_present(skill, candidate_skills_lower):
                        return False
            else:
                matched = sum(1 for skill in req_norm if self._skill_present(skill, candidate_skills_lower))
                required_matches = max(1, int(round(len(req_norm) * 0.6)))
                if matched < required_matches:
                    return False

        return True

    def _candidate_skill_set(self, candidate: dict) -> set[str]:
        skill_set: set[str] = set()
        for raw in candidate.get("skills", []) or []:
            norm = self._normalize_skill(str(raw))
            if norm:
                skill_set.add(norm)
        headline = str(candidate.get("headline") or "")
        for token in re.split(r"[|,/·\-()]+", headline):
            norm = self._normalize_skill(token)
            if len(norm) >= 2:
                skill_set.add(norm)
        return skill_set

    def _normalize_skill(self, value: str) -> str:
        return re.sub(r"\s+", " ", value.strip().lower())

    def _skill_present(self, skill: str, candidate_skills: set[str]) -> bool:
        if skill in candidate_skills:
            return True
        for cand in candidate_skills:
            if skill in cand or cand in skill:
                return True
        return False

    def _heuristic_score(
        self,
        candidate: dict,
        required_skills: list[str],
        preferred_skills: list[str],
        min_experience: float,
    ) -> dict[str, Any]:
        """Deterministic scoring fallback when LLM scoring is unavailable."""
        candidate_skills = self._candidate_skill_set(candidate)
        req_norm = [self._normalize_skill(s) for s in required_skills if str(s).strip()]
        pref_norm = [self._normalize_skill(s) for s in preferred_skills if str(s).strip()]

        matched_required = [s for s in req_norm if self._skill_present(s, candidate_skills)]
        missing_required = [s for s in req_norm if s not in matched_required]
        matched_preferred = [s for s in pref_norm if self._skill_present(s, candidate_skills)]

        exp = float(candidate.get("experience_years") or 0.0)
        exp_component = min(4.0, max(0.0, exp / 2.0))
        if min_experience > 0 and exp < min_experience:
            exp_component *= 0.5

        if req_norm:
            req_component = 4.0 * (len(matched_required) / len(req_norm))
        else:
            req_component = 2.5 if candidate_skills else 1.0

        if pref_norm:
            pref_component = 2.0 * (len(matched_preferred) / len(pref_norm))
        else:
            pref_component = 1.0 if candidate_skills else 0.0

        score = round(min(10.0, req_component + exp_component + pref_component), 1)
        reason = (
            "Heuristic score used because LLM scoring was unavailable. "
            f"Matched required skills: {len(matched_required)}/{len(req_norm) if req_norm else 0}; "
            f"preferred skills: {len(matched_preferred)}/{len(pref_norm) if pref_norm else 0}; "
            f"experience: {exp:.1f} years."
        )
        return {
            "score": score,
            "reason": reason,
            "matched_skills": matched_required + matched_preferred,
            "missing_skills": missing_required,
        }
