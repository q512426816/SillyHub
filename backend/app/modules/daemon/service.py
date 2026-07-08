"""Daemon service — orchestrates daemon runtime registration, heartbeat, and lease lifecycle."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.schema import SessionReopenResponse

log = get_logger(__name__)


# ── Re-export：异常类 + 状态常量已迁入对应子包，facade 集中 re-export ────────
# 保持 ``from app.modules.daemon.service import XxxError`` 全部 import 路径不变
# （D-002@v1 facade 完全兼容 / FR-05）。
# 禁止用 ``import *``：显式列出便于 grep 追踪 + 避免 namespace 污染（N5）。
# 顺序：runtime → lease → patch → session（按子域，无循环）。
# E402: re-export 在 log 之后（保持模块顶层 import 区与 re-export 区视觉分隔）。
# F401: 所有符号均为 re-export（facade 自身委托方法或外部 import 引用）。
from app.modules.daemon.lease.service import (  # noqa: E402, F401
    DaemonAgentRunNotFound,
    DaemonInvalidClaimToken,
    DaemonLeaseNoAgentRun,
    DaemonLeaseNotClaimed,
    DaemonLeaseNotFound,
    DaemonLeaseNotPending,
)
from app.modules.daemon.patch.service import (  # noqa: E402, F401
    PatchApplyError,
    PatchConflictError,
)
from app.modules.daemon.runtime.service import (  # noqa: E402, F401
    DaemonInstanceOwnershipMismatch,
    DaemonRegisterResult,
    DaemonRpcConflict,
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeInUse,
    DaemonRuntimeNotFound,
    DaemonRuntimeOffline,
)
from app.modules.daemon.session.service import (  # noqa: E402, F401
    ACTIVE_SESSION_STATUSES,
    ACTIVE_TURN_STATUSES,
    TERMINAL_TURN_STATUSES,
    DaemonOffline,
    DaemonSessionInvariantViolation,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionResumeUnsupported,
    DaemonSessionTurnConflict,
    SessionControlResult,
    SessionDispatchResult,
    SessionRecoveryResult,
)

if TYPE_CHECKING:
    from app.modules.daemon.host_fs import HostFsDelegate
    from app.modules.daemon.run_sync.service import SubmittedMessages


class DaemonService:
    """Service layer for daemon runtime and task lease operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 持有 5 子 service 引用。子 service 顶层 import 本模块定义的异常类，
        # 为避免模块级循环 import（design §7.2），子 service 类在 __init__ 内
        # 函数级 import（router.py:624 同款 lazy import 模式）。
        from app.modules.daemon.lease.service import LeaseService
        from app.modules.daemon.patch.service import PatchService
        from app.modules.daemon.run_sync.service import RunSyncService
        from app.modules.daemon.runtime.service import RuntimeService
        from app.modules.daemon.session.service import SessionService

        self._rt: RuntimeService = RuntimeService(session)
        self._lease: LeaseService = LeaseService(session)
        self._run: RunSyncService = RunSyncService(session)
        # 反向注入 facade 引用（D-006@v1）：跨子域调用经 self._facade 反向委托。
        # - RunSyncService（W4）：_get_lease_and_verify_token / _publish_session_event
        #   经 facade 委托（W5/W6 落位后仍保留委托）。
        # - LeaseService（W6）：complete_lease 调 _apply_patch_to_worktree（patch）/
        #   _run_post_scan_validation / _trigger_stage_completion_callback（run_sync）；
        #   handle_lease_expiry 调 _publish_run_event（run_sync）。均经 facade 委托。
        self._run._facade = self
        self._lease._facade = self
        self._sess: SessionService = SessionService(session)
        self._patch: PatchService = PatchService(session)
        # task-06：patch 子域 facade 反向注入（与 lease/run_sync 一致，D-006@v1）。
        # daemon-client 分支经 self._facade.host_fs_delegate 访问 HostFsDelegate.git_apply。
        self._patch._facade = self
        # task-06：HostFsDelegate 实例 lazy 构造（见 ``host_fs_delegate`` property）。
        # 不能在 __init__ 直接构造——host_fs 子包顶层 import 本模块的异常类
        # （delegate.py:39 / ws_rpc.py:41），模块级 import 会循环。lazy 构造 +
        # 实例缓存避开循环，且只在 daemon-client path_source 首次触发时付代价。
        self._host_fs_delegate: "HostFsDelegate | None" = None

    @property
    def host_fs_delegate(self) -> "HostFsDelegate":
        """Lazy-construct the :class:`HostFsDelegate` for host-fs operations.

        task-06（FR-03 / D-002@V1）注入点：patch / run_sync 子域经
        ``self._facade.host_fs_delegate`` 访问。选 lazy property 而非构造注入，
        因 ``HostFsDelegate`` / ``HostFsWsRpc`` 顶层 import 本模块异常类（循环
        import 规避），且 ws_hub 是进程级单例（``get_daemon_ws_hub``），无需在
        DaemonService 构造时持有——首次 daemon-client path_source 触发时一次性
        构造并缓存，server-local 路径（默认）永不触发，零回归（NFR-02）。
        """
        if self._host_fs_delegate is None:
            # lazy import 避开 host_fs 子包对 daemon.service 异常类的循环依赖。
            from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            self._host_fs_delegate = HostFsDelegate(
                session=self._session,
                ws_hub=get_daemon_ws_hub(),
                ws_rpc=HostFsWsRpc(get_daemon_ws_hub()),
            )
        return self._host_fs_delegate

    # ── Runtime operations (delegate to RuntimeService) ───────────────────

    async def register_daemon(
        self,
        user_id: uuid.UUID,
        *,
        daemon_local_id: uuid.UUID,
        server_url: str,
        hostname: str,
        os: str | None = None,
        arch: str | None = None,
        allowed_roots: list[str] | None = None,
        providers: list[dict] | None = None,
        daemon_version: str | None = None,
        daemon_build_id: str | None = None,
    ) -> DaemonRegisterResult:
        """Per-daemon 注册 facade（design §5.2 / D-006）。

        转发到 RuntimeService.register_daemon：upsert daemon_instances + 各
        daemon_runtimes + stale 清理。返回 daemon_instance_id + 各 runtime_id。
        2026-07-04-daemon-version-management：透传 daemon_version/build_id。
        """
        return await self._rt.register_daemon(
            user_id,
            daemon_local_id=daemon_local_id,
            server_url=server_url,
            hostname=hostname,
            os=os,
            arch=arch,
            allowed_roots=allowed_roots,
            providers=providers,
            daemon_version=daemon_version,
            daemon_build_id=daemon_build_id,
        )

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        """Per-runtime 心跳 facade（legacy，仅残留调用方使用）。

        2026-07-03-daemon-entity-binding task-07：HTTP ``/heartbeat`` 端点改走
        ``heartbeat_daemon``（per-daemon 合并心跳）。本方法保留供单 runtime 测试与
        潜在残留调用方使用（provider 无独立心跳，design §9.2）。
        """
        return await self._rt.heartbeat(runtime_id)

    async def heartbeat_daemon(
        self,
        daemon_local_id: uuid.UUID,
        providers: list[dict] | None = None,
        daemon_version: str | None = None,
        daemon_build_id: str | None = None,
    ) -> DaemonInstance:
        """Per-daemon 心跳 facade（design §5.4 / §9.1 / D-006）。

        转发到 RuntimeService.heartbeat_daemon：刷新 daemon_instances.last_heartbeat_at
        + 各 daemon_runtimes.status。返回 DaemonInstance（HTTP 响应从中读
        daemon_instance_id / status / allowed_roots）。
        2026-07-04-daemon-version-management：透传 daemon_version/build_id。
        """
        return await self._rt.heartbeat_daemon(
            daemon_local_id,
            providers,
            daemon_version=daemon_version,
            daemon_build_id=daemon_build_id,
        )

    async def get_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime | None:
        return await self._rt.get_runtime(runtime_id, user_id, is_platform_admin=is_platform_admin)

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]:
        return await self._rt.list_runtimes(user_id)

    async def list_instances(self, user_id: uuid.UUID) -> list[DaemonInstance]:
        """List online daemon instances for the current user (task-10 / FR-09).

        Delegates to RuntimeService. Returns ORM DaemonInstance rows;
        the router constructs DaemonInstanceRead DTOs with provider info.
        """
        return await self._rt.list_instances(user_id)

    async def list_runtimes_page(
        self,
        *,
        actor_user_id: uuid.UUID,
        is_platform_admin: bool,
        q: str | None,
        type_filter: str | None,
        status_filter: str | None,
        user_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[DaemonRuntime, User | None, DaemonInstance | None]], int]:
        """Paginated filtered runtime list (task-04 / FR-04). 委托 RuntimeService."""
        return await self._rt.list_runtimes_page(
            actor_user_id=actor_user_id,
            is_platform_admin=is_platform_admin,
            q=q,
            type_filter=type_filter,
            status_filter=status_filter,
            user_id=user_id,
            limit=limit,
            offset=offset,
        )

    async def update_runtime(
        self,
        runtime_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        display_alias: str | None,
        display_alias_set: bool,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        """PATCH display_alias 委托 (task-04 / D-002@v1)."""
        return await self._rt.update_runtime(
            runtime_id,
            actor_user_id,
            display_alias=display_alias,
            display_alias_set=display_alias_set,
            is_platform_admin=is_platform_admin,
        )

    # ── Machine-level operations (delegate to RuntimeService, machine-runtime-hierarchy) ──
    # 机器级聚合 / 别名 mutation / 归属校验，面向 DaemonInstance 一级资源（design §5.1/§5.2）。
    # 对齐 list_instances(210)/list_runtimes_page(218)/update_runtime(242) 薄委托模式。

    async def list_machines(
        self,
        *,
        actor_user_id: uuid.UUID,
        is_platform_admin: bool,
        q: str | None,
        status: str | None,
        provider: str | None,
        user_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[
        list[tuple[DaemonInstance, User | None]],
        dict[uuid.UUID, list[DaemonRuntime]],
        int,
    ]:
        """机器级分页/筛选聚合查询 facade（design §5.1 / FR-1）。

        返回 ``(rows, runtimes_by_instance, total)``：rows 为本页 ``(instance, owner)``
        ORM 行；runtimes_by_instance 为一次性 IN 查询分组的 ``{instance_id: [runtime]}``；
        total 为过滤后机器总数。router/task-03 负责 _runtime_read 组装 DaemonMachineRead。
        """
        return await self._rt.list_machines(
            actor_user_id=actor_user_id,
            is_platform_admin=is_platform_admin,
            q=q,
            status=status,
            provider=provider,
            user_id=user_id,
            limit=limit,
            offset=offset,
        )

    async def update_machine_alias(
        self,
        instance_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        display_alias: str | None,
        display_alias_set: bool,
        is_platform_admin: bool = False,
    ) -> DaemonInstance:
        """PATCH /machines/{id} 别名 facade（design §5.2 / D-001 / FR-2）。

        直写 ``daemon_instance.display_alias``（0-runtime 机器亦可改）。委托
        RuntimeService.update_machine_alias，返回 DaemonInstance（router 再聚合）。
        """
        return await self._rt.update_machine_alias(
            instance_id,
            actor_user_id,
            display_alias=display_alias,
            display_alias_set=display_alias_set,
            is_platform_admin=is_platform_admin,
        )

    async def _get_owned_instance(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonInstance:
        """取归属 daemon_instance facade（design §5.2 / self-update 端点复用）。

        委托 RuntimeService._get_owned_instance，越权/不存在 → DaemonRuntimeNotFound (404)。
        """
        return await self._rt._get_owned_instance(
            instance_id, user_id, is_platform_admin=is_platform_admin
        )

    async def update_allowed_roots(
        self,
        runtime_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        allowed_roots: list[str],
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        """PUT allowed_roots facade (2026-06-29-runtime-allowed-roots-config task-02)."""
        return await self._rt.update_allowed_roots(
            runtime_id,
            actor_user_id,
            allowed_roots=allowed_roots,
            is_platform_admin=is_platform_admin,
        )

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime:
        return await self._rt.mark_offline(runtime_id, user_id)

    async def disable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        return await self._rt.disable_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> None:
        return await self._rt.delete_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
        max_age_seconds: int = 45,  # DEFAULT_RUNTIME_STALE_SECONDS 随迁后字面量
    ) -> DaemonRuntime:
        return await self._rt.enable_runtime(
            runtime_id,
            user_id,
            is_platform_admin=is_platform_admin,
            max_age_seconds=max_age_seconds,
        )

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = 45,  # DEFAULT_RUNTIME_STALE_SECONDS 随迁后字面量
    ) -> int:
        return await self._rt.cleanup_stale_runtimes(max_age_seconds)

    async def _get_owned_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DaemonRuntime:
        # router.py:622 list_dir 端点直接调用此私有方法（facade 兼容保留委托）。
        return await self._rt._get_owned_runtime(runtime_id, user_id)

    # ── Lease operations ──────────────────────────────────────────────────

    # ── Lease operations (delegate to LeaseService, task-06) ─────────────
    # 8 正向生命周期方法 + handle_lease_expiry / handle_expired_leases_batch
    # （expiry 回滚，同属 lease 子域）迁入 lease/service.py。facade 保留委托。
    # _build_claim_payload 已迁 lease/context.py（模块级函数 build_claim_payload），
    # 仅被 claim_lease 内部调用，facade 删除。
    # _get_lease_and_verify_token 保留 facade 同名委托：run_sync 子域（task-04）
    # 通过 self._facade._get_lease_and_verify_token 跨域调用（submit_messages /
    # sync_agent_run_status / close_interactive_run），删了会 AttributeError。

    async def create_lease(
        self,
        runtime_id: uuid.UUID,
        *,
        agent_run_id: uuid.UUID | None = None,
        ttl_seconds: int = 3600,
    ) -> DaemonTaskLease:
        return await self._lease.create_lease(
            runtime_id, agent_run_id=agent_run_id, ttl_seconds=ttl_seconds
        )

    async def claim_lease(
        self,
        lease_id: uuid.UUID,
        runtime_id: uuid.UUID,
    ) -> tuple[DaemonTaskLease, dict]:
        return await self._lease.claim_lease(lease_id, runtime_id)

    async def start_lease(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        return await self._lease.start_lease(lease_id, claim_token)

    async def lease_heartbeat(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        return await self._lease.lease_heartbeat(lease_id, claim_token)

    async def complete_lease(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        result: dict,
    ) -> DaemonTaskLease:
        return await self._lease.complete_lease(lease_id, claim_token, result)

    async def _trigger_stage_completion_callback(
        self,
        agent_run_id: uuid.UUID,
        path_source: str | None = None,
    ) -> None:
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        # 保留同名委托：complete_lease（lease 子域，task-06）通过 self._facade 调用。
        # task-05：path_source 由 complete_lease 入口反查后透传，签名 default=None
        # 向后兼容现有调用；回调体分流归 task-07。
        return await self._run._trigger_stage_completion_callback(
            agent_run_id, path_source=path_source
        )

    async def _run_post_scan_validation(
        self,
        lease: DaemonTaskLease,
        path_source: str | None = None,
    ) -> None:
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        # 保留同名委托：complete_lease（lease 子域，task-06）通过 self._facade 调用。
        # task-05：path_source 由 complete_lease 入口反查后透传，签名 default=None
        # 向后兼容现有调用；回调体分流归 task-08。
        return await self._run._run_post_scan_validation(lease, path_source=path_source)

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> SubmittedMessages:
        """Submit agent conversation messages for a lease.

        委托 RunSyncService：写 AgentRunLog + 同步 AgentRun 状态，返回
        ``SubmittedMessages``（int 子类 == 写入条数，携带 Redis pub/sub 意图）。
        router 在 session 归还连接后调 publish_submitted_messages 发布
        （QueuePool 修复 3）。
        """
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        return await self._run.submit_messages(lease_id, claim_token, agent_run_id, messages)

    async def get_lease(self, lease_id: uuid.UUID) -> DaemonTaskLease | None:
        return await self._lease.get_lease(lease_id)

    async def list_leases(self, runtime_id: uuid.UUID) -> list[DaemonTaskLease]:
        return await self._lease.list_leases(runtime_id)

    async def expire_leases(self) -> list[DaemonTaskLease]:
        return await self._lease.expire_leases()

    # ── AgentRun status sync ─────────────────────────────────────────────

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        """Sync AgentRun status from daemon side.

        Validates the lease + claim_token, locates the associated AgentRun,
        updates its status and timestamps, and publishes a Redis event.

        Returns the updated AgentRun, or None if no AgentRun is linked.
        """
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        return await self._run.sync_agent_run_status(lease_id, claim_token, status, error=error)

    # ── Interactive run terminal close (gap-3, design §4) ──────────────────

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
        # ── SDKResultSuccess usage / cost / duration 透传（修复 interactive 路径
        # AgentRun.{total_cost_usd,num_turns,duration_ms,duration_api_ms,
        # input_tokens,output_tokens} 全 NULL 问题）。None 表示 daemon 未传，
        # 保留 AgentRun 原值不覆盖。
        total_cost_usd: float | None = None,
        num_turns: int | None = None,
        duration_ms: int | None = None,
        duration_api_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        # task-07 / FR-02：prompt cache 词元透传（SDKResultSuccess.usage.cache_*）。
        # facade 委托签名必须与 RunSyncService 同步，否则 router → facade → run_sync
        # 链路在 facade 断（TypeError: unexpected keyword argument）。None 默认值
        # 保证老调用方（router/WS）不传该参数时向后兼容。
        cache_read_tokens: int | None = None,
        cache_creation_tokens: int | None = None,
    ) -> AgentRun:
        """Close an interactive AgentRun from daemon SDK result (gap-3 / design §4).

        Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → this
        endpoint. The lease is verified via ``claim_token``; the run is located by
        ``run_id`` (interactive lease has ``agent_run_id=NULL`` per D-005@v1, so we
        cannot read it off the lease row) and bound to the lease's session via
        ``lease.metadata.session_id`` to prevent cross-session run injection.

        Terminal mapping (design §4):
          - status=success → AgentRun.status='completed'
          - status=error_during_execution → AgentRun.status='failed'
            (interrupted semantics; error_code='interactive_interrupted')
          - any other is_error → AgentRun.status='failed'
            (error_code='interactive_failed')

        Idempotent: an AgentRun already in TERMINAL_TURN_STATUSES is a no-op
        (returns the row unchanged) so daemon retries after a transient network
        blip do not double-write or flip a completed run back to failed.

        Raises ``DaemonAgentRunNotFound`` when the run does not exist or is not
        bound to the lease's session (resource-hiding 404 — no existence leak).
        """
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        return await self._run.close_interactive_run(
            lease_id,
            run_id,
            claim_token,
            status=status,
            is_error=is_error,
            subtype=subtype,
            result_summary=result_summary,
            total_cost_usd=total_cost_usd,
            num_turns=num_turns,
            duration_ms=duration_ms,
            duration_api_ms=duration_api_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
        )

    # ── Lease expiry / rollback (delegate to LeaseService, task-06) ───────
    # handle_lease_expiry / handle_expired_leases_batch 属 lease 子域（expiry 回滚），
    # 迁入 lease/service.py。facade 保留委托（cron / test 经 DaemonService 调用）。

    async def handle_lease_expiry(self, agent_run_id: UUID) -> None:
        return await self._lease.handle_lease_expiry(agent_run_id)

    async def handle_expired_leases_batch(self) -> int:
        return await self._lease.handle_expired_leases_batch()

    # ── Interactive session orchestration (delegate to SessionService, task-05) ─
    # 3 个私有辅助被 permission_service / run_sync 经 facade 调用（self._svc /
    # self._facade._publish_session_event / _get_current_run /
    # _get_owned_session_for_update），必须保留委托。其余私有辅助
    # (_converge_failed_dispatch / _converge_crashed_run /
    # _assert_no_other_active_run / _end_session_for_delete) 仅被 session 自身
    # 方法内部调用，迁入 SessionService 后调用在子域内完成，facade 不需委托
    # (grep 证据：除 service.py 外无外部调用点)。

    async def _get_owned_session_for_update(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        return await self._sess._get_owned_session_for_update(session_id, user_id)

    async def _get_current_run(
        self,
        session_id: uuid.UUID,
    ) -> AgentRun | None:
        return await self._sess._get_current_run(session_id)

    async def _publish_session_event(
        self,
        session_id: uuid.UUID,
        payload: dict[str, object],
    ) -> None:
        await self._sess._publish_session_event(session_id, payload)

    async def create_session(
        self,
        user_id: uuid.UUID,
        *,
        provider: str,
        prompt: str,
        model: str | None = None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
    ) -> SessionDispatchResult:
        return await self._sess.create_session(
            user_id,
            provider=provider,
            prompt=prompt,
            model=model,
            manual_approval=manual_approval,
            ask_user_only=ask_user_only,
        )

    async def inject_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        prompt: str,
    ) -> SessionDispatchResult:
        return await self._sess.inject_session(session_id, user_id, prompt=prompt)

    async def interrupt_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionControlResult:
        return await self._sess.interrupt_session(session_id, user_id)

    async def end_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        reason: str = "manual",
        actor_runtime_owner_id: uuid.UUID | None = None,
    ) -> SessionControlResult:
        return await self._sess.end_session(
            session_id,
            user_id,
            reason=reason,
            actor_runtime_owner_id=actor_runtime_owner_id,
        )

    # ── Daemon-restart recovery (task-10, FR-08 / D-003@v1) ──────────────────

    async def recover_session_after_daemon_restart(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID,
        provider: str,
        agent_session_id: str,
        interrupted_run_id: uuid.UUID | None,
    ) -> SessionRecoveryResult:
        return await self._sess.recover_session_after_daemon_restart(
            session_id,
            runtime_id=runtime_id,
            lease_id=lease_id,
            provider=provider,
            agent_session_id=agent_session_id,
            interrupted_run_id=interrupted_run_id,
        )

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
    ) -> Literal["active", "failed", "rejected"]:
        return await self._sess.confirm_session_reconnected(session_id, runtime_id=runtime_id)

    async def mark_session_recovery_failed(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        reason: str = "restore_failed",
    ) -> Literal["failed", "rejected"]:
        return await self._sess.mark_session_recovery_failed(
            session_id, runtime_id=runtime_id, reason=reason
        )

    # ── Read-only session list + history (task-12, FR-10 / D-005@v1) ────────

    async def list_agent_sessions(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status_filter: str | None = None,
    ) -> tuple[list[AgentSession], int]:
        return await self._sess.list_agent_sessions(
            user_id, limit=limit, offset=offset, status_filter=status_filter
        )

    async def get_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        return await self._sess.get_agent_session(session_id, user_id)

    async def reopen_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionReopenResponse:
        return await self._sess.reopen_session(session_id, user_id)

    async def delete_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        await self._sess.delete_agent_session(session_id, user_id)

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentRunLog]:
        return await self._sess.get_agent_session_logs(session_id, user_id)

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _publish_run_event(
        self,
        agent_run_id: UUID,
        *,
        event: str,
        status: str,
        **extra: object,
    ) -> None:
        """Publish a Redis event for an AgentRun status change.

        Failures are logged but never raised -- callers should not
        abort their workflow due to a Redis publish error.
        """
        # 委托到 RunSyncService（task-04 迁入 run_sync/service.py）。
        # 保留同名委托：handle_lease_expiry（lease 子域，task-06）通过此名调用。
        return await self._run._publish_run_event(agent_run_id, event=event, status=status, **extra)

    async def _apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
        path_source: str | None = None,
    ) -> None:
        """Apply a unified diff patch to the workspace associated with *agent_run_id*.

        委托到 PatchService（task-03 迁入 patch/service.py）。私有同名保留：3 调用点
        （complete_lease 内部 + test_wave5_integration + agent test_execution_context mock）
        按私有名访问，facade 委托不破坏调用方。

        task-05：path_source 由 complete_lease 入口反查后透传（签名 default=None
        向后兼容）；task-06 patch/service.py 按 path_source 分流——daemon-client 走
        HostFsDelegate.git_apply（WS RPC 委托 daemon 在宿主 apply），server-local 保留
        容器内 git apply。
        """
        return await self._patch.apply_patch_to_worktree(
            agent_run_id=agent_run_id,
            patch_data=patch_data,
            use_3way=use_3way,
            path_source=path_source,
        )

    async def _get_lease_and_verify_token(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        # 委托到 LeaseService（task-06 迁入 lease/service.py）。
        # 保留 facade 同名委托：run_sync 子域（task-04）的 submit_messages /
        # sync_agent_run_status / close_interactive_run 经 self._facade 跨域调用此名
        # （grep run_sync/service.py: 3 处 self._facade._get_lease_and_verify_token）。
        return await self._lease._get_lease_and_verify_token(lease_id, claim_token)
