"""session 观测端点：日志流 / runs / tasks / logs / 用量（task-07 拆分）。

原 session_extras 非队列域 5 端点：``/stream`` SSE 聚合（含 run_error 帧
包装）、``/runs``、``/tasks``、``/logs``、``/usage``；``SessionRunRead`` /
``_inject_run_error_events`` / ``_SESSION_TASKS_MAX`` 随域同迁。

patch 兼容（D-007）：``_SESSION_RUNS_MAX`` 常量在包 ``__init__``（测试 setattr
目标），本模块经 ``_router`` 延迟读取。
"""

from __future__ import annotations

import gzip
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime

from fastapi import Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

import app.modules.daemon.router as _router
from app.core.db import get_session_factory
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.router.session_crud import _SESSION_SSE_HEADERS
from app.modules.daemon.schema import (
    AgentSessionTaskRead,
    SessionUsageRead,
)
from app.modules.daemon.service import DaemonService, DaemonSessionNotFound
from app.modules.daemon.session.service import SessionService


class SessionRunRead(BaseModel):
    """GET /sessions/{id}/runs 单个 run 项（task-07 / FR-02 / design §7.4）。

    透传 ``AgentRun.error_detail``（模型层 ModelError 序列化值；成功 / 无错误 run
    为 None），供前端拉历史与当前 run 错误。``error_code``（调度层 / 系统错误）
    与 ``error_detail`` 正交共存（D-009），前端可分别用作系统错误兜底与模型错误
    渲染。DTO 内联在此避免触碰 schema.py（非本任务 allowed_path）。

    gap-fix（FR-07 whoLine / FR-08 历史 usage）：追加轮次配置快照与 usage 三组
    字段，均直映 AgentRun 既有列（查询本就 select 整实体，零查询改动）——
      - ``agent_profile_snapshot`` / ``llm_provider_id``：D-008@v1 轮次快照，供前端
        渲染每轮 whoLine（历史不跟随会话当前配置）；
      - ``input_tokens`` / ``output_tokens``：daemon 关单经 close_interactive_run
        写入（gap-3 result 透传），供前端历史回看累计 ctx usage（R-06）；
      - ``ctx_tokens``（2026-08-27-session-token-usage-fix task-05 / FR-01）：该
        run 期间最近一次 API 调用的提示词大小（daemon 经 usage 管线实时写入，
        close 终态不覆盖），供前端上下文环历史回填取最新非 null 值；历史行 /
        老 daemon 无上报为 None（环未知态，design §9）。
    全部 nullable——老 run 行 / 未配置轮为 None，前端如实显示未指定/不累计。
    """

    id: uuid.UUID
    # quick（2026-09-02 本地会话信息折叠）：CLI 上报轮（platform-managed）与
    # 用户交互轮的区分锚——tool_report 激活会话前端据此折叠前者。
    spec_strategy: str | None = None
    status: str
    error_code: str | None = None
    error_detail: dict | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    # ── ql-20260817-003：轮次发送者（守护进程共享场景多用户同会话发言）──
    # 由 runs 查询 left join users 填充；旧 run 行 NULL → 前端不显示发送行（零回归）。
    user_id: uuid.UUID | None = None
    sender_name: str | None = None
    # ── gap-fix：轮次配置快照（FR-07 / D-008@v1）+ usage（FR-08 / R-06）────
    agent_profile_snapshot: dict | None = None
    llm_provider_id: uuid.UUID | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    # task-05 / FR-01：最近一次调用提示词大小，from_attributes 直映
    # AgentRun.ctx_tokens 列（runs 查询零改动）；历史行 None 如实输出。
    ctx_tokens: int | None = None
    # ── ql-20260831-004：失败原因透出──────────────────────────────────────────
    # 调度层/系统层失败原因（撞闸 SESSION_LIMIT_REACHED、inject 过期联动、lease
    # 超时重试耗尽等），from_attributes 经 validation_alias 直映 AgentRun.
    # output_redacted 列（零查询改动）。仅 status=failed 的 run 才有语义——成功
    # 轮该列存的是 agent 输出摘要，前端只在 failed 时消费（勿当失败原因展示）。
    # 模型层错误仍走 error_detail（两者正交，D-009）。
    failure_summary: str | None = Field(default=None, validation_alias="output_redacted")
    model_config = {"from_attributes": True}


