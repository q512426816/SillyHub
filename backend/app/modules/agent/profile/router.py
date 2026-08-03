"""AgentProfile HTTP 路由 — workspace 级 + platform 级 CRUD/copy。

Change ``2026-08-02-agent-profile-layer`` task-04 / design §11（文件清单）/
D-011。本模块是 profile 域的薄 HTTP 层：参数翻译 + 依赖注入，业务全委派给
task-03 的 :class:`AgentProfileService`（鉴权 / visibility / 兜底链 / 交集计算）。

两类端点（design §3.1 visibility 双入口）：

* **workspace 级**（``/api/workspaces/{workspace_id}/agent-profiles``）：挂
  ``{workspace_id}`` 路径参数，复用现有 RBAC（``require_permission`` 自动注入
  workspace_id 到 ``has_permission`` 闭包，与 members_router 同模式）。GET 用
  ``WORKSPACE_READ``（任意成员可读档案），POST/PATCH/DELETE/copy 用
  ``WORKSPACE_WRITE``（owner/developer 可管理，viewer 只读）。
* **platform 级**（``/api/agent-profiles``）：列表对任意登录用户开放（platform
  visibility = 全平台可见，D-009）；单档 GET/PATCH/DELETE 仅 admin（平台预置
  档案的管理面，复用 ``require_platform_admin``）。

DTO（Pydantic）定义在本模块内（task-04 allowed_paths 仅 router.py，未含
schema.py）。响应 DTO 用 ``from_attributes=True`` 直接从 ORM 行构造。update 用
``exclude_unset=True`` 仅传显式提供的字段（与 WorkspaceUpdate 同语义：省略=不动，
null=清空）。

异常风格：service 抛 ``AppError`` 子类（404/403/400），由全局 ``AppError`` handler
统一序列化（``code/message/details``），router 不额外捕获。workspace 不存在由
``require_permission`` 先拦（非 admin 返 403；admin 短路则由本模块
``_load_workspace`` 兜底 404）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import (
    get_current_user,
    require_permission,
    require_platform_admin,
)
from app.core.db import get_session
from app.core.errors import WorkspaceNotFound
from app.modules.agent.profile.model import AgentProfileVisibility
from app.modules.agent.profile.service import AgentProfileService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.workspace.model import Workspace

router = APIRouter(tags=["agent-profiles"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ────────────────────────────────────────────────────────────────────────────
# DTO（请求/响应）— 定义在 router 内，task-04 allowed_paths 未含 schema.py。
# ────────────────────────────────────────────────────────────────────────────


class AgentProfileRead(BaseModel):
    """档案响应 DTO。``from_attributes`` 直接读 ORM 行（visibility 经 Pydantic
    还原为 :class:`AgentProfileVisibility` 枚举，DB 存 String）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    owner_user_id: uuid.UUID | None
    workspace_id: uuid.UUID | None
    visibility: AgentProfileVisibility
    provider: str
    model: str | None
    system_prompt: str | None
    tool_policy_id: uuid.UUID | None
    mcp_refs: list[str]
    skill_refs: list[str]
    allowed_roots_overlay: list[str] | None
    version: int
    is_system_default: bool
    created_at: datetime
    updated_at: datetime


class AgentProfileListResponse(BaseModel):
    items: list[AgentProfileRead]


class AgentProfileCreate(BaseModel):
    """建档请求。``visibility`` 决定 workspace_id 归属与建案权（service.create
    内校验）：private=owner 自用 / workspace=指定 ws 成员可建 / platform=仅 admin。
    ``provider`` 必填（作 target_provider，D-014）。"""

    name: str = Field(min_length=1, max_length=200)
    visibility: AgentProfileVisibility = AgentProfileVisibility.PRIVATE
    provider: str = Field(min_length=1, max_length=64)
    model: str | None = Field(default=None, max_length=128)
    system_prompt: str | None = Field(default=None)
    tool_policy_id: uuid.UUID | None = None
    mcp_refs: list[str] = Field(default_factory=list)
    skill_refs: list[str] = Field(default_factory=list)
    allowed_roots_overlay: list[str] | None = None


