"""Session-level canUseTool permission orchestration (task-08 / FR-07 / D-007@v1).

This service lives between the daemon WS uplink (PERMISSION_REQUEST) and the
daemon WS downlink (PERMISSION_RESPONSE). It handles two flavors of request:

* **Ordinary canUseTool approval** (``dialog_kind is None``): ephemeral, in-memory
  ``_timers`` registry + a 5-minute timeout enforcer that auto-denies any
  request the user never answered. Stateless across process restarts — the
  daemon-side ``PermissionResolver`` fallback timer + SDK AbortSignal are the
  final fail-closed safety net (D-007@v1). No DB row is written for this path.

* **AskUserQuestion dialog** (``dialog_kind`` set): long-lived, user-facing
  question that may wait indefinitely. Persisted in ``session_dialog_requests``
  so it survives a frontend page refresh; the 5min timeout is *not* armed. The
  REST ``GET /sessions/{id}/dialogs`` endpoint replays pending rows.

task-07（2026-08-29-daemon-platform-resilience / design A3）：新增 HTTP 上行通道
``POST /api/daemon/sessions/{id}/permission-requests`` →
:meth:`DaemonPermissionService.handle_permission_request_http`——daemon WS 不通时
的兜底（X-API-Key + 条件 X-Claim-Token 鉴权），与 WS 上行同源汇聚（复用
``handle_permission_request`` 的校验/SSE/持久化/timer），人审挂起等待而非直接
deny（backend 5min 超时 + daemon fallback timer 双兜底）。

Reuses DaemonService helpers verbatim (task-05):
  - ``_publish_session_event(session_id, payload)`` → ``agent_session:{id}`` Redis
  - ``_get_owned_session_for_update(session_id, user_id)`` for REST response auth
  - ``_get_current_run(session_id)`` for run_id / active-turn validation
"""

from __future__ import annotations

import asyncio
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.daemon.control_commands import (
    KIND_PERMISSION_RESPONSE,
    ControlCommandService,
)
from app.modules.daemon.model import SessionDialogRequest
from app.modules.daemon.protocol import (
    PermissionRequestPayload,
)
from app.modules.daemon.service import (
    ACTIVE_SESSION_STATUSES,
    ACTIVE_TURN_STATUSES,
    DaemonInvalidClaimToken,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
)

if TYPE_CHECKING:
    from app.modules.daemon.ws_hub import DaemonWsHub

log = get_logger(__name__)

# 通知 body 的提问预览长度上限（截断保单行呈现）。
_DIALOG_PREVIEW_LIMIT = 60


def _dialog_preview(dialog_payload: dict | None) -> str | None:
    """从 dialog_payload 提取提问预览文本（AskUserQuestion）。

    与前端 ``resolvePendingTitle``（minimized-dialog-capsule.tsx）同口径读
    ``questions[]`` 数组的第一个非空 ``question``；兼容旧形态顶层 ``question``
    字符串。超长截断。取不到返回 None（通知落库 body 为空，面板只显示标题行）。
    """
    if not isinstance(dialog_payload, dict):
        return None
    candidates: list[str] = []
    top = dialog_payload.get("question")
    if isinstance(top, str) and top.strip():
        candidates.append(top.strip())
    questions = dialog_payload.get("questions")
    if isinstance(questions, list):
        for item in questions:
            if isinstance(item, dict):
                question = item.get("question")
                if isinstance(question, str) and question.strip():
                    candidates.append(question.strip())
    if not candidates:
        return None
    text = candidates[0]
    return text[:_DIALOG_PREVIEW_LIMIT] + ("…" if len(text) > _DIALOG_PREVIEW_LIMIT else "")


async def cancel_pending_dialogs_for_run(db: AsyncSession, run_id: uuid.UUID) -> int:
    """ql-20260815-003：作废某 run 名下 pending 的 SessionDialogRequest（→cancelled）。

    run 终止（后端重启清 stale run / daemon 重启 converge crashed run 等）时，
    agent 已不在等待答案，pending 卡片成孤儿——用户点卡只得到
    ``no active run to approve``。恢复路径收敛 run 时调本 helper 把卡片置
    ``cancelled``（model.py 声明的生命周期终态，此前从未有写入方）。

    模块级函数（非 DaemonPermissionService 方法）：调用方（agent/service 的
    启动恢复、session/service 的会话恢复）只持有 AsyncSession，没有 permission
    service 实例；late import 本函数可避免循环依赖。

    **不自带 commit**——随调用方事务一起提交（恢复路径末尾统一 commit）。
    返回实际置 cancelled 的行数（幂等：重复调用返回 0）。
    """
    result = await db.execute(
        update(SessionDialogRequest)
        .where(
            SessionDialogRequest.run_id == run_id,
            SessionDialogRequest.status == "pending",
        )
        .values(status="cancelled")
    )
    count = int(result.rowcount or 0)
    if count:
        log.info("orphan_dialogs_cancelled", run_id=str(run_id), count=count)
    return count


# D-007@v1: 5 minutes — backend main timeout. Daemon fallback is 5min + 5s
# tolerance, so a missing/dropped backend deny still fail-closes on the daemon.
PERMISSION_TIMEOUT_SEC = 5 * 60

# ql-20260826-012：list_dialog_history 固定取最近 N 条（原无界全量，会话越久
# 每次打开面板拉得越多）；200 覆盖长会话可视历史。
_DIALOG_HISTORY_MAX = 200


# ── Domain errors ────────────────────────────────────────────────────────────


class DaemonPermissionNotFound(AppError):
    """REST response arrived for a request_id that has no pending timer."""

    code = "HTTP_404_DAEMON_PERMISSION_NOT_FOUND"
    http_status = 404


class DaemonPermissionAlreadyResolved(AppError):
    """REST response arrived after the request was already resolved (manual or timeout)."""

    code = "HTTP_409_DAEMON_PERMISSION_ALREADY_RESOLVED"
    http_status = 409


class DaemonPermissionManualDisabled(AppError):
    """session.config.manual_approval is not True (FR-07 not enabled for this session)."""

    code = "HTTP_409_DAEMON_PERMISSION_MANUAL_DISABLED"
    http_status = 409


