"""session 子域异常族（task-08 拆分，原 session/service.py:440-736 纯搬移）。

24 个 AppError 子类逐字保留（docstring 内任务编号注释同源）。经包
``__init__`` 聚合重导出，外部 ``from app.modules.daemon.session.service
import DaemonSessionNotActive`` 等导入语句零变化（D-006）。
"""

from __future__ import annotations

from app.core.errors import AppError


class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409


class DaemonSessionQueueFull(AppError):
    """会话排队消息满员（ql-20260825-011，后端真实排队）。

    pending 条目数达 ``SESSION_QUEUE_MAX_PENDING``（5）后再入队即拒——
    排队是「用户马上要接着说」的短队列，不是任务积压池。
    """

    code = "HTTP_409_DAEMON_SESSION_QUEUE_FULL"
    http_status = 409


class DaemonSessionQueueEntryNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_QUEUE_ENTRY_NOT_FOUND"
    http_status = 404


class DaemonSessionQueueOrderMismatch(AppError):
    """reorder 全量校验失败（2026-08-31-session-queue-ux FR-04 / D-003）。

    上传的 ``entry_ids`` 集合 ≠ 会话现有 pending+failed 条目全集（多 / 少 /
    含他会话条目 / 重复 id 均算）——reorder 只接受**全量**重排（部分重排
    语义歧义且易错，前端始终持有全量上传）；拖拽落手时条目恰被派发删除
    也走本分支（R-02，前端 catch 后 load 以服务端为准自然收敛）。
    """

    code = "HTTP_422_DAEMON_SESSION_QUEUE_ORDER_MISMATCH"
    http_status = 422


class DaemonSessionQueueEntryNotEditable(AppError):
    """排队条目不支持编辑（2026-08-31-session-queue-ux FR-06 / D-009）。

    「[后台任务通知]」系统通知条目（prompt 以 :data:`TASK_WAKEUP_PROMPT_PREFIX`
    开头）409 拒绝编辑——改文会破坏后续 wakeup 入队的前缀 like 去重匹配
    （ql-20260827-015 合并路径），导致通知重复入队。前端对这类条目隐藏 ✎
    （task-08），后端 409 双保险。
    """

    code = "HTTP_409_DAEMON_SESSION_QUEUE_ENTRY_NOT_EDITABLE"
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


class DaemonSessionNoCwd(AppError):
    """Session has an empty ``cwd`` — SDK resume cannot locate the transcript
    (DS-7, 2026-08-21-session-reopen-resume).

    Scan/bootstrap sessions are created without a ``cwd``
    (``agent/service.py`` scan path / ``spec_workspace/bootstrap.py``), and
    Claude transcripts live under ``projects/<encoded-cwd>/`` — an empty cwd
    can never resume. Reject reopen up front instead of letting the
    daemon-side SDK resume fail. The session is NOT mutated.
    """

    code = "HTTP_409_DAEMON_SESSION_NO_CWD"
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


# ── 2026-08-27-background-subagent-progress task-07：空 prompt 注入防御（FR-08
# / D-004@v1；生产实证 run c78044c8：空 prompt inject 产出 50ms 零输出空轮）──


class SessionEmptyPrompt(AppError):
    """inject 空 prompt（含全空白）拒绝：422 + 中文文案「消息内容不能为空」。

    领域错误按事件命名（IncidentNotFound 惯例，不带 Error 后缀）。豁免口径与
    :meth:`DaemonService.inject_session` 入口一致（口径单一来源在 service）：
    静默切换轮（ql-20260817-010）/ 附件看图说话轮（D-7）允许空 prompt，
    不受本错误影响。
    """

    code = "SESSION_EMPTY_PROMPT"
    http_status = 422


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


