"""Session subdomain service —— agent session lifecycle（task-08 拆分包壳）。

原 7176 行单文件 ``session/service.py`` 按域拆为 14 文件包（design §5
Wave 2 / D-005@v3 / D-006）：errors（异常族）/ results（结果对象 + readiness
单例）/ helpers（模块级 + 实例级共享 helper）/ create（创建写事务编排）/
attachments（附件管线）/ ppm_activation（PPM 物化 + 懒激活）/ inject +
inject_gates（注入簇核心 + 校验门控）/ queue（排队）/ control（中断/结束/
控制指令下发）/ recovery（恢复/挂起/重连）/ read_model（读模型）/
session_lifecycle（生命周期）。本 ``__init__`` 是兼容层：

- ``SessionService`` 类壳保留全部方法签名，方法体一行委托到子模块函数
  （第一参数传 service 实例）；导入路径
  ``from app.modules.daemon.session.service import SessionService`` 零变化；
- 聚合重导出拆前命名空间的全部被消费符号（task-06 基线 47 符号，含 6 个
  私有符号——run_sync/service.py 顶部多行 import 依赖的
  ``_apply_session_terminal_status`` / ``_send_session_end_best_effort`` 等）。

D-010 第二回合（merge main 2ad590192，2026-09-07-session-pin-rename-
scheduled-send）：+scheduled_messages 子模块（定时消息 CRUD 三方法——queue.py
725 行加 235 超 ≤800 故独立成域）；pin/unpin/rename 三方法进 session_lifecycle；
5 个新异常进 errors；置顶排序进 read_model；常量
SCHEDULED_DISPATCH_MIN_LEAD_SEC 归本命名空间（D-007，子模块经 _svc 取值）。

patch 兼容（D-007，本拆分最高风险点）：本命名空间保留 ``get_redis`` /
``publish_sessions_changed`` / ``log`` / ``SessionService`` /
``_merge_lease_metadata`` / ``get_session_readiness`` 绑定；子模块内一律
``import app.modules.daemon.session.service as _svc`` 后 ``_svc.<符号>`` 延迟
解析，既有 patch("app.modules.daemon.session.service.<sym>") 69 处 + 别名
setattr 全部继续拦截。定义于本模块的常量（ACTIVE_*_STATUSES /
TERMINAL_TURN_STATUSES / RECONNECTING_RETRY_WINDOW_SEC / DAEMON_*_ERROR_CODE /
DAEMON_MSG_SESSION_SWITCH_CONFIG）同理由子模块经 ``_svc.`` 取值。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

# D-007 patch 绑定：51 个测试文件以 patch/别名 setattr 替换本命名空间属性，
# 子模块经 _svc.get_redis() 延迟解析（59 处 patch + 1 处 mp.setattr）。
from app.core.redis import get_redis
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
    AgentSessionScheduledMessage,
)

# D-007 patch 绑定（原 :49 顶层 import）：test_session_service 等 7 处以
# patch("...session.service.allowed_workspace_ids") 拦截，inject_gates 消费点经
# _svc.allowed_workspace_ids 延迟解析。
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.daemon import _background_tasks as _bg_tasks
from app.modules.daemon._background_tasks import BackgroundTaskMixin
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import (  # noqa: F401 —— 委托签名注解用
    PageContextCreateBlock,
    PlanResponseDecision,
    ScheduledMessageCreateRequest,
    SessionReopenResponse,
    SessionUsageModelItemRead,
    SessionUsageRead,
    TeamMissionCreateBlock,
)

# task-02（2026-08-24-sessions-live-updates / design §1.1）：agent_sessions 列表
# 变更信号发布入口。test_session_events.py:139 以别名 setattr patch 本命名空间
# （注释明示「顶部 from ... import 把名字绑进自身命名空间」），子模块调用点经
# _svc.publish_sessions_changed 延迟解析（D-007）。
from app.modules.daemon.session_events import publish_sessions_changed
from app.modules.ppm.common.session_binding import PpmItemKind
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask

log = get_logger(__name__)

# task-05（2026-08-14-sessions-portal / D-012@v1 / FR-05）：会话内配置热切换 WS
# 控制消息（Server → Daemon），原子承载「切换档案/供应商 + 切换轮 prompt」。
# 命名遵循 protocol.py 常量族 ``daemon:session_*`` 约定（与 sillyhub-daemon
# src/protocol.ts MSG.SESSION_* 逐字对齐，daemon 侧路由归 task-09）。常量留本
# 命名空间，子模块经 _svc.<名> 取值（D-007 同规则）。
DAEMON_MSG_SESSION_SWITCH_CONFIG = "daemon:session_switch_config"


ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
# P2（2026-08-25 会话路径二审 #3）：词表单源化——真实定义在 ``agent.model.
# ACTIVE_RUN_STATUSES``（叶子模块，各消费方 import 方向安全），本名保留为
# 别名供既有导入方（permission_service / daemon.service facade）零改动。
ACTIVE_TURN_STATUSES = ACTIVE_RUN_STATUSES
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})

# DS-4 / DS-5 / DS-6（2026-08-21-session-reopen-resume）：reconnecting 手动重试
# 窗口秒数（基准 ``session.last_active_at``，两路径翻转 reconnecting 时均写 now）。
# 唯一落点：reopen 前置校验（session_lifecycle）与 sweeper 巡检收敛均 import
# 本常量，勿在别处重复定义。
RECONNECTING_RETRY_WINDOW_SEC = 180

# 2026-08-29-daemon-platform-resilience task-05（design A5 / FR-04）：daemon 优雅
# 停止时中断轮 run 的收敛错误码（与 recover 路径的 ``daemon_restarted`` 区分
# 优雅停止 vs 崩溃重启两条挂起来源）；唯一写入点 suspend_sessions_for_daemon。
DAEMON_STOPPED_ERROR_CODE = "daemon_stopped"

# 2026-08-29-batch-session-inherit task-01（design S1 / FR-01 / D-005@v1）：daemon
# 掉线中断 **worker 子会话**（``parent_session_id`` 非空）的收敛错误码——与主会话
# 的 ``daemon_stopped`` 区分来源：worker 是临时会话无用户手恢复，改判 failed 落
# 本码作自动重派（--resume 继承原会话）的种子标识。
DAEMON_INTERRUPTED_ERROR_CODE = "daemon_interrupted"

# task-03 / FR-04（2026-09-07-session-pin-rename-scheduled-send，D-010 第二回合
# 自 main 移植）：定时消息最小提前量（秒）——``dispatch_at`` 必须 ≥
# now(UTC)+60s 才接受创建（design §总体方案 Wave 2「防刚建即过期竞态」）。
# main 原定义于单文件模块级（定时消息异常族之后）；拆分包形态下归本命名空间，
# scheduled_messages 子模块经 ``_svc.`` 延迟解析（D-007 同
# RECONNECTING_RETRY_WINDOW_SEC 惯例）。
SCHEDULED_DISPATCH_MIN_LEAD_SEC = 60

# ── 聚合重导出（import 面 + patch 面，D-006/D-007）─────────────────────────
from .errors import (  # noqa: E402
    DaemonOffline,
    DaemonScheduledMessageDispatchTooSoon,
    DaemonScheduledMessageNotFound,
    DaemonScheduledMessageNotPending,
    DaemonScheduledMessageSessionInactive,
    DaemonSessionAttachmentInvalid,
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionConfigInvalid,
    DaemonSessionInvariantViolation,
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionQueueEntryNotEditable,
    DaemonSessionQueueEntryNotFound,
    DaemonSessionQueueFull,
    DaemonSessionQueueOrderMismatch,
    DaemonSessionResumeUnsupported,
    DaemonSessionRuntimeNotFound,
    DaemonSessionRuntimeUnavailable,
    DaemonSessionTeamMissionInvalid,
    DaemonSessionTitleInvalid,
    DaemonSessionTurnConflict,
    DaemonSessionWorkspaceNotFound,
    SessionEmptyPrompt,
    ToolReportActivateNoDaemon,
)
from .helpers import (  # noqa: E402
    TASK_WAKEUP_PROMPT_PREFIX,
    _apply_session_terminal_status,
    _merge_lease_metadata,
    _prepend_group_chain_marker,
    _resolve_daemon_id_for_runtime,
    _send_session_end_best_effort,
    _split_group_chain_marker,
)
from .queue import dispatch_next_queued_message  # noqa: E402
from .results import (  # noqa: E402
    SessionControlResult,
    SessionDispatchResult,
    SessionReadiness,
    SessionRecoveryResult,
    SuspendBatchResult,
    _PrelockedInjectAttachments,
    _PreparedPpmAttachment,
    get_session_readiness,
)

# 导出面清单（task-06 基线 47 符号 + patch 专用绑定 + 私有符号保位项）——
# ``__all____`` 显式声明兼容面，杜绝子模块内部符号意外泄漏 / 遗漏。
__all__ = [
    # 常量（9；D-010 二回合 +SCHEDULED_DISPATCH_MIN_LEAD_SEC）
    "ACTIVE_SESSION_STATUSES",
    "ACTIVE_TURN_STATUSES",
    "DAEMON_INTERRUPTED_ERROR_CODE",
    "DAEMON_MSG_SESSION_SWITCH_CONFIG",
    "DAEMON_STOPPED_ERROR_CODE",
    "RECONNECTING_RETRY_WINDOW_SEC",
    "SCHEDULED_DISPATCH_MIN_LEAD_SEC",
    "TASK_WAKEUP_PROMPT_PREFIX",
    "TERMINAL_TURN_STATUSES",
    # 异常族（29；D-010 二回合 +定时消息 4 + rename 1）
    "DaemonOffline",
    "DaemonRuntimeOffline",
    "DaemonScheduledMessageDispatchTooSoon",
    "DaemonScheduledMessageNotFound",
    "DaemonScheduledMessageNotPending",
    "DaemonScheduledMessageSessionInactive",
    "DaemonSessionAttachmentInvalid",
    "DaemonSessionAttachmentsUnsupported",
    "DaemonSessionConfigInvalid",
    "DaemonSessionInvariantViolation",
    "DaemonSessionLlmProviderKindMismatch",
    "DaemonSessionLlmProviderNotFound",
    "DaemonSessionNoAgentSession",
    "DaemonSessionNoCurrentRun",
    "DaemonSessionNotActive",
    "DaemonSessionNotFound",
    "DaemonSessionQueueEntryNotEditable",
    "DaemonSessionQueueEntryNotFound",
    "DaemonSessionQueueFull",
    "DaemonSessionQueueOrderMismatch",
    "DaemonSessionResumeUnsupported",
    "DaemonSessionRuntimeNotFound",
    "DaemonSessionRuntimeUnavailable",
    "DaemonSessionTeamMissionInvalid",
    "DaemonSessionTitleInvalid",
    "DaemonSessionTurnConflict",
    "DaemonSessionWorkspaceNotFound",
    # 结果对象 + readiness（6）
    "SessionControlResult",
    "SessionDispatchResult",
    "SessionEmptyPrompt",
    "SessionReadiness",
    "SessionRecoveryResult",
    # 服务类 + 后台派发入口（2）
    "SessionService",
    "SuspendBatchResult",
    "ToolReportActivateNoDaemon",
    # 私有符号保位（6，R-04——run_sync 顶部 import 与跨文件 lazy import 消费）
    "_apply_session_terminal_status",
    "_merge_lease_metadata",
    "_prepend_group_chain_marker",
    "_resolve_daemon_id_for_runtime",
    "_send_session_end_best_effort",
    "_split_group_chain_marker",
    # patch 专用绑定（4，D-007——无 import 消费但测试 patch/别名 setattr 目标）
    "allowed_workspace_ids",
    "dispatch_next_queued_message",
    "get_redis",
    "get_session_readiness",
    "log",
    "publish_sessions_changed",
]

# ── 子模块（import 即注册；SessionService 类壳在其后定义）──────────────────
from . import attachments as _attachments  # noqa: E402
from . import control as _control  # noqa: E402
from . import create as _create  # noqa: E402
from . import helpers as _helpers  # noqa: E402
from . import inject as _inject  # noqa: E402
from . import inject_gates as _inject_gates  # noqa: E402
from . import ppm_activation as _ppm_activation  # noqa: E402
from . import queue as _queue  # noqa: E402
from . import read_model as _read_model  # noqa: E402
from . import recovery as _recovery  # noqa: E402
from . import scheduled_messages as _scheduled_messages  # noqa: E402
from . import session_lifecycle as _session_lifecycle  # noqa: E402


class SessionService(BackgroundTaskMixin):
    """AgentSession 生命周期子域 service（task-05 / design §5.2；task-08 拆分）。

    类壳保留全部方法签名（公共签名逐一不变），方法体一行委托到子模块函数
    （第一参数传 service 实例——``self._session`` 经 ``svc._session`` 显式传参）。
    session 不持 facade 引用：跨域调用是 ``agent.placement.RunPlacementService``
    与 ``daemon.ws_hub``（函数级 lazy import），不调 daemon 其他子 service
    （design §7.2 / D-006）。
    """

    _LIST_STATUSES = frozenset({"pending", "active", "reconnecting", "ended", "failed"})

    # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收（每宿主类各持一份，
    # 与 RunSyncService 的集合互不串扰）
    _background_tasks: set[asyncio.Task] = set()

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Background task lifecycle helpers（2026-08-31-session-queue-ux task-03
    # / D-008——供 confirm_session_reconnected 恢复钩子 fire 派发。派发协程走
    # dispatch_next_queued_message 的独立 DB session（H1），不复用请求级
    # session。task-11 轻重构③：``_fire_background_task`` 已收敛进共享 mixin
    # （daemon/_background_tasks.py，与 RunSyncService 单源，原逐字节相同实现
    # 删除）；``_on_background_task_done`` 的 staticmethod 表面是既有测试契约
    # （test_run_sync_fire_background_task 断言 getattr_static + ``(task)`` 签名），
    # 保留两行壳、核心经共享函数 discard 本类集合并按本模块 log 记日志。
    # ────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _on_background_task_done(task: asyncio.Task) -> None:
        """Remove task from the tracking set and surface exceptions."""
        _bg_tasks.on_background_task_done(SessionService, task)

    # ── 一行委托（方法体下沉子模块；签名与拆前逐一相同）─────────────────────

    async def _get_owned_session_for_update(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        return await _helpers._get_owned_session_for_update(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def _get_session_by_runtime_owner_for_update(
        self,
        session_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> AgentSession:
        return await _helpers._get_session_by_runtime_owner_for_update(
            self,
            session_id=session_id,
            owner_user_id=owner_user_id,
        )

    async def _get_current_run(
        self,
        session_id: uuid.UUID,
    ) -> AgentRun | None:
        return await _helpers._get_current_run(
            self,
            session_id=session_id,
        )

    async def _publish_session_event(
        self,
        session_id: uuid.UUID,
        payload: dict[str, object],
    ) -> None:
        return await _helpers._publish_session_event(
            self,
            session_id=session_id,
            payload=payload,
        )

    async def _resolve_runtime_labels(
        self,
        runtime_id: uuid.UUID,
    ) -> tuple[str | None, str | None]:
        return await _helpers._resolve_runtime_labels(
            self,
            runtime_id=runtime_id,
        )

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
        runtime_id: str | None = None,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        team_mission: TeamMissionCreateBlock | None = None,
        page_context: PageContextCreateBlock | None = None,
        quicklog_id: str | None = None,
        ppm_item_kind: PpmItemKind | None = None,
        ppm_item_id: uuid.UUID | None = None,
        parent_session_id: uuid.UUID | None = None,
        stage: str | None = None,
        first_run_mission_id: uuid.UUID | None = None,
        first_run_role: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> SessionDispatchResult:
        return await _create.create_session(
            self,
            user_id=user_id,
            provider=provider,
            prompt=prompt,
            model=model,
            manual_approval=manual_approval,
            ask_user_only=ask_user_only,
            change_id=change_id,
            workspace_id=workspace_id,
            runtime_id=runtime_id,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            team_mission=team_mission,
            page_context=page_context,
            quicklog_id=quicklog_id,
            ppm_item_kind=ppm_item_kind,
            ppm_item_id=ppm_item_id,
            parent_session_id=parent_session_id,
            stage=stage,
            first_run_mission_id=first_run_mission_id,
            first_run_role=first_run_role,
            attachment_ids=attachment_ids,
        )

    async def _materialize_ppm_attachments(
        self,
        *,
        user_id: uuid.UUID,
        kind: PpmItemKind,
        item_id: uuid.UUID,
        provider: str,
        manual_attachments: list,
        item: PlanTask | PpmProblemList | None = None,
    ) -> tuple[list[str], list[_PreparedPpmAttachment]]:
        return await _ppm_activation._materialize_ppm_attachments(
            self,
            user_id=user_id,
            kind=kind,
            item_id=item_id,
            provider=provider,
            manual_attachments=manual_attachments,
            item=item,
        )

    async def _converge_failed_dispatch(
        self,
        *,
        session: AgentSession,
        run: AgentRun,
        lease_id: uuid.UUID,
        error: str,
    ) -> None:
        return await _ppm_activation._converge_failed_dispatch(
            self,
            session=session,
            run=run,
            lease_id=lease_id,
            error=error,
        )

    async def _activate_tool_report_session(
        self,
        session: AgentSession,
        user_id: uuid.UUID,
        *,
        prompt: str,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
        prelocked_attachments: _PrelockedInjectAttachments | None = None,
    ) -> SessionDispatchResult:
        return await _ppm_activation._activate_tool_report_session(
            self,
            session=session,
            user_id=user_id,
            prompt=prompt,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            attachment_ids=attachment_ids,
            prelocked_attachments=prelocked_attachments,
        )

    async def _validate_inject_attachment_rows(
        self,
        *,
        session_id: uuid.UUID,
        session_user_id: uuid.UUID,
        session_provider: str,
        attachment_ids: list[uuid.UUID],
    ) -> list:
        return await _attachments._validate_inject_attachment_rows(
            self,
            session_id=session_id,
            session_user_id=session_user_id,
            session_provider=session_provider,
            attachment_ids=attachment_ids,
        )

    async def _resolve_inject_gate(
        self,
        *,
        user_id: uuid.UUID,
        gate_provider_id_basis: uuid.UUID | None,
        agent_kind: str,
    ) -> bool:
        return await _attachments._resolve_inject_gate(
            self,
            user_id=user_id,
            gate_provider_id_basis=gate_provider_id_basis,
            agent_kind=agent_kind,
        )

    async def _assemble_inject_attachment_payload(
        self,
        rows: list,
        *,
        supports_multimodal: bool,
    ) -> list[dict]:
        return await _attachments._assemble_inject_attachment_payload(
            self,
            rows=rows,
            supports_multimodal=supports_multimodal,
        )

    async def _preassemble_inject_attachments(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        llm_provider_id: str | None,
        attachment_ids: list[uuid.UUID] | None,
    ) -> _PrelockedInjectAttachments | None:
        return await _attachments._preassemble_inject_attachments(
            self,
            session_id=session_id,
            user_id=user_id,
            llm_provider_id=llm_provider_id,
            attachment_ids=attachment_ids,
        )

    async def inject_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        prompt: str,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        model: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
        page_context: PageContextCreateBlock | None = None,
        bind_change_key: str | None = None,
        bind_quick_id: str | None = None,
        bind_ppm_item_kind: PpmItemKind | None = None,
        bind_ppm_item_id: uuid.UUID | None = None,
        queue_when_busy: bool = False,
    ) -> SessionDispatchResult:
        return await _inject.inject_session(
            self,
            session_id=session_id,
            user_id=user_id,
            prompt=prompt,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            model=model,
            attachment_ids=attachment_ids,
            page_context=page_context,
            bind_change_key=bind_change_key,
            bind_quick_id=bind_quick_id,
            bind_ppm_item_kind=bind_ppm_item_kind,
            bind_ppm_item_id=bind_ppm_item_id,
            queue_when_busy=queue_when_busy,
        )

    async def inject_session_as_service(
        self,
        session_id: uuid.UUID,
        *,
        prompt: str,
        queue_when_busy: bool = False,
        queue_sender_user_id: uuid.UUID | None = None,
        turn_metadata: dict | None = None,
        busy_strategy: Literal["queue", "inject"] | None = None,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
        attachment_owner_user_id: uuid.UUID | None = None,
    ) -> SessionDispatchResult:
        return await _inject.inject_session_as_service(
            self,
            session_id=session_id,
            prompt=prompt,
            queue_when_busy=queue_when_busy,
            queue_sender_user_id=queue_sender_user_id,
            turn_metadata=turn_metadata,
            busy_strategy=busy_strategy,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            attachment_ids=attachment_ids,
            attachment_owner_user_id=attachment_owner_user_id,
        )

    async def _ensure_session_workspace_writable(
        self,
        session: AgentSession,
    ) -> None:
        return await _inject_gates._ensure_session_workspace_writable(
            self,
            session=session,
        )

    async def _inject_into_session(
        self,
        session: AgentSession,
        *,
        prompt: str,
        run_sender_user_id: uuid.UUID | None = None,
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        model: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
        attachment_owner_user_id: uuid.UUID | None = None,
        prelocked_attachments: _PrelockedInjectAttachments | None = None,
        page_context: PageContextCreateBlock | None = None,
        queue_when_busy: bool = False,
        busy_strategy: Literal["queue", "inject"] | None = None,
        queue_sender_user_id: uuid.UUID | None = None,
        turn_metadata: dict | None = None,
    ) -> SessionDispatchResult:
        return await _inject._inject_into_session(
            self,
            session=session,
            prompt=prompt,
            run_sender_user_id=run_sender_user_id,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            model=model,
            attachment_ids=attachment_ids,
            attachment_owner_user_id=attachment_owner_user_id,
            prelocked_attachments=prelocked_attachments,
            page_context=page_context,
            queue_when_busy=queue_when_busy,
            busy_strategy=busy_strategy,
            queue_sender_user_id=queue_sender_user_id,
            turn_metadata=turn_metadata,
        )

    async def _cancel_pending_control_command(
        self,
        command_id: uuid.UUID,
        *,
        run_id: uuid.UUID | None = None,
    ) -> None:
        return await _control._cancel_pending_control_command(
            self,
            command_id=command_id,
            run_id=run_id,
        )

    async def _inject_mid_turn_into_run(
        self,
        session: AgentSession,
        *,
        current_run: AgentRun,
        prompt: str,
        attachment_ids: list[uuid.UUID] | None = None,
        attachment_owner_user_id: uuid.UUID | None = None,
        turn_metadata: dict | None = None,
    ) -> SessionDispatchResult:
        return await _control._inject_mid_turn_into_run(
            self,
            session=session,
            current_run=current_run,
            prompt=prompt,
            attachment_ids=attachment_ids,
            attachment_owner_user_id=attachment_owner_user_id,
            turn_metadata=turn_metadata,
        )

    async def _send_interrupt_control(
        self,
        session: AgentSession,
        run_id: uuid.UUID | None = None,
    ) -> None:
        return await _control._send_interrupt_control(
            self,
            session=session,
            run_id=run_id,
        )

    async def interrupt_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionControlResult:
        return await _control.interrupt_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def end_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        reason: str = "manual",
        actor_runtime_owner_id: uuid.UUID | None = None,
    ) -> SessionControlResult:
        return await _control.end_session(
            self,
            session_id=session_id,
            user_id=user_id,
            reason=reason,
            actor_runtime_owner_id=actor_runtime_owner_id,
        )

    async def _fail_pending_queued_messages(
        self,
        session_id: uuid.UUID,
        error_msg: str,
    ) -> int:
        return await _queue._fail_pending_queued_messages(
            self,
            session_id=session_id,
            error_msg=error_msg,
        )

    async def list_queued_messages(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentSessionQueuedMessage]:
        return await _queue.list_queued_messages(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def delete_queued_message(
        self,
        session_id: uuid.UUID,
        entry_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _queue.delete_queued_message(
            self,
            session_id=session_id,
            entry_id=entry_id,
            user_id=user_id,
        )

    async def retry_queued_message(
        self,
        session_id: uuid.UUID,
        entry_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSessionQueuedMessage:
        return await _queue.retry_queued_message(
            self,
            session_id=session_id,
            entry_id=entry_id,
            user_id=user_id,
        )

    async def reorder_queued_messages(
        self,
        session_id: uuid.UUID,
        entry_ids: list[uuid.UUID],
        user_id: uuid.UUID,
    ) -> None:
        return await _queue.reorder_queued_messages(
            self,
            session_id=session_id,
            entry_ids=entry_ids,
            user_id=user_id,
        )

    async def update_queued_message(
        self,
        session_id: uuid.UUID,
        entry_id: uuid.UUID,
        prompt: str,
        user_id: uuid.UUID,
    ) -> AgentSessionQueuedMessage:
        return await _queue.update_queued_message(
            self,
            session_id=session_id,
            entry_id=entry_id,
            prompt=prompt,
            user_id=user_id,
        )

    async def dispatch_queued_message_now(
        self,
        session_id: uuid.UUID,
        entry_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        return await _queue.dispatch_queued_message_now(
            self,
            session_id=session_id,
            entry_id=entry_id,
            user_id=user_id,
        )

    async def dispatch_queued_messages(
        self,
        session_id: uuid.UUID,
    ) -> None:
        return await _queue.dispatch_queued_messages(
            self,
            session_id=session_id,
        )

    async def handle_plan_response(
        self,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
        decision: PlanResponseDecision,
        feedback: str | None,
        user_id: uuid.UUID,
    ) -> dict[str, bool]:
        return await _control.handle_plan_response(
            self,
            session_id=session_id,
            run_id=run_id,
            decision=decision,
            feedback=feedback,
            user_id=user_id,
        )

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
        return await _recovery.recover_session_after_daemon_restart(
            self,
            session_id=session_id,
            runtime_id=runtime_id,
            lease_id=lease_id,
            provider=provider,
            agent_session_id=agent_session_id,
            interrupted_run_id=interrupted_run_id,
        )

    async def _converge_crashed_run(
        self,
        *,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> Literal["failed"] | None:
        return await _recovery._converge_crashed_run(
            self,
            session_id=session_id,
            run_id=run_id,
        )

    async def _assert_no_other_active_run(
        self,
        *,
        session_id: uuid.UUID,
        excluded_run_id: uuid.UUID | None,
    ) -> None:
        return await _recovery._assert_no_other_active_run(
            self,
            session_id=session_id,
            excluded_run_id=excluded_run_id,
        )

    async def suspend_sessions_for_daemon(
        self,
        daemon_instance_id: uuid.UUID,
    ) -> SuspendBatchResult:
        return await _recovery.suspend_sessions_for_daemon(
            self,
            daemon_instance_id=daemon_instance_id,
        )

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID | None = None,
    ) -> str:
        return await _recovery.confirm_session_reconnected(
            self,
            session_id=session_id,
            runtime_id=runtime_id,
            lease_id=lease_id,
        )

    async def mark_session_recovery_failed(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        reason: str = "restore_failed",
        lease_id: uuid.UUID | None = None,
    ) -> str:
        return await _recovery.mark_session_recovery_failed(
            self,
            session_id=session_id,
            runtime_id=runtime_id,
            reason=reason,
            lease_id=lease_id,
        )

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
        workspace_id: uuid.UUID | None = None,
        change_id: uuid.UUID | None = None,
        ql_id: str | None = None,
        ppm_item_kind: PpmItemKind | None = None,
        ppm_item_id: uuid.UUID | None = None,
        archived: bool | None = False,
        session_kind: str | None = "chat",
    ) -> tuple[list[AgentSession], int]:
        return await _read_model.list_agent_sessions(
            self,
            user_id=user_id,
            limit=limit,
            offset=offset,
            status_filter=status_filter,
            runtime_id=runtime_id,
            machine_id=machine_id,
            provider=provider,
            q=q,
            workspace_id=workspace_id,
            change_id=change_id,
            ql_id=ql_id,
            ppm_item_kind=ppm_item_kind,
            ppm_item_id=ppm_item_id,
            archived=archived,
            session_kind=session_kind,
        )

    async def get_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        return await _read_model.get_agent_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def _heal_agent_session_id_from_runs(
        self,
        session: AgentSession,
    ) -> str | None:
        return await _read_model._heal_agent_session_id_from_runs(
            self,
            session=session,
        )

    async def reopen_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionReopenResponse:
        return await _session_lifecycle.reopen_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def delete_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _session_lifecycle.delete_agent_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def _end_session_for_delete(
        self,
        session: AgentSession,
    ) -> None:
        return await _session_lifecycle._end_session_for_delete(
            self,
            session=session,
        )

    async def archive_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _session_lifecycle.archive_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def unarchive_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _session_lifecycle.unarchive_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    # ── D-010 第二回合（merge main 2ad590192）：置顶/重命名 + 定时消息 CRUD ──

    async def pin_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _session_lifecycle.pin_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def unpin_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _session_lifecycle.unpin_session(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def rename_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        title: str,
    ) -> None:
        return await _session_lifecycle.rename_session(
            self,
            session_id=session_id,
            user_id=user_id,
            title=title,
        )

    async def list_scheduled_messages(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentSessionScheduledMessage]:
        return await _scheduled_messages.list_scheduled_messages(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def create_scheduled_message(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        data: ScheduledMessageCreateRequest,
    ) -> AgentSessionScheduledMessage:
        return await _scheduled_messages.create_scheduled_message(
            self,
            session_id=session_id,
            user_id=user_id,
            data=data,
        )

    async def cancel_scheduled_message(
        self,
        session_id: uuid.UUID,
        message_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await _scheduled_messages.cancel_scheduled_message(
            self,
            session_id=session_id,
            message_id=message_id,
            user_id=user_id,
        )

    async def update_ctx_window(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        ctx_window_tokens: int | None,
    ) -> None:
        return await _session_lifecycle.update_ctx_window(
            self,
            session_id=session_id,
            user_id=user_id,
            ctx_window_tokens=ctx_window_tokens,
        )

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        limit: int = 5000,
        after: datetime | None = None,
        before: datetime | None = None,
        q: str | None = None,
    ) -> list[AgentRunLog]:
        return await _read_model.get_agent_session_logs(
            self,
            session_id=session_id,
            user_id=user_id,
            limit=limit,
            after=after,
            before=before,
            q=q,
        )

    async def get_session_usage(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionUsageRead:
        return await _read_model.get_session_usage(
            self,
            session_id=session_id,
            user_id=user_id,
        )

    async def get_session_for_runtime_owner(
        self,
        session_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> AgentSession:
        return await _read_model.get_session_for_runtime_owner(
            self,
            session_id=session_id,
            actor_user_id=actor_user_id,
        )
