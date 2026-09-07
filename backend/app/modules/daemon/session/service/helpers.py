"""session 子域共享 helper（task-08 拆分，原模块级函数 + 实例级 helper 搬移）。

内容：
- prompt 变换（/team 前缀剥离、后台任务通知合并、group chain marker 拼剥）；
- 6 个被跨文件导入的私有符号中的 5 个（_apply_session_terminal_status /
  _send_session_end_best_effort / _merge_lease_metadata /
  _resolve_daemon_id_for_runtime + group chain marker 拼剥一对——经包
  ``__init__`` 重导出保位，R-04）；
- SessionService 实例级共享 helper（行锁定位 / current run / 事件发布 /
  runtime 标签解析 / inject 绑定双写），第一参数传 service 实例（svc）。

D-007：``_svc`` 为包命名空间别名——log / ACTIVE_*_STATUSES / publish_
sessions_changed 等被 patch 或定义于 ``__init__`` 的名字一律经 ``_svc.`` 延迟
解析，禁止 from 原点直接绑定后调用。
"""

from __future__ import annotations

import re
import uuid
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.control_commands import KIND_SESSION_END, ControlCommandService
from app.modules.daemon.event_publish import publish_json_event
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.ppm.common.session_binding import (
    PpmItemKind,
    bind_session_to_ppm_item,
    load_ppm_item,
)

from .errors import DaemonSessionInvariantViolation, DaemonSessionNotFound

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

# ql-20260901-002：/team 平台 UI 指令前缀剥离（派发层）。前端改为发送原始
# 输入（气泡/回放显示 "/team 目标"），agent 永不接收该字面前缀（Claude Code
# 会当 slash command 报 Unknown command: /team，会话 2eac7c91 实证）——剥离
# 收口到后端派发组装点（create dispatch_prompt / inject SESSION_INJECT），
# 对齐前端 parseTeamCommand 的整条指令匹配语义（"/teams" 之类不误伤）。
_TEAM_COMMAND_PREFIX_RE = re.compile(r"^/team(?:\s+|$)")


