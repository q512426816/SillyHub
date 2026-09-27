"""session 观测端点：日志流 / runs / tasks / logs / 用量（task-07 拆分）。

原 session_extras 非队列域 5 端点：``/stream`` SSE 聚合（含 run_error 帧
包装）、``/runs``、``/tasks``、``/logs``、``/usage``；``SessionRunRead`` /
``_inject_run_error_events`` / ``_SESSION_TASKS_MAX`` 随域同迁。

patch 兼容（D-007）：``_SESSION_RUNS_MAX`` 常量在包 ``__init__``（测试 setattr
目标），本模块经 ``_router`` 延迟读取。
"""

from __future__ import annotations

import asyncio
import gzip
import json
import uuid
from collections import OrderedDict
from collections.abc import AsyncGenerator
from datetime import datetime

from fastapi import HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.router as _router
from app.core.db import get_session_factory
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.router.session_crud import _SESSION_SSE_HEADERS
from app.modules.daemon.schema import (
    AgentSessionTaskRead,
    SessionTurnOutlineRead,
    SessionUsageRead,
    TurnOutlineItemRead,
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
      - ``cache_read_tokens`` / ``cache_creation_tokens``（quick ql-20260912-003-4506）
        ：daemon 关单同批写入的 prompt cache 两维，供前端轮次历史行独立展示
        四维用量；无缓存引擎（codex / pi）/ 老 run 行为 None；
      - ``ctx_tokens``（2026-08-27-session-token-usage-fix task-05 / FR-01）：该
        run 期间最近一次 API 调用的提示词大小（daemon 经 usage 管线实时写入，
        close 终态不覆盖），供前端上下文环历史回填取最新非 null 值；历史行 /
        老 daemon 无上报为 None（环未知态，design §9）。
    全部 nullable——老 run 行 / 未配置轮为 None，前端如实显示未指定/不累计。
    """

    id: uuid.UUID
    # quick（ql-20260910-011-3d92）：轮次定序锚点——run 创建时刻恒非空（列默认
    # now()）。派发失败轮（daemon 离线 inject 发送失败，control.py 收敛 failed）
    # started_at 永远为 NULL，前端刻度排序以其兜底，修复失败轮被甩到队尾的轮号错位。
    created_at: datetime
    # 2026-09-10-auto-resume-interrupted-turn（plan 审查 P0-1）：续跑轮标记——
    # 自动续跑派发落地的 run 为 {"auto_resume_of": "<源 run id>"}（前端「自动
    # 续跑」徽标数据源）；普通轮 / 存量行为 None。显式字段 DTO 不自动携带
    # model 新列，必须在此显式声明（validation_alias 直映 ORM 属性 metadata_，
    # 本文件 :84 同款先例）。
    metadata: dict | None = Field(default=None, validation_alias="metadata_")
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
    # quick（ql-20260912-003-4506）：缓存两维直映 AgentRun 既有列（from_attributes
    # 零查询改动），与 input/output 同批由 close_interactive_run / 实时 usage_update
    # 写入；无缓存引擎与历史行 None，前端按维独立渲染不编造。
    cache_read_tokens: int | None = None
    cache_creation_tokens: int | None = None
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
    # task-08 / D-014③（2026-09-22-session-fork-continuation）：轮引擎锚点
    # （AgentRun.engine_anchor，task-01 新列 / task-04 回填），from_attributes
    # 直映零查询改动。前端轮级「从此分叉」入口（TurnForkEntry）native 档门控
    # 数据源——锚缺失（存量轮 / 未回填链）该轮入口置灰；历史行 None 如实输出。
    engine_anchor: str | None = None
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
    request: Request,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> Response:
    """List the AgentRuns of an owned session, each carrying error_detail (task-07 / FR-02).

    design §7.4：响应 run 项含 ``error_detail``（模型层 ModelError；成功 / 无错误
    run 为 None），供前端拉历史与当前 run 错误。归属 / 存在性复用
    ``get_agent_session``（missing / 跨用户 / 软删均 404，不泄露存在性），与其它
    session 读端点同一道闸门。查询内联在此（service.py 非本任务 allowed_path），
    与 get_session_detail 的 run 查询同款。

    2026-09-27-session-fast-replay task-02 / FR-03：runs 瘦身 + gzip——

    - ``agent_profile_snapshot`` 剥离 ``system_prompt`` 键（浅拷贝 dict.pop，
      不动库数据）：前端实证仅消费 name/provider/model 等轻键，system_prompt
      原文（可达数 KB/轮 × 500 轮）是 runs payload 膨胀主因；其余字段语义
      零变化（design 接口契约④「结构不变仅去键」）。
    - 响应走 gzip（抄本文件 /logs 的 gzip 路径：Accept-Encoding 协商 + 1KB
      阈值 + 线程池压缩，长会话 500 轮 × JSON 文本压缩比 ~10x）。返回
      ``Response`` 直写（response_model 仅保留 openapi 文档面，FastAPI 对
      Response 返回值跳过再序列化，行为与 /logs 一致）。
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
            # 原全量加载——固定取最新 _SESSION_RUNS_MAX 条，旧 turn 裁剪无损。
            # quick（ql-20260910-011-3d92）：排序键 started_at → created_at——
            # 派发失败轮 started_at 为 NULL，PostgreSQL DESC 默认 NULLS FIRST 会
            # 把它排响应首位（且最新 N 截断语义失真）；轮次序的真实语义是用户
            # 发话序（= run 创建序），对齐 agent 模块按 created_at 排 run 的仓库
            # 惯例（finalizer / mcp_tools / patrol 等）。
            .order_by(AgentRun.created_at.desc())
            .limit(_router._SESSION_RUNS_MAX)
        )
    ).all()
    payload: list[SessionRunRead] = []
    for run, display_name in rows:
        # FR-03：snapshot 剥 system_prompt（浅拷贝去键，不改 ORM 实体——库数据
        # 原文照旧，审计 / 导出 / 续跑 get_execution_context 不受影响）。
        snapshot = dict(run.agent_profile_snapshot) if run.agent_profile_snapshot else None
        if snapshot is not None:
            snapshot.pop("system_prompt", None)
        payload.append(
            SessionRunRead.model_validate(run).model_copy(
                update={"sender_name": display_name, "agent_profile_snapshot": snapshot}
            )
        )
    # gzip 路径与 /logs 同款（ql-20260827-018）：json.dumps / gzip.compress 纯 CPU
    # 同步调用丢线程池，防大 payload 卡事件循环；阈值 1KB 对齐常见 CDN 默认。
    raw = await asyncio.to_thread(
        lambda: json.dumps(
            [item.model_dump(mode="json") for item in payload], ensure_ascii=False
        ).encode("utf-8")
    )
    if len(raw) > 1024 and "gzip" in request.headers.get("accept-encoding", "").lower():
        return Response(
            content=await asyncio.to_thread(gzip.compress, raw, 6),
            media_type="application/json",
            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return Response(content=raw, media_type="application/json")


# ── 2026-09-27-session-fast-replay task-01 / FR-01：turn-outline 轮次大纲 ──────
# 打开会话「秒开」的服务端投影：一次下发该会话全部轮次摘要（轻列 + 首条
# user_input / 首条非空 stdout 截断文本），替代前端逐页翻日志反演目录。
#
# 进程内 LRU 缓存（design 做法概述①，hermes coldLogMemo 同款思路）：
# functools.lru_cache 不适用——被缓存的是 async DB 派生值（依赖请求级查询），
# 须在端点内先查指纹再手工比对。读写都发生在事件循环单线程内（检查与更新
# 之间无 await），无锁即安全；并发写与读竞态按设计边界②接受「最多一次过期
# 大纲」（乐观失效：新日志落库后指纹变化，下一次请求即纠正）。进程重启后
# 缓存自然重建（首读重算，正确性不受影响）。

# 键=session_id，值={"fingerprint": tuple, "outline": SessionTurnOutlineRead}。
_TURN_OUTLINE_CACHE: OrderedDict[uuid.UUID, dict] = OrderedDict()
# 缓存容量（会话数）：覆盖常驻打开的会话面板，防无界增长。
_TURN_OUTLINE_CACHE_MAX = 128
# 摘要截断口径（按字符，FR-01）：prompt 前 60 字 / answer 前 120 字。
_TURN_OUTLINE_PROMPT_CHARS = 60
_TURN_OUTLINE_ANSWER_CHARS = 120


async def _session_outline_fingerprint(
    db: AsyncSession, session_id: uuid.UUID
) -> tuple[object, ...]:
    """计算大纲缓存指纹（design：runs 计数 + max(run.created_at) +
    max(log.timestamp) + max(log.id)）。

    四维轻量聚合（count/max 均命中 ix_agent_runs_agent_session_id /
    ix_agent_run_logs_run_timestamp 索引，不扫大列）；值统一 str 化入元组——
    既避免跨方言（PG uuid / SQLite char）的 max 返回类型漂移，也让 None 与
    空串等边界可直接元组比较。新日志落库 → max(timestamp) 变（新行时间戳
    恒新于存量）；同批同刻追加 → max(id) 兜底；新轮 → count/created_at 变。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog

    session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    runs_row = (
        await db.execute(
            select(func.count(AgentRun.id), func.max(AgentRun.created_at)).where(
                AgentRun.agent_session_id == session_id
            )
        )
    ).one()
    logs_row = (
        await db.execute(
            # 生产实证（2026-09-28 阿里云 PG）：max(uuid) 在 PostgreSQL 无原生聚合
            # （SQLite 有——单测方言盲区）；id 统一 cast 文本再取 max，双方言一致。
            select(
                func.max(AgentRunLog.timestamp),
                func.max(cast(AgentRunLog.id, String)),
            ).where(AgentRunLog.run_id.in_(session_run_ids))
        )
    ).one()
    return (
        int(runs_row[0] or 0),
        str(runs_row[1]) if runs_row[1] is not None else None,
        str(logs_row[0]) if logs_row[0] is not None else None,
        str(logs_row[1]) if logs_row[1] is not None else None,
    )


async def _compute_session_turn_outline(
    db: AsyncSession, session_id: uuid.UUID
) -> SessionTurnOutlineRead:
    """全量计算会话轮次大纲（缓存未命中时的重算路径）。

    两段查询：

    1. runs 轻列——只取导航消费的列（**不** select 整实体，agent_profile_snapshot
       / error_detail 等 JSON 大列不进 payload），left join users 取 sender_name，
       created_at 升序（= 用户发话序，与 runs 端点排序口径同源）配 1 起 seq；
    2. 摘要——窗口函数 ``row_number() OVER (PARTITION BY run_id, channel ORDER BY
       timestamp, id)`` 抽每 run 首条。通道取值按落库真实枚举（grep 写入处实证，
       sdk_pipeline._channel_from_event_type：user_input / stdout / tool_call /
       stderr，**无 "reply" 通道**——assistant 文本即 stdout）：user_input 分区
       取首条（prompt_summary 前 60 字）；stdout 分区先过滤空内容再开窗，rn=1
       即首条非空 assistant 文本（answer_summary 前 120 字）。截断按字符。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog
    from app.modules.auth.model import User as AuthUser

    run_rows = (
        await db.execute(
            select(  # type: ignore[misc]  # 11 列 select 联合超 mypy union 穷举上限（SQLAlchemy 列式误报面）
                AgentRun.id,
                AgentRun.created_at,
                AgentRun.started_at,
                AgentRun.finished_at,
                AgentRun.status,
                AgentRun.error_code,
                AgentRun.engine_anchor,
                AgentRun.metadata_,
                AgentRun.input_tokens,
                AgentRun.output_tokens,
                AuthUser.display_name,
            )
            .join(AuthUser, AuthUser.id == AgentRun.user_id, isouter=True)
            .where(AgentRun.agent_session_id == session_id)
            .order_by(AgentRun.created_at.asc(), AgentRun.id.asc())
        )
    ).all()

    session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    rn = (
        func.row_number()
        .over(
            partition_by=[
                AgentRunLog.run_id,  # type: ignore[list-item]  # SA InstrumentedAttribute 列式被窄化成 UUID（sqlmodel stub 误报）
                AgentRunLog.channel,
            ],
            order_by=[AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()],
        )
        .label("rn")
    )
    first_lines_subq = (
        select(
            AgentRunLog.run_id.label("run_id"),
            AgentRunLog.channel.label("channel"),
            AgentRunLog.content_redacted.label("content"),
            rn,
        )
        .where(
            AgentRunLog.run_id.in_(session_run_ids),
            AgentRunLog.channel.in_(["user_input", "stdout"]),
            # 「首条 reply 且 content 非空」：stdout 分区先剔空行再开窗（rn=1 即
            # 首条非空）；user_input 分区不过滤（首条即摘要，空行由下方 Python
            # 侧置 None 兜底）。trim 兼容 PG / SQLite 双方言。
            or_(
                AgentRunLog.channel == "user_input",
                func.trim(func.coalesce(AgentRunLog.content_redacted, "")) != "",
            ),
        )
        .subquery()
    )
    summary_rows = (
        await db.execute(
            select(
                first_lines_subq.c.run_id,
                first_lines_subq.c.channel,
                first_lines_subq.c.content,
            ).where(first_lines_subq.c.rn == 1)
        )
    ).all()
    prompt_by_run: dict[uuid.UUID, str] = {}
    answer_by_run: dict[uuid.UUID, str] = {}
    for run_id_val, channel_val, content_val in summary_rows:
        if not isinstance(content_val, str) or not content_val.strip():
            continue
        if channel_val == "user_input":
            prompt_by_run.setdefault(run_id_val, content_val)
        else:
            answer_by_run.setdefault(run_id_val, content_val)

    items: list[TurnOutlineItemRead] = []
    for seq, row in enumerate(run_rows, start=1):
        metadata_dict = row.metadata_ if isinstance(row.metadata_, dict) else None
        auto_resume_of = metadata_dict.get("auto_resume_of") if metadata_dict else None
        prompt = prompt_by_run.get(row.id)
        answer = answer_by_run.get(row.id)
        items.append(
            TurnOutlineItemRead(
                run_id=row.id,
                seq=seq,
                created_at=row.created_at,
                started_at=row.started_at,
                finished_at=row.finished_at,
                status=row.status,
                error_code=row.error_code,
                sender_name=row.display_name,
                engine_anchor=row.engine_anchor,
                auto_resume_of=str(auto_resume_of) if auto_resume_of is not None else None,
                input_tokens=row.input_tokens,
                output_tokens=row.output_tokens,
                prompt_summary=prompt[:_TURN_OUTLINE_PROMPT_CHARS] if prompt else None,
                answer_summary=answer[:_TURN_OUTLINE_ANSWER_CHARS] if answer else None,
            )
        )
    return SessionTurnOutlineRead(
        session_id=session_id,
        total_turns=len(items),
        items=items,
    )


@router.get(
    "/sessions/{session_id}/turn-outline",
    response_model=SessionTurnOutlineRead,
)
async def get_session_turn_outline(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionTurnOutlineRead:
    """Return the full turn outline of an owned session (task-01 / FR-01).

    一次响应返回该会话**全部**轮次摘要（无 500 条截断，runs 端点的截断由本
    端点接管全量导航职责）：每轮含 run_id / seq（created_at 升序 1 起）/
    status / 起止时间 / error_code / sender_name / engine_anchor /
    auto_resume_of / tokens 轻列，以及 prompt_summary（首条 user_input 前 60 字）
    与 answer_summary（首条非空 stdout 前 120 字）。归属 / 存在性复用
    ``get_agent_session``（missing / 跨用户 / 软删均 404，不泄露存在性），与
    runs / logs 端点同一道闸门；查询内联在此（service.py 非本任务
    allowed_path，对齐 list_session_runs 先例）。空会话返回 total_turns=0 +
    空 items（不报错）。

    缓存：进程内 LRU（键=session_id，容量 128），指纹 =（runs 总数, max(run.
    created_at), max(log.timestamp), max(log.id)）——命中零重算直接回缓存值；
    每请求仍先过归属闸门（缓存的是会话数据投影，不是授权结论）。
    """
    svc = DaemonService(session)
    # 归属 / 存在性校验（404 on missing / cross-user / soft-deleted）。
    await svc.get_agent_session(session_id, user.id)

    fingerprint = await _session_outline_fingerprint(session, session_id)
    cached = _TURN_OUTLINE_CACHE.get(session_id)
    if cached is not None and cached["fingerprint"] == fingerprint:
        # 命中：LRU 提权后直接回缓存值（零重算）。
        _TURN_OUTLINE_CACHE.move_to_end(session_id)
        return cached["outline"]

    outline = await _compute_session_turn_outline(session, session_id)
    _TURN_OUTLINE_CACHE[session_id] = {"fingerprint": fingerprint, "outline": outline}
    _TURN_OUTLINE_CACHE.move_to_end(session_id)
    while len(_TURN_OUTLINE_CACHE) > _TURN_OUTLINE_CACHE_MAX:
        _TURN_OUTLINE_CACHE.popitem(last=False)
    return outline


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


# ── 2026-09-27-session-fast-replay task-02 / FR-02：run_id 单轮直达 + slim 截断 ──
# run_id 直达的单轮日志上限：单轮日志体量受一turn 工具调用数约束，2000 行
# 覆盖极端轮（超出部分裁剪最新行为不丢已见窗口，前端大纲已提供轮级导航）。
_SESSION_RUN_LOGS_MAX = 2000
# slim 模式的 tool 通道与截断长度：按落库真实 channel 枚举，tool 类 =
# tool_call（sdk_pipeline._channel_from_event_type：tool_use/tool_result →
# tool_call；user_input / stdout / stderr 为非 tool 通道）。
_SLIM_TOOL_CHANNEL = "tool_call"
_SLIM_TOOL_CONTENT_MAX_CHARS = 2000


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
    before_id: uuid.UUID | None = Query(
        None,
        description=(
            "与 before 组合的复合游标 id tiebreaker（2026-09-16-logs-cursor-"
            "tiebreaker）：同 timestamp 批次逐页可达；仅与 before 同时传，"
            "单独传 before_id 而无 before 将 422"
        ),
    ),
    run_id: uuid.UUID | None = Query(
        None,
        description=(
            "单轮直达（2026-09-27-session-fast-replay）：只返回该 run 的日志"
            "（timestamp,id 升序，上限 2000 条）；run 不存在或不属于该会话 404；"
            "与 before/after 游标互斥（同传 422）"
        ),
    ),
    q: str | None = Query(
        None,
        max_length=200,
        description="内容搜索（群聊体验 quick）：content ILIKE %q% 过滤，可与 after/before/run_id 组合",
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
    slim: bool = Query(
        False,
        description=(
            "精简模式（2026-09-27-session-fast-replay）：tool 通道（tool_call）"
            "content_redacted 超 2000 字符截断到 2000 并置 content_truncated=true；"
            "需全文走 GET /sessions/{id}/logs/{log_id}。缺省 false 行为零变化"
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

    2026-09-16-logs-cursor-tiebreaker / D-001@v1：``before_id``——与
    ``before`` 组合的复合游标 id tiebreaker（``(ts < before) OR (ts ==
    before AND id < before_id)``），同 timestamp 批次向上翻页在批内逐页
    可达且边界零重叠；缺省时行为与原 ``<=`` 游标逐字节等价（旧客户端零
    回归）。``before_id`` 仅作为 ``before`` 的 tiebreaker 存在，无锚点
    timestamp 无消费语义——单独传（无 ``before``）422 fail-explicit，
    不静默忽略（参数组合 422 写法对齐 session_team.py:420-436 /
    machines.py:488-494 先例）。

    2026-09-27-session-fast-replay task-02 / FR-02：``run_id`` 单轮直达 +
    ``slim`` 精简模式——

    - ``run_id``：命中校验（run 存在且 ``agent_session_id`` 匹配，否则 404
      资源隐藏），只返回该 run 全部日志（timestamp,id 升序，上限 2000 条），
      供前端「未加载轮直达跳转」单次往返取整轮（替代 40ms interval 逐页
      循环）；与 ``before``/``after`` 游标互斥（同传 422 fail-explicit），
      可与 ``q``/``limit`` 组合（在单轮内收窄）；
    - ``slim``：tool 通道（channel=tool_call）content_redacted 超 2000 字符
      截断到 2000 并置 ``content_truncated=true``（AgentRunLogEntry 新可选
      字段，旧路径不置恒 None，旧调用方零变化）；截断条目需全文走新增单条
      端点 GET /sessions/{session_id}/logs/{log_id}。落库原文不动（slim 是
      传输层语义，审计 / 导出全文照旧）。
    """
    # 单独传 before_id（无 before）→ 422：fail-explicit 优于静默忽略
    # （新参数无既有单独消费方；写法对齐 session_team.py:435 / machines.py:493）。
    if before_id is not None and before is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="before_id 是与 before 组合的复合游标 id tiebreaker，不支持单独传 before_id，请同时传 before（ISO timestamp）。",
        )
    # run_id 与 before/after 游标互斥 → 422：单轮直达语义（整轮升序）与增量
    # /向上翻页游标（跨轮窗口）组合无一致语义，fail-explicit 不静默忽略。
    if run_id is not None and (before is not None or after is not None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="run_id 单轮直达与 before/after 游标互斥，不支持同时传，请二选一。",
        )

    if run_id is not None:
        # 单轮直达：归属闸门（get_agent_session，与 runs 同款 404）+ run 命中
        # 校验后内联查询（service 层无 run_id 形参，对齐 list_session_runs
        # 内联先例）。查询走 ix_agent_run_logs_run_timestamp 复合索引。
        from app.modules.agent.model import AgentRun, AgentRunLog

        svc = DaemonService(session)
        await svc.get_agent_session(session_id, user.id)
        run = (
            await session.execute(
                select(AgentRun.id).where(
                    AgentRun.id == run_id,
                    AgentRun.agent_session_id == session_id,
                )
            )
        ).scalar_one_or_none()
        if run is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定的轮次不存在或不属于该会话。",
            )
        stmt = (
            select(AgentRunLog)
            .where(AgentRunLog.run_id == run_id)
            .order_by(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc())
            .limit(_SESSION_RUN_LOGS_MAX)
        )
        if q and q.strip():
            stmt = stmt.where(AgentRunLog.content_redacted.ilike(f"%{q.strip()}%"))
        logs = list((await session.execute(stmt)).scalars().all())
    else:
        svc = DaemonService(session)
        logs = await svc.get_agent_session_logs(
            session_id,
            user.id,
            after=after,
            before=before,
            before_id=before_id,
            q=(q.strip() or None) if q else None,
            limit=limit,
        )
    payload = [AgentRunLogEntry.model_validate(log) for log in logs]
    # slim 截断：只动 tool 通道超长行（DTO 是 model_validate 产出的独立实例，
    # 直接赋值不影响 ORM / 库数据）；其余通道与非超长行零触碰。
    if slim:
        for item in payload:
            if (
                item.channel == _SLIM_TOOL_CHANNEL
                and item.content_redacted is not None
                and len(item.content_redacted) > _SLIM_TOOL_CONTENT_MAX_CHARS
            ):
                item.content_redacted = item.content_redacted[:_SLIM_TOOL_CONTENT_MAX_CHARS]
                item.content_truncated = True
    # ql-20260909-012：json.dumps + gzip.compress 均为纯 CPU 同步调用——长会话
    # 5000 行 × 大文本列 payload 可达几十 MB（gzip-6 压缩 10MB 约 100-300ms），
    # 直接跑会把整个事件循环卡住，丢线程池解放并发请求。
    raw = await asyncio.to_thread(
        lambda: json.dumps(
            [item.model_dump(mode="json") for item in payload], ensure_ascii=False
        ).encode("utf-8")
    )
    # 小响应不值得压缩编码开销（阈值对齐常见 CDN 默认 1KB）。
    if len(raw) > 1024 and "gzip" in request.headers.get("accept-encoding", "").lower():
        return Response(
            content=await asyncio.to_thread(gzip.compress, raw, 6),
            media_type="application/json",
            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return Response(content=raw, media_type="application/json")


@router.get(
    "/sessions/{session_id}/logs/{log_id}",
    response_model=AgentRunLogEntry,
)
async def get_session_log_entry(
    session_id: uuid.UUID,
    log_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> AgentRunLogEntry:
    """Return one full log entry of an owned session (task-02 / FR-02 / FR-07).

    slim 模式的按需全文消费端点：截断条目（content_truncated=true）展开时单条
    拉取渲染，非截断条目零额外请求。归属闸门与 runs / logs 同款
    （``get_agent_session``，missing / 跨用户 / 软删均 404 不泄露存在性）；
    行级命中校验经 log → run → session 链（``AgentRun.agent_session_id`` 匹配，
    防跨会话读），日志不存在或不属于该会话同样 404。只读端点，无状态交互。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog

    svc = DaemonService(session)
    # 归属 / 存在性校验（404 on missing / cross-user / soft-deleted）。
    await svc.get_agent_session(session_id, user.id)
    log = (
        await session.execute(
            select(AgentRunLog)
            .join(AgentRun, AgentRun.id == AgentRunLog.run_id)
            .where(
                AgentRunLog.id == log_id,
                AgentRun.agent_session_id == session_id,
            )
        )
    ).scalar_one_or_none()
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="指定的日志不存在或不属于该会话。",
        )
    return AgentRunLogEntry.model_validate(log)


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