async def _inject_run_error_events(
    session_id: uuid.UUID,
    inner: AsyncGenerator[str, None],
) -> AsyncGenerator[str, None]:
    """Wrap ``AgentService.stream_session_logs`` to append ``run_error`` SSE 帧（task-07）。

    design §7.4 / §7.5 error_event_push：既有事件流**原样透传**（不改成功 / 失败的
    turn_completed 帧、不动 done / keepalive）；仅当一个 ``turn_completed`` 帧报告
    ``status=failed`` 且该 run 有 ``error_detail`` 时，在其后**追加**一个 ``run_error``
    数据帧（``run_id`` + ``error{type,code,message,retryable,hint,raw}``），让前端
    实时拿到模型层 ModelError 渲染错误卡片。

    实现为 router 侧包装：生成器本体在 ``AgentService.stream_session_logs``，非本变更
    allowed_path，故只在外层包一层。``error_detail`` 的 DB 查询用短 session（不贯穿
    SSE 生命周期，对齐 stream_session_logs 的连接池安全约束）；``turn_completed`` 由
    ``close_interactive_run`` 在 DB commit 之后才 publish，故此处查到的 error_detail
    必然已落库（run_sync/service.py commit :968 早于 session publish :1038）。

    事件名用默认 data 帧 + ``event=run_error``（与 turn_completed / log 同通道，前端
    onmessage dispatch），不复用既有 ``event: error`` 命名事件（那是 Redis 连接失败等
    传输层错误，避免语义混淆）。
    """
    from app.modules.agent.model import AgentRun

    async for frame in inner:
        yield frame
        # 仅 data 帧承载可内省的 JSON 载荷（connected / keepalive 注释、done / error
        # 命名事件均无 "data: " 前缀，直接跳过，零干扰既有事件流）。
        if not frame.startswith("data: ") or not frame.endswith("\n\n"):
            continue
        try:
            payload = json.loads(frame[len("data: ") : -2])
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("event") != "turn_completed" or payload.get("status") != "failed":
            continue
        run_id_raw = payload.get("run_id")
        if not run_id_raw:
            continue
        try:
            run_id = uuid.UUID(str(run_id_raw))
        except (ValueError, AttributeError):
            continue
        # 短 session 查 error_detail（不占连接池 slot 贯穿 SSE 生命周期）。
        async with get_session_factory()() as db:
            run = await db.get(AgentRun, run_id)
        # 无 error_detail（成功 run 不到此分支；历史 failed run 无 ModelError）→ 不追加。
        if run is None or not run.error_detail:
            continue
        error_event = {
            "event": "run_error",
            "session_id": str(session_id),
            "run_id": str(run_id),
            "error": run.error_detail,
        }
        yield f"data: {json.dumps(error_event, default=str)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
) -> StreamingResponse:
    """Stream session-level SSE aggregating every AgentRun of the session.

    Single connection survives across multiple turns (run_id changes); events
    carry ``run_id`` so the frontend can delineate turn boundaries (FR-03 /
    D-005@v1 / R-08). Closes only on ``session_ended``.

    Ownership is verified here (``AgentSession.user_id == user.id``) so neither
    a missing nor a cross-user session reaches the Redis subscription (no
    existence leak). A terminal-status session still enters the generator,
    which emits ``event: done`` internally.

    连接池安全：不注入请求级 session（会贯穿整个 StreamingResponse 生命周期、
    长时间占用一个连接池 slot）。归属校验改用短 session——鉴权链（get_current_user）
    查库后即 rollback 归还连接（2026-08-25 auth_deps 修复），校验后立即归还；
    StreamingResponse 生成器内部用 get_session_factory() 自建独立短 session
    做逐次查询（见 AgentService.stream_session_logs）。
    """
    # Local imports keep top-level load cost minimal and avoid an import cycle
    # (agent.service imports nothing from daemon, but be defensive).
    from app.modules.agent.model import AgentSession
    from app.modules.agent.service import AgentService

    # 归属校验：短 session，校验完即归还连接池 slot（不贯穿 SSE 生命周期）
    gen = None
    async with get_session_factory()() as session:
        owned = (
            await session.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            # 2026-09-01-session-group-chat task-02 / design §5.3：群会话 SSE
            # （kind='group'）走参与者判定（成员表命中 → workspace admin），
            # 影子会话（kind='group_member'）仅属主/admin（内部链路）。chat
            # 首查未命中时本探测返回 None → 维持原 404（零改动）。
            from app.modules.daemon.group.service import get_group_accessible_session

            owned = await get_group_accessible_session(
                session,
                session_id=session_id,
                user_id=user.id,
            )
        if owned is not None:
            # 构造生成器对象（惰性求值，此处不执行其 body）；session 随
            # async with 结束立即归还，stream_session_logs 内部自建短 session。
            # task-07：外层包一层 _inject_run_error_events，在 failed turn 后追加
            # run_error 帧（透传 ModelError）；既有事件流不变。
            # 2026-09-01-session-group-chat task-06（design §5.4）：群会话 SSE
            # 生成器多路订阅——实时频道（typing/presence 帧合流）+ presence key
            # （连接级，touch 续期）+ presence 生命周期回调（上线即发事件、断连
            # 删 key + 全退出发下线——群在线实时化 quick 2026-09-04）。chat /
            # 影子（group_member）不传可选参数 → 单订阅原路径零改动。
            stream_kwargs: dict[str, object] = {}
            if owned.session_kind == "group":
                from app.modules.daemon.group.service import (
                    group_presence_key,
                    group_typing_channel,
                    publish_member_presence,
                    release_member_presence,
                )

                group_id = owned.id
                stream_kwargs["typing_channel"] = group_typing_channel(group_id)
                # 连接级 presence key：同用户多标签页/多端各自 touch 互不干扰；
                # 断连 release 删本连接 key，SCAN 剩余连接全退出才发 offline。
                presence_conn_key = group_presence_key(group_id, user.id, uuid.uuid4().hex)

                async def _on_presence_change(online: bool) -> None:
                    if online:
                        await publish_member_presence(group_id, user.id, online=True)
                    else:
                        await release_member_presence(group_id, user.id, presence_conn_key)

                stream_kwargs["presence_key"] = presence_conn_key
                stream_kwargs["presence_on_change"] = _on_presence_change
            gen = _inject_run_error_events(
                session_id,
                AgentService(session).stream_session_logs(session_id, **stream_kwargs),
            )
    if owned is None:
        raise DaemonSessionNotFound(
            "指定的会话不存在或无权访问。",
            details={"session_id": str(session_id)},
        )

    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers=_SESSION_SSE_HEADERS,
    )


