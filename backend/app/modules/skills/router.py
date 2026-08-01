"""``/api/custom-skills`` — per-user CustomSkill CRUD.

Change: 2026-07-31-custom-skill-per-user (task-03)

权限（design D-003）：任意登录用户。
技能是个人资产，登录用户即可管理自己的技能；per-user 隔离在 service 层
（按 ``created_by == user_id`` 过滤 / 校验归属），router 仅透传 ``user.id``。
权限依赖复用 ``app.core.auth_deps.get_current_user``。

端点契约:
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

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.skills.schema import (
    CustomSkillCreate,
    CustomSkillDetail,
    CustomSkillRead,
    CustomSkillUpdate,
)
from app.modules.skills.service import CustomSkillService

router = APIRouter(tags=["custom-skills"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# D-003: 任意登录用户即可（不再要求 SETTINGS_ADMIN）。
CurrentUser = Annotated[User, Depends(get_current_user)]


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
    user: CurrentUser,
) -> list[CustomSkillRead]:
    """列出当前用户的 CustomSkill（不含 content，含 content_preview）。"""
    skills = await CustomSkillService(session).list_(user.id)
    return [_to_read(s) for s in skills]


@router.post(
    "/custom-skills",
    response_model=CustomSkillDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_custom_skill(
    payload: CustomSkillCreate,
    session: SessionDep,
    user: CurrentUser,
) -> CustomSkillDetail:
    """创建 CustomSkill（name 字符集/前缀/unique 校验在 service 层）。"""
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
    user: CurrentUser,
) -> CustomSkillDetail:
    """详情（含完整 content；service 校验归属，非本人 404）。"""
    skill = await CustomSkillService(session).get(skill_id, user.id)
    return _to_detail(skill)


@router.put("/custom-skills/{skill_id}", response_model=CustomSkillDetail)
async def update_custom_skill(
    skill_id: uuid.UUID,
    payload: CustomSkillUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> CustomSkillDetail:
    """部分更新（name/description/content 任一可选；service 校验归属）。"""
    skill = await CustomSkillService(session).update(
        skill_id,
        user.id,
        name=payload.name,
        description=payload.description,
        content=payload.content,
    )
    return _to_detail(skill)


@router.delete("/custom-skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_skill(
    skill_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    """删除 CustomSkill（service 校验归属，非本人 404）。"""
    await CustomSkillService(session).delete(skill_id, user.id)
