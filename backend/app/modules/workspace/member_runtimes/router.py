"""HTTP routes for per-member workspace daemon binding.

Change 2026-07-01-collaborative-workspace task-03. 3 endpoints mounted at
``/workspaces/{workspace_id}``:
- GET  /my-binding        — current user's own binding (null if unconfigured)
- PUT  /my-binding        — upsert own binding (runtime must belong to caller)
- GET  /members/bindings  — all member bindings (owner/admin only)
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.member_runtimes.service import (
    get_my_binding,
    list_member_bindings,
    upsert_my_binding,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["workspace-member-runtimes"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class MemberBindingUpsertRequest(BaseModel):
    daemon_id: uuid.UUID | None = None
    root_path: str
    path_source: str = "daemon-client"


class MemberBindingView(BaseModel):
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    daemon_id: uuid.UUID | None = None
    runtime_id: uuid.UUID | None = None
    root_path: str
    path_source: str
    synced_at: str | None
    last_scan_at: str | None
    init_synced_at: str | None
    init_synced_spec_version: int | None


def _to_view(row: WorkspaceMemberRuntime) -> MemberBindingView:
    return MemberBindingView(
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        daemon_id=row.daemon_id,
        runtime_id=row.runtime_id,
        root_path=row.root_path,
        path_source=row.path_source,
        synced_at=row.synced_at.isoformat() if row.synced_at else None,
        last_scan_at=row.last_scan_at.isoformat() if row.last_scan_at else None,
        init_synced_at=row.init_synced_at.isoformat() if row.init_synced_at else None,
        init_synced_spec_version=row.init_synced_spec_version,
    )


@router.get("/my-binding", response_model=MemberBindingView | None)
async def get_my_binding_endpoint(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
):
    """Return the caller's binding row, or null if not yet configured."""
    row = await get_my_binding(session, workspace_id, user.id)
    if row is None:
        return None
    return _to_view(row)


@router.put("/my-binding", response_model=MemberBindingView)
async def upsert_my_binding_endpoint(
    workspace_id: uuid.UUID,
    payload: MemberBindingUpsertRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    response: Response,
):
    """Upsert the caller's own binding. daemon_id must belong to the caller.

    service.upsert_my_binding 在 daemon 不归属调用方时抛
    AppError(http_status=403, code="daemon_not_owned")，这里不再 catch，异常直通
    全局处理器（app/core/errors.py）统一返 403 + 标准错误 body。
    """
    row, created = await upsert_my_binding(
        session,
        workspace_id,
        user.id,
        daemon_id=payload.daemon_id,
        root_path=payload.root_path,
        path_source=payload.path_source,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _to_view(row)


@router.get("/members/bindings", response_model=list[MemberBindingView])
async def list_member_bindings_endpoint(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
):
    """List all member bindings (owner/admin only)."""
    rows = await list_member_bindings(session, workspace_id)
    return [_to_view(r) for r in rows]
