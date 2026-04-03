from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_ENV: str = "development"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # Default: SQLite for local dev. Override with postgresql+asyncpg://... for production.
    DATABASE_URL: str = "sqlite+aiosqlite:///./recruitment_ai.db"
    SYNC_DATABASE_URL: str = "sqlite:///./recruitment_ai.db"

    REDIS_URL: str = "redis://localhost:6379"

    OPENAI_API_KEY: str = ""
    # gpt-4o-mini is ~10x cheaper than gpt-4o and uses the same API key.
    # Change to gpt-4o if you have sufficient quota.
    OPENAI_MODEL: str = "gpt-4o-mini"

    ANTHROPIC_API_KEY: str = ""
    # Valid Anthropic keys start with sk-ant-
    # The crsr_ prefix is a Cursor token and will NOT work here.
    ANTHROPIC_MODEL: str = "claude-3-5-haiku-20241022"

    EXA_API_KEY: str = ""

    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = "recruiter@yourcompany.com"
    SENDGRID_INBOUND_WEBHOOK_SECRET: str = ""

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/calendar/google/callback"

    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_REDIRECT_URI: str = "http://localhost:8000/api/calendar/outlook/callback"

    FRONTEND_URL: str = "http://localhost:5173"
    FRONTEND_URLS: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
