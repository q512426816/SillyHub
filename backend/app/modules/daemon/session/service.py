"""Session subdomain service — agent session lifecycle (task-05 / D-005@v1).

Pure migration from DaemonService: 20 session methods + 3 status frozensets +
9 session-domain exception/result classes moved verbatim. Facade DaemonService
retains the 20 method signatures as one-line delegates (design §7.1).

Cross-domain lazy imports (RunPlacementService, get_daemon_ws_hub) stay
function-level (design §7.2 / §10 R1). DaemonRuntimeOffline is imported at
module level — safe under D-005 (facade loads sub-services via lazy import in
__init__, so no module cycle).
"""

from __future__ import annotations

import asyncio
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.permissions import Permission

# D-001@v1：create_session workspace 归属校验（口径与前端 listWorkspaces 一致）。
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.daemon.model import (
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)
from app.modules.daemon.protocol import (
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
    DAEMON_MSG_SESSION_RESUME,
)
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import SessionReopenResponse

log = get_logger(__name__)

# task-05（2026-08-14-sessions-portal / D-012@v1 / FR-05）：会话内配置热切换 WS
# 控制消息（Server → Daemon），原子承载「切换档案/供应商 + 切换轮 prompt」。
# 命名遵循 protocol.py 常量族 ``daemon:session_*`` 约定（与 sillyhub-daemon
# src/protocol.ts MSG.SESSION_* 逐字对齐，daemon 侧路由归 task-09）。常量置于
# 本模块（task-05 allowed_paths 约束：protocol.py 不在允许清单）；task-09 落
# daemon.ts 路由时以此为契约源，如后续收敛进 protocol.py 需同步搬移。
DAEMON_MSG_SESSION_SWITCH_CONFIG = "daemon:session_switch_config"


ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})


def _apply_session_terminal_status(run: AgentRun, session: AgentSession) -> str | None:
    """按 run 终态 + 任务类型计算 session 终态（D-002@v2 反向判定 + D-005 幂等）。

    多轮对话（``spec_strategy == "interactive"`` 且 ``change_id is None``）保持
    ``active``，等待下一个 AgentRun 接管；其余所有单轮任务（stage / scan /
    mission worker / quick-chat / oneshot）按 ``run.status`` 收口：
    ``completed → "ended"``，其余（failed/killed/...）→ ``"failed"``。

    幂等（D-005）：session 已处于终态（``ended`` / ``failed``，即不在
    :data:`ACTIVE_SESSION_STATUSES` 中）时直接返回 ``None``，由调用方判定是否跳过
    落库，避免覆盖已被其它路径（如 cancel_lease）写入的终态。

    Args:
        run: 刚结束的 AgentRun（取 ``status`` / ``spec_strategy`` / ``change_id``）。
        session: 该 run 所属的 AgentSession（取当前 ``status``）。

    Returns:
        计算出的新 session 状态（``"active"`` / ``"ended"`` / ``"failed"``），
        或 ``None`` 表示 session 已终态、无需变更。

    Note:
        - 不访问 DB、不 commit、不修改传入对象；调用方负责落库。
        - 对 ``run.status == "killed"`` 一律按非 completed 返 ``"failed"``，
          故 task-04 的 cancel_lease 路径不复用本函数（需 session→``"cancelled"``
          终态，见 D-003）。
    """
    if session.status not in ACTIVE_SESSION_STATUSES:
        return None  # D-005 幂等：已 ended/failed，不覆盖
    is_multi_turn = run.spec_strategy == "interactive" and run.change_id is None
    if is_multi_turn:
        return "active"  # 多轮对话保持 active，等下一个 AgentRun
    return "ended" if run.status == "completed" else "failed"


async def _resolve_daemon_id_for_runtime(
    db_session: AsyncSession,
    runtime_id: uuid.UUID,
) -> uuid.UUID | None:
    """task-06 / design §5.3: map a provider ``runtime_id`` to its daemon entity.

    WS Hub routes by ``daemon_instance_id`` (one socket per daemon entity), but
    sessions / dispatches are still keyed by ``daemon_runtimes.id`` (the provider
    row). This helper looks up the owning ``daemon_instance_id`` for a runtime
    so the session service can address the right WS connection.

    Migration fallback (D-007 window): pre-existing runtime rows have
    ``daemon_instance_id=NULL`` until the daemon re-registers under the new
    per-server config. For those, we fall back to the ``runtime_id`` itself as
    the connection key so the offline check + best-effort sends keep working
    against the legacy routing surface — once a daemon_instance is bound, the
    per-daemon key takes over. Returns ``None`` only when the runtime row is
    missing entirely (truly unknown runtime).
    """
    runtime = await db_session.get(DaemonRuntime, runtime_id)
    if runtime is None:
        return None
    if runtime.daemon_instance_id is None:
        # D-007 migration window: no daemon entity yet → route by runtime_id.
        return runtime_id
    return runtime.daemon_instance_id


async def _merge_lease_metadata(
    db_session: AsyncSession,
    lease_id: uuid.UUID,
    updates: dict,
    *,
    removals: list[str] | None = None,
) -> None:
    """task-03（2026-08-14-sessions-portal）：读出 lease metadata → 合并 → 写回。

    与 ``AgentService._apply_profile_to_lease`` 同款 raw-SQL 读合并写容错
    （SQLite 返 JSON 文本 / PG 返已解 dict）。**不 commit**——事务由
    ``create_session`` 统一提交（lease INSERT 也在同一事务内，flush 后可见）。
    会话路径专用（写 ``session_llm_provider_id`` / 档案提示词维度键）。

    task-05 加 ``removals``：切换分支清空维度时需**删键**而非写值（如切回
    本机默认要移除 ``session_llm_provider_id``，切到无提示词档案要移除
    ``system_prompt``），纯 merge 无法表达「键消失」。
    """
    import json as _json

    from sqlalchemy import text as _sa_text

    meta_row = (
        (
            await db_session.execute(
                _sa_text("SELECT metadata FROM daemon_task_leases WHERE id = :id"),
                {"id": lease_id.hex},
            )
        )
        .mappings()
        .first()
    )
    raw_meta = meta_row["metadata"] if meta_row else None
    if isinstance(raw_meta, str):
        meta: dict = _json.loads(raw_meta) if raw_meta else {}
    elif isinstance(raw_meta, dict):
        meta = dict(raw_meta)
    else:
        meta = {}
    for key in removals or []:
        meta.pop(key, None)
    meta.update(updates)
    await db_session.execute(
        _sa_text("UPDATE daemon_task_leases SET metadata = :meta WHERE id = :id"),
        {"meta": _json.dumps(meta), "id": lease_id.hex},
    )


class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409


