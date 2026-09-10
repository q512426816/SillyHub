"""interactive session CRUD / 列表信号流端点（task-07 拆分）。

GET /sessions 列表 + /sessions/events 列表变更 SSE + 详情/创建/inject/
reopen/interrupt/end/delete/archive/ctx-window。``_SESSION_SSE_HEADERS`` 与
``_stream_sessions_events`` 生成体在此（stream_session_logs 的 SSE 头从本模块
取用）。
patch 兼容（D-007）：get_redis / SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC 的
patch 目标在包 ``__init__`` 命名空间，本模块经 ``_router`` 延迟解析。
同形状保序对：/sessions/events 先于 /sessions/{session_id}。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime
from typing import Literal

from fastapi import (
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy import select as sa_select

import app.modules.daemon.router as _router
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.schema import (
    AgentSessionListResponse,
    AgentSessionRead,
    PpmItemKindLiteral,
    SessionAutoResumeUpdateRequest,
    SessionCreateRequest,
    SessionCtxWindowUpdateRequest,
    SessionInjectRequest,
    SessionReopenResponse,
    SessionTitleUpdateRequest,
)
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session_events import SESSIONS_CHANGED_CHANNEL

log = get_logger("app.modules.daemon.router")

# SSE response headers shared with the run-scoped stream endpoint
# (app/modules/agent/router.py). Proxies/buffers must not hold SSE frames.
_SESSION_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class SessionCreateResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    lease_id: uuid.UUID
    status: str
    stream_url: str


class SessionInjectResponse(BaseModel):
    """ql-20260825-011：``queued=True`` 时消息进服务端排队（run_id 为 None），
    run 终态后自动派发；``queued=False`` 为既有即时派发语义。"""

    session_id: uuid.UUID
    run_id: uuid.UUID | None = None
    status: str
    queued: bool = False
    queue_entry_id: uuid.UUID | None = None


class SessionControlResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    current_run_id: uuid.UUID | None = None


class SessionEndRequest(BaseModel):
    """gap-4 (design §5): daemon uplink body for POST /sessions/{id}/end.

    Optional body carried by the daemon ``notifySessionEnd`` call. ``status``
    is informational (the backend reconciles to ``ended`` regardless — failed
    sessions are still driven through end_session by the daemon after fail()).
    ``reason`` is recorded into the ``session_ended`` SSE event for UI context.
    """

    status: Literal["ended", "failed"] | None = None
    reason: str | None = Field(default=None, max_length=2000)


# ── Session list + history (task-12, FR-10 / D-005@v1) ───────────────────────
# IMPORTANT: ``GET /sessions`` (fixed path) is registered BEFORE the
# parameterized ``/sessions/{session_id}/...`` routes so FastAPI does not match
# the literal "sessions" against a path param. History logs reuse the existing
# AgentRunLogEntry DTO from agent.schema (no field-drift copy).

_SessionStatusQuery = Literal["pending", "active", "reconnecting", "ended", "failed"]
# task-06 / FR-02：引擎胶囊 tab 过滤（与 create 的 InteractiveProviderLiteral 同域，
# Literal 校验 → 未知值 422，与 status 处理一致）。
_SessionProviderQuery = Literal["claude", "codex"]
# 2026-09-01-session-group-chat task-02：会话形态过滤 Literal（未知值 422，与
# status/provider 同口径）。
_SessionKindQuery = Literal["chat", "group", "group_member"]


@router.get(
    "/sessions",
    response_model=AgentSessionListResponse,
)
async def list_sessions(
    session: SessionDep,
    user: TaskRunAgentUser,
    # 2026-08-23-sessions-workspace-hub task-01 / D-103@v1：一次拉取上限放宽
    # le=100 → le=500（portal 单页全量取回；>500 仍 422 拒绝）。
    limit: int = Query(default=20, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: _SessionStatusQuery | None = Query(default=None),
    runtime_id: uuid.UUID | None = Query(default=None),
    machine_id: uuid.UUID | None = Query(default=None),
    provider: _SessionProviderQuery | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    # 2026-08-22-workspace-sessions-portal / D-003@v2：workspace/change 级
    # 门户复用本端点，SQL 层精确匹配（照 runtime_id 模式，可选零回归）。
    workspace_id: uuid.UUID | None = Query(default=None),
    change_id: uuid.UUID | None = Query(default=None),
    # 2026-08-25-session-spec-binding task-04 / FR-05：快速修复级关联筛选——
    # ql_id 短码（非 UUID，如 ql-20260824-014），service 层走 quicklog_session_
    # links (workspace_id, ql_id) 子查询；max_length 对齐 links 表 ql_id 列
    # String(128)。不传 = 现状（零回归）。
    ql_id: str | None = Query(default=None, max_length=128),
    # task-02（2026-08-28-session-ppm-task-binding / FR-05 / D-005@v1）：PPM 条目
    # 级关联筛选——kind 走 Literal 校验（非法值 422，与 status/provider 同口径），
    # item_id 为 UUID；二者成对携带（只传其一 422，见下方手工成对校验），不传
    # = 现状（零回归）。service 层走 ppm_item_session_links 子查询。
    ppm_item_kind: PpmItemKindLiteral | None = Query(default=None),
    ppm_item_id: uuid.UUID | None = Query(default=None),
    # 2026-08-24：会话归档过滤（True=只看已归档，False=只看未归档）。
    # ql-20260831-015：HTTP 默认改 None=不过滤（全部，含已归档）——「全部状态」
    # 筛选语义即全部；service 层默认仍 False（内部调用零回归）。
    archived: bool | None = Query(default=None),
    # 2026-09-01-session-group-chat task-02 / design §5.3：会话形态过滤——默认
    # 'chat'（存量口径），群聊列表走新端点 GET /api/daemon/group-chats（按成员
    # 表过滤），群/影子会话不泄漏进普通列表；显式传 'group'/'group_member'
    # 可选覆盖（admin debug 等），None=不过滤（照 archived 三态先例）。
    session_kind: _SessionKindQuery | None = Query(default="chat"),
) -> AgentSessionListResponse:
    """List the current user's AgentSessions (owner-scoped, stable paging).

    task-06 / FR-02 / D-003@v1：可选过滤参数 runtime_id / machine_id（经
    daemon_runtimes 关联）/ provider / q（内容模糊，实现为 user_input 的内容
    ilike，不匹配改过的 title 列，见 service 层 docstring——ISS-06）；全部可选，
    不传时查询与现状一致（零回归）。
    过滤在 SQL 层完成，total 为过滤后总数（R-04 真分页），分页 limit/offset
    作用于过滤结果。machine_id 不匹配 runtime 缺失的旧会话（无 runtime 即无机器）。
    2026-08-22-workspace-sessions-portal / D-003@v2：新增可选 workspace_id /
    change_id（AgentSession 冗余绑定列精确匹配），供 workspace/change 级会话
    门户复用全局端点做 scope 过滤；不传 = 现状（零回归）。
    2026-08-25-session-spec-binding task-04 / FR-05（design §5.W3.3 / §9）：
    change_id 语义从单 FK 精确匹配扩大为 change_session_links M:N 子查询
    命中（存量单 FK 已播种为 link 行，原命中集是新命中集子集，参数名/类型
    不变向后兼容）；新增可选 ql_id（快速修复短码，走 quicklog_session_links
    按 (workspace_id, ql_id) 双条件子查询，防跨工作区同 ql_id 串扰），不传
    = 现状（零回归）。
    task-02（2026-08-28-session-ppm-task-binding / FR-05 / §9）：新增可选
    ppm_item_kind + ppm_item_id 成对筛选（ppm_item_session_links 子查询命中；
    kind Literal 校验非法值 422，只传其一 422——与 create/inject 通道同口径；
    不传 = 现状，零回归）。
    """
    # task-02：Query 参数无 DTO model_validator 可用，成对约束在此手工校验
    # （只传其一 422，对齐 SessionCreateRequest._require_ppm_item_pair 口径）。
    # 注意 status_code 用字面量——本函数的 ``status`` 查询参数遮蔽了 fastapi 的
    # ``status`` 模块（同款先例：下方 status Literal 校验）。
    if (ppm_item_kind is None) != (ppm_item_id is None):
        raise HTTPException(
            status_code=422,
            # 与 SessionCreateRequest._require_ppm_item_pair 同口径（用户可见 422 文案中文化）。
            detail="ppm_item_kind 与 ppm_item_id 必须成对提供。",
        )
    from app.modules.agent.model import AgentRun, AgentRunLog

    svc = DaemonService(session)
    # 2026-09-01-session-group-chat task-02：session_kind 直传 SessionService——
    # facade（daemon/service.py）不在本任务 allowed_paths，签名暂未同步该参数；
    # service 层参数带默认值 'chat'，facade 既有调用方零影响（模块卡「签名需
    # 同步，缺省会 500」只针对无默认参数）。经 facade 已持有的 _sess 子服务
    # 引用透传（permission_service `self._svc._session` 穿透访问同款先例）。
    items, total = await svc._sess.list_agent_sessions(
        user.id,
        limit=limit,
        offset=offset,
        status_filter=status,
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
    reads = [AgentSessionRead.model_validate(item) for item in items]
    # 2026-08-23-sessions-workspace-hub task-01 / FR-05 / D-108@v2：批量查
    # users 注入 owner_name（照 OwnerRead / 下方 terminating_at 的
    # IN 批查注入先例，免逐行 N+1）。ql-20260823-003：展示名 display_name
    # 优先、回退 username 登录名（用户反馈：树里应显示名称不是登录名）。
    # 属主用户行缺失 / 两字段均未回填的旧数据不在 map 中 → 保持 None
    # （brownfield，不阻断列表）。
    owner_ids = {item.user_id for item in items if item.user_id is not None}
    if owner_ids:
        owner_rows = (
            await session.execute(
                select(User.id, User.display_name, User.username).where(User.id.in_(owner_ids))
            )
        ).all()
        owner_names: dict[uuid.UUID, str] = {
            row[0]: (row[1] or row[2]) for row in owner_rows if (row[1] or row[2]) is not None
        }
        for r in reads:
            r.owner_name = owner_names.get(r.user_id)
    # task-13 / FR-04 / design §5 Phase4：批量查 lease.terminating_at 注入到每个 read。
    # 经 session.lease_id 关联 DaemonTaskLease；只查本页 lease_id 非空子集（IN 避免 N+1）。
    # lease.terminating_at 为空 / session 无 lease → read.terminating_at 保持 None（brownfield）。
    lease_ids = {item.lease_id for item in items if item.lease_id is not None}
    if lease_ids:
        term_rows = (
            await session.execute(
                select(DaemonTaskLease.id, DaemonTaskLease.terminating_at).where(
                    DaemonTaskLease.id.in_(lease_ids)
                )
            )
        ).all()
        term_map: dict[uuid.UUID, datetime] = {
            row[0]: row[1] for row in term_rows if row[1] is not None
        }
        for r in reads:
            if r.lease_id and r.lease_id in term_map:
                r.terminating_at = term_map[r.lease_id]
    # FR-08 / D-006: 复用 list_change_sessions 的首条 user_input 摘要逻辑（前 30 字）。
    # 逻辑与 change/router.py:list_change_sessions 保持同步（R-7），未来可抽共享 helper。
    # 2026-09-09 阿里云 slow.query 实测（本查询 3.1s）：①只对 title 为空的会话查——
    # 有 title 的会话走 session.title 派生（下方 get(r.id) or 不变），tool_report
    # 会话已带自动标题，直接跳过整个摘要查询；②SQL 内 substr 截到 64 字符，免把
    # 单行均值 33KB 的 TOAST 全文解压拉回（消费方 [:30]，substr 双方言语符语义，
    # 64 > 30 保证派生零回归）。
    if items:
        session_ids = [item.id for item in items if not item.title]
        if session_ids:
            # P5（2026-08-24 会话审查）：窗口函数分区取每会话首条 user_input——
            # 原实现拉页内会话全部 user_input 行（50KB 文本）Python 取最早，
            # 长会话下列表请求随轮数线性放大。PG/SQLite 双方言支持。
            rn = (
                sa_func.row_number()
                .over(
                    partition_by=AgentRun.agent_session_id,
                    order_by=(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()),
                )
                .label("rn")
            )
            title_subq = (
                sa_select(
                    AgentRun.agent_session_id.label("session_id"),
                    sa_func.substr(AgentRunLog.content_redacted, 1, 64).label("content"),
                    rn,
                )
                .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
                .where(
                    AgentRun.agent_session_id.in_(session_ids),
                    AgentRunLog.channel == "user_input",
                )
                .subquery()
            )
            title_rows = (
                await session.execute(
                    sa_select(title_subq.c.session_id, title_subq.c.content).where(
                        title_subq.c.rn == 1
                    )
                )
            ).all()
            content_by = {row.session_id: (row.content or "") for row in title_rows}
            title_map = {sid: (content or "")[:30] or None for sid, content in content_by.items()}
        else:
            title_map = {}
        # task-05（2026-08-23-agent-activity-sessions / design §3.3.4）：标题派生改
        # session.title（ORM 持久化列，tool_report 会话由 task-04 服务端写自动标题）
        # 优先，无标题回落既有首条 user_input 前 30 字派生——chat 会话 title 列恒
        # NULL，行为与现状逐字节一致（零回归）；详情端点 title 为 ORM 列经
        # from_attributes 自动映射，无需本段注入。
        session_titles: dict[uuid.UUID, str | None] = {item.id: item.title for item in items}
        for r in reads:
            r.title = session_titles.get(r.id) or title_map.get(r.id)
    return AgentSessionListResponse(
        items=reads,
        total=total,
        limit=limit,
        offset=offset,
    )


# task-04 / FR：浏览器可订阅的会话列表变更信号流。固定路径 ``/sessions/events``
# 必须注册在两段式参数路由 ``GET /sessions/{session_id}``（get_session_detail）
# 之前——否则 "events" 会被当作 {session_id} 吞掉返回 422。2026-08-24 verify
# 真实运行时冒烟实测踩中此坑（原只先于三段式 ``/sessions/{id}/...`` 不够）：
# 未登录 401 探针测不出遮蔽——auth 依赖先于路径参数校验触发，回归须带鉴权
# （test_sessions_events_stream.py::test_route_reachable_authenticated）。
@router.get("/sessions/events")
async def stream_sessions_events(
    user: TaskRunAgentUser,
) -> StreamingResponse:
    """Stream list-change signals for the current user's sessions (task-04).

    浏览器 EventSource 订阅 ``GET /api/daemon/sessions/events``，收到本人会话的
    created / status_changed / deleted 信号后刷新列表视图（代替轮询 GET /sessions）。
    data 帧 JSON：``event`` / ``session_id`` / ``user_id`` / ``at``（由 task-01
    ``publish_sessions_changed`` 发布，原样透传，不做 Last-Event-ID 回放——D-006
    Non-Goal）。

    单频道 + 服务端过滤（D-005）：所有用户共享 ``SESSIONS_CHANGED_CHANNEL`` 全局
    频道，本生成器只下发 ``user_id`` 等于当前用户的信号，他人信号静默丢弃。

    连接池安全（对齐 stream_session_logs）：不注入请求级 DB session；鉴权链
    （get_current_user / require_permission_any）查库完成后即 rollback 归还
    DB 连接（2026-08-25 auth_deps 修复），生成器内零 DB 访问——流存续期间
    不占用任何连接池 slot。
    """
    return StreamingResponse(
        _stream_sessions_events(str(user.id)),
        media_type="text/event-stream",
        headers=_SESSION_SSE_HEADERS,
    )


async def _stream_sessions_events(user_id: str) -> AsyncGenerator[str, None]:
    """订阅全局列表变更频道并按用户过滤下发（stream_sessions_events 的生成器体）。

    帧协议（对齐 AgentService.stream_session_logs 先例）：
    * ``: connected`` 初始注释——立即冲掉代理缓冲，让 EventSource 尽快 open；
    * ``data: {raw}`` —— 本人信号原样透传（raw 即 publish 端 json.dumps 产物，
      保证 ``event/session_id/user_id/at`` 字段与发布侧零漂移）；
    * ``: keepalive`` —— 静默约 30s（get_message timeout 到点返回 None）或持续
      他人信号（跳过不产出帧）超过约 25s 无产出时，发一条注释帧维持连接；
    * finally —— 客户端断开（GeneratorExit）或异常时 unsubscribe + aclose，
      不泄漏 Redis 订阅连接。
    """
    redis = _router.get_redis()
    pubsub = redis.pubsub()
    # keepalive 饥饿防护（2026-08-25 P2）：单频道广播下他人信号被静默跳过时不
    # 产出任何帧，全局频道持续有流量（但全是他人信号）时代理可能按空闲超时
    # 掐断连接。记录上次向客户端产出帧的时刻（含 connected），循环内无论
    # 是否收到消息，超过 ``SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC`` 未产出即
    # 补一条 keepalive。
    keepalive_interval_sec = _router.SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC
    loop = asyncio.get_running_loop()
    last_frame_at = loop.time()
    try:
        yield ": connected\n\n"

        await pubsub.subscribe(SESSIONS_CHANGED_CHANNEL)

        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30.0)
            emitted = False
            if msg and msg.get("type") == "message":
                raw = msg.get("data")
                try:
                    payload = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    payload = {}
                # 非对象 JSON（list / str / number…）没有 user_id 可过滤，按
                # 非本人信号跳过；防御 payload.get 的 AttributeError 炸掉整条流。
                if not isinstance(payload, dict):
                    payload = {}
                # 单频道广播（D-005）：只下发属于当前用户的信号，其余静默跳过
                # （跳过不产出帧，继续等下一条）。
                # 2026-09-01-session-group-chat task-06（design §5.3 audience）：
                # 命中条件扩为「user_id == 当前用户 或 当前用户 in
                # audience_user_ids（群事件内嵌的全体用户成员 id）」——群事件
                # 的 user_id 位是群主，成员经 audience 命中；单聊事件不带该
                # 字段，行为零漂移。
                audience_ids = payload.get("audience_user_ids")
                if payload.get("user_id") == user_id or (
                    isinstance(audience_ids, list) and user_id in audience_ids
                ):
                    yield f"data: {raw}\n\n"
                    emitted = True
            if emitted:
                last_frame_at = loop.time()
            elif loop.time() - last_frame_at >= keepalive_interval_sec:
                yield ": keepalive\n\n"
                last_frame_at = loop.time()
    finally:
        # 两步清理各自隔离：连接已死时 unsubscribe 可能抛 ConnectionError——
        # 吞掉并记 warning，保证随后的 aclose（归还 Redis 连接）仍然执行；
        # close 在 redis-py 7.4 已废弃，统一用 aclose。
        try:
            await pubsub.unsubscribe(SESSIONS_CHANGED_CHANNEL)
        except Exception:
            log.warning(
                "sessions_events_unsubscribe_failed",
                channel=SESSIONS_CHANGED_CHANNEL,
                exc_info=True,
            )
        await pubsub.aclose()


@router.get(
    "/sessions/{session_id}",
    response_model=AgentSessionRead,
)
async def get_session_detail(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> AgentSessionRead:
    """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

    Read-only single-read counterpart to ``GET /sessions``. Ownership is
    enforced inside the service so a missing OR cross-user session both
    surface as 404 without leaking existence.
    """
    svc = DaemonService(session)
    agent_session = await svc.get_agent_session(session_id, user.id)
    read = AgentSessionRead.model_validate(agent_session)
    # task-13 / FR-04 / design §5 Phase4：经 session.lease_id 关联查 lease.terminating_at。
    # lease 无 / terminating_at 为空 → read.terminating_at 保持 None（brownfield 守护）。
    if agent_session.lease_id is not None:
        lease_row = (
            await session.execute(
                select(DaemonTaskLease.terminating_at).where(
                    DaemonTaskLease.id == agent_session.lease_id
                )
            )
        ).first()
        if lease_row is not None and lease_row[0] is not None:
            read.terminating_at = lease_row[0]
    # 查当前运行 run（attach 恢复 currentRunId，启用打断按钮；无运行 run 则 null）
    # P2（2026-08-25 二审 #3）：词表单源 agent.model.ACTIVE_RUN_STATUSES——修复
    # pending_approval 审批中的 run 被漏判（interrupting backend 永不落库已剔除）。
    from app.modules.agent.model import ACTIVE_RUN_STATUSES, AgentRun

    current_run = (
        (
            await session.execute(
                select(AgentRun)
                .where(
                    AgentRun.agent_session_id == session_id,
                    AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
                )
                # quick（ql-20260910-011-3d92）：与 list_session_runs 同款改
                # created_at——pending 未认领 run 的 started_at 为 NULL，PG DESC
                # 默认 NULLS FIRST，多活跃 run 并存时挑出的不是最新创建的那条。
                .order_by(AgentRun.created_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    read.current_run_id = current_run.id if current_run else None
    return read


@router.post(
    "/sessions",
    response_model=SessionCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    data: SessionCreateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionCreateResponse:
    """Create a new interactive session and dispatch its first turn (FR-01)."""
    svc = DaemonService(session)
    # 2026-08-14-sessions-portal task-02：DTO 具名化迁 schema.py。runtime_id/
    # agent_profile_id/llm_provider_id 仅透传 service（解析归 task-03）；model
    # 曾随 design §5 移除，D-002@v1（2026-08-29-usage-by-provider-model）恢复
    # 透传（预会话级联首句模型，None/空串=跟随供应商配置）。
    # task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话团队
    # 任务块透传（共享校验/预建/简报归 service，本端点仅此一处路由改动）。
    # 2026-08-25-unified-floating-session（FR-5）：页面上下文块透传（前导构建
    # 归 service create 路径）。
    # task-08（2026-08-25-session-spec-binding / FR-04 / FR-06）：quicklog_id
    # 透传（对齐 change_id 既有透传形态；落绑定归 service 创建落库点）。
    # ql-20260825-001：首句附件透传（校验/标记行/组装归 service）。
    # task-02（2026-08-28-session-ppm-task-binding / FR-01）：PPM 条目成对绑定
    # 字段透传（DTO 成对校验 422 已在 schema 层；item 校验/工作区解析/落 link
    # 归 service；漏透传会 500，三层同步加参）。
    result = await svc.create_session(
        user.id,
        provider=data.provider,
        prompt=data.prompt,
        runtime_id=data.runtime_id,
        agent_profile_id=data.agent_profile_id,
        llm_provider_id=data.llm_provider_id,
        model=data.model,
        manual_approval=data.manual_approval,
        ask_user_only=data.ask_user_only,
        change_id=data.change_id,
        workspace_id=data.workspace_id,
        quicklog_id=data.quicklog_id,
        ppm_item_kind=data.ppm_item_kind,
        ppm_item_id=data.ppm_item_id,
        team_mission=data.team_mission,
        # P0 修复（2026-08-26，E2E 实证）：team_mission 预建主控会话必须写
        # stage='orchestrator' → daemon isMainAgentSession 谓词命中 → 注入
        # dispatch_worker 等 5 工具。当前谓词对 stage==='' 也放行是普通会话的
        # 兼容口径，但 create_session 内部 placement:762 的 hardcoded
        # ask_user_only=True 在无 tool_config 白名单时不拦 MCP 工具——真正缺的
        # 是主控身份标记（无 stage → 前端 inject 侧简报/工具注入语义断裂）。
        stage="orchestrator" if data.team_mission is not None else None,
        page_context=data.page_context,
        attachment_ids=data.attachment_ids,
    )
    s = result.agent_session
    return SessionCreateResponse(
        session_id=s.id,
        run_id=result.agent_run.id,
        lease_id=result.lease_id,
        status=s.status or "active",
        stream_url=f"/api/daemon/sessions/{s.id}/stream",
    )


@router.post(
    "/sessions/{session_id}/inject",
    response_model=SessionInjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def inject_session(
    session_id: uuid.UUID,
    data: SessionInjectRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionInjectResponse:
    """Append a new turn run to an active interactive session (FR-02)."""
    svc = DaemonService(session)
    # 2026-08-14-sessions-portal task-02：agent_profile_id/llm_provider_id 仅透传
    # （切档案/切供应商校验与 SESSION_SWITCH_CONFIG 归 task-05）。
    result = await svc.inject_session(
        session_id,
        user.id,
        prompt=data.prompt,
        agent_profile_id=data.agent_profile_id,
        llm_provider_id=data.llm_provider_id,
        # task-11（2026-08-29-usage-by-provider-model / FR-03-3）：会话级模型选择
        # 透传（空串=跟随供应商配置；非空需同请求携带 llm_provider_id，422 守卫
        # 归 SessionService 入口）。
        model=data.model,
        # 2026-08-20-session-multimodal-attachments task-05：附件引用透传
        # （协调者扩权本文件：DTO 新字段须经路由转达 service，卡内已同步）。
        attachment_ids=data.attachment_ids or None,
        # ql-20260825-004：每轮注入携带当前页面上下文。
        page_context=data.page_context,
        # task-07（2026-08-26-session-input-mention / FR-06）：@ 联想绑定字段透传
        # （幂等 binder 调用归 SessionService，三层同步加参——漏透传会 500）。
        bind_change_key=data.bind_change_key,
        bind_quick_id=data.bind_quick_id,
        # task-02（2026-08-28-session-ppm-task-binding / FR-02）：PPM 条目追问
        # 绑定成对字段透传（幂等 binder 归 SessionService，三层同步加参）。
        bind_ppm_item_kind=data.bind_ppm_item_kind,
        bind_ppm_item_id=data.bind_ppm_item_id,
        # ql-20260825-011：忙轮入队（后端真实排队，前端 UI 语义）；服务身份
        # 调用方不经本端点，保持 409 拒绝语义。
        queue_when_busy=True,
    )
    return SessionInjectResponse(
        session_id=result.agent_session.id,
        run_id=result.agent_run.id if result.agent_run is not None else None,
        status=(result.agent_run.status or "pending" if result.agent_run is not None else "queued"),
        queued=result.queued,
        queue_entry_id=result.queue_entry_id,
    )


@router.post(
    "/sessions/{session_id}/reopen",
    response_model=SessionReopenResponse,
)
async def reopen_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionReopenResponse:
    """Reopen an ended Claude session for SDK resume (task-05 / FR-2).

    Validation + optimistic placeholder only — sets ``status=reconnecting``
    and returns immediately; the full lease/WS transition is task-07 and the
    daemon SDK resume is task-08. Never blocks on daemon confirmation
    (design §4.3.1 step 7).
    """
    svc = DaemonService(session)
    return await svc.reopen_session(session_id, user.id)


@router.post(
    "/sessions/{session_id}/interrupt",
    response_model=SessionControlResponse,
)
async def interrupt_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionControlResponse:
    """Send a turn-level interrupt for the current run (FR-04)."""
    svc = DaemonService(session)
    result = await svc.interrupt_session(session_id, user.id)
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "active",
        current_run_id=result.current_run_id,
    )


@router.post(
    "/sessions/{session_id}/end",
    response_model=SessionControlResponse,
)
async def end_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: TaskRunAgentUser,
    reason: str = Query(default="manual"),
    # gap-4 (design §5): daemon uplink body. Optional so the front-end
    # (query-only) and the daemon (body) can share this endpoint. When the
    # body carries a reason it takes precedence over the query param.
    end_body: SessionEndRequest | None = None,
) -> SessionControlResponse:
    """End an interactive session: single reconciliation of session/lease/run (FR-05).

    gap-4 (design §5): daemon uplink. The daemon ``SessionManager.end/fail`` →
    ``hubClient.notifySessionEnd`` → this endpoint with ``{status, reason}`` in
    the body and ``X-API-Key`` auth (resolved by ``get_current_principal`` to the
    runtime owner). The front-end still calls with ``?reason=manual`` (no body);
    both paths converge on ``service.end_session``. Body reason wins when present.

    ql-20260623-004: 区分调用方定 session 归属——daemon（无 Bearer，仅
    ``X-API-Key``）传 ``actor_runtime_owner_id``，service 走 runtime 归属校验
    （api-key owner = runtime owner，不查 ``AgentSession.user_id``，否则 admin
    共享 runtime 场景 creator≠owner 必 404）；前端（Bearer JWT）保持 user_id 校验。
    """
    effective_reason = end_body.reason if (end_body and end_body.reason) else reason
    # 无 Authorization: Bearer 即 daemon 身份（X-API-Key）：api-key owner 是
    # runtime owner，走 runtime 归属校验；否则前端 Bearer JWT 走 user_id 校验。
    has_bearer = (request.headers.get("authorization") or "").lower().startswith("bearer ")
    svc = DaemonService(session)
    result = await svc.end_session(
        session_id,
        user.id,
        reason=effective_reason,
        actor_runtime_owner_id=None if has_bearer else user.id,
    )
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "ended",
        current_run_id=result.current_run_id,
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Delete an owned terminal session without deleting its run history."""
    await DaemonService(session).delete_agent_session(session_id, user.id)