def _strip_team_command_prefix(prompt: str) -> str:
    """剥掉消息头部的 ``/team`` 平台指令前缀（无前缀原样返回）。

    语义对齐前端 ``parseTeamCommand``：仅匹配整条指令（``/team`` 后必须跟
    空白或结尾），非贪婪一次剥离；纯展示层（AgentRunLog user_input / 队列
    条目）不调用本函数，保留用户原文。
    """
    return _TEAM_COMMAND_PREFIX_RE.sub("", prompt, count=1)


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
    if session.status not in _svc.ACTIVE_SESSION_STATUSES:
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
            _svc.log.warning(
                "session_end_control_send_failed",
                session_id=str(session_id),
                runtime_id=str(runtime_id),
                reason=reason,
            )
        return ok
    except Exception:
        _svc.log.warning(
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


# ── 排队轮群链 metadata 透传（task-04，design §4.3/§4.4 补线）─────────────────
# AgentSessionQueuedMessage 无 metadata 列——忙轮排队的群链信息（链 id
# source_carrier_run_id / chain_depth）入队时拼进 prompt 头部标记行，派发侧
# 解析剥离后写入新 run 的 user_input metadata_：排队派发轮与即时注入轮对
# turn_completed 互@检测的链可见性一致（task-05 投影 fail-open 缺口闭合）。
# ql-20260903-007：补 ``sender=<uuid>`` 段——派发侧附件归属基准读链标记的
# sender_user_id，此前只读不写恒 None（归属回退影子属主=群主，普通成员的
# 附件 404 → 排队条目 failed，消息丢失；注释与实现不一致）。

_GROUP_CHAIN_MARKER_RE = re.compile(
    r"^\[GROUP_CHAIN carrier=([0-9a-fA-F-]{36}) depth=(\d+)"
    r"(?: source=([A-Za-z0-9_]+))?(?: sender=([0-9a-fA-F-]{36}))?\]",
    re.IGNORECASE,
)


def _prepend_group_chain_marker(prompt: str, turn_metadata: dict | None) -> str:
    """群链 metadata 拼进排队 prompt 头部标记行（非群链轮原样返回）。

    quick 影子直聊（2026-09-02）：``turn_metadata.source`` 非空时追加
    ``source=<token>`` 段（当前唯一取值 "shadow_direct"）——直聊轮排队兜底后
    派发的新 run 仍带 source 标记，投影层判定不回退成全投影（否则直聊内容
    经排队派发整轮泄进群时间线）。

    ql-20260903-007：``turn_metadata.sender_user_id``（群链路恒写，task-04
    互@检测同源）非空且为合法 uuid 时追加 ``sender=<uuid>`` 段——派发侧据此
    还原附件归属基准（群附件上传者可能是普通成员，影子属主是群主）。
    """
    if not isinstance(turn_metadata, dict):
        return prompt
    carrier = turn_metadata.get("source_carrier_run_id")
    if not isinstance(carrier, str) or not carrier:
        return prompt
    depth = turn_metadata.get("chain_depth", 0)
    try:
        depth = int(depth)
    except (TypeError, ValueError):
        depth = 0
    source = turn_metadata.get("source")
    source_part = f" source={source}" if isinstance(source, str) and source.isidentifier() else ""
    sender_part = ""
    sender = turn_metadata.get("sender_user_id")
    if isinstance(sender, str) and sender:
        try:
            sender_part = f" sender={uuid.UUID(sender)}"
        except (ValueError, AttributeError):
            sender_part = ""
    return f"[GROUP_CHAIN carrier={carrier} depth={depth}{source_part}{sender_part}]\n{prompt}"


def _split_group_chain_marker(prompt: str) -> tuple[str, dict | None]:
    """剥离排队 prompt 头部群链标记行 → ``(剩余 prompt, 链 metadata | None)``。

    ``source=`` / ``sender=`` 段可选（老条目无该段 → metadata 不带对应键，
    旧条目派发零变化）。
    """
    match = _GROUP_CHAIN_MARKER_RE.match(prompt or "")
    if match is None:
        return prompt, None
    metadata: dict = {
        "source_carrier_run_id": match.group(1),
        "chain_depth": int(match.group(2)),
    }
    if match.group(3):
        metadata["source"] = match.group(3)
    if match.group(4):
        metadata["sender_user_id"] = match.group(4)
    return prompt[match.end() :].lstrip("\r\n"), metadata


# ── SessionService 实例级共享 helper（第一参数 svc，task-08 拆分）──────────


async def _get_owned_session_for_update(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentSession:
    """Lock and return the AgentSession owned by ``user_id``.

    Uses ``with_for_update`` so two concurrent inject/interrupt/end calls
    on the same session serialize at the DB row level (PostgreSQL FOR
    UPDATE; SQLite ignores the hint but the query/ownership semantics
    still hold). Returns 404 for missing / cross-user sessions without
    leaking existence (mirrors ``_get_owned_runtime``).

    2026-09-01-session-group-chat task-02 / design §5.3：群会话
    （kind='group'）参与者制分支——首查未命中（非属主）时经
    ``get_group_accessible_session`` 探测（群成员表命中 → workspace
    admin；影子会话 kind='group_member' 仅属主/admin，内部链路）。chat
    热路径首查单 SQL 逐字节不变；跨用户 chat 会话不额外加行锁（探测仅
    对 group 形态补 FOR UPDATE 回捞），仍统一 404 不泄露存在性。
    """
    stmt = (
        select(AgentSession)
        .where(
            AgentSession.id == session_id,
            AgentSession.user_id == user_id,
        )
        .with_for_update()
    )
    session = (await svc._session.execute(stmt)).scalar_one_or_none()
    if session is None:
        from app.modules.daemon.group.service import get_group_accessible_session

        group_session = await get_group_accessible_session(
            svc._session,
            session_id=session_id,
            user_id=user_id,
            for_update=True,
        )
        if group_session is not None:
            return group_session
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    return session


async def _get_session_by_runtime_owner_for_update(
    svc,
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
    session = (await svc._session.execute(stmt)).scalar_one_or_none()
    if session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    return session


async def _get_current_run(
    svc,
    session_id: uuid.UUID,
) -> AgentRun | None:
    """Return the single active-turn run for the session, or None.

    Active turn = status in _svc.ACTIVE_TURN_STATUSES (pending / running /
    pending_approval). AgentRun has no created_at, so we must rely on the
    invariant "at most one active run per session". Zero → None, one →
    that run, more than one → DaemonSessionInvariantViolation (never
    guess which one to terminate).
    """
    stmt = select(AgentRun).where(
        AgentRun.agent_session_id == session_id,
        col(AgentRun.status).in_(list(_svc.ACTIVE_TURN_STATUSES)),
    )
    runs = list((await svc._session.execute(stmt)).scalars().all())
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
    svc,
    session_id: uuid.UUID,
    payload: dict[str, object],
) -> None:
    """Publish an event on the ``agent_session:{session_id}`` Redis channel.

    Shared entry point for task-06 (SSE aggregation) and task-08
    (permission events). Failures are logged but never raised so a Redis
    blip cannot abort end/interrupt. Does NOT implement the SSE route,
    history replay, or cursor — those belong to task-06.

    task-11 轻重构④：序列化 + publish + 异常吞噬 + 日志核心收敛到
    ``daemon/event_publish.publish_json_event``（get_redis / log 经 ``_svc.``
    延迟解析后传入，既有 patch 面不变）。
    """
    await publish_json_event(
        redis_getter=_svc.get_redis,
        channel=f"agent_session:{session_id}",
        payload=payload,
        log=_svc.log,
        failure_event="publish_session_event_failed",
        session_id=str(session_id),
        redis_event=payload.get("event") if isinstance(payload, dict) else None,
    )


async def _resolve_runtime_labels(
    svc,
    runtime_id: uuid.UUID,
) -> tuple[str | None, str | None]:
    """task-03（Grill C-12）：config_snapshot 的机器名/智能体名解析。

    * ``machine_name``：runtime → DaemonInstance.display_alias（admin 别名，
      优先）→ hostname；无 daemon_instance（迁移期）→ None。
    * ``agent_name``：runtime.name → 回退 provider（claude/codex）。
    """
    runtime = await svc._session.get(DaemonRuntime, runtime_id)
    if runtime is None:
        return None, None
    agent_name = runtime.name or runtime.provider
    machine_name: str | None = None
    if runtime.daemon_instance_id is not None:
        instance = await svc._session.get(DaemonInstance, runtime.daemon_instance_id)
        if instance is not None:
            machine_name = instance.display_alias or instance.hostname
    return machine_name, agent_name


async def _bind_inject_session_links(
    svc,
    session: AgentSession,
    *,
    bind_change_key: str | None,
    bind_quick_id: str | None,
    bind_ppm_item_kind: PpmItemKind | None,
    bind_ppm_item_id: uuid.UUID | None,
) -> None:
    """inject_session 绑定双写段（task-08 自 inject_session:3141-3219 拆出，零改写）。

    @ 联想绑定（change/quicklog M:N link）+ PPM 条目追问绑定：best-effort
    savepoint 自吞异常，失败不阻断消息发送；workspace 缺失记 warning 跳过。
    """

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
            _svc.log.warning(
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
                    svc._session, bind_workspace_id, bind_change_key, session.id
                )
            if bind_quick_id:
                await bind_session_to_quicklog(
                    svc._session, bind_workspace_id, bind_quick_id, session.id
                )
            # 日志语义修正（缺陷收口 A-2）：binder 内部 savepoint 自吞异常
            # 且无返回值，调用后无条件打日志无法区分「已落库」与「被吞失败」
            # ——事件名用 session_bind_requested 表达「已请求绑定」而非
            # 「已落库」；绑定是否真实落库以 change_session_links /
            # quicklog_session_links link 表为准（binder 失败时自身会记
            # log.warning）。不改 binder 签名（不在本变更文件清单内）。
            _svc.log.info(
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
        _ppm_item = await load_ppm_item(svc._session, bind_ppm_item_kind, bind_ppm_item_id)
        if _ppm_item is None:
            _svc.log.warning(
                "session_ppm_bind_item_missing",
                kind=bind_ppm_item_kind,
                item_id=str(bind_ppm_item_id),
                session_id=str(session.id),
            )
        else:
            await bind_session_to_ppm_item(
                svc._session,
                workspace_id=session.workspace_id,
                kind=bind_ppm_item_kind,
                item_id=bind_ppm_item_id,
                session_id=session.id,
            )
            # 事件名语义对齐上方 A-2 口径：表达「已请求绑定」，真实落库以
            # ppm_item_session_links 表为准（binder 失败时自身记 warning）。
            _svc.log.info(
                "session_bind_requested",
                session_id=str(session.id),
                workspace_id=str(session.workspace_id),
                bind_ppm_item_kind=bind_ppm_item_kind,
                bind_ppm_item_id=str(bind_ppm_item_id),
            )
