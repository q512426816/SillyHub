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
from app.modules.daemon.grants.queries import resolve_granted_daemon_for_borrow

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
       daemon，``LIMIT 1``）。多成员多机绑定时按统一全序
       ``ORDER BY 实例心跳（daemon_instances.last_heartbeat_at）DESC,
       daemon_id ASC`` 选行（D-005@v1）——与
       :func:`resolve_representative_binding` 同键全序，相同候选集上两解析
       必收敛同机（钉定链路与 host_fs worktree 路由不分叉），心跳并列时
       daemon_id 升序 tie-break。
    2. 无 binding 行 → 返回 None（genuinely unbound，caller 兜底报错）。
       legacy ``workspaces.daemon_runtime_id`` join fallback 已删（D-005）。

    Returns:
        The resolved ``daemon_instances.id``，或 None（未绑定 / 解析失败）。
    """
    try:
        # member binding（唯一来源）— daemon_id 即 instance id。
        # 双源同序（D-005@v1）：与 resolve_representative_binding 统一全序
        # ORDER BY di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC——相同候选集
        # 上钉定解析与 host_fs 路由必收敛同机。inner join daemon_instances 会静默
        # 丢弃 daemon_instances 行缺失的 stale 绑定行（良性——该 daemon 实体已
        # 不存在，本就不可路由）；不加 online 过滤（design 风险登记口径）：离线
        # 机器靠心跳排序自然靠后，RPC 失败由 worktree 创建链路 fail-loud 兜底。
        result = await session.execute(
            text(
                """
                SELECT wmr.daemon_id
                FROM workspace_member_runtimes wmr
                JOIN daemon_instances di ON di.id = wmr.daemon_id
                WHERE wmr.workspace_id = :wid
                  AND wmr.daemon_id IS NOT NULL
                ORDER BY di.last_heartbeat_at DESC NULLS LAST, wmr.daemon_id ASC
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
    FR-04. **Change 2026-08-28-daemon-agent-share task-06：本函数改薄壳**，内部委托
    :func:`app.modules.daemon.grants.queries.resolve_granted_daemon_for_borrow`
    （design §5 Phase 2.3 / §6 文件清单——授权唯一判定源切 grants 统一授权表，
    SQL 语义逐条等价：enabled↔shared=TRUE、daemon_instance_id 非空、
    granted_by≠actor↔user_id<>actor、grantee_id=workspace_id↔同工作区成员、
    daemon 在线；grants 版另含 actor 成员资格 EXISTS 防御，task-02 加固）。

    原函数签名与返回 shape **保留不变**（防破坏既有调用方）：仍返回
    ``{id, user_id, provider, status, daemon_instance_id}`` runtime dict
    （``user_id`` 即 lender）或 ``None``。新调用方请直接用 grants 版（额外携带
    ``grant_id`` 供借用审计）。

    Args:
        session: 数据库会话。
        workspace_id: 工作空间 id（借用边界 = 工作空间成员资格）。
        actor_user_id: 借用方（业务/管理人员）user_id，用于排除自己共享的 daemon。
        provider: 期望的 provider（claude/codex/...）；``None`` 取任意在线 runtime。

    Returns:
        runtime dict（``user_id`` = lender），或 ``None``（无生效 grant / 离线 /
        无匹配 provider / actor 非成员 / 查询异常——grants 版吞异常返回 None，
        对齐本函数原契约）。
    """
    resolution = await resolve_granted_daemon_for_borrow(
        session,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
        provider=provider,
    )
    if resolution is None:
        return None
    rt = resolution.runtime
    # ORM 对象转回原 raw-SQL dict shape（grants 版 ORM Uuid(as_uuid=True) 两方言
    # 下均为 uuid.UUID，调用方的 uuid.UUID(str(...)) 归一化兼容两种类型）。
    return {
        "id": rt.id,
        "user_id": rt.user_id,
        "provider": rt.provider,
        "status": rt.status,
        "daemon_instance_id": rt.daemon_instance_id,
    }


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


async def resolve_representative_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str | None,
) -> dict | None:
    """Resolve a representative binding for cross-workspace worker dispatch.

    Change 2026-08-19-cross-workspace-team-mission task-02（design §4.2）：
    Worker 的 target≠anchor 派发时，若本人在 target 无 binding，按「owner 优先→
    任意在线」选该工作区的代表 daemon（placement.py 新增 representative_fallback
    旗标分支调用本函数）。

    解析顺序（task-02 acceptance）：

    1. **owner 在线优先**：查询 workspace.created_by（owner）的在线 binding。
    2. **任意在线兜底**：owner 无在线 binding，查该 workspace 任意 member 的在线
       binding（按 daemon 实例心跳排序；daemon 内 runtime 选择仍与派发链路同一
       启发式——runtime 最近心跳优先）。
    3. **均无在线**：返回 None（调用方抛 NoOnlineDaemonError）。

    daemon 选择统一全序 ``ORDER BY daemon_instances.last_heartbeat_at DESC
    NULLS LAST, daemon_id ASC``（D-005@v1）——与
    :func:`resolve_daemon_instance_for_workspace` 同键全序，多成员多机绑定时
    两解析（钉定链路 vs host_fs worktree 路由）必收敛同机；心跳并列时
    daemon_id 升序 tie-break，结果确定。

    在线判定复用派发链路同一标准（daemon_instances.status = 'online'），返回的
    runtime dict shape 与 query_runtime_by_daemon_and_provider 一致
    （{id, user_id, provider, status, daemon_instance_id}），兼容 placement 消费方。

    Args:
        session: 数据库会话。
        workspace_id: 目标工作区 id（worker 落地的工作区）。
        user_id: 派发发起人 user_id（用于过滤 owner 在线 binding）。
        provider: 期望的 provider（claude/codex/...）；None 取任意在线 runtime。

    Returns:
        runtime dict（{id, user_id, provider, status, daemon_instance_id}），
        或 None（无在线 binding）。
    """
    try:
        # 分支1：owner 在线优先（created_by = workspace owner）
        # 关键修复：provider 非空时必须在SQL层过滤 runtime，否则owner的daemon在线
        # 但无匹配provider的runtime时会错误地走到分支2
        if provider:
            # provider 非空：直接查 owner 的匹配 provider 的在线 runtime。
            # daemon 选择按统一全序（D-005@v1，与路由查询同键）——owner 多绑定
            # 多候选时确定选行，owner 优先语义不变。
            result = await session.execute(
                text(
                    """
                    SELECT dr.id, dr.user_id, dr.provider, dr.status, dr.daemon_instance_id
                    FROM workspace_member_runtimes wmr
                    JOIN daemon_instances di ON di.id = wmr.daemon_id
                    JOIN workspaces w ON w.id = wmr.workspace_id
                    JOIN daemon_runtimes dr ON dr.daemon_instance_id = wmr.daemon_id
                    WHERE wmr.workspace_id = :wid
                      AND w.created_by = :uid
                      AND wmr.daemon_id IS NOT NULL
                      AND di.status = 'online'
                      AND dr.status = 'online'
                      AND dr.provider = :prov
                    ORDER BY di.last_heartbeat_at DESC NULLS LAST, wmr.daemon_id ASC
                    LIMIT 1
                    """
                ),
                {"wid": workspace_id.hex, "uid": user_id.hex, "prov": provider},
            )
            row = result.mappings().first()
            if row is not None:
                runtime = dict(row)
                log.info(
                    "representative_binding_owner_hit",
                    workspace_id=str(workspace_id),
                    user_id=str(user_id),
                    provider=provider,
                    runtime_id=str(runtime["id"]),
                )
                return runtime
        else:
            # provider 为空：查 owner 的任意在线 daemon，再取任意 runtime。
            # daemon 选择按统一全序（D-005@v1，与路由查询同键）。
            result = await session.execute(
                text(
                    """
                    SELECT wmr.daemon_id
                    FROM workspace_member_runtimes wmr
                    JOIN daemon_instances di ON di.id = wmr.daemon_id
                    JOIN workspaces w ON w.id = wmr.workspace_id
                    WHERE wmr.workspace_id = :wid
                      AND w.created_by = :uid
                      AND wmr.daemon_id IS NOT NULL
                      AND di.status = 'online'
                    ORDER BY di.last_heartbeat_at DESC NULLS LAST, wmr.daemon_id ASC
                    LIMIT 1
                    """
                ),
                {"wid": workspace_id.hex, "uid": user_id.hex},
            )
            row = result.mappings().first()
            if row is not None and row["daemon_id"] is not None:
                daemon_id_raw = row["daemon_id"]
                daemon_id = (
                    daemon_id_raw
                    if isinstance(daemon_id_raw, uuid.UUID)
                    else uuid.UUID(str(daemon_id_raw))
                )
                # 叠加 provider 解析（与派发链路同一查询）
                runtime = await query_runtime_by_daemon_and_provider(session, daemon_id, None)
                if runtime:
                    log.info(
                        "representative_binding_owner_hit",
                        workspace_id=str(workspace_id),
                        user_id=str(user_id),
                        provider=provider,
                        runtime_id=str(runtime["id"]),
                    )
                    return runtime

        # 分支2：owner 无在线 binding，查任意 member 在线 binding
        # （按实例心跳全序排序，D-005@v1——daemon 选择与路由查询同键）
        # 关键修复：provider 非空时必须在SQL层过滤，否则选出的daemon未必有该provider
        if provider:
            # provider 非空：直接查匹配 provider 的在线 runtime，按实例心跳全序
            # 排序（D-005@v1，从 runtime 心跳改为实例心跳——与路由查询同键）
            result = await session.execute(
                text(
                    """
                    SELECT dr.id, dr.user_id, dr.provider, dr.status, dr.daemon_instance_id
                    FROM workspace_member_runtimes wmr
                    JOIN daemon_instances di ON di.id = wmr.daemon_id
                    JOIN daemon_runtimes dr ON dr.daemon_instance_id = wmr.daemon_id
                    WHERE wmr.workspace_id = :wid
                      AND wmr.daemon_id IS NOT NULL
                      AND di.status = 'online'
                      AND dr.status = 'online'
                      AND dr.provider = :prov
                    ORDER BY di.last_heartbeat_at DESC NULLS LAST, wmr.daemon_id ASC
                    LIMIT 1
                    """
                ),
                {"wid": workspace_id.hex, "prov": provider},
            )
            row = result.mappings().first()
            if row is not None:
                runtime = dict(row)
                log.info(
                    "representative_binding_any_online_hit",
                    workspace_id=str(workspace_id),
                    provider=provider,
                    runtime_id=str(runtime["id"]),
                )
                return runtime
        else:
            # provider 为空：先选 daemon（按实例心跳全序，与路由查询同键），再取
            # 任意 runtime。MAX(di.last_heartbeat_at)——di 与 wmr.daemon_id 经
            # di.id 1:1 join，分组结果等价且满足 ONLY_FULL_GROUP_BY（D-005@v1）。
            result = await session.execute(
                text(
                    """
                    SELECT wmr.daemon_id, MAX(di.last_heartbeat_at) AS max_heartbeat
                    FROM workspace_member_runtimes wmr
                    JOIN daemon_instances di ON di.id = wmr.daemon_id
                    JOIN daemon_runtimes dr ON dr.daemon_instance_id = wmr.daemon_id
                    WHERE wmr.workspace_id = :wid
                      AND wmr.daemon_id IS NOT NULL
                      AND di.status = 'online'
                      AND dr.status = 'online'
                    GROUP BY wmr.daemon_id
                    ORDER BY max_heartbeat DESC NULLS LAST, wmr.daemon_id ASC
                    LIMIT 1
                    """
                ),
                {"wid": workspace_id.hex},
            )
            row = result.mappings().first()
            if row is not None and row["daemon_id"] is not None:
                daemon_id_raw = row["daemon_id"]
                daemon_id = (
                    daemon_id_raw
                    if isinstance(daemon_id_raw, uuid.UUID)
                    else uuid.UUID(str(daemon_id_raw))
                )
                runtime = await query_runtime_by_daemon_and_provider(session, daemon_id, None)
                if runtime:
                    log.info(
                        "representative_binding_any_online_hit",
                        workspace_id=str(workspace_id),
                        provider=provider,
                        runtime_id=str(runtime["id"]),
                    )
                    return runtime

        # 分支3：均无在线 binding，返回 None
        log.info(
            "representative_binding_none_online",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            provider=provider,
        )
        return None
    except Exception as exc:
        log.warning(
            "resolve_representative_binding_failed",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            provider=provider,
            error=str(exc),
        )
        return None
