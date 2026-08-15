"""Workspace member runtime binding CRUD (change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.exceptions import MemberBindingNotFound
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

log = get_logger(__name__)


async def get_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WorkspaceMemberRuntime | None:
    """Return the member's binding row, or None if not configured."""
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    return row


async def upsert_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    daemon_id: uuid.UUID | None,
    root_path: str,
    path_source: str,
) -> tuple[WorkspaceMemberRuntime, bool]:
    """Upsert a member's binding row. Returns ``(row, created)``.

    Change 2026-07-03-daemon-entity-binding task-09 (D-004): the binding
    target is ``daemon_id`` (FK→daemon_instances) instead of ``runtime_id``.
    ``runtime_id`` column is preserved nullable but NOT written by this
    function — it retains legacy snapshot data only.

    Raises ``AppError(403)`` if ``daemon_id`` is set but belongs to a
    different user (defensive — prevents cross-user daemon hijack).
    """
    if daemon_id is not None:
        daemon = await session.get(DaemonInstance, daemon_id)
        if daemon is None or daemon.user_id != user_id:
            raise AppError(
                "该守护进程不属于当前用户，无法使用。",
                code="daemon_not_owned",
                http_status=403,
            )

    existing = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    now = datetime.now(UTC)
    if existing:
        # Edit path (D-007): only the editable binding columns change.
        # init_synced_at / init_synced_spec_version are NOT touched here — they
        # are written exclusively by the init-lease complete path (task-07).
        # Changing one's daemon/path must not reset initialization state.
        existing.daemon_id = daemon_id
        existing.root_path = root_path
        existing.path_source = path_source
        existing.updated_at = now
        await session.commit()
        await session.refresh(existing)
        return existing, False

    # Create path: init_synced_* start NULL (uninitialized) and remain so until
    # the member's first `init` lease completes (task-07 / task-09 migration).
    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        daemon_id=daemon_id,
        root_path=root_path,
        path_source=path_source,
        init_synced_at=None,
        init_synced_spec_version=None,
        created_at=now,
        updated_at=now,
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return binding, True


async def list_my_bindings(
    session: AsyncSession,
    user_id: uuid.UUID,
) -> list[WorkspaceMemberRuntime]:
    """Return the caller's binding rows across ALL workspaces.

    遗留 1（daemon-entity-binding）：工作区列表卡片不再依赖 ``workspace.daemon_runtime_id``
    （新工作区该列为 NULL），改为按 daemon 实体展示。批量端点一次性拉取当前用户
    在所有工作区的 member binding，前端按 workspace_id 索引，避免列表 N 次请求。
    """
    stmt = select(WorkspaceMemberRuntime).where(col(WorkspaceMemberRuntime.user_id) == user_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_member_bindings(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> list[WorkspaceMemberRuntime]:
    """Return all binding rows for a workspace (owner/admin)."""
    stmt = (
        select(WorkspaceMemberRuntime)
        .where(col(WorkspaceMemberRuntime.workspace_id) == workspace_id)
        .order_by(col(WorkspaceMemberRuntime.user_id))
    )
    return list((await session.execute(stmt)).scalars().all())


# ────────────────────────────────────────────────────────────────────────────
# Daemon 共享标记（change 2026-07-25-daemon-borrow-for-business task-04）
# D-003@v1 / FR-01 / FR-02：lender 把自己的 daemon 标为本工作空间共享，
# 业务/管理人员（business_member）即可借用跑 agent 读源码。撤销 = shared=False，
# 不删 binding 行（lender 配置的 daemon + 路径保留，可随时再标 shared）。
# 默认 false：现有「自带 daemon」binding 行为零回归，仅显式调用端点才置位。
# ────────────────────────────────────────────────────────────────────────────


async def set_my_binding_shared(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    shared: bool,
) -> WorkspaceMemberRuntime:
    """标记/撤销当前成员自己 binding 的 daemon 共享状态（FR-01 / D-003@v1）。

    lender（开发人员）把自己的 daemon 标为本工作空间共享，业务/管理人员即可
    借用。binding 行必须已存在（先 PUT /my-binding 配 daemon + 路径），否则
    复用既有 ``MemberBindingNotFound``（409）——前端按 code 引导先配置。
    端点无 user_id 路径参数，server 钉死 ``user_id`` → 仅能改自己 binding。
    """
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    if row is None:
        raise MemberBindingNotFound(workspace_id=workspace_id, user_id=user_id)
    row.shared = shared
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def list_shared_daemons(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """owner 查工作空间所有共享 daemon（FR-02 / D-003@v1）。

    JOIN ``daemon_instances`` 拿在线状态 + hostname，供 owner 决定是否撤销。
    仅命中 ``shared=True`` 的行；``daemon_id`` 为 NULL 的行也返回（前端提示
    lender 未绑 daemon），借用查询（task-05）会自行过滤 daemon_id IS NOT NULL。
    返回 dict 列表（service 层不引入 pydantic），router 转 SharedDaemonView。
    """
    stmt: Select[Any] = (
        select(
            col(WorkspaceMemberRuntime.user_id).label("lender_user_id"),
            col(WorkspaceMemberRuntime.daemon_id).label("daemon_id"),
            col(DaemonInstance.status).label("daemon_status"),
            col(DaemonInstance.hostname).label("daemon_hostname"),
        )
        .outerjoin(
            DaemonInstance,
            DaemonInstance.id == WorkspaceMemberRuntime.daemon_id,
        )
        .where(col(WorkspaceMemberRuntime.workspace_id) == workspace_id)
        .where(col(WorkspaceMemberRuntime.shared).is_(True))
        .order_by(col(WorkspaceMemberRuntime.user_id))
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "lender_user_id": r.lender_user_id,
            "daemon_id": r.daemon_id,
            "daemon_status": r.daemon_status,
            "daemon_hostname": r.daemon_hostname,
        }
        for r in rows
    ]


async def revoke_shared(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
) -> WorkspaceMemberRuntime:
    """owner 撤销某成员 daemon 的共享（FR-02 / D-003@v1）。

    设 ``shared=False``，**不删 binding 行**（lender 配置的 daemon + 路径保留，
    可随时再标 shared）。target 无 binding → ``MemberBindingNotFound``（409）。
    """
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, target_user_id))
    if row is None:
        raise MemberBindingNotFound(workspace_id=workspace_id, user_id=target_user_id)
    row.shared = False
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row
