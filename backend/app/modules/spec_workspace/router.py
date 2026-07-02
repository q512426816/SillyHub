"""HTTP routes for the spec_workspace module.

Provides REST endpoints for managing spec workspaces, import/sync
operations, and spec conflict resolution.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
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
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> StreamingResponse:
    """Import spec via SSE（D-001 流式，2026-07-01-spec-import-async-and-change-reparse）。

    分阶段推送 packing/packed/applying/reparsing_docs/reparsing_changes/done/error；
    daemon 离线/超时/打包失败 → error 事件（透传 ql-001 错误码）。daemon-client 的
    packing 阶段每 5s keepalive 防 Next.js proxy idle timeout。前端 importSpecWorkspace
    流式读 event-stream（不再返回 JSON）。
    """
    service = SpecWorkspaceService(session)
    return StreamingResponse(
        service.import_from_repo_sse(workspace_id),
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
    """「同步到服务器」手动按钮（D-012 / task-13）：path_source 分流。

    解析当前用户的 per-member binding（``MemberBindingResolver``）；未绑定回退读
    workspace 全局 ``path_source``/``root_path``/``daemon_runtime_id``（向后兼容）。

    - **server-local**：root_path 在容器/宿主机可读 → 直接打包 .sillyspec → apply_sync
      落盘 + reparse，立即返 ``{"status": "done"}``。
    - **daemon-client**：root_path 在成员宿主机，backend 读不到 → 建 ``kind="spec-sync"``
      的 DaemonChangeWrite outbox 行（files 携带 workspace_id 元信息），返
      ``{"status": "pending", "task_id": <uuid>}``。前端轮询 ``GET .../sync-manual/pending``。
    """
    service = SpecWorkspaceService(session)

    # 解析 actor 的 binding：优先 per-member 行（W1 接线），缺则回退 workspace 全局列。
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    runtime_id: uuid.UUID | None = None
    root_path: str | None = None
    path_source: str | None = None
    try:
        binding = await MemberBindingResolver.resolve_member_binding(session, workspace_id, user.id)
        runtime_id = binding.runtime_id
        root_path = binding.root_path
        path_source = binding.path_source
    except Exception:
        # 无 per-member 行 → 回退 workspace 全局列（兼容旧 binding / 未初始化成员）。
        from app.modules.workspace.model import Workspace

        ws = await session.get(Workspace, workspace_id)
        runtime_id = ws.daemon_runtime_id if ws else None
        root_path = ws.root_path if ws else None
        path_source = ws.path_source if ws else None

    # daemon-client：建 spec-sync outbox 行。
    if path_source == "daemon-client" and runtime_id is not None:
        from app.modules.daemon.model import DaemonChangeWrite

        # files 携带 workspace_id 元信息（daemon task-runner 据 kind=spec-sync 分流，
        # 不写 changes/<key>/ 而是调 postSpecSync 整树回灌）。
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
        )
        return {"status": "pending", "task_id": str(cw.id)}

    # server-local（或 path_source 未标 daemon-client）：本机直接落盘。
    result = await service.sync_manual_server_local(
        workspace_id, runtime_id=runtime_id, root_path=root_path
    )
    log.info(
        "spec_workspace.sync_manual_done",
        workspace_id=str(workspace_id),
        path_source=path_source,
    )
    return result


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
) -> SpecSyncResponse:
    """Receive a daemon-uploaded spec tar, overwrite the server ``spec_root``,
    and reparse scan_docs (FR-05 / D-006@v1).

    Body is a raw ``application/x-tar`` stream. The whole tree is overwritten
    (no diff/merge). ``.runtime/`` is preserved. Returns the reparse parsed
    count.
    """
    service = SpecWorkspaceService(session)
    # apply_sync 返回 {reparsed_docs, reparsed_changes}（D-003）；sync 端点暂时只暴露 docs
    # 数保持 SpecSyncResponse 兼容，task-03 加 reparsed_changes 字段 + import SSE。
    result = await service.apply_sync(workspace_id, tar_bytes)
    return SpecSyncResponse(
        ok=True,
        reparsed=result["reparsed_docs"],
        reparsed_changes=result["reparsed_changes"],
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
