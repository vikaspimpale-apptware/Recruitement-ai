"""
Optional Redis client. If Redis is unavailable, operations silently no-op.
This allows the POC to run without Redis installed.
"""
from typing import Optional

_redis = None


def get_redis_client():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis.asyncio as aioredis
        from app.core.config import settings
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return _redis
    except Exception:
        return None


async def publish_event(channel: str, data: dict) -> bool:
    """Publish an event to a Redis channel. No-ops silently if Redis is unavailable."""
    import json
    client = get_redis_client()
    if client is None:
        return False
    try:
        await client.publish(channel, json.dumps(data))
        return True
    except Exception:
        return False
