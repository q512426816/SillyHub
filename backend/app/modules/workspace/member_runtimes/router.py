"""HTTP routes for per-member workspace daemon binding.

Change 2026-07-01-collaborative-workspace task-03. Endpoints mounted at
``/workspaces/{workspace_id}``:
- GET  /my-binding                  — current user's own binding (null if unconfigured)
- PUT  /my-binding                  — upsert own binding (runtime must belong to caller)
- GET  /members/bindings            — all member bindings (owner/admin only)
- PUT  /my-binding/shared           — lender toggles own daemon sharing (task-04)
- GET  /shared-daemons              — owner lists shared daemons (task-04)
- DELETE /members/{user_id}/shared  — owner revokes a member's sharing (task-04)
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
    list_shared_daemons,
    revoke_shared,
    set_my_binding_shared,
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


class SharedFlagRequest(BaseModel):
    """Body for PUT /my-binding/shared — lender toggles own daemon sharing."""

    shared: bool


class MemberBindingView(BaseModel):
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    daemon_id: uuid.UUID | None = None
    runtime_id: uuid.UUID | None = None
    root_path: str
    path_source: str
    # change 2026-07-25-daemon-borrow-for-business task-04 / D-005@v1：
    # daemon 是否对本工作空间共享（业务/管理人员可借用）。默认 false（零回归）。
    shared: bool = False
    synced_at: str | None
    last_scan_at: str | None
    init_synced_at: str | None
    init_synced_spec_version: int | None


class SharedDaemonView(BaseModel):
    """owner 视角下一条共享 daemon（FR-02 / D-003@v1）。

    ``daemon_status`` / ``daemon_hostname`` 来自 JOIN daemon_instances；
    ``revocable`` 恒 True（owner 调用，总可撤销）。task-06（2026-08-28-
    daemon-agent-share，design §5 Phase 2.3 / provides SharedDaemonsGrantField）：
    数据源切 grants 后每行对应一条 enabled workspace grant，新增 ``grant_id``
    纯增量字段（撤销追溯锚点，前端类型生成归 task-08）；其余字段结构不变。
    """

    grant_id: uuid.UUID
    lender_user_id: uuid.UUID
    daemon_id: uuid.UUID | None = None
    daemon_status: str | None = None
    daemon_hostname: str | None = None
    revocable: bool = True


def _to_view(row: WorkspaceMemberRuntime) -> MemberBindingView:
    return MemberBindingView(
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        daemon_id=row.daemon_id,
        runtime_id=row.runtime_id,
        root_path=row.root_path,
        path_source=row.path_source,
        shared=row.shared,
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


# ────────────────────────────────────────────────────────────────────────────
# Daemon 共享标记与管理（change 2026-07-25-daemon-borrow-for-business task-04）
# FR-01 / FR-02 / D-003@v1：
# - PUT   /my-binding/shared         — lender 标记/撤销自己 daemon 共享（WORKSPACE_READ）
# - GET   /shared-daemons            — owner 查所有共享 daemon（WORKSPACE_MEMBER_MANAGE）
# - DELETE /members/{user_id}/shared — owner 撤销某成员共享（WORKSPACE_MEMBER_MANAGE）
# ────────────────────────────────────────────────────────────────────────────


@router.put("/my-binding/shared", response_model=MemberBindingView)
async def set_my_binding_shared_endpoint(
    workspace_id: uuid.UUID,
    payload: SharedFlagRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
):
    """lender 标记/撤销自己 binding 的 daemon 共享（FR-01 / D-003@v1）。

    端点无 user_id 路径参数，server 钉死当前用户 → 仅能改自己 binding。
    binding 未配置时 service 抛 ``MemberBindingNotFound``（409）直通全局处理器。
    task-06：service 层同事务双写 shared 列 + grants 授权行（端点签名/响应不变）。
    """
    row = await set_my_binding_shared(session, workspace_id, user.id, shared=payload.shared)
    return _to_view(row)


@router.get("/shared-daemons", response_model=list[SharedDaemonView])
async def list_shared_daemons_endpoint(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
):
    """owner 查工作空间所有共享 daemon（FR-02 / D-003@v1）。

    返回含 lender_user_id / daemon 在线状态 / 可撤销标记；task-06 数据源切
    grants（enabled workspace grant），每行新增 grant_id（纯增量字段）。
    """
    rows = await list_shared_daemons(session, workspace_id)
    return [SharedDaemonView(**r) for r in rows]


@router.delete("/members/{user_id}/shared", response_model=MemberBindingView)
async def revoke_shared_endpoint(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
):
    """owner 撤销某成员 daemon 共享（FR-02 / D-003@v1）。

    设 shared=False，**不删 binding 行**（lender 配置保留）。target 无 binding
    时 service 抛 ``MemberBindingNotFound``（409）。task-06：同事务置对应
    workspace grant enabled=False（撤销后借用立即失效，鉴权只读 grants）。
    """
    row = await revoke_shared(session, workspace_id, user_id)
    return _to_view(row)
