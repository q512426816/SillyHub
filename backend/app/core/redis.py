"""Process-wide Redis client.

A single :class:`redis.asyncio.Redis` instance is reused across the app; it
manages its own connection pool internally.
"""

from __future__ import annotations

from redis.asyncio import Redis, from_url

from app.core.config import get_settings

_client: Redis | None = None


def get_redis() -> Redis:
    """Return (and lazily create) the process-wide async Redis client."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            health_check_interval=30,
        )
    return _client


async def close_redis() -> None:
    """Close the connection pool on application shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None