class DaemonSessionTitleInvalid(AppError):
    """rename 标题非法（task-02 / FR-03）：strip 后为空或超 255 字符，422 不落库。

    长度上限对齐 ``AgentSession.title`` 列 String(255)；空标题拒绝口径与
    :class:`SessionEmptyPrompt` 一致（422 + 中文文案，schema 层不拦、
    service 层统一出口）。
    """

    code = "HTTP_422_DAEMON_SESSION_TITLE_INVALID"
    http_status = 422


# ── 定时消息错误（task-03 2026-09-07-session-pin-rename-scheduled-send / FR-04）──


class DaemonScheduledMessageDispatchTooSoon(AppError):
    """定时消息 ``dispatch_at`` 非未来时间（task-03 / FR-04）：早于
    now(UTC)+60s（:data:`SCHEDULED_DISPATCH_MIN_LEAD_SEC`），422 不落库。

    最小提前量防「刚建即过期」竞态（design §总体方案 Wave 2）——避免条目落库
    瞬间即被 sweeper 到点捞走，用户还没看到列表条目就已派发。空 prompt 拒绝
    不单设类：复用 :class:`SessionEmptyPrompt`（同 inject 中文口径）。
    """

    code = "HTTP_422_DAEMON_SCHEDULED_MESSAGE_DISPATCH_TOO_SOON"
    http_status = 422


class DaemonScheduledMessageSessionInactive(AppError):
    """定时消息目标会话不可用（task-03 / FR-04）：终态（ended/failed）或已软删
    （``deleted_at`` 非空），409 不落库。

    不复用 :class:`DaemonSessionNotActive`（inject/reopen 流专用语义）——
    独立 code 让前端（task-05）按定时上下文给文案；错误归类字符串对齐 task-04
    sweeper 的 ``error_code='session_inactive'`` 归档口径。
    """

    code = "HTTP_409_DAEMON_SCHEDULED_MESSAGE_SESSION_INACTIVE"
    http_status = 409


class DaemonScheduledMessageNotFound(AppError):
    """定时条目不存在 / 非该会话条目（task-03 / FR-04，404 不泄露存在性）。"""

    code = "HTTP_404_DAEMON_SCHEDULED_MESSAGE_NOT_FOUND"
    http_status = 404


class DaemonScheduledMessageNotPending(AppError):
    """非 pending 定时条目不可取消（task-03 / FR-04）。

    dispatched / cancelled / failed 均为终态不回退（状态机单向往，对齐
    ``AgentSessionScheduledMessage.status`` 契约）——取消已派发条目语义上
    是「撤回已发消息」，超出本变更范围（非目标：不做编辑/撤回）。
    """

    code = "HTTP_409_DAEMON_SCHEDULED_MESSAGE_NOT_PENDING"
    http_status = 409


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


class DaemonSessionTeamMissionInvalid(AppError):
    """create 携 team_mission 的 E2 主 agent 工作区解析不可满足（422）。

    task-09（2026-08-24-session-team-mission-context / design §5.E2 / D-014@v1）：
    ``orchestrator_workspace_id`` ∉ scope，或 (W, 创建者) 的
    WorkspaceMemberRuntime binding 缺失（无行 / runtime_id 空）——后者不借用
    他人 binding 钉定，422 明确报「该工作区未绑定你的机器」。全部在事务
    开始前抛出，无半成品落库。
    """

    code = "HTTP_422_DAEMON_SESSION_TEAM_MISSION_INVALID"
    http_status = 422


class ToolReportActivateNoDaemon(AppError):
    """tool_report 会话懒激活时无可用的在线守护进程（409）。

    2026-08-23-agent-activity-sessions task-05（design §3.3.4 / Grill P2）：
    ``prepare_interactive_dispatch`` 无在线机器抛的 ``NoOnlineDaemonError`` 是
    裸 Exception（placement.py，非 AppError）——直接透传会 500。懒激活分支自包
    本 AppError 子类（中文 detail + 409），让「继续本地 Agent 会话」的失败走
    既有中文错误链路（前端 toast），不裸抛。
    """

    code = "HTTP_409_TOOL_REPORT_ACTIVATE_NO_DAEMON"
    http_status = 409