class DaemonDialogNotFound(AppError):
    """REST response arrived for a dialog request_id that has no pending DB row.

    Distinct from ``DaemonPermissionNotFound`` (ephemeral timer miss): dialogs
    are persisted, so this fires only when the row was already answered,
    cancelled, or never existed (client race / stale card after refresh).
    """

    code = "HTTP_404_DAEMON_DIALOG_NOT_FOUND"
    http_status = 404


class DaemonDialogAlreadyResolved(AppError):
    """REST response arrived for a dialog request that was already answered."""

    code = "HTTP_409_DAEMON_DIALOG_ALREADY_RESOLVED"
    http_status = 409


@dataclass(frozen=True, slots=True)
class PermissionResponseRead:
    """REST response body for POST /sessions/{id}/permissions/{req}/response."""

    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    accepted: bool


@dataclass(frozen=True, slots=True)
class SessionDialogRead:
    """REST DTO for a persisted dialog request (GET /sessions/{id}/dialogs)."""

    id: uuid.UUID
    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str
    tool_name: str
    dialog_kind: str | None
    dialog_payload: dict | None
    status: str
    answer: dict | None
    created_at: datetime
    answered_at: datetime | None

    @classmethod
    def from_model(cls, row: SessionDialogRequest) -> "SessionDialogRead":
        return cls(
            id=row.id,
            session_id=row.session_id,
            run_id=row.run_id,
            request_id=row.request_id,
            tool_name=row.tool_name,
            dialog_kind=row.dialog_kind,
            dialog_payload=row.dialog_payload,
            status=row.status or "pending",
            answer=row.answer,
            created_at=row.created_at,
            answered_at=row.answered_at,
        )


@dataclass(frozen=True, slots=True)
class WorkspaceDialogRead:
    """工作区级 dialog 查询 DTO（GET /api/workspaces/{id}/dialogs）。

    在 ``SessionDialogRead`` 全部字段基础上，额外承载 4 个来源上下文字段（D-002 /
    D-003），全部 Optional、default=None——这些字段由 task-02 的
    ``list_pending_dialogs_for_workspace`` 经三表 JOIN + lease/log 反查填充，
    任一上下文取不到时返回 None（前端占位「会话进行中」），DTO 本身只承载不推导。
    """

    # ── 既有 SessionDialogRead 字段 ──
    id: uuid.UUID
    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str
    tool_name: str
    dialog_kind: str | None
    dialog_payload: dict | None
    status: str
    answer: dict | None
    created_at: datetime
    answered_at: datetime | None
    # ── D-002/D-003 来源上下文字段（全可选，可空）──
    workspace_id: uuid.UUID | None = None
    workspace_name: str | None = None
    session_type: str | None = None  # scan / chat / stage（D-003）
    run_summary: str | None = None  # 任务 prompt 派生，可空（D-003）

    @classmethod
    def from_model(
        cls,
        row: SessionDialogRequest,
        *,
        workspace_id: uuid.UUID | None = None,
        workspace_name: str | None = None,
        session_type: str | None = None,
        run_summary: str | None = None,
    ) -> "WorkspaceDialogRead":
        """从持久化行构造 DTO；4 个上下文字段 keyword-only、默认 None。"""
        return cls(
            id=row.id,
            session_id=row.session_id,
            run_id=row.run_id,
            request_id=row.request_id,
            tool_name=row.tool_name,
            dialog_kind=row.dialog_kind,
            dialog_payload=row.dialog_payload,
            status=row.status or "pending",
            answer=row.answer,
            created_at=row.created_at,
            answered_at=row.answered_at,
            workspace_id=workspace_id,
            workspace_name=workspace_name,
            session_type=session_type,
            run_summary=run_summary,
        )


# ── Service ──────────────────────────────────────────────────────────────────

# Module-level shared timer registry: per-request DaemonPermissionService instances
# must share the same dict so handle_permission_request (WS uplink) and
# respond_permission (REST downlink) see the same timers. Process restart clears it.
_permission_timers: dict[str, asyncio.Task[None]] = {}


