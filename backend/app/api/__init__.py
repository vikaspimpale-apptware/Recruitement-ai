from fastapi import APIRouter
from app.api.routes import auth, workflows, candidates, outreach, chat, analytics, scheduling

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(workflows.router)
api_router.include_router(candidates.router)
api_router.include_router(outreach.router)
api_router.include_router(scheduling.router)
api_router.include_router(chat.router)
api_router.include_router(analytics.router)