# 2026-08-24：会话归档/取消归档端点（照 delete_session 模式）。


@router.patch(
    "/sessions/{session_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Archive an owned session (hide from default list view)."""
    await DaemonService(session).archive_session(session_id, user.id)


@router.patch(
    "/sessions/{session_id}/unarchive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unarchive_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Unarchive an owned session (restore to default list view)."""
    await DaemonService(session).unarchive_session(session_id, user.id)


# ql-20260831-002：会话级上下文窗口覆盖（前端上下文环分母可编辑，本地模型/
# 本机默认派生不出分母的主场景）。照 archive 模式：owner 校验归 service，204。
@router.patch(
    "/sessions/{session_id}/ctx-window",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def update_session_ctx_window(
    session_id: uuid.UUID,
    data: SessionCtxWindowUpdateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Set/clear the context window override for an owned session (display-only)."""
    await DaemonService(session).update_ctx_window(session_id, user.id, data.ctx_window_tokens)


# 2026-09-10-auto-resume-interrupted-turn / FR-06 / D-010@v2：会话级「daemon 重启
# 自动续跑」开关——照 ctx-window 先例（owner 校验归 service、204）。存储走
# session.config merge（control.py 先例），恢复链守卫 G2 直读该键。
@router.patch(
    "/sessions/{session_id}/auto-resume",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def update_session_auto_resume(
    session_id: uuid.UUID,
    data: SessionAutoResumeUpdateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Enable/disable daemon-restart auto-resume for an owned session (default on)."""
    await DaemonService(session).update_auto_resume_pref(session_id, user.id, data.enabled)


# task-02（2026-09-07-session-pin-rename-scheduled-send / FR-01~FR-03 / FR-06）：
# 会话置顶/取消置顶/重命名三端点——照 archive/unarchive 模式（owner 校验归
# service、404 不泄露存在性、成功后 publish_sessions_changed 广播 status_changed）。


@router.patch(
    "/sessions/{session_id}/pin",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def pin_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Pin an owned session (pinned-first ordering, idempotent)."""
    await DaemonService(session).pin_session(session_id, user.id)


@router.patch(
    "/sessions/{session_id}/unpin",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unpin_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Unpin an owned session (restore to recent-activity ordering, idempotent)."""
    await DaemonService(session).unpin_session(session_id, user.id)


@router.patch(
    "/sessions/{session_id}/title",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def rename_session(
    session_id: uuid.UUID,
    data: SessionTitleUpdateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Rename an owned session (title strip 后非空 ≤255，非法 422 不落库)."""
    await DaemonService(session).rename_session(session_id, user.id, data.title)