class DaemonPermissionService:
    """Session-level canUseTool approval orchestration (task-08 / D-007@v1)."""

    @property
    def _timers(self) -> dict[str, asyncio.Task[None]]:
        """Delegate to module-level shared registry (not per-instance)."""
        return _permission_timers

    def has_pending(self, request_id: str) -> bool:
        """Whether a permission-response timer is currently armed for ``request_id``.

        Public read access to the pending-timer registry, so callers (tests /
        observability) need not touch the private ``_timers`` mapping——重构
        ``_permission_timers`` 数据结构（dict→对象）时依赖本方法的测试不脆裂。
        """
        return request_id in _permission_timers

    def __init__(
        self,
        daemon_service: DaemonService,
        ws_hub: "DaemonWsHub",
        *,
        timeout_sec: float = PERMISSION_TIMEOUT_SEC,
    ) -> None:
        self._svc = daemon_service
        self._hub = ws_hub
        # Per-instance timeout override (tests inject short values to bypass
        # the real 5min sleep; production uses PERMISSION_TIMEOUT_SEC).
        self._timeout_sec = timeout_sec

    # ── WS uplink: PERMISSION_REQUEST (daemon → server) ──────────────────────

    async def handle_permission_request(
        self,
        daemon_id: uuid.UUID,
        payload: PermissionRequestPayload,
    ) -> bool:
        """WS PERMISSION_REQUEST handler: validate + publish SSE + (maybe) arm timer.

        ``daemon_id`` is the daemon entity id the request arrived on (= the WS
        connection key since task-06).

        task-07（2026-08-29-daemon-platform-resilience / design A3）：返回
        ``bool``——True=已受理（SSE 已广播，dialog 落行 / plain 挂 timer），False=
        校验不通过被丢弃（fail-soft）。WS 调用方忽略返回值；HTTP 上行端点
        （``handle_permission_request_http``）透传给 daemon 做日志观测。

        Validation (fail-soft: warn + drop, never close the WS — task-03 NFR-05):
          1. session exists (read-only; lock lives in the REST response endpoint)
          2. session.runtime_id resolves to a runtime whose owning daemon entity
             id == ``daemon_id`` (migration window: runtime.daemon_instance_id
             is NULL → the runtime_id itself is the legacy routing key, so the
             check then expects ``daemon_id == session.runtime_id``)
          3. session.status ∈ ACTIVE_SESSION_STATUSES
          4. session.config.get("manual_approval") is True (FR-07 gate)
          5. current run exists, status ∈ ACTIVE_TURN_STATUSES,
             and run.id == payload.run_id

        On success:
          - **dialog** (``payload.dialog_kind`` set): persist a
            ``session_dialog_requests`` row (status=pending), publish a
            ``permission_request`` SSE carrying ``dialog_kind`` +
            ``dialog_payload``. The 5min timeout is **not** armed — dialogs
            may wait indefinitely for a human answer.
          - **plain approval**: publish ``permission_request`` SSE + arm the
            5min auto-deny timer (unchanged D-007@v1 behavior).
        """
        session_id = payload.session_id
        run_id = payload.run_id
        request_id = payload.request_id
        is_dialog = payload.dialog_kind is not None

        # Reuse DaemonService's read-only current-run lookup; session fetch is
        # also read-only here — write-side locking is the REST response path's job.
        from app.modules.agent.model import AgentSession

        session_obj = (
            await self._svc._session.execute(
                select(AgentSession).where(AgentSession.id == session_id)
            )
        ).scalar_one_or_none()
        if session_obj is None:
            log.warning(
                "permission_request_session_not_found",
                session_id=str(session_id),
                request_id=request_id,
            )
            return False
        if session_obj.runtime_id is None:
            log.warning(
                "permission_request_no_runtime",
                session_id=str(session_id),
                request_id=request_id,
                daemon_id=str(daemon_id),
            )
            return False
        expected_daemon_id = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        if expected_daemon_id != daemon_id:
            log.warning(
                "permission_request_daemon_mismatch",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(session_obj.runtime_id),
                expected_daemon_id=str(expected_daemon_id),
                received_daemon_id=str(daemon_id),
            )
            return False
        if (session_obj.status or "") not in ACTIVE_SESSION_STATUSES:
            log.warning(
                "permission_request_session_not_active",
                session_id=str(session_id),
                request_id=request_id,
                status=session_obj.status,
            )
            return False
        config = session_obj.config or {}
        if config.get("manual_approval") is not True:
            # daemon should never send PERMISSION_REQUEST for manual=false sessions
            log.warning(
                "permission_request_manual_disabled",
                session_id=str(session_id),
                request_id=request_id,
            )
            return False

        current_run = await self._svc._get_current_run(session_id)
        if current_run is None or current_run.id != run_id:
            log.warning(
                "permission_request_run_mismatch",
                session_id=str(session_id),
                request_id=request_id,
                payload_run_id=str(run_id),
                current_run_id=str(current_run.id) if current_run else None,
            )
            return False
        if (current_run.status or "") not in ACTIVE_TURN_STATUSES:
            log.warning(
                "permission_request_run_not_active_turn",
                session_id=str(session_id),
                request_id=request_id,
                run_status=current_run.status,
            )
            return False

        # Publish permission_request SSE for the frontend approval card. For
        # dialogs the event carries dialog_kind + dialog_payload so the card
        # can render the question+options instead of an allow/deny prompt.
        sse_payload: dict[str, object] = {
            "event": "permission_request",
            "session_id": str(session_id),
            "run_id": str(run_id),
            "request_id": request_id,
            "tool_name": payload.tool_name,
            "input": payload.input,
        }
        if payload.tool_use_id:
            sse_payload["tool_use_id"] = payload.tool_use_id
        if is_dialog:
            sse_payload["dialog_kind"] = payload.dialog_kind
            sse_payload["dialog_payload"] = payload.dialog_payload
        await self._svc._publish_session_event(session_id, sse_payload)

        # task-06（2026-08-29-approval-notify-push / FR-06 / §7.3③）：请求受理
        # 成功（SSE 已广播）后，向会话 owner（AgentSession.user_id，D-010@v1）
        # 定向发 permission_request 通知。HTTP 上行（handle_permission_request_http）
        # 委托本方法，单点挂钩即覆盖 WS/HTTP 双通道。best-effort：任何异常仅
        # log.warning，不影响既有登记行为（D-001@v1 旁路原则）。
        session_label = session_obj.title or str(session_id)[:8]
        if is_dialog:
            notify_title = f"会话「{session_label}」有新的提问待回答"
            # body 放提问预览（dialog_payload.questions[] 第一个非空 question，前端
            # resolvePendingTitle 同口径），避免与标题逐字重复；取不到则不带 body。
            notify_body = _dialog_preview(payload.dialog_payload)
            notify_ref_type = "session_dialog"
        else:
            notify_title = f"会话「{session_label}」请求权限审批"
            notify_body = f"请求使用工具：{payload.tool_name}"
            notify_ref_type = "session_permission"
        await self._notify_session_owner(
            owner_id=session_obj.user_id,
            workspace_id=session_obj.workspace_id,
            type="permission_request",
            title=notify_title,
            body=notify_body,
            ref_type=notify_ref_type,
            ref_id=str(session_id),
            request_id=request_id,
        )

        if is_dialog:
            # Persist the dialog so it survives a frontend refresh. Idempotent
            # on request_id (unique) — a daemon replay upserts the same row
            # instead of forking a second pending card.
            await self._upsert_dialog_row(payload)
            log.info(
                "permission_request_accepted_dialog",
                session_id=str(session_id),
                request_id=request_id,
                tool_name=payload.tool_name,
                dialog_kind=payload.dialog_kind,
            )
            return True

        # Plain canUseTool approval: arm 5min timeout. Use a fresh task so a
        # daemon disconnect can't cancel it.
        if request_id in self._timers:
            # Duplicate request_id (UUID collision / daemon replay): replace.
            self._timers[request_id].cancel()
        self._timers[request_id] = asyncio.create_task(
            self._on_timeout(session_id, run_id, request_id, session_obj.runtime_id)
        )
        log.info(
            "permission_request_accepted",
            session_id=str(session_id),
            request_id=request_id,
            tool_name=payload.tool_name,
        )
        return True

    # ── HTTP uplink: POST /sessions/{id}/permission-requests (task-07 / A3) ──

    async def handle_permission_request_http(
        self,
        session_id: uuid.UUID,
        x_claim_token: str | None,
        payload: PermissionRequestPayload,
        *,
        principal_user_id: uuid.UUID,
    ) -> bool:
        """HTTP PERMISSION_REQUEST uplink (task-07 / design A3).

        daemon WS 不通时的兜底上行通道（``POST /api/daemon/sessions/{id}/
        permission-requests``）。与 WS 上行**同源汇聚**：归属校验 + lease 级
        claim_token 校验 + daemon_id 解析后委托 :meth:`handle_permission_request`，
        复用其全部校验/SSE 广播/dialog 持久化/5min timer 语义。

        鉴权链（对齐既有 permissions response / runs/result 端点惯例）：
          - 路由层 ``get_current_principal`` 已解 X-API-Key（daemon 长期凭证）；
          - **runtime 归属校验**（ql-20260829-004，补 task-07 缺口）：HTTP 路径的
            daemon_id 是从 session.runtime_id 反推的（WS 路径则来自经注册鉴权的
            连接键），若不绑主体会形成「任意有效凭证可对他理会话上行」的弱
            校验面——本方法要求 ``principal_user_id`` own 会话所挂 runtime
            （``daemon_runtimes.user_id``，对齐 pending-controls owner-only 惯例），
            不符/不存在同语义 404 resource-hiding。借用 runtime 场景 runtime 属
            lender=daemon 凭证主体，正常链路不受影响；
          - 本方法对会话绑定的 interactive lease 做 **X-Claim-Token 条件校验**：
            lease metadata 存有非空 claim_token（该会话有 claim 语义）时，
            header 必须携带且 ``secrets.compare_digest`` 匹配，否则 403
            ``DaemonInvalidClaimToken``；无 claim 语义（无 lease / token 空）
            时跳过，交给下方 handle_permission_request 的会话状态校验。

        会话不存在 / runtime 归属不符 → 404（与既有 REST 面 resource-hiding
        一致）；校验不过返回 False（不抛——daemon 侧 fire-and-forget，等待
        响应交由 backend 5min 超时 + daemon fallback timer 双兜底）。
        """
        from app.modules.agent.model import AgentSession
        from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

        session_obj = (
            await self._svc._session.execute(
                select(AgentSession).where(AgentSession.id == session_id)
            )
        ).scalar_one_or_none()
        if session_obj is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        # ql-20260829-004：runtime 归属校验先于 claim_token（凭证主体不符时
        # 直接 resource-hiding 404，不进入后续校验）。
        runtime = (
            await self._svc._session.get(DaemonRuntime, session_obj.runtime_id)
            if session_obj.runtime_id is not None
            else None
        )
        if runtime is None or runtime.user_id != principal_user_id:
            log.warning(
                "permission_http_uplink_runtime_not_owned",
                session_id=str(session_id),
                request_id=payload.request_id,
                runtime_id=str(session_obj.runtime_id),
            )
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        if session_obj.lease_id is not None:
            lease = await self._svc._session.get(DaemonTaskLease, session_obj.lease_id)
            stored_token = (lease.metadata_ or {}).get("claim_token") if lease else None
            # 该会话有 claim 语义：常量时间比对（对齐 lease service 口径，
            # 缺头/不匹配一律 403，不泄露具体差异）。
            if (
                isinstance(stored_token, str)
                and stored_token
                and (not x_claim_token or not secrets.compare_digest(stored_token, x_claim_token))
            ):
                raise DaemonInvalidClaimToken(
                    "Invalid or missing claim_token for permission uplink.",
                    details={
                        "session_id": str(session_id),
                        "lease_id": str(session_obj.lease_id),
                    },
                )
        if session_obj.runtime_id is None:
            log.warning(
                "permission_http_uplink_no_runtime",
                session_id=str(session_id),
                request_id=payload.request_id,
            )
            return False
        daemon_id = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        if daemon_id is None:
            log.warning(
                "permission_http_uplink_no_daemon",
                session_id=str(session_id),
                request_id=payload.request_id,
                runtime_id=str(session_obj.runtime_id),
            )
            return False
        accepted = await self.handle_permission_request(daemon_id, payload)
        if accepted:
            log.info(
                "permission_http_uplink_accepted",
                session_id=str(session_id),
                request_id=payload.request_id,
                is_dialog=payload.dialog_kind is not None,
            )
        return accepted

    # ── daemon_id resolution (task-06 ws routes by daemon_instance_id) ───────

    async def _resolve_daemon_id_for_runtime(
        self,
        runtime_id: uuid.UUID,
    ) -> uuid.UUID | None:
        """Resolve the daemon_entity key the WS hub routes by, for a runtime.

        task-06 / design §5.3: ``DaemonWsHub`` connections are keyed by
        ``daemon_instance_id`` (one socket per daemon entity), but sessions +
        permission timers still carry ``runtime_id`` (the provider row). This
        mirrors ``session.service._resolve_daemon_id_for_runtime`` so the
        permission downlink addresses the right WS connection.

        Migration fallback (D-007 window): pre-existing runtime rows have
        ``daemon_instance_id=NULL`` until the daemon re-registers. For those we
        fall back to the ``runtime_id`` itself as the connection key (legacy
        routing surface) — this keeps existing tests that bind only a runtime
        row working and matches the session service's fallback 1:1. Returns
        ``None`` only when the runtime row is missing entirely.
        """
        # A1（去重，2026-07-24 代码健壮性优化）：委托 session.service 的单一真相源
        # （逻辑完全一致，含 D-007 migration window fallback），避免两份实现演进漂移。
        from app.modules.daemon.session.service import _resolve_daemon_id_for_runtime

        return await _resolve_daemon_id_for_runtime(self._svc._session, runtime_id)

    # ── Dialog persistence helper ────────────────────────────────────────────

    async def _upsert_dialog_row(self, payload: PermissionRequestPayload) -> SessionDialogRequest:
        """Idempotently persist a pending dialog row keyed by ``request_id``.

        A daemon replay (same request_id sent twice) must not fork a second
        pending card, so we look up by the unique ``request_id`` first and
        refresh the mutable fields in place rather than inserting a duplicate.
        The row is committed immediately so a concurrent REST ``response``
        call (different request, same DB session) sees it.
        """
        assert payload.dialog_kind is not None  # caller guarantees this
        session = self._svc._session
        existing = (
            await session.execute(
                select(SessionDialogRequest).where(
                    SessionDialogRequest.request_id == payload.request_id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            # Refresh mutable fields in case the daemon re-sent with updated
            # payload; keep status/answer untouched (a pending replay must not
            # clobber an in-flight or already-answered row).
            existing.dialog_payload = payload.dialog_payload
            existing.run_id = payload.run_id
            existing.session_id = payload.session_id
            existing.tool_name = payload.tool_name
            existing.dialog_kind = payload.dialog_kind
            await session.commit()
            await session.refresh(existing)
            return existing
        row = SessionDialogRequest(
            session_id=payload.session_id,
            run_id=payload.run_id,
            request_id=payload.request_id,
            tool_name=payload.tool_name,
            dialog_kind=payload.dialog_kind,
            dialog_payload=payload.dialog_payload,
            status="pending",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row

    async def list_pending_dialogs(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> list[SessionDialogRead]:
        """Return pending dialog requests for a session (page-refresh recovery).

        Ownership is enforced via ``_get_owned_session_for_update`` so a
        cross-user session surfaces as 404 without existence leak, mirroring
        the rest of the daemon REST surface.
        """
        # Read-only ownership check (the lock is harmless for a GET and keeps
        # the helper self-contained; we commit immediately to release it).
        # 2026-09-01-session-group-chat task-02 / design §5.3：群会话（kind='group'）
        # 参与者制分支经 _get_owned_session_for_update 内部继承（成员表命中 →
        # workspace admin → 404 不泄露存在性）；群/影子会话 manual_approval 恒
        # 关（首期审批不进群，§9.1），本路径仅防漏兜底。
        await self._svc._get_owned_session_for_update(session_id, user_id)
        await self._svc._session.commit()

        rows = (
            (
                await self._svc._session.execute(
                    select(SessionDialogRequest)
                    # ql-20260815-003 读侧兜底：run 已终态（恢复路径之外的终止方式，
                    # 如普通 stream 收尾/kill）的 pending 卡不出现在刷新恢复列表——
                    # 卡片已无人等待应答，展示只会引导用户点出报错。
                    # list_dialog_history 不带此过滤（历史展示保留全量）。
                    .join(AgentRun, AgentRun.id == SessionDialogRequest.run_id)
                    .where(
                        SessionDialogRequest.session_id == session_id,
                        SessionDialogRequest.status == "pending",
                        col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
                    )
                    .order_by(SessionDialogRequest.created_at)
                )
            )
            .scalars()
            .all()
        )
        return [SessionDialogRead.from_model(r) for r in rows]

    async def list_dialog_history(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> list[SessionDialogRead]:
        """Return the dialog Q&A history for a session (pending + answered, newest capped).

        Unlike ``list_pending_dialogs`` (page-refresh recovery, pending only),
        this returns the AskUserQuestion Q&A history so the interactive
        session panel can render past questions and answers even after the live
        card is resolved or the session has ended/failed. Ownership enforced
        the same way (cross-user → 404, no existence leak).

        ql-20260826-012：原「Return ALL」无界全量加载（会话越久 Q&A 越多，
        每次打开会话面板全量拉 ORM 实体）——固定取最近 ``_DIALOG_HISTORY_MAX``
        条再反转为创建序（面板渲染从旧到新，行为不变；仅超出上限的远古
        Q&A 不再返回）。
        """
        # Read-only ownership check (same as list_pending_dialogs).
        # 2026-09-01-session-group-chat task-02：群会话参与者制分支同经
        # _get_owned_session_for_update 继承（见 list_pending_dialogs 注释）。
        await self._svc._get_owned_session_for_update(session_id, user_id)
        await self._svc._session.commit()

        rows = (
            (
                await self._svc._session.execute(
                    select(SessionDialogRequest)
                    .where(SessionDialogRequest.session_id == session_id)
                    .order_by(SessionDialogRequest.created_at.desc())
                    .limit(_DIALOG_HISTORY_MAX)
                )
            )
            .scalars()
            .all()
        )
        rows.reverse()  # 恢复创建序（旧 → 新），与原全量加载的展示顺序一致
        return [SessionDialogRead.from_model(r) for r in rows]

    # ── Workspace-level read: GET /api/workspaces/{id}/dialogs（task-02 / D-001 只读）──

    async def list_pending_dialogs_for_workspace(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[WorkspaceDialogRead]:
        """聚合 workspace 下所有 session 的 pending ``SessionDialogRequest``（只读）。

        供审批中心 ``/approvals`` 的 ``GET /api/workspaces/{id}/dialogs`` 端点兜底
        + 刷新不丢（design §4.1 / FR-5）。JOIN 路径逐字参照
        ``agent.service.list_workspace_active_sessions``（service.py:798-806）：

            SessionDialogRequest
              → AgentRun          (on AgentRun.id == SessionDialogRequest.run_id)
              → AgentRunWorkspace (on AgentRunWorkspace.agent_run_id == AgentRun.id)
            where AgentRunWorkspace.workspace_id == workspace_id
              and SessionDialogRequest.status == "pending"

        来源上下文（D-002 / D-003，全可空）：
          - ``session_type``：``AgentRun.change_id`` 非空→``stage``；
            ``AgentSession.config["mode"]=="scan"`` 且 change_id 空→``scan``；其余→``chat``。
          - ``run_summary``：scan/stage 取 ``DaemonTaskLease.metadata_["prompt"]``；
            chat 取首条 ``channel=="user"`` 的 ``AgentRunLog.content_redacted``
            （``LIMIT 1 ORDER BY timestamp DESC``）；取不到→None。
          - ``workspace_name``：经 workspace_id 查 ``Workspace.name``。

        纯读路径（D-001）：无 commit / 无写库 / 无 SSE publish。workspace 成员校验由
        router 层 ``require_permission(TASK_READ)`` 完成；``user_id`` 仅留接口位以备日志/审计。
        空 workspace（无 pending dialog）返回 ``[]``。
        """
        from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
        from app.modules.daemon.model import DaemonTaskLease
        from app.modules.workspace.model import AgentRunWorkspace, Workspace

        session = self._svc._session

        # ── 主 JOIN：pending dialog + AgentRun（带 change_id / lease_id / session 引用）──
        stmt = (
            select(SessionDialogRequest, AgentRun)
            .join(AgentRun, AgentRun.id == SessionDialogRequest.run_id)
            .join(AgentRunWorkspace, AgentRunWorkspace.agent_run_id == AgentRun.id)
            .where(
                AgentRunWorkspace.workspace_id == workspace_id,
                SessionDialogRequest.status == "pending",
                # ql-20260815-003 读侧兜底（与 session 级 list_pending_dialogs 同款）：
                # run 已终态的孤儿 pending 卡不进审批中心列表。
                col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
            )
            .order_by(SessionDialogRequest.created_at)
        )
        joined = (await session.execute(stmt)).all()
        if not joined:
            return []

        # ── workspace_name（单查询，整批共享）──
        ws = await session.get(Workspace, workspace_id)
        workspace_name = ws.name if ws is not None else None

        # ── 收集 run_id → AgentRun，按需批量反查 AgentSession（取 config.mode）──
        runs_by_id: dict[uuid.UUID, AgentRun] = {}
        for _, run in joined:
            runs_by_id.setdefault(run.id, run)
        session_ids = {r.agent_session_id for r in runs_by_id.values() if r.agent_session_id}
        session_cfg_mode: dict[uuid.UUID, str | None] = {}
        if session_ids:
            sess_rows = (
                await session.execute(
                    select(AgentSession.id, AgentSession.config).where(
                        AgentSession.id.in_(session_ids)
                    )
                )
            ).all()
            for sid, cfg in sess_rows:
                session_cfg_mode[sid] = (cfg or {}).get("mode")

        # ── scan/stage run 的 lease.metadata.prompt（按 lease_id 批量取）──
        lease_ids = {r.lease_id for r in runs_by_id.values() if r.lease_id is not None}
        lease_prompt: dict[uuid.UUID, str | None] = {}
        if lease_ids:
            lease_rows = (
                await session.execute(
                    select(DaemonTaskLease.id, DaemonTaskLease.metadata_).where(
                        DaemonTaskLease.id.in_(lease_ids)
                    )
                )
            ).all()
            for lid, meta in lease_rows:
                lease_prompt[lid] = (meta or {}).get("prompt") if isinstance(meta, dict) else None

        # Wave B（2026-07-25）：预推导 session_type + 批量查 chat 型 user log。
        # 原每 chat dialog 一次 SELECT AgentRunLog LIMIT 1 = N+1（N = chat 型 dialog 数）。
        session_types: list[str] = []
        chat_run_ids: list[uuid.UUID] = []
        for _row, _run in joined:
            is_stage = _run.change_id is not None
            mode = (
                session_cfg_mode.get(_run.agent_session_id)
                if _run.agent_session_id is not None
                else None
            )
            if is_stage:
                session_types.append("stage")
            elif mode == "scan":
                session_types.append("scan")
            else:
                session_types.append("chat")
                chat_run_ids.append(_run.id)

        chat_summary: dict[uuid.UUID, str | None] = {}
        if chat_run_ids:
            # ORDER BY timestamp DESC：Python 端按 run_id 取首条（每 run 最新 user log）。
            for rid, content in (
                await session.execute(
                    select(AgentRunLog.run_id, AgentRunLog.content_redacted)
                    .where(
                        AgentRunLog.run_id.in_(chat_run_ids),
                        AgentRunLog.channel == "user",
                    )
                    .order_by(AgentRunLog.timestamp.desc())
                )
            ).all():
                if rid not in chat_summary:
                    chat_summary[rid] = content

        results: list[WorkspaceDialogRead] = []
        for idx, (row, run) in enumerate(joined):
            session_type = session_types[idx]
            # run_summary 推导（D-003，C2 修正）
            if session_type in ("scan", "stage"):
                run_summary = lease_prompt.get(run.lease_id) if run.lease_id is not None else None
            else:
                # chat：预取的最新 user log content_redacted。
                run_summary = chat_summary.get(run.id)

            results.append(
                WorkspaceDialogRead.from_model(
                    row,
                    workspace_id=workspace_id,
                    workspace_name=workspace_name,
                    session_type=session_type,
                    run_summary=run_summary,
                )
            )
        return results

    # ── REST downlink: POST .../permissions/{request_id}/response ────────────

    async def respond_permission(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        request_id: str,
        decision: Literal["allow", "deny"],
        message: str | None = None,
        dialog_result: dict | None = None,
    ) -> PermissionResponseRead:
        """REST response from the user: send PERMISSION_RESPONSE to the daemon.

        Two paths share this entry point (the REST surface is uniform so the
        frontend does not need to know which kind of card it is dismissing):

        * **Dialog** (``dialog_result`` is not None, or ``request_id`` matches a
          ``session_dialog_requests`` row): look up the persisted row, flip it
          to ``answered`` (404 if missing/unknown, 409 if already answered),
          send PERMISSION_RESPONSE carrying ``dialog_result``. No timer to
          cancel — dialogs are not timeout-enforced.

        * **Plain canUseTool approval**: the existing timer-based path.

        Validation order (shared):
          1. session owned by user (404 if not, no existence leak);
          2. session.status active; session.config.manual_approval is True;
          3. current run exists;
          4. resolve request_id → dialog row OR pending timer (404 otherwise);
          5. send WS downlink (504 if runtime offline), publish permission_resolved SSE.
        """
        session_obj = await self._svc._get_owned_session_for_update(session_id, user_id)
        # 2026-09-01-session-group-chat task-02 / design §5.3：群会话参与者制
        # 分支同经 _get_owned_session_for_update 继承（见 list_pending_dialogs
        # 注释）；群/影子会话 manual_approval 恒关，下方守卫天然兜底拒答。
        if (session_obj.status or "") not in ACTIVE_SESSION_STATUSES:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session_obj.status}).",
                details={"session_id": str(session_id), "status": session_obj.status},
            )
        config = session_obj.config or {}
        if config.get("manual_approval") is not True:
            raise DaemonPermissionManualDisabled(
                f"AgentSession '{session_id}' does not have manual_approval enabled.",
                details={"session_id": str(session_id)},
            )
        # Release the row lock ASAP — WS send / SSE publish are not DB work.
        await self._svc._session.commit()

        # ── Resolve request_id → dialog row OR plain-approval timer ────────
        # A dialog response is signalled either by the caller passing
        # ``dialog_result`` explicitly, or by a matching pending DB row. We
        # check the DB first because dialogs are the persistent case; a plain
        # approval has no row and falls through to the timer lookup.
        dialog_row = (
            await self._svc._session.execute(
                select(SessionDialogRequest).where(SessionDialogRequest.request_id == request_id)
            )
        ).scalar_one_or_none()
        if dialog_row is not None and dialog_row.status != "pending":
            # ql-20260815-003：终态（answered/cancelled）dialog 先于 current_run
            # 检查返回——run 已死时点孤儿卡给用户明确的 409/404 语义，而不是
            # 笼统的 no active run（_respond_dialog 对终态直接抛对应错误）。
            return await self._respond_dialog(
                session_obj=session_obj,
                dialog_row=dialog_row,
                decision=decision,
                message=message,
                dialog_result=dialog_result,
            )

        current_run = await self._svc._get_current_run(session_id)
        if current_run is None:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no active run to approve.",
                details={"session_id": str(session_id)},
            )

        if dialog_row is not None:
            return await self._respond_dialog(
                session_obj=session_obj,
                dialog_row=dialog_row,
                decision=decision,
                message=message,
                dialog_result=dialog_result,
            )

        # Plain canUseTool approval: request_id lifecycle via the in-memory timer.
        timer = self._timers.pop(request_id, None)
        if timer is None:
            # Either already resolved/timeout, or daemon never sent a matching
            # request (client race / stale card). 404 — caller should drop the card.
            raise DaemonPermissionNotFound(
                f"Permission request '{request_id}' not found (already resolved or unknown).",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        timer.cancel()

        if session_obj.runtime_id is None:
            # Should not happen for active sessions (placement bound), but guard.
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no runtime binding.",
                details={"session_id": str(session_id)},
            )

        ws_payload = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": decision,
        }
        if message is not None:
            ws_payload["message"] = message

        # task-06: WS hub routes by daemon_instance_id. Resolve the daemon
        # entity owning this runtime; migration-window fallback routes by
        # runtime_id (legacy surface). Resolve failure → 504.
        route_key = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        if route_key is None:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' not found; "
                f"permission response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )
        # task-04（design A2）：审批结果走控制指令三段式——落库 pending +
        # ``self._hub`` 推送（消息形状不变，payload 尾部注入 command_id）+
        # delivered 标记；WS 失败/不在线保持 pending 待 daemon 重连补拉。
        # 504 + re-arm timer 语义保持（补拉到达前 daemon 侧 fallback timer 兜底）。
        _row, sent = await ControlCommandService(self._svc._session).enqueue_and_push(
            daemon_id=route_key,
            runtime_id=session_obj.runtime_id,
            kind=KIND_PERMISSION_RESPONSE,
            payload=ws_payload,
            hub=self._hub,
        )
        if not sent:
            # Re-arm: the daemon fallback timer will still deny; surface 504 so
            # the frontend can prompt retry. Re-create a fresh 5min timer so a
            # subsequent retry against the same request_id (user re-clicks
            # after 504) still finds it in _timers and can attempt another
            # send instead of getting a 404 (P1-2 fix: the previous code
            # popped the timer above and never re-inserted it, making the
            # 504-retry path dead — user could never re-respond). The old
            # timer was already cancelled above; create a new task so the
            # timeout enforcer stays live for the retry window.
            self._timers[request_id] = asyncio.create_task(
                self._on_timeout(session_id, current_run.id, request_id, session_obj.runtime_id)
            )
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' offline; "
                f"permission response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "daemon_id": str(route_key),
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )

        await self._svc._publish_session_event(
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": decision,
                "reason": "manual",
            },
        )
        log.info(
            "permission_response_sent",
            session_id=str(session_id),
            request_id=request_id,
            decision=decision,
        )
        return PermissionResponseRead(
            session_id=session_id,
            request_id=request_id,
            decision=decision,
            accepted=True,
        )

    async def _respond_dialog(
        self,
        *,
        session_obj: Any,
        dialog_row: SessionDialogRequest,
        decision: Literal["allow", "deny"],
        message: str | None,
        dialog_result: dict | None,
    ) -> PermissionResponseRead:
        """Dialog branch of ``respond_permission`` (persisted, no timer)."""
        session_id = dialog_row.session_id
        request_id = dialog_row.request_id

        if dialog_row.status == "answered":
            raise DaemonDialogAlreadyResolved(
                f"Dialog request '{request_id}' was already answered.",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        if dialog_row.status == "cancelled":
            raise DaemonDialogNotFound(
                f"Dialog request '{request_id}' was cancelled.",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        if session_obj.runtime_id is None:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no runtime binding.",
                details={"session_id": str(session_id)},
            )

        ws_payload: dict[str, object] = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": decision,
        }
        if message is not None:
            ws_payload["message"] = message
        if dialog_result is not None:
            ws_payload["dialog_result"] = dialog_result

        # task-06: WS hub routes by daemon_instance_id (migration-window
        # fallback routes by runtime_id). Resolve before sending.
        route_key = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        # task-04（design A2）：dialog 应答同走控制指令三段式（kind 仍
        # permission_response，payload 携 dialog_result 不变）；失败保持
        # pending 待补拉，DB 行不翻 answered（下方 sent 检查语义保持）。
        sent = False
        if route_key is not None:
            _row, sent = await ControlCommandService(self._svc._session).enqueue_and_push(
                daemon_id=route_key,
                runtime_id=session_obj.runtime_id,
                kind=KIND_PERMISSION_RESPONSE,
                payload=ws_payload,
                hub=self._hub,
            )
        if not sent:
            # Dialogs have no backend timeout to re-arm; surface 504 so the
            # frontend can retry. The DB row stays pending (untouched below)
            # so a retry against the same request_id is idempotent.
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' offline; "
                f"dialog response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "daemon_id": str(route_key) if route_key is not None else None,
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )

        # Flip the row to answered only after the WS send succeeded — a 504
        # must leave the dialog pending so the user can retry.
        dialog_row.status = "answered"
        dialog_row.answer = dialog_result
        dialog_row.answered_at = datetime.now(UTC)
        # answered_by is set by the caller via the user_id; threaded through
        # session_obj would require an extra param, so we read it off the
        # owned session's user_id (already validated upstream).
        dialog_row.answered_by = session_obj.user_id
        await self._svc._session.commit()

        await self._svc._publish_session_event(
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": decision,
                "reason": "manual",
                "dialog_kind": dialog_row.dialog_kind,
            },
        )
        log.info(
            "dialog_response_sent",
            session_id=str(session_id),
            request_id=request_id,
            decision=decision,
            dialog_kind=dialog_row.dialog_kind,
        )
        return PermissionResponseRead(
            session_id=session_id,
            request_id=request_id,
            decision=decision,
            accepted=True,
        )

    # ── owner 定向通知（task-06 / FR-06 / §7.3③，best-effort 旁路）──────────

    async def _notify_session_owner(
        self,
        *,
        owner_id: uuid.UUID,
        workspace_id: uuid.UUID | None,
        type: str,
        title: str,
        body: str,
        ref_type: str,
        ref_id: str,
        request_id: str,
    ) -> None:
        """向会话 owner（AgentSession.user_id，D-010@v1）定向发通知。

        best-effort（D-001@v1 旁路原则）：任何异常仅 log.warning，不影响
        权限请求登记 / 超时回调既有行为。``workspace_id`` 为 None（会话未绑
        workspace，通知模型 workspace 必填）时跳过并 log.info。
        """
        if owner_id is None or workspace_id is None:
            log.info(
                "permission_owner_notify_skipped_no_context",
                type=type,
                ref_type=ref_type,
                ref_id=ref_id,
                request_id=request_id,
                has_owner=owner_id is not None,
            )
            return
        try:
            from app.modules.notification.service import NotificationService

            await NotificationService(self._svc._session).notify_user(
                workspace_id=workspace_id,
                recipient_user_id=owner_id,
                type=type,
                title=title,
                body=body,
                # 会话面板深链（sessions-portal.tsx:134 ?session= 参数）——点击通知
                # 直达对应会话的提问/权限卡片；ref_id 即 session_id。
                link=f"/sessions?session={ref_id}",
                ref_type=ref_type,
                ref_id=ref_id,
            )
        except Exception:
            log.warning(
                "permission_owner_notify_failed",
                type=type,
                ref_type=ref_type,
                ref_id=ref_id,
                request_id=request_id,
                owner_user_id=str(owner_id),
            )

    # ── Timeout enforcer ─────────────────────────────────────────────────────

    async def _on_timeout(
        self,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
        request_id: str,
        runtime_id: uuid.UUID | None,
    ) -> None:
        """5min elapsed with no user response → auto-deny (D-007@v1 fail-closed).

        Best-effort: send PERMISSION_RESPONSE(deny) via ws_hub + publish
        ``permission_resolved{reason:timeout}`` SSE so the frontend card can
        dismiss. Either failure is logged but not raised — the daemon-side
        fallback timer is the ultimate fail-closed safety net.
        """
        try:
            await asyncio.sleep(self._timeout_sec)
        except asyncio.CancelledError:
            # User responded in time → respond_permission already popped the timer.
            return

        # Pop self from _timers (it may have been replaced by a re-armed entry
        # after an offline retry; only delete if still us).
        current = self._timers.get(request_id)
        if current is not None and current.done() is False and current is asyncio.current_task():
            self._timers.pop(request_id, None)

        # task-06（2026-08-29-approval-notify-push / FR-06 / §7.3③）：超时失效
        # 时向 owner 发 permission_timeout 通知。回调只收请求 id → 重查会话行
        # 取 owner（D-010@v1：AgentSession.user_id）。本回调后续 ControlCommand
        # 落库本就使用 self._svc._session，owner 重查同源复用（既有惯例优先于
        # 新开短 session）。best-effort：失败仅 log.warning（D-001@v1）。
        # v1 取舍 R-09：不消解历史 permission_request 通知。
        try:
            from app.modules.agent.model import AgentSession as _AgentSession

            sess_row = (
                await self._svc._session.execute(
                    select(_AgentSession).where(_AgentSession.id == session_id)
                )
            ).scalar_one_or_none()
        except Exception:
            log.warning(
                "permission_timeout_owner_lookup_failed",
                session_id=str(session_id),
                request_id=request_id,
            )
            sess_row = None
        if sess_row is not None:
            session_label = sess_row.title or str(session_id)[:8]
            timeout_title = f"会话「{session_label}」权限请求已超时失效"
            await self._notify_session_owner(
                owner_id=sess_row.user_id,
                workspace_id=sess_row.workspace_id,
                type="permission_timeout",
                title=timeout_title,
                body=None,
                ref_type="session_permission",
                ref_id=str(session_id),
                request_id=request_id,
            )

        ws_payload = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": "deny",
            "message": "permission request timed out (5min)",
        }
        # task-06: WS hub routes by daemon_instance_id (migration-window
        # fallback routes by runtime_id).
        route_key = (
            await self._resolve_daemon_id_for_runtime(runtime_id)
            if runtime_id is not None
            else None
        )
        if route_key is None:
            log.warning(
                "permission_timeout_no_runtime",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(runtime_id) if runtime_id is not None else None,
            )
            # Still publish the timeout SSE so the frontend card dismisses.
            await self._svc._publish_session_event(
                session_id,
                {
                    "event": "permission_resolved",
                    "session_id": str(session_id),
                    "request_id": request_id,
                    "decision": "deny",
                    "reason": "timeout",
                },
            )
            return
        # task-04（design A2）：超时 deny 同走控制指令三段式——WS 失败落库
        # pending 待补拉（daemon 断线窗口内 deny 不丢，重连补拉送达后
        # fail-closed 语义仍成立）；send 失败仅告警的既有语义保持。
        _row, sent = await ControlCommandService(self._svc._session).enqueue_and_push(
            daemon_id=route_key,
            runtime_id=runtime_id,
            kind=KIND_PERMISSION_RESPONSE,
            payload=ws_payload,
            hub=self._hub,
        )
        if not sent:
            log.warning(
                "permission_timeout_send_failed",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(runtime_id),
                daemon_id=str(route_key),
            )

        await self._svc._publish_session_event(
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": "deny",
                "reason": "timeout",
            },
        )
        log.warning(
            "permission_request_timed_out",
            session_id=str(session_id),
            run_id=str(run_id),
            request_id=request_id,
            delivered=sent,
        )
