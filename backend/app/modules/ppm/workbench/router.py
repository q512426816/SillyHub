"""workbench 子域 API 端点 —— 平台级,统一前缀 ``/api/ppm``。

权限:统一 ``PPM_TASK_READ`` (``require_permission_any``,平台级,D-009@v1
复用现有权限,不新建)。

仅暴露骨架端点 (GET /workbench/profile|summary|calendar),handler
实例化 :class:`WorkbenchService` 调对应方法;service 方法体留空
``NotImplementedError``,实际装配由 task-03/04/05 实现。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_session, require_permission_any
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.workbench.schema import (
    WorkbenchCalendar,
    WorkbenchProfile,
    WorkbenchSummary,
)
from app.modules.ppm.workbench.service import WorkbenchService

# 前缀由 ``app.main`` 统一以 ``prefix="/api/ppm"`` 挂载,本 router 不自带 prefix
router = APIRouter(tags=["ppm-workbench"])

# 依赖类型别名 (Annotated 风格,对齐 task/router.py L55-63)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 统一权限 PPM_TASK_READ (D-009@v1)
WorkbenchReadUser = Annotated[User, Depends(require_permission_any(Permission.PPM_TASK_READ))]


@router.get("/workbench/profile", response_model=WorkbenchProfile)
async def get_workbench_profile(
    session: SessionDep,
    user: WorkbenchReadUser,
) -> WorkbenchProfile:
    """当前登录用户的个人工作台头部信息。"""
    svc = WorkbenchService(session)
    return await svc.get_profile(user)


@router.get("/workbench/summary", response_model=WorkbenchSummary)
async def get_workbench_summary(
    session: SessionDep,
    user: WorkbenchReadUser,
    range: str = Query("month", description="统计区间标识 (如 month / week)"),
) -> WorkbenchSummary:
    """个人工作台聚合视图:指标卡片 + 待办列表。"""
    svc = WorkbenchService(session)
    return await svc.get_summary(user, range)


@router.get("/workbench/calendar", response_model=WorkbenchCalendar)
async def get_workbench_calendar(
    session: SessionDep,
    user: WorkbenchReadUser,
    year_month: str = Query(..., description="目标月份,形如 YYYY-MM"),
) -> WorkbenchCalendar:
    """个人工作台月度日历负载。"""
    svc = WorkbenchService(session)
    return await svc.get_calendar(user, year_month)


__all__ = ["router"]
