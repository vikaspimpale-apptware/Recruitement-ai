import json
import re
from typing import Any, AsyncGenerator, Optional
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from app.agents.base import BaseAgent, LLMUnavailableError


ORCHESTRATOR_SYSTEM_PROMPT = """You are an AI recruitment assistant for the RecruitAI platform.
You help recruiters manage their end-to-end recruitment pipeline.

You have real-time access to the recruiter's pipeline data (provided below as JSON context).
Always use this data when answering questions about workflows, candidates, and status.

You can help with:
- Explaining pipeline status and metrics
- Summarising candidates (skills, scores, experience)
- Describing how to configure workflows
- Answering questions about outreach and scheduling
- General recruitment advice

Be concise, professional, and data-driven. When pipeline data is available, always reference it.
If something isn't in your context, say so clearly rather than guessing.
"""

INTENT_CLASSIFICATION_PROMPT = """Classify the recruiter's intent. Return ONLY valid JSON, no markdown.
{
  "intent": "pipeline_status" | "candidate_query" | "workflow_help" | "general_query",
  "response_hint": "<one sentence natural language acknowledgement>"
}
"""


class OrchestratorAgent(BaseAgent):
    name = "orchestrator"

    async def classify_intent(self, message: str, history: list[dict]) -> dict:
        """Classify recruiter intent — with graceful fallback on LLM failure."""
        # Try LLM classification first
        messages = [
            SystemMessage(content=INTENT_CLASSIFICATION_PROMPT),
            HumanMessage(content=f"Recruiter message: {message}"),
        ]
        try:
            result = await self.invoke_with_fallback(messages)
            raw = result.content.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            return json.loads(raw)
        except LLMUnavailableError:
            pass
        except Exception as e:
            self._log(f"Intent classification failed: {e}")

        # Rule-based fallback
        msg_lower = message.lower()
        if any(w in msg_lower for w in ["status", "workflow", "run", "pipeline", "active"]):
            intent = "pipeline_status"
        elif any(w in msg_lower for w in ["candidate", "candidates", "sourced", "approved", "rejected", "score"]):
            intent = "candidate_query"
        elif any(w in msg_lower for w in ["how", "configure", "setup", "create", "help", "what"]):
            intent = "workflow_help"
        else:
            intent = "general_query"
        return {"intent": intent, "response_hint": ""}

    async def chat_stream(
        self,
        message: str,
        history: list[dict],
        pipeline_context: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat response.
        Falls back to a structured rule-based response if the LLM is unavailable.
        """
        # Build history messages
        history_messages = []
        for msg in history[-8:]:
            if msg.get("role") == "user":
                history_messages.append(HumanMessage(content=msg["content"]))
            elif msg.get("role") == "assistant":
                history_messages.append(AIMessage(content=msg["content"]))

        # Embed pipeline context in system prompt
        context_block = ""
        if pipeline_context:
            context_block = (
                "\n\n--- LIVE PIPELINE DATA (use this to answer questions) ---\n"
                + json.dumps(pipeline_context, indent=2, default=str)
                + "\n--- END PIPELINE DATA ---"
            )

        all_messages = (
            [SystemMessage(content=ORCHESTRATOR_SYSTEM_PROMPT + context_block)]
            + history_messages
            + [HumanMessage(content=message)]
        )

        try:
            async for chunk in self.stream_with_fallback(all_messages):
                yield chunk

        except LLMUnavailableError as e:
            # LLM completely unavailable — use rule-based fallback
            self._log(f"LLM unavailable, using rule-based fallback: {e}")
            response = self._rule_based_response(message, pipeline_context, str(e))
            yield response

        except Exception as e:
            self._log(f"Unexpected chat error: {e}")
            yield f"Sorry, I encountered an error: {str(e)[:200]}"

    def _rule_based_response(
        self,
        message: str,
        ctx: Optional[dict],
        llm_error: str = "",
    ) -> str:
        """
        Return a structured answer using only the DB context, no LLM needed.
        Used when the LLM is unavailable (quota exceeded, no key, etc.).
        """
        msg = message.lower()
        lines: list[str] = []

        # ── LLM status notice ──────────────────────────────────────────────────
        if "quota" in llm_error or "429" in llm_error or "insufficient_quota" in llm_error.lower():
            lines.append(
                "**AI responses are limited right now** - your OpenAI quota is exceeded.\n"
                "I can still answer using your live pipeline data below.\n"
                "To restore full AI replies: add billing credits at https://platform.openai.com/account/billing\n"
                "or add a valid Anthropic API key (starts with `sk-ant-`) to your `.env` file.\n"
            )

        if not ctx:
            lines.append("I don't have pipeline data loaded right now. Please try refreshing.")
            return "\n".join(lines)

        workflows = ctx.get("workflows", [])
        active_runs = ctx.get("active_runs", [])
        recent_candidates = ctx.get("recent_candidates", [])
        stats = ctx.get("stats", {})

        # ── Pipeline / workflow status questions ───────────────────────────────
        if any(w in msg for w in ["status", "workflow", "pipeline", "active", "running", "run"]):
            if not workflows:
                lines.append("You don't have any workflows yet. Go to **Workflows → New Workflow** to create one.")
            else:
                lines.append(f"**Your Workflows ({len(workflows)} total)**\n")
                for wf in workflows[:5]:
                    lines.append(f"• **{wf['name']}** — {wf['job_title']} in {wf['location']}")

                if active_runs:
                    lines.append(f"\n**Active Pipeline Runs ({len(active_runs)})**\n")
                    for run in active_runs:
                        step = run.get("current_step", "unknown").replace("_", " ")
                        status = run.get("status", "")
                        action_hint = ""
                        if status == "waiting_review":
                            if "checkpoint_1" in run.get("current_step", ""):
                                action_hint = " → **Shortlist Review needed**"
                            elif "checkpoint_2" in run.get("current_step", ""):
                                action_hint = " → **Email Review needed**"
                        lines.append(
                            f"• Run #{run['id']} for **{run.get('workflow_name', '')}** — "
                            f"step: `{step}` | status: `{status}`{action_hint}"
                        )
                else:
                    lines.append("\nNo pipeline runs are currently active.")

        # ── Candidate questions ────────────────────────────────────────────────
        elif any(w in msg for w in ["candidate", "candidates", "sourced", "approved", "rejected", "score", "profile"]):
            if stats:
                lines.append("**Candidate Pipeline Summary**\n")
                lines.append(f"• Total sourced: **{stats.get('total_candidates', 0)}**")
                lines.append(f"• Approved for outreach: **{stats.get('approved', 0)}**")
                lines.append(f"• Rejected: **{stats.get('rejected', 0)}**")
                lines.append(f"• Pending review: **{stats.get('pending', 0)}**")

            if recent_candidates:
                lines.append(f"\n**Recent Candidates (latest {len(recent_candidates)})**\n")
                for c in recent_candidates[:8]:
                    score_str = f" | Score: {c['ai_score']:.1f}/10" if c.get("ai_score") else ""
                    decision_str = f" | ✓ {c['recruiter_decision']}" if c.get("recruiter_decision") else ""
                    lines.append(
                        f"• **{c['full_name']}** — {c.get('headline', '')[:60]}"
                        f"{score_str}{decision_str}"
                    )

        # ── Help / how-to questions ────────────────────────────────────────────
        elif any(w in msg for w in ["how", "help", "configure", "setup", "create", "start", "what can"]):
            lines.append("**How RecruitAI works:**\n")
            lines.append("1. **Create a Workflow** — Go to Workflows → New Workflow. Set job title, location, seniority, and skills.")
            lines.append("2. **Launch a Run** — Click 'New Run' on your workflow. The AI will source candidates from LinkedIn.")
            lines.append("3. **Shortlist Review** — Review and approve/reject AI-scored candidates.")
            lines.append("4. **Email Review** — Edit, approve, or regenerate personalised outreach emails.")
            lines.append("5. **Send** — Send approved emails to candidates.")
            lines.append("\n**To use AI chat fully**, add billing credits to your OpenAI account or configure a valid Anthropic API key.")

        # ── Analytics ─────────────────────────────────────────────────────────
        elif any(w in msg for w in ["analytics", "metric", "reply", "rate", "report"]):
            if stats:
                lines.append("**Recruitment Metrics**\n")
                lines.append(f"• Workflows: **{stats.get('total_workflows', 0)}**")
                lines.append(f"• Pipeline runs: **{stats.get('total_runs', 0)}**")
                lines.append(f"• Candidates sourced: **{stats.get('total_candidates', 0)}**")
                lines.append(f"• Emails sent: **{stats.get('emails_sent', 0)}**")
            else:
                lines.append("Visit the **Analytics** page for detailed metrics on your pipeline.")

        # ── Default ────────────────────────────────────────────────────────────
        else:
            if workflows:
                lines.append(f"You have **{len(workflows)}** workflow(s) and **{len(active_runs)}** active run(s).")
            lines.append(
                "\nI can answer questions about your pipeline status, candidates, and how to use RecruitAI. "
                "For full AI-powered responses, please restore your OpenAI quota or add an Anthropic API key."
            )

        return "\n".join(lines)

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the orchestrator in ad-hoc mode."""
        message = context.get("message", "")
        history = context.get("history", [])
        pipeline_context = context.get("pipeline_context")

        intent = await self.classify_intent(message, history)
        response_parts = []

        async for chunk in self.chat_stream(message, history, pipeline_context):
            response_parts.append(chunk)

        return {
            "intent": intent,
            "response": "".join(response_parts),
        }
