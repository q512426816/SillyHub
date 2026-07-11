"""Shared test fixtures for daemon-client writeback tests (task-07).

2026-07-05-daemon-client-change-binding-fix：现有 fixture 全用非空 ``daemon_runtime_id``
+ 无 per-member binding 行（legacy 路径）——这是 daemon-entity-binding 后写回链路
bug 漏到生产的主因。本模块提供 ``make_daemon_client_workspace_with_binding`` 构造
**新链路** fixture（``daemon_runtime_id=None`` + ``DaemonInstance`` + per-member
binding 行经 ``daemon_id``），供 resolver / proxy / write_file / sync-manual 测试共用。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


async def make_daemon_client_workspace_with_binding(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    default_agent: str = "claude",
    daemon_online: bool = True,
    runtime_online: bool = True,
    bound_daemon_id: uuid.UUID | None = None,
    root_path: str | None = None,
    last_scanned_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a daemon-client workspace wired through the NEW binding path.

    新链路（daemon-entity-binding D-004）：
    - ``Workspace.daemon_runtime_id`` = None（退化为 NULL，不再作绑定维度）。
    - 绑定由 ``WorkspaceMemberRuntime.daemon_id`` 承载（per-member 行）。
    - ``DaemonInstance``（在线、属 user）+ ``DaemonRuntime``（provider = default_agent）
      让 ``resolve_runtime_for_writeback`` 经 daemon_id + default_agent 解析命中。

    与现有 legacy fixture（非空 daemon_runtime_id、无 binding）互补，覆盖 task-07 新链路。
    """
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
    from app.modules.workspace.model import Workspace

    daemon_id = bound_daemon_id or uuid.uuid4()
    instance = DaemonInstance(
        id=daemon_id,
        user_id=user_id,
        hostname=f"host-{daemon_id.hex[:8]}",
        server_url="http://test-server",
        status="online" if daemon_online else "offline",
        last_heartbeat_at=datetime.now(UTC) if daemon_online else None,
    )
    db_session.add(instance)

    runtime_id = uuid.uuid4()
    runtime = DaemonRuntime(
        id=runtime_id,
        daemon_instance_id=daemon_id,
        user_id=user_id,
        provider=default_agent,
        status="online" if runtime_online else "offline",
        last_heartbeat_at=datetime.now(UTC) if runtime_online else None,
    )
    db_session.add(runtime)

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="DC Binding WS",
        slug=f"dc-binding-{ws_id.hex[:8]}",
        root_path=root_path or f"/home/user/proj-{ws_id.hex[:8]}",
        status="active",
        component_key="backend",
        default_agent=default_agent,
        created_by=user_id,
        last_scanned_at=last_scanned_at or datetime.now(UTC),
    )
    db_session.add(ws)

    binding = WorkspaceMemberRuntime(
        workspace_id=ws_id,
        user_id=user_id,
        runtime_id=None,
        daemon_id=daemon_id,
        root_path=ws.root_path,
        path_source="daemon-client",
    )
    db_session.add(binding)
    await db_session.commit()
    return {
        "ws_id": ws_id,
        "user_id": user_id,
        "daemon_id": daemon_id,
        "runtime_id": runtime_id,
        "default_agent": default_agent,
    }