class AgentProfileUpdate(BaseModel):
    """部分更新请求。全字段可选；router 用 ``exclude_unset=True`` 仅传显式提供
    的字段（省略=不动，显式 null=清空）。``workspace_id`` 不经此 DTO 暴露（跨
    ws 移动为 admin 专能，service 仍支持但无 API 入口，防越权）。"""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    visibility: AgentProfileVisibility | None = None
    provider: str | None = Field(default=None, min_length=1, max_length=64)
    model: str | None = Field(default=None, max_length=128)
    system_prompt: str | None = None
    tool_policy_id: uuid.UUID | None = None
    mcp_refs: list[str] | None = None
    skill_refs: list[str] | None = None
    allowed_roots_overlay: list[str] | None = None


class AgentProfileCopyRequest(BaseModel):
    """复制请求。源档内容（provider/model/system_prompt/mcp/skill/overlay）原样
    复制，新档 owner=actor、version=1、is_system_default=False（service.copy）。
    ``name`` 省略时取「{原名}（副本）」，``visibility`` 省略时 private。"""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    visibility: AgentProfileVisibility | None = None


# ────────────────────────────────────────────────────────────────────────────
# 内部 helper
# ────────────────────────────────────────────────────────────────────────────


async def _load_workspace(session: AsyncSession, workspace_id: uuid.UUID) -> Workspace:
    """按 id 载入 workspace，缺失 → 404。

    平台 admin 经 ``require_permission`` 短路（has_permission 第 1 档 is_platform_admin
    返 True，不查 user_workspace_roles），可能对不存在的 workspace_id 也通过依赖；
    故建档/列表前在此兜底 404，避免把 None workspace 传进 service。
    """
    ws = await session.get(Workspace, workspace_id)
    if ws is None:
        raise WorkspaceNotFound(
            "Workspace not found.",
            details={"workspace_id": str(workspace_id)},
        )
    return ws


def _service(session: AsyncSession) -> AgentProfileService:
    return AgentProfileService(session)


# ════════════════════════════════════════════════════════════════════════════
# workspace 级端点：/workspaces/{workspace_id}/agent-profiles
# require_permission 自动从路径取 {workspace_id} 注入 RBAC 闭包（members_router 同模式）。
# ════════════════════════════════════════════════════════════════════════════


