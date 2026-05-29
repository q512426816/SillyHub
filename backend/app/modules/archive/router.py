"""Archive API endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.archive.service import ArchiveService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.change.schema import ChangeRead

router = APIRouter(tags=["archive"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "/workspaces/{workspace_id}/changes/{change_id}/archive",
    response_model=ChangeRead,
)
async def archive_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_ARCHIVE))],
) -> ChangeRead:
    svc = ArchiveService(session)
    change = await svc.archive_change(workspace_id, change_id)
    return ChangeRead.model_validate(change)


@router.post(
    "/workspaces/{workspace_id}/changes/{change_id}/distill",
)
async def distill_knowledge(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> dict:
    svc = ArchiveService(session)
    return await svc.distill_knowledge(workspace_id, change_id)
