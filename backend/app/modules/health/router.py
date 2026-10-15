"""Health & version routes.

The health endpoint intentionally returns HTTP 200 even when dependencies are
degraded, so that a load balancer keeps the pod in rotation while alarms fire
on ``status="degraded"``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app import __version__
from app.core.auth_deps import require_permission_any
from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.health.schema import (
    DependencyStatus,
    HealthResponse,
    OverallStatus,
    SystemStatusResponse,
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


@router.get("/system-status", response_model=SystemStatusResponse)
async def system_status(
    user: Annotated[User, Depends(require_permission_any(Permission.SYSTEM_STATUS_READ))],
) -> SystemStatusResponse:
    """服务器性能(psutil,丢线程池) + 业务统计(系统管理「服务器信息」页看板)。

    change 2026-10-14-admin-server-status D-001@v2：由公开端点收紧为登录 +
    system_status:read 权限（关闭审计 BS-6 匿名暴露；platform:admin 直通，
    服务器信息页仅持权限者可见）。
    """
    import anyio
    import psutil
    from sqlalchemy import func, select

    from app.modules.ppm.plan.model import PsPlanNode
    from app.modules.ppm.project.model import PpmProjectMaintenance
    from app.modules.ppm.task.model import PlanTask

    def _perf() -> dict[str, float]:
        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        return {
            "cpu_percent": psutil.cpu_percent(interval=None),
            "memory_percent": vm.percent,
            "memory_used_mb": round(vm.used / 1024 / 1024, 1),
            "memory_total_mb": round(vm.total / 1024 / 1024, 1),
            "disk_percent": du.percent,
            "disk_used_gb": round(du.used / 1024 / 1024 / 1024, 1),
            "disk_total_gb": round(du.total / 1024 / 1024 / 1024, 1),
        }

    perf = await anyio.to_thread.run_sync(_perf)
    factory = get_session_factory()
    async with factory() as session:
        tasks = (await session.execute(select(func.count()).select_from(PlanTask))).scalar() or 0
        projects = (
            await session.execute(select(func.count()).select_from(PpmProjectMaintenance))
        ).scalar() or 0
        milestones = (
            await session.execute(select(func.count()).select_from(PsPlanNode))
        ).scalar() or 0
        users = (await session.execute(select(func.count()).select_from(User))).scalar() or 0
    return SystemStatusResponse(
        server_time=datetime.now(tz=UTC),
        **perf,
        tasks=tasks,
        projects=projects,
        milestones=milestones,
        users=users,
    )