@router.get(
    "/workspaces/{workspace_id}/agent-profiles",
    response_model=AgentProfileListResponse,
)
async def list_workspace_profiles(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> AgentProfileListResponse:
    """列出 actor 在该 workspace 可见的档案（platform 全档 + workspace 级成员可
    见档 + actor 自己的 private 档）。"""
    workspace = await _load_workspace(session, workspace_id)
    actor = _user
    profiles = await _service(session).list(actor=actor, workspace=workspace)
    return AgentProfileListResponse(items=[AgentProfileRead.model_validate(p) for p in profiles])


@router.post(
    "/workspaces/{workspace_id}/agent-profiles",
    response_model=AgentProfileRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace_profile(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: AgentProfileCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> AgentProfileRead:
    """在该 workspace 下新建档案。visibility 决定归属与建案权（service.create）：
    workspace 级需成员（已由 WORKSPACE_WRITE 依赖保证），platform 级需 admin
    （service 内判 is_platform_admin），private 任何已认证用户可建。"""
    workspace = await _load_workspace(session, workspace_id)
    profile = await _service(session).create(
        name=payload.name,
        visibility=payload.visibility,
        provider=payload.provider,
        actor=user,
        workspace=workspace,
        model=payload.model,
        system_prompt=payload.system_prompt,
        tool_policy_id=payload.tool_policy_id,
        mcp_refs=payload.mcp_refs,
        skill_refs=payload.skill_refs,
        allowed_roots_overlay=payload.allowed_roots_overlay,
    )
    return AgentProfileRead.model_validate(profile)


@router.get(
    "/workspaces/{workspace_id}/agent-profiles/{profile_id}",
    response_model=AgentProfileRead,
)
async def get_workspace_profile(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    profile_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> AgentProfileRead:
    """取单档。service.get 自带三级 visibility 读校验：不存在→404，不可见→403。"""
    actor = _user
    profile = await _service(session).get(profile_id=profile_id, actor=actor)
    return AgentProfileRead.model_validate(profile)


@router.patch(
    "/workspaces/{workspace_id}/agent-profiles/{profile_id}",
    response_model=AgentProfileRead,
)
async def update_workspace_profile(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    profile_id: Annotated[uuid.UUID, Path(...)],
    payload: AgentProfileUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> AgentProfileRead:
    """部分更新（version +1）。仅传显式字段；改 visibility→platform 需 admin
    （service 内判）。service.update 自带改权限校验（owner/成员/admin）。"""
    # exclude_unset：省略=不动，显式 null=清空。visibility 经 model_dump(mode=python)
    # 保留为 AgentProfileVisibility 枚举成员（service 用 `is` 比较需枚举成员）。
    fields = payload.model_dump(exclude_unset=True)
    profile = await _service(session).update(profile_id=profile_id, actor=user, fields=fields)
    return AgentProfileRead.model_validate(profile)


@router.delete(
    "/workspaces/{workspace_id}/agent-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workspace_profile(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    profile_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> None:
    """删除。系统默认档案被删后由 startup hook 补种（task-11）。service.delete
    自带改权限校验。"""
    await _service(session).delete(profile_id=profile_id, actor=user)
    return None


@router.post(
    "/workspaces/{workspace_id}/agent-profiles/{profile_id}/copy",
    response_model=AgentProfileRead,
    status_code=status.HTTP_201_CREATED,
)
async def copy_workspace_profile(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    profile_id: Annotated[uuid.UUID, Path(...)],
    payload: AgentProfileCopyRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> AgentProfileRead:
    """复制源档内容到 actor 名下新档（Non-Goals：复制替代 N:N 活引用共享）。
    新档默认 private + 无 workspace；可指定 visibility/workspace（建案权经
    service.create 复用）。"""
    workspace = await _load_workspace(session, workspace_id)
    # 调用方指定 workspace 级副本时落到当前 workspace；否则 None（private）。
    target_ws: Workspace | None = (
        workspace if payload.visibility == AgentProfileVisibility.WORKSPACE else None
    )
    profile = await _service(session).copy(
        profile_id=profile_id,
        actor=user,
        name=payload.name,
        visibility=payload.visibility,
        workspace=target_ws,
    )
    return AgentProfileRead.model_validate(profile)


# ════════════════════════════════════════════════════════════════════════════
# platform 级端点：/agent-profiles
# 列表对任意登录用户开放（platform visibility 全平台可见，D-009）；单档
# GET/PATCH/DELETE 仅 admin（平台预置档案管理面）。
# ════════════════════════════════════════════════════════════════════════════


@router.get(
    "/agent-profiles",
    response_model=AgentProfileListResponse,
)
async def list_platform_profiles(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> AgentProfileListResponse:
    """列出 platform 可见档案（+ actor 自己的 private 档）。任意登录用户可调
    （platform 级档案全平台可见，D-009）。"""
    profiles = await _service(session).list(actor=user, workspace=None)
    return AgentProfileListResponse(items=[AgentProfileRead.model_validate(p) for p in profiles])


@router.get(
    "/agent-profiles/{profile_id}",
    response_model=AgentProfileRead,
)
async def get_platform_profile(
    profile_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _admin: Annotated[User, Depends(require_platform_admin)],
) -> AgentProfileRead:
    """平台维度取单档（仅 admin）。service.get 自带三级 visibility 读校验。"""
    profile = await _service(session).get(profile_id=profile_id, actor=_admin)
    return AgentProfileRead.model_validate(profile)


@router.patch(
    "/agent-profiles/{profile_id}",
    response_model=AgentProfileRead,
)
async def update_platform_profile(
    profile_id: Annotated[uuid.UUID, Path(...)],
    payload: AgentProfileUpdate,
    session: SessionDep,
    admin: Annotated[User, Depends(require_platform_admin)],
) -> AgentProfileRead:
    """平台维度更新（仅 admin，用于编辑平台预置档案）。version +1。"""
    fields = payload.model_dump(exclude_unset=True)
    profile = await _service(session).update(profile_id=profile_id, actor=admin, fields=fields)
    return AgentProfileRead.model_validate(profile)


@router.delete(
    "/agent-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_platform_profile(
    profile_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    admin: Annotated[User, Depends(require_platform_admin)],
) -> None:
    """平台维度删除（仅 admin）。系统默认档案被删后由 startup hook 补种（task-11）。"""
    await _service(session).delete(profile_id=profile_id, actor=admin)
    return None
