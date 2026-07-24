"""workbench 子域 API 端点 —— 平台级,统一前缀 ``/api/ppm``。

权限:统一 ``Depends(get_current_principal)`` 仅认证不授权 (登录用户或合法
API key 的 daemon 即可调用,平台级)。

仅暴露骨架端点 (GET /workbench/profile|summary|calendar),handler
实例化 :class:`WorkbenchService` 调对应方法;service 方法体留空
``NotImplementedError``,实际装配由 task-03/04/05 实现。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, get_session
from app.modules.auth.model import User
from app.modules.ppm.common.crud import Page
from app.modules.ppm.workbench.schema import (
    WorkbenchCalendar,
    WorkbenchProfile,
    WorkbenchSummary,
    WorkbenchSwitchableUser,
    WorkbenchTodoItem,
)
from app.modules.ppm.workbench.service import WorkbenchService

# 前缀由 ``app.main`` 统一以 ``prefix="/api/ppm"`` 挂载,本 router 不自带 prefix
router = APIRouter(tags=["ppm-workbench"])

# 依赖类型别名 (Annotated 风格,对齐 task/router.py L55-63)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
AuthUser = Annotated[User, Depends(get_current_principal)]


@router.get("/workbench/profile", response_model=WorkbenchProfile)
async def get_workbench_profile(
    session: SessionDep,
    user: AuthUser,
    target_user_id: str | None = Query(None, description="切换查看的目标用户 id;空=当前登录人"),
) -> WorkbenchProfile:
    """工作台头部信息(支持切换用户)。"""
    svc = WorkbenchService(session)
    target = await svc._resolve_target_user(user, target_user_id)
    return await svc.get_profile(user, target)


@router.get("/workbench/summary", response_model=WorkbenchSummary)
async def get_workbench_summary(
    session: SessionDep,
    user: AuthUser,
    range: str = Query("month", description="统计区间标识 (如 month / week)"),
    target_user_id: str | None = Query(None, description="切换查看的目标用户 id;空=当前登录人"),
) -> WorkbenchSummary:
    """个人工作台指标聚合(支持切换用户;待办走 /workbench/todos)。"""
    svc = WorkbenchService(session)
    target = await svc._resolve_target_user(user, target_user_id)
    return await svc.get_summary(target, range)


@router.get("/workbench/calendar", response_model=WorkbenchCalendar)
async def get_workbench_calendar(
    session: SessionDep,
    user: AuthUser,
    year_month: str = Query(..., description="目标月份,形如 YYYY-MM"),
    target_user_id: str | None = Query(None, description="切换查看的目标用户 id;空=当前登录人"),
) -> WorkbenchCalendar:
    """个人工作台月度日历负载(支持切换用户)。"""
    svc = WorkbenchService(session)
    target = await svc._resolve_target_user(user, target_user_id)
    return await svc.get_calendar(target, year_month)


@router.get("/workbench/todos", response_model=Page[WorkbenchTodoItem])
async def get_workbench_todos(
    session: SessionDep,
    user: AuthUser,
    target_user_id: str | None = Query(None, description="切换查看的目标用户 id;空=当前登录人"),
    page: int = Query(1, ge=1, description="页码,从 1 起"),
    page_size: int = Query(10, ge=1, le=200, description="每页条数,默认 10"),
) -> Page[WorkbenchTodoItem]:
    """个人工作台待办(分页,默认每页 10 条;支持切换用户)。"""
    svc = WorkbenchService(session)
    target = await svc._resolve_target_user(user, target_user_id)
    return await svc.get_todos(target, page, page_size)


@router.get(
    "/workbench/switchable-users",
    response_model=list[WorkbenchSwitchableUser],
)
async def get_workbench_switchable_users(
    session: SessionDep,
    user: AuthUser,
) -> list[WorkbenchSwitchableUser]:
    """当前登录人可切换查看的用户列表(经理 ‖ super_admin);其余返回空。"""
    svc = WorkbenchService(session)
    return await svc.list_switchable_users(user)


__all__ = ["router"]
