"""HTTP routes for runtime progress and artifacts."""

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
from app.modules.runtime.service import RuntimeService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["runtime"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/runtime", response_model=RuntimeProgress | None, response_model_by_alias=False)
async def get_runtime_progress(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))],
) -> RuntimeProgress | None:
    service = RuntimeService(session)
    return await service.get_progress(workspace_id)


@router.get("/runtime/user-inputs", response_model=list[UserInputEntry])
async def get_runtime_user_inputs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))],
) -> list[UserInputEntry]:
    service = RuntimeService(session)
    return await service.get_user_inputs(workspace_id)


@router.get("/runtime/user-inputs/raw", response_class=PlainTextResponse)
async def get_runtime_user_inputs_raw(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))],
) -> str:
    service = RuntimeService(session)
    return await service.get_user_inputs_raw(workspace_id) or ""


@router.get("/runtime/artifacts", response_model=list[ArtifactEntry])
async def get_runtime_artifacts(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))],
) -> list[ArtifactEntry]:
    service = RuntimeService(session)
    return await service.get_artifacts(workspace_id)


@router.get("/runtime/artifacts/{filename}", response_class=PlainTextResponse)
async def get_runtime_artifact_content(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.RUNTIME_READ))],
) -> str:
    service = RuntimeService(session)
    return await service.get_artifact_content(workspace_id, filename) or ""
