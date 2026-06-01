"""HTTP routes for git identity management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.git_identity.schema import (
    AccessCheckRequest,
    AccessCheckResult,
    GitIdentityCreate,
    GitIdentityList,
    GitIdentityRead,
)
from app.modules.git_identity.service import GitIdentityService

router = APIRouter(prefix="/git", tags=["git_identity"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/identities", response_model=GitIdentityList)
async def list_identities(
    session: SessionDep,
    user: CurrentUser,
) -> GitIdentityList:
    service = GitIdentityService(session)
    items = await service.list_(user.id)
    return GitIdentityList(
        items=[GitIdentityRead.model_validate(i) for i in items],
        total=len(items),
    )


@router.post(
    "/identities",
    response_model=GitIdentityRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_identity(
    data: GitIdentityCreate,
    session: SessionDep,
    user: CurrentUser,
) -> GitIdentityRead:
    service = GitIdentityService(session)
    row = await service.create(user.id, data)
    return GitIdentityRead.model_validate(row)


@router.get("/identities/{identity_id}", response_model=GitIdentityRead)
async def get_identity(
    identity_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> GitIdentityRead:
    import uuid

    service = GitIdentityService(session)
    row = await service.get(uuid.UUID(identity_id), user.id)
    return GitIdentityRead.model_validate(row)


@router.delete(
    "/identities/{identity_id}",
    status_code=status.HTTP_200_OK,
)
async def revoke_identity(
    identity_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> GitIdentityRead:
    import uuid

    service = GitIdentityService(session)
    row = await service.revoke(uuid.UUID(identity_id), user.id)
    return GitIdentityRead.model_validate(row)


@router.post("/check-access", response_model=AccessCheckResult)
async def check_access(
    data: AccessCheckRequest,
    session: SessionDep,
    user: CurrentUser,
) -> AccessCheckResult:
    service = GitIdentityService(session)
    result = await service.check_access(user.id, data)
    return AccessCheckResult(
        identity_id=data.identity_id,
        repo_url=data.repo_url,
        accessible=result.accessible,
        reason=result.reason,
    )
