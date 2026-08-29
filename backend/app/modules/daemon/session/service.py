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
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, NamedTuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    SESSION_QUEUE_MAX_PENDING,
    AgentRun,
    AgentRunLog,
    AgentRunModelUsage,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.auth.permissions import Permission

# D-001@v1：create_session workspace 归属校验（口径与前端 listWorkspaces 一致）。
from app.modules.auth.rbac import allowed_workspace_ids

# 2026-08-25-session-spec-binding task-04 / D-002@v1 / D-001@v1：会话列表
# change_id / ql_id 关联筛选的数据源（links 表是关联唯一真相）。change.model
# 只依赖 app.models.base，不 import daemon——无循环导入（daemon/session/
# context.py 顶部 import 先例同款）。
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.daemon.control_commands import (
    INJECT_SEND_FAILED_ERROR_CODE,
    KIND_SESSION_END,
    KIND_SESSION_INJECT,
    KIND_SESSION_INTERRUPT,
    KIND_SESSION_RESUME,
    ControlCommandService,
)
from app.modules.daemon.model import (
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)
from app.modules.daemon.protocol import DAEMON_MSG_PLAN_RESPONSE
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import (
    PageContextCreateBlock,
    PlanResponseDecision,
    SessionReopenResponse,
    SessionUsageModelItemRead,
    SessionUsageRead,
    TeamMissionCreateBlock,
)

# task-02（2026-08-24-sessions-live-updates / design §1.1）：agent_sessions 列表
# 变更信号发布入口。publish 自身静默容错（Redis 抖动不打断业务写路径），埋点
# 只需 await 调用；user_id 一律取会话属主 AgentSession.user_id。
from app.modules.daemon.session_events import publish_sessions_changed

# task-02（2026-08-28-session-ppm-task-binding / FR-01/02/05 / D-005@v1）：PPM
# 条目↔会话绑定基座消费——create/inject 落 link + item 校验/工作区解析、list
# ppm 维度筛选的数据源。session_binding 只依赖 model 层（file/ppm/workspace），
# 不 import daemon——无循环导入（change.model 顶部 import 先例同款）。
from app.modules.ppm.common.session_binding import (
    PpmItemKind,
    PpmItemSessionLink,
    bind_session_to_ppm_item,
    load_item_files,
    load_ppm_item,
    resolve_item_workspace_id,
)

# ql-20260828-003：ppm_item_row / 物化 item 传参的类型标注用（模型层依赖，
# 运行时仅注解引用；session_binding 先例同款无循环导入）。
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask

log = get_logger(__name__)

# task-05（2026-08-14-sessions-portal / D-012@v1 / FR-05）：会话内配置热切换 WS
# 控制消息（Server → Daemon），原子承载「切换档案/供应商 + 切换轮 prompt」。
# 命名遵循 protocol.py 常量族 ``daemon:session_*`` 约定（与 sillyhub-daemon
# src/protocol.ts MSG.SESSION_* 逐字对齐，daemon 侧路由归 task-09）。常量置于
# 本模块（task-05 allowed_paths 约束：protocol.py 不在允许清单）；task-09 落
# daemon.ts 路由时以此为契约源，如后续收敛进 protocol.py 需同步搬移。
DAEMON_MSG_SESSION_SWITCH_CONFIG = "daemon:session_switch_config"


ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
# P2（2026-08-25 会话路径二审 #3）：词表单源化——真实定义在 ``agent.model.
# ACTIVE_RUN_STATUSES``（叶子模块，各消费方 import 方向安全），本名保留为
# 别名供既有导入方（permission_service / daemon.service facade）零改动。
# 统一后各判定点（router current_run / _session_has_active_turn、finalizer、
# patrol、mcp_tools）开始把 ``pending_approval`` 算活跃（修复：审批中的 run
# 此前被漏判），并去掉 DB 永不落库的 ``interrupting``（前端展示态）。
ACTIVE_TURN_STATUSES = ACTIVE_RUN_STATUSES
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})

# DS-4 / DS-5 / DS-6（2026-08-21-session-reopen-resume）：reconnecting 手动重试
# 窗口秒数（基准 ``session.last_active_at``，两路径翻转 reconnecting 时均写 now）。
# 唯一落点：task-04（reopen 前置校验窗口外放行）与 task-05（sweeper 巡检收敛）
# 均 import 本常量，勿在别处重复定义；本 task 只定义不消费。
RECONNECTING_RETRY_WINDOW_SEC = 180

# 2026-08-29-daemon-platform-resilience task-05（design A5 / FR-04）：daemon 优雅
# 停止时中断轮 run 的收敛错误码。与 recover 路径的 ``daemon_restarted``（区分
# 优雅停止 vs 崩溃重启两条挂起来源）；唯一写入点 suspend_sessions_for_daemon。
DAEMON_STOPPED_ERROR_CODE = "daemon_stopped"

# 2026-08-29-batch-session-inherit task-01（design S1 / FR-01 / D-005@v1）：daemon
# 掉线中断 **worker 子会话**（``parent_session_id`` 非空）的收敛错误码——与主会话
# 的 ``daemon_stopped`` 区分来源：worker 是临时会话无用户手恢复，挂起只会卡
# mission 等 24h GC，改判 failed 落本码作 task-02 自动重派（--resume 继承原会话）
# 的种子标识。写入点：suspend_sessions_for_daemon 与 session_offline_sweep_once
# （sweep.py import 本常量，单一落点）的 worker 分流分支；主会话与 sweep pending
# 档不写（语义逐字不变）。
DAEMON_INTERRUPTED_ERROR_CODE = "daemon_interrupted"

# ql-20260827-015：后台任务通知排队合并。daemon 任务终态唤醒（session-manager
# _scheduleTaskWakeup，2026-08-27-background-subagent-progress ql-20260827-007）
# 在忙轮期间经 inject 端点（恒 queue_when_busy=True）反复注入「[后台任务通知]」，
# 每条一行排队——长轮会话的队列会被通知刷成 treadmill（run 终态后逐条派发、每条
# 都是一轮完整模型汇报）。生产实证（会话 17f10040）：当前轮 4 分钟未结、期间每个
# 后台任务终态一条排队，计数只增不减。daemon 侧 2s debounce 只覆盖 2 秒窗口，
# 跨长轮的合并在本层做：同会话已有 pending 通知条目时并入（任务行追加 + 头/尾
# 计数改写），不新增行——通知类排队恒 ≤1 条。
TASK_WAKEUP_PROMPT_PREFIX = "[后台任务通知]"
_TASK_WAKEUP_HEADER_COUNT_RE = re.compile(r"以下 \d+ 个后台子代理任务已全部结束")
_TASK_WAKEUP_TRAILER_COUNT_RE = re.compile(r"（共 \d+ 个）")


def _merge_task_wakeup_prompt(old: str, new: str) -> str:
    """把新「[后台任务通知]」的任务行并入旧通知 prompt。

    单生产者模板（daemon session-manager._scheduleTaskWakeup）：首行头部（含
    任务总数）→ 若干 ``- 任务「…」…`` 任务行 → 尾行汇报指令（含总数）。合并 =
    旧任务行 + 新任务行，头/尾计数改写为新总数。解析按行前缀 ``- `` 判任务行，
    模板漂移时自然退化为「旧全文 + 新任务行整段拼接」（信息不丢，仅格式退化）。
    """
    old_lines = old.split("\n")
    new_bullets = [line for line in new.split("\n") if line.startswith("- ")]
    old_bullets = [line for line in old_lines[1:] if line.startswith("- ")]
    trailer_lines = [
        _TASK_WAKEUP_TRAILER_COUNT_RE.sub(f"（共 {len(old_bullets) + len(new_bullets)} 个）", line)
        for line in old_lines[1:]
        if not line.startswith("- ")
    ]
    header = _TASK_WAKEUP_HEADER_COUNT_RE.sub(
        f"以下 {len(old_bullets) + len(new_bullets)} 个后台子代理任务已全部结束",
        old_lines[0],
    )
    return "\n".join([header, *old_bullets, *new_bullets, *trailer_lines])


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


