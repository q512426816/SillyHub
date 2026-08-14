"""HTTP routes for the spec_workspace module.

Provides REST endpoints for managing spec workspaces, import/sync
operations, and spec conflict resolution.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import SpecConflictNotFound
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_profile.schema import (
    SpecConflictListResponse,
    SpecConflictRead,
    SpecConflictResolve,
)
from app.modules.spec_workspace.bootstrap import SpecBootstrapService
from app.modules.spec_workspace.schema import (
    SpecBootstrapRunStartResponse,
    SpecIncrementalSyncRequest,
    SpecIncrementalSyncResponse,
    SpecWorkspaceRead,
    SpecWorkspaceUpdate,
)
from app.modules.spec_workspace.service import SpecWorkspaceService

log = get_logger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["spec-workspace"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class SpecSyncResponse(BaseModel):
    """Response DTO for the spec sync endpoint (FR-05 / D-003)."""

    ok: bool
    reparsed: int  # = reparsed_docs（向后兼容，旧客户端读这个）
    reparsed_changes: int = 0


# ── Spec Workspace ─────────────────────────────────────────────────────────────


@router.get("/spec-workspace", response_model=SpecWorkspaceRead)
async def get_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> SpecWorkspaceRead:
    """Return the spec workspace associated with the given workspace."""
    service = SpecWorkspaceService(session)
    spec_ws = await service.get(workspace_id)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.get("/spec-workspace/bundle")
async def download_spec_bundle(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> StreamingResponse:
    """Stream the server ``spec_root`` as a tar bundle (FR-05 / D-003@v1).

    Used by daemon-client workspaces to borrow the spec tree before an agent
    run. Excludes ``.runtime/`` (daemon runtime cache, not spec data).
    """
    service = SpecWorkspaceService(session)
    spec_root, tar_stream = await service.build_bundle(workspace_id)
    return StreamingResponse(
        tar_stream,
        media_type="application/x-tar",
        headers={
            "Content-Disposition": f'attachment; filename="spec-bundle-{workspace_id}.tar"',
            "X-Spec-Root": spec_root,
        },
    )


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post("/spec-workspace/import")
async def import_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> StreamingResponse:
    """Import spec via SSE（D-001 流式，2026-07-01-spec-import-async-and-change-reparse）。

    分阶段推送 packing/packed/applying/reparsing_docs/reparsing_changes/done/error；
    daemon 离线/超时/打包失败 → error 事件（透传 ql-001 错误码）。daemon-client 的
    packing 阶段每 5s keepalive 防 Next.js proxy idle timeout。前端 importSpecWorkspace
    流式读 event-stream（不再返回 JSON）。

    daemon_id 存 per-member binding 行，import 必须经 MemberBindingResolver 解析 actor
    的 binding 拿 daemon_id；无 binding 行 → 解析失败抛 DaemonClientNoActiveSession。
    """
    service = SpecWorkspaceService(session)
    # 解析 actor 的 binding（daemon-entity-binding 唯一链路）。
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    binding = await MemberBindingResolver.resolve_member_binding(session, workspace_id, user.id)
    daemon_id = binding.daemon_id
    root_path = binding.root_path

    return StreamingResponse(
        service.import_from_repo_sse(workspace_id, daemon_id=daemon_id, root_path=root_path),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post(
    "/spec-workspace/sync-manual",
    response_model=dict,
)
async def sync_manual_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> dict:
    """「同步到服务器」手动按钮（D-012 / task-13）：daemon-client outbox 分发。

    解析当前用户的 per-member binding（``MemberBindingResolver``）；无 binding → 解析
    失败抛 DaemonClientNoActiveSession（AppError HTTP 400，不再回退 legacy）。

    唯一路径：root_path 在成员宿主机，backend 读不到 → runtime 由
    ``resolve_runtime_for_writeback`` 现算（D-001@v1，2026-07-05-daemon-client-change-binding-fix）；
    建 ``kind="spec-sync"`` 的 DaemonChangeWrite outbox 行（files 携带 workspace_id
    元信息），返 ``{"status": "pending", "task_id": <uuid>}``。前端轮询
    ``GET .../sync-manual/pending``。
    """
    # 解析 actor 的 binding（daemon-entity-binding 唯一链路）。
    from app.modules.workspace.member_runtimes.resolver import (
        MemberBindingResolver,
        resolve_runtime_for_writeback,
    )

    binding = await MemberBindingResolver.resolve_member_binding(session, workspace_id, user.id)
    daemon_id = binding.daemon_id

    # runtime 现算：D-001@v1（runtime_id 不再直读 binding.runtime_id），由共享 resolver
    # 用 binding + default_agent 现算。解析失败抛 DaemonClientNoActiveSession（AppError HTTP 400）。
    resolved = await resolve_runtime_for_writeback(session, workspace_id, user.id)
    rid_raw = resolved["id"]
    runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw

    # files 携带 workspace_id 元信息（daemon task-runner 据 kind=spec-sync 分流，
    # 不写 changes/<key>/ 而是调 postSpecSync 整树回灌）。
    from app.modules.daemon.model import DaemonChangeWrite

    cw = DaemonChangeWrite(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        change_key="spec-sync",
        kind="spec-sync",
        files=[{"workspace_id": str(workspace_id)}],
        status="pending",
    )
    session.add(cw)
    await session.commit()
    await session.refresh(cw)
    log.info(
        "spec_workspace.sync_manual_dispatched",
        workspace_id=str(workspace_id),
        change_write_id=str(cw.id),
        runtime_id=str(runtime_id),
        daemon_id=str(daemon_id) if daemon_id else None,
    )
    return {"status": "pending", "task_id": str(cw.id)}


@router.get(
    "/spec-workspace/sync-manual/pending",
    response_model=list[dict],
)
async def list_sync_manual_pending(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[dict]:
    """查询 workspace 下所有 ``kind="spec-sync"`` 的 DaemonChangeWrite 行状态。

    前端轮询用：按 created_at desc 返回，前端取最新一条判定进度
    （pending/claimed=进行中，done=完成，failed=失败）。
    """
    service = SpecWorkspaceService(session)
    return await service.sync_manual_get_pending(workspace_id)


@router.post(
    "/spec-workspace/sync",
    response_model=SpecSyncResponse,
)
async def sync_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
    tar_bytes: Annotated[bytes, Body(media_type="application/x-tar")],
    change_write_id: Annotated[str | None, Header(alias="X-Change-Write-Id")] = None,
) -> SpecSyncResponse:
    """Receive a daemon-uploaded spec tar, overwrite the server ``spec_root``,
    and reparse scan_docs (FR-05 / D-006@v1).

    Body is a raw ``application/x-tar`` stream. The whole tree is overwritten
    (no diff/merge). ``.runtime/`` is preserved. Returns the reparse parsed
    count. ``X-Change-Write-Id`` 头（可选）让后端 apply 循环内逐文件回写
    files_processed（逐文件级进度，D-004@V2）。
    """
    service = SpecWorkspaceService(session)
    result = await service.apply_sync(workspace_id, tar_bytes, change_write_id=change_write_id)
    return SpecSyncResponse(
        ok=True,
        reparsed=result["reparsed_docs"],
        reparsed_changes=result["reparsed_changes"],
    )


@router.post(
    "/spec-workspace/sync-incremental",
    response_model=SpecIncrementalSyncResponse,
)
async def sync_spec_workspace_incremental(
    workspace_id: uuid.UUID,
    payload: SpecIncrementalSyncRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
    change_write_id: Annotated[str | None, Header(alias="X-Change-Write-Id")] = None,
) -> SpecIncrementalSyncResponse:
    """Receive daemon incremental file ops and apply them to spec_root.

    Change 2026-08-13-platform-managed-file-sync / design §7 / FR-02 / D-001：
    文件级增量同步（add/update/delete/rename + base_version 乐观锁）。base_version
    过期 → ``conflict=True`` + ``server_versions``（HTTP 保持 200，daemon 侧据字段
    提示人工拍板，design §7 定义）；containment / ``.runtime`` 越界 → 422 AppError
    透传（``HTTP_422_SPEC_BUNDLE_INVALID``，对齐旧 tar 端点校验机制）。
    ``X-Change-Write-Id`` 头（可选）让 apply_ops 循环内逐文件回写 files_processed。
    ``change_dirs``（change 2026-08-14-change-center-conversation-driven / D-005@v1）：
    daemon 标注的本次涉及变更目录名集合，透传 apply_ops 落盘后触发 scoped reparse
    （无标注时 apply_ops 扫 ops 路径 ``changes/`` 前缀兜底，行为等价）。
    """
    service = SpecWorkspaceService(session)
    result = await service.apply_ops(
        workspace_id,
        payload.ops,
        change_write_id=change_write_id,
        change_dirs=payload.change_dirs,
    )
    return SpecIncrementalSyncResponse(
        ok=True,
        new_versions=result["new_versions"],
        conflict=result["conflict"],
        server_versions=result["server_versions"],
    )


@router.patch("/spec-workspace", response_model=SpecWorkspaceRead)
async def update_spec_workspace(
    workspace_id: uuid.UUID,
    payload: SpecWorkspaceUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecWorkspaceRead:
    """Update mutable spec workspace configuration (strategy, repo path, etc.)."""
    service = SpecWorkspaceService(session)
    spec_ws = await service.update(workspace_id, payload)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.post(
    "/spec-bootstrap",
    response_model=SpecBootstrapRunStartResponse,
)
async def bootstrap_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecBootstrapRunStartResponse:
    """Launch an asynchronous bootstrap AgentRun for the spec workspace.

    Creates a pending AgentRun, writes a start audit event, links the run
    to the workspace, and returns immediately with the run ID and stream URL.
    The actual execution (dispatched to the user's daemon) happens in a
    background task.
    """
    service = SpecBootstrapService(session)
    result = await service.bootstrap(workspace_id, user_id=_user.id)
    return SpecBootstrapRunStartResponse(**result)


# ── Spec Conflicts ─────────────────────────────────────────────────────────────


@router.get("/spec-conflicts", response_model=SpecConflictListResponse)
async def list_spec_conflicts(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SpecConflictListResponse:
    """List spec conflicts for the given workspace, optionally filtered by
    status.
    """
    stmt = select(SpecConflict).where(
        SpecConflict.workspace_id == workspace_id,
    )
    count_stmt = (
        select(func.count())
        .select_from(SpecConflict)
        .where(
            SpecConflict.workspace_id == workspace_id,
        )
    )

    if status_filter is not None:
        stmt = stmt.where(col(SpecConflict.status) == status_filter)
        count_stmt = count_stmt.where(col(SpecConflict.status) == status_filter)

    stmt = stmt.order_by(col(SpecConflict.created_at).desc()).limit(limit).offset(offset)

    items = list((await session.execute(stmt)).scalars().all())
    total = (await session.execute(count_stmt)).scalar() or 0

    return SpecConflictListResponse(
        items=[SpecConflictRead.model_validate(c) for c in items],
        total=total,
    )


@router.post(
    "/spec-conflicts/{conflict_id}/resolve",
    response_model=SpecConflictRead,
)
async def resolve_spec_conflict(
    workspace_id: uuid.UUID,
    conflict_id: uuid.UUID,
    payload: SpecConflictResolve,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecConflictRead:
    """Resolve a spec conflict by setting its status and optional details."""
    conflict = await session.get(SpecConflict, conflict_id)
    if conflict is None or conflict.workspace_id != workspace_id:
        raise SpecConflictNotFound(
            "Spec conflict not found for the given workspace.",
            details={
                "workspace_id": str(workspace_id),
                "conflict_id": str(conflict_id),
            },
        )

    conflict.status = payload.status
    if payload.details_json is not None:
        conflict.details_json = payload.details_json

    await session.commit()
    await session.refresh(conflict)

    log.info(
        "spec_conflict.resolved",
        conflict_id=str(conflict_id),
        workspace_id=str(workspace_id),
        status=payload.status,
    )

    return SpecConflictRead.model_validate(conflict)
