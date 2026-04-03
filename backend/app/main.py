from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import engine, Base
from app.api import api_router
import app.models  # noqa: F401 — ensure all models are registered

def _parse_cors_origins() -> list[str]:
    """Build a stable CORS allow-list for local + deployed frontends."""
    raw_values = [
        settings.FRONTEND_URL,
        settings.FRONTEND_URLS,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://recruitement-ai.vercel.app",
        "https://recruitment-ai.vercel.app",
    ]
    origins: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        for item in str(raw or "").split(","):
            origin = item.strip().rstrip("/")
            if not origin or origin in seen:
                continue
            seen.add(origin)
            origins.append(origin)
    return origins


async def _run_migrations(conn):
    """Apply any missing column additions that CREATE TABLE won't handle on existing DBs."""
    from sqlalchemy import text
    migrations = [
        # phone column added for full candidate contact info
        "ALTER TABLE candidates ADD COLUMN phone VARCHAR(50)",
        # richer profile extraction fields
        "ALTER TABLE candidates ADD COLUMN current_company VARCHAR(255)",
        "ALTER TABLE candidates ADD COLUMN profile_description TEXT",
        "ALTER TABLE candidates ADD COLUMN resume_url VARCHAR(1000)",
        "ALTER TABLE workflows ADD COLUMN job_description TEXT",
    ]
    for sql in migrations:
        try:
            await conn.execute(text(sql))
        except Exception:
            pass  # column already exists — safe to ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_migrations(conn)
    yield
    await engine.dispose()


app = FastAPI(
    title="Recruitment AI Platform",
    description="Multi-agent AI-powered recruitment automation platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_origin_regex=r"^https://[a-zA-Z0-9-]+\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/health")
async def api_health():
    return {"status": "ok", "version": "0.1.0"}
