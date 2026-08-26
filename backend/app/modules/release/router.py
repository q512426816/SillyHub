"""Release API endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, get_current_user, require_permission
from app.core.db import get_session
from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.release.model import Release
from app.modules.release.schema import (
    ReleaseApprovalCreate,
    ReleaseApprovalResponse,
    ReleaseCreate,
    ReleaseResponse,
)
from app.modules.release.service import ReleaseService

router = APIRouter(tags=["releases"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _require_release_permission(
    session: AsyncSession,
    *,
    user: User,
    permission: Permission,
    release_id: uuid.UUID,
) -> Release:
    """对象级鉴权：取发布单并按其归属 workspace 复查权限，跨工作区 403。

    by-id 端点没有 workspace 路径参数可锚定，``require_permission_any`` 只能
    验证「任意工作区有权限」，无法阻止 A 工作区用户审批 / 部署 / 回滚 B
    工作区发布单；必须在对象归属的 workspace 上复查（对齐 agent / file
    模块的 ``has_permission(workspace_id=obj.workspace_id)`` 惯例）。
    """
    svc = ReleaseService(session)
    release = await svc.get(release_id)
    ok = await has_permission(
        session, user=user, permission=permission, workspace_id=release.workspace_id
    )
    if not ok:
        raise PermissionDenied(
            "无权执行此操作。",
            details={
                "permission": permission.value,
                "workspace_id": str(release.workspace_id),
            },
        )
    return release


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
    user: Annotated[User, Depends(get_current_principal)],
) -> ReleaseApprovalResponse:
    await _require_release_permission(
        session, user=user, permission=Permission.DEPLOY_PRODUCTION, release_id=release_id
    )
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
    user: Annotated[User, Depends(get_current_principal)],
) -> list[ReleaseApprovalResponse]:
    # 只读越权收紧：原仅登录校验 + 裸 id，任意登录用户可枚举所有工作区发布单
    # 审批记录；改为按发布单归属 workspace 复查 WORKSPACE_READ（与列表端点
    # 「本工作区成员可见」口径一致）。
    await _require_release_permission(
        session, user=user, permission=Permission.WORKSPACE_READ, release_id=release_id
    )
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
    user: Annotated[User, Depends(get_current_principal)],
) -> ReleaseResponse:
    await _require_release_permission(
        session, user=user, permission=Permission.DEPLOY_PRODUCTION, release_id=release_id
    )
    svc = ReleaseService(session)
    release = await svc.deploy(release_id)
    return ReleaseResponse.model_validate(release)


@router.post(
    "/releases/{release_id}/promote",
    response_model=ReleaseResponse,
)
async def promote_release(
    release_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ReleaseResponse:
    await _require_release_permission(
        session, user=user, permission=Permission.DEPLOY_STAGING, release_id=release_id
    )
    svc = ReleaseService(session)
    release = await svc.promote_to_staging(release_id)
    return ReleaseResponse.model_validate(release)


@router.post(
    "/releases/{release_id}/rollback",
    response_model=ReleaseResponse,
)
async def rollback_release(
    release_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ReleaseResponse:
    await _require_release_permission(
        session, user=user, permission=Permission.DEPLOY_ROLLBACK, release_id=release_id
    )
    svc = ReleaseService(session)
    release = await svc.rollback(release_id)
    return ReleaseResponse.model_validate(release)
