from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator
import sys
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Models to try in order when making LLM calls
_OPENAI_MODELS_FALLBACK = ["gpt-4o-mini", "gpt-3.5-turbo", "gpt-4o"]


def _is_valid_anthropic_key(key: str) -> bool:
    """Real Anthropic keys start with sk-ant-. Cursor tokens (crsr_) are NOT Anthropic keys."""
    return bool(key) and key.startswith("sk-ant-")


def _is_valid_openai_key(key: str) -> bool:
    return bool(key) and key.startswith("sk-")


def get_llm(model: str = "auto", temperature: float = 0.0):
    """
    Return the best available LLM.
    Priority: explicitly requested model → OpenAI (gpt-4o-mini) → Anthropic (claude)
    Only uses a provider if the key looks valid.
    """
    use_anthropic = (
        model == "anthropic"
        or (not _is_valid_openai_key(settings.OPENAI_API_KEY)
            and _is_valid_anthropic_key(settings.ANTHROPIC_API_KEY))
    )

    if use_anthropic and _is_valid_anthropic_key(settings.ANTHROPIC_API_KEY):
        return ChatAnthropic(
            model=settings.ANTHROPIC_MODEL,
            api_key=settings.ANTHROPIC_API_KEY,
            temperature=temperature,
            max_tokens=2048,
        )

    if _is_valid_openai_key(settings.OPENAI_API_KEY):
        # Use gpt-4o-mini by default (much cheaper, same API key, avoids quota issues)
        chosen_model = settings.OPENAI_MODEL if model not in ("auto", "openai") else "gpt-4o-mini"
        return ChatOpenAI(
            model=chosen_model,
            api_key=settings.OPENAI_API_KEY,
            temperature=temperature,
        )

    # Neither key is valid — return None; callers must handle this gracefully
    logger.warning("No valid LLM API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env")
    return None


def get_fallback_llm():
    """Try Anthropic as a fallback when OpenAI fails."""
    if _is_valid_anthropic_key(settings.ANTHROPIC_API_KEY):
        return ChatAnthropic(
            model=settings.ANTHROPIC_MODEL,
            api_key=settings.ANTHROPIC_API_KEY,
            temperature=0.0,
            max_tokens=2048,
        )
    return None


class LLMUnavailableError(Exception):
    """Raised when no LLM is configured or all providers failed."""
    pass


class BaseAgent(ABC):
    name: str = "base_agent"

    def __init__(self):
        self.llm = get_llm()

    async def invoke_with_fallback(self, messages: list) -> Any:
        """
        Call the LLM with automatic fallback:
        1. Try primary LLM (OpenAI gpt-4o-mini)
        2. On quota/rate error → try Anthropic
        3. On all failures → raise LLMUnavailableError with a clear message
        """
        if self.llm is None:
            raise LLMUnavailableError(
                "No LLM API key configured. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file."
            )

        try:
            return await self.llm.ainvoke(messages)
        except Exception as primary_err:
            err_str = str(primary_err).lower()
            is_quota = "429" in str(primary_err) or "insufficient_quota" in err_str or "rate_limit" in err_str
            is_auth = "401" in str(primary_err) or "invalid_api_key" in err_str

            if is_quota or is_auth:
                logger.warning(f"Primary LLM failed ({type(primary_err).__name__}): {primary_err}")
                fallback = get_fallback_llm()
                if fallback:
                    logger.info("Switching to Anthropic fallback...")
                    try:
                        return await fallback.ainvoke(messages)
                    except Exception as fb_err:
                        raise LLMUnavailableError(
                            f"Both OpenAI and Anthropic failed.\n"
                            f"OpenAI: {primary_err}\n"
                            f"Anthropic: {fb_err}"
                        )

                # No fallback available — give a clear actionable message
                if is_quota:
                    raise LLMUnavailableError(
                        "OpenAI quota exceeded.\n\n"
                        "To fix this:\n"
                        "1. Add credits at https://platform.openai.com/account/billing\n"
                        "2. Or add a valid Anthropic API key (starts with sk-ant-) to ANTHROPIC_API_KEY in your .env\n\n"
                        "Note: The key in your .env starting with 'crsr_' is a Cursor token, not an Anthropic key."
                    )
                raise LLMUnavailableError(f"LLM authentication failed: {primary_err}")

            raise  # re-raise non-quota errors as-is

    async def stream_with_fallback(self, messages: list) -> AsyncGenerator[str, None]:
        """
        Stream LLM output with automatic fallback to Anthropic on quota errors.
        Yields string chunks.
        """
        if self.llm is None:
            raise LLMUnavailableError(
                "No LLM API key configured. Please add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env"
            )

        try:
            async for chunk in self.llm.astream(messages):
                if chunk.content:
                    yield chunk.content
            return
        except Exception as primary_err:
            err_str = str(primary_err).lower()
            is_quota = "429" in str(primary_err) or "insufficient_quota" in err_str or "rate_limit" in err_str
            is_auth = "401" in str(primary_err) or "invalid_api_key" in err_str

            if is_quota or is_auth:
                logger.warning(f"Primary LLM stream failed: {primary_err}")
                fallback = get_fallback_llm()
                if fallback:
                    try:
                        async for chunk in fallback.astream(messages):
                            if chunk.content:
                                yield chunk.content
                        return
                    except Exception as fb_err:
                        raise LLMUnavailableError(
                            f"Both OpenAI and Anthropic failed.\n"
                            f"OpenAI: {primary_err}\n"
                            f"Anthropic: {fb_err}"
                        )
                # No fallback
                if is_quota:
                    raise LLMUnavailableError(
                        "OpenAI quota exceeded. Please add billing credits at "
                        "https://platform.openai.com/account/billing or configure a valid "
                        "ANTHROPIC_API_KEY (starts with sk-ant-) in your .env file."
                    )
            raise

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute the agent with the given context and return results."""
        pass

    def _log(self, message: str):
        text = f"[{self.name.upper()}] {message}"
        encoding = (getattr(sys.stdout, "encoding", None) or "utf-8")
        safe_text = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
        print(safe_text)
