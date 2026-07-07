"""Shared daemon-entity query functions (D-004@v1).

Module-level extraction of the three daemon-entity queries used by both
:class:`RunPlacementService._resolve_dispatch_runtime` (派发链路) and
:func:`resolve_runtime_for_writeback` (写回链路). 纯查询语义，无业务逻辑——
所有调用方共用同一组 SQL，避免逻辑重复（DRY，D-004@v1）。

来源：``agent/placement.py`` 的 ``_query_daemon_online_by_id`` /
``_query_runtime_by_daemon_and_provider`` / ``_get_daemon_enabled_providers``
三个私有方法（2026-07-03-daemon-entity-binding task-08 引入）。本变更
（2026-07-05-daemon-client-change-binding-fix task-01）将其提取为模块级共享函数。
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)


async def query_daemon_online_by_id(
    session: AsyncSession,
    daemon_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict | None:
    """Return the online ``daemon_instances`` row, or None if offline / not owned.

    Used by派发（``_resolve_dispatch_runtime``）/ 决策（``_resolve_decide_runtime``）
    / 写回（``resolve_runtime_for_writeback``）三处共用，校验绑定 daemon 实体可达
    且属于该 user 后再解析其 provider runtime（design §6 / D-004）。
    """
    try:
        result = await session.execute(
            text(
                """
                SELECT id, status, hostname
                FROM daemon_instances
                WHERE id = :did
                  AND user_id = :uid
                  AND status = 'online'
                """
            ),
            {"did": daemon_id.hex, "uid": user_id.hex},
        )
        row = result.mappings().first()
        return dict(row) if row else None
    except Exception as exc:
        log.warning(
            "query_daemon_online_by_id_failed",
            daemon_id=str(daemon_id),
            error=str(exc),
        )
        return None


async def query_runtime_by_daemon_and_provider(
    session: AsyncSession,
    daemon_id: uuid.UUID,
    target_provider: str | None,
) -> dict | None:
    """Return the first online runtime matching ``target_provider`` on the given
    daemon, or None if no such runtime exists (design §6 D-005).

    When ``target_provider`` is None (workspace has no default_agent and no caller
    override), return any online runtime on the daemon, preferring the most
    recently seen (``last_heartbeat_at DESC``).
    """
    try:
        if target_provider:
            result = await session.execute(
                text(
                    """
                    SELECT id, user_id, provider, status, daemon_instance_id
                    FROM daemon_runtimes
                    WHERE daemon_instance_id = :did
                      AND provider = :prov
                      AND status = 'online'
                    ORDER BY last_heartbeat_at DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {"did": daemon_id.hex, "prov": target_provider},
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT id, user_id, provider, status, daemon_instance_id
                    FROM daemon_runtimes
                    WHERE daemon_instance_id = :did
                      AND status = 'online'
                    ORDER BY last_heartbeat_at DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {"did": daemon_id.hex},
            )
        row = result.mappings().first()
        return dict(row) if row else None
    except Exception as exc:
        log.warning(
            "query_runtime_by_daemon_and_provider_failed",
            daemon_id=str(daemon_id),
            target_provider=target_provider,
            error=str(exc),
        )
        return None


async def resolve_daemon_instance_for_workspace(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> uuid.UUID | None:
    """Resolve the ``daemon_instances.id`` whose host owns *workspace_id*'s source.

    Workspace-scoped counterpart of :func:`resolve_runtime_for_writeback`'s
    two-step lookup, **without** the ``user_id`` gate (host-fs 委托路径是 daemon
    上报回调，无天然 actor user_id，见 ``HostFsDelegate._via_rpc``). Used by
    ``HostFsDelegate`` (change 2026-07-06-daemon-host-fs-delegate) to route
    ``host_fs.*`` WS RPCs to the correct per-daemon connection — the WS routing
    key is the daemon **instance** id (``router.py`` WS handshake /
    ``ws_hub._connections``），NOT the runtime id (``daemon_runtimes.id``) that
    ``workspace.daemon_runtime_id`` historically stored.

    解析顺序（镜像 ``resolve_runtime_for_writeback`` Step 1/2，去 user_id 门控）：

    1. **新链路**：``workspace_member_runtimes`` 存在带 ``daemon_id`` 的 binding
       行 → ``daemon_id`` 即 instance id（daemon-entity-binding 后稳定绑定键，
       D-007 重置后新 workspace 此为唯一来源）。daemon-client workspace 的源码
       物理位于某台 daemon 宿主，workspace 编码了"哪个 daemon 的宿主有源"，多
       成员绑定时取带 ``daemon_id`` 的行即源宿主 daemon（LIMIT 1）。
    2. **legacy 回退**：``workspaces.daemon_runtime_id`` 非空 → join
       ``daemon_runtimes.daemon_instance_id``（既有 fixture / 历史数据零回归）。
    3. 都无 → 返回 None（genuinely unbound，caller 兜底报错）。

    Returns:
        The resolved ``daemon_instances.id``，或 None（未绑定 / 解析失败）。
    """
    try:
        # Step 1: member binding（新链路）— daemon_id 即 instance id。
        result = await session.execute(
            text(
                """
                SELECT daemon_id
                FROM workspace_member_runtimes
                WHERE workspace_id = :wid
                  AND daemon_id IS NOT NULL
                LIMIT 1
                """
            ),
            {"wid": workspace_id.hex},
        )
        row = result.first()
        if row and row[0] is not None:
            raw = row[0]
            return raw if isinstance(raw, uuid.UUID) else uuid.UUID(str(raw))

        # Step 2: legacy fallback（daemon_runtime_id → daemon_instance_id）。
        result = await session.execute(
            text(
                """
                SELECT dr.daemon_instance_id
                FROM workspaces w
                JOIN daemon_runtimes dr ON dr.id = w.daemon_runtime_id
                WHERE w.id = :wid
                  AND dr.daemon_instance_id IS NOT NULL
                """
            ),
            {"wid": workspace_id.hex},
        )
        row = result.first()
        if row and row[0] is not None:
            raw = row[0]
            return raw if isinstance(raw, uuid.UUID) else uuid.UUID(str(raw))

        return None
    except Exception as exc:
        log.warning(
            "resolve_daemon_instance_for_workspace_failed",
            workspace_id=str(workspace_id),
            error=str(exc),
        )
        return None


async def get_daemon_enabled_providers(
    session: AsyncSession,
    daemon_id: uuid.UUID,
) -> list[str]:
    """Return a sorted list of unique provider names enabled on the daemon.

    Used by the D-008 error path to build a user-facing message listing which
    providers the daemon actually has, so the user can reconfigure
    ``default_agent`` accordingly.
    """
    try:
        result = await session.execute(
            text(
                """
                SELECT DISTINCT provider
                FROM daemon_runtimes
                WHERE daemon_instance_id = :did
                  AND provider IS NOT NULL
                ORDER BY provider
                """
            ),
            {"did": daemon_id.hex},
        )
        return [row[0] for row in result.all()]
    except Exception as exc:
        log.warning(
            "get_daemon_enabled_providers_failed",
            daemon_id=str(daemon_id),
            error=str(exc),
        )
        return []
