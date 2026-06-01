"""Health & version routes.

The health endpoint intentionally returns HTTP 200 even when dependencies are
degraded, so that a load balancer keeps the pod in rotation while alarms fire
on ``status="degraded"``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.health.schema import (
    DependencyStatus,
    HealthResponse,
    OverallStatus,
    VersionResponse,
)

router = APIRouter(tags=["health"])
log = get_logger(__name__)


async def _check_db() -> DependencyStatus:
    try:
        factory = get_session_factory()
        async with factory() as session:
            await session.execute(text("SELECT 1"))
        return "ok"
    except Exception as exc:
        log.warning("health.db.down", error=str(exc))
        return "down"


async def _check_redis() -> DependencyStatus:
    try:
        client = get_redis()
        pong = await client.ping()  # type: ignore[misc]  # redis-py async stubs are loose
        return "ok" if pong else "down"
    except Exception as exc:
        log.warning("health.redis.down", error=str(exc))
        return "down"


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    db_status = await _check_db()
    redis_status = await _check_redis()
    overall: OverallStatus = "ok" if db_status == "ok" and redis_status == "ok" else "degraded"
    return HealthResponse(
        status=overall,
        db=db_status,
        redis=redis_status,
        version=__version__,
        commit_sha=settings.resolved_commit_sha,
        server_time=datetime.now(tz=UTC),
        environment=settings.environment,
    )


@router.get("/version", response_model=VersionResponse)
async def version() -> VersionResponse:
    settings = get_settings()
    return VersionResponse(
        version=__version__,
        commit_sha=settings.resolved_commit_sha,
        environment=settings.environment,
    )