# ql-20260826-012：list_session_runs 固定取最新 N 条（原无界全量，长会话每 turn
# 一条 run 无限增长）；200 覆盖会话面板可视历史。常量 ``_SESSION_RUNS_MAX``
# 存于包 ``__init__``（test_session_runs_endpoint setattr 目标，D-007），
# 本模块经 ``_router._SESSION_RUNS_MAX`` 延迟读取。


@router.get(
    "/sessions/{session_id}/runs",
    response_model=list[SessionRunRead],
)
async def list_session_runs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[SessionRunRead]:
    """List the AgentRuns of an owned session, each carrying error_detail (task-07 / FR-02).

    design §7.4：响应 run 项含 ``error_detail``（模型层 ModelError；成功 / 无错误
    run 为 None），供前端拉历史与当前 run 错误。归属 / 存在性复用
    ``get_agent_session``（missing / 跨用户 / 软删均 404，不泄露存在性），与其它
    session 读端点同一道闸门。查询内联在此（service.py 非本任务 allowed_path），
    与 get_session_detail 的 run 查询同款。
    """
    from app.modules.agent.model import AgentRun
    from app.modules.auth.model import User as AuthUser

    svc = DaemonService(session)
    # 归属 / 存在性校验（404 on missing / cross-user / soft-deleted）。
    await svc.get_agent_session(session_id, user.id)
    rows = (
        await session.execute(
            select(AgentRun, AuthUser.display_name)
            .join(AuthUser, AuthUser.id == AgentRun.user_id, isouter=True)
            .where(AgentRun.agent_session_id == session_id)
            # ql-20260826-012：长生命周期交互会话每 turn 一条 run 无限增长，
            # 原全量加载——固定取最新 _SESSION_RUNS_MAX 条（已按 started_at
            # desc，前端 error_detail 按最近 turn 映射，旧 turn 裁剪无损）。
            .order_by(AgentRun.started_at.desc())
            .limit(_router._SESSION_RUNS_MAX)
        )
    ).all()
    return [
        SessionRunRead.model_validate(run).model_copy(update={"sender_name": display_name})
        for run, display_name in rows
    ]


