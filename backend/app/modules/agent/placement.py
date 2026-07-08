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
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)


# Sentinel used by ``_resolve_decide_runtime`` to mean "this workspace does
# not need bound-runtime validation — fall back to user-level online check".
_DECIDE_FALLBACK_SENTINEL: dict = {"__fallback__": True}


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

    task-03 (change 2026-06-18-workspace-client-path): daemon-client workspace
    绑定的 daemon 离线/不存在时，``runtime_id`` 携带目标 daemon_runtime_id，
    默认 message 升级为「目标 daemon（{runtime_id}）离线，请启动...」，便于
    前端直接展示（D-001@v1 / FR-02 UX）。
    """

    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID,
        runtime_id: uuid.UUID | None = None,
        message: str | None = None,
    ) -> None:
        if user_id is None:
            raise TypeError("NoOnlineDaemonError requires user_id")
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.runtime_id = runtime_id
        if message is None:
            if runtime_id is not None:
                message = f"目标 daemon（{runtime_id}）离线，请启动 sillyhub-daemon 后重试"
            else:
                message = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
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

        # task-03 (FR-02 / D-001@v1): daemon-client workspace 强绑路由——
        # 校验 workspace.daemon_runtime_id 是否在线且属于 user。避免「decide
        # 通过但 dispatch 抛错」的语义割裂（design §4.6 推荐方案）。
        bound_rt = await self._resolve_decide_runtime(workspace_id=workspace_id, user_id=user_id)
        if bound_rt is _DECIDE_FALLBACK_SENTINEL:
            # server-local workspace（或 workspace 不存在/无 path_source）：
            # 维持现状 user 级在线判定（design §9 兼容）。
            has_runtime = await self._has_online_runtime(user_id)
            if has_runtime:
                log.info(
                    "placement_backend_auto",
                    backend="daemon",
                    has_online_runtime=True,
                )
                return ExecutionBackend.DAEMON
            raise NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id)

        # daemon-client: bound_rt 已校验在线且属于 user。
        log.info(
            "placement_backend_daemon_client_bound",
            backend="daemon",
            runtime_id=str(bound_rt["id"]),  # type: ignore[index]
        )
        return ExecutionBackend.DAEMON

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------

    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        # task-03 (2026-06-18-workspace-client-path): workspace 标识，daemon-client
        # workspace 用 daemon_runtime_id 强绑路由；None 走 server-local 兼容路径。
        workspace_id: uuid.UUID | None = None,
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
        runtime = await self._resolve_dispatch_runtime(
            workspace_id=workspace_id,
            user_id=user_id,
            provider=provider,
        )
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

        # 2026-07-08：interactive lease 必须带 session_id + run_id（daemon
        # _startInteractiveSession 缺这两个字段会 interactive_missing_fields 早返回）。
        # dispatch_to_daemon 原来走 batch 不需要这些；改 kind=interactive 后必须补。
        if "session_id" not in metadata:
            metadata["session_id"] = str(uuid.uuid4())
        if "run_id" not in metadata:
            metadata["run_id"] = str(agent_run_id)

        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind, metadata, created_at, updated_at)
                VALUES
                    (:id, :agent_run_id, :runtime_id, 'pending', 'interactive', :metadata, :now, :now)
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
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )
        await self._send_ws_wakeup(
            daemon_id,
            lease_id,
            agent_run_id,
            payload_runtime_id=runtime_id,
        )

        return lease_id

    # ------------------------------------------------------------------
    # Interactive session dispatch (D-005@v1 / FR-01, task-05)
    # ------------------------------------------------------------------

    @dataclass(frozen=True, slots=True)
    class InteractiveDispatch:
        """Result of ``prepare_interactive_dispatch``.

        Holds the identifiers needed to wake the daemon and to send the
        follow-up SESSION_INJECT control message. The lease is created with
        ``agent_run_id=NULL`` (D-005@v1) — the first turn run_id is stored in
        lease metadata only, so the interactive lease never participates in
        batch expiry / handle_lease_expiry paths.
        """

        lease_id: uuid.UUID
        runtime_id: uuid.UUID
        daemon_id: uuid.UUID
        run_id: uuid.UUID
        # gap-2（D-002@v3 补丁）：lease 级 claim_token，供 create_session 在首 turn
        # SESSION_INJECT payload 中直接携带（避免再查一次 lease metadata）。
        claim_token: str

    async def prepare_interactive_dispatch(
        self,
        *,
        agent_session_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        provider: str,
        prompt: str,
        model: str | None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
    ) -> "RunPlacementService.InteractiveDispatch":
        """Create the long-lived interactive lease for a new session.

        D-005@v1 contract:
        - ``agent_run_id`` column is NULL (the FK lives on AgentRun.agent_session_id,
          not on the lease).
        - ``kind='interactive'`` so lease_service / claim / expire paths can
          branch (D-002@v3 driver vs batch TaskRunner).
        - ``lease_expires_at`` is NULL → ``expire_leases`` never selects it
          (interactive lease lifecycle is owned by ``DaemonService.end_session``).
        - first turn parameters (run_id / prompt / model / provider /
          manual_approval) are stored in lease ``metadata`` so the daemon
          claim payload can drive an independent first turn.

        Adds + flushes only; does NOT commit and does NOT send any WS message.
        The caller (``DaemonService.create_session``) owns the single commit
        that fixes the session↔lease↔run triple, then calls
        ``notify_interactive_dispatch``.

        Raises ``NoOnlineDaemonError`` when no online runtime is available for
        the user (server-local routing; ``workspace_id`` not supported for
        interactive sessions in this wave).
        """
        runtime = await self._get_online_runtime(user_id, provider=provider)
        if runtime is None:
            log.warning(
                "interactive_dispatch_no_online_runtime",
                agent_session_id=str(agent_session_id),
                user_id=str(user_id),
            )
            raise NoOnlineDaemonError(user_id=user_id)

        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        # gap-2（D-002@v3 补丁 design §3 / §6 step 1）：interactive lease 在创建时
        # 即生成 claim_token 写入 metadata，使首 turn SESSION_INJECT payload 能携带
        # claim_token 给 daemon（daemon claim 后复用同一 token，claim_lease 不重新生成）。
        # 与 batch lease 区分：batch lease 无 claim_token，claim_lease 时才生成。
        claim_token = secrets.token_hex(32)
        metadata: dict = {
            "session_id": str(agent_session_id),
            "run_id": str(agent_run_id),
            "prompt": prompt,
            "provider": provider,
            "claim_token": claim_token,
        }
        if model:
            metadata["model"] = model
        metadata["manual_approval"] = bool(manual_approval)
        metadata["ask_user_only"] = bool(ask_user_only)

        # Raw SQL mirrors dispatch_to_daemon so we can set kind/agent_run_id=NULL
        # without touching the batch ORM insert path. NULL lease_expires_at is
        # the D-005@v1 proof that expire_leases skips this lease.
        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind,
                     lease_expires_at, metadata, created_at, updated_at)
                VALUES
                    (:id, NULL, :runtime_id, 'pending', 'interactive',
                     NULL, :metadata, :now, :now)
                """
            ),
            {
                "id": lease_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata),
                "now": now,
            },
        )
        # Flush so the row is visible inside the caller's transaction; the
        # caller commits the full triple (session + run + lease) atomically.
        await self._session.flush()

        log.info(
            "interactive_dispatch_lease_prepared",
            lease_id=str(lease_id),
            agent_session_id=str(agent_session_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        return RunPlacementService.InteractiveDispatch(
            lease_id=lease_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            run_id=agent_run_id,
            claim_token=claim_token,
        )

    async def prepare_scan_interactive_dispatch(
        self,
        *,
        agent_session_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        provider: str,
        prompt: str,
        model: str | None,
        root_path: str,
        spec_root: str,
        runtime_root: str | None = None,
        workspace_id: uuid.UUID | None = None,
        workspace_name: str | None = None,
        workspace_slug: str | None = None,
        repo_url: str | None = None,
        branch: str | None = None,
        spec_strategy: str = "platform-managed",
    ) -> "RunPlacementService.InteractiveDispatch":
        """scan 真阻塞（generic-wibbling-whisper.md 改造点 A）：scan 专用 interactive lease。

        与 ``prepare_interactive_dispatch`` 同构（kind='interactive' / lease_expires_at=NULL
        / agent_run_id 列 NULL），但写入 scan 所需的 lease.metadata（root_path / spec_root
        / runtime_root / workspace_* / repo_url / branch，daemon 经 execution-context
        重建 scan bundle）+ 强制 ``manual_approval=True``（注入 canUseTool）+
        ``ask_user_only=True``（只 AskUserQuestion 阻塞，其他工具 allow-through 让 scan
        自动跑）。runtime 按 ``_resolve_dispatch_runtime(workspace_id, user_id)``
        路由——per-member binding 优先，无 member 行回退 workspace 全局列（D-006，
        2026-07-02-workspace-config-flow task-01）。
        """
        runtime = await self._resolve_dispatch_runtime(
            workspace_id=workspace_id,
            user_id=user_id,
            provider=provider,
        )
        if runtime is None:
            log.warning(
                "scan_interactive_dispatch_no_online_runtime",
                agent_session_id=str(agent_session_id),
                user_id=user_id,
            )
            raise NoOnlineDaemonError(user_id=user_id)

        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        claim_token = secrets.token_hex(32)
        metadata: dict = {
            "session_id": str(agent_session_id),
            "run_id": str(agent_run_id),
            "prompt": prompt,
            "provider": provider,
            "claim_token": claim_token,
            # scan 真阻塞：强制 manual_approval=True（注入 canUseTool）+ ask_user_only=True
            # （只 AskUserQuestion 阻塞等用户决策，其他工具 allow-through 让 scan 自动推进）。
            "manual_approval": True,
            "ask_user_only": True,
            # scan bundle 重建字段（daemon execution-context fetch 消费）。
            "root_path": root_path,
            "spec_root": spec_root,
            "scan_run_id": str(agent_run_id),
            "mode": "scan",
            # spec 同步策略透传（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
            # daemon claim 后经 build_claim_payload 读此字段放入 claim payload，
            # pullSpecBundle 据此三分支初始化缓存。
            "spec_strategy": spec_strategy,
        }
        if model:
            metadata["model"] = model
        if runtime_root:
            metadata["runtime_root"] = runtime_root
        if workspace_id:
            metadata["workspace_id"] = str(workspace_id)
        if workspace_name:
            metadata["workspace_name"] = workspace_name
        if workspace_slug:
            metadata["workspace_slug"] = workspace_slug
        if repo_url:
            metadata["repo_url"] = repo_url
        if branch:
            metadata["branch"] = branch

        # Raw SQL 与 prepare_interactive_dispatch 一致：kind='interactive' + NULL
        # lease_expires_at（scan 长任务永不过期，由 DaemonService.end_session 管生命周期）。
        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind,
                     lease_expires_at, metadata, created_at, updated_at)
                VALUES
                    (:id, NULL, :runtime_id, 'pending', 'interactive',
                     NULL, :metadata, :now, :now)
                """
            ),
            {
                "id": lease_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata),
                "now": now,
            },
        )
        await self._session.flush()

        log.info(
            "scan_interactive_dispatch_lease_prepared",
            lease_id=str(lease_id),
            agent_session_id=str(agent_session_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        return RunPlacementService.InteractiveDispatch(
            lease_id=lease_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            run_id=agent_run_id,
            claim_token=claim_token,
        )

    async def notify_interactive_dispatch(
        self,
        dispatch: "RunPlacementService.InteractiveDispatch",
    ) -> bool:
        """Wake the target daemon after ``create_session`` committed the triple.

        Returns True when a wake-up was delivered to a connected daemon,
        False when the daemon is offline (caller must converge the session to
        a failed terminal state and raise ``DaemonRuntimeOffline``).

        Sends a plain ``task_available`` wakeup; the SESSION_INJECT control
        message with the first-turn prompt is sent by the service layer via
        ``ws_hub.send_session_control`` after this returns True. Routing is by
        ``dispatch.daemon_id`` (WS connection key); the payload carries
        ``dispatch.runtime_id`` for provider session identification.
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        if hub.is_connected(dispatch.daemon_id):
            await hub.send_wakeup(
                dispatch.daemon_id,
                lease_id=dispatch.lease_id,
                payload_runtime_id=dispatch.runtime_id,
            )
            log.info(
                "interactive_dispatch_wakeup_sent",
                daemon_id=str(dispatch.daemon_id),
                runtime_id=str(dispatch.runtime_id),
                lease_id=str(dispatch.lease_id),
                run_id=str(dispatch.run_id),
            )
            return True

        # Fallback: broadcast to any connected daemon entity on the same host.
        connected = hub.connected_daemon_ids
        if connected:
            for did in connected:
                await hub.send_wakeup(
                    did,
                    lease_id=dispatch.lease_id,
                    payload_runtime_id=dispatch.runtime_id,
                )
            log.info(
                "interactive_dispatch_wakeup_broadcast",
                target_daemon=str(dispatch.daemon_id),
                sent_to=[str(d) for d in connected],
                lease_id=str(dispatch.lease_id),
                run_id=str(dispatch.run_id),
            )
            return True

        log.info(
            "interactive_dispatch_wakeup_no_connection",
            daemon_id=str(dispatch.daemon_id),
            lease_id=str(dispatch.lease_id),
            run_id=str(dispatch.run_id),
        )
        return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _resolve_dispatch_runtime(
        self,
        *,
        workspace_id: uuid.UUID | None,
        user_id: uuid.UUID,
        provider: str | None,
    ) -> dict | None:
        """Resolve the runtime a dispatch should target.

        Routing rules (change 2026-07-03-daemon-entity-binding task-08,
        D-004/D-005/D-008):

        - ``workspace_id is None``  → server-local compatibility path
          (``_get_online_runtime(user_id, provider=...)``). Keeps existing
          tests and callers working (design §9 / backward compat).
        - Per-member binding (WorkspaceMemberRuntime) takes priority:
          if a row exists for ``(workspace_id, user_id)``, read its
          ``daemon_id`` (D-004):
            - ``daemon_id`` is None (pre-migration row) →
              ``NoOnlineDaemonError(message="未绑定守护进程，请重绑")``.
            - Daemon must be online + owned by user.
            - Resolve ``provider`` parameter (caller override) or
              ``workspace.default_agent`` → find matching runtime on that
              daemon (D-005).
            - Match found → return that runtime.
            - No match → ``NoOnlineDaemonError`` with enabled-providers list
              (D-008, never auto-fallback to another provider).
        - No binding row   → fall back to legacy ``Workspace.daemon_runtime_id``
          global column (backward compatible, see task-02 deprecation).
        - ``path_source != 'daemon-client'`` → server-local behavior unchanged.
        """
        # Branch 0: no workspace context → legacy server-local path.
        if workspace_id is None:
            return await self._get_online_runtime(user_id, provider=provider)

        # Branch 1: per-member binding (D-006, 2026-07-02-workspace-config-flow
        # task-01). If a WorkspaceMemberRuntime row exists for this
        # (workspace_id, user_id), use its runtime_id (must be online + owned
        # by user). No binding row -> fall through to legacy Workspace global
        # column (backward compatible).
        from app.modules.workspace.member_runtimes.exceptions import (
            MemberBindingNotFound,
        )
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        try:
            binding = await MemberBindingResolver.resolve_member_binding(
                self._session, workspace_id, user_id
            )
        except MemberBindingNotFound:
            binding = None  # No binding row — fall through to legacy logic.
        except Exception as exc:
            log.warning(
                "resolve_member_binding_unexpected_error",
                workspace_id=str(workspace_id),
                user_id=str(user_id),
                error=str(exc),
            )
            binding = None  # Defensive fallback to legacy logic.

        if binding is not None:
            # task-08: per-member binding now routes via daemon_id + default_agent.
            daemon_id = binding.daemon_id
            if daemon_id is None:
                # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="未绑定守护进程，请重绑",
                )

            did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

            # Step 1: verify the daemon_instance is online + owned by user
            daemon = await self._query_daemon_online_by_id(did, user_id)
            if daemon is None:
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="绑定的守护进程离线或不存在，请启动后重试",
                )

            # Step 2: resolve target provider — caller override or workspace.default_agent
            target_provider = provider
            if target_provider is None:
                ws_data = (
                    (
                        await self._session.execute(
                            text("SELECT default_agent FROM workspaces WHERE id = :id"),
                            {"id": workspace_id.hex},
                        )
                    )
                    .mappings()
                    .first()
                )
                target_provider = ws_data["default_agent"] if ws_data else None

            # Step 3: find a runtime matching target_provider on this daemon
            rt = await self._query_runtime_by_daemon_and_provider(did, target_provider)
            if rt is not None:
                return rt

            # Step 4: D-008 — no auto-fallback, error with enabled providers list
            enabled = await self._get_daemon_enabled_providers(did)
            if target_provider:
                msg = f"守护进程已启用 {enabled}，但未启用 default_agent '{target_provider}'"
            else:
                msg = f"守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置"
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message=msg,
            )

        # Fall through to legacy workspace global-column logic.
        ws_row = (
            (
                await self._session.execute(
                    text("SELECT path_source, daemon_runtime_id FROM workspaces WHERE id = :id"),
                    {"id": workspace_id.hex},
                )
            )
            .mappings()
            .first()
        )

        # Branch 1: workspace row missing → defensive fallback.
        if ws_row is None:
            log.warning(
                "dispatch_workspace_not_found",
                workspace_id=str(workspace_id),
                user_id=str(user_id),
            )
            return await self._get_online_runtime(user_id, provider=provider)

        path_source = ws_row["path_source"]
        daemon_runtime_id = ws_row["daemon_runtime_id"]

        # Branch 2: non daemon-client → unchanged server-local semantics.
        if path_source != "daemon-client":
            return await self._get_online_runtime(user_id, provider=provider)

        # Branch 3: daemon-client without bound runtime → defensive error.
        if not daemon_runtime_id:
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="daemon-client workspace 未绑定 daemon_runtime_id（数据异常）",
            )

        rt_id = (
            uuid.UUID(daemon_runtime_id)
            if isinstance(daemon_runtime_id, str)
            else daemon_runtime_id
        )

        # Branch 4: bound runtime — must be online and belong to user.
        rt = await self._query_online_by_id(rt_id)
        if rt is None:
            # offline OR missing — unified "unavailable" semantics (D-001).
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                runtime_id=rt_id,
            )

        rt_user_raw = rt.get("user_id")
        rt_user_id = uuid.UUID(rt_user_raw) if isinstance(rt_user_raw, str) else rt_user_raw
        if rt_user_id != user_id:
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                runtime_id=rt_id,
                message="目标 daemon 不属于当前用户，无法路由",
            )

        # provider mismatch: bound runtime wins, just warn (D-001 强绑优先).
        if provider and rt.get("provider") and rt["provider"] != provider:
            log.warning(
                "dispatch_bound_runtime_provider_mismatch",
                wanted=provider,
                bound=rt["provider"],
                runtime_id=str(rt_id),
                workspace_id=str(workspace_id),
            )
        return rt

    async def _query_online_by_id(self, runtime_id: uuid.UUID) -> dict | None:
        """Return the online daemon runtime with the given id, or None.

        Per D-001@v1 we unify "missing" and "offline" into ``None`` — both
        surface as ``NoOnlineDaemonError(runtime_id=...)`` upstream. ``user_id``
        is included so the caller can validate ownership (防越权借用他人 daemon).
        """
        try:
            result = await self._session.execute(
                text(
                    """
                    SELECT id, user_id, provider, status, daemon_instance_id
                    FROM daemon_runtimes
                    WHERE id = :rid
                    """
                ),
                {"rid": runtime_id.hex},
            )
            row = result.mappings().first()
            if not row or row.get("status") != "online":
                return None
            return dict(row)
        except Exception as exc:
            log.warning(
                "placement_query_online_by_id_failed",
                runtime_id=str(runtime_id),
                error=str(exc),
            )
            return None

    # ------------------------------------------------------------------
    # Daemon-entity resolution helpers (task-08 / D-004 / D-005 / D-008)
    # ------------------------------------------------------------------

    async def _query_daemon_online_by_id(
        self,
        daemon_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> dict | None:
        """Return the online daemon_instance row, or None if offline / not owned.

        Thin wrapper over the shared module-level query (D-004@v1,
        2026-07-05-daemon-client-change-binding-fix task-01). 派发与写回链路共用同一
        条 SQL，避免逻辑重复。
        """
        from app.modules.workspace.member_runtimes.queries import (
            query_daemon_online_by_id,
        )

        return await query_daemon_online_by_id(self._session, daemon_id, user_id)

    async def _query_runtime_by_daemon_and_provider(
        self,
        daemon_id: uuid.UUID,
        target_provider: str | None,
    ) -> dict | None:
        """Return the first online runtime matching ``target_provider`` on the
        given daemon, or None (design §6 D-005). 共享查询薄壳（task-01）。
        """
        from app.modules.workspace.member_runtimes.queries import (
            query_runtime_by_daemon_and_provider,
        )

        return await query_runtime_by_daemon_and_provider(self._session, daemon_id, target_provider)

    async def _get_daemon_enabled_providers(
        self,
        daemon_id: uuid.UUID,
    ) -> list[str]:
        """Return sorted unique provider names enabled on the daemon. 共享查询薄壳（task-01）。"""
        from app.modules.workspace.member_runtimes.queries import (
            get_daemon_enabled_providers,
        )

        return await get_daemon_enabled_providers(self._session, daemon_id)

    async def _resolve_decide_runtime(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> dict | object:
        """Resolve runtime for ``decide_backend`` (task-08, daemon_id routing).

        Returns:
        - ``_DECIDE_FALLBACK_SENTINEL`` when the workspace does not require
          bound-runtime validation (server-local / missing / unknown
          path_source) — caller falls back to ``_has_online_runtime``.
        - a runtime ``dict`` when the workspace has a per-member binding and
          the bound daemon is online + has at least one online runtime.
        - raises ``NoOnlineDaemonError`` when:
            * binding.daemon_id is None (pre-migration) → "未绑定守护进程，请重绑"
            * daemon is offline / cross-user
            * daemon is online but has no online runtimes (all providers stale)
        """
        # Branch 1: per-member binding (D-004, 2026-07-03-daemon-entity-binding
        # task-08). If a WorkspaceMemberRuntime row exists, read its daemon_id
        # (not runtime_id) for routing. daemon_id is None → pre-migration row.
        # No binding row -> fall through to legacy Workspace.daemon_runtime_id.
        from app.modules.workspace.member_runtimes.exceptions import (
            MemberBindingNotFound,
        )
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        try:
            binding = await MemberBindingResolver.resolve_member_binding(
                self._session, workspace_id, user_id
            )
        except MemberBindingNotFound:
            binding = None  # No binding row — fall through to legacy logic.
        except Exception as exc:
            log.warning(
                "resolve_member_binding_unexpected_error",
                workspace_id=str(workspace_id),
                user_id=str(user_id),
                error=str(exc),
            )
            binding = None  # Defensive fallback to legacy logic.

        if binding is not None:
            # task-08: per-member binding now routes via daemon_id.
            daemon_id = binding.daemon_id
            if daemon_id is None:
                # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="未绑定守护进程，请重绑",
                )

            did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

            # Verify the daemon_instance is online + owned by user.
            daemon = await self._query_daemon_online_by_id(did, user_id)
            if daemon is None:
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="绑定的守护进程离线或不存在，请启动后重试",
                )

            # Pick any online runtime on the daemon to confirm the daemon is
            # reachable (decide only validates reachability, not provider match;
            # the specific provider is resolved by _resolve_dispatch_runtime).
            rt = await self._query_runtime_by_daemon_and_provider(did, None)
            if rt is not None:
                return rt

            # Daemon has no online runtimes at all — still raise (not D-008
            # which is for provider mismatch; this is a more fundamental state).
            enabled = await self._get_daemon_enabled_providers(did)
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message=(
                    f"守护进程在线但无可用运行时（已启用 provider: {enabled}），"
                    f"请确认 daemon 状态正常"
                ),
            )

        # binding is None (no binding row) → fall through to legacy.

        try:
            ws_row = (
                (
                    await self._session.execute(
                        text(
                            "SELECT path_source, daemon_runtime_id FROM workspaces WHERE id = :id"
                        ),
                        {"id": workspace_id.hex},
                    )
                )
                .mappings()
                .first()
            )
        except Exception as exc:
            log.warning(
                "placement_decide_workspace_lookup_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )
            return _DECIDE_FALLBACK_SENTINEL

        if ws_row is None or ws_row["path_source"] != "daemon-client":
            return _DECIDE_FALLBACK_SENTINEL

        daemon_runtime_id = ws_row["daemon_runtime_id"]
        if not daemon_runtime_id:
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="daemon-client workspace 未绑定 daemon_runtime_id（数据异常）",
            )

        rt_id = (
            uuid.UUID(daemon_runtime_id)
            if isinstance(daemon_runtime_id, str)
            else daemon_runtime_id
        )
        rt = await self._query_online_by_id(rt_id)
        if rt is None:
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                runtime_id=rt_id,
            )
        rt_user_raw = rt.get("user_id")
        rt_user_id = uuid.UUID(rt_user_raw) if isinstance(rt_user_raw, str) else rt_user_raw
        if rt_user_id != user_id:
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                runtime_id=rt_id,
                message="目标 daemon 不属于当前用户，无法路由",
            )
        return rt

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
                SELECT id, user_id, provider, status, daemon_instance_id
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
        daemon_id: uuid.UUID,
        lease_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        *,
        payload_runtime_id: uuid.UUID | None = None,
    ) -> None:
        """Send a WebSocket wake-up signal to the daemon via DaemonWsHub.

        Routing is by ``daemon_id`` (the WS connection key, design §5.3). The
        payload optionally carries ``payload_runtime_id`` so the daemon
        dispatches the wake to the correct provider session (design §5.3).
        Defaults to ``daemon_id`` when ``payload_runtime_id`` is None (legacy
        compat for callers without a provider-level runtime_id).
        """
        from app.modules.daemon.ws_hub import get_ws_hub

        hub = get_ws_hub()
        if hub.is_connected(daemon_id):
            await hub.send_wakeup(
                str(daemon_id),
                lease_id=str(lease_id),
                payload_runtime_id=payload_runtime_id,
            )
            log.info(
                "ws_wakeup_sent",
                daemon_id=str(daemon_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
                payload_runtime_id=str(payload_runtime_id) if payload_runtime_id else None,
            )
            return

        # Fallback: broadcast to all connected daemon entities on the same host.
        connected = hub.connected_runtime_ids
        if connected:
            for did in connected:
                await hub.send_wakeup(
                    did,
                    lease_id=str(lease_id),
                    payload_runtime_id=payload_runtime_id,
                )
            log.info(
                "ws_wakeup_broadcast",
                target_daemon=str(daemon_id),
                sent_to=[str(d) for d in connected],
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
        else:
            log.info(
                "ws_wakeup_skipped_no_connection",
                daemon_id=str(daemon_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
