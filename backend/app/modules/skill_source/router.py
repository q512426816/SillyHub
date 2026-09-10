"""``/api/skill-sources`` — git 技能源 admin CRUD 五端点。

Change: 2026-09-11-skills-central-library (task-01)

权限（design REST 清单：均 admin）：全端点
``require_permission_any(Permission.SETTINGS_ADMIN)``（settings/router.py:55
同款先例；is_platform_admin 短路 + 平台级授权，见 auth/rbac.has_permission）。

端点契约（design §接口定义）:
- GET    /api/skill-sources                  → list
- POST   /api/skill-sources                  → create（201；SSRF 400/git 缺 422 在 service）
- PATCH  /api/skill-sources/{id}             → update
- DELETE /api/skill-sources/{id}             → 204（连带清绑定+缓存目录在 service）
- POST   /api/skill-sources/{id}/refresh     → refresh（git 缺 422）

task-03 增 ``GET /api/skills/library`` 与 ``POST/DELETE /api/skills/{key}/enable``
（本人），不在本卡。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.skill_source.model import SkillSource
from app.modules.skill_source.schema import (
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