# 2026-09-04-session-task-execution-panel task-02（FR-06）：任务清单快照上限。
# upsert 单行/任务（task-03），200 与 _SESSION_RUNS_MAX 同口径覆盖面板可视历史。
_SESSION_TASKS_MAX = 200


@router.get(
    "/sessions/{session_id}/tasks",
    response_model=list[AgentSessionTaskRead],
)
async def list_session_tasks(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[AgentSessionTaskRead]:
    """List the persisted agent task snapshot of an owned session (task-02 / FR-06).

    任务清单页签的服务端快照：agent_task_status 事件落库行（AgentSessionTask，
    task-03 upsert 写入）按 updated_at desc 取最近 _SESSION_TASKS_MAX 条，供前端
    刷新/重连后恢复（useSessionTasks 拉取 + SSE 实时合并）。归属 / 存在性复用
    ``get_agent_session``（missing / 跨用户 / 软删均 404，不泄露存在性），与
    runs 端点同一道闸门；查询内联在此（service.py 非本任务 allowed_path），
    与 list_session_runs 同款口径。未上报任务的会话返回 []（D-003 空态，不报错）。
    """
    svc = DaemonService(session)
    # 归属 / 存在性校验（404 on missing / cross-user / soft-deleted）。
    await svc.get_agent_session(session_id, user.id)
    rows = (
        (
            await session.execute(
                select(AgentSessionTask)
                .where(AgentSessionTask.session_id == session_id)
                .order_by(AgentSessionTask.updated_at.desc())
                .limit(_SESSION_TASKS_MAX)
            )
        )
        .scalars()
        .all()
    )
    return [AgentSessionTaskRead.model_validate(row) for row in rows]


@router.get(
    "/sessions/{session_id}/logs",
    response_model=list,  # response items are AgentRunLogEntry
)
async def get_session_logs(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: TaskRunAgentUser,
    after: datetime | None = Query(
        None,
        description=(
            "增量游标（ISO timestamp，2026-08-24 会话审查 P4）：只返回 timestamp "
            "严格更新的日志；不传返回全量。同批日志共用同一 timestamp，调用方应"
            "回退 1-2s 重叠窗口并按 log_id 去重"
        ),
    ),
    before: datetime | None = Query(
        None,
        description=(
            "向上加载游标（ISO timestamp，群聊体验 quick）：只返回 timestamp "
            "严格更早的日志；与 limit 组合取「游标之前的最新 N 条」升序返回"
        ),
    ),
    q: str | None = Query(
        None,
        max_length=200,
        description="内容搜索（群聊体验 quick）：content ILIKE %q% 过滤，可与 after/before 组合",
    ),
    limit: int | None = Query(
        None,
        ge=1,
        le=1000,
        description=(
            "最新 N 条语义（群聊体验 quick）：按 timestamp desc 取 N 再反转升序"
            "返回；无 before=全量最新 N，有 before=游标之前最新 N。缺省=全量"
            "（服务层上限 5000，维持既有行为）"
        ),
    ),
) -> Response:
    """Return all logs of a session, aggregated across AgentRuns (D-005@v1).

    Read-only. Ownership / existence follow the same resource-hiding 404 as
    the other session endpoints (no existence leak for missing / cross-user).
    Response items reuse the existing ``AgentRunLogEntry`` DTO; ``run_id`` is
    preserved so the frontend can delineate turn boundaries.

    ql-20260827-018：客户端 Accept-Encoding 含 gzip 且正文超过阈值时返回 gzip
    编码响应（长会话 5000 行 × 50KB 文本列明文传输是回显慢主因，JSON 文本
    压缩比 ~10x）。浏览器 fetch / Next rewrite 代理均透传 accept-encoding 与
    Content-Encoding，无需调用方改动。

    群聊体验 quick（2026-09-02）：``before``/``q``/``limit`` 分页与搜索参数
    （语义见各 Query description）；缺省时调用形态与原端点逐字节等价
    （after 兼容零回归）。群/影子会话参与者经服务层同一道闸门（影子只读
    放行普通群成员读 logs，见 get_group_accessible_session）。
    """
    svc = DaemonService(session)
    logs = await svc.get_agent_session_logs(
        session_id,
        user.id,
        after=after,
        before=before,
        q=(q.strip() or None) if q else None,
        limit=limit,
    )
    payload = [AgentRunLogEntry.model_validate(log) for log in logs]
    raw = json.dumps([item.model_dump(mode="json") for item in payload], ensure_ascii=False).encode(
        "utf-8"
    )
    # 小响应不值得压缩编码开销（阈值对齐常见 CDN 默认 1KB）。
    if len(raw) > 1024 and "gzip" in request.headers.get("accept-encoding", "").lower():
        return Response(
            content=gzip.compress(raw, compresslevel=6),
            media_type="application/json",
            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return Response(content=raw, media_type="application/json")


@router.get(
    "/sessions/{session_id}/usage",
    response_model=SessionUsageRead,
)
async def get_session_usage(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionUsageRead:
    """返回本会话累计用量聚合（2026-08-29-session-usage-stats task-02 / FR-01 / FR-04 / D-004@v1）。

    会话内五指标（输入 / 输出 / 缓存读取 / 缓存写入 / 请求次数）汇总 + 按模型
    折叠明细，供前端会话详情页与 dialog 浮窗同构展示（D-001/D-002）。聚合语义
    完全在 :meth:`SessionService.get_session_usage`（task-01）：明细表
    ``agent_run_model_usage`` GROUP BY model 为主源 + 无明细行 run 的四维 token
    列兜底（``ctx_tokens`` 快照列排除），本端点只做委托，不重复聚合逻辑。

    权限闸门对齐同 router 会话读端点（2026-08-30 审计⑥）：``TaskRunAgentUser``
    （``require_permission_any(Permission.TASK_RUN_AGENT)``）——与 runs / logs /
    detail 同一道闸门；owner-only 404 resource-hiding：归属校验在 service 内
    DB 侧过滤（含软删 ``deleted_at`` 视为不存在），缺失 / 跨用户 / 已软删会话
    同抛 ``DaemonSessionNotFound``（不泄露存在性）。只读端点，无状态机交互。
    """
    return await SessionService(session).get_session_usage(session_id, user.id)
