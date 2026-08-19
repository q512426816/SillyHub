"""HTTP routes for runtime progress and artifacts.

2026-08-19-runtime-live-daemon-read（task-06）：5 端点全部改调
``RuntimeLiveService``——数据源从平台容器快照切换为当前用户绑定 daemon 的
实时状态（design §4.1 方案 A）。URL / 响应结构与原有一致；``/user-inputs``
的逐行解析逻辑随旧 service 迁入此处（service 层只回原文，design §6.1）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.runtime.schema import ArtifactEntry, RuntimeProgress, UserInputEntry
from app.modules.runtime.service import RuntimeLiveService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["runtime"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
UserDep = Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))]


def _parse_user_input_entries(content: str | None) -> list[UserInputEntry]:
    """user-inputs.md 原文 → 条目列表（旧 RuntimeService.get_user_inputs 同解析）。

    跳过空行与 ``#`` 标题行；timestamp 留空与旧行为一致。
    """
    if content is None:
        return []
    entries: list[UserInputEntry] = []
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(UserInputEntry(timestamp="", content=line))
    return entries


@router.get("/runtime", response_model=RuntimeProgress | None)
async def get_runtime_progress(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: UserDep,
) -> RuntimeProgress | None:
    service = RuntimeLiveService(session)
    return await service.get_progress(workspace_id, user.id)


@router.get("/runtime/user-inputs", response_model=list[UserInputEntry])
async def get_runtime_user_inputs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: UserDep,
) -> list[UserInputEntry]:
    service = RuntimeLiveService(session)
    content = await service.get_user_inputs(workspace_id, user.id)
    return _parse_user_input_entries(content)


@router.get("/runtime/user-inputs/raw", response_class=PlainTextResponse)
async def get_runtime_user_inputs_raw(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: UserDep,
) -> str:
    service = RuntimeLiveService(session)
    return await service.get_user_inputs(workspace_id, user.id) or ""


@router.get("/runtime/artifacts", response_model=list[ArtifactEntry])
async def get_runtime_artifacts(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: UserDep,
) -> list[ArtifactEntry]:
    service = RuntimeLiveService(session)
    return await service.get_artifacts(workspace_id, user.id)


@router.get("/runtime/artifacts/{filename}", response_class=PlainTextResponse)
async def get_runtime_artifact_content(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    user: UserDep,
) -> str:
    service = RuntimeLiveService(session)
    return await service.get_artifact_content(workspace_id, user.id, filename) or ""
