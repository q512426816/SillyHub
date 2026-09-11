"""``/api/skill-sources`` admin CRUD + ``/api/skills/*`` 技能库/启用绑定（task-03）。

Change: 2026-09-11-skills-central-library (task-01 + task-03)

权限:
- 源 CRUD 五端点（design REST 清单：均 admin）：
  ``require_permission_any(Permission.SETTINGS_ADMIN)``（settings/router.py:55
  同款先例；is_platform_admin 短路 + 平台级授权，见 auth/rbac.has_permission）。
- ``GET /api/skills/library`` + ``POST/DELETE /api/skills/{skill_key}/enable``
  （task-03）：任意登录用户——``get_current_user``（skills/router.py:41 先例）。
  「本人」由依赖注入的当前用户天然保证（无 user_id 参数，无 admin 代写面）。

端点契约（design §接口定义）:
- GET    /api/skill-sources                  → list（admin）
- POST   /api/skill-sources                  → create（201；SSRF 400/git 缺 422 在 service）
- PATCH  /api/skill-sources/{id}             → update（admin）
- DELETE /api/skill-sources/{id}             → 204（连带清绑定+缓存目录在 service）
- POST   /api/skill-sources/{id}/refresh     → refresh（admin；git 缺 422）
- GET    /api/skills/library                 → LibraryView 三源聚合（登录即可；
  可选 ``?workspace_id=`` 并集启用态，bridges task-01）
- POST   /api/skills/{skill_key}/enable      → 204（body EnableOp；格式 422/未命中 404；
  可选 ``?workspace_id=`` 切 workspace 维度，成员校验 403 在 service）
- DELETE /api/skills/{skill_key}/enable      → 204（幂等停用；可选 ``?workspace_id=``
  同上；user 维度谓词显式 IS NULL 不误删 ws 行——D-010）

``skill_key`` 含冒号（``<source_id>:<目录名>``）：冒号是 RFC 3986 路径合法
字符，路径参数原样可达；客户端 %-encoding（``%3A``）亦被 ASGI 规范解码。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.skill_source.model import SkillSource
from app.modules.skill_source.schema import (
    EnableOp,
    LibraryView,
    SourceCreate,
    SourceRead,
    SourceUpdate,
)
from app.modules.skill_source.service import SkillSourceService

router = APIRouter(tags=["skill-sources"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# admin 门：SETTINGS_ADMIN（settings/router.py:55 / mcp_registry router 同款）。
_settings_admin_check = require_permission_any(Permission.SETTINGS_ADMIN)
SettingsAdminUser = Annotated[User, Depends(_settings_admin_check)]
# task-03 门：任意登录用户（skills/router.py:41 CurrentUser 先例；本人语义）。
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/skill-sources", response_model=list[SourceRead])
async def list_skill_sources(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> list[SkillSource]:
    """列出全部 git 技能源（admin）。"""
    return await SkillSourceService(session).list_()


@router.post(
    "/skill-sources",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_skill_source(
    payload: SourceCreate,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> SkillSource:
    """创建源（admin；SSRF 校验 + git 探测在 service）。"""
    return await SkillSourceService(session).create(
        url=payload.url,
        branch=payload.branch,
        subdir=payload.subdir,
    )


@router.patch("/skill-sources/{source_id}", response_model=SourceRead)
async def update_skill_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> SkillSource:
    """部分更新（admin；改 url 重新过 SSRF 校验）。"""
    return await SkillSourceService(session).update(
        source_id,
        url=payload.url,
        branch=payload.branch,
        subdir=payload.subdir,
        enabled=payload.enabled,
    )


@router.delete("/skill-sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill_source(
    source_id: uuid.UUID,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> None:
    """删除源（admin；连带清 user_skill_enables 绑定与缓存目录）。"""
    await SkillSourceService(session).delete(source_id)


@router.post("/skill-sources/{source_id}/refresh", response_model=SourceRead)
async def refresh_skill_source(
    source_id: uuid.UUID,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> SkillSource:
    """手动刷新源（admin；git 缺失 422，真实拉取归 task-02）。"""
    return await SkillSourceService(session).refresh(source_id)


# ── 技能库 + 启用绑定（task-03；任意登录用户）──────────────────────────


@router.get("/skills/library", response_model=LibraryView)
async def get_skills_library(
    session: SessionDep,
    user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
) -> LibraryView:
    """技能库三源聚合 + 启用态（登录即可；git 技能默认关，D-003）。

    可选 ``?workspace_id=``：带上看 user ∪ workspace 并集启用态（成员校验
    403 在 service）；不带 = user 视图（显式 IS NULL，D-010——不传行为不变）。
    """
    return await SkillSourceService(session).list_library(user, workspace_id=workspace_id)


@router.post("/skills/{skill_key}/enable", status_code=status.HTTP_204_NO_CONTENT)
async def enable_skill(
    skill_key: str,
    payload: EnableOp,
    session: SessionDep,
    user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
) -> None:
    """启用/停用一个 git 技能（本人；body ``enabled``，幂等）。

    ``skill_key`` 格式非法 → 422；未命中启用源的发现结果 → 404（service 层）。
    可选 ``?workspace_id=``：切 workspace 维度（成员校验 403、谓词带 scope
    在 service；不传 = user 维度旧行为不变）。
    """
    await SkillSourceService(session).toggle_enable(
        skill_key, user, enabled=payload.enabled, workspace_id=workspace_id
    )


@router.delete("/skills/{skill_key}/enable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_skill(
    skill_key: str,
    session: SessionDep,
    user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
) -> None:
    """停用一个 git 技能（本人；幂等——无绑定也 204）。

    可选 ``?workspace_id=``：停 workspace 维度绑定（成员校验 403 在 service；
    user 维度删除谓词显式 IS NULL，不误删 ws 行——D-010）。
    """
    await SkillSourceService(session).toggle_enable(
        skill_key, user, enabled=False, workspace_id=workspace_id
    )
