"""HTTP routes for knowledge and quicklog."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.knowledge.schema import KnowledgeEntry, KnowledgeList, QuicklogEntry, QuicklogList
from app.modules.knowledge.service import KnowledgeService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["knowledge"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/knowledge", response_model=KnowledgeList)
async def list_knowledge(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> KnowledgeList:
    service = KnowledgeService(session)
    return await service.list_knowledge(workspace_id)


@router.get("/knowledge/{filename}", response_model=KnowledgeEntry)
async def get_knowledge(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> KnowledgeEntry:
    service = KnowledgeService(session)
    return await service.get_knowledge(workspace_id, filename)


@router.get("/quicklog", response_model=QuicklogList)
async def list_quicklog(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> QuicklogList:
    service = KnowledgeService(session)
    return await service.list_quicklog(workspace_id)


@router.get("/quicklog/{filename}", response_model=QuicklogEntry)
async def get_quicklog(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> QuicklogEntry:
    service = KnowledgeService(session)
    return await service.get_quicklog(workspace_id, filename)