class DaemonSessionNoCurrentRun(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_CURRENT_RUN"
    http_status = 409


class DaemonSessionInvariantViolation(AppError):
    code = "HTTP_409_DAEMON_SESSION_INVARIANT_VIOLATION"
    http_status = 409


class DaemonSessionResumeUnsupported(AppError):
    """Target session provider is not resumable (provider not in {claude, codex}).

    Claude SDK ``--resume <session_id>`` and Codex app-server
    ``thread/resume(threadId)`` both support resume; other providers
    cannot be reopened, so the ended session stays terminal.
    """

    code = "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
    http_status = 409


class DaemonSessionNoAgentSession(AppError):
    """Session has ``agent_session_id IS NULL`` (D-004@v1).

    A session that never reached a successful create-time SDK handshake (or
    whose create failed before the SDK returned a session id) has no SDK
    session to resume — reopen is impossible. The session is NOT mutated.
    """

    code = "HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION"
    http_status = 409


class DaemonOffline(AppError):
    """Target runtime has no active WS connection — reopen needs a live daemon.

    Reopen drives an SDK resume ON the owning daemon (task-08), so the daemon
    must be connected. Distinct from :class:`DaemonRuntimeOffline` (504, used
    by RPC/inject paths where a stale lease must surface as a gateway fault):
    reopen is a user-initiated optimistic action, so 409 CONFLICT fits the
    "try again once the runtime reconnects" semantics better than a 5xx.
    """

    code = "HTTP_409_DAEMON_OFFLINE"
    http_status = 409


# ── 2026-08-14-sessions-portal task-03：create_session 配置入口校验错误 ─────────


class DaemonSessionRuntimeNotFound(AppError):
    """runtime_id 指向的 runtime 不存在 / 非本人所有（404，不泄露存在性）。"""

    code = "HTTP_404_DAEMON_SESSION_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonSessionAttachmentsUnsupported(AppError):
    """非 claude 引擎（codex flat 协议无多模态）携附件 inject（D-6 三层门控第二层）。"""

    code = "HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED"
    http_status = 422


class DaemonSessionAttachmentInvalid(AppError):
    """附件引用非法：数量超限 / 类型不符（归属缺失走 404 隐藏语义）。"""

    code = "HTTP_422_SESSION_ATTACHMENT_INVALID"
    http_status = 422


class DaemonSessionWorkspaceNotFound(AppError):
    """workspace_id 指向的工作区不存在 / 调用者无 WORKSPACE_READ 权限（404，不泄露存在性）。"""

    code = "HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND"
    http_status = 404


class DaemonSessionRuntimeUnavailable(AppError):
    """钉定 runtime 离线 / 无 provider（409）。

    Grill C-01（P0）：runtime_id 钉定不可满足时明确报错，**绝不静默换机**
    （不走 first-online 选择，也不走 provider 不在线 fallback）。
    """

    code = "HTTP_409_DAEMON_SESSION_RUNTIME_UNAVAILABLE"
    http_status = 409


class DaemonSessionLlmProviderNotFound(AppError):
    """llm_provider_id 不存在 / 非会话属主（404，归属按 AgentSession.user_id）。"""

    code = "HTTP_404_DAEMON_SESSION_LLM_PROVIDER_NOT_FOUND"
    http_status = 404


class DaemonSessionLlmProviderKindMismatch(AppError):
    """供应商 agent_kind 与会话引擎不匹配（422，FR-06 防错配）。"""

    code = "HTTP_422_DAEMON_SESSION_LLM_PROVIDER_KIND_MISMATCH"
    http_status = 422


class DaemonSessionConfigInvalid(AppError):
    """会话配置 id 形态非法（非 UUID）/ 属主用户缺失（422）。"""

    code = "HTTP_422_DAEMON_SESSION_CONFIG_INVALID"
    http_status = 422


@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    """Result of create_session / inject_session (D-005@v1 triple)."""

    agent_session: AgentSession
    agent_run: AgentRun
    lease_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class SessionControlResult:
    """Result of interrupt_session / end_session.

    ``current_run_id`` is the run targeted by the control message (the unique
    currentRun), or None when end_session ran on a session without an active
    turn.
    """

    agent_session: AgentSession
    current_run_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class SessionRecoveryResult:
    """Result of recover_session_after_daemon_restart (task-10, FR-08).

    ``status`` is the post-recover session state as seen by backend:
      - ``reconnecting``: recover succeeded, currentRun converged; daemon now
        runs restoreAndReconnect (query resume) and will confirm_reconnected.
      - ``ended``/``failed``: session was already terminal (not resurrected).
      - ``rejected``: ownership mismatch (runtime/lease/provider/lease kind);
        daemon must delete its local record and not call restoreAndReconnect.

    ``interrupted_run_status`` reports the converged run result (``failed``)
    when a crashed currentRun was reconciled; ``None`` when the session was
    idle (no running run) or already terminal.
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID | None
    status: Literal["active", "ended", "failed", "reconnecting", "rejected"]
    interrupted_run_status: Literal["failed"] | None = None


class SessionReadiness:
    """跨请求共享的内存 session ready 状态管理器（task-05 / D-002@v1）。

    daemon 在 create 完成（fresh / recover）后调 :meth:`mark_ready`；
    ``inject_session`` 在 send SESSION_INJECT 前调 :meth:`wait` 阻塞等 ready
    event；session end/failed 后调 :meth:`clear` 清状态。

    **必须模块级单例**（gap-2 / D-002）：``SessionService`` /
    ``DaemonService`` 在 ``router.py`` 是 per-request 实例化，若把 readiness
    放 Service 实例字段，``mark_ready`` 与 ``wait`` 会各看各的
    ``_ready`` / ``_events``（不同实例），事件永远等不到 set。模块级单例
    保证跨请求共享同一份 set + event dict。

    ``asyncio.Event`` 必须在 event loop 内 ``await``：所有调用方
    （handler / inject_session / confirm_session_reconnected）均在
    ``async def`` 内执行，loop 上下文就绪。
    """

    def __init__(self) -> None:
        self._ready: set[uuid.UUID] = set()
        self._events: dict[uuid.UUID, asyncio.Event] = {}

    def _get_or_create_event(self, session_id: uuid.UUID) -> asyncio.Event:
        """取或建 per-session event（懒建）。"""
        event = self._events.get(session_id)
        if event is None:
            event = asyncio.Event()
            self._events[session_id] = event
        return event

    def mark_ready(self, session_id: uuid.UUID) -> None:
        """标记 session ready 并唤醒所有等待该 session 的 wait 协程。幂等。

        重复 mark 同一 session 不报错（set.add 幂等、event.set 幂等）。
        """
        self._ready.add(session_id)
        event = self._get_or_create_event(session_id)
        event.set()

    async def wait(self, session_id: uuid.UUID, timeout: float = 8) -> bool:
        """阻塞等 session ready event。

        - 已 ready（``session_id`` ∈ :attr:`_ready`）立即返 ``True``（零开销）。
        - 未 ready → ``asyncio.wait_for`` 包 ``event.wait()``，被 mark_ready
          唤醒后返 ``True``；超时返 ``False``（**不抛** ``TimeoutError``）。

        Args:
            session_id: AgentSession id。
            timeout: 超时秒数，默认 8s（ql-20260814-008：正常 daemon /ready
                上报 ~1s 内到；原 30s 会让 HTTP 请求先被 Next.js 代理 ~30s
                掐断，用户看到 500。8s 覆盖正常波动，超时仍 fallback 发
                SESSION_INJECT，兼容旧 daemon 不上报 ready（D-003 / R-02）。

        Returns:
            ``True`` = ready（被 mark 或已 ready）；``False`` = 超时。
        """
        # 已 ready 快速路径：不进入 wait_for，零开销。
        if session_id in self._ready:
            return True
        event = self._get_or_create_event(session_id)
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            return True
        except TimeoutError:
            return False

    def clear(self, session_id: uuid.UUID) -> None:
        """清除 session ready 状态（session end/failed 后调）。

        用**新 ``asyncio.Event`` 替换** ``_events`` 槽位（不是简单
        ``event.clear()``，也不是直接复用旧 event）—— 旧 event 已 ``set``，
        若复用则 clear 后 ``wait`` 会立即返 ``True``（旧 set 残留），与设计
        语义「clear 后须等下一次 mark_ready」不符。换新未 set 的 event，
        下一次 ``wait`` 必须等下一次 ``mark_ready`` 才能 set 返 ``True``。
        """
        self._ready.discard(session_id)
        self._events[session_id] = asyncio.Event()


_SessionReadiness: SessionReadiness | None = None


def get_session_readiness() -> SessionReadiness:
    """Return (and lazily create) the process-wide SessionReadiness singleton.

    模块级单例（gap-2 / D-002）：``SessionService`` / ``DaemonService`` 在
    ``router.py`` 是 per-request 实例化，readiness 不能放实例字段（否则
    mark/wait 各看各的 set/event 失效）。参照 ``app/core/db.py`` 的
    ``get_session_factory()`` 范式：模块级变量 + 懒初始化访问器。
    """
    global _SessionReadiness
    if _SessionReadiness is None:
        _SessionReadiness = SessionReadiness()
    return _SessionReadiness


class SessionService:
    """AgentSession 生命周期子域 service（task-05 / design §5.2）。

    方法体逐字节搬入 DaemonService 同名方法。facade 保留 20 个同名委托
    （design §7.1）。session 不持 facade 引用：跨域调用是
    ``agent.placement.RunPlacementService`` 与 ``daemon.ws_hub``（函数级 lazy
    import），不调 daemon 其他子 service（design §7.2 / D-006）。
    """

    _LIST_STATUSES = frozenset({"pending", "active", "reconnecting", "ended", "failed"})

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Interactive session orchestration (task-05, D-005@v1) ──────────────

    async def _get_owned_session_for_update(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        """Lock and return the AgentSession owned by ``user_id``.

        Uses ``with_for_update`` so two concurrent inject/interrupt/end calls
        on the same session serialize at the DB row level (PostgreSQL FOR
        UPDATE; SQLite ignores the hint but the query/ownership semantics
        still hold). Returns 404 for missing / cross-user sessions without
        leaking existence (mirrors ``_get_owned_runtime``).
        """
        stmt = (
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def _get_session_by_runtime_owner_for_update(
        self,
        session_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> AgentSession:
        """Lock and return a session whose bound runtime is owned by ``owner_user_id``.

        daemon 身份（X-API-Key）专用（ql-20260623-004）：api-key 解析出的
        ``user`` 是 runtime owner，**不等于** session 创建者
        （``AgentSession.user_id``）。ownership 改为「目标 session 绑定的
        runtime 归属于 api-key owner」（``DaemonRuntime.user_id``），否则
        admin 共享 runtime 场景（creator≠runtime owner）下的
        ``notifySessionEnd`` 会因 ``AgentSession.user_id`` 不匹配误判 404。

        join ``daemon_runtimes``；缺失 / 跨 owner → 404，不泄露存在性
        （与 :meth:`_get_owned_session_for_update` 一致）。
        """
        from app.modules.daemon.model import DaemonRuntime

        stmt = (
            select(AgentSession)
            .join(DaemonRuntime, AgentSession.runtime_id == DaemonRuntime.id)
            .where(
                AgentSession.id == session_id,
                DaemonRuntime.user_id == owner_user_id,
            )
            .with_for_update()
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def _get_current_run(
        self,
        session_id: uuid.UUID,
    ) -> AgentRun | None:
        """Return the single active-turn run for the session, or None.

        Active turn = status in ACTIVE_TURN_STATUSES (pending / running /
        pending_approval). AgentRun has no created_at, so we must rely on the
        invariant "at most one active run per session". Zero → None, one →
        that run, more than one → DaemonSessionInvariantViolation (never
        guess which one to terminate).
        """
        stmt = select(AgentRun).where(
            AgentRun.agent_session_id == session_id,
            col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        if not runs:
            return None
        if len(runs) > 1:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has multiple active runs.",
                details={
                    "session_id": str(session_id),
                    "active_run_ids": [str(r.id) for r in runs],
                },
            )
        return runs[0]

    async def _publish_session_event(
        self,
        session_id: uuid.UUID,
        payload: dict[str, object],
    ) -> None:
        """Publish an event on the ``agent_session:{session_id}`` Redis channel.

        Shared entry point for task-06 (SSE aggregation) and task-08
        (permission events). Failures are logged but never raised so a Redis
        blip cannot abort end/interrupt. Does NOT implement the SSE route,
        history replay, or cursor — those belong to task-06.
        """
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_session:{session_id}",
                json.dumps(payload, default=str),
            )
        except Exception:
            log.warning(
                "publish_session_event_failed",
                session_id=str(session_id),
                redis_event=payload.get("event") if isinstance(payload, dict) else None,
            )

    async def _resolve_runtime_labels(
        self,
        runtime_id: uuid.UUID,
    ) -> tuple[str | None, str | None]:
        """task-03（Grill C-12）：config_snapshot 的机器名/智能体名解析。

        * ``machine_name``：runtime → DaemonInstance.display_alias（admin 别名，
          优先）→ hostname；无 daemon_instance（迁移期）→ None。
        * ``agent_name``：runtime.name → 回退 provider（claude/codex）。
        """
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            return None, None
        agent_name = runtime.name or runtime.provider
        machine_name: str | None = None
        if runtime.daemon_instance_id is not None:
            instance = await self._session.get(DaemonInstance, runtime.daemon_instance_id)
            if instance is not None:
                machine_name = instance.display_alias or instance.hostname
        return machine_name, agent_name

    async def create_session(
        self,
        user_id: uuid.UUID,
        *,
        provider: str | None,
        prompt: str,
        model: str | None = None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
        change_id: uuid.UUID | None = None,
        workspace_id: uuid.UUID | None = None,
        # 2026-08-14-sessions-portal task-02：新页面双入口 + 会话配置字段透传占位。
        # task-03 落地解析：runtime_id（优先于 provider，钉定机器+智能体并派生
        # provider）/ agent_profile_id（只注 system_prompt+mcp/skill，D-013）/
        # llm_provider_id（写 lease metadata session_llm_provider_id）。
        runtime_id: str | None = None,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
    ) -> SessionDispatchResult:
        """Create an interactive session + first-turn run + interactive lease.

        FR-01 / design §7.6 step 1. The session, run and lease are committed
        atomically (D-005@v1 triple), then the daemon is woken. If the wake-up
        cannot be delivered the triple is converged to failed terminal states
        and DaemonRuntimeOffline is raised so no active session lingers.

        task-03 双入口：``runtime_id``（/sessions 新页面，Grill C-01 钉定）与
        ``provider``（/runtimes 弹窗旧路径，零回归）二选一，前者优先。
        """
        if not prompt or not prompt.strip():
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )

        # ── task-03：runtime_id 入口解析（钉定 + 派生 provider，Grill C-01/P0）──
        # 校验在事务开始前完成：不可满足直接 4xx，无半成品落库；placement 侧
        # pinned 路径二次复查（竞态防线），失联同样转 4xx，绝不静默换机。
        pinned_runtime_id: uuid.UUID | None = None
        if runtime_id:
            try:
                pinned_runtime_id = uuid.UUID(runtime_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionRuntimeNotFound(
                    f"Invalid runtime_id '{runtime_id}'.",
                    details={"runtime_id": runtime_id},
                ) from exc
            _rt = await self._session.get(DaemonRuntime, pinned_runtime_id)
            if _rt is None or _rt.user_id != user_id:
                raise DaemonSessionRuntimeNotFound(
                    f"Runtime '{runtime_id}' not found.",
                    details={"runtime_id": runtime_id},
                )
            if _rt.status != "online":
                raise DaemonSessionRuntimeUnavailable(
                    f"Runtime '{runtime_id}' is offline.",
                    details={"runtime_id": runtime_id, "status": _rt.status},
                )
            if not _rt.provider:
                raise DaemonSessionRuntimeUnavailable(
                    f"Runtime '{runtime_id}' has no provider.",
                    details={"runtime_id": runtime_id},
                )
            # 派生 provider（design §5：runtime_id 优先，覆盖入参 provider）。
            provider = _rt.provider
        elif not provider:
            raise DaemonSessionNotActive(
                "either runtime_id or provider must be provided.",
                details={"reason": "missing_provider"},
            )

        # ── task-03：档案解析（D-013：只消费提示词维度，不做引擎过滤）──
        # 复用 AgentProfileService.get 的读可见性校验（与 GET /agent-profiles
        # ?scope=mine 列表同口径）：不存在 → 404；不可见 → 403。不兜底、不软回退
        # （用户显式选择，契约字段缺失/失效必须显式报错）。
        profile = None
        if agent_profile_id:
            from app.modules.agent.profile.service import AgentProfileService
            from app.modules.auth.model import User as _User

            try:
                _profile_uuid = uuid.UUID(agent_profile_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionConfigInvalid(
                    f"Invalid agent_profile_id '{agent_profile_id}'.",
                    details={"agent_profile_id": agent_profile_id},
                ) from exc
            _actor = await self._session.get(_User, user_id)
            if _actor is None:
                raise DaemonSessionConfigInvalid(
                    "Session owner user not found.",
                    details={"user_id": str(user_id)},
                )
            profile = await AgentProfileService(self._session).get(
                profile_id=_profile_uuid, actor=_actor
            )

        # ── task-03：会话级供应商解析（归属 + agent_kind 匹配，FR-04/FR-06）──
        llm_provider_row = None
        if llm_provider_id:
            from app.modules.llm_provider.model import LlmProvider

            try:
                _provider_uuid = uuid.UUID(llm_provider_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionConfigInvalid(
                    f"Invalid llm_provider_id '{llm_provider_id}'.",
                    details={"llm_provider_id": llm_provider_id},
                ) from exc
            llm_provider_row = await self._session.get(LlmProvider, _provider_uuid)
            if llm_provider_row is None or llm_provider_row.user_id != user_id:
                raise DaemonSessionLlmProviderNotFound(
                    f"LlmProvider '{llm_provider_id}' not found.",
                    details={"llm_provider_id": llm_provider_id},
                )
            # agent_kind 与引擎（runtime 派生 provider，如 claude/codex）不匹配 →
            # 422（FR-06），不静默降级。
            if llm_provider_row.agent_kind != provider:
                raise DaemonSessionLlmProviderKindMismatch(
                    "LlmProvider agent_kind does not match the session engine.",
                    details={
                        "llm_provider_id": llm_provider_id,
                        "agent_kind": llm_provider_row.agent_kind,
                        "engine": provider,
                    },
                )

        # 2026-07-09-change-detail-session / D-003@v1：变更会话 cwd=workspace 本地
        # 项目根。复用 Workspace.root_path（workspace/model.py:63），未传 workspace_id
        # 时 cwd=None 走原逻辑（边界 E4，零回归）。
        cwd: str | None = None
        if workspace_id is not None:
            # D-001@v1：workspace 归属校验，口径与前端 listWorkspaces 一致。
            # 无权限与工作区不存在同语义（404），不泄露存在性。
            # 平台管理员旁路权限判定（口径对齐 rbac.allowed_workspace_ids docstring
            # 「Platform admin bypasses at the dependency layer」），但仍要求工作区
            # 真实存在（保持 404 语义）。2026-08-20 审计顺手修：管理员建会话 404。
            from app.modules.auth.model import User as _User

            _actor = await self._session.get(_User, user_id)
            _is_admin = bool(_actor and _actor.is_platform_admin)
            _allowed = (
                []
                if _is_admin
                else await allowed_workspace_ids(
                    self._session, user_id=user_id, permission=Permission.WORKSPACE_READ
                )
            )
            if not _is_admin and workspace_id not in _allowed:
                raise DaemonSessionWorkspaceNotFound(
                    f"Workspace '{workspace_id}' not found or you have no access.",
                    details={"workspace_id": str(workspace_id)},
                )
            from app.modules.workspace.model import Workspace as _Workspace

            if _is_admin and await self._session.get(_Workspace, workspace_id) is None:
                raise DaemonSessionWorkspaceNotFound(
                    f"Workspace '{workspace_id}' not found or you have no access.",
                    details={"workspace_id": str(workspace_id)},
                )
            from app.modules.workspace.model import Workspace

            _ws = await self._session.get(Workspace, workspace_id)
            if _ws is not None:
                cwd = _ws.root_path

        now = datetime.now(UTC)
        # Copy config so the request dict is never mutated (boundary #16).
        config: dict = {
            "manual_approval": bool(manual_approval),
        }
        if model:
            config["model"] = model

        try:
            session = AgentSession(
                id=uuid.uuid4(),
                user_id=user_id,
                provider=provider,
                status="pending",
                config=config,
                turn_count=0,
                created_at=now,
                change_id=change_id,
                workspace_id=workspace_id,
                cwd=cwd,
                # task-03（FR-04/D-008）：会话配置三列（未选 = None = 现状，零回归）。
                agent_profile_id=profile.id if profile is not None else None,
                llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
            )
            self._session.add(session)
            await self._session.flush()

            # task-03：首 run 带档案/供应商轮次快照（D-008）。
            from app.modules.agent.service import _build_agent_profile_snapshot

            run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=provider,
                model=model,
                status="pending",
                spec_strategy="interactive",
                agent_session_id=session.id,
                change_id=change_id,
                # ql-20260817-003：首轮发送者=会话创建者。
                user_id=user_id,
                agent_profile_id=profile.id if profile is not None else None,
                agent_profile_snapshot=(
                    _build_agent_profile_snapshot(profile) if profile is not None else None
                ),
                llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
            )
            self._session.add(run)
            await self._session.flush()

            # 2026-07-09-change-detail-session / D-004@v1（X-02/X-04）：变更会话首轮
            # 注入【变更上下文】前导。dispatch prompt = 前导+用户消息，经 lease
            # metadata 的 prompt 字段透传到 daemon _startInteractiveSession 构造
            # 首条 user 消息。AgentRunLog(user_input) 与 SESSION_INJECT 的 prompt
            # 仍写干净用户消息（列表标题 / 回放 / 展示干净）。零 daemon 改动。
            from app.modules.daemon.session.context import (
                build_change_context_preamble,
            )

            preamble = await build_change_context_preamble(self._session, change_id)
            dispatch_prompt = f"{preamble}\n\n---\n\n{prompt}" if preamble else prompt

            placement = RunPlacementService(self._session)
            try:
                dispatch = await placement.prepare_interactive_dispatch(
                    agent_session_id=session.id,
                    agent_run_id=run.id,
                    user_id=user_id,
                    provider=provider,
                    prompt=dispatch_prompt,
                    model=model,
                    manual_approval=manual_approval,
                    ask_user_only=ask_user_only,
                    workspace_id=workspace_id,
                    cwd=cwd,
                    pinned_runtime_id=pinned_runtime_id,
                )
            except NoOnlineDaemonError as exc:
                # task-03 / Grill C-01（P0）：钉定路径的竞态防线失联（校验后、
                # placement 复查前 runtime 掉线）→ 转 4xx 明确报错，不静默换机。
                # 旧 provider 路径保持原 NoOnlineDaemonError 透传（零回归）。
                if pinned_runtime_id is not None:
                    raise DaemonSessionRuntimeUnavailable(
                        f"Runtime '{pinned_runtime_id}' is offline.",
                        details={"runtime_id": str(pinned_runtime_id)},
                    ) from exc
                raise

            # ── task-03：会话档案注入（D-013，非 commit 变体，同事务）──
            # 只写 system_prompt + mcp_refs/skill_refs；不写 bound
            # llm_provider_id / effective_allowed_roots（Grill C-06）。
            if profile is not None:
                from app.modules.agent.service import AgentService

                await AgentService(self._session).apply_session_profile_to_lease(
                    dispatch.lease_id, profile
                )
            # task-03 / FR-04 / R-02：会话级供应商写独立 metadata key（claim 端
            # _inject_provider_config 最高优先级分支消费）；压制档案绑定，未选
            # 不写 = 现状链（零回归）。
            if llm_provider_row is not None:
                await _merge_lease_metadata(
                    self._session,
                    dispatch.lease_id,
                    {"session_llm_provider_id": str(llm_provider_row.id)},
                )

            # Backfill the triple binding fields + activate the session.
            session.runtime_id = dispatch.runtime_id
            session.lease_id = dispatch.lease_id
            session.status = "active"
            session.turn_count = 1
            session.last_active_at = now
            # task-03 / Grill C-12：config_snapshot（含 machine_name/agent_name，
            # 列表 chips 直显免二次查询）。任一新入口字段选中才写；全不选 =
            # NULL = 现状（零回归）。machine/agent 名取实际定位的 runtime。
            if pinned_runtime_id is not None or profile is not None or llm_provider_row is not None:
                machine_name, agent_name = await self._resolve_runtime_labels(dispatch.runtime_id)
                session.config_snapshot = {
                    "profile_name": profile.name if profile is not None else None,
                    "provider_name": (
                        llm_provider_row.name if llm_provider_row is not None else None
                    ),
                    "model": (
                        (llm_provider_row.model or llm_provider_row.default_fallback_model)
                        if llm_provider_row is not None
                        else None
                    ),
                    "engine": provider,
                    "machine_name": machine_name,
                    "agent_name": agent_name,
                }
            self._session.add(session)

            # task-01 / FR-01 / D-005@v1：首 turn 落一条 channel="user_input" 的
            # AgentRunLog，让历史回看能看到用户发的首 prompt（与 agent 输出
            # stdout/stderr/tool_call 并列）。prompt 经 content_redacted 脱敏
            # （与 submit_messages 一致的 ``[:5000]`` 截断），user_input channel
            # 显式写、不经 _channel_from_event_type（与 agent service 的
            # USER_INPUT_CHANNEL 标准保持一致）。
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=prompt[:5000],
                    timestamp=now,
                )
            )
            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except Exception:
            await self._session.rollback()
            raise

        # Commit succeeded → wake the daemon. Failure here must converge the
        # just-committed triple to terminal failed states before raising.
        placement = RunPlacementService(self._session)
        delivered = await placement.notify_interactive_dispatch(dispatch)
        if not delivered:
            await self._converge_failed_dispatch(
                session=session,
                run=run,
                lease_id=dispatch.lease_id,
                error="interactive dispatch wake-up failed (daemon offline)",
            )
            raise DaemonRuntimeOffline(
                "执行代理当前不在线，会话无法启动。请确认本机 daemon 进程已运行"
                "（任务栏/终端 sillyhub-daemon），重启后重试；若刚重启请等几秒再试。",
                details={
                    "runtime_id": str(dispatch.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        # Best-effort SESSION_INJECT control message carrying the first turn.
        # Wake-up already signalled the lease; the control message lets the
        # daemon SessionManager know the exact first prompt (FR-02 contract).
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        # task-06: WS Hub routes by daemon_instance_id; resolve from the
        # provider runtime_id carried on the dispatch.
        daemon_id = await _resolve_daemon_id_for_runtime(self._session, dispatch.runtime_id)
        # 等 daemon session ready（create 完成）再发首 prompt SESSION_INJECT，避免在
        # daemon _startInteractiveSession 完成前到被 _routeSessionControl session_not_found
        # 丢（/model 空白根因）。同 inject_session（task-08）逻辑；超时 fallback 仍发
        # （兼容不上报 ready 的旧 daemon）。
        ready = await get_session_readiness().wait(session.id, timeout=8)
        if not ready:
            log.warning("session_ready_timeout", session_id=str(session.id))
        control_ok = False
        if daemon_id is not None:
            control_ok = await hub.send_session_control(
                daemon_id,
                DAEMON_MSG_SESSION_INJECT,
                {
                    "session_id": str(session.id),
                    "lease_id": str(dispatch.lease_id),
                    "run_id": str(run.id),
                    "prompt": prompt,
                    # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token，
                    # daemon 存入 SessionState.claimToken。
                    "claim_token": dispatch.claim_token,
                    # design §5.3: payload carries the provider runtime_id so
                    # the daemon dispatches to the correct SessionManager.
                    "runtime_id": str(dispatch.runtime_id),
                },
            )
        if not control_ok:
            # Wake-up delivered but control send failed: the daemon will still
            # claim the lease (metadata has the prompt), so we do NOT fail the
            # session here. Log for observability; FR-01 success already holds.
            log.warning(
                "session_create_control_send_failed",
                session_id=str(session.id),
                run_id=str(run.id),
                runtime_id=str(dispatch.runtime_id),
            )

        await self._publish_session_event(
            session.id,
            {"event": "session_created", "session_id": str(session.id), "run_id": str(run.id)},
        )
        return SessionDispatchResult(
            agent_session=session,
            agent_run=run,
            lease_id=dispatch.lease_id,
        )

    async def _converge_failed_dispatch(
        self,
        *,
        session: AgentSession,
        run: AgentRun,
        lease_id: uuid.UUID,
        error: str,
    ) -> None:
        """Mark a freshly-committed triple as failed terminal (create_session offline path)."""
        now = datetime.now(UTC)
        try:
            run.status = "failed"
            run.finished_at = now
            run.error_code = "interactive_dispatch_offline"
            run.output_redacted = error
            self._session.add(run)

            session.status = "failed"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            lease = await self._session.get(DaemonTaskLease, lease_id)
            if lease is not None and lease.status not in ("completed", "cancelled", "expired"):
                lease.status = "completed"
                lease.updated_at = now
                self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)

            # task-09 / FR-04：failed 终态清理 ready 状态（commit 后事务外，
            # best-effort；内层 try 隔离 clear 异常，不影响外层 commit/refresh
            # 错误收敛分支）。session 无 session_id 形参，用 session.id。
            try:
                get_session_readiness().clear(session.id)
            except Exception:
                log.warning(
                    "session_ready_clear_failed",
                    session_id=str(session.id),
                )
        except Exception:
            await self._session.rollback()
            log.warning(
                "session_failed_dispatch_convergence_failed",
                session_id=str(session.id),
                run_id=str(run.id),
                lease_id=str(lease_id),
            )

    async def inject_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        prompt: str,
        # 2026-08-14-sessions-portal task-02：切档案/切供应商字段透传占位（校验与
        # SESSION_SWITCH_CONFIG 下发归 task-05；默认 None 不改既有行为）。
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用（D-7 豁免
        # 空 prompt；引擎/归属/数量校验见 _inject_into_session；组装下发归 task-06）。
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> SessionDispatchResult:
        """Append a new turn run to an active session (FR-02 / design §7.6 step 1).

        Holds the session row lock, rejects when an active run already exists
        (DaemonSessionTurnConflict), creates the new AgentRun, commits, then
        dispatches a SESSION_INJECT control message. WS send failure converges
        the new run to failed but keeps the session active (boundary #13).

        Ownership: enforced via ``_get_owned_session_for_update`` (``user_id``
        must own the session). For the platform service path that must bypass
        this user-ownership check (multi-member workspace approver ≠ session
        creator), see :meth:`inject_session_as_service` (D-006@v2,
        2026-08-14-change-center-conversation-driven task-04).

        sessions-portal task-05（FR-05/FR-06 / D-012@v1）：``agent_profile_id`` /
        ``llm_provider_id`` 与会话当前值不同 → 切换分支（校验+快照+SESSION_SWITCH_CONFIG
        语义见 :meth:`_inject_into_session` docstring；``llm_provider_id`` 空串 =
        "none" → 清空回本机默认）。都 None → 原有 inject 行为零回归；send 失败
        按既有收敛（Grill C-11）。
        """
        # ql-20260817-010：静默切换——携带切换字段时允许空 prompt（切换轮无用户
        # 消息/模型回应，daemon 只 reload 配置）；纯追问仍要求非空（DTO 已 422，
        # 服务层兜底防绕过）。
        # 2026-08-20 task-05（D-7）：附件非空也豁免空 prompt（看图说话）。
        if not prompt or not prompt.strip():
            if (
                agent_profile_id is None
                and llm_provider_id is None
                and not attachment_ids
            ):
                raise DaemonSessionNotActive(
                    "prompt must not be empty.",
                    details={"reason": "empty_prompt"},
                )
            prompt = ""

        try:
            session = await self._get_owned_session_for_update(session_id, user_id)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise
        return await self._inject_into_session(
            session,
            prompt=prompt,
            # ql-20260817-003：轮次发送者=实际注入者。
            run_sender_user_id=user_id,
            # sessions-portal task-05：切换参数透传共享核心（service 路径不传=零回归）。
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            # 2026-08-20 task-05：附件透传（None → 空列表零回归）。
            attachment_ids=list(attachment_ids) if attachment_ids else None,
        )

    async def inject_session_as_service(
        self,
        session_id: uuid.UUID,
        *,
        prompt: str,
    ) -> SessionDispatchResult:
        """Append a turn run to an active session as the **platform service** (D-006@v2).

        Service-identity sibling of :meth:`inject_session`: skips the user
        ownership check (``_get_owned_session_for_update`` — a multi-member
        workspace approver may NOT be the session creator, design §5 P2 /
        Grill F-2) and locks the session by id only. Used by the change
        approval flow to push review results into the bound session
        (2026-08-14-change-center-conversation-driven task-04).

        All other semantics are identical to :meth:`inject_session` (status /
        lease / turn-conflict guards, SESSION_INJECT dispatch, offline
        convergence, best-effort readiness wait). The caller is responsible
        for the change-side best-effort degradation mapping (turn_conflict /
        session_inactive / inject_failed, R-03).
        """
        if not prompt or not prompt.strip():
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        try:
            stmt = select(AgentSession).where(AgentSession.id == session_id).with_for_update()
            session = (await self._session.execute(stmt)).scalar_one_or_none()
            if session is None:
                raise DaemonSessionNotFound(
                    f"AgentSession '{session_id}' not found.",
                    details={"session_id": str(session_id)},
                )
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise
        return await self._inject_into_session(
            session,
            prompt=prompt,
            # ql-20260817-003：service 身份代写轮——发送者记会话属主。
            run_sender_user_id=session.user_id,
        )

    async def _inject_into_session(
        self,
        session: AgentSession,
        *,
        prompt: str,
        # ql-20260817-003：轮次发送者（run.user_id）——inject_session 传实际注入
        # 的 user_id，inject_session_as_service（平台审批代写）传会话属主。
        run_sender_user_id: uuid.UUID | None = None,
        # sessions-portal task-05：切档案/切供应商（None=不动；llm_provider_id
        # 空串="none" 清空回本机默认）。service 身份路径（inject_session_as_service）
        # 不传 → 走原有 inject 行为（零回归）。
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用（None → 零
        # 回归）。校验（引擎门控/归属/数量）在本方法事务内；组装下发归 task-06。
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> SessionDispatchResult:
        """Shared inject-turn core (used by :meth:`inject_session` +
        :meth:`inject_session_as_service`).

        Caller MUST already hold the session row lock (FOR UPDATE) and is
        responsible for ownership semantics — this method only implements the
        status/lease/turn-conflict guards, the new AgentRun creation, the
        SESSION_INJECT dispatch and the offline convergence. Extracted so the
        user-owned and service-identity paths share one turn-injection body
        (D-006@v2, 2026-08-14-change-center-conversation-driven task-04).

        sessions-portal task-05（FR-05/FR-06 / D-012@v1）：``agent_profile_id`` /
        ``llm_provider_id`` 与会话当前值不同 → 切换分支（同事务新 AgentRun 快照 +
        会话三列刷新 + lease metadata 同步 + SESSION_SWITCH_CONFIG 原子下发）；
        空串 = "none" → 清空会话供应商回本机默认（写 NULL）；都 None / 等值 →
        原有行为逐字段不变（零回归）。
        """
        session_id = session.id
        now = datetime.now(UTC)
        try:
            if session.status != "active":
                raise DaemonSessionNotActive(
                    f"AgentSession '{session_id}' is not active (status={session.status}).",
                    details={"session_id": str(session_id), "status": session.status},
                )
            if session.lease_id is None or session.runtime_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Active session '{session_id}' has no lease/runtime binding.",
                    details={"session_id": str(session_id)},
                )

            current = await self._get_current_run(session.id)
            if current is not None:
                raise DaemonSessionTurnConflict(
                    f"Session '{session_id}' already has an active run '{current.id}'.",
                    details={
                        "session_id": str(session_id),
                        "current_run_id": str(current.id),
                    },
                )

            # ── 2026-08-20 task-05：附件校验（D-6 引擎门控 / 归属 404 / 数量 422）──
            # 组装（base64 内联/降级路由/标记行/回填）见下方 task-06 段；
            # 本段只做整体拒绝（不部分生效）：任一校验失败 raise → 事务回滚。
            validated_attachments: list = []
            if attachment_ids:
                if session.provider != "claude":
                    raise DaemonSessionAttachmentsUnsupported(
                        "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
                        details={"session_id": str(session_id), "provider": session.provider},
                    )
                from app.modules.session_attachment.model import SessionAttachment

                rows = (
                    (
                        await self._session.execute(
                            select(SessionAttachment).where(
                                SessionAttachment.id.in_(attachment_ids),
                                SessionAttachment.user_id == session.user_id,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                # 缺失/跨用户归一 404（资源隐藏语义，不泄露存在性）。
                if len(rows) != len(set(attachment_ids)):
                    raise DaemonSessionNotFound(
                        "部分附件不存在或无权访问。",
                        details={"session_id": str(session_id)},
                    )
                image_n = sum(1 for r in rows if r.kind == "image")
                file_n = sum(1 for r in rows if r.kind == "file")
                if image_n > 5 or file_n > 5 or (image_n + file_n) != len(rows):
                    raise DaemonSessionAttachmentInvalid(
                        "附件数量超限（图片≤5、文件≤5）或类型非法。",
                        details={"image_count": image_n, "file_count": file_n},
                    )
                # 保留入参顺序（payload/标记行按用户勾选顺序稳定）。
                by_id = {r.id: r for r in rows}
                validated_attachments = [
                    by_id[i] for i in dict.fromkeys(attachment_ids) if i in by_id
                ]

            # ── task-05：配置切换解析（FR-05/FR-06 / Grill C-05 / D-013）────────
            # 维度语义：入参 None=不动；profile 非空且≠当前 → 切；provider 非空且
            # ≠当前 → 切，空串（"none"）→ 清空回本机默认；与当前值相同 → 等价不动
            # （落回原有 inject 路径，零回归）。校验失败在事务内 raise → rollback，
            # 会话状态与列不变（R-03）。
            profile_changed = False
            switch_profile = None
            if agent_profile_id == "":
                # ql-20260818-004：空串 = "none" → 取消档案（写 NULL 回无人格），
                # 与 llm_provider_id 空串语义对称。已 NULL 时等价不动。
                if session.agent_profile_id is not None:
                    profile_changed = True
            elif agent_profile_id:
                try:
                    _new_profile_uuid = uuid.UUID(agent_profile_id)
                except (ValueError, AttributeError, TypeError) as exc:
                    raise DaemonSessionConfigInvalid(
                        f"Invalid agent_profile_id '{agent_profile_id}'.",
                        details={"agent_profile_id": agent_profile_id},
                    ) from exc
                if _new_profile_uuid != session.agent_profile_id:
                    from app.modules.agent.profile.service import AgentProfileService
                    from app.modules.auth.model import User as _User

                    _actor = await self._session.get(_User, session.user_id)
                    if _actor is None:
                        raise DaemonSessionConfigInvalid(
                            "Session owner user not found.",
                            details={"user_id": str(session.user_id)},
                        )
                    # 读可见性与 GET /agent-profiles?scope=mine 同口径（同 create）。
                    switch_profile = await AgentProfileService(self._session).get(
                        profile_id=_new_profile_uuid, actor=_actor
                    )
                    profile_changed = True

            provider_changed = False
            provider_row = None
            new_llm_provider_id = session.llm_provider_id
            if llm_provider_id is not None:
                if llm_provider_id == "":
                    # 空串 = "none" → 清空会话供应商（写 NULL 回本机默认）。已 NULL
                    # 时等价不动（不触发切换分支）。
                    if session.llm_provider_id is not None:
                        provider_changed = True
                        new_llm_provider_id = None
                else:
                    try:
                        _new_provider_uuid = uuid.UUID(llm_provider_id)
                    except (ValueError, AttributeError, TypeError) as exc:
                        raise DaemonSessionConfigInvalid(
                            f"Invalid llm_provider_id '{llm_provider_id}'.",
                            details={"llm_provider_id": llm_provider_id},
                        ) from exc
                    if _new_provider_uuid != session.llm_provider_id:
                        from app.modules.llm_provider.model import LlmProvider

                        provider_row = await self._session.get(LlmProvider, _new_provider_uuid)
                        # 归属按 AgentSession.user_id（Grill C-05：借用 runtime 场景
                        # borrower 供应商不被静默拒绝），404 不泄露存在性。
                        if provider_row is None or provider_row.user_id != session.user_id:
                            raise DaemonSessionLlmProviderNotFound(
                                f"LlmProvider '{llm_provider_id}' not found.",
                                details={"llm_provider_id": llm_provider_id},
                            )
                        # FR-06：agent_kind 与会话引擎不匹配 → 422，不静默降级。
                        if provider_row.agent_kind != session.provider:
                            raise DaemonSessionLlmProviderKindMismatch(
                                "LlmProvider agent_kind does not match the session engine.",
                                details={
                                    "llm_provider_id": llm_provider_id,
                                    "agent_kind": provider_row.agent_kind,
                                    "engine": session.provider,
                                },
                            )
                        provider_changed = True
                        new_llm_provider_id = provider_row.id

            config_switch = profile_changed or provider_changed

            # ql-20260818-002：切换字段与当前值**等值**（不构成切换）+ 空 prompt →
            # 拒绝——否则落普通 inject 路径发空 prompt SESSION_INJECT（daemon 拒收
            # 消息），run 永久卡 pending 堵死会话（TURN_CONFLICT）。
            if not config_switch and not prompt.strip():
                raise DaemonSessionNotActive(
                    "prompt must not be empty.",
                    details={"reason": "empty_prompt"},
                )

            # ql-20260818-009：取消档案（profile_changed=True 且 switch_profile=None）
            # 时对话历史里有深度角色扮演轮，仅靠 system prompt 中和压不住惯性。
            # 以简短用户消息形式显式告知「角色已取消」最有效——用户指令优先级最高，
            # 能可靠中止扮演。注意：仅在 profile_changed（档案主动变动）时触发，
            # 供应商单独切换 profile_changed=False 不会误触发。
            if profile_changed and switch_profile is None and not prompt.strip():
                prompt = "智能体档案已取消，无需继续扮演该角色。"

            # 解析本轮生效（effective）档案/供应商行：切换轮用新值、未切维度与
            # 普通轮（不切换）沿用会话当前值——D-008 每轮 run 都要带配置快照
            # （ql-20260815-010 修正：此前仅切换分支落快照，普通轮 run 的
            # agent_profile_id/llm_provider_id 为 NULL → 前端 whoLine 误显
            # 「未指定/本机默认」）。按 id 取行（create 时已过校验，不重查）。
            effective_profile = switch_profile
            effective_provider = provider_row
            if not profile_changed and session.agent_profile_id is not None:
                from app.modules.agent.profile.model import AgentProfile as _AgentProfile

                effective_profile = await self._session.get(_AgentProfile, session.agent_profile_id)
            if not provider_changed and session.llm_provider_id is not None:
                from app.modules.llm_provider.model import LlmProvider

                effective_provider = await self._session.get(LlmProvider, session.llm_provider_id)

            config = dict(session.config or {})
            run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=session.provider,
                model=config.get("model"),
                status="pending",
                spec_strategy="interactive",
                agent_session_id=session.id,
                # ql-20260817-003：轮次发送者=本轮注入者（_inject_into_session 的
                # 调用方注入：inject_session=实际 user；service 路径=会话属主）。
                user_id=run_sender_user_id,
            )
            # task-05 / D-008（ql-20260815-010 修正为每轮落快照）：新 run 带本轮
            # 生效配置——切换轮=新值；普通轮=会话当前值（沿用），无配置=NULL 如实。
            from app.modules.agent.service import _build_agent_profile_snapshot

            run.agent_profile_id = effective_profile.id if effective_profile is not None else None
            run.agent_profile_snapshot = (
                _build_agent_profile_snapshot(effective_profile)
                if effective_profile is not None
                else None
            )
            run.llm_provider_id = new_llm_provider_id if config_switch else session.llm_provider_id
            self._session.add(run)

            session.turn_count = (session.turn_count or 0) + 1
            session.last_active_at = now
            if config_switch:
                # task-05 / FR-04：会话三列刷新（快照含 machine_name/agent_name，
                # 与 create_session 的 Grill C-12 口径一致）。
                session.agent_profile_id = (
                    effective_profile.id if effective_profile is not None else None
                )
                session.llm_provider_id = new_llm_provider_id
                machine_name, agent_name = await self._resolve_runtime_labels(session.runtime_id)
                session.config_snapshot = {
                    "profile_name": (
                        effective_profile.name if effective_profile is not None else None
                    ),
                    "provider_name": (
                        effective_provider.name if effective_provider is not None else None
                    ),
                    "model": (
                        (effective_provider.model or effective_provider.default_fallback_model)
                        if effective_provider is not None
                        else None
                    ),
                    "engine": session.provider,
                    "machine_name": machine_name,
                    "agent_name": agent_name,
                }
            self._session.add(session)

            # task-01 / FR-02 / D-005@v1：后续 turn 同样落一条 channel="user_input"
            # AgentRunLog，挂在新建 run 上（首 turn 在 create_session 已落）。
            # 2026-08-20 task-06（D-3）：附件标记行插头部——[附件:id|kind|name]
            # 逐附件一行，换行后接原 prompt；kind 取 DB 原始值（前端回显缩略图
            # 数据源）；沿用既有 5000 截断口径。
            user_input_content = prompt
            if validated_attachments:
                from app.modules.session_attachment.service import (
                    attachment_marker_line,
                )

                marker_lines = "\n".join(
                    attachment_marker_line(r) for r in validated_attachments
                )
                user_input_content = f"{marker_lines}\n{prompt}" if prompt else marker_lines
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=user_input_content[:5000],
                    timestamp=now,
                )
            )

            # ── 2026-08-20 task-06：附件组装与回填（D-4/D-9/draft→bound）────────
            # 校验已过（上方 task-05 段）：本段在**同事务**内完成——①session_id
            # 回填（draft→bound 唯一前进迁移；已 bound 附件再次引用不改状态）；
            # ②多模态门控判定（D-9）+ payload 组装（D-4 闸门/降级路由）。
            # 组装读对象（MinIO）为 IO 较重，但附件总量受 5MB×5/20MB×5 上限约束。
            inject_attachments: list[dict] = []
            if validated_attachments:
                from app.modules.session_attachment.capability import (
                    resolve_session_gate,
                )
                from app.modules.session_attachment.service import (
                    assemble_inject_attachments,
                )
                from app.modules.session_attachment.storage import (
                    SessionAttachmentStorage,
                )
                from app.modules.storage.factory import get_storage_backend

                for att_row in validated_attachments:
                    if att_row.session_id is None:
                        att_row.session_id = session.id
                        self._session.add(att_row)

                gate = await resolve_session_gate(
                    self._session,
                    user_id=session.user_id,
                    session_llm_provider_id=session.llm_provider_id,
                    agent_kind=session.provider,
                )
                inject_attachments = await assemble_inject_attachments(
                    validated_attachments,
                    supports_multimodal=gate.supports_multimodal,
                    storage=SessionAttachmentStorage(get_storage_backend()),
                )

            if config_switch:
                # task-05：lease metadata 同步（同事务，保持 DB 与会话列一致——
                # claim payload / 恢复链路重读 metadata 时不落到旧配置）。
                # 供应商：写 session_llm_provider_id 或清空删键；档案：写提示词
                # 维度三键（同 apply_session_profile_to_lease 口径，D-013）。
                meta_updates: dict = {}
                meta_removals: list[str] = []
                if profile_changed:
                    # ql-20260818-004：取消档案（switch_profile=None）→ 提示词维度
                    # 三键全删（回无人格）；切换 → 写新值。
                    if switch_profile is None:
                        meta_removals.extend(["system_prompt", "mcp_refs", "skill_refs"])
                    else:
                        if switch_profile.system_prompt:
                            meta_updates["system_prompt"] = switch_profile.system_prompt
                        else:
                            meta_removals.append("system_prompt")
                        meta_updates["mcp_refs"] = list(switch_profile.mcp_refs or [])
                        meta_updates["skill_refs"] = list(switch_profile.skill_refs or [])
                if provider_changed:
                    if new_llm_provider_id is not None:
                        meta_updates["session_llm_provider_id"] = str(new_llm_provider_id)
                    else:
                        meta_removals.append("session_llm_provider_id")
                await _merge_lease_metadata(
                    self._session,
                    session.lease_id,
                    meta_updates,
                    removals=meta_removals,
                )

                # providerConfig 在 commit 前构造（解密失败 → 整个切换事务回滚，
                # 不会出现 DB 已切、消息发不出的半态）。复用 lease/context 的
                # resolve_bound_provider_config（按会话 user_id + 引擎，与 claim
                # payload 的 provider_config 结构逐字一致，D-006 单一真相源）。
                # ql-20260817-008：构造条件用 effective_provider（含未切维度的
                # 当前行）而非 provider_row（仅切供应商时非空）——切档案轮若
                # 不带 providerConfig，daemon reload 重建 driver 时供应商 env
                # 缺失，会回落机器默认网关（实测 Kimi 会话切档案后流量跑到
                # GLM）。会话供应商 NULL（本机默认）才发 null。
                if effective_provider is not None:
                    from app.modules.daemon.lease.context import (
                        resolve_bound_provider_config,
                    )

                    provider_config_payload = await resolve_bound_provider_config(
                        self._session,
                        {"llm_provider_id": str(effective_provider.id)},
                        session.user_id,
                        session.provider,
                    )
                    if provider_config_payload is None:
                        # 上方已校验归属 + agent_kind，此处 None = 契约破裂（如
                        # 解析器口径漂移），显式报错不静默降级（铁律 1）。
                        raise DaemonSessionConfigInvalid(
                            "Session provider config could not be resolved.",
                            details={"llm_provider_id": str(effective_provider.id)},
                        )
                else:
                    provider_config_payload = None
                profile_payload = None
                if profile_changed:
                    # ql-20260818-004：取消档案 → 空载荷（systemPrompt 空串=daemon 侧
                    # 归一为 null 哨兵「切到无人格」，mcp/skill 清空）。
                    profile_payload = {
                        "systemPrompt": switch_profile.system_prompt or ""
                        if switch_profile is not None
                        else "",
                        "mcpRefs": list(switch_profile.mcp_refs or [])
                        if switch_profile is not None
                        else [],
                        "skillRefs": list(switch_profile.skill_refs or [])
                        if switch_profile is not None
                        else [],
                    }
            else:
                profile_payload = None
                provider_config_payload = None

            # ql-20260817-010：静默切换——空 prompt 的切换轮无 LLM turn，run 直接
            # 落终态 completed（纯配置变更记录，无 user_input 日志 → 时间线不渲染）；
            # daemon 收到空 prompt 只 reload 配置不喂消息（reloadWithConfig 既有守卫）。
            if config_switch and not prompt.strip():
                run.status = "completed"
                run.finished_at = datetime.now(UTC)

            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        # task-08 / FR-03 / D-003@v1：commit AgentRun 后、send SESSION_INJECT 前阻塞等
        # daemon session ready（确保 inject 不在 daemon create 完成前到而被静默丢弃，
        # /model 空白根因）。已 ready 立即返 True 零开销直通；超时 8s（ql-20260814-008，
        # 原 30s 会先被 Next.js 代理超时掐断）未 ready 不
        # 抛错不 return，落 warn 日志后 fallback 仍执行原 send SESSION_INJECT 分支，
        # 兼容旧 daemon 不上报 ready（D-003 / R-02）。
        ready = await get_session_readiness().wait(session_id, timeout=8)
        if not ready:
            log.warning("session_ready_timeout", session_id=str(session_id))

        # Dispatch the new turn control message.
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        # gap-2：从 lease metadata 取 claim_token（claim 时已写入或 prepare 时预生成），
        # 后续 turn 的 SESSION_INJECT 仍携带同一 lease 级 claim_token（跨 turn 复用）。
        lease_row = await self._session.get(DaemonTaskLease, session.lease_id)
        lease_meta = dict((lease_row.metadata_ if lease_row else None) or {})
        inject_claim_token = lease_meta.get("claim_token", "")

        hub = get_daemon_ws_hub()
        # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
        runtime_id = session.runtime_id
        daemon_id = (
            await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if runtime_id is not None
            else None
        )
        control_ok = False
        if daemon_id is not None and runtime_id is not None:
            if config_switch:
                # task-05 / D-012：切换分支下发 SESSION_SWITCH_CONFIG（原子 payload，
                # 字段对齐 design §7.2 与 task-08 SessionSwitchConfigPayload 契约，
                # camelCase；profile/providerConfig 为 null 表示该维度不切）。
                control_ok = await hub.send_session_control(
                    daemon_id,
                    DAEMON_MSG_SESSION_SWITCH_CONFIG,
                    {
                        "sessionId": str(session.id),
                        "runId": str(run.id),
                        "claimToken": inject_claim_token,
                        "prompt": prompt,
                        "profile": profile_payload,
                        "providerConfig": provider_config_payload,
                    },
                )
            else:
                inject_payload = {
                    "session_id": str(session.id),
                    "lease_id": str(session.lease_id),
                    "run_id": str(run.id),
                    "prompt": prompt,
                    "claim_token": inject_claim_token,
                    "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
                }
                # 2026-08-20 task-06：附件仅在有附件时附加（无附件路径与现状
                # 逐字节一致零回归；旧 daemon 忽略未知键，协议向后兼容）。
                if inject_attachments:
                    inject_payload["attachments"] = inject_attachments
                control_ok = await hub.send_session_control(
                    daemon_id,
                    DAEMON_MSG_SESSION_INJECT,
                    inject_payload,
                )
        if not control_ok:
            # New run failed to dispatch → converge it to failed but leave the
            # session active so the caller can retry (boundary #13).
            # task-05 / Grill C-11：切换分支同款收敛——run→failed、session 保持
            # active、可重试；会话三列保留已切换的新配置（DB 先于消息落库，
            # 重试重发同一切换即收敛，daemon 未收到消息前不会跑切换轮）。
            try:
                run.status = "failed"
                run.finished_at = datetime.now(UTC)
                run.error_code = "interactive_inject_send_failed"
                run.output_redacted = f"failed to dispatch turn (daemon offline): prompt={prompt!r}"
                self._session.add(run)
                await self._session.commit()
                await self._session.refresh(run)
            except Exception:
                await self._session.rollback()
                log.warning(
                    "session_inject_run_convergence_failed",
                    session_id=str(session.id),
                    run_id=str(run.id),
                )
            raise DaemonRuntimeOffline(
                "执行代理当前不在线，本轮消息未能发送。请确认 daemon 已运行后重试。",
                details={
                    "runtime_id": str(session.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        await self._publish_session_event(
            session.id,
            {"event": "turn_injected", "session_id": str(session.id), "run_id": str(run.id)},
        )
        return SessionDispatchResult(
            agent_session=session,
            agent_run=run,
            lease_id=session.lease_id,
        )

    async def interrupt_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionControlResult:
        """Send a turn-level interrupt for the current run (FR-04).

        Locks + validates the session, finds the unique currentRun, sends
        SESSION_INTERRUPT. Does NOT touch session/lease terminal state and does
        NOT pre-empt the run status — daemon result drives AgentRun=failed
        (design §7.6 step 3). No currentRun → DaemonSessionNoCurrentRun.
        """
        try:
            session = await self._get_owned_session_for_update(session_id, user_id)
            if session.status != "active":
                raise DaemonSessionNotActive(
                    f"AgentSession '{session_id}' is not active (status={session.status}).",
                    details={"session_id": str(session_id), "status": session.status},
                )
            if session.lease_id is None or session.runtime_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Active session '{session_id}' has no lease/runtime binding.",
                    details={"session_id": str(session_id)},
                )
            run = await self._get_current_run(session.id)
            await self._session.commit()
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        if run is None:
            raise DaemonSessionNoCurrentRun(
                f"Session '{session_id}' has no active run to interrupt.",
                details={"session_id": str(session_id)},
            )

        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
        runtime_id = session.runtime_id
        daemon_id = (
            await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if runtime_id is not None
            else None
        )
        if daemon_id is None or runtime_id is None:
            raise DaemonRuntimeOffline(
                "执行代理当前不在线，无法打断本轮。请稍后重试或等待本轮结束。",
                details={
                    "session_id": str(session_id),
                    "runtime_id": str(runtime_id) if runtime_id else None,
                },
            )
        control_ok = await hub.send_session_control(
            daemon_id,
            DAEMON_MSG_SESSION_INTERRUPT,
            {
                "session_id": str(session.id),
                "lease_id": str(session.lease_id),
                "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
            },
        )
        if not control_ok:
            raise DaemonRuntimeOffline(
                "执行代理当前不在线，无法打断本轮。请稍后重试或等待本轮结束。",
                details={
                    "runtime_id": str(session.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        return SessionControlResult(agent_session=session, current_run_id=run.id)

    async def end_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        reason: str = "manual",
        actor_runtime_owner_id: uuid.UUID | None = None,
    ) -> SessionControlResult:
        """Single reconciliation of session/lease/currentRun (FR-05 / §8.5).

        Locks the session, validates the bound interactive lease, sends a
        best-effort SESSION_END, then in ONE transaction marks currentRun
        killed, session ended, lease completed. Idempotent on already-ended
        sessions. WS failure is a warning only — the local reconciliation
        still succeeds so a daemon offline never strands an active session.

        gap-4 修复（ql-20260623-004）：两种调用方共由此端点，按 ``actor`` 区分
        session 定位方式——
          * 前端（Bearer JWT，``actor_runtime_owner_id is None``）：保持
            :meth:`_get_owned_session_for_update` 的 ``AgentSession.user_id``
            校验；
          * daemon（X-API-Key，router 传入 ``actor_runtime_owner_id``）：api-key
            owner 是 runtime owner，不等于 session 创建者，改走
            :meth:`_get_session_by_runtime_owner_for_update` 按 runtime 归属校验，
            否则 admin 共享 runtime 场景（creator≠owner）必 404。
        其余收口逻辑（lease 校验 / run killed / lease completed / SSE）两种身份
        完全一致。
        """
        try:
            if actor_runtime_owner_id is not None:
                session = await self._get_session_by_runtime_owner_for_update(
                    session_id, actor_runtime_owner_id
                )
            else:
                session = await self._get_owned_session_for_update(session_id, user_id)

            # Idempotent: already ended → no-op return.
            if session.status == "ended":
                await self._session.commit()
                # task-09 / FR-04：ended 终态清理 ready 状态（防前次未清残留，
                # clear 幂等多次调不报错），best-effort 不阻塞结束流程。
                try:
                    get_session_readiness().clear(session_id)
                except Exception:
                    log.warning(
                        "session_ready_clear_failed",
                        session_id=str(session_id),
                    )
                return SessionControlResult(agent_session=session, current_run_id=None)

            if session.lease_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Session '{session_id}' has no bound lease.",
                    details={"session_id": str(session_id)},
                )

            lease = await self._session.get(DaemonTaskLease, session.lease_id)
            if lease is None or lease.kind != "interactive" or lease.id != session.lease_id:
                raise DaemonSessionInvariantViolation(
                    f"Session '{session_id}' lease binding is invalid "
                    f"(missing/non-interactive/mismatched).",
                    details={
                        "session_id": str(session_id),
                        "lease_id": str(session.lease_id),
                        "lease_kind": lease.kind if lease else None,
                    },
                )

            run = await self._get_current_run(session.id)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
        if session.runtime_id is not None:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: resolve provider runtime_id → daemon_instance_id.
            daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
            end_ok = False
            if daemon_id is not None:
                end_ok = await hub.send_session_control(
                    daemon_id,
                    DAEMON_MSG_SESSION_END,
                    {
                        "session_id": str(session.id),
                        "lease_id": str(session.lease_id),
                        "runtime_id": str(session.runtime_id),
                    },
                )
            if not end_ok:
                log.warning(
                    "session_end_control_send_failed",
                    session_id=str(session.id),
                    runtime_id=str(session.runtime_id),
                    reason=reason,
                )

        # Single-transaction local reconciliation (§8.5 收口).
        now = datetime.now(UTC)
        try:
            if run is not None and run.status not in TERMINAL_TURN_STATUSES:
                run.status = "killed"
                run.finished_at = now
                run.exit_code = -1
                self._session.add(run)

            session.status = "ended"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            lease.status = "completed"
            lease.updated_at = now
            # task-11 / FR-04 / D-007：daemon 回传 session_end（interactive ACK，
            # POST /sessions/{id}/end = notifySessionEnd 收敛点）→ 清 terminating_at。
            # cancel_lease 写 terminating_at 标记"等 daemon 回传"，本处即回传收敛点，
            # 清空让 sweeper（lease_service.alert_stuck_terminating_leases）不再误告警。
            # 幂等 None-set；仍在同一 try 单事务收口块内（commit 在下文）。
            lease.terminating_at = None
            self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)

            # task-09 / FR-04：ended 终态清理 ready 状态（commit 后事务外，
            # best-effort；内层 try 隔离 clear 异常，不影响外层 commit 错误
            # raise 分支），避免残留 event 让后续 inject 误判已结束 session 为 ready。
            try:
                get_session_readiness().clear(session_id)
            except Exception:
                log.warning(
                    "session_ready_clear_failed",
                    session_id=str(session_id),
                )
        except Exception:
            await self._session.rollback()
            raise

        await self._publish_session_event(
            session.id,
            {
                "event": "session_ended",
                "session_id": str(session.id),
                "reason": reason,
                "current_run_id": str(run.id) if run else None,
            },
        )
        return SessionControlResult(
            agent_session=session,
            current_run_id=run.id if run else None,
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
        """Reconcile an interactive session after daemon restart (task-10 §4.4).

        Called once per persisted record on daemon boot, BEFORE the daemon runs
        ``SessionManager.restoreAndReconnect`` (query resume). Independent of
        end_session / create_session / inject_session — does not touch the
        existing 4 session REST paths.

        Single transaction must:
          1. SELECT AgentSession FOR UPDATE; validate ownership
             (runtime_id / lease_id / provider / lease.kind == interactive).
          2. Session already ended/failed → return terminal (no resurrect,
             no run convergence). Daemon deletes local record.
          3. Ownership mismatch (runtime/lease/provider/lease kind) OR session
             missing → return ``rejected``. Daemon deletes local record; no
             token rotation, no local session built.
          4. Recoverable (active/reconnecting) → write status=reconnecting +
             last_active_at=now.
          5. interrupted_run_id non-null → converge ONLY the same-session run
             whose status is in ACTIVE_TURN_STATUSES to failed (error_code=
             daemon_restarted, finished_at=now); already-terminal → idempotent
             (keep result). Cross-session run id → invariant violation (409).
          6. Another non-terminal run on same session (besides interrupted) →
             invariant violation (409) — never guess or batch-fail.
          7. Rotate lease.claim_token (防旧 claim 重放，task-10 §7 边界 15).
          8. Publish session reconnecting event; return result.

        ``agent_session_id`` is accepted for log/audit only (SDK session_id);
        backend never trusts it for ownership — runtime_id/lease_id/provider
        are the real guards.
        """
        try:
            # Ownership lock + validate. SELECT FOR UPDATE serializes concurrent
            # recover on same session (PostgreSQL); SQLite still exercises the
            # query + branches.
            stmt = select(AgentSession).where(AgentSession.id == session_id).with_for_update()
            session = (await self._session.execute(stmt)).scalar_one_or_none()

            if session is None:
                log.info(
                    "session_recover_not_found",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                )
                return SessionRecoveryResult(
                    session_id=session_id,
                    lease_id=lease_id,
                    status="rejected",
                )

            # Session already terminal → do not resurrect, do not converge runs.
            if session.status in ("ended", "failed"):
                log.info(
                    "session_recover_already_terminal",
                    session_id=str(session_id),
                    status=session.status,
                )
                return SessionRecoveryResult(
                    session_id=session.id,
                    lease_id=session.lease_id,
                    status=session.status,
                )

            # Ownership guards: runtime/lease/provider/lease kind must all match.
            ownership_ok = (
                session.runtime_id == runtime_id
                and session.lease_id == lease_id
                and session.provider == provider
            )
            lease: DaemonTaskLease | None = None
            if session.lease_id is not None:
                lease = await self._session.get(DaemonTaskLease, session.lease_id)
            lease_ok = (
                lease is not None
                and lease.kind == "interactive"
                and lease.id == session.lease_id
                and lease.id == lease_id
            )
            if not ownership_ok or not lease_ok:
                log.warning(
                    "session_recover_ownership_mismatch",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                    expected_runtime_id=str(session.runtime_id),
                    lease_id=str(lease_id),
                    lease_kind=lease.kind if lease else None,
                )
                return SessionRecoveryResult(
                    session_id=session.id,
                    lease_id=session.lease_id,
                    status="rejected",
                )

            # Converge crashed currentRun BEFORE writing reconnecting, so the
            # reconnecting state never co-exists with a lingering running run.
            interrupted_status: Literal["failed"] | None = None
            if interrupted_run_id is not None:
                interrupted_status = await self._converge_crashed_run(
                    session_id=session.id,
                    run_id=interrupted_run_id,
                )

            # Sanity invariant: no OTHER non-terminal run should remain on this
            # session after convergence (else daemon state is ambiguous). This
            # catches the rare double-crash / state-corruption case.
            await self._assert_no_other_active_run(
                session_id=session.id,
                excluded_run_id=interrupted_run_id,
            )

            # Write reconnecting + rotate token.
            now = datetime.now(UTC)
            session.status = "reconnecting"
            session.last_active_at = now
            self._session.add(session)

            if lease is not None:
                new_token = secrets.token_hex(32)
                metadata = dict(lease.metadata_ or {})
                metadata["claim_token"] = new_token
                lease.metadata_ = metadata
                flag_modified(lease, "metadata_")
                lease.updated_at = now
                self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {
                    "event": "session_reconnecting",
                    "session_id": str(session.id),
                    "runtime_id": str(runtime_id),
                    "interrupted_run_id": (str(interrupted_run_id) if interrupted_run_id else None),
                },
            )
            log.info(
                "session_recovered_reconnecting",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
                interrupted_run_status=interrupted_status,
            )
            return SessionRecoveryResult(
                session_id=session.id,
                lease_id=session.lease_id,
                status="reconnecting",
                interrupted_run_status=interrupted_status,
            )
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    async def _converge_crashed_run(
        self,
        *,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> Literal["failed"] | None:
        """Converge a single crashed run to failed (daemon_restarted).

        - Run belongs to a different session → invariant violation (409).
        - Run already terminal → idempotent, return None (keep result).
        - Run in ACTIVE_TURN_STATUSES → failed + finished_at + error_code.

        Returns ``"failed"`` only when this call actually converged the run.
        """
        run = await self._session.get(AgentRun, run_id)
        if run is None:
            # Run id stale/unknown — treat as nothing to converge (idempotent).
            log.warning(
                "session_recover_interrupted_run_missing",
                session_id=str(session_id),
                run_id=str(run_id),
            )
            return None

        if run.agent_session_id != session_id:
            # Cross-session run id — never touch another session's run.
            raise DaemonSessionInvariantViolation(
                f"interrupted_run_id '{run_id}' belongs to another session.",
                details={
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "run_session_id": str(run.agent_session_id),
                },
            )

        if run.status in TERMINAL_TURN_STATUSES:
            # Idempotent: keep the original terminal result.
            return None

        if run.status not in ACTIVE_TURN_STATUSES:
            # Unexpected state (e.g. unknown status string) — still converge to
            # failed to avoid a stuck non-terminal run after restart.
            log.warning(
                "session_recover_run_unexpected_status",
                session_id=str(session_id),
                run_id=str(run_id),
                run_status=run.status,
            )

        now = datetime.now(UTC)
        run.status = "failed"
        run.finished_at = now
        run.error_code = "daemon_restarted"
        if not run.output_redacted:
            run.output_redacted = "daemon_restarted"
        self._session.add(run)

        # ql-20260815-003：run 收敛 failed 后其 pending AskUserQuestion 卡成孤儿，
        # 置 cancelled（不自带 commit，随调用方 recover 事务一起提交）。
        from app.modules.daemon.permission_service import cancel_pending_dialogs_for_run

        await cancel_pending_dialogs_for_run(self._session, run_id)
        return "failed"

    async def _assert_no_other_active_run(
        self,
        *,
        session_id: uuid.UUID,
        excluded_run_id: uuid.UUID | None,
    ) -> None:
        """Raise invariant violation if another non-terminal run lingers."""
        stmt = select(AgentRun.id).where(
            AgentRun.agent_session_id == session_id,
            col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
        )
        ids = [
            row[0] for row in (await self._session.execute(stmt)).all() if row[0] != excluded_run_id
        ]
        if ids:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has an unexpected lingering active run "
                f"after daemon restart.",
                details={
                    "session_id": str(session_id),
                    "lingering_run_ids": [str(i) for i in ids],
                },
            )

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
    ) -> Literal["active", "failed", "rejected"]:
        """Flip a reconnecting session to active after daemon resume succeeds.

        Two-phase recover (task-10 §4.4 step 7): daemon runs
        recover_session_after_daemon_restart (writes reconnecting) → then
        restoreAndReconnect (driver.start resume) → on success calls this to
        flip reconnecting → active. On resume failure the daemon leaves the
        session in reconnecting (converged by task-07 idle sweep or manual end).

        Ownership guard: runtime_id must match; mismatch → rejected.
        Non-reconnecting session (already active/ended/failed) → idempotent
        return of current status.
        """
        try:
            stmt = (
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.runtime_id == runtime_id,
                )
                .with_for_update()
            )
            session = (await self._session.execute(stmt)).scalar_one_or_none()
            if session is None:
                return "rejected"
            if session.status != "reconnecting":
                # Idempotent: already active (or terminal). Return current.
                return session.status  # type: ignore[return-value]

            session.status = "active"
            session.last_active_at = datetime.now(UTC)
            self._session.add(session)
            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {"event": "session_reconnected", "session_id": str(session.id)},
            )
            # task-10 / FR-04：recover 主路径双保险（design Phase 4 / gap-1）。
            # reconnecting→active 翻转 + commit + publish 成功之后调 mark_ready，
            # 与 daemon restoreAndReconnect 上报构成双保险，防 daemon 上报丢失致
            # inject 等 ready 超时。mark_ready 幂等（set.add + event.set），与
            # daemon 上报互为补集非互斥。best-effort（mark 内部仅内存操作，理论
            # 不抛；try 隔离异常防污染已 commit 成功的事务，参照 task-09 clear 风格）。
            try:
                get_session_readiness().mark_ready(session_id)
            except Exception:
                log.warning(
                    "session_ready_mark_failed",
                    session_id=str(session_id),
                )
            log.info(
                "session_reconnected_active",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
            )
            return "active"
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    async def mark_session_recovery_failed(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        reason: str = "restore_failed",
    ) -> Literal["failed", "rejected"]:
        """Flip a reconnecting session to failed after daemon resume failed.

        Daemon calls this when driver.start({resume}) throws (cwd mismatch /
        executable missing / SDK jsonl missing). The session was written
        reconnecting by recover_session_after_daemon_restart; resume failing
        means it cannot be restored → failed terminal.
        """
        try:
            stmt = (
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.runtime_id == runtime_id,
                )
                .with_for_update()
            )
            session = (await self._session.execute(stmt)).scalar_one_or_none()
            if session is None:
                return "rejected"
            if session.status in ("ended", "failed"):
                return session.status  # type: ignore[return-value]

            now = datetime.now(UTC)
            session.status = "failed"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)
            await self._session.commit()
            await self._session.refresh(session)

            # task-09 / FR-04：failed 终态清理 ready 状态（commit 后事务外，
            # best-effort；内层 try 隔离 clear 异常，不影响外层 commit 错误处理）。
            try:
                get_session_readiness().clear(session_id)
            except Exception:
                log.warning(
                    "session_ready_clear_failed",
                    session_id=str(session_id),
                )

            await self._publish_session_event(
                session.id,
                {
                    "event": "session_recovery_failed",
                    "session_id": str(session.id),
                    "reason": reason,
                },
            )
            log.warning(
                "session_recovery_failed",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
                reason=reason,
            )
            return "failed"
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    # ── Read-only session list + history (task-12, FR-10 / D-005@v1) ────────

    async def list_agent_sessions(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status_filter: str | None = None,
        runtime_id: uuid.UUID | None = None,
        machine_id: uuid.UUID | None = None,
        provider: str | None = None,
        q: str | None = None,
    ) -> tuple[list[AgentSession], int]:
        """Owner-scoped list of AgentSession with stable paging.

        D-005@v1: isolation is purely DB-level (``AgentSession.user_id``); no
        post-filter. Stable order ``coalesce(last_active_at, created_at) DESC,
        id DESC`` so paging never skips / repeats. ``status_filter`` (when given)
        must already be validated by the router to a known literal.

        task-06 / FR-02 / D-003@v1 过滤参数（全部可选，不传 = 现状查询，零回归）：

        - ``runtime_id``：``AgentSession.runtime_id`` 精确匹配。
        - ``machine_id``：经 ``daemon_runtimes.daemon_instance_id`` EXISTS 关联
          （runtime 缺失的旧会话不匹配任何 machine）。
        - ``provider``：``AgentSession.provider`` 精确匹配（router 层 Literal 校验）。
        - ``q``：标题模糊搜索。title 非持久化列（router 层由首条 user_input
          摘要派生），故按「会话存在 channel=user_input 且 content_redacted
          ilike q 的日志」EXISTS 过滤——title 恒为某条 user_input 的前缀，
          语义上为标题搜索的超集（无漏报）；``%``/``_``/反斜杠 按字面转义，
          参数经 SQLAlchemy 绑定（防注入）。
        """
        from sqlalchemy import exists, func

        base_filters = [
            AgentSession.user_id == user_id,
            AgentSession.deleted_at.is_(None),  # FR-07 软删过滤
        ]
        if status_filter is not None:
            base_filters.append(AgentSession.status == status_filter)
        if runtime_id is not None:
            base_filters.append(AgentSession.runtime_id == runtime_id)
        if machine_id is not None:
            base_filters.append(
                exists().where(
                    DaemonRuntime.id == AgentSession.runtime_id,
                    DaemonRuntime.daemon_instance_id == machine_id,
                )
            )
        if provider is not None:
            base_filters.append(AgentSession.provider == provider)
        if q:
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            base_filters.append(
                exists().where(
                    AgentRun.agent_session_id == AgentSession.id,
                    AgentRunLog.run_id == AgentRun.id,
                    AgentRunLog.channel == "user_input",
                    AgentRunLog.content_redacted.ilike(f"%{escaped}%", escape="\\"),
                )
            )

        count_stmt = select(func.count()).select_from(AgentSession).where(*base_filters)
        total = int((await self._session.execute(count_stmt)).scalar() or 0)

        order_key = func.coalesce(AgentSession.last_active_at, AgentSession.created_at)
        list_stmt = (
            select(AgentSession)
            .where(*base_filters)
            .order_by(order_key.desc(), AgentSession.id.desc())
            .limit(limit)
            .offset(offset)
        )
        items = list((await self._session.execute(list_stmt)).scalars().all())
        return items, total

    async def get_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

        Read-only single-read counterpart to :meth:`list_agent_sessions`.
        Ownership is enforced by the ``user_id`` filter so a missing OR
        cross-user session both surface as 404 without leaking existence
        (mirrors ``_get_owned_session_for_update`` minus the row lock — no
        write here, so FOR UPDATE would only add contention). Returns the ORM
        row; the router serializes it via ``AgentSessionRead`` (same mapping
        the list endpoint uses).
        """
        stmt = select(AgentSession).where(
            AgentSession.id == session_id,
            AgentSession.user_id == user_id,
            AgentSession.deleted_at.is_(None),  # FR-07 软删视为不存在→404
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def _heal_agent_session_id_from_runs(self, session: AgentSession) -> str | None:
        """ql-20260821-001：从会话历史 run 恢复 SDK resume key 并写回 session 行。

        历史版本的 SDK session id 只落到 run 级列 ``AgentRun.session_id``（daemon
        消息流写入的 claude session_id / codex thread id，与 daemon 侧
        ``state.agentSessionId`` 同源），session 级列从未回填。此处取该会话 runs
        中最新非空值——fork 场景各 turn 可能轮换 id，``created_at DESC`` 保证取到
        最新有效 key。命中即写 ``session.agent_session_id``（调用方事务内随
        reopen 转换一起 commit/rollback，不留半更新状态）；无任何 run 记录过
        session id 则返回 None（真不可恢复，D-004）。
        """
        stmt = (
            select(AgentRun.session_id)
            .where(
                AgentRun.agent_session_id == session.id,
                col(AgentRun.session_id).is_not(None),
                col(AgentRun.session_id) != "",
            )
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
        healed = (await self._session.execute(stmt)).scalar_one_or_none()
        if healed is None:
            return None
        session.agent_session_id = healed
        self._session.add(session)
        return healed

    async def reopen_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionReopenResponse:
        """Reopen an ended Claude/Codex session for resume (task-05+07 / FR-06).

        Validation (task-05) + full transition (task-07): new interactive lease,
        ``claim_token`` rotation, SESSION_RESUME WS. The daemon-side SDK resume
        is task-08. This method:

          1. SELECT AgentSession FOR UPDATE + ownership (user_id mismatch → 404,
             no existence leak — mirrors :meth:`end_session`).
          2. Pre-flight checks IN ORDER (first failure wins, see task-05 §边界):
             - provider not in {claude, codex} → :class:`DaemonSessionResumeUnsupported`
             - agent_session_id is None → 先尝试从该会话历史 run 的
               ``AgentRun.session_id`` 恢复 resume key（ql-20260821-001 存量自愈，
               :meth:`_heal_agent_session_id_from_runs`）；恢复不到（D-004:
               create-time handshake 从未产出 SDK session id）才抛
               :class:`DaemonSessionNoAgentSession`
             - status in ACTIVE_SESSION_STATUSES → :class:`DaemonSessionNotActive`
               (caller should use inject, not reopen)
             - target runtime offline → :class:`DaemonOffline`
          3. task-07 transition: create a NEW interactive lease (the original
             ``completed`` lease is preserved untouched, design §6.2) with a
             fresh ``claim_token``, point ``session.lease_id`` at it, flip
             ``status="reconnecting"``, commit, then emit a best-effort
             ``daemon:session_resume`` WS (``agent_session_id`` is the SDK resume
             key and is preserved verbatim). The method signature + return shape
             are final.

        ``FOR UPDATE`` serializes concurrent reopen on the same row; a second
        reopen landing after the first commits is caught by the status check
        (now ``reconnecting`` ∈ ACTIVE_SESSION_STATUSES → NOT_ACTIVE).
        """
        session = await self._get_owned_session_for_update(session_id, user_id)

        # Pre-flight checks (order is load-bearing — see task-05 §边界处理).
        if session.provider not in {"claude", "codex"}:
            raise DaemonSessionResumeUnsupported(
                f"Session '{session_id}' provider '{session.provider}' does not "
                f"support resume (only claude/codex).",
                details={
                    "session_id": str(session_id),
                    "provider": session.provider,
                },
            )
        if not session.agent_session_id:
            # ql-20260821-001：存量会话自愈——SDK session id 在历史版本只写 run 级
            # 列 AgentRun.session_id，session 级列恒 NULL（详见 run_sync
            # submit_messages 的回填注释）。reopen 前从该会话最新 run 恢复 resume
            # key 并持久化（同事务，随下方 reopen 转换一起 commit）；无任何 run
            # 记录过 session id（create 阶段握手都没成功过，D-004）才真正拒绝。
            healed_id = await self._heal_agent_session_id_from_runs(session)
            if healed_id is None:
                raise DaemonSessionNoAgentSession(
                    f"会话 '{session_id}' 缺少可供恢复的 SDK 会话标识"
                    "（该会话从未成功建立过 SDK 会话，无法重新打开）。",
                    details={"session_id": str(session_id)},
                )
            log.info(
                "session_sdk_id_healed_from_runs",
                session_id=str(session_id),
                agent_session_id=healed_id,
            )
        if session.status in ACTIVE_SESSION_STATUSES:
            raise DaemonSessionNotActive(
                f"Session '{session_id}' is still {session.status}; use inject instead of reopen.",
                details={
                    "session_id": str(session_id),
                    "status": session.status,
                },
            )
        # Runtime must be connected so the daemon can run the SDK resume.
        runtime_id = session.runtime_id
        if runtime_id is not None:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: WS Hub routes by daemon_instance_id; resolve from runtime.
            target_daemon_id = await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if target_daemon_id is None or not hub.is_connected(target_daemon_id):
                raise DaemonOffline(
                    "执行代理当前不在线，无法恢复会话。请先启动 daemon 再重新打开。",
                    details={
                        "session_id": str(session_id),
                        "runtime_id": str(runtime_id),
                    },
                )

        # ── task-07: full reopen transition (design §6.1/§6.2/§6.4/§14) ───────
        # Do NOT revive the original (completed) lease — design §6.2: the ended
        # lease stays ``completed`` for audit; a brand-new interactive lease is
        # created with a fresh ``claim_token`` so a stale pre-reopen claim can
        # never be replayed against the resumed session (matches
        # recover_session_after_daemon_restart token rotation, task-10 §7).
        now = datetime.now(UTC)
        target_runtime_id = session.runtime_id
        assert target_runtime_id is not None  # offline check above guarantees online

        new_token = secrets.token_hex(32)
        new_lease = DaemonTaskLease(
            runtime_id=target_runtime_id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            lease_expires_at=None,  # NULL → expire_leases skips (D-005@v1)
            attempt_number=1,
            metadata_={
                "session_id": str(session.id),
                "agent_session_id": session.agent_session_id,
                "provider": session.provider,
                "claim_token": new_token,
                "reopened_from_status": session.status,
            },
        )
        self._session.add(new_lease)
        await self._session.flush()  # populate new_lease.id before FK bind

        # Switch session onto the new lease. agent_session_id stays — it is the
        # SDK resume key and must never change. runtime_id is only updated if the
        # caller targets a different daemon (none today; reopen always reuses
        # session.runtime_id, but the branch is kept symmetric with create).
        session.lease_id = new_lease.id
        session.runtime_id = target_runtime_id
        session.status = "reconnecting"
        session.last_active_at = now
        self._session.add(session)
        await self._session.commit()
        await self._session.refresh(session)
        await self._session.refresh(new_lease)

        # ── best-effort daemon:session_resume WS (design §6.4) ────────────────
        # WS failure does NOT roll back the local reconnecting state — the daemon
        # will converge on its own (pull/next-poll or recover-on-restart). The
        # frontend surfaces reconnecting immediately. cwd is forwarded so the
        # SDK resume runs in the original working directory (R-cwd).
        resume_payload = {
            "session_id": str(session.id),
            "lease_id": str(new_lease.id),
            "agent_session_id": session.agent_session_id,
            "cwd": session.cwd,
            "provider": session.provider,
            "runtime_id": str(target_runtime_id),
        }
        try:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: resolve provider runtime_id → daemon_instance_id (WS key).
            resume_daemon_id = await _resolve_daemon_id_for_runtime(
                self._session, target_runtime_id
            )
            resume_ok = False
            if resume_daemon_id is not None:
                resume_ok = await hub.send_session_control(
                    resume_daemon_id,
                    DAEMON_MSG_SESSION_RESUME,
                    resume_payload,
                )
            if not resume_ok:
                log.warning(
                    "session_resume_control_not_delivered",
                    session_id=str(session.id),
                    runtime_id=str(target_runtime_id),
                    lease_id=str(new_lease.id),
                )
        except Exception:
            # best-effort: any WS error stays a warning, local reconnecting holds.
            log.warning(
                "session_resume_control_send_failed",
                session_id=str(session.id),
                runtime_id=str(target_runtime_id),
                lease_id=str(new_lease.id),
                exc_info=True,
            )

        return SessionReopenResponse(
            session_id=str(session.id),
            status="reconnecting",
        )

    async def delete_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Soft-delete an owned session while retaining its row + run history.

        2026-07-11-unify-runtime-session-dialog / FR-06 / D-003: 改为软删除。
        active/pending/reconnecting 会话仍先做 best-effort end reconciliation
        （WS SESSION_END + currentRun killed + lease completed，镜像
        :meth:`end_session`），daemon 离线时该步失败仅 warning 不阻断；随后
        ``UPDATE agent_sessions SET deleted_at=now()`` 标记软删。行保留供审计，
        ``agent_runs.agent_session_id`` 外键**刻意不断**（run/log 历史仍可查），
        list/get 端点通过 ``deleted_at IS NULL`` 过滤隐藏软删会话。ended/failed
        会话直接 UPDATE 软删（不做 end reconciliation）。
        """
        agent_session = (
            await self._session.execute(
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if agent_session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

        if agent_session.status in ACTIVE_SESSION_STATUSES:
            # Best-effort end reconciliation. Failures here MUST NOT bubble up:
            # the caller asked to delete, so we still force the hard delete below
            # (daemon offline is handled by its own idle-timeout on its side).
            try:
                await self._end_session_for_delete(agent_session)
            except Exception:
                log.warning(
                    "session_delete_end_reconciliation_failed",
                    session_id=str(session_id),
                    status=agent_session.status,
                    exc_info=True,
                )

        # 2026-07-11-unify-runtime-session-dialog / D-003 / C-7: 软删除——UPDATE
        # deleted_at（行保留供审计；刻意不断 agent_runs.agent_session_id 外键，
        # run/log 历史仍可查；list/get 端点过滤 deleted_at IS NULL 隐藏）。
        # 取代原硬删：删除了 update(AgentRun).set(agent_session_id=None) +
        # session.delete(agent_session) 两步（C-7 / R-4）。
        agent_session.deleted_at = datetime.now(UTC)
        await self._session.commit()

    async def _end_session_for_delete(self, session: AgentSession) -> None:
        """Internal end reconciliation used by delete_agent_session.

        task-03 / D-003@v1: mirrors the core of :meth:`end_session` (WS +
        run killed + lease completed) but never raises on WS failure and never
        touches ``session.status`` beyond the converged ``ended`` — the caller
        (delete) hard-deletes the row right after, so the session status is
        effectively throwaway; only the run/lease convergence matters for audit.
        Holds the same session row lock the caller already acquired.
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
        if session.runtime_id is not None:
            hub = get_daemon_ws_hub()
            try:
                # task-06: resolve provider runtime_id → daemon_instance_id.
                daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
                end_ok = False
                if daemon_id is not None:
                    end_ok = await hub.send_session_control(
                        daemon_id,
                        DAEMON_MSG_SESSION_END,
                        {
                            "session_id": str(session.id),
                            "lease_id": str(session.lease_id) if session.lease_id else "",
                            "runtime_id": str(session.runtime_id),
                        },
                    )
                if not end_ok:
                    log.warning(
                        "session_delete_end_control_send_failed",
                        session_id=str(session.id),
                        runtime_id=str(session.runtime_id),
                    )
            except Exception:
                log.warning(
                    "session_delete_end_control_send_failed",
                    session_id=str(session.id),
                    runtime_id=str(session.runtime_id),
                    exc_info=True,
                )

        now = datetime.now(UTC)
        # Kill the current non-terminal run if any (single-transaction convergence).
        runs = (
            (
                await self._session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == session.id)
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            if run.status not in TERMINAL_TURN_STATUSES:
                run.status = "killed"
                run.finished_at = now
                run.exit_code = -1
                self._session.add(run)

        # Complete the bound interactive lease (if any).
        if session.lease_id is not None:
            lease = await self._session.get(DaemonTaskLease, session.lease_id)
            if lease is not None and lease.status not in (
                "completed",
                "cancelled",
                "expired",
            ):
                lease.status = "completed"
                lease.updated_at = now
                self._session.add(lease)

        await self._session.flush()

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        limit: int = 5000,
    ) -> list[AgentRunLog]:
        """Return all AgentRunLog rows for an owned session, cross-run aggregate.

        D-005@v1: aggregation key is ``AgentRun.agent_session_id`` (the 1:N FK
        to AgentSession), NEVER ``AgentRun.session_id`` (the claude resume id,
        different semantics). Ownership is verified DB-side
        (``session_id + user_id``); a missing or cross-user session raises
        DaemonSessionNotFound so existence does not leak.

        Ordering note: ``AgentRun`` has no ``created_at`` column, so cross-run
        order is anchored on each run's earliest log timestamp (then
        ``started_at`` then ``id``), and within a run logs are ordered by
        ``timestamp ASC, id ASC``. This is stable and lets the frontend
        delineate turns via ``run_id``.
        """
        from sqlalchemy import func

        # Ownership check (resource hiding — same not-found for missing/cross-user).
        owned = (
            await self._session.execute(
                select(AgentSession.id).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

        # Per-run earliest log timestamp (for cross-run ordering anchor).
        # 第四批 code-quality：原 min_ts_subq 对整张 agent_run_logs（系统最大表）
        # GROUP BY 无 session 过滤，PG 必须先物化全表聚合再 JOIN，随日志增长线性
        # 恶化。收敛到当前 session 的 run 集（语义不变：外层 run_anchor 已 WHERE
        # agent_session_id == session_id，缩小聚合范围不改变最终结果集）。
        session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
        min_ts_subq = (
            select(
                AgentRunLog.run_id.label("run_id"),
                func.min(AgentRunLog.timestamp).label("min_ts"),
            )
            .where(AgentRunLog.run_id.in_(session_run_ids))
            .group_by(AgentRunLog.run_id)
            .subquery()
        )

        # Join: logs → runs (filtered by agent_session_id == session_id) → min_ts anchor.
        run_anchor = (
            select(
                AgentRun.id.label("run_id"),
                func.coalesce(min_ts_subq.c.min_ts, AgentRun.started_at).label("anchor_ts"),
            )
            .select_from(AgentRun)
            .outerjoin(min_ts_subq, min_ts_subq.c.run_id == AgentRun.id)
            .where(AgentRun.agent_session_id == session_id)
            .subquery()
        )

        stmt = (
            select(AgentRunLog)
            .select_from(AgentRunLog)
            .join(run_anchor, run_anchor.c.run_id == AgentRunLog.run_id)
            .order_by(
                run_anchor.c.anchor_ts.desc(),
                AgentRunLog.timestamp.desc(),
                AgentRunLog.id.desc(),
            )
            # 性能优化 Wave 2 / P3-3:加 limit 防止长会话(N runs × M logs)全量
            # 加载 TEXT 大列(content_redacted)。取**最新** N 条(anchor/timestamp/
            # id desc),再 reverse 还原正序展示(同 run 连续、跨 run 按起始序)——
            # 会话详情关心近期活动,超长会话丢弃的是早期而非最近;正常会话(<5000
            # 行)全量可见。
            .limit(limit)
        )
        rows = list((await self._session.execute(stmt)).scalars().all())
        rows.reverse()
        return rows
