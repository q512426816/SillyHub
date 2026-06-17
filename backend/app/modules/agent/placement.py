"""RunPlacementService -- unified decision layer for agent run execution backend.

Decides whether an AgentRun should execute on the server (subprocess) or be
dispatched to a local daemon.  The daemon tables (daemon_runtimes,
daemon_task_leases) are created by the daemon module (task-01 / task-02);
this service uses raw SQL via ``text()`` so it works even before the ORM
models land.
"""

from __future__ import annotations

import enum
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class ExecutionBackend(enum.Enum):
    """Where an AgentRun will be executed."""

    SERVER = "server"  # legacy server subprocess mode (path removed task-01; enum retained)
    DAEMON = "daemon"  # local daemon mode


class NoOnlineDaemonError(Exception):
    """无在线 daemon，SERVER 路径已删除，无法执行 AgentRun。

    上层（AgentService 三处 dispatch 入口）捕获后：
    - 置 AgentRun.status = "failed"
    - AgentRun.error_code = "no_online_daemon"
    - AgentRun.output_redacted = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
    """

    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID,
        message: str = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试",
    ) -> None:
        if user_id is None:
            raise TypeError("NoOnlineDaemonError requires user_id")
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.message = message
        super().__init__(message)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RunPlacementService:
    """Unified entry point that decides *where* an AgentRun executes."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------

    async def decide_backend(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
        preferred_backend: str | None = None,
    ) -> ExecutionBackend:
        """Decide which backend should execute the upcoming AgentRun.

        Daemon-Only (task-01): the SERVER subprocess backend has been removed.
        This method now either returns ``ExecutionBackend.DAEMON`` (when an
        online daemon runtime exists) or raises ``NoOnlineDaemonError``.

        The ``preferred_backend`` parameter is retained for signature
        compatibility. Passing ``"server"`` is no longer supported and raises
        ``NoOnlineDaemonError``; any other value is ignored (daemon-only path).
        """
        log.info(
            "placement_decide_backend",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            change_id=str(change_id),
            task_id=str(task_id),
            preferred_backend=preferred_backend,
        )

        # SERVER backend removed (task-01); explicit "server" request is rejected.
        if preferred_backend is not None:
            pref = preferred_backend.lower().strip()
            if pref == "server":
                raise NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id)
            if pref != "daemon":
                log.warning(
                    "placement_unknown_preferred_backend",
                    preferred_backend=preferred_backend,
                )

        # Auto-detect: DAEMON when an online runtime exists, else fail loudly.
        has_runtime = await self._has_online_runtime(user_id)
        if has_runtime:
            log.info(
                "placement_backend_auto",
                backend="daemon",
                has_online_runtime=True,
            )
            return ExecutionBackend.DAEMON

        raise NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id)

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------

    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        # 通用字段（design §7.2）
        provider: str | None = None,
        model: str | None = None,
        prompt: str | None = None,
        resume_session_id: str | None = None,
        repo_url: str | None = None,
        branch: str | None = None,
        allowed_paths: list[str] | None = None,
        tool_config: dict | None = None,
        timeout_seconds: int | None = None,
        # stage run 专用（R-stage）
        step_prompt: str | None = None,
        stage: str | None = None,
        read_only: bool | None = None,
        # scan run 专用（R-stage）
        root_path: str | None = None,
        spec_root: str | None = None,
        runtime_root: str | None = None,
        # ql-20260617-009：workspace 标识（daemon 用 root_path 作真实 cwd 时仍需
        # slug 兜底 mirror，name 仅作日志可读性）。
        workspace_name: str | None = None,
        workspace_slug: str | None = None,
    ) -> uuid.UUID | None:
        """Dispatch an AgentRun to the user's daemon.

        所有上下文参数（除 CLAUDE.md，design §Phase 2 第 111 行）持久化到
        ``daemon_task_leases.metadata`` JSON 列。daemon 通过
        ``_build_claim_payload``（初始 claim）和 ``GET execution-context``
        （fetch，task-02/task-05）读取。

        守卫规则：
        - 真值字段用 ``if x:``（None / 空串 / 空 list 不写入）；
        - ``read_only`` / ``timeout_seconds`` 用 ``is not None``，避免
          ``False`` / ``0`` 被吞（R-stage 显式 false 必须持久化）。

        Returns lease_id，或 None（无在线 runtime——task-01 后此情况由
        decide_backend 抛 NoOnlineDaemonError，此处保留 None 兜底）。
        """
        runtime = await self._get_online_runtime(user_id, provider=provider)
        if runtime is None:
            log.warning(
                "dispatch_daemon_no_online_runtime",
                agent_run_id=str(agent_run_id),
                user_id=str(user_id),
            )
            return None

        # raw SQL 返回的 id 在 SQLite 是 CHAR(32) hex string、在 PostgreSQL 是
        # UUID 对象；统一标准化为 uuid.UUID，供后续 .hex / str() / WS hub 使用。
        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        metadata: dict = {}
        # 通用字段（design §7.2）
        if prompt:
            metadata["prompt"] = prompt
        if provider:
            metadata["provider"] = provider
        if model:
            metadata["model"] = model
        if resume_session_id:
            metadata["resume_session_id"] = resume_session_id
        if repo_url:
            metadata["repo_url"] = repo_url
        if branch:
            metadata["branch"] = branch
        if allowed_paths:
            metadata["allowed_paths"] = allowed_paths
        if tool_config:
            metadata["tool_config"] = tool_config
        if timeout_seconds is not None:
            metadata["timeout_seconds"] = timeout_seconds
        # stage run 专用（R-stage 应对）
        if step_prompt:
            metadata["step_prompt"] = step_prompt
        if stage:
            metadata["stage"] = stage
        if read_only is not None:
            metadata["read_only"] = read_only
        # scan run 专用（R-stage 应对）
        if root_path:
            metadata["root_path"] = root_path
        if spec_root:
            metadata["spec_root"] = spec_root
        if runtime_root:
            metadata["runtime_root"] = runtime_root
        # ql-20260617-009：workspace 标识透传给 daemon（_build_claim_payload + execution-context 均消费）
        if workspace_name:
            metadata["workspace_name"] = workspace_name
        if workspace_slug:
            metadata["workspace_slug"] = workspace_slug

        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, metadata, created_at, updated_at)
                VALUES
                    (:id, :agent_run_id, :runtime_id, 'pending', :metadata, :now, :now)
                """
            ),
            {
                # SQLAlchemy ``Uuid`` 在 SQLite 以 CHAR(32) hex 存储；用 .hex
                # 绑定参数（无连字符），PostgreSQL Uuid 列同样接受该形式。
                "id": lease_id.hex,
                "agent_run_id": agent_run_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata) if metadata else None,
                "now": now,
            },
        )
        await self._session.commit()

        log.info(
            "dispatch_daemon_lease_created",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        # -- Wave 2: WS wake-up signal (stub) -----------------------------------
        await self._send_ws_wakeup(runtime_id, lease_id, agent_run_id)

        return lease_id

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _has_online_runtime(self, user_id: uuid.UUID) -> bool:
        """Return True if the user has at least one online daemon runtime.

        Returns False (i.e. no runtime available) if the ``daemon_runtimes``
        table does not exist yet -- this happens when the daemon module
        migrations have not been applied.
        """
        try:
            result = await self._session.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM daemon_runtimes
                    WHERE user_id = :user_id
                      AND status = 'online'
                    """
                ),
                {"user_id": user_id.hex},
            )
            row = result.mappings().first()
            count = row["cnt"] if row else 0
            return count > 0
        except Exception as exc:
            log.warning(
                "placement_has_online_runtime_query_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            return False

    async def _get_online_runtime(
        self,
        user_id: uuid.UUID,
        *,
        provider: str | None = None,
    ) -> dict | None:
        """Return the first online daemon runtime for the user, or None.

        If *provider* is given, prefer a runtime with that provider; if none
        is online, fall back to any online runtime and emit
        ``placement_provider_fallback`` (FR-03: dispatch must never silently
        fail just because the requested provider is momentarily offline). When
        *provider* is None, behavior is unchanged (ORDER BY last_heartbeat_at,
        no warning).
        """
        try:
            if provider:
                # 1) strict match on the requested provider
                row = await self._query_online(user_id, provider=provider)
                if row:
                    return row
                # 2) fall back to any online runtime + observable warning
                fallback = await self._query_online(user_id, provider=None)
                if fallback:
                    log.warning(
                        "placement_provider_fallback",
                        wanted=provider,
                        actual=fallback.get("provider"),
                        user_id=str(user_id),
                    )
                    return fallback
                return None
            # provider=None: unchanged single query, no warning
            return await self._query_online(user_id, provider=None)
        except Exception as exc:
            log.warning(
                "placement_get_online_runtime_query_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            return None

    async def _query_online(
        self,
        user_id: uuid.UUID,
        *,
        provider: str | None = None,
    ) -> dict | None:
        """Query the first online daemon runtime, optionally filtered by provider.

        Ordered by ``last_heartbeat_at DESC`` so the most recently seen runtime
        wins (R-02). Raises propagate to ``_get_online_runtime`` which owns the
        error-suppression policy.
        """
        where_extra = "AND provider = :provider" if provider else ""
        params: dict = {"user_id": user_id.hex}
        if provider:
            params["provider"] = provider
        result = await self._session.execute(
            text(
                f"""
                SELECT id, user_id, provider, status
                FROM daemon_runtimes
                WHERE user_id = :user_id
                  AND status = 'online'
                  {where_extra}
                ORDER BY last_heartbeat_at DESC NULLS LAST
                LIMIT 1
                """
            ),
            params,
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def _send_ws_wakeup(
        self,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID,
        agent_run_id: uuid.UUID,
    ) -> None:
        """Send a WebSocket wake-up signal to the daemon via DaemonWsHub.

        The daemon process connects WS using its primary runtime_id but
        may have multiple provider-specific runtimes registered.  If the
        target runtime has no WS connection we broadcast to every connected
        runtime (they all belong to the same daemon host).
        """
        from app.modules.daemon.ws_hub import get_ws_hub

        hub = get_ws_hub()
        if hub.is_connected(runtime_id):
            await hub.send_wakeup(str(runtime_id), lease_id=str(lease_id))
            log.info(
                "ws_wakeup_sent",
                runtime_id=str(runtime_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
            return

        # Fallback: broadcast to any connected runtime from the same host.
        connected = hub.connected_runtime_ids
        if connected:
            for rid in connected:
                await hub.send_wakeup(rid, lease_id=str(lease_id))
            log.info(
                "ws_wakeup_broadcast",
                target_runtime=str(runtime_id),
                sent_to=[str(r) for r in connected],
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
        else:
            log.info(
                "ws_wakeup_skipped_no_connection",
                runtime_id=str(runtime_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
