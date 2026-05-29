"""Release API endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.release.schema import (
    ReleaseApprovalCreate,
    ReleaseApprovalResponse,
    ReleaseCreate,
    ReleaseResponse,
)
from app.modules.release.service import ReleaseService

router = APIRouter(tags=["releases"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "/workspaces/{workspace_id}/releases",
    response_model=ReleaseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_release(
    workspace_id: uuid.UUID,
    body: ReleaseCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.DEPLOY_STAGING))],
) -> ReleaseResponse:
    svc = ReleaseService(session)
    release = await svc.create(workspace_id, user.id, body)
    return ReleaseResponse.model_validate(release)


@router.get(
    "/workspaces/{workspace_id}/releases",
    response_model=list[ReleaseResponse],
)
async def list_releases(
    workspace_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: SessionDep,
    status_filter: str | None = Query(None, alias="status"),
) -> list[ReleaseResponse]:
    svc = ReleaseService(session)
    releases = await svc.list_releases(workspace_id, status=status_filter)
    return [ReleaseResponse.model_validate(r) for r in releases]


@router.post(
    "/releases/{release_id}/approve",
    response_model=ReleaseApprovalResponse,
    status_code=status.HTTP_201_CREATED,
)
async def approve_release(
    release_id: uuid.UUID,
    body: ReleaseApprovalCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_PRODUCTION))],
) -> ReleaseApprovalResponse:
    svc = ReleaseService(session)
    approval = await svc.approve(release_id, user.id, body.verdict, body.comment)
    return ReleaseApprovalResponse.model_validate(approval)


@router.get(
    "/releases/{release_id}/approvals",
    response_model=list[ReleaseApprovalResponse],
)
async def list_approvals(
    release_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> list[ReleaseApprovalResponse]:
    svc = ReleaseService(session)
    approvals = await svc.list_approvals(release_id)
    return [ReleaseApprovalResponse.model_validate(a) for a in approvals]


@router.post(
    "/releases/{release_id}/deploy",
    response_model=ReleaseResponse,
)
async def deploy_release(
    release_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_PRODUCTION))],
) -> ReleaseResponse:
    svc = ReleaseService(session)
    release = await svc.deploy(release_id)
    return ReleaseResponse.model_validate(release)


@router.post(
    "/releases/{release_id}/rollback",
    response_model=ReleaseResponse,
)
async def rollback_release(
    release_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_ROLLBACK))],
) -> ReleaseResponse:
    svc = ReleaseService(session)
    release = await svc.rollback(release_id)
    return ReleaseResponse.model_validate(release)