async def _send_session_end_best_effort(
    db_session: AsyncSession,
    *,
    session_id: uuid.UUID,
    lease_id: uuid.UUID | None,
    runtime_id: uuid.UUID | None,
    reason: str,
) -> bool:
    """ql-20260823-006：后端把会话翻终态（ended/failed）的路径补发 SESSION_END。

    背景（2026-08-23 会话 bdec91a4 事故）：close_interactive_run 等路径只翻 DB
    终态，daemon 内存 SessionStore 里的活会话无人通知 → 残留条目让后续 reopen
    全部撞 SESSION_ALREADY_EXISTS 死循环。本 helper 把 end_session 的 SESSION_END
    收口点推广到 run 终态自动翻终态的路径。best-effort：runtime/lease 缺失、
    daemon 不在线、WS 发送失败、任何异常均仅记日志返 False，不影响已 commit
    的终态（与 end_session 内联版同语义）。

    Returns:
        True 表示 WS 发送成功；False 表示跳过或失败（均已记日志）。
    """
    if lease_id is None or runtime_id is None:
        return False
    try:
        # task-04（design A2）：SESSION_END 走控制指令三段式——落库 pending +
        # WS 推送 + delivered 标记；daemon 断线窗口由重连补拉兜底。best-effort
        # 语义不变（delivered=False 仅记日志返 False，不阻断已 commit 的终态）。
        daemon_id = await _resolve_daemon_id_for_runtime(db_session, runtime_id)
        if daemon_id is None:
            return False
        _row, ok = await ControlCommandService(db_session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=runtime_id,
            kind=KIND_SESSION_END,
            payload={
                "session_id": str(session_id),
                "lease_id": str(lease_id),
                "runtime_id": str(runtime_id),
            },
        )
        if not ok:
            log.warning(
                "session_end_control_send_failed",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
                reason=reason,
            )
        return ok
    except Exception:
        log.warning(
            "session_end_control_send_failed",
            session_id=str(session_id),
            runtime_id=str(runtime_id),
            reason=reason,
        )
        return False


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

    P2（2026-08-25 会话路径二审 #4）：读行加 ``FOR UPDATE``（经 SQLAlchemy
    ``with_for_update``，SQLite 方言自动忽略、PG 渲染行锁）。原 raw SELECT →
    merge → raw UPDATE 无锁，与 daemon claim 路径并发写 lease metadata（如
    claim 落 ``claim_token``）存在丢更新窗口——claim 不持 AgentSession 行锁，
    二者不互斥，必须靠 lease 行本身串行。UPDATE 仍走 raw text（与原实现
    逐字节同参数形态），行锁由同事务的 SELECT ... FOR UPDATE 持有到 commit。
    """
    import json as _json

    from sqlalchemy import text as _sa_text

    # with_for_update 走 ORM select（方言感知：PG 渲染 FOR UPDATE，SQLite 忽略
    # 提示不报语法错——raw text 拼 "FOR UPDATE" 会让 SQLite 测试全炸）。
    raw_meta = (
        await db_session.execute(
            select(DaemonTaskLease.metadata_)
            .where(DaemonTaskLease.id == lease_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
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


class _PlatformSessionBinding(NamedTuple):
    """task-05（2026-08-28-daemon-agent-share / FR-04 / D-007@v1）：platform
    共享档案检测命中后的服务端强制绑定。"""

    grant_id: uuid.UUID
    pinned_runtime_id: uuid.UUID
    provider: str
    source_root_path: str
    writable_dir: str | None


async def _detect_platform_profile_binding(
    db_session: AsyncSession,
    *,
    profile_id: uuid.UUID,
) -> _PlatformSessionBinding | None:
    """task-05（design §5 Phase 3 / D-007@v1）：检测档案是否为生效 platform
    共享智能体的绑定档案。

    判定口径（查询形态同 grants/queries.authorize_pinned_runtime 原 platform
    分支——D-012@v1 后该分支命中即 None、本检测是共享 runtime 的唯一入口 +
    task-05 检测要求「enabled + 该 profile + runtime 在线」）：

    - ``grantee_type='platform'`` + ``enabled=True``（停用/撤销即检测不命中，
      档案自然回普通语义，无残留覆写——constraints）；
    - ``agent_profile_id`` 命中 + join agent_profiles（悬空 grant 不放行）；
    - ``source_workspace_id`` 非空且 Workspace 行存在（cwd 落点的完整性防御）；
    - pinned runtime 存在且 ``status='online'``（离线 = 共享智能体不可用，
      检测不命中走原路径：只传档案形态回落二选一 422，前端 active 端点本就
      置灰离线条目）。

    grants 空表 → None → 调用方零分支走原链路（design §9 兼容策略）。
    检测为纯读查询，函数级 import 对齐本模块跨域 lazy 范式（design §7.2）。
    """
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.daemon.grants.model import DaemonRuntimeGrant
    from app.modules.workspace.model import Workspace

    row = (
        await db_session.execute(
            select(DaemonRuntimeGrant, DaemonRuntime, Workspace)
            .join(DaemonRuntime, DaemonRuntime.id == DaemonRuntimeGrant.pinned_runtime_id)
            .join(Workspace, Workspace.id == DaemonRuntimeGrant.source_workspace_id)
            .join(AgentProfile, AgentProfile.id == DaemonRuntimeGrant.agent_profile_id)
            .where(
                col(DaemonRuntimeGrant.grantee_type) == "platform",
                col(DaemonRuntimeGrant.enabled).is_(True),
                col(DaemonRuntimeGrant.agent_profile_id) == profile_id,
                col(DaemonRuntimeGrant.source_workspace_id).is_not(None),
                col(DaemonRuntime.status) == "online",
            )
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    grant, runtime, source_ws = row
    # provider 空 = runtime 未完成注册（同 task-03 钉定块内口径），视为不可用。
    if not runtime.provider:
        return None
    return _PlatformSessionBinding(
        grant_id=grant.id,
        pinned_runtime_id=runtime.id,
        provider=runtime.provider,
        source_root_path=source_ws.root_path,
        writable_dir=grant.writable_dir,
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


@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    """Result of create_session / inject_session (D-005@v1 triple).

    ql-20260825-011（后端真实排队）：忙轮入队路径没有新 run——``queued=True``
    时 ``agent_run`` / ``queue_entry_id`` 二选一有值（入队成功 → 只有
    ``queue_entry_id``）。create_session / 空闲 inject 路径 ``queued`` 恒
    False，三字段语义与既有完全一致（零回归）。
    """

    agent_session: AgentSession
    agent_run: AgentRun | None = None
    lease_id: uuid.UUID | None = None
    queued: bool = False
    queue_entry_id: uuid.UUID | None = None


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


@dataclass(frozen=True, slots=True)
class SuspendBatchResult:
    """Result of suspend_sessions_for_daemon（task-05 provides 契约）.

    ``suspended`` = 实际翻 suspended 的**主会话**（``parent_session_id`` IS NULL）
    行数（条件 UPDATE 命中数——重复调用对已挂起/终态会话 no-op 计 0）；
    ``runs_failed`` = 同批收敛 failed 的活跃轮 run 行数（主会话 error_code=
    daemon_stopped + worker error_code=daemon_interrupted 合计）。

    2026-08-29-batch-session-inherit task-01 追加：``workers`` = 同批按
    ``parent_session_id`` 分流改判 ``failed``（error_code=daemon_interrupted）的
    worker 子会话 ``(session_id, runtime_id)`` 列表——重派种子，供 task-02 异步
    重派消费（runtime_id 为派发路由键）；**仅内部消费**，router 响应 DTO
    （SuspendBatchResponse）只读 suspended / runs_failed 两键，响应契约零变化。
    """

    suspended: int
    runs_failed: int
    workers: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _PrelockedInjectAttachments:
    """P1（2026-08-25 会话路径二审 #1）：取锁前预组装的附件载荷快照。

    ``rows`` = 已过引擎/归属/数量校验的 SessionAttachment 行（保留入参顺序）；
    ``inject_attachments`` = SESSION_INJECT payload 的 attachments 列表（MinIO
    组装产物）；``gate_*`` = 预组装时的多模态 gate 快照——锁内复核「预读与取锁
    之间会话供应商/引擎是否漂移」用，漂移且 supports 翻转才在锁内重组装。
    """

    rows: list
    inject_attachments: list[dict]
    gate_supports_multimodal: bool
    gate_provider_id_basis: uuid.UUID | None
    agent_kind: str


@dataclass(frozen=True, slots=True)
class _PreparedPpmAttachment:
    """task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-006）：PPM 附件
    物化的写事务外预备产物。

    ``_materialize_ppm_attachments`` 在写事务外完成 storage 读 IO、``_can_access``
    与降级决策，并把对象写入 session attachment storage（``store_bytes`` 内容
    寻址）；本结构承载落 ``SessionAttachment`` 行所需的列值——行 insert 归
    create_session 写事务内（session.id 已知后）flush-only 完成。
    """

    kind: str
    media_type: str
    bytes: int
    name: str
    object_key: str
    sha256: str


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
        P2（2026-08-25 会话审查）：set 完成后把 ``_events`` 键 pop 掉——已拿到
        Event 引用的等待者不受影响（其 ``wait`` 已被 set 唤醒 / 立即通过），
        新到的 ``wait`` 走 ``_ready`` 快速路径；键不残留，dict 规模以并发
        等待者为上界（原实现每个 mark 过的 session 永占一个槽位，无界增长）。
        """
        self._ready.add(session_id)
        event = self._get_or_create_event(session_id)
        event.set()
        self._events.pop(session_id, None)

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

        P2（2026-08-25 会话审查）：**直接 pop ``_events`` 键**（原实现用新
        ``asyncio.Event`` 替换槽位，键永不消失 → dict 随会话数无界增长）。
        语义不变：旧 event 若已 ``set``，已持有其引用的等待者早已通过；未
        ``set`` 的（clear 时无人 mark）等待者本就要超时——下一次 ``wait`` 经
        ``_get_or_create_event`` 建全新未 set 的 event，必须等下一次
        ``mark_ready`` 才能 set 返 ``True``，与原「换新未 set event」一致。
        """
        self._ready.discard(session_id)
        self._events.pop(session_id, None)


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
        # task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话
        # 团队任务块——事务前共享校验 + E2 主 agent 工作区解析；事务内 flush-only
        # 预建 mission + 首 run 双标记 + 首 prompt 团队简报前缀。缺省 None 零
        # 分支进入（无 team_mission 的 create 行为逐字节不变）。
        team_mission: TeamMissionCreateBlock | None = None,
        # 2026-08-25-unified-floating-session（FR-5 / D-005）：悬浮入口页面上下文
        # 块——仅 page_key 枚举 + 实体 id，前导数据服务端回查；缺省 None 零回归。
        page_context: PageContextCreateBlock | None = None,
        # task-08（2026-08-25-session-spec-binding / FR-04 / FR-06）：快速修复
        # 短码——创建落库点 bind_session_to_quicklog 补写 quicklog_session_links
        # （savepoint best-effort，失败仅 warning 不阻断创建主事务与 201）。
        # 缺省 None 零分支进入（零回归）。
        quicklog_id: str | None = None,
        # task-02（2026-08-28-session-ppm-task-binding / FR-01 / D-005@v1 /
        # D-004@v2）：PPM 条目成对绑定字段——item 存在性校验与工作区解析在写
        # 事务前（查无记 ``session_ppm_bind_item_missing`` warning 降级普通会话，
        # §9 不 4xx）；落 ppm_item_session_links 在写事务内（quicklog 分支旁）；
        # AgentSession.workspace_id 未显式指定时回填解析值。缺省 None 零分支
        # 进入（零回归）。前导注入/附件物化归 task-03，本方法不实现。
        ppm_item_kind: PpmItemKind | None = None,
        ppm_item_id: uuid.UUID | None = None,
        # task-04（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：
        # 分身子会话形态参数组（task-05 dispatch_worker 换三元组派发时传入）：
        # parent_session_id 写 AgentSession.parent_session_id（会话树挂载，
        # D-001@v1）；stage 透传 prepare_interactive_dispatch 写 lease
        # metadata.stage（软依赖 task-03 的扩展形参——仅显式传入才透传）；
        # first_run_mission_id / first_run_role 为首 run 双标记（缺省回落
        # team_mission 预建的 mission.id + 'orchestrator' 原值）。owner 不另设
        # 参数——分身形态归属即 user_id 入参本身（task-05 传 mission.created_by，
        # D-004@v1）。全缺省 None 时本方法行为逐字节不变（既有三路零回归）。
        parent_session_id: uuid.UUID | None = None,
        stage: str | None = None,
        first_run_mission_id: uuid.UUID | None = None,
        first_run_role: str | None = None,
        # ql-20260825-001：预会话首句附件——校验/标记行/组装/回填复用 inject 路径
        # 既有逻辑（D-6 引擎门控 / 归属 404 / 数量 422 / marker 行回显 /
        # SESSION_INJECT attachments）。缺省 None = 旧调用行为逐字节不变。
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> SessionDispatchResult:
        """Create an interactive session + first-turn run + interactive lease.

        FR-01 / design §7.6 step 1. The session, run and lease are committed
        atomically (D-005@v1 triple), then the daemon is woken. If the wake-up
        cannot be delivered the triple is converged to failed terminal states
        and DaemonRuntimeOffline is raised so no active session lingers.

        task-03 双入口：``runtime_id``（/sessions 新页面，Grill C-01 钉定）与
        ``provider``（/runtimes 弹窗旧路径，零回归）二选一，前者优先。

        task-09：``team_mission`` 携带时预建 mission（session 模式 flush-only，
        共用本方法唯一 commit）——详见函数内 task-09 分段注释。

        task-04（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：
        ``parent_session_id`` / ``stage`` / ``first_run_mission_id`` /
        ``first_run_role`` 显式传入时进入分身子会话形态——AgentSession 挂
        parent、首 run 带双标记、stage 进 lease metadata；归属即 ``user_id``
        入参（调用方传 mission.created_by，D-004@v1）。全缺省 None 零分支进入
        （既有 quick-chat / 变更会话 / 团队主控三路行为逐字节不变）。
        """
        # ql-20260825-001（D-7 对齐 inject）：纯文本首句需非空 prompt；附件
        # 非空允许空 prompt（看图说话）。
        if (not prompt or not prompt.strip()) and not attachment_ids:
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )

        # ── task-05（2026-08-28-daemon-agent-share / FR-04 / D-007@v1）：platform
        # 共享档案检测前置——先于 runtime_id/provider 二选一校验（Grill B-01：悬浮
        # 助手/门户只传 agent_profile_id（无 runtime_id/provider）形态在原校验
        # :950-954 之后必被拒）。检测命中 → 进服务端强制分支（钉定 pinned runtime
        # + 派生 provider；cwd 覆写在 team_mission 块后统一施加，见下方）；未命中
        # （普通档案 / grant 停用 / 档案悬空 / runtime 离线）→ 零分支走原链路，
        # 停用后档案天然回普通语义（constraints）。grants 空表 → 恒 None 零回归。
        _platform_binding: _PlatformSessionBinding | None = None
        if agent_profile_id:
            try:
                _platform_profile_uuid = uuid.UUID(agent_profile_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionConfigInvalid(
                    f"Invalid agent_profile_id '{agent_profile_id}'.",
                    details={"agent_profile_id": agent_profile_id},
                ) from exc
            _platform_binding = await _detect_platform_profile_binding(
                self._session, profile_id=_platform_profile_uuid
            )

        # ── task-03：runtime_id 入口解析（钉定 + 派生 provider，Grill C-01/P0）──
        # 校验在事务开始前完成：不可满足直接 4xx，无半成品落库；placement 侧
        # pinned 路径二次复查（竞态防线），失联同样转 4xx，绝不静默换机。
        pinned_runtime_id: uuid.UUID | None = None
        if _platform_binding is not None:
            # task-05 强制分支：无视请求 runtime_id 语义（防伪造——约束由服务端
            # 施加，请求参数不可放宽），钉定 grant 的 pinned_runtime_id 并派生
            # provider。下发侧 prepare_interactive_dispatch 传
            # pinned_skip_owner_check=True（代表钉定模式，:612-620 先例）：placement
            # 只按 id+online 复查，不进借用授权分支 → 不写 daemon_borrow_audit、
            # 不带借用沙箱 marker（D-007@v1：platform 是平台授权非工作区借用，
            # 用量计量走 AgentSession 既有口径）。离线竞态仍转 4xx 不静默换机。
            pinned_runtime_id = _platform_binding.pinned_runtime_id
            provider = _platform_binding.provider
            # E2E 修正（2026-08-28，R-10）：平台共享会话强制 manual_approval=False
            # ——约束即策略（writable_dir 写边界 + 禁 Bash 白名单），远程人审无增益
            # 且实测 enableApproval=true 路径下写守卫未生效（目录外写放行、零审计）；
            # enableApproval=false 路径（write-only 守卫）经对照实验实证可用
            # （机器级边界 deny + 审计落库）。服务端强制，请求参数不可放宽。
            manual_approval = False
        elif runtime_id:
            try:
                pinned_runtime_id = uuid.UUID(runtime_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionRuntimeNotFound(
                    f"Invalid runtime_id '{runtime_id}'.",
                    details={"runtime_id": runtime_id},
                ) from exc
            _rt = await self._session.get(DaemonRuntime, pinned_runtime_id)
            if _rt is None:
                raise DaemonSessionRuntimeNotFound(
                    f"Runtime '{runtime_id}' not found.",
                    details={"runtime_id": runtime_id},
                )
            # ── task-03（2026-08-28-daemon-agent-share / FR-02 / D-001@v1 +
            # D-006@v1）：钉定授权判定——owner 短路，非本人走 grants──
            # ``_rt.user_id == user_id`` 自有 runtime 走原路径（零回归）；否则调
            # task-02 的 ``authorize_pinned_runtime``（grants 授权唯一判定源）：
            # - workspace_grant 命中（成员 + daemon:borrow 权限 + enabled + 机器
            #   在线）→ 放行，按**借用会话**处理——lender/grant_id 的审计关联由
            #   placement 二次复查（_query_pinned_online_runtime 授权分支，同源
            #   判定）命中后写入 daemon_borrow_audit（含 grant_id）+ 借用沙箱
            #   marker，本层只做授权闸不重复记审计；
            # - platform_grant 命中 → authorize 返回 None → 404（D-012@v1，
            #   验收审查 gap-2）：直接钉定 platform grant 的 pinned runtime
            #   （不带共享档案）会绕过 task-05 强制（cwd/写约束/工具集），
            #   该形态首查即封堵；共享 runtime 唯一入口=task-05 档案检测
            #   （上方强制分支，下发走 pinned_skip_owner_check=True 不经
            #   authorize，不受影响）；
            # - None（未授权/停用 grant/机器离线）→ 维持 DaemonSessionRuntimeNotFound
            #   404 语义，不泄露存在性（design §9）；下方 404/离线/provider 校验
            #   顺序与语义不变。
            if _rt.user_id != user_id:
                # 函数级 import 对齐本模块跨域 lazy 范式（design §7.2 / §10 R1）。
                from app.modules.daemon.grants.queries import authorize_pinned_runtime

                _pin_authz = await authorize_pinned_runtime(
                    self._session,
                    actor_user_id=user_id,
                    runtime_id=pinned_runtime_id,
                    workspace_id=workspace_id,
                )
                if _pin_authz is None:
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

        # ── ql-20260825-001：首句附件校验（对齐 inject 路径 task-05 段）──
        # D-6 引擎门控（仅 Claude 支持附件）/ 归属+存在 404 / 数量 422（图≤5、
        # 文≤5）/ 保序。整体拒绝不部分生效：任一失败 raise → 无半成品落库。
        validated_attachments: list = []
        if attachment_ids:
            if provider != "claude":
                raise DaemonSessionAttachmentsUnsupported(
                    "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
                    details={"provider": provider},
                )
            from app.modules.session_attachment.model import SessionAttachment

            _att_rows = (
                (
                    await self._session.execute(
                        select(SessionAttachment).where(
                            SessionAttachment.id.in_(attachment_ids),
                            SessionAttachment.user_id == user_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if len(_att_rows) != len(set(attachment_ids)):
                raise DaemonSessionNotFound(
                    "部分附件不存在或无权访问。",
                    details={"reason": "attachment_not_found"},
                )
            _image_n = sum(1 for r in _att_rows if r.kind == "image")
            _file_n = sum(1 for r in _att_rows if r.kind == "file")
            if _image_n > 5 or _file_n > 5 or (_image_n + _file_n) != len(_att_rows):
                raise DaemonSessionAttachmentInvalid(
                    "附件数量超限（图片≤5、文件≤5）或类型非法。",
                    details={"image_count": _image_n, "file_count": _file_n},
                )
            _att_by_id = {r.id: r for r in _att_rows}
            validated_attachments = [
                _att_by_id[i] for i in dict.fromkeys(attachment_ids) if i in _att_by_id
            ]

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
                # ql-20260829-010：归档工作区禁写——创建会话 409（守卫与中文提示
                # 统一收敛在 WorkspaceService.ensure_writable）。
                from app.modules.workspace.service import WorkspaceService as _WSSvc

                _WSSvc.ensure_writable(_ws)
                cwd = _ws.root_path

        # ── task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话
        # 团队任务块解析（事务开始前，design §5.E1/E2）──共享校验
        # ``validate_team_mission_block``（task-07：scope 去重保序/项目维度
        # 403/scope 越界 422/anchor backend-code 优先派生）+ E2 主 agent 工作区
        # （orchestrator_workspace_id）解析。全部前置到事务外：不可满足直接
        # 4xx，无半成品落库。缺省 None 零分支进入（零回归）。
        mission_scope_ids: list[uuid.UUID] | None = None
        mission_anchor_id: uuid.UUID | None = None
        if team_mission is not None:
            from app.modules.auth.model import User as _User

            _tm_actor = await self._session.get(_User, user_id)
            if _tm_actor is None:
                raise DaemonSessionConfigInvalid(
                    "Session owner user not found.",
                    details={"user_id": str(user_id)},
                )
            # 延迟 import：daemon.router 顶层 import 本模块（get_session_readiness），
            # 函数内取 task-07 共享校验避免模块环（单一实现，无复制粘贴）。
            from app.modules.daemon.router import validate_team_mission_block

            mission_scope_ids, mission_anchor_id = await validate_team_mission_block(
                self._session,
                _tm_actor,
                team_mission,
                fallback_workspace_id=workspace_id,
            )

            # ── E2 主 agent 工作区（design §5.E2 / D-010@v1）──
            _orch_ws_id = team_mission.orchestrator_workspace_id
            if _orch_ws_id is not None:
                assert mission_scope_ids is not None  # 上方已赋值，助 mypy 收窄
                if _orch_ws_id not in mission_scope_ids:
                    raise DaemonSessionTeamMissionInvalid(
                        "主 agent 工作区必须在团队任务 scope 内。",
                        details={"orchestrator_workspace_id": str(_orch_ws_id)},
                    )
                # (W, 创建者) 的 WorkspaceMemberRuntime binding（D-014@v1）：
                # 行缺失或 runtime_id 空 → 422「该工作区未绑定你的机器」，
                # 不借用他人 binding 钉定。
                from app.modules.workspace.member_runtimes.model import (
                    WorkspaceMemberRuntime,
                )

                _binding = await self._session.get(WorkspaceMemberRuntime, (_orch_ws_id, user_id))
                if _binding is None or _binding.runtime_id is None:
                    raise DaemonSessionTeamMissionInvalid(
                        "该工作区未绑定你的机器，无法作为主 agent 工作区。",
                        details={"orchestrator_workspace_id": str(_orch_ws_id)},
                    )
                # 命中：workspace_id 覆写 W + cwd=W.root_path（W ∈ scope 已验）。
                from app.modules.workspace.model import Workspace as _E2Workspace

                _w_row = await self._session.get(_E2Workspace, _orch_ws_id)
                workspace_id = _orch_ws_id
                cwd = _w_row.root_path if _w_row is not None else None
                # binding.runtime_id 作 pinned_runtime_id 复用既有钉定链
                # （placement 属主+在线复查，失联转 4xx 不静默换机）；用户显式
                # 传 runtime_id 时显式优先（R-09：W 仅决定 workspace_id/cwd）。
                # task-05：platform 会话钉定不可被 E2 覆盖——共享智能体的
                # pinned runtime 是服务端强制项，team_mission 请求参数不得放宽。
                if not runtime_id and _platform_binding is None:
                    pinned_runtime_id = _binding.runtime_id
                # 用户未显式传 agent_profile_id/llm_provider_id/runtime_id 时
                # provider/model 落 W.default_agent/W.default_model（显式选择
                # 逐字节优先，R-09，后端不因不一致 422）。
                if not (agent_profile_id or llm_provider_id or runtime_id):
                    if _w_row is not None and _w_row.default_agent:
                        provider = _w_row.default_agent
                    if _w_row is not None and _w_row.default_model:
                        model = _w_row.default_model

        # ── task-05（FR-04 / D-002@v2 / Grill B-01 前置生效）：platform 会话
        # cwd 强制覆写──统一施加在 request workspace cwd（:1086-1120 既有落点）
        # 与 team_mission E2 cwd 之后：cwd = 源码工作区 root_path（读源码基准），
        # 请求 workspace 语义不参与 cwd（防伪造，服务端强制）。AgentSession
        # .workspace_id 仍记请求工作区（用户可访问的自身上下文，归属校验已过），
        # 只作 bookkeeping，不改变 lease 定位与 cwd 语义。
        if _platform_binding is not None:
            cwd = _platform_binding.source_root_path

        # ── task-02（2026-08-28-session-ppm-task-binding / FR-01 / D-004@v2）：
        # PPM 条目绑定前置解析（写事务前，纯只读）──成对携带 ppm_item_* 时先
        # load_ppm_item 校验条目存在性：查无记 ``session_ppm_bind_item_missing``
        # warning 后**降级普通会话**（§9：不 4xx/5xx 阻塞创建，不落 link）；
        # 命中则 resolve_item_workspace_id 解析条目所属项目第一个关联工作区
        # （workspace_id 升序第一个，D-004@v2），供下方 AgentSession.workspace_id
        # 未显式指定时回填 + 写事务内 bind_session_to_ppm_item 落 link 快照。
        # 项目无关联工作区 → ppm_ws=None，两者留空不阻塞（D-004）。缺省双 None
        # 零分支进入（零回归）。
        # ql-20260828-003：加载的条目行向下透传（物化 + 前导复用同一行，
        # 全链只查一次 DB——此前前置解析/物化/前导三处各查一次）。
        ppm_item_ok = False
        ppm_ws: uuid.UUID | None = None
        ppm_item_row: PlanTask | PpmProblemList | None = None
        if ppm_item_kind is not None and ppm_item_id is not None:
            _ppm_item = await load_ppm_item(self._session, ppm_item_kind, ppm_item_id)
            if _ppm_item is None:
                log.warning(
                    "session_ppm_bind_item_missing",
                    kind=ppm_item_kind,
                    item_id=str(ppm_item_id),
                )
            else:
                ppm_item_ok = True
                ppm_item_row = _ppm_item
                ppm_ws = await resolve_item_workspace_id(self._session, ppm_item_kind, ppm_item_id)

        now = datetime.now(UTC)
        # Copy config so the request dict is never mutated (boundary #16).
        config: dict = {
            "manual_approval": bool(manual_approval),
        }
        if model:
            config["model"] = model

        try:
            # ── ql-20260825-002-3e67（P2 二审 #5）：前导组装提前到写事务外 ──
            # change/page 前导 = 只读查询 + asyncio.to_thread 磁盘遍历；组装完毕
            # 立即 commit 收口只读事务，首个写 flush（AgentSession INSERT）晚于该
            # commit——磁盘 IO 不落在写事务窗口内（回归守卫：
            # test_session_optimize_round2.py::TestCreateSessionPreambleBeforeWrite）。
            # expire_on_commit=False（app/core/db.py:94），收口后上方已加载的
            # profile/provider/workspace 行仍可安全取属性。写块共用方法末尾的
            # 唯一 commit，中途异常整体回滚，无孤儿 session/mission。
            from app.modules.daemon.session.context import (
                build_change_context_preamble,
                build_page_context_preamble,
                build_platform_rules_preamble,
                build_ppm_item_context_preamble,
                build_sillyspec_preamble,
                build_user_preamble,
            )

            # 2026-07-09-change-detail-session / D-004@v1（X-02/X-04）：变更会话首轮
            # 注入【变更上下文】前导。dispatch prompt = 前导+用户消息，经 lease
            # metadata 的 prompt 字段透传到 daemon _startInteractiveSession 构造
            # 首条 user 消息。AgentRunLog(user_input) 与 SESSION_INJECT 的 prompt
            # 仍写干净用户消息（列表标题 / 回放 / 展示干净）。零 daemon 改动。
            preamble = await build_change_context_preamble(self._session, change_id)
            # ── 2026-08-25-unified-floating-session（FR-5 / D-005）：页面上下文前导 ──
            # 数据服务端回查（build_page_context_preamble 内部 DB.get），客户端
            # 仅 page_key 枚举 + project_id；查无/未传 → None 不注入。
            page_preamble = (
                await build_page_context_preamble(
                    self._session,
                    page_context.page_key,
                    page_context.project_id,
                    page_context.route_key,
                    page_context.workspace_id,
                    page_context.tab_key,
                )
                if page_context is not None
                else None
            )
            # ── task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-003/D-006/
            # D-007）：PPM 附件物化 + PPM 条目前导，执行序＝物化在前、前导消费
            # attachment_lines（design §5 Phase 2 不变量）──同样只落「写事务外」段：
            # storage 读 IO（file bytes 读取 + session attachment store_bytes）/
            # ``_can_access`` / 降级决策全部在本只读事务窗口内完成（首个写 flush
            # 晚于下方 commit，对齐上方前导段的结构守卫）；``SessionAttachment``
            # 行 insert 归写事务内（session.id 已知后，见下方组装段）。
            ppm_preamble: str | None = None
            ppm_prepared_attachments: list[_PreparedPpmAttachment] = []
            if ppm_item_ok:
                _ppm_lines, ppm_prepared_attachments = await self._materialize_ppm_attachments(
                    user_id=user_id,
                    kind=ppm_item_kind,
                    item_id=ppm_item_id,
                    provider=provider,
                    manual_attachments=validated_attachments,
                    item=ppm_item_row,
                )
                ppm_preamble = await build_ppm_item_context_preamble(
                    self._session,
                    ppm_item_kind,
                    ppm_item_id,
                    attachment_lines=_ppm_lines,
                    item=ppm_item_row,
                )
            # ── 2026-08-29-session-user-preamble（ql-20260829-012-2eb3 /
            # D-001/D-002/FR-01~FR-04）：用户信息 + 平台规则 + SillySpec 工具
            # 规则三前导，同样只落「写事务外」段——.sillyspec/ 探测是磁盘 IO
            # （单次 stat），对齐 TestCreateSessionPreambleBeforeWrite 结构守卫
            # （磁盘 IO 不进写事务窗口）。workspace 口径与下方 AgentSession.
            # workspace_id 同式：显式 workspace_id（含 team_mission E2 覆写）
            # 优先，PPM 回填 ppm_ws 兜底。仅本轮 create 拼接；后续轮次
            # _inject_into_session / 服务身份注入不携带（D-002）。展示层
            # （AgentRunLog user_input / SESSION_INJECT payload）仍写干净
            # 用户原文，对齐变更/页面前导先例。
            _user_preamble_ws = workspace_id if workspace_id is not None else ppm_ws
            user_preamble = await build_user_preamble(self._session, user_id, _user_preamble_ws)
            platform_preamble = build_platform_rules_preamble()
            sillyspec_preamble = await build_sillyspec_preamble(self._session, _user_preamble_ws)
            await self._session.commit()

            session = AgentSession(
                id=uuid.uuid4(),
                user_id=user_id,
                provider=provider,
                status="pending",
                config=config,
                turn_count=0,
                created_at=now,
                change_id=change_id,
                # task-02（FR-01 / D-004@v2）：显式 workspace_id 优先（含 team_
                # mission E2 覆写）；未显式指定且命中 PPM 条目时回填解析的
                # ppm_ws（条目所属项目第一个关联工作区快照）——只回填本列，
                # cwd/dispatch 沿用既有 workspace_id 决策不新增覆盖（R-05）。
                workspace_id=workspace_id if workspace_id is not None else ppm_ws,
                cwd=cwd,
                # task-03（FR-04/D-008）：会话配置三列（未选 = None = 现状，零回归）。
                agent_profile_id=profile.id if profile is not None else None,
                llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
                # task-04 / FR-02 / design §5.B：分身子会话挂 parent（D-001@v1 会话
                # 树）；缺省 None = 现状（非分身会话恒 NULL，零回归）。
                parent_session_id=parent_session_id,
            )
            self._session.add(session)
            await self._session.flush()

            # ── task-08（2026-08-25-session-spec-binding / FR-04 / FR-06 / D-002@v1）：
            # 创建落绑定（best-effort 双写，共用本方法唯一 commit；行级 savepoint
            # 吞异常，失败不阻断会话创建的 201 语义）──
            # ① change_id 非空：补写 change_session_links。**不走** binding.py 的
            #    bind_session_to_change——它按 change_key（变更名）解析且查无会建
            #    placeholder 行，而这里的 change_id 来自请求、已是 Change 行 UUID，
            #    直接按 (change_id, session_id) 幂等查插 link 即可（unique 兜底
            #    并发；Change 行不存在时 FK 失败被 savepoint 吞掉仅 warning）。
            #    agent_sessions.change_id 单 FK 列上方照写（D-002@v1 冻结语义：
            #    双写冗余提示，links 是关联唯一真相）。
            if change_id is not None:
                try:
                    async with self._session.begin_nested():
                        _c_link = (
                            (
                                await self._session.execute(
                                    select(ChangeSessionLink).where(
                                        ChangeSessionLink.change_id == change_id,
                                        ChangeSessionLink.session_id == session.id,
                                    )
                                )
                            )
                            .scalars()
                            .first()
                        )
                        if _c_link is None:
                            self._session.add(
                                ChangeSessionLink(
                                    id=uuid.uuid4(),
                                    change_id=change_id,
                                    session_id=session.id,
                                )
                            )
                            await self._session.flush()
                except Exception as exc:
                    log.warning(
                        "session_change_link_bind_failed",
                        change_id=str(change_id),
                        session_id=str(session.id),
                        error=str(exc),
                    )
            # ② quicklog_id 非空：bind_session_to_quicklog 写 quicklog_session_links
            #    （task-02 契约：自带 savepoint + log.warning 不抛，绑定失败不回滚
            #    创建主事务）。link 行 workspace_id NOT NULL——缺失时记 warning
            #    跳过（悬浮球/门户入口正常必带 workspace_id）。
            if quicklog_id:
                if workspace_id is None:
                    log.warning(
                        "session_quicklog_bind_skipped_no_workspace",
                        quicklog_id=quicklog_id,
                        session_id=str(session.id),
                    )
                else:
                    from app.modules.change.binding import bind_session_to_quicklog

                    await bind_session_to_quicklog(
                        self._session, workspace_id, quicklog_id, session.id
                    )
            # ③ ppm_item_* 成对携带且条目存在（task-02 / 2026-08-28-session-ppm-
            #    task-binding / FR-01 / D-005@v1）：bind_session_to_ppm_item 幂等写
            #    ppm_item_session_links（自带 savepoint + log.warning 不抛，失败
            #    不回滚创建主事务与 201）。workspace_id 快照取前置解析的 ppm_ws
            #    （可空：项目无关联工作区留 None，D-004@v2——本表列可空，与
            #    quicklog 的 NOT NULL 跳过守卫不同）。条目查无已被前置降级
            #    （ppm_item_ok=False），此处不重复校验。
            if ppm_item_ok:
                await bind_session_to_ppm_item(
                    self._session,
                    workspace_id=ppm_ws,
                    kind=ppm_item_kind,
                    item_id=ppm_item_id,
                    session_id=session.id,
                )

            # ── task-09 / D-009@v2（flush-only 预建，R-04）：team_mission 预建 ──
            # session 行 add+flush 后、首 run 构造前调 task-04 helper（session
            # 模式）；objective=block.objective 非空否则直取首句 prompt（create
            # 路径不经 _inject_into_session 占位回填）；scope/project_id/budget/
            # worker_preset/main_agent_config 透传。不 commit——共用写事务的
            # 唯一 commit（下方），中途任意环节异常走整体回滚，无孤儿 session/mission。
            mission = None
            if team_mission is not None:
                from app.modules.agent.orchestrator import OrchestratorService

                assert mission_anchor_id is not None and mission_scope_ids is not None
                mission = await OrchestratorService(self._session)._precreate_mission_flush(
                    workspace_id=mission_anchor_id,
                    objective=team_mission.objective or prompt,
                    created_by=user_id,
                    change_id=change_id,
                    constraints=None,
                    budget_usd=team_mission.budget_usd,
                    worker_preset=team_mission.worker_preset,
                    main_agent_config=team_mission.main_agent_config,
                    orchestration_mode="session",
                    scope_workspace_ids=mission_scope_ids,
                    project_id=team_mission.project_id,
                    session_id=session.id,
                )

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
                # task-09 / FR-05：预建 mission 的首 run 双标记（mission_id +
                # role='orchestrator'，字面量对齐 _inject_into_session 既有口径
                # 与 orchestrator.py _ORCHESTRATOR_ROLE）；首 run 即主控轮。
                # task-04 / FR-02 / design §5.A：双标记参数化——显式传入
                # first_run_* 优先（分身子会话首 run 带 mission_id + 分身 role），
                # 缺省回落 task-09 原值（team_mission 预建主控口径，零回归）。
                mission_id=(
                    first_run_mission_id
                    if first_run_mission_id is not None
                    else (mission.id if mission is not None else None)
                ),
                role=(
                    first_run_role
                    if first_run_role is not None
                    else ("orchestrator" if mission is not None else None)
                ),
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

            # ── task-09 / FR-01 / D-004@v1：首 prompt 团队简报前缀（create 路径）──
            # 叠加顺序定死（R-06）：变更前导（既有，在前）→ 团队简报（task-06
            # build_orchestrator_briefing）→ "\n\n---\n\n" → 用户消息。lease
            # metadata 经 dispatch_prompt 携带前缀（既有机制）；AgentRunLog
            # (user_input)（下方）与首 turn SESSION_INJECT payload prompt（下发
            # 段）仍写干净用户原文（对齐变更前导先例，展示层干净）。
            # unified-floating-session：页面前导插在变更前导与团队简报之间
            # （design §4 拼接顺序）。change/page 前导已在写事务外组装（见方法
            # try 块顶部）；简报依赖写事务内预建的 mission，且为纯 DB 读（无
            # 磁盘遍历），留在写块后组装。
            briefing = None
            if mission is not None:
                from app.modules.agent.mission_context import build_orchestrator_briefing

                briefing = await build_orchestrator_briefing(self._session, mission)
            # task-03（2026-08-28-session-ppm-task-binding Phase 2 / FR-01/FR-03）：
            # PPM 条目前导插在页面前导与团队简报之间并入 _prefix_parts（task-02
            # 占位注释的落地点）——dispatch_prompt 经 lease metadata 携带前缀
            # （既有机制），AgentRunLog(user_input)（下方）与首 turn SESSION_INJECT
            # 展示层仍写干净用户原文（对齐变更/页面前导先例，零 daemon 改动）。
            _prefix_parts = [
                part
                for part in (
                    preamble,
                    page_preamble,
                    ppm_preamble,
                    briefing,
                    # 2026-08-29-session-user-preamble：三前导紧贴用户消息
                    # （业务前导在前，规则块离用户输入最近遵从度最高）。
                    user_preamble,
                    platform_preamble,
                    sillyspec_preamble,
                )
                if part
            ]
            dispatch_prompt = (
                "\n\n---\n\n".join([*_prefix_parts, prompt]) if _prefix_parts else prompt
            )

            placement = RunPlacementService(self._session)
            # task-04 / FR-02 / design §5.B：stage 透传（软依赖 task-03 的
            # prepare_interactive_dispatch 扩展形参——stage 写 lease
            # metadata.stage → claim payload → daemon 谓词）。仅显式传入时追加
            # kwargs：缺省 None 不传 = 存量调用逐字节不变（含 placement 尚未
            # 扩展形参的并行合并窗口，不会对既有三路 TypeError）。
            _dispatch_extra: dict[str, str] = {}
            if stage is not None:
                _dispatch_extra["stage"] = stage
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
                    # task-05：platform 会话代表钉定——placement 复查只按 id+online，
                    # 跳过属主谓词与借用授权分支（task-03 已放行 platform 授权，本
                    # 分支直接钉定并跳过借用语义 → 无沙箱 marker / 无借用审计）。
                    pinned_skip_owner_check=_platform_binding is not None,
                    **_dispatch_extra,
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
            # ── task-05（FR-04 / D-009@v1）：platform 会话工具集下推──写 lease
            # metadata.tool_config（照 mcp_tools.py:1316 dispatch_worker 既有写法，
            # 经 build_claim_payload tool_config 透传 context.py:442-443 → daemon
            # CreateSessionInput.allowedTools → canUseTool 最外层白名单 gate，
            # per-session 物理拒绝白名单外工具）。
            # ── task-12（D-011 / spike-02 结论 B 修复）：writable_dir 写约束下推──
            # 同点位写 lease metadata.effective_allowed_roots=[writable_dir]，经
            # ``_apply_profile_passthrough``（context.py `_PROFILE_PAYLOAD_FIELDS`
            # 逐键 ``in`` 守护）原样透传进 claim payload（snake+camel 双写）→
            # daemon execPayload.effectiveAllowedRoots（daemon.ts:4510-4513）→
            # SessionManager state.effectiveAllowedRoots → 写守卫 policyEngine
            # 分支 session 级 overlay 交集收紧（session-manager.ts task-12 增量）。
            # claim 透传决策（读码结论）：lease metadata 的显式值即单一来源——会话
            # 档案变体 ``apply_session_profile_to_lease``（Grill C-06/NG-03）不写
            # effective_allowed_roots，本注入在其后执行无覆写冲突，context.py 零改动。
            # writable_dir 为空（模型可空，创建时校验非空 ⊆ runtime allowed_roots）
            # → 不注入，退回机器级边界口径（不宽于 task-05 现状）。
            if _platform_binding is not None:
                from app.modules.agent.execution import platform_shared_tool_config

                _platform_meta: dict[str, object] = {
                    "tool_config": platform_shared_tool_config(),
                }
                if _platform_binding.writable_dir:
                    _platform_meta["effective_allowed_roots"] = [_platform_binding.writable_dir]
                await _merge_lease_metadata(
                    self._session,
                    dispatch.lease_id,
                    _platform_meta,
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

            # ── task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-006）：
            # PPM 附件物化行落库（写事务内 flush-only，共用本方法唯一 commit）──
            # 对象本体与降级决策已在写事务外完成（见方法顶部物化段）；此处
            # session.id 已知，session_id 直接回填（跳过 draft 语义）、
            # user_id=创建者，按列写入后并入 validated_attachments 复用下方既有
            # 组装链（标记行/多模态块/落盘/8MB 闸门，daemon 协议零改动）。
            # 不复用 SessionAttachmentService.upload()——其自带 commit 与 PIL/
            # 大小校验，源文件已在 file 中心过上传校验不重复（TaskCard 事务口径）。
            if ppm_prepared_attachments:
                from app.modules.session_attachment.model import (
                    SessionAttachment as _PpmSessionAttachment,
                )

                for _ppm_spec in ppm_prepared_attachments:
                    _ppm_row = _PpmSessionAttachment(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        session_id=session.id,
                        kind=_ppm_spec.kind,
                        media_type=_ppm_spec.media_type,
                        bytes=_ppm_spec.bytes,
                        name=_ppm_spec.name,
                        object_key=_ppm_spec.object_key,
                        sha256=_ppm_spec.sha256,
                    )
                    self._session.add(_ppm_row)
                    validated_attachments.append(_ppm_row)

            # ── ql-20260825-001：附件回填与组装（对齐 inject 路径 task-06 段）──
            # 同事务完成：①session_id 回填（draft→bound 唯一前进迁移）；②多模态
            # 门控判定 + payload 组装（D-4 闸门/降级路由），供下方首 turn
            # SESSION_INJECT 携带（daemon 侧组装多模态块/落盘，2087 行契约）。
            # 无附件路径零分支进入（与现状逐字节一致）。
            create_inject_attachments: list[dict] = []
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

                for _att in validated_attachments:
                    if _att.session_id is None:
                        _att.session_id = session.id
                        self._session.add(_att)

                _gate = await resolve_session_gate(
                    self._session,
                    user_id=user_id,
                    session_llm_provider_id=(
                        llm_provider_row.id if llm_provider_row is not None else None
                    ),
                    agent_kind=provider,
                )
                create_inject_attachments = await assemble_inject_attachments(
                    validated_attachments,
                    supports_multimodal=_gate.supports_multimodal,
                    storage=SessionAttachmentStorage(get_storage_backend()),
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
                    # D-002@v1：显式选择的 model 优先（预会话级联首句）；缺省
                    # 回落供应商配置派生（展示口径与下发 config["model"] 一致）。
                    "model": (
                        model
                        or (
                            (llm_provider_row.model or llm_provider_row.default_fallback_model)
                            if llm_provider_row is not None
                            else None
                        )
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
            # ql-20260825-001：附件标记行插头部（对齐 inject 路径 task-06 D-3，
            # 前端 chips 回显数据源）——[附件:id|kind|name] 逐附件一行。
            _user_input_content = prompt
            if validated_attachments:
                from app.modules.session_attachment.service import (
                    attachment_marker_line,
                )

                _marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
                _user_input_content = f"{_marker_lines}\n{prompt}" if prompt else _marker_lines
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=_user_input_content[:5000],
                    timestamp=now,
                )
            )
            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except Exception:
            await self._session.rollback()
            raise

        # task-02（2026-08-24-sessions-live-updates / design §3）：INSERT 与
        # status→active 激活在同一事务内一体落库（生效点 = 上方 commit），此处
        # 合并发布 created（行出现）+ status_changed（→active）两个列表信号；
        # 若下方派发失败收敛为 failed，_converge_failed_dispatch 会再发一条
        # status_changed，列表最终收敛到终态（轮询兜底语义不受影响）。
        await publish_sessions_changed("created", session.id, session.user_id)
        await publish_sessions_changed("status_changed", session.id, session.user_id)

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
        # task-04（design A2）：走控制指令三段式（落库 pending + WS 推送 +
        # delivered 标记）——WS 失败不再裸丢，daemon 重连补拉兜底。
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
            _create_inject_payload = {
                "session_id": str(session.id),
                "lease_id": str(dispatch.lease_id),
                "run_id": str(run.id),
                # P0 修复（2026-08-26，真实派团队测试发现）：首轮 SESSION_INJECT
                # 必须发 **dispatch_prompt**（含团队简报/变更前导/页面前导拼接），
                # 而非裸 prompt——daemon inject() 消费 SESSION_INJECT 后会清掉
                # firstPrompt 挂起（session-manager _pendingFirstPrompt），lease
                # metadata 的简报版 prompt 永远不会被 fallback 消费。原裸 prompt
                # 导致主控收不到团队简报，把 /team 当普通命令回 Unknown command。
                "prompt": dispatch_prompt,
                # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token，
                # daemon 存入 SessionState.claimToken。
                "claim_token": dispatch.claim_token,
                # design §5.3: payload carries the provider runtime_id so
                # the daemon dispatches to the correct SessionManager.
                "runtime_id": str(dispatch.runtime_id),
            }
            # ql-20260825-001：首句附件随首 turn 下发（对齐 inject 路径——仅
            # 有附件时附加，旧 daemon 忽略未知键，协议向后兼容）。
            if create_inject_attachments:
                _create_inject_payload["attachments"] = create_inject_attachments
            _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
                daemon_id=daemon_id,
                runtime_id=dispatch.runtime_id,
                kind=KIND_SESSION_INJECT,
                payload=_create_inject_payload,
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
        """PPM 条目附件物化/降级（task-03 / FR-03 / D-003/D-006/D-007，写事务外）。

        消费链（design §5 Phase 2）：``item.file_urls`` → uuid 解析过滤（R-03：
        非 uuid 条目直接进降级清单）→ task-01 :func:`load_item_files` 取存活
        File 行 → 逐条 ``FileService._can_access`` 同口径校验（D-007：上传者
        本人/平台管理员；ppm 附件 owner_type 不命中 workspace/agent 锚分支）→
        有权且 provider=claude 且与手动附件合并后 图≤5/文≤5 的条目读 file
        storage bytes → ``SessionAttachmentStorage.store_bytes``（内容寻址
        sha256 去重）产出预备行；其余条目降级为前导文字清单。

        ql-20260828-003 两项修复：

        - ``item`` 可选传参——create_session 前置解析已加载的条目行直接复用，
          全链只查一次 DB（缺省 None 自加载，独立调用/测试路径不变）。
        - IO 并行化——三阶段：①顺序资格判定（纯 DB/内存判断，保图≤5/文≤5
          的顺序水位语义，资格即预占、IO 失败让掉不回补，水位语义可预期）；
          ②资格条目 ``asyncio.gather`` 并行「读源 bytes + store_bytes」（串行
          实现最多 10 附件 × 2 次 IO = 20 次串行网络往返，慢存储下显著拖慢
          会话创建；每条独立兜错）；③按条目原序组装 prepared / 降级行。

        - 降级四类（均不阻塞会话创建，TaskCard GWT-3）：无权 → 仅文件名 +
          「无权访问」；超限 / provider≠claude / 读取失败（``read_failed``）/
          存储失败（``store_failed``）/ File 已删或缺号的有权条目 → 文件名 +
          ``GET /api/file/{file_id}`` 链接（软删/缺号行回查取文件名，查无以
          file_id 兜底）。
        - 纯只读 + storage IO、无 DB 写：``SessionAttachment`` 行 insert 归
          create_session 写事务内（消费返回的 ``_PreparedPpmAttachment``）；
          不复用 ``SessionAttachmentService.upload()``（自带 commit 与 PIL/
          大小校验，源文件已在 file 中心过上传校验不重复）。
        - item 查无（``item`` 传参时由调用方保证存在）或 ``file_urls`` 为空 →
          空产出。
        """
        from app.core.config import get_settings
        from app.modules.auth.model import User as _User
        from app.modules.file.model import File
        from app.modules.file.service import FileService
        from app.modules.session_attachment.service import (
            MAX_FILES_PER_MESSAGE,
            MAX_IMAGES_PER_MESSAGE,
        )
        from app.modules.session_attachment.storage import SessionAttachmentStorage
        from app.modules.storage.factory import get_storage_backend

        if item is None:
            item = await load_ppm_item(self._session, kind, item_id)
        if item is None:
            return [], []
        entries = list(item.file_urls or [])
        if not entries:
            return [], []

        backend = get_storage_backend()
        # D-007：直接复用 FileService 的归属判定（构造范式对齐 agent/service.py
        # borrow 落 file 段：工厂单例 storage/settings，测试经 patch 注入 mock）。
        file_svc = FileService(self._session, backend, get_settings())
        session_store = SessionAttachmentStorage(backend)
        actor = await self._session.get(_User, user_id)

        live_rows = {row.id: row for row in await load_item_files(self._session, kind, item_id)}

        # 与手动 attachment_ids 合并后的数量水位（图≤5/文≤5）——手动侧超限已在上
        # 方整体 422；ppm 侧超限条目走降级清单不 4xx（不阻塞会话创建）。
        image_n = sum(1 for r in manual_attachments if getattr(r, "kind", None) == "image")
        file_n = sum(1 for r in manual_attachments if getattr(r, "kind", None) == "file")

        # ── 阶段 1：顺序资格判定（无 storage IO）──按 file_urls 原序，资格即
        # 预占水位（IO 失败让掉不回补），保「图≤5/文≤5 按原序截断」可预期。
        degrade_lines: list[str] = []
        candidates: list[tuple[File, str]] = []
        for entry in entries:
            # R-03：file_urls 历史数据混有旧 URL 字符串——非 uuid 条目直接进降级清单。
            try:
                file_id = uuid.UUID(str(entry))
            except (ValueError, AttributeError, TypeError):
                degrade_lines.append(str(entry))
                continue
            row = live_rows.get(file_id)
            if row is None:
                # File 已删/缺号：回查行（含软删）取文件名，降级为文件名 + GET 链接。
                soft_row = await self._session.get(File, file_id)
                name = (soft_row.original_name if soft_row is not None else None) or str(file_id)
                degrade_lines.append(f"{name}：GET /api/file/{file_id}")
                continue
            if actor is None or not await file_svc._can_access(user=actor, row=row):
                degrade_lines.append(f"{row.original_name}（无权访问）")
                continue
            if provider != "claude":
                degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
                continue
            entry_kind = "image" if (row.mime_type or "").startswith("image/") else "file"
            if (entry_kind == "image" and image_n >= MAX_IMAGES_PER_MESSAGE) or (
                entry_kind == "file" and file_n >= MAX_FILES_PER_MESSAGE
            ):
                degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
                continue
            if entry_kind == "image":
                image_n += 1
            else:
                file_n += 1
            candidates.append((row, entry_kind))

        # ── 阶段 2：资格条目并行「读源 + 存储」──每条独立兜错（失败返回 None，
        # 阶段 3 按原序降级）；storage 后端无共享会话态，gather 并发安全。
        async def _materialize_one(row: File, entry_kind: str) -> _PreparedPpmAttachment | None:
            # 读 file storage bytes（整体读入；单附件大小已在 file 中心上传侧受限）。
            try:
                data = b"".join(
                    [chunk async for chunk in backend.get_object_stream(row.stored_key)]
                )
            except Exception as exc:
                log.warning(
                    "session_ppm_attachment_read_failed",
                    file_id=str(row.id),
                    error=str(exc),
                )
                return None
            try:
                object_key, sha256 = await session_store.store_bytes(
                    user_id=user_id,
                    data=data,
                    media_type=row.mime_type,
                    name=row.original_name,
                )
            except Exception as exc:
                log.warning(
                    "session_ppm_attachment_store_failed",
                    file_id=str(row.id),
                    error=str(exc),
                )
                return None
            return _PreparedPpmAttachment(
                kind=entry_kind,
                media_type=row.mime_type,
                bytes=len(data),
                name=row.original_name[:255],
                object_key=object_key,
                sha256=sha256,
            )

        io_results = await asyncio.gather(
            *(_materialize_one(row, entry_kind) for row, entry_kind in candidates)
        )

        # ── 阶段 3：按条目原序组装（IO 失败条目降级为 GET 链接）──
        prepared: list[_PreparedPpmAttachment] = []
        for (row, _entry_kind), result in zip(candidates, io_results, strict=True):
            if result is None:
                degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
                continue
            prepared.append(result)
        return degrade_lines, prepared

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

            # task-02：status→failed 收敛已落库，发布列表变更信号（publish
            # 静默容错，不会改变本函数的错误收敛语义）。
            await publish_sessions_changed("status_changed", session.id, session.user_id)

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

    async def _activate_tool_report_session(
        self,
        session: AgentSession,
        user_id: uuid.UUID,
        *,
        prompt: str,
        # P1（2026-08-25 会话路径二审 #2）：切换字段 + 附件透传——原实现只透传
        # prompt，上游「带切换字段或附件豁免空 prompt」后空 prompt 被当首条消息
        # 建首轮，用户附件与切换要求被静默丢弃。现照 create_session 同款语义在
        # 激活事务内应用（校验错误同款：profile 404/403、provider 404/422）。
        agent_profile_id: str | None = None,
        llm_provider_id: str | None = None,
        attachment_ids: list[uuid.UUID] | None = None,
        # 二审 #1：inject_session 主路径取锁前预组装的附件产物（rows/payload/
        # gate 快照）；激活分支复用（gate 基准复核见下方组装段）。
        prelocked_attachments: _PrelockedInjectAttachments | None = None,
    ) -> SessionDispatchResult:
        """懒激活一个未绑定机器的 tool_report 会话（task-05 / design §3.3.4）。

        CLI 工具上报聚合出的会话（``origin='tool_report'``，platform_sync task-04
        创建，``status='pending'`` 且无 lease/runtime）在用户发首条消息继续时调用：
        复刻 :meth:`create_session` 的派发段——建首轮 AgentRun + interactive lease
        （**首条消息即首轮**，prompt 存 lease metadata）+ commit + 唤醒 daemon +
        best-effort SESSION_INJECT。与 create 的差异：

        - **机器选择（D-010 / Grill P1-2）**：不新增成员绑定预检，沿用
          ``prepare_interactive_dispatch`` 内部既有自选（用户自有 first-online +
          workspace shared 借用），与 create「仅 provider 入口」同语义。
        - **cwd**：最新关联 ``platform_agent_logs`` 行（``agent_session_id`` 匹配、
          ``last_seen_at`` 倒序取 1）的 ``agent_cwd``，缺省回落
          ``workspace.root_path``；都无 → None（不设，走普通 quick-chat 语义）。
        - **provider**：保持 task-04 创建时的 D-007 映射，不覆盖。
        - **无在线机器**：``NoOnlineDaemonError``（裸 Exception）转
          :class:`ToolReportActivateNoDaemon`（409 中文），不裸抛 500。
        - **配置/附件（2026-08-25 二审 #2）**：``agent_profile_id`` /
          ``llm_provider_id`` 照 create_session 语义落会话三列 + 首轮 run 快照 +
          lease metadata（``apply_session_profile_to_lease`` /
          ``session_llm_provider_id``）+ config_snapshot 展示键；空串 = "none"
          对未激活会话（本就 NULL）等价不动。附件走 inject 主路径同款机制：
          标记行进 user_input 日志 + draft→bound 回填 + SESSION_INJECT payload
          attachments 键。空 prompt 一律拒绝——daemon ``_startInteractiveSession``
          拒建空 prompt 会话（切换字段/附件必须随首条消息一起发送）。

        Caller（:meth:`inject_session`）已持会话行锁并完成归属校验（user_id 必须
        是会话属主）；本方法成功后直接返回首轮派发结果（不回落
        ``_inject_into_session``——激活已消费首条消息为首轮，再走 inject 会撞
        turn 冲突守卫）。
        """
        # 归档区禁写（2026-08-30 审计④-1）：激活分支在 inject_session 内先于
        # _inject_into_session（守卫所在）提前 return——预会话工作区已归档时，
        # 首条消息激活同样是在归档区建 run/lease 并派发执行，须与共享核心同拦。
        await self._ensure_session_workspace_writable(session)
        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )
        from app.modules.platform_sync.model import AgentSessionLogORM

        # ── 二审 #2：激活分支输入守卫——空 prompt 一律拒绝 ─────────────────────
        # 上游对「带切换字段/附件」豁免空 prompt（ql-20260817-010 / D-7），但激活的
        # 首轮由 lease metadata prompt 驱动 daemon 建 SDK 会话——daemon
        # ``_startInteractiveSession`` 对空 prompt 直接拒建（SESSION_INJECT 路由
        # 同样丢弃空 prompt），空 prompt 激活会留下 pending 死轮。故激活必须携带
        # 首条消息；切换字段/附件随消息一起生效（不再静默丢弃，也不再误建空轮）。
        if not prompt.strip():
            raise DaemonSessionNotActive(
                "该会话尚未激活，请先发送一条消息启动会话（切换配置或附件需随消息一起发送）。",
                details={
                    "session_id": str(session.id),
                    "reason": "activation_requires_message",
                },
            )

        # ── 二审 #2：切换字段解析（校验口径与 create_session 逐字对齐）────────
        # agent_profile_id 空串 = "none" 取消档案：未激活会话本就 NULL，等价不动。
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
            # 读可见性与 GET /agent-profiles?scope=mine 同口径（同 create/inject）。
            profile = await AgentProfileService(self._session).get(
                profile_id=_profile_uuid, actor=_actor
            )

        # llm_provider_id 空串 = "none" 清空：未激活会话本就 NULL，等价不动。
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
            # 归属按会话属主（激活注入者即属主，inject_session 已过归属校验）。
            if llm_provider_row is None or llm_provider_row.user_id != user_id:
                raise DaemonSessionLlmProviderNotFound(
                    f"LlmProvider '{llm_provider_id}' not found.",
                    details={"llm_provider_id": llm_provider_id},
                )
            # FR-06：agent_kind 与会话引擎不匹配 → 422，不静默降级（同 create）。
            if llm_provider_row.agent_kind != session.provider:
                raise DaemonSessionLlmProviderKindMismatch(
                    "LlmProvider agent_kind does not match the session engine.",
                    details={
                        "llm_provider_id": llm_provider_id,
                        "agent_kind": llm_provider_row.agent_kind,
                        "engine": session.provider,
                    },
                )

        # ── 二审 #1/#2：附件解析（预组装复用 / 无预组装兜底，口径同主路径）────
        validated_attachments: list = []
        inject_attachments: list[dict] = []
        if attachment_ids:
            if prelocked_attachments is not None:
                validated_attachments = list(prelocked_attachments.rows)
                # gate 基准复核（对齐 _inject_into_session 组装段）：激活事务内
                # 会话供应商将被本轮参数改写（llm_provider_row.id 或保持 NULL），
                # 与预组装基准一致且引擎不变 → 复用锁外产物；漂移且 supports
                # 翻转 → 锁内重解析重组装（罕见竞态兜底）。
                gate_basis = llm_provider_row.id if llm_provider_row is not None else None
                if (
                    prelocked_attachments.gate_provider_id_basis == gate_basis
                    and prelocked_attachments.agent_kind == session.provider
                ):
                    inject_attachments = list(prelocked_attachments.inject_attachments)
                else:
                    supports = await self._resolve_inject_gate(
                        user_id=session.user_id,
                        gate_provider_id_basis=gate_basis,
                        agent_kind=session.provider or "",
                    )
                    if supports == prelocked_attachments.gate_supports_multimodal:
                        inject_attachments = list(prelocked_attachments.inject_attachments)
                    else:
                        inject_attachments = await self._assemble_inject_attachment_payload(
                            validated_attachments, supports_multimodal=supports
                        )
            else:
                validated_attachments = await self._validate_inject_attachment_rows(
                    session_id=session.id,
                    session_user_id=session.user_id,
                    session_provider=session.provider or "",
                    attachment_ids=attachment_ids,
                )
                supports = await self._resolve_inject_gate(
                    user_id=session.user_id,
                    gate_provider_id_basis=(
                        llm_provider_row.id if llm_provider_row is not None else None
                    ),
                    agent_kind=session.provider or "",
                )
                inject_attachments = await self._assemble_inject_attachment_payload(
                    validated_attachments, supports_multimodal=supports
                )

        now = datetime.now(UTC)
        # ── cwd 解析（design §3.3.4 第 2 点）：最新关联 entry.agent_cwd 优先，
        # 回落 workspace.root_path；两者皆无 → None 不设（cwd 可空）。
        cwd: str | None = None
        latest_entry = (
            await self._session.execute(
                select(AgentSessionLogORM.agent_cwd)
                .where(col(AgentSessionLogORM.agent_session_id) == session.id)
                .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
                .limit(1)
            )
        ).first()
        if latest_entry is not None and latest_entry[0]:
            cwd = latest_entry[0]
        if cwd is None and session.workspace_id is not None:
            from app.modules.workspace.model import Workspace

            ws_row = await self._session.get(Workspace, session.workspace_id)
            if ws_row is not None:
                cwd = ws_row.root_path

        model = (session.config or {}).get("model")
        try:
            # 首轮 run（对齐 create_session :876-894；首轮发送者=激活注入者，
            # 即会话属主——inject_session 已过 _get_owned_session_for_update）。
            # 二审 #2：切换字段照 create_session 落首轮快照（D-008）。
            from app.modules.agent.service import _build_agent_profile_snapshot

            run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=session.provider,
                model=model,
                status="pending",
                spec_strategy="interactive",
                agent_session_id=session.id,
                user_id=user_id,
                agent_profile_id=profile.id if profile is not None else None,
                agent_profile_snapshot=(
                    _build_agent_profile_snapshot(profile) if profile is not None else None
                ),
                llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
            )
            self._session.add(run)
            await self._session.flush()

            placement = RunPlacementService(self._session)
            try:
                dispatch = await placement.prepare_interactive_dispatch(
                    agent_session_id=session.id,
                    agent_run_id=run.id,
                    user_id=user_id,
                    provider=session.provider,
                    prompt=prompt,
                    model=model,
                    workspace_id=session.workspace_id,
                    cwd=cwd,
                )
            except NoOnlineDaemonError as exc:
                # 裸 Exception → 409 中文 AppError（不裸抛 500，design §3.3.4 第 6 点）。
                raise ToolReportActivateNoDaemon(
                    "当前没有可用的在线守护进程，无法继续该会话",
                    details={"session_id": str(session.id)},
                ) from exc

            # ── 二审 #1：附件 draft→bound 回填（同事务，唯一前进迁移）──────────
            for att_row in validated_attachments:
                if att_row.session_id is None:
                    att_row.session_id = session.id
                    self._session.add(att_row)

            # ── 二审 #2：切换字段落 lease metadata（同 create_session 口径）────
            # 档案：system_prompt + mcp/skill 维度键（apply_session_profile_to_lease
            # 非 commit 变体）；供应商：独立 key session_llm_provider_id（claim 端
            # _inject_provider_config 最高优先级分支消费）。
            if profile is not None:
                from app.modules.agent.service import AgentService

                await AgentService(self._session).apply_session_profile_to_lease(
                    dispatch.lease_id, profile
                )
            if llm_provider_row is not None:
                await _merge_lease_metadata(
                    self._session,
                    dispatch.lease_id,
                    {"session_llm_provider_id": str(llm_provider_row.id)},
                )

            # 回填三元组 + 激活（对齐 create_session :954-958：turn_count 置 1，
            # 首条消息即首轮）。二审 #2：会话配置三列 + config_snapshot 展示键
            # （profile_name/provider_name/model，仅选中才写；machine/agent 名
            # 为既有必写键）。
            session.runtime_id = dispatch.runtime_id
            session.lease_id = dispatch.lease_id
            session.status = "active"
            session.turn_count = 1
            session.last_active_at = now
            if cwd is not None:
                session.cwd = cwd
            session.agent_profile_id = profile.id if profile is not None else None
            session.llm_provider_id = llm_provider_row.id if llm_provider_row is not None else None
            # config_snapshot 补 machine_name/agent_name（design §3.3.4 第 4 点，
            # 展示用）：保留 task-04 写入的 harness 等既有键。
            machine_name, agent_name = await self._resolve_runtime_labels(dispatch.runtime_id)
            snapshot = dict(session.config_snapshot or {})
            snapshot["machine_name"] = machine_name
            snapshot["agent_name"] = agent_name
            if profile is not None or llm_provider_row is not None:
                snapshot["profile_name"] = profile.name if profile is not None else None
                snapshot["provider_name"] = (
                    llm_provider_row.name if llm_provider_row is not None else None
                )
                snapshot["model"] = (
                    (llm_provider_row.model or llm_provider_row.default_fallback_model)
                    if llm_provider_row is not None
                    else None
                )
                snapshot["engine"] = session.provider
            session.config_snapshot = snapshot
            self._session.add(session)

            # 首 turn user_input 日志（对齐 create_session :986-993，列表标题派生
            # 与历史回放依赖该行）。二审 #2：附件标记行插头部（D-3，口径与
            # _inject_into_session 主路径一致——[附件:id|kind|name] 逐附件一行）。
            user_input_content = prompt
            if validated_attachments:
                from app.modules.session_attachment.service import (
                    attachment_marker_line,
                )

                marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
                user_input_content = f"{marker_lines}\n{prompt}" if prompt else marker_lines
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=user_input_content[:5000],
                    timestamp=now,
                )
            )
            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        # task-02：status→active（CLI 会话懒激活）已随上方 commit 落库，发布
        # 列表变更信号（created 由 platform_sync 插入分支负责，此处只发激活）。
        await publish_sessions_changed("status_changed", session.id, session.user_id)

        # commit 成功 → 唤醒 daemon（对齐 create_session :1001-1020：失败收敛
        # 刚提交的三元组为 failed 终态后抛 DaemonRuntimeOffline）。
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

        # best-effort SESSION_INJECT 携带首条消息（对齐 create_session :1022-1065：
        # 唤醒已信号 lease，控制消息让 daemon SessionManager 拿到确切首 prompt；
        # 等 session ready 再发，超时 fallback 仍发兼容不上报 ready 的旧 daemon）。
        # task-04（design A2）：走控制指令三段式——WS 失败落库 pending 待补拉。
        daemon_id = await _resolve_daemon_id_for_runtime(self._session, dispatch.runtime_id)
        ready = await get_session_readiness().wait(session.id, timeout=8)
        if not ready:
            log.warning("session_ready_timeout", session_id=str(session.id))
        control_ok = False
        if daemon_id is not None:
            inject_payload = {
                "session_id": str(session.id),
                "lease_id": str(dispatch.lease_id),
                "run_id": str(run.id),
                "prompt": prompt,
                # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token。
                "claim_token": dispatch.claim_token,
                "runtime_id": str(dispatch.runtime_id),
            }
            # 二审 #2：附件随激活首轮下发（D-4，同主路径 inject——仅在有附件时
            # 附加，旧 daemon 忽略未知键，协议向后兼容）。
            if inject_attachments:
                inject_payload["attachments"] = inject_attachments
            _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
                daemon_id=daemon_id,
                runtime_id=dispatch.runtime_id,
                kind=KIND_SESSION_INJECT,
                payload=inject_payload,
            )
        if not control_ok:
            # 唤醒已送达但控制消息发送失败：daemon 仍会 claim lease（metadata 含
            # prompt），不因控制消息失败判定会话失败，仅留观测日志（对齐 create）。
            log.warning(
                "tool_report_activation_control_send_failed",
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

    async def _validate_inject_attachment_rows(
        self,
        *,
        session_id: uuid.UUID,
        session_user_id: uuid.UUID,
        session_provider: str,
        attachment_ids: list[uuid.UUID],
    ) -> list:
        """附件校验（2026-08-20 task-05 D-6 三层门控：引擎 / 归属 404 / 数量 422）。

        P1（2026-08-25 会话路径二审 #1）：从 _inject_into_session 锁内抽出为共享
        helper——取锁前预组装（:meth:`_preassemble_inject_attachments`）与锁内
        兜底（service 身份路径 / 直调方不带预组装时）复用同一判定，语义不变。
        附件归属约束在附件行自身（``user_id``）、引擎建后不可变，均不依赖会话
        行可变状态，前后置判定等价。
        """
        if session_provider != "claude":
            raise DaemonSessionAttachmentsUnsupported(
                "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
                details={"session_id": str(session_id), "provider": session_provider},
            )
        from app.modules.session_attachment.model import SessionAttachment

        rows = (
            (
                await self._session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.id.in_(attachment_ids),
                        SessionAttachment.user_id == session_user_id,
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
        return [by_id[i] for i in dict.fromkeys(attachment_ids) if i in by_id]

    async def _resolve_inject_gate(
        self,
        *,
        user_id: uuid.UUID,
        gate_provider_id_basis: uuid.UUID | None,
        agent_kind: str,
    ) -> bool:
        """多模态门控判定（D-9）。返回 ``supports_multimodal``。

        ``gate_provider_id_basis`` = 本轮将生效的会话供应商 id（切换轮为新值、
        激活轮为激活参数值、否则当前值）——预组装与锁内复核用同一口径计算基准，
        两者比较即「预读与取锁之间供应商是否漂移」。
        """
        from app.modules.session_attachment.capability import resolve_session_gate

        gate = await resolve_session_gate(
            self._session,
            user_id=user_id,
            session_llm_provider_id=gate_provider_id_basis,
            agent_kind=agent_kind,
        )
        return gate.supports_multimodal

    async def _assemble_inject_attachment_payload(
        self,
        rows: list,
        *,
        supports_multimodal: bool,
    ) -> list[dict]:
        """附件 → SESSION_INJECT payload attachments 列表（D-4 闸门/降级路由）。

        内部经对象存储读字节（MinIO）——P1（二审 #1）后本调用只出现在取锁前的
        预组装段，或锁内 gate 漂移且 supports 翻转的罕见竞态兜底。
        """
        from app.modules.session_attachment.service import assemble_inject_attachments
        from app.modules.session_attachment.storage import SessionAttachmentStorage
        from app.modules.storage.factory import get_storage_backend

        return await assemble_inject_attachments(
            rows,
            supports_multimodal=supports_multimodal,
            storage=SessionAttachmentStorage(get_storage_backend()),
        )

    async def _preassemble_inject_attachments(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        llm_provider_id: str | None,
        attachment_ids: list[uuid.UUID] | None,
    ) -> _PrelockedInjectAttachments | None:
        """P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO 组装
        **移到会话行锁之前**。

        原路径在 FOR UPDATE 行锁内做 ``storage.read_bytes``（附件上限 5MB×5
        图片 + 20MB×5 文件），对象存储慢时同会话的并发 inject/interrupt/end 全部
        在行锁上排队、长事务占连接。附件归属/引擎/数量校验不依赖会话行可变状态
        → 安全前置；会话可注入状态（status / lease / 活跃 turn / 切换决策）不
        在此判定，取锁后由 ``_inject_into_session`` / 激活分支**重校验**兜住
        「预读与取锁之间被并发 end/interrupt 改状态」的竞态。

        归属校验用普通读（无 FOR UPDATE）：缺失/跨用户仍 :class:`DaemonSessionNotFound`
        404 不泄露存在性（与 ``_get_owned_session_for_update`` 同错误）。

        gate 基准 = 本轮将生效的会话供应商 id：携带 ``llm_provider_id``（切换/
        激活参数）且可解析时为新值，否则取当前值——与锁内切换列刷新后 / 激活
        事务内回填后的 ``session.llm_provider_id`` 同口径。非法 id 不在此报错
        （保持锁内 ``DaemonSessionConfigInvalid`` 原语义），基准退回当前值；锁内
        复核发现基准漂移会重解析 gate，正确性不依赖预读。
        """
        if not attachment_ids:
            return None
        pre = (
            await self._session.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if pre is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        rows = await self._validate_inject_attachment_rows(
            session_id=session_id,
            session_user_id=pre.user_id,
            session_provider=pre.provider or "",
            attachment_ids=attachment_ids,
        )
        gate_basis = pre.llm_provider_id
        if llm_provider_id:
            try:
                gate_basis = uuid.UUID(llm_provider_id)
            except (ValueError, AttributeError, TypeError):
                # 非法 id 由锁内 DaemonSessionConfigInvalid 拒绝；基准保持当前值。
                pass
        supports = await self._resolve_inject_gate(
            user_id=pre.user_id,
            gate_provider_id_basis=gate_basis,
            agent_kind=pre.provider or "",
        )
        payload = await self._assemble_inject_attachment_payload(rows, supports_multimodal=supports)
        return _PrelockedInjectAttachments(
            rows=rows,
            inject_attachments=payload,
            gate_supports_multimodal=supports,
            gate_provider_id_basis=gate_basis,
            agent_kind=pre.provider or "",
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
        # task-11（2026-08-29-usage-by-provider-model / FR-03-3 / FR-03-4 /
        # D-002@v1）：会话级模型选择（三态，与 llm_provider_id None/空串语义
        # 同构）：None=不动（零回归）；空串=显式「跟随供应商配置」重置；
        # 非空=显式选模型（构成切换轮，R-07 兜底模型快照级同步见
        # _inject_into_session 切换段）。
        model: str | None = None,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用（D-7 豁免
        # 空 prompt；引擎/归属/数量校验见 _inject_into_session；组装下发归 task-06）。
        attachment_ids: list[uuid.UUID] | None = None,
        # ql-20260825-004：每轮注入携带当前页面上下文。
        page_context: PageContextCreateBlock | None = None,
        # task-07（2026-08-26-session-input-mention / FR-06 / D-003）：@ 联想绑定
        # 字段——经幂等 binder 落 M:N link（见下方「会话绑定」段插入点说明），
        # 不注入 prompt 前导；缺省 None = 不绑定（零回归）。
        bind_change_key: str | None = None,
        bind_quick_id: str | None = None,
        # task-02（2026-08-28-session-ppm-task-binding / FR-02 / D-005@v1）：@ 联想
        # 选中 PPM 任务/问题的追问绑定成对字段——见下方「PPM 条目追问绑定」段
        # （load_ppm_item 校验 + bind_session_to_ppm_item 幂等追加，不注入前导）；
        # 缺省 None = 不绑定（零回归）。
        bind_ppm_item_kind: PpmItemKind | None = None,
        bind_ppm_item_id: uuid.UUID | None = None,
        # ql-20260825-011：忙轮（已有活跃 run）时入队而不是 409 拒绝（后端真实
        # 排队，刷新页面不丢）。默认 False 保持既有拒绝语义（service 身份路径 /
        # 平台审批代写等调用方零回归）；前端会话 UI 置 True。
        queue_when_busy: bool = False,
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

        task-11（2026-08-29-usage-by-provider-model / FR-03-3 / design §4.2）：
        ``model`` 三态——None=不动（零回归）；空串=显式「跟随供应商配置」重置；
        非空=显式选模型（模型依赖供应商——本入口守卫：未显式携带非空
        ``llm_provider_id`` → 422）。②③ 都构成切换轮，下发 daemon 的
        ProviderConfig 快照同步 ``default_fallback_model=model``（R-07 消兜底
        遮蔽），见 :meth:`_inject_into_session`。

        P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO 组装在
        取锁前完成（:meth:`_preassemble_inject_attachments`，普通读）——行锁窗口
        只含可注入状态判定 + 写入；锁内复核 gate 基准漂移（见组装段）。
        """
        # task-11（FR-03-3）：模型依赖供应商——model 非空而本次请求未显式携带
        # 非空 llm_provider_id（None/空串）→ 422。口径单一来源在本入口（HTTP
        # inject 路由 / 激活分支统一覆盖；空 prompt 豁免条件无需扩——model 非空
        # ⟹ llm_provider_id 非空，已被既有豁免覆盖）。
        if model and not (llm_provider_id or "").strip():
            raise DaemonSessionConfigInvalid(
                "模型依赖供应商：选择模型时必须同时指定供应商。",
                details={"reason": "model_requires_provider", "model": model},
            )
        # ql-20260817-010：静默切换——携带切换字段时允许空 prompt（切换轮无用户
        # 消息/模型回应，daemon 只 reload 配置）；纯追问仍要求非空。
        # 2026-08-20 task-05（D-7）：附件非空也豁免空 prompt（看图说话）。
        # 2026-08-27-background-subagent-progress task-07（FR-08 / D-004@v1）：
        # 空 prompt（含全空白）→ SessionEmptyPrompt 422 中文文案；校验在取锁 /
        # 附件预读 / 忙轮入队（queue_when_busy）之前——空消息不进队列、不建
        # run、不写 user_input 行。空判权威唯一在此（DTO 层不再重复判空，切换 /
        # 附件豁免口径单一来源，见 SessionInjectRequest docstring）。
        if not (prompt or "").strip():
            if agent_profile_id is None and llm_provider_id is None and not attachment_ids:
                raise SessionEmptyPrompt(
                    "消息内容不能为空",
                    details={"reason": "empty_prompt"},
                )
            prompt = ""

        try:
            # ── P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO
            # 组装移到会话行锁之前（对象存储慢读不再占用 FOR UPDATE 行锁，同会话
            # 并发 inject/interrupt/end 不在锁上排队）。锁内 _inject_into_session
            # / 激活分支重校验会话可注入状态 + gate 基准漂移（见其组装段注释）。
            prelocked_attachments = await self._preassemble_inject_attachments(
                session_id,
                user_id,
                llm_provider_id=llm_provider_id,
                attachment_ids=list(attachment_ids) if attachment_ids else None,
            )
            if prelocked_attachments is not None:
                # 收口预读只读事务（释放快照/事务占用，expire_on_commit=False 下
                # 预读 rows 仍可用）：FOR UPDATE 锁窗口只含锁定 + 依赖可变状态的
                # 判定与写入，尽快 commit。
                await self._session.commit()
            session = await self._get_owned_session_for_update(session_id, user_id)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise
        # ── task-07（2026-08-26-session-input-mention / FR-06 / D-003）：会话绑定 ──
        # @ 联想选中项落 M:N link（bind_session_to_change / bind_session_to_quicklog
        # 幂等 best-effort：savepoint + log.warning 自吞异常，失败不阻断消息发送，
        # 本层不重复 try/except）。插入点（design §4.2）：归属校验+行锁之后、
        # tool_report 懒激活早退与忙轮排队早退**之前**——两条早退分支都会先经过
        # 这里，绑定不丢失；workspace 取会话自有值，None 时照抄 create 路径守卫
        # （link 行 workspace_id NOT NULL）记 warning 跳过。跨 workspace change_key
        # 维持 binder 既有 placeholder 行为（仅在会话自有工作区建行，D-004）。
        if bind_change_key or bind_quick_id:
            bind_workspace_id = session.workspace_id
            if bind_workspace_id is None:
                log.warning(
                    "session_bind_skipped_no_workspace",
                    session_id=str(session.id),
                    bind_change_key=bind_change_key,
                    bind_quick_id=bind_quick_id,
                )
            else:
                from app.modules.change.binding import (
                    bind_session_to_change,
                    bind_session_to_quicklog,
                )

                if bind_change_key:
                    await bind_session_to_change(
                        self._session, bind_workspace_id, bind_change_key, session.id
                    )
                if bind_quick_id:
                    await bind_session_to_quicklog(
                        self._session, bind_workspace_id, bind_quick_id, session.id
                    )
                # 日志语义修正（缺陷收口 A-2）：binder 内部 savepoint 自吞异常
                # 且无返回值，调用后无条件打日志无法区分「已落库」与「被吞失败」
                # ——事件名用 session_bind_requested 表达「已请求绑定」而非
                # 「已落库」；绑定是否真实落库以 change_session_links /
                # quicklog_session_links link 表为准（binder 失败时自身会记
                # log.warning）。不改 binder 签名（不在本变更文件清单内）。
                log.info(
                    "session_bind_requested",
                    session_id=str(session.id),
                    workspace_id=str(bind_workspace_id),
                    bind_change_key=bind_change_key,
                    bind_quick_id=bind_quick_id,
                )
        # ── task-02（2026-08-28-session-ppm-task-binding / FR-02 / D-005@v1）：
        # PPM 条目追问绑定──bind_ppm_item_* 成对携带时 load_ppm_item 校验
        # 条目存在性（不存在仅 warning 跳过，§9 降级不报错、消息照常派发）→
        # bind_session_to_ppm_item 幂等追加 link（savepoint best-effort，失败不
        # 阻断消息发送，本层不重复 try/except）；**不注入 prompt 前导**（task-03
        # 已在 create_session 落前导/附件物化；追问路径按 design §5 Phase 4 只写
        # link 不注入前导，对齐 bind_quick_id 行为）。workspace 取会话自身
        # workspace_id 传参（对齐 bind_session_to_quicklog 模式；本表列可空，
        # 会话无工作区时 link 快照留 None，不设跳过守卫）。
        if bind_ppm_item_kind is not None and bind_ppm_item_id is not None:
            _ppm_item = await load_ppm_item(self._session, bind_ppm_item_kind, bind_ppm_item_id)
            if _ppm_item is None:
                log.warning(
                    "session_ppm_bind_item_missing",
                    kind=bind_ppm_item_kind,
                    item_id=str(bind_ppm_item_id),
                    session_id=str(session.id),
                )
            else:
                await bind_session_to_ppm_item(
                    self._session,
                    workspace_id=session.workspace_id,
                    kind=bind_ppm_item_kind,
                    item_id=bind_ppm_item_id,
                    session_id=session.id,
                )
                # 事件名语义对齐上方 A-2 口径：表达「已请求绑定」，真实落库以
                # ppm_item_session_links 表为准（binder 失败时自身记 warning）。
                log.info(
                    "session_bind_requested",
                    session_id=str(session.id),
                    workspace_id=str(session.workspace_id),
                    bind_ppm_item_kind=bind_ppm_item_kind,
                    bind_ppm_item_id=str(bind_ppm_item_id),
                )
        # ── task-05（design §3.3.4 / D-010）：tool_report 会话懒激活分支 ──────────
        # CLI 工具上报聚合出的「本地 Agent 会话」（origin='tool_report'，创建时
        # status='pending' 且无 lease/runtime）首次被用户继续（首条消息）时，才
        # 绑定机器建 interactive lease——首条消息即首轮（prompt 存 lease metadata
        # 并下发 SESSION_INJECT），激活成功直接返回激活派发结果；已激活（lease
        # 存在）的 tool_report 会话与 origin 缺省的 chat 会话不进本分支，走既有
        # inject 路径零回归（design §3.3.4 第 5 点）。
        # 二审 #2：切换字段（agent_profile_id/llm_provider_id）与附件透传进激活
        # 事务（照 create_session 语义落配置，附件随首轮下发），不再静默丢弃。
        # task-11（2026-08-29-usage-by-provider-model）：激活轮暂不支持会话级选
        # 模型——激活路径的供应商配置经 claim 链组装（lease/context），快照级
        # model 同步不在本 task 范围；显式 422 拒绝而非静默丢弃（铁律：不吞参数）。
        if getattr(session, "origin", "chat") == "tool_report" and session.lease_id is None:
            if model:
                raise DaemonSessionConfigInvalid(
                    "该会话尚未激活，暂不支持在激活消息中切换模型；请激活后再选模型。",
                    details={
                        "reason": "activation_model_unsupported",
                        "session_id": str(session.id),
                    },
                )
            return await self._activate_tool_report_session(
                session,
                user_id,
                prompt=prompt,
                agent_profile_id=agent_profile_id,
                llm_provider_id=llm_provider_id,
                attachment_ids=list(attachment_ids) if attachment_ids else None,
                prelocked_attachments=prelocked_attachments,
            )
        return await self._inject_into_session(
            session,
            prompt=prompt,
            # ql-20260817-003：轮次发送者=实际注入者。
            run_sender_user_id=user_id,
            # sessions-portal task-05：切换参数透传共享核心（service 路径不传=零回归）。
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            # task-11：会话级模型选择透传（None/空串=不选，零回归）。
            model=model,
            # 2026-08-20 task-05：附件透传（None → 空列表零回归）。
            attachment_ids=list(attachment_ids) if attachment_ids else None,
            # P1（二审 #1）：取锁前预组装产物（rows + payload + gate 快照）。
            prelocked_attachments=prelocked_attachments,
            # ql-20260825-004：页面上下文透传。
            page_context=page_context,
            # ql-20260825-011：忙轮入队透传。
            queue_when_busy=queue_when_busy,
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
        # 2026-08-27-background-subagent-progress task-07（FR-08 / D-004@v1）：
        # 与 inject_session 入口同口径——空 prompt（含全空白）→ SessionEmptyPrompt
        # 422；service 身份路径无切换字段/附件，无豁免分支。
        if not (prompt or "").strip():
            raise SessionEmptyPrompt(
                "消息内容不能为空",
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

    async def _ensure_session_workspace_writable(self, session: AgentSession) -> None:
        """ql-20260829-011：归档区存量会话只读守卫。

        会话挂工作区且该工作区已归档 → 409 WorkspaceArchived（统一守卫
        ``WorkspaceService.ensure_writable``，与创建会话/发起变更同口径）；
        非工作区会话（workspace_id null）不拦。inject 主路径/service 身份路径
        与 interrupt 共用本守卫。
        """
        if session.workspace_id is None:
            return
        from app.modules.workspace.model import Workspace
        from app.modules.workspace.service import WorkspaceService

        ws = await self._session.get(Workspace, session.workspace_id)
        if ws is not None:
            WorkspaceService.ensure_writable(ws)

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
        # task-11（2026-08-29-usage-by-provider-model / FR-03-3）：会话级模型选择
        # （三态：None=不动；空串=显式重置跟随供应商配置；非空=显式选模型——
        # 守卫在 inject_session 入口，本方法的直调方不携带）。②③ 均构成切换轮
        # （进 SESSION_SWITCH_CONFIG 分支）。
        model: str | None = None,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用（None → 零
        # 回归）。校验（引擎门控/归属/数量）在本方法事务内；组装下发归 task-06。
        attachment_ids: list[uuid.UUID] | None = None,
        # P1（2026-08-25 会话路径二审 #1）：inject_session 主路径取锁前预组装的
        # 附件产物（校验过的 rows + payload + gate 快照）；None = 调用方未预组
        # 装（service 身份路径 / 直调），走锁内原校验兜底。
        prelocked_attachments: _PrelockedInjectAttachments | None = None,
        # ql-20260825-004：每轮注入携带当前页面上下文（build_page_context_preamble
        # 服务端回查注入【页面上下文】前导，复用 create 路径逻辑）。
        page_context: PageContextCreateBlock | None = None,
        # ql-20260825-011：忙轮入队开关（语义见 inject_session 同名参数）。
        queue_when_busy: bool = False,
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

        task-11（2026-08-29-usage-by-provider-model / FR-03-3、FR-03-4 / R-07）：
        ``model`` 三态（与 ``llm_provider_id`` None/空串语义同构）——None=不动
        （普通轮/纯档案切换零回归）；空串=显式「跟随供应商配置」重置；非空=
        显式选模型（→ 切换分支，daemon reload 重建 driver，ANTHROPIC_MODEL
        生效），且下发 daemon 的 ProviderConfig 快照同步 ``model=model`` 且
        ``default_fallback_model=model``（credential-injector 规则3 优先级
        ``default_fallback_model ?? model``，不同步会被供应商兜底模型静默遮蔽；
        快照级覆盖，不动 llm_providers 原配置）。空串/切供应商时随供应商原配置
        重置（无旧模型残留），纯档案切换（不带 model 键）不动模型（沿用会话
        已选，含下发快照同步）；config_snapshot.model 回填本轮生效模型（展示用）。
        """
        session_id = session.id
        now = datetime.now(UTC)
        try:
            # ql-20260829-011：归档区存量会话只读——共享核心入口统一拦（覆盖用户
            # inject / 平台审批代写 / 激活分支三路径），409 早于 status/lease
            # 判定；置于 try 内借既有 AppError rollback 收敛行锁事务。
            await self._ensure_session_workspace_writable(session)
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
                # ql-20260825-011（后端真实排队）：忙轮不再无条件 409——
                # queue_when_busy=True 的调用方（前端会话 UI）改落排队表，
                # run 终态后由 dispatch_next_queued_message 自动派发；默认
                # False 保持既有 DaemonSessionTurnConflict 拒绝语义（service
                # 身份路径 / 平台审批代写零回归）。入队仍在锁内判定，满员
                # 检查与写行原子（并发双发不会超上限）。
                if not queue_when_busy:
                    raise DaemonSessionTurnConflict(
                        f"Session '{session_id}' already has an active run '{current.id}'.",
                        details={
                            "session_id": str(session_id),
                            "current_run_id": str(current.id),
                        },
                    )
                pending_count = len(
                    (
                        await self._session.execute(
                            select(AgentSessionQueuedMessage.id).where(
                                AgentSessionQueuedMessage.agent_session_id == session.id,
                                AgentSessionQueuedMessage.status == "pending",
                            )
                        )
                    ).all()
                )
                if pending_count >= SESSION_QUEUE_MAX_PENDING:
                    raise DaemonSessionQueueFull(
                        f"会话排队消息已达上限（{SESSION_QUEUE_MAX_PENDING} 条），"
                        "请等当前本轮结束后再发送。",
                        details={
                            "session_id": str(session_id),
                            "pending": pending_count,
                        },
                    )
                # ql-20260827-015：通知合并——同会话已有 pending 的「[后台任务通知]」
                # 条目时并入不新增行（行锁内查询 + 更新，与满员检查同事务原子）。
                # 返回形态与普通入队一致（queued=True + 同 entry id），daemon 调用
                # 方无感。
                existing_notification: AgentSessionQueuedMessage | None = None
                if prompt.startswith(TASK_WAKEUP_PROMPT_PREFIX):
                    existing_notification = (
                        await self._session.execute(
                            select(AgentSessionQueuedMessage).where(
                                AgentSessionQueuedMessage.agent_session_id == session.id,
                                AgentSessionQueuedMessage.status == "pending",
                                AgentSessionQueuedMessage.prompt.like(
                                    f"{TASK_WAKEUP_PROMPT_PREFIX}%"
                                ),
                            )
                        )
                    ).scalar_one_or_none()
                if existing_notification is not None:
                    existing_notification.prompt = _merge_task_wakeup_prompt(
                        existing_notification.prompt or "", prompt
                    )
                    self._session.add(existing_notification)
                    await self._session.commit()
                    await self._publish_session_event(
                        session.id,
                        {
                            "event": "queue_changed",
                            "session_id": str(session.id),
                            "queue_entry_id": str(existing_notification.id),
                            "action": "merged",
                        },
                    )
                    return SessionDispatchResult(
                        agent_session=session,
                        agent_run=None,
                        lease_id=None,
                        queued=True,
                        queue_entry_id=existing_notification.id,
                    )
                entry = AgentSessionQueuedMessage(
                    agent_session_id=session.id,
                    sender_user_id=run_sender_user_id or session.user_id,
                    prompt=prompt,
                    attachment_ids=([str(a) for a in attachment_ids] if attachment_ids else None),
                    page_context=(
                        page_context.model_dump(mode="json", exclude_none=True)
                        if page_context is not None
                        else None
                    ),
                    agent_profile_id=agent_profile_id,
                    llm_provider_id=llm_provider_id,
                    status="pending",
                )
                self._session.add(entry)
                await self._session.commit()
                await self._session.refresh(entry)
                await self._publish_session_event(
                    session.id,
                    {
                        "event": "queue_changed",
                        "session_id": str(session.id),
                        "queue_entry_id": str(entry.id),
                        "action": "enqueued",
                    },
                )
                return SessionDispatchResult(
                    agent_session=session,
                    agent_run=None,
                    lease_id=None,
                    queued=True,
                    queue_entry_id=entry.id,
                )

            # ── 2026-08-20 task-05：附件校验（D-6 引擎门控 / 归属 404 / 数量 422）──
            # P1（2026-08-25 二审 #1）：inject_session 主路径已在取锁前完成校验
            # （prelocked_attachments.rows），锁内直接复用行；不带预组装的调用方
            # （inject_session_as_service / 直调）走原地校验兜底（:meth:
            # `_validate_inject_attachment_rows`，判定与原实现逐字节一致）。
            # 组装（base64 内联/降级路由/标记行/回填）见下方 task-06 段；
            # 本段只做整体拒绝（不部分生效）：任一校验失败 raise → 事务回滚。
            validated_attachments: list = []
            if attachment_ids and prelocked_attachments is None:
                validated_attachments = await self._validate_inject_attachment_rows(
                    session_id=session_id,
                    session_user_id=session.user_id,
                    session_provider=session.provider or "",
                    attachment_ids=attachment_ids,
                )
            elif prelocked_attachments is not None:
                validated_attachments = list(prelocked_attachments.rows)

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

            # ── task-11（2026-08-29-usage-by-provider-model / FR-03-3 / design §4.2）：
            # 会话级模型选择解析（三态，与 llm_provider_id None/空串语义同构）：
            # ① None（不带键）= 不动——普通轮/纯档案切换零回归（前端聊天路径
            # 恒不带 model 键）；② 空串 = 显式「跟随供应商配置」重置（前端切模
            # 型选「默认」、切供应商级联重置均发空串）；③ 非空 = 显式选模型
            # （依赖供应商——守卫在 inject_session 入口）。②③ 都构成切换轮（进
            # SESSION_SWITCH_CONFIG 分支，daemon reload 重建 driver 使
            # ANTHROPIC_MODEL 生效）。
            selected_model: str | None = None
            model_reset = False
            if model is None:
                pass
            elif model.strip():
                selected_model = model
            else:
                model_reset = True

            config_switch = (
                profile_changed or provider_changed or selected_model is not None or model_reset
            )

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

            # ── task-11（FR-03-3 / design §4.2）：本轮生效模型（config_snapshot
            # 展示与下发 providerConfig 同步的单一口径）─────────────────────────
            # ① 显式选模型 → 所选；② 显式切供应商（含空串清空）→ 重置回新供应
            # 商原配置（避免旧供应商所选模型残留）；③ model 空串「跟随配置」→
            # 重置回当前供应商原配置；④ 纯档案切换/供应商等值（不带 model 键）→
            # 会话级模型**不动**（沿用此前所选；无历史快照的旧会话回落供应商原
            # 配置，与 task-05 重算口径一致）。model_override 标记「生效模型是
            # 会话级选择」（非供应商原配）——下发 providerConfig 时才做 R-07
            # 快照同步；重置场景（②③）保持原样透传零回归。
            prior_model = (session.config_snapshot or {}).get("model")
            provider_original = (
                (effective_provider.model or effective_provider.default_fallback_model)
                if effective_provider is not None
                else None
            )
            if selected_model is not None:
                effective_model: str | None = selected_model
                model_override = True
            elif provider_changed:
                effective_model = (
                    (provider_row.model or provider_row.default_fallback_model)
                    if provider_row is not None
                    else None
                )
                model_override = False
            elif model_reset:
                effective_model = provider_original
                model_override = False
            elif prior_model is not None:
                effective_model = prior_model
                model_override = True
            else:
                effective_model = provider_original
                model_override = False

            config = dict(session.config or {})
            # ── 2026-08-22-team-session-unify task-04 / D-009@v1：主控轮双标记 ──
            # 会话存在活跃 mission（未收敛未取消，R-07 单活跃约束保证至多一条）时，
            # 当轮 AgentRun 回填 mission_id + role='orchestrator'——该 run 即"主控
            # run"（task-05 懒建补回填 / task-06 _get_main_run·finalizer 锚点 /
            # task-08 patrol 主控存续判定消费）。建 run 前查询 + 同事务落库：任一
            # 环节失败整体回滚，不落半标记；上方 turn 冲突守卫（:1232）保证单活
            # 跃轮，双标记时序安全（design §5 Phase 1）。无活跃 mission 时此处为
            # None → run 不带标记，既有行为逐字节不变。
            from app.modules.agent.mission import get_active_mission_for_session
            from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

            active_mission = await get_active_mission_for_session(self._session, session_id)
            # objective 占位回填（CC-09）：预建 mission 的 objective 为占位时，以
            # 首条带消息文本的 inject 回填——文本口径=用户 prompt 原文（附件标记
            # 行不参与，非 user_input_content）；回填后非占位，后续轮不再覆盖；
            # 纯配置切换轮（空 prompt）无消息文本，不消耗首条名额。
            if (
                active_mission is not None
                and active_mission.objective == SESSION_OBJECTIVE_PLACEHOLDER
                and prompt.strip()
            ):
                active_mission.objective = prompt
                self._session.add(active_mission)
            # ── 2026-08-24 task-08 / FR-01 / D-004@v1：主控首轮简报判定（inject 侧）──
            # task-06 组合入口（活跃 mission 查询 + 三条件判定 + 简报组装）：空
            # prompt 切换轮不注入不消耗、已消耗 orchestrator run 不再注、failed
            # 不烧断（D-013@v1）；简报内容单一来源在 mission_context，本处只做
            # 判定调用。必须建 run 前判定——当轮 run 落库即 pending orchestrator，
            # 判定会被自身短路（懒建回填同款机理，D-003@v1）。未命中返回 None →
            # 下方 SESSION_INJECT payload 原样透传（无 mission 会话逐字节不变）。
            from app.modules.agent.mission_context import resolve_first_turn_briefing

            first_turn_briefing = await resolve_first_turn_briefing(
                self._session, session_id, prompt
            )
            # task-08 / D-013@v1（Grill CC-12）：空 prompt 纯切换轮无 LLM turn，不是
            # 主控轮——不落双标记。否则该轮 run 落库即 completed orchestrator run，
            # 会烧断简报一次性名额（与「纯切换轮不注入也不消耗」的验收口径冲突，
            # CC-12 关切正是"空 prompt 切换轮被双标记消耗一次性简报"）。带文本的
            # 切换轮是真 LLM 轮，照常双标记。
            silent_config_switch = config_switch and not prompt.strip()
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
                # task-04 / D-009：主控轮双标记——活跃 mission 命中时当轮回填
                # （role 字面量同 orchestrator.py _ORCHESTRATOR_ROLE 存量语义）；
                # task-08：纯切换轮例外不标记（见上方 silent_config_switch 注释）。
                mission_id=(
                    active_mission.id
                    if active_mission is not None and not silent_config_switch
                    else None
                ),
                role=(
                    "orchestrator"
                    if active_mission is not None and not silent_config_switch
                    else None
                ),
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
                    # task-11（FR-03-4）：回填本轮生效模型（显式所选 / 供应商原配
                    # / 纯档案切换沿用已选），前端配置条展示用。
                    "model": effective_model,
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

                marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
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
            # P1（2026-08-25 二审 #1）：MinIO 组装已移到取锁前（预组装路径）——
            # 锁内只做 gate 基准复核：此刻 ``session.llm_provider_id`` 已被上方
            # 切换分支刷新为本轮生效值，与预组装基准一致且引擎不变 → 直接复用
            # 锁外产物；漂移（预读与取锁之间被并发切换/激活改写）→ 锁内重解析
            # gate，仅 supports 翻转才重组装（罕见竞态兜底，正确性不依赖预读）。
            # 无预组装的调用方（service 身份路径）在此原地组装，行为与原实现
            # 一致（组装读对象受 5MB×5/20MB×5 上限约束，原文档口径保留）。
            inject_attachments: list[dict] = []
            if validated_attachments:
                for att_row in validated_attachments:
                    if att_row.session_id is None:
                        att_row.session_id = session.id
                        self._session.add(att_row)

                if prelocked_attachments is not None:
                    basis_same = (
                        prelocked_attachments.gate_provider_id_basis == session.llm_provider_id
                        and prelocked_attachments.agent_kind == session.provider
                    )
                    if basis_same:
                        inject_attachments = list(prelocked_attachments.inject_attachments)
                    else:
                        supports = await self._resolve_inject_gate(
                            user_id=session.user_id,
                            gate_provider_id_basis=session.llm_provider_id,
                            agent_kind=session.provider or "",
                        )
                        if supports == prelocked_attachments.gate_supports_multimodal:
                            inject_attachments = list(prelocked_attachments.inject_attachments)
                        else:
                            inject_attachments = await self._assemble_inject_attachment_payload(
                                validated_attachments, supports_multimodal=supports
                            )
                else:
                    supports = await self._resolve_inject_gate(
                        user_id=session.user_id,
                        gate_provider_id_basis=session.llm_provider_id,
                        agent_kind=session.provider or "",
                    )
                    inject_attachments = await self._assemble_inject_attachment_payload(
                        validated_attachments, supports_multimodal=supports
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
                    # ── task-11 / R-07（design §4.2 兜底模型遮蔽规则）：会话级
                    # 选模型时，快照同步 model 且 default_fallback_model=所选——
                    # credential-injector 规则3 优先级 ``default_fallback_model ??
                    # model``，仅改 model 会被供应商兜底模型静默遮蔽。纯档案切换
                    # 轮也同步（沿用会话已选模型，防 reload 丢所选回退兜底）；
                    # 纯切供应商（重置回原配置）不覆盖，快照原样透传零回归。
                    # 均为**快照级覆盖**（copy 后改写），不动 llm_providers 原配置。
                    # openai_chat 快照无 default_fallback_model 键（单模型经
                    # litellm_model_name 路由），仅同步 model。
                    if model_override and effective_model is not None:
                        provider_config_payload = dict(provider_config_payload)
                        provider_config_payload["model"] = effective_model
                        if "default_fallback_model" in provider_config_payload:
                            provider_config_payload["default_fallback_model"] = effective_model
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
                # task-08 / D-004@v1：命中首主控轮判定（first_turn_briefing 非空）时
                # prompt 前缀简报（简报+\n\n---\n\n+用户消息，简报在前）；仅改本
                # payload 的 prompt 内容，SESSION_INJECT 协议字段不变（零 daemon
                # 改动）。AgentRunLog(user_input)/上方 SESSION_SWITCH_CONFIG 分支/
                # 离线收敛 output_redacted 均保持用户原文（展示层干净）。
                # ql-20260825-004：每轮注入构建当前页面上下文前导（复用 create 路径
                # build_page_context_preamble，服务端 DB 回查；查无/未传 → None 不注入）。
                page_preamble = None
                if page_context is not None:
                    from app.modules.daemon.session.context import (
                        build_page_context_preamble,
                    )

                    page_preamble = await build_page_context_preamble(
                        self._session,
                        page_context.page_key,
                        page_context.project_id,
                        page_context.route_key,
                        page_context.workspace_id,
                        page_context.tab_key,
                    )
                # 拼接顺序：页面前导（本轮实时）→ 团队简报（首主控轮一次性）→ 用户消息。
                parts = []
                if page_preamble:
                    parts.append(page_preamble)
                if first_turn_briefing:
                    parts.append(first_turn_briefing)
                if parts:
                    parts.append(prompt)
                    inject_prompt = "\n\n---\n\n".join(parts)
                else:
                    inject_prompt = prompt
                inject_payload = {
                    "session_id": str(session.id),
                    "lease_id": str(session.lease_id),
                    "run_id": str(run.id),
                    "prompt": inject_prompt,
                    "claim_token": inject_claim_token,
                    "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
                }
                # 2026-08-20 task-06：附件仅在有附件时附加（无附件路径与现状
                # 逐字节一致零回归；旧 daemon 忽略未知键，协议向后兼容）。
                if inject_attachments:
                    inject_payload["attachments"] = inject_attachments
                # task-04（design A2）：SESSION_INJECT 走控制指令三段式——WS
                # 失败/不在线落库 pending 待补拉（run failed 收敛语义保持，见
                # 下方 not control_ok 分支；补拉到达时 daemon 侧按 command_id
                # 幂等，GC 10min 过期联动兜底）。
                _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
                    daemon_id=daemon_id,
                    runtime_id=runtime_id,
                    kind=KIND_SESSION_INJECT,
                    payload=inject_payload,
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
                # task-04：错误码常量唯一落点迁 control_commands.py（GC inject
                # 过期联动复用同一取值），本处语义不变。
                run.error_code = INJECT_SEND_FAILED_ERROR_CODE
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
            # ql-20260829-011：归档区存量会话只读——interrupt 同口径 409。
            await self._ensure_session_workspace_writable(session)
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
        # task-04（design A2）：SESSION_INTERRUPT 走控制指令三段式——推送失败
        # 落库 pending 待补拉；504 语义保持（下方 not control_ok 分支）。
        _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=runtime_id,
            kind=KIND_SESSION_INTERRUPT,
            payload={
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

        Locks the session, validates the bound interactive lease, then in ONE
        transaction (still holding the row lock) marks currentRun killed,
        session ended, lease completed and commits; AFTER the commit a
        best-effort SESSION_END is sent to the daemon（P1 修复 2026-08-25：
        对齐 interrupt_session 的「先 commit 释放行锁、再发 WS」模式，daemon
        半死时 send_session_control 最长挂 10s，不再拖住会话行锁）. Idempotent on
        already-terminal sessions (ended / failed). WS failure is a warning
        only — the local reconciliation still succeeds so a daemon offline
        never strands an active session.

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

            # Idempotent: already terminal (ended/failed) → no-op return. failed
            # 也是终态——不得被 end 翻成 ended（终态覆写，2026-08-25 会话审查 P2）。
            if session.status in ("ended", "failed"):
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

        # Single-transaction local reconciliation (§8.5 收口)。P1 修复
        # （2026-08-25 会话审查）：本地收口在持有 AgentSession FOR UPDATE 行锁的
        # 事务内完成并 commit，SESSION_END WS 发送移到 commit 之后 best-effort
        # （对齐 interrupt_session :2233 的「先 commit 释放行锁、再发 WS」模式）——
        # ws_hub.send_session_control 最长挂 _SEND_TIMEOUT=10s，锁内等待会让 daemon
        # 半死时同会话的全部操作阻塞在行锁上。
        now = datetime.now(UTC)
        try:
            if run is not None and run.status not in TERMINAL_TURN_STATUSES:
                run.status = "killed"
                run.finished_at = now
                run.exit_code = -1
                self._session.add(run)

            # 终态守卫（P2）：幂等早退已拦 ended/failed，此处必为活跃态；显式再
            # 守卫一次防御状态机扩展，failed 等终态不被 end 翻成 ended。
            if session.status not in ("ended", "failed"):
                session.status = "ended"
                session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            # P2：lease 仅在非终态时收口 completed——已 cancelled（cancel_lease 抢先
            # 收口）的 lease 不被改写；terminating_at 的清空同样只在收口分支内。
            if lease.status not in ("completed", "cancelled", "expired"):
                lease.status = "completed"
                lease.updated_at = now
                # task-11 / FR-04 / D-007：daemon 回传 session_end（interactive ACK，
                # POST /sessions/{id}/end = notifySessionEnd 收敛点）→ 清 terminating_at。
                # cancel_lease 写 terminating_at 标记"等 daemon 回传"，本处即回传收敛点，
                # 清空让 sweeper（lease_service.alert_stuck_terminating_leases）不再误告警。
                # 幂等 None-set；仍在同一 try 单事务收口块内（commit 在下文）。
                lease.terminating_at = None
            self._session.add(lease)

            # ql-20260825-011：会话结束 → 未派发的排队消息一律转 failed（随本事务
            # commit），队列表不再有永远 pending 的死条目。
            await self._fail_pending_queued_messages(session.id, "会话已结束，排队消息未发送。")

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

        # Best-effort SESSION_END（commit 之后）：kill currentRun + 清 daemon 侧
        # SessionStore。helper 内部吞掉一切异常（runtime/lease 缺失、daemon 离线、
        # WS 超时），仅记 warning——本地收口已 commit，daemon 离线不阻断结束语义
        # （与原锁内发送的 try 语义一致，只是不再占用会话行锁等待）。
        await _send_session_end_best_effort(
            self._session,
            session_id=session.id,
            lease_id=session.lease_id,
            runtime_id=session.runtime_id,
            reason=reason,
        )

        # task-02：status→ended 已随上方 commit 落库，发布列表变更信号（user_id
        # 取会话属主——daemon 身份收口时刷新的仍是属主的列表视图）。
        await publish_sessions_changed("status_changed", session.id, session.user_id)

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

    # ── ql-20260825-011：会话排队消息（后端真实排队）──────────────────────

    async def _fail_pending_queued_messages(self, session_id: uuid.UUID, error_msg: str) -> int:
        """把会话的全部 pending 排队消息翻 failed（调用方事务内，不 commit）。

        返回翻状态条数（观测用）。end_session / 派发遇不可恢复态时收口，
        队列不留永远 pending 的死条目。
        """
        rows = (
            (
                await self._session.execute(
                    select(AgentSessionQueuedMessage).where(
                        AgentSessionQueuedMessage.agent_session_id == session_id,
                        AgentSessionQueuedMessage.status == "pending",
                    )
                )
            )
            .scalars()
            .all()
        )
        now = datetime.now(UTC)
        for row in rows:
            row.status = "failed"
            row.error_msg = error_msg
            row.updated_at = now
            self._session.add(row)
        return len(rows)

    async def list_queued_messages(
        self, session_id: uuid.UUID, user_id: uuid.UUID
    ) -> list[AgentSessionQueuedMessage]:
        """列出会话排队消息（created_at 升序 = 派发顺序）。

        归属校验复用 :meth:`_get_owned_session_for_update` 后立即 rollback
        释放行锁（排队列表是低频读，不占写锁）；owned_id 在 rollback 前取
        标量，避免回滚后属性过期。
        """
        session = await self._get_owned_session_for_update(session_id, user_id)
        owned_id = session.id
        await self._session.rollback()
        rows = (
            (
                await self._session.execute(
                    select(AgentSessionQueuedMessage)
                    .where(AgentSessionQueuedMessage.agent_session_id == owned_id)
                    .order_by(col(AgentSessionQueuedMessage.created_at))
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

    async def delete_queued_message(
        self, session_id: uuid.UUID, entry_id: uuid.UUID, user_id: uuid.UUID
    ) -> None:
        """删除一条排队消息（用户在队列条上点 ×）。发送中不可删的约束在
        前端——后端派发是「取队头 pending → _inject_into_session → 成功即
        删行」，这里删除 pending/failed 条目与派发路径在会话行锁上互斥，
        不会删到正在派发的条目。
        """
        session = await self._get_owned_session_for_update(session_id, user_id)
        entry = (
            await self._session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.id == entry_id,
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                )
            )
        ).scalar_one_or_none()
        if entry is None:
            await self._session.rollback()
            raise DaemonSessionQueueEntryNotFound(
                f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
                details={"session_id": str(session_id), "entry_id": str(entry_id)},
            )
        await self._session.delete(entry)
        await self._session.commit()
        await self._publish_session_event(
            session.id,
            {
                "event": "queue_changed",
                "session_id": str(session.id),
                "queue_entry_id": str(entry_id),
                "action": "deleted",
            },
        )

    async def retry_queued_message(
        self, session_id: uuid.UUID, entry_id: uuid.UUID, user_id: uuid.UUID
    ) -> AgentSessionQueuedMessage:
        """failed → pending 并立即尝试派发（忙则留队等 run 终态自动派发）。"""
        session = await self._get_owned_session_for_update(session_id, user_id)
        entry = (
            await self._session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.id == entry_id,
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                )
            )
        ).scalar_one_or_none()
        if entry is None:
            await self._session.rollback()
            raise DaemonSessionQueueEntryNotFound(
                f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
                details={"session_id": str(session_id), "entry_id": str(entry_id)},
            )
        if entry.status == "failed":
            entry.status = "pending"
            entry.error_msg = None
            entry.updated_at = datetime.now(UTC)
            self._session.add(entry)
            await self._session.commit()
            await self._session.refresh(entry)
        # 派发尝试复用会话行锁路径（忙则内部自然 no-op）。
        await self.dispatch_queued_messages(session.id)
        fresh = await self._session.get(AgentSessionQueuedMessage, entry_id)
        if fresh is not None:
            return fresh
        # 派发成功：dispatch 内部已删行并 commit（turn 已落 AgentRun、
        # queue_changed=dispatched 事件已发）。此处 re-get 必为 None——此前
        # 裸 assert 在该路径必抛 AssertionError → 接口 500，但消息其实已
        # 发出。返回删除前的 detached 快照（expire_on_commit=False 属性仍在），
        # status 标 dispatched 供调用方识别；前端消费 SSE/重新拉队列为准。
        entry.status = "dispatched"
        return entry

    async def dispatch_queued_messages(self, session_id: uuid.UUID) -> None:
        """派发会话排队消息（调用方须已持有会话行锁或接受竞态兜底）。

        语义：取最早 pending 条目，无活跃 run 则重放 inject（成功即删行）；
        失败（daemon 离线 / 附件失效 / 会话非 active）该条转 failed 留队，
        不再尝试后续条目（同类失败大概率连环，交给用户重试）。每次至多
        派发一条——派发成功后已有活跃 run，下一条等本轮 turn 终态钩子
        再触发，天然串行。
        """
        session = (
            await self._session.execute(
                select(AgentSession).where(AgentSession.id == session_id).with_for_update()
            )
        ).scalar_one_or_none()
        if session is None:
            return
        if session.status != "active":
            await self._fail_pending_queued_messages(
                session_id, f"会话当前状态为 {session.status}，排队消息未发送。"
            )
            await self._session.commit()
            return
        if await self._get_current_run(session.id) is not None:
            await self._session.rollback()
            return

        entry = (
            await self._session.execute(
                select(AgentSessionQueuedMessage)
                .where(
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                    AgentSessionQueuedMessage.status == "pending",
                )
                .order_by(col(AgentSessionQueuedMessage.created_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        if entry is None:
            await self._session.rollback()
            return

        page_context: PageContextCreateBlock | None = None
        if entry.page_context is not None:
            try:
                page_context = PageContextCreateBlock(**entry.page_context)
            except Exception:
                page_context = None
        attachment_ids: list[uuid.UUID] | None = None
        if entry.attachment_ids:
            try:
                attachment_ids = [uuid.UUID(str(a)) for a in entry.attachment_ids]
            except (ValueError, AttributeError, TypeError):
                attachment_ids = None

        try:
            await self._inject_into_session(
                session,
                prompt=entry.prompt,
                run_sender_user_id=entry.sender_user_id,
                agent_profile_id=entry.agent_profile_id,
                llm_provider_id=entry.llm_provider_id,
                attachment_ids=attachment_ids,
                page_context=page_context,
            )
        except AppError as exc:
            # 派发失败（daemon 离线 / 附件失效 / 配置失效等）：条目转 failed
            # 留队供重试。_inject_into_session 内部已 rollback 事务。
            entry.status = "failed"
            entry.error_msg = str(exc)
            entry.updated_at = datetime.now(UTC)
            self._session.add(entry)
            await self._session.commit()
            await self._publish_session_event(
                session.id,
                {
                    "event": "queue_changed",
                    "session_id": str(session.id),
                    "queue_entry_id": str(entry.id),
                    "action": "failed",
                },
            )
            return
        # 派发成功：删除排队行（turn 已落 AgentRun，队列不重复存史）。
        # _inject_into_session 内部已 commit；重新取行再删（identity map 里
        # 的旧对象可能已过期）。
        fresh = await self._session.get(AgentSessionQueuedMessage, entry.id)
        if fresh is not None:
            await self._session.delete(fresh)
            await self._session.commit()
        await self._publish_session_event(
            session.id,
            {
                "event": "queue_changed",
                "session_id": str(session.id),
                "queue_entry_id": str(entry.id),
                "action": "dispatched",
            },
        )

    async def handle_plan_response(
        self,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
        decision: PlanResponseDecision,
        feedback: str | None,
        user_id: uuid.UUID,
    ) -> dict[str, bool]:
        """Handle user's response to a plan-mode confirmation request (task-02 / FR-02).

        Validates that the session is owned by ``user_id`` and that ``run_id`` is a
        turn bound to this session, persists the decision in ``session.config`` (no
        new tables per design §数据模型), then best-effort pushes a
        ``daemon:plan_response`` control message to the owning daemon so the Agent
        can continue / revise / cancel.

        Returns ``{"ok": True, "delivered": <ws-delivered>}``. Redis/WS failures are
        logged but do not roll back the persisted decision.
        """
        session = await self._get_owned_session_for_update(session_id, user_id)

        # 归档区禁写（2026-08-30 审计④-7）：plan 确认会解除 daemon 侧 agent 的
        # 等待让其继续在归档工作区执行写操作——与 inject/interrupt 同拦（409），
        # 不持久化 decision、不推送控制消息。
        await self._ensure_session_workspace_writable(session)

        # Validate the run exists and belongs to this session.
        run = (
            await self._session.execute(
                select(AgentRun).where(
                    AgentRun.id == run_id,
                    AgentRun.agent_session_id == session_id,
                )
            )
        ).scalar_one_or_none()
        if run is None:
            raise DaemonSessionNotFound(
                f"AgentRun '{run_id}' not found for session '{session_id}'.",
                details={"session_id": str(session_id), "run_id": str(run_id)},
            )

        # Defensive service-level validation: DTO already enforces, but callers
        # bypassing the REST layer (e.g., internal scripts) must not leave invalid
        # state. Match the DTO error message so tests see consistent text.
        if decision not in (
            PlanResponseDecision.confirm,
            PlanResponseDecision.revise,
            PlanResponseDecision.cancel,
        ):
            raise DaemonSessionConfigInvalid(
                "decision must be one of confirm, revise, cancel.",
                details={"decision": str(decision)},
            )
        if decision in (PlanResponseDecision.revise, PlanResponseDecision.cancel) and (
            not feedback or not feedback.strip()
        ):
            raise DaemonSessionConfigInvalid(
                "decision 为 revise/cancel 时 feedback 必填且不可为空白",
                details={"decision": decision.value},
            )

        # Persist the decision into session.config (no new table).
        responded_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        config = dict(session.config or {})
        config["plan_response"] = {
            "run_id": str(run_id),
            "decision": decision.value,
            "feedback": feedback,
            "responded_at": responded_at,
        }
        session.config = config
        flag_modified(session, "config")
        self._session.add(session)
        await self._session.commit()
        await self._session.refresh(session)

        # Best-effort WebSocket push to the owning daemon.
        delivered = False
        if session.runtime_id is not None:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
            if daemon_id is not None:
                delivered = await hub.send_session_control(
                    daemon_id,
                    DAEMON_MSG_PLAN_RESPONSE,
                    {
                        "session_id": str(session_id),
                        "run_id": str(run_id),
                        "decision": decision.value,
                        "feedback": feedback,
                        "runtime_id": str(session.runtime_id),
                    },
                )
        if not delivered:
            log.warning(
                "plan_response_ws_send_failed",
                session_id=str(session_id),
                run_id=str(run_id),
                runtime_id=str(session.runtime_id) if session.runtime_id else None,
            )

        return {"ok": True, "delivered": delivered}

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
          4. Recoverable（非终态一律：active/suspended/pending/reconnecting，
             task-05 起 suspended 经 offline sweep/优雅停止产生）→ write
             status=reconnecting + last_active_at=now.
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
                # P2（2026-08-25 会话审查）：SELECT FOR UPDATE 后早退必须 rollback
                # 释放行锁，否则事务悬挂到请求 teardown。
                await self._session.rollback()
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
                # rollback 前取标量（rollback 会过期 ORM 属性，异步下访问即炸）。
                ended_session_id = session.id
                ended_lease_id = session.lease_id
                ended_status = session.status
                await self._session.rollback()
                return SessionRecoveryResult(
                    session_id=ended_session_id,
                    lease_id=ended_lease_id,
                    status=ended_status,
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
                # rollback 前取标量 + 释放行锁（同上 P2）。
                rejected_session_id = session.id
                rejected_lease_id = session.lease_id
                await self._session.rollback()
                return SessionRecoveryResult(
                    session_id=rejected_session_id,
                    lease_id=rejected_lease_id,
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
            # task-02：status→reconnecting 已落库，发布全局列表变更信号。
            await publish_sessions_changed("status_changed", session.id, session.user_id)
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

    async def suspend_sessions_for_daemon(
        self,
        daemon_instance_id: uuid.UUID,
    ) -> SuspendBatchResult:
        """daemon 优雅停止批量挂起（2026-08-29-daemon-platform-resilience task-05 / design A5 / FR-04）.

        daemon ``stop()`` 在 markOffline 前经 ``POST /sessions/suspend-batch``
        调入（body ``daemon_local_id`` = ``daemon_instances.id``，归属校验在
        router 层）。该 daemon 全部 runtime 名下的 **active** 会话单事务收敛
        （对齐 offline sweep 手法，条件 UPDATE 重挂状态条件保证幂等可重入），
        2026-08-29-batch-session-inherit task-01 起按 ``parent_session_id``
        分流两组（design S1）：

        - **主会话组**（parent IS NULL，语义逐字不变）：会话 → ``suspended`` +
          ``last_active_at=now``（挂起时刻写入，作 sweep 超龄 GC
          （SUSPENDED_MAX_AGE_SEC，24h）的时间基准——对齐 recover 翻
          reconnecting 时写 last_active_at 的先例）；中断轮 run
          （ACTIVE_TURN_STATUSES）→ ``failed`` + ``finished_at`` +
          ``error_code=daemon_stopped``（D-001：被中断的一轮标失败，不影响
          会话存活）；
        - **worker 子会话组**（parent 非空）：会话 → ``failed`` + ``ended_at``
          （worker 是临时会话无用户手恢复，挂起只会卡 mission 等 24h GC）；
          中断轮 run → ``failed`` + ``error_code=daemon_interrupted``
          （与 daemon_stopped 区分来源，作 task-02 自动重派的种子标识）；终态
          行对齐 sweep 档发 ``session_ended`` + 列表 ``status_changed``；
        - 挂起 lease（pending/claimed）→ ``cancelled`` 两组共享（终态 lease
          不回写）。

        worker 识别唯一口径是 ``parent_session_id`` 非空（兼容 role=NULL 老
        worker 行，禁用 role 词表兜底）；本方法产出 ``workers`` 重派种子
        ``(session_id, runtime_id)`` 列表并在事务提交后异步 fire task-02 自动
        重派（失败仅记日志，不阻塞本路径）。

        **pending 会话不挂起**：daemon 本地 sessions.json 只快照 active 且有
        agentSessionId 的会话，pending 行标 suspended 后无人 recover 只能等
        24h GC（D-007 裁定维持 failed 归宿——那条路径归 offline sweep，本方法
        条件锁 ``status == "active"`` 不碰 pending/终态行）。

        commit 后逐行 best-effort 发列表变更信号 ``status_changed``；suspended
        **非终态不发 session_ended**（design A5：SSE 会话流继续 keepalive，
        列表视图经信号秒级刷新）；worker 组 failed 终态发 session_ended。
        """
        try:
            daemon_runtime_ids = select(DaemonRuntime.id).where(
                col(DaemonRuntime.daemon_instance_id) == daemon_instance_id
            )
            hit_rows = (
                await self._session.execute(
                    select(
                        AgentSession.id,
                        AgentSession.lease_id,
                        AgentSession.runtime_id,
                        AgentSession.parent_session_id,
                    ).where(
                        AgentSession.status == "active",
                        col(AgentSession.runtime_id).in_(daemon_runtime_ids),
                    )
                )
            ).all()
            if not hit_rows:
                return SuspendBatchResult(suspended=0, runs_failed=0)

            # task-01 分流（design S1）：parent_session_id 非空 = worker 子会话。
            main_ids = [row.id for row in hit_rows if row.parent_session_id is None]
            worker_rows = [row for row in hit_rows if row.parent_session_id is not None]
            worker_ids = [row.id for row in worker_rows]
            hit_ids = [row.id for row in hit_rows]
            now = datetime.now(UTC)

            # 主会话组：suspended 语义逐字不变（回归锁定）。
            suspended_result = await self._session.execute(
                update(AgentSession)
                .where(
                    AgentSession.id.in_(main_ids),
                    AgentSession.status == "active",
                )
                .values(status="suspended", last_active_at=now)
            )
            suspended = int(suspended_result.rowcount or 0)

            # worker 组：改判 failed + ended_at（挂起无意义——无人手 recover，
            # 重派由 task-02 以 workers 种子翻回 active 续跑）。
            if worker_ids:
                await self._session.execute(
                    update(AgentSession)
                    .where(
                        AgentSession.id.in_(worker_ids),
                        AgentSession.status == "active",
                    )
                    .values(status="failed", ended_at=now)
                )

            # 中断轮 run 收敛：主会话 daemon_stopped（既有语义）、worker 组
            # daemon_interrupted（新错误码区分来源）。
            runs_failed = 0
            if main_ids:
                runs_result = await self._session.execute(
                    update(AgentRun)
                    .where(
                        AgentRun.agent_session_id.in_(main_ids),
                        col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
                    )
                    .values(
                        status="failed",
                        finished_at=now,
                        error_code=DAEMON_STOPPED_ERROR_CODE,
                    )
                )
                runs_failed += int(runs_result.rowcount or 0)
            if worker_ids:
                runs_result = await self._session.execute(
                    update(AgentRun)
                    .where(
                        AgentRun.agent_session_id.in_(worker_ids),
                        col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
                    )
                    .values(
                        status="failed",
                        finished_at=now,
                        error_code=DAEMON_INTERRUPTED_ERROR_CODE,
                    )
                )
                runs_failed += int(runs_result.rowcount or 0)

            lease_ids = [row.lease_id for row in hit_rows if row.lease_id is not None]
            if lease_ids:
                await self._session.execute(
                    update(DaemonTaskLease)
                    .where(
                        DaemonTaskLease.id.in_(lease_ids),
                        DaemonTaskLease.status.in_(("pending", "claimed")),
                    )
                    .values(status="cancelled", updated_at=now)
                )

            await self._session.commit()

            # 以 UPDATE 后状态复查决定广播对象（并发翻转的行 status 已非
            # suspended / failed 不发——对齐 sweep 两档的防误伤口径）。
            final_rows = (
                await self._session.execute(
                    select(AgentSession.id, AgentSession.status, AgentSession.user_id).where(
                        AgentSession.id.in_(hit_ids)
                    )
                )
            ).all()
            worker_id_set = set(worker_ids)
            for row in final_rows:
                if row.status == "suspended":
                    await publish_sessions_changed("status_changed", row.id, row.user_id)
                elif row.id in worker_id_set and row.status == "failed":
                    # worker 组终态：对齐 sweep 档发 session_ended（SSE 收尾）+
                    # 列表 status_changed；reason 即中断错误码。
                    await self._publish_session_event(
                        row.id,
                        {
                            "event": "session_ended",
                            "session_id": str(row.id),
                            "reason": DAEMON_INTERRUPTED_ERROR_CODE,
                            "current_run_id": None,
                        },
                    )
                    await publish_sessions_changed("status_changed", row.id, row.user_id)
            result = SuspendBatchResult(
                suspended=suspended,
                runs_failed=runs_failed,
                workers=[(row.id, row.runtime_id) for row in worker_rows],
            )
            # task-02（design S2）：worker failed 落库（上方事务已 commit）后异步
            # fire 自动重派——复用原会话 + resume_session_id 续 SDK 上下文；不
            # 阻塞挂起主路径，重派失败仅记日志（下轮 offline sweep 60s 周期自愈）。
            if result.workers:
                from app.modules.agent.worker_redispatch import fire_worker_redispatch

                fire_worker_redispatch(result.workers)
            return result
        except Exception:
            await self._session.rollback()
            raise

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID | None = None,
    ) -> str:
        """Flip a reconnecting session to active after daemon resume succeeds.

        Two-phase recover (task-10 §4.4 step 7): daemon runs
        recover_session_after_daemon_restart (writes reconnecting) → then
        restoreAndReconnect (driver.start resume) → on success calls this to
        flip reconnecting → active. On resume failure the daemon leaves the
        session in reconnecting (converged by task-07 idle sweep or manual end).

        Ownership guard: runtime_id must match; mismatch → rejected.
        Stale-confirmation guard (DS-4, 2026-08-21-session-reopen-resume):
        when ``lease_id`` is provided and differs from the session's current
        lease, this is a late confirmation from a previous reopen → idempotent
        skip (no flip, no error, current status returned; a reconnecting
        session therefore stays reconnecting). Omitted ``lease_id`` (legacy
        daemon-restart recover chain) keeps the pre-DS-4 behavior verbatim.
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
                # P2（2026-08-25 会话审查）：FOR UPDATE 后早退 rollback 释放行锁。
                await self._session.rollback()
                return "rejected"
            if lease_id is not None and session.lease_id != lease_id:
                # DS-4 stale-confirmation guard: idempotent skip — 迟到的旧
                # 确认不得误翻第二次 reopen 的 reconnecting。
                log.info(
                    "session_confirm_stale_lease_skipped",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                    current_lease_id=str(session.lease_id),
                    presented_lease_id=str(lease_id),
                )
                # rollback 前取标量（rollback 过期 ORM 属性）。
                stale_status = session.status
                await self._session.rollback()
                return stale_status
            if session.status != "reconnecting":
                # Idempotent: already active (or terminal). Return current.
                current_status = session.status
                await self._session.rollback()
                return current_status

            session.status = "active"
            session.last_active_at = datetime.now(UTC)
            self._session.add(session)
            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {"event": "session_reconnected", "session_id": str(session.id)},
            )
            # task-02：status→active 翻转已落库，发布全局列表变更信号。
            await publish_sessions_changed("status_changed", session.id, session.user_id)
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
        lease_id: uuid.UUID | None = None,
    ) -> str:
        """Flip a non-terminal session to failed after daemon resume failed.

        Daemon calls this when driver.start({resume}) throws (cwd mismatch /
        executable missing / SDK jsonl missing). The session was written
        reconnecting by recover_session_after_daemon_restart; resume failing
        means it cannot be restored → failed terminal.

        Stale-confirmation guard (DS-4, 2026-08-21-session-reopen-resume):
        when ``lease_id`` is provided and differs from the session's current
        lease, this is a late failure report from a previous reopen →
        idempotent skip (no flip, no error, current status returned). Omitted
        ``lease_id`` keeps the pre-DS-4 behavior verbatim.

        Flip semantics are intentionally broad: any status outside
        ``{ended, failed}`` (reconnecting AND active alike) converges to
        ``failed`` — daemon.ts markRecoveredSessionFailed async-fail bridge
        relies on active→failed after confirm succeeded (DS-4 review gap:
        must NOT be narrowed to reconnecting-only).
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
                # P2（2026-08-25 会话审查）：FOR UPDATE 后早退 rollback 释放行锁。
                await self._session.rollback()
                return "rejected"
            if lease_id is not None and session.lease_id != lease_id:
                # DS-4 stale-confirmation guard: idempotent skip — 迟到的旧
                # 失败上报不得误杀第二次 reopen 的会话。
                log.info(
                    "session_recovery_failed_stale_lease_skipped",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                    current_lease_id=str(session.lease_id),
                    presented_lease_id=str(lease_id),
                )
                # rollback 前取标量（rollback 过期 ORM 属性）。
                stale_status = session.status
                await self._session.rollback()
                return stale_status
            if session.status in ("ended", "failed"):
                current_status = session.status
                await self._session.rollback()
                return current_status

            now = datetime.now(UTC)
            session.status = "failed"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            # ql-20260823-007：恢复失败 = 本次 reopen 的租约已死。挂起态
            # （pending/claimed——含被任务轮询误认领的）收敛 cancelled 防永挂；
            # 终态（completed/cancelled/expired）不动（幂等）。cancelled 语义对齐
            # sweep.py / reopen DS-5 分支（interactive lease 恒 NULL
            # lease_expires_at，expired 不适用）。
            if session.lease_id is not None:
                failed_lease = await self._session.get(DaemonTaskLease, session.lease_id)
                if failed_lease is not None and failed_lease.status in ("pending", "claimed"):
                    failed_lease.status = "cancelled"
                    failed_lease.updated_at = now
                    self._session.add(failed_lease)
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
            # task-02：status→failed 已落库，发布全局列表变更信号。
            await publish_sessions_changed("status_changed", session.id, session.user_id)
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
        # 2026-08-22-workspace-sessions-portal / D-003@v2：workspace/change 级
        # 门户复用全局列表做 scope 过滤（照 runtime_id 模式，可选零回归）。
        workspace_id: uuid.UUID | None = None,
        change_id: uuid.UUID | None = None,
        # 2026-08-25-session-spec-binding task-04 / FR-05：快速修复级关联筛选
        # （ql_id 为自然键短码 ``ql-YYYYMMDD-NNN-后缀``，非 UUID）。
        ql_id: str | None = None,
        # task-02（2026-08-28-session-ppm-task-binding / FR-05 / D-005@v1）：PPM
        # 条目级关联筛选（kind + item_id 成对，router 层已校验配对与 Literal）。
        ppm_item_kind: PpmItemKind | None = None,
        ppm_item_id: uuid.UUID | None = None,
        # 2026-08-24：会话归档过滤（archived=True 只看已归档，False 只看未归档）。
        archived: bool = False,
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

        2026-08-22-workspace-sessions-portal / D-003@v2 新增（可选，零回归）：

        - ``workspace_id``：``AgentSession.workspace_id`` 冗余绑定列精确匹配
          （未绑定 workspace 的旧会话不匹配）。

        2026-08-25-session-spec-binding task-04 / FR-05 升级 + 新增（design
        §5.W3.3 / §9 兼容策略）：

        - ``change_id``：语义从「单 FK（``AgentSession.change_id``）精确匹配」
          扩大为「M:N 命中」——改为 ``AgentSession.id IN (change_session_links
          的 session_id WHERE change_id=传入值)`` 子查询。links 表是变更↔会话
          关联的唯一真相（D-002@v1），存量单 FK 已由迁移播种为 link 行，原
          命中集是新命中集的子集（参数名/类型不变，向后兼容）；含「仅 link
          无单 FK」的自动绑定会话。scope=change 门户查询形态仍为
          ``workspace_id`` + ``change_id`` 双传取交集。
        - ``ql_id``：快速修复短码（非 UUID），走 ``quicklog_session_links``
          按 (workspace_id, ql_id) 双条件子查询命中（D-001@v1：自然键无 FK）。
          workspace 限定防跨工作区同 ql_id 串扰（R-05）：``workspace_id`` 筛选
          参数非空时子查询同步收紧到该工作区；为空时按 ql_id 全工作区命中
          （列表本身 owner-scoped，串扰面已受限，design §5.W3.3 允许）。
          与其余筛选 AND 交集组合（``change_id`` + ``ql_id`` 同传即双关联交集）。

        2026-08-28-session-ppm-task-binding task-02 / FR-05 新增（可选，零回归）：

        - ``ppm_item_kind`` + ``ppm_item_id``：PPM 条目级关联筛选，走
          ``ppm_item_session_links`` (kind, item_id) 子查询命中（照 change_id
          分支模式）。``item_id`` 为 UUID 全局唯一，无跨工作区串扰，不叠
          workspace 条件；与其余筛选 AND 交集组合。成对约束由 router 层
          校验（只传其一 422），service 层双 None 时零分支进入。
        """
        from sqlalchemy import exists, func

        base_filters = [
            AgentSession.user_id == user_id,
            AgentSession.deleted_at.is_(None),  # FR-07 软删过滤
        ]
        # 2026-08-24：archived 过滤（默认 False=未归档可见，True=已归档可见）。
        if archived:
            base_filters.append(AgentSession.archived_at.isnot(None))
        else:
            base_filters.append(AgentSession.archived_at.is_(None))
        if status_filter is not None:
            base_filters.append(AgentSession.status == status_filter)
        if runtime_id is not None:
            base_filters.append(AgentSession.runtime_id == runtime_id)
        # 2026-08-22-workspace-sessions-portal / D-003@v2：scope 精确匹配过滤。
        if workspace_id is not None:
            base_filters.append(AgentSession.workspace_id == workspace_id)
        if change_id is not None:
            # 2026-08-25-session-spec-binding task-04 / D-002@v1 / design
            # §5.W3.3：change_id 从单 FK 精确匹配升级为 M:N 子查询命中——
            # links 表是变更↔会话关联的唯一真相，存量单 FK 已播种为 link 行
            # （§9：原命中集是新命中集的子集，参数名/类型不变向后兼容）。
            base_filters.append(
                AgentSession.id.in_(
                    select(ChangeSessionLink.session_id).where(
                        ChangeSessionLink.change_id == change_id
                    )
                )
            )
        if ql_id is not None:
            # 2026-08-25-session-spec-binding task-04 / FR-05 / D-001@v1：按
            # links 表 (workspace_id, ql_id) 双条件命中，防跨工作区同 ql_id
            # 串扰（R-05）。workspace_id 筛选参数非空 → 收紧到该工作区；为空
            # → 按 ql_id 全工作区命中（owner-scoped 列表，串扰面已受限）。
            ql_filters = [QuicklogSessionLink.ql_id == ql_id]
            if workspace_id is not None:
                ql_filters.append(QuicklogSessionLink.workspace_id == workspace_id)
            base_filters.append(
                AgentSession.id.in_(select(QuicklogSessionLink.session_id).where(*ql_filters))
            )
        if ppm_item_kind is not None and ppm_item_id is not None:
            # task-02（2026-08-28-session-ppm-task-binding / FR-05 / D-005@v1）：
            # PPM 条目级关联筛选——照 change_id 分支模式走 ppm_item_session_links
            # 子查询命中。item_id 为 UUID 全局唯一（kind+item_id 定位唯一条目），
            # 无跨工作区串扰，不叠 workspace 条件（区别于 ql_id 双条件）。
            base_filters.append(
                AgentSession.id.in_(
                    select(PpmItemSessionLink.session_id).where(
                        PpmItemSessionLink.kind == ppm_item_kind,
                        PpmItemSessionLink.item_id == ppm_item_id,
                    )
                )
            )
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
             - cwd empty → :class:`DaemonSessionNoCwd` (DS-7: scan/bootstrap
               sessions have no cwd; SDK resume needs it to locate the
               transcript — reject up front, session NOT mutated)
             - status in ACTIVE_SESSION_STATUSES → :class:`DaemonSessionNotActive`
               (caller should use inject, not reopen), EXCEPT (DS-5): status
               == "reconnecting" with ``last_active_at`` older than
               :data:`RECONNECTING_RETRY_WINDOW_SEC` (F2: last_active_at is the
               single timeout basis — both reopen and daemon-restart recover
               write it on flipping to reconnecting; never ``lease.created_at``,
               which recover-path long sessions would always exceed) → the
               suspended recovery is deemed dead and a second reopen is
               allowed (the pending lease is converged to ``cancelled``,
               DS-6 value: interactive leases have NULL ``lease_expires_at``
               so ``expired`` never applies)
             - target runtime offline → :class:`DaemonOffline`
          3. task-07 transition: create a NEW interactive lease (on the
             ended/failed path the original ``completed`` lease is preserved
             untouched, design §6.2; on the DS-5 stale-reconnecting path the
             old suspended lease was just converged to ``cancelled``) with a
             fresh ``claim_token``, point ``session.lease_id`` at it, flip
             ``status="reconnecting"``, commit, then emit a best-effort
             ``daemon:session_resume`` WS (``agent_session_id`` is the SDK resume
             key and is preserved verbatim). The method signature + return shape
             are final.

        ``FOR UPDATE`` serializes concurrent reopen on the same row; a second
        reopen landing after the first commits is caught by the status check
        (now ``reconnecting`` ∈ ACTIVE_SESSION_STATUSES → NOT_ACTIVE, unless
        the retry window has already elapsed — DS-5).
        """
        session = await self._get_owned_session_for_update(session_id, user_id)

        # 归档区禁写（2026-08-30 审计R8）：reopen 建 lease + SESSION_RESUME 会让
        # daemon 恢复在归档工作区执行——与 inject/interrupt/plan-response 同拦
        # （409），不在归档区复活会话句柄。
        await self._ensure_session_workspace_writable(session)

        # DS-5：窗口判断需要统一时间基准，now 前移到前置校验之前；后续新建
        # lease / 状态翻转复用同一 now，避免双取漂移。
        now = datetime.now(UTC)

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
        if not session.cwd:
            # DS-7：scan/bootstrap 会话不写 cwd，空 cwd 的 SDK resume 必然失败
            # （claude transcript 按 projects/<encoded-cwd>/ 定位），提前拒绝。
            raise DaemonSessionNoCwd(
                "该会话无关联工作目录，无法恢复对话记录",
                details={"session_id": str(session_id)},
            )
        if session.status in ACTIVE_SESSION_STATUSES:
            # DS-5：仅 reconnecting 超窗是 ACTIVE_SESSION_STATUSES 例外（手动
            # 重试兜底）；窗口内 / last_active_at 为 NULL（保守）/ pending /
            # active 维持 409。基准锁 last_active_at（F2）。
            last_active = session.last_active_at
            if last_active is not None and last_active.tzinfo is None:
                # SQLite（测试）读回 naive datetime，按 UTC 补 tz（先例
                # lease_service.py term_at 处理）。
                last_active = last_active.replace(tzinfo=UTC)
            stale_reconnecting = (
                session.status == "reconnecting"
                and last_active is not None
                and (now - last_active).total_seconds() > RECONNECTING_RETRY_WINDOW_SEC
            )
            if not stale_reconnecting:
                raise DaemonSessionNotActive(
                    f"Session '{session_id}' is still {session.status}; use inject instead of reopen.",
                    details={
                        "session_id": str(session_id),
                        "status": session.status,
                    },
                )
            # 旧挂起 lease 收敛 cancelled（DS-6 取值：expired 仅适用
            # lease_expires_at 非 NULL 的租约，interactive 恒 NULL；cancelled
            # 与"恢复放弃"语义一致），随下方 reopen 事务一起提交。ended/failed
            # 路径旧 lease 已是终态（completed），不进本分支。
            if session.lease_id is not None:
                stale_lease = await self._session.get(DaemonTaskLease, session.lease_id)
                if stale_lease is not None and stale_lease.status not in (
                    "completed",
                    "cancelled",
                    "expired",
                ):
                    stale_lease.status = "cancelled"
                    stale_lease.updated_at = now
                    self._session.add(stale_lease)
        # Runtime must be connected so the daemon can run the SDK resume.
        # P2（2026-08-25 会话审查）：runtime_id 为 None 是会话级不变量违规
        # （create/reopen 均写 runtime_id；NULL 意味着数据损坏）——原实现被
        # ``if runtime_id is not None`` 短路静默跳过在线检查、下方 assert 兜底
        # （python -O 下会被剥除），改为显式 raise 不变量违规错误。
        runtime_id = session.runtime_id
        if runtime_id is None:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has no runtime binding; cannot reopen.",
                details={"session_id": str(session_id), "runtime_id": None},
            )
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
        # ``now`` was hoisted above the pre-flight checks (DS-5) and is shared
        # by the window check + lease transition below.
        # 上方不变量检查已保证 runtime_id 非 None（持有行锁，中途无人改写），
        # 直接复用，不再用 ``python -O`` 下会被剥除的 assert 兜底。
        target_runtime_id = runtime_id

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
                # ql-20260827-014：会话级供应商标记随新 lease 重建（与 create 路径
                # :1383 同款）。reopen 漏写会让 claim/恢复链路解析不到会话供应商
                # ——生产实证：reopen 后 lease 全缺此键，SDK 无凭证秒退、会话回
                # ended（每次重开约 2s 死亡循环）。
                **(
                    {"session_llm_provider_id": str(session.llm_provider_id)}
                    if session.llm_provider_id is not None
                    else {}
                ),
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

        # task-02：status→reconnecting 已随上方 commit 落库，发布列表变更信号
        # （下方 SESSION_RESUME WS best-effort 失败不回滚本地状态，信号语义
        # 不受 WS 结果影响）。
        await publish_sessions_changed("status_changed", session.id, session.user_id)

        # ql-20260827-014：reopen 的 SESSION_RESUME 必须携带会话级供应商凭证。
        # daemon 侧 reopen 恢复（区别于 daemon 重启 recover——那条路走本机
        # sessions.json 快照里的 providerConfig）此前既拿不到 lease metadata 键、
        # WS payload 也不带凭证，恢复出的 SDK 子进程无任何凭证（隔离
        # CLAUDE_CONFIG_DIR 下无本机 OAuth 兜底）→ 首轮 "Not logged in · Please
        # run /login" 退出 → daemon 上报 end → 会话秒回 ended。解析复用
        # resolve_bound_provider_config（与 claim payload 同一真相源，D-006）；
        # 抛异常 / 返回 None（供应商已删 / 属主不符等）降级缺键 + warning 不阻断
        # reopen（对齐 claim 链路 _inject_provider_config 的降级语义，
        # context.py:297-303），daemon 走本机凭证链（零回归）。
        resume_provider_config: dict | None = None
        if session.llm_provider_id is not None:
            from app.modules.daemon.lease.context import resolve_bound_provider_config

            try:
                resume_provider_config = await resolve_bound_provider_config(
                    self._session,
                    {"llm_provider_id": str(session.llm_provider_id)},
                    session.user_id,
                    session.provider,
                )
            except Exception:
                log.warning(
                    "session_resume_provider_resolve_failed",
                    session_id=str(session.id),
                    llm_provider_id=str(session.llm_provider_id),
                )
                resume_provider_config = None

        # ── best-effort daemon:session_resume WS (design §6.4) ────────────────
        # WS failure does NOT roll back the local reconnecting state — the daemon
        # will converge on its own (pull/next-poll or recover-on-restart). The
        # frontend surfaces reconnecting immediately. cwd is forwarded so the
        # SDK resume runs in the original working directory (R-cwd).
        # task-04（design A2）：SESSION_RESUME 走控制指令三段式——reopen 租约的
        # WS 单次投递丢失即永挂缺陷由「落库 pending + 重连补拉」弥补（design A2
        # 末条）；失败不回滚 reconnecting 本地状态的既有语义保持。
        resume_payload = {
            "session_id": str(session.id),
            "lease_id": str(new_lease.id),
            "agent_session_id": session.agent_session_id,
            "cwd": session.cwd,
            "provider": session.provider,
            "runtime_id": str(target_runtime_id),
        }
        if resume_provider_config is not None:
            # R-02：明文 api_key 仅进 WS payload（服务端→daemon 下发通道），不入
            # 日志/ORM；daemon 侧同样不落日志（record.providerConfig 快照语义）。
            resume_payload["provider_config"] = resume_provider_config
        try:
            # task-06: resolve provider runtime_id → daemon_instance_id (WS key).
            resume_daemon_id = await _resolve_daemon_id_for_runtime(
                self._session, target_runtime_id
            )
            resume_ok = False
            if resume_daemon_id is not None:
                _row, resume_ok = await ControlCommandService(self._session).enqueue_and_push(
                    daemon_id=resume_daemon_id,
                    runtime_id=target_runtime_id,
                    kind=KIND_SESSION_RESUME,
                    payload=resume_payload,
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

        # task-02：软删已落库，发布列表删除信号（前端 invalidate 重拉后该行
        # 被 deleted_at IS NULL 过滤，从列表消失）。
        await publish_sessions_changed("deleted", agent_session.id, agent_session.user_id)

    async def _end_session_for_delete(self, session: AgentSession) -> None:
        """Internal end reconciliation used by delete_agent_session.

        task-03 / D-003@v1: mirrors the core of :meth:`end_session` (run
        killed + lease completed + WS) but never raises on WS failure and never
        touches ``session.status`` beyond the converged ``ended`` — the caller
        (delete) hard-deletes the row right after, so the session status is
        effectively throwaway; only the run/lease convergence matters for audit.
        Holds the same session row lock the caller already acquired.

        P1 修复（2026-08-25 会话审查）：本地收口（run killed + lease completed）
        先在本事务内 commit 释放行锁，SESSION_END WS 发送移到 commit 之后
        best-effort——与 :meth:`end_session` / interrupt_session 同款「先 commit、
        再发 WS」模式，锁内不等 ws_hub 最长 10s 的发送。
        """
        now = datetime.now(UTC)
        # Kill the current non-terminal run if any (single-transaction convergence).
        # P2：WHERE 直接过滤 ACTIVE_TURN_STATUSES（pending/running/pending_approval），
        # 不再全量加载该会话所有 run——循环只为找非终态 run，历史 run 无需入内存。
        runs = (
            (
                await self._session.execute(
                    select(AgentRun)
                    .where(AgentRun.agent_session_id == session.id)
                    .where(col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)))
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
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

        # commit 释放调用方持有的会话行锁（原仅 flush 等 caller 一并提交），
        # WS 发送挪到锁外。
        await self._session.commit()

        # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
        # task-04（design A2）：走控制指令三段式——WS 失败落库 pending 待补拉
        # （软删会话后 daemon 重连补拉仍能收到 end 清理本地 SessionStore）。
        if session.runtime_id is not None:
            try:
                # task-06: resolve provider runtime_id → daemon_instance_id.
                daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
                end_ok = False
                if daemon_id is not None:
                    _row, end_ok = await ControlCommandService(self._session).enqueue_and_push(
                        daemon_id=daemon_id,
                        runtime_id=session.runtime_id,
                        kind=KIND_SESSION_END,
                        payload={
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

    # ── 2026-08-24：会话归档/取消归档 ──────────────────────────────────

    async def archive_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Archive an owned session (hide from default list view).

        2026-08-24 会话归档功能：设置 ``archived_at`` 时间戳。所有状态均可归档
        （活跃会话归档后从默认列表隐藏，筛选「已归档会话」可查看）。
        幂等：已归档会话重复调用无操作。archived_at 与 deleted_at 正交——
        可归档后删除，也可直接删除。
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
        if agent_session.archived_at is not None:
            await self._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
            return  # 幂等：已归档
        agent_session.archived_at = datetime.now(UTC)
        await self._session.commit()
        # task-02：归档已落库（列表按 archived_at IS NULL 过滤），发布列表变更
        # 信号——否则已打开 SSE 的其它客户端看不到该行从默认列表消失。
        await publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)

    async def unarchive_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Unarchive an owned session (restore to default list view).

        2026-08-24 会话归档功能：清除 ``archived_at`` 时间戳。
        幂等：未归档会话重复调用无操作。
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
        if agent_session.archived_at is None:
            await self._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
            return  # 幂等：未归档
        agent_session.archived_at = None
        await self._session.commit()
        # task-02：取消归档已落库（行回到默认列表视图），发布列表变更信号——
        # 与 archive_session 对称，SSE 客户端秒级看到该行重新出现。
        await publish_sessions_changed("status_changed", agent_session.id, agent_session.user_id)

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        limit: int = 5000,
        after: datetime | None = None,
    ) -> list[AgentRunLog]:
        """Return all AgentRunLog rows for an owned session, cross-run aggregate.

        ``after``（2026-08-24 会话审查 P4，对齐 run 级 ``?after=`` 先例）：增量
        游标——只返回 ``timestamp > after`` 的行，供前端断线重连/轮后对账增量
        拉取，替代全量重放（5000 行 × 50KB 的重连代价）。submit_messages 同批
        日志共用同一 timestamp，纯 timestamp 游标在批次内边界会漏同批后到行，
        调用方应回退 1-2s 重叠窗口并按 log_id 去重（前端已具备该去重）。

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
        )
        if after is not None:
            stmt = stmt.where(AgentRunLog.timestamp > after)
        stmt = (
            stmt.order_by(
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

    async def get_session_usage(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionUsageRead:
        """会话累计用量聚合：明细段为主 + 无明细 run 四维列兜底（2026-08-29-session-usage-stats
        task-01 / FR-01 / D-002@v1 / D-004@v1，端点归 task-02）。

        两段 SQL 聚合全部在 SQL 侧完成（JOIN/GROUP BY，不拉 run 行进内存——
        大会话防膨胀，design R-03）：

        1. 明细段（主源）：``agent_run_model_usage`` JOIN 本会话 ``agent_runs``，
           GROUP BY ``mu.model``，SUM 四维 token + ``api_requests``；
        2. 兜底段：本会话中**没有任何明细行**的 run（2026-08-29 之前的历史轮次；
           NOT EXISTS 反连接，防大会话 NOT IN 子查询膨胀），SUM ``agent_runs``
           四维 token 列——``ctx_tokens`` 是提示词大小快照列，**严禁**出现在 SUM
           （Grill P1）；按 ``COALESCE(run.model, '未记录')`` 归并，``api_requests``
           无来源按 0 计（诚实值，design R-01）。

        归属校验对齐 :meth:`get_agent_session`：``session_id + user_id`` DB 侧
        过滤 + 软删 ``deleted_at`` 视为不存在（FR-07 同口径），缺失/跨用户/已软删
        同抛 :class:`DaemonSessionNotFound`（404 不泄露存在性）。两段按 model 名
        dict 归并求和（兜底段按 run.model 命名可能与明细段同名——同名桶相加，
        不丢）；``by_model`` 按 input+output 总量降序、「未记录」桶恒末位
        （D-002@v1）；空会话返回全 0 totals + 空 ``by_model``。
        """
        from sqlalchemy import exists, func

        # Ownership check (resource hiding — same not-found for missing/cross-user;
        # 2026-08-30 审计⑥：软删会话同 404，对齐 runs/logs/detail 端点口径).
        owned = (
            await self._session.execute(
                select(AgentSession.id).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                    AgentSession.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

        # 兜底桶名（run.model 为 NULL 的历史轮次归此桶，恒排 by_model 末位）。
        unrecorded = "未记录"

        # ── 明细段（主源）：usage 明细 × 本会话 runs，GROUP BY model ──
        detail_stmt = (
            select(
                AgentRunModelUsage.model.label("model"),
                func.sum(AgentRunModelUsage.input_tokens).label("input_tokens"),
                func.sum(AgentRunModelUsage.output_tokens).label("output_tokens"),
                func.sum(AgentRunModelUsage.cache_read_tokens).label("cache_read_tokens"),
                func.sum(AgentRunModelUsage.cache_creation_tokens).label("cache_creation_tokens"),
                func.sum(AgentRunModelUsage.api_requests).label("api_requests"),
            )
            .join(AgentRun, AgentRunModelUsage.run_id == AgentRun.id)
            .where(AgentRun.agent_session_id == session_id)
            .group_by(AgentRunModelUsage.model)
        )
        detail_rows = (await self._session.execute(detail_stmt)).mappings().all()

        # ── 兜底段：本会话中无任何明细行的 run，四维 token 列求和 ──
        # run 级 token 列 nullable（老数据）→ SUM(COALESCE(col, 0))；usage 明细
        # 列 NOT NULL 但统一 or-0 防御（对齐 runtime usage 装配先例）。
        bucket = func.coalesce(AgentRun.model, unrecorded)
        fallback_stmt = (
            select(
                bucket.label("model"),
                func.sum(func.coalesce(AgentRun.input_tokens, 0)).label("input_tokens"),
                func.sum(func.coalesce(AgentRun.output_tokens, 0)).label("output_tokens"),
                func.sum(func.coalesce(AgentRun.cache_read_tokens, 0)).label("cache_read_tokens"),
                func.sum(func.coalesce(AgentRun.cache_creation_tokens, 0)).label(
                    "cache_creation_tokens"
                ),
            )
            .where(
                AgentRun.agent_session_id == session_id,
                # NOT EXISTS 反连接：等价 NOT IN (SELECT run_id ... WHERE run_id IN
                # 会话 runs)（design §接口定义），且无 IN 膨胀/NULL 陷阱。
                ~exists().where(AgentRunModelUsage.run_id == AgentRun.id),
            )
            .group_by(bucket)
        )
        fallback_rows = (await self._session.execute(fallback_stmt)).mappings().all()

        # ── 合并：按 model 名 dict 归并求和（两段同名桶相加，不丢）──
        buckets: dict[str, SessionUsageModelItemRead] = {}

        def _merge(
            name: str,
            input_t: int,
            output_t: int,
            cache_r: int,
            cache_c: int,
            api_r: int,
        ) -> None:
            cur = buckets.get(name)
            if cur is None:
                buckets[name] = SessionUsageModelItemRead(
                    model=name,
                    input_tokens=input_t,
                    output_tokens=output_t,
                    cache_read_tokens=cache_r,
                    cache_creation_tokens=cache_c,
                    api_requests=api_r,
                )
                return
            cur.input_tokens += input_t
            cur.output_tokens += output_t
            cur.cache_read_tokens += cache_r
            cur.cache_creation_tokens += cache_c
            cur.api_requests += api_r

        for row in detail_rows:
            _merge(
                str(row["model"]),
                int(row["input_tokens"] or 0),
                int(row["output_tokens"] or 0),
                int(row["cache_read_tokens"] or 0),
                int(row["cache_creation_tokens"] or 0),
                int(row["api_requests"] or 0),
            )
        for row in fallback_rows:
            # 兜底桶 api_requests 恒 0（老 run 无调用次数字段，诚实值 R-01）。
            _merge(
                str(row["model"]),
                int(row["input_tokens"] or 0),
                int(row["output_tokens"] or 0),
                int(row["cache_read_tokens"] or 0),
                int(row["cache_creation_tokens"] or 0),
                0,
            )

        # by_model 排序：input+output 总量降序；「未记录」桶恒末位（即使总量最大）。
        by_model = sorted(
            buckets.values(),
            key=lambda item: (
                item.model == unrecorded,
                -(item.input_tokens + item.output_tokens),
            ),
        )
        totals = SessionUsageModelItemRead(
            model="totals",  # 占位（前端只读五指标，不消费 totals.model）
            input_tokens=sum(item.input_tokens for item in by_model),
            output_tokens=sum(item.output_tokens for item in by_model),
            cache_read_tokens=sum(item.cache_read_tokens for item in by_model),
            cache_creation_tokens=sum(item.cache_creation_tokens for item in by_model),
            api_requests=sum(item.api_requests for item in by_model),
        )
        return SessionUsageRead(totals=totals, by_model=by_model)

    async def get_session_for_runtime_owner(
        self,
        session_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> AgentSession:
        """只读校验：目标 session 绑定的 runtime 归属 ``actor_user_id``（2026-08-25）。

        daemon 上行 5 端点越权修复（P1）：ready / plan-mode-entered /
        bash-status / bash-chunk / agent-task-status 原先只做
        ``get_current_principal``——任意已认证主体可向他人会话 mark_ready /
        向 ``agent_session:{id}`` 频道发布伪造事件。参照 end_session 的
        ``actor_runtime_owner_id`` 先例（ql-20260623-004：api-key owner =
        runtime owner，admin 共享 runtime 场景 creator≠owner，不能比对
        ``AgentSession.user_id``）：join ``daemon_runtimes`` 校验 runtime 归属。

        只读版 :meth:`_get_session_by_runtime_owner_for_update`（无 FOR UPDATE
        行锁，不阻塞并发收口事务）；缺失 / 跨 owner 一律 404，中文文案，
        不泄露存在性。
        """
        from app.modules.daemon.model import DaemonRuntime

        stmt = (
            select(AgentSession)
            .join(DaemonRuntime, AgentSession.runtime_id == DaemonRuntime.id)
            .where(
                AgentSession.id == session_id,
                DaemonRuntime.user_id == actor_user_id,
            )
        )
        agent_session = (await self._session.execute(stmt)).scalar_one_or_none()
        if agent_session is None:
            raise DaemonSessionNotFound(
                "指定的会话不存在或无权访问。",
                details={"session_id": str(session_id)},
            )
        return agent_session


async def dispatch_next_queued_message(session_id: uuid.UUID) -> None:
    """后台派发会话排队消息（ql-20260825-011，run 终态钩子调用）。

    独立 DB session（H1，对齐 run_sync._run_gate_decision_task 模式）——
    后台任务生命周期独立于触发它的 HTTP/WS 请求会话。异常 fail-loud 交
    `_fire_background_task` 的 done_callback 记日志，不影响已提交的 run
    终态。锁与「至多一个活跃 run」不变式由 dispatch_queued_messages 内部
    的会话行锁 + current_run 复查保证。
    """
    from app.core.db import get_session_factory

    session_factory = get_session_factory()
    async with session_factory() as db:
        svc = SessionService(db)
        await svc.dispatch_queued_messages(session_id)
