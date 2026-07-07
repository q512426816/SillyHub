"""``/api/custom-skills`` — platform-level CustomSkill admin CRUD.

Change: 2026-07-07-skills-mcp-management-ui (task-02)

权限（design §5.4 / task-04 已确认）：``SETTINGS_ADMIN``。
design 原文写 ``MANAGE_PLATFORM``，但 :class:`Permission` 枚举无此项；
系统 settings 子菜单专用 admin 权限为 ``SETTINGS_ADMIN``（见
permissions.py:45 注释），MCP / Skills 同属 platform settings 子项，
沿用 settings/router 现有的 ``SettingsAdminUser`` 零迁移风险且语义自洽。

端点契约（task-02 蓝图）:
- GET    /api/custom-skills            → list（不含 content，含 content_preview）
- POST   /api/custom-skills            → create（201）
- GET    /api/custom-skills/{id}       → detail（含完整 content）
- PUT    /api/custom-skills/{id}       → update
- DELETE /api/custom-skills/{id}       → 204
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
from app.modules.skills.schema import (
    CustomSkillCreate,
    CustomSkillDetail,
    CustomSkillRead,
    CustomSkillUpdate,
)
from app.modules.skills.service import CustomSkillService

router = APIRouter(tags=["custom-skills"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# task-04 已确认用 SETTINGS_ADMIN（非 design 写的 MANAGE_PLATFORM）。
SettingsAdminUser = Annotated[User, Depends(require_permission_any(Permission.SETTINGS_ADMIN))]


def _to_read(skill) -> CustomSkillRead:
    return CustomSkillRead(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        content_preview=CustomSkillService.preview(skill.content),
        created_by=skill.created_by,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    )


def _to_detail(skill) -> CustomSkillDetail:
    return CustomSkillDetail(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        content_preview=CustomSkillService.preview(skill.content),
        created_by=skill.created_by,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
        content=skill.content,
    )


@router.get("/custom-skills", response_model=list[CustomSkillRead])
async def list_custom_skills(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> list[CustomSkillRead]:
    """列出全部平台 CustomSkill（不含 content，含 content_preview）。"""
    skills = await CustomSkillService(session).list_()
    return [_to_read(s) for s in skills]


@router.post(
    "/custom-skills",
    response_model=CustomSkillDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_custom_skill(
    payload: CustomSkillCreate,
    session: SessionDep,
    user: SettingsAdminUser,
) -> CustomSkillDetail:
    """创建平台 CustomSkill（name 字符集/前缀/unique 校验在 service 层）。"""
    skill = await CustomSkillService(session).create(
        name=payload.name,
        description=payload.description,
        content=payload.content,
        created_by=user.id,
    )
    return _to_detail(skill)


@router.get("/custom-skills/{skill_id}", response_model=CustomSkillDetail)
async def get_custom_skill(
    skill_id: uuid.UUID,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> CustomSkillDetail:
    """详情（含完整 content）。"""
    skill = await CustomSkillService(session).get(skill_id)
    return _to_detail(skill)


@router.put("/custom-skills/{skill_id}", response_model=CustomSkillDetail)
async def update_custom_skill(
    skill_id: uuid.UUID,
    payload: CustomSkillUpdate,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> CustomSkillDetail:
    """部分更新（name/description/content 任一可选）。"""
    skill = await CustomSkillService(session).update(
        skill_id,
        name=payload.name,
        description=payload.description,
        content=payload.content,
    )
    return _to_detail(skill)


@router.delete("/custom-skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_skill(
    skill_id: uuid.UUID,
    session: SessionDep,
    _user: SettingsAdminUser,
) -> None:
    """删除平台 CustomSkill。"""
    await CustomSkillService(session).delete(skill_id)
