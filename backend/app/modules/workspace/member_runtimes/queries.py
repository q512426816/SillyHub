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
    lookup, **without** the ``user_id`` gate (host-fs 委托路径是 daemon
    上报回调，无天然 actor user_id，见 ``HostFsDelegate._via_rpc``). Used by
    ``HostFsDelegate`` (change 2026-07-06-daemon-host-fs-delegate) to route
    ``host_fs.*`` WS RPCs to the correct per-daemon connection — the WS routing
    key is the daemon **instance** id (``router.py`` WS handshake /
    ``ws_hub._connections``）.

    解析顺序（2026-07-10-remove-server-local-workspace-mode 起 daemon-client 唯一）：

    1. ``workspace_member_runtimes`` 存在带 ``daemon_id`` 的 binding 行 →
       ``daemon_id`` 即 instance id（daemon-entity-binding 后稳定绑定键，
       daemon-client workspace 的源码物理位于某台 daemon 宿主，workspace 编码了
       "哪个 daemon 的宿主有源"，多成员绑定时取带 ``daemon_id`` 的行即源宿主
       daemon，LIMIT 1）。
    2. 无 binding 行 → 返回 None（genuinely unbound，caller 兜底报错）。
       legacy ``workspaces.daemon_runtime_id`` join fallback 已删（D-005）。

    Returns:
        The resolved ``daemon_instances.id``，或 None（未绑定 / 解析失败）。
    """
    try:
        # member binding（唯一来源）— daemon_id 即 instance id。
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

        return None
    except Exception as exc:
        log.warning(
            "resolve_daemon_instance_for_workspace_failed",
            workspace_id=str(workspace_id),
            error=str(exc),
        )
        return None


async def resolve_shared_daemon_for_borrow(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    provider: str | None,
) -> dict | None:
    """Resolve a workspace-shared daemon runtime for borrow dispatch.

    Change 2026-07-25-daemon-borrow-for-business task-05 / D-002@v1 / D-008@v1 /
    FR-04. Workspace-scoped counterpart of :func:`resolve_daemon_instance_for_workspace`
    with three borrow-specific gates layered on the member-binding join (design
    §5 Phase 3 / §7):

    1. ``shared = TRUE`` — lender（开发人员）必须显式把自己的 binding 标记为工作空间
       共享（D-003@v1 / D-005@v1）；默认 ``shared=false`` 的行不命中。
    2. ``user_id <> actor_user_id`` — 永不「借用」自己的 daemon（自有路径由 helper
       step 1 在本查询之前处理；此过滤是 defense-in-depth）。
    3. ``daemon_instances.status = 'online'`` — lender 的 daemon 当前必须可达。

    命中第一行（``LIMIT 1``）即取 ``daemon_id``，再叠加
    :func:`query_runtime_by_daemon_and_provider` 按 ``provider`` 解析出 lender daemon
    上的在线 runtime。返回的 runtime dict shape 与 placement 现有
    ``{id, user_id, provider, status, daemon_instance_id}``（``placement.py:793``）
    完全一致——``user_id`` 即 lender（daemon 归属人），调用方据此填 lender_user_id。

    provider 解析语义与派发链路同一查询（D-005）：``provider`` 非空时严格匹配，
    ``None`` 时取该 daemon 上最近心跳的在线 runtime。

    本函数**只做 shared + online 的数据解析**，不查 DAEMON_BORROW 权限——三重
    校验顺序「权限 → shared → online」中权限闸由调用方 helper
    （:func:`_resolve_borrowed_or_own_runtime`）在调本查询之前完成（fail fast，
    权限不通过不浪费 DB 查询）。

    Args:
        session: 数据库会话。
        workspace_id: 工作空间 id（借用边界 = 工作空间成员资格）。
        actor_user_id: 借用方（业务/管理人员）user_id，用于 ``user_id <> actor`` 排除。
        provider: 期望的 provider（claude/codex/...）；``None`` 取任意在线 runtime。

    Returns:
        runtime dict（``user_id`` = lender），或 ``None``（无共享 / 离线 / 无匹配 provider /
        查询异常）。
    """
    try:
        result = await session.execute(
            text(
                """
                SELECT wmr.daemon_id
                FROM workspace_member_runtimes wmr
                JOIN daemon_instances di ON di.id = wmr.daemon_id
                WHERE wmr.workspace_id = :wid
                  AND wmr.shared = TRUE
                  AND wmr.daemon_id IS NOT NULL
                  AND wmr.user_id <> :actor
                  AND di.status = 'online'
                LIMIT 1
                """
            ),
            {"wid": workspace_id.hex, "actor": actor_user_id.hex},
        )
        row = result.first()
        if row is None:
            return None

        daemon_id_raw = row[0]
        if daemon_id_raw is None:
            return None
        daemon_id = (
            daemon_id_raw if isinstance(daemon_id_raw, uuid.UUID) else uuid.UUID(str(daemon_id_raw))
        )

        # 叠加 provider 解析（与派发链路同一查询 / D-005）：命中 lender daemon 上
        # 匹配 provider 的在线 runtime；provider=None 取最近心跳的在线 runtime。
        return await query_runtime_by_daemon_and_provider(session, daemon_id, provider)
    except Exception as exc:
        log.warning(
            "resolve_shared_daemon_for_borrow_failed",
            workspace_id=str(workspace_id),
            actor_user_id=str(actor_user_id),
            provider=provider,
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
