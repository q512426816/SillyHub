"""submit_messages / session 事件 Redis 发布层（task-10 拆分）。

PublishIntent / SubmittedMessages（QueuePool 修复 3：publish 移出 DB session
生命周期，router 在连接归还后调 publish_submitted_messages）+ session 频道
通用事件（publish_session_event / 节流 bash_chunk）+ _publish_run_event 类
方法体下沉。D-007：get_redis 为本命名空间 patch 目标（43 处 patch 的大头），
一律 ``_rsvc.get_redis()`` 延迟解析；log 经 ``_rsvc.log`` 保持原模块 logger
身份。
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from uuid import UUID

from pydantic import BaseModel

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.daemon.schema import BashChunkEvent

# ── QueuePool 修复 3：submit_messages 的发布意图 + 延迟 publish ────────────────
# Redis publish 从 RunSyncService.submit_messages 迁出到 router（DB session 已
# commit、连接归还后再发），避免 Redis 卡死永久占用 DB 连接池 slot（线上
# QueuePool 连接耗尽 / 后端假死根因）。SubmittedMessages 继承 int（== 写入条数），
# 让既有 ``count = await svc.submit_messages(...)`` + ``assert count == N`` 零
# 改动；同时携带 PublishIntent 供 router 调 publish_submitted_messages。


@dataclass
class PublishIntent:
    """submit_messages 待发布的 Redis pub/sub 意图（纯标量，不持有 DB session）。

    1:1 对应原 service 内两个 publish 块所需的数据。由 submit_messages 在 commit
    前从 agent_run 提取标量构造（避免 commit 后 expire_on_commit 触发 lazy
    reload 重新占用连接）。
    """

    agent_run_id: uuid.UUID
    lease_id: uuid.UUID
    count: int
    published_logs: list[dict]
    agent_run_status: str | None
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_creation_tokens: int | None
    # task-05 / FR-01：最近一次调用提示词大小（last-write-wins 写回后的实时值），
    # None（老 daemon / 未上报）时 publish 两路 payload 均不带该键（design §9）。
    ctx_tokens: int | None
    agent_session_id: uuid.UUID | None
    timestamp_iso: str
    # ── task-05（2026-09-01-session-group-chat / design §5.2）：群桥接投影标量 ──
    # submit_messages 事务内快照（解析链见 _resolve_group_bridge_context），publish
    # 阶段不查库。非群场景全 None——publish_submitted_messages 群分支零进入。
    # 此处标量为本次调用最后一条投影行 id（观测/契约快照）。
    group_id: uuid.UUID | None = None
    member_id: uuid.UUID | None = None
    member_name: str | None = None
    member_session_id: uuid.UUID | None = None
    projection_log_id: str | None = None
    # ── quick 投影统一标记制（2026-09-02）：@轮与直聊轮同款 ──
    # publish 群分支只发 group_projection_events 里的 [[GROUP]] 转发段事件：每段
    # 一项（{"log_id": 投影行 id, "content": 段文本, "timestamp": iso}），与投影
    # 行一一对应（partial 从未投影、override 令箭不发——无渲染可撤）。
    # shadow_direct 仅标记直聊轮（观测用；兜底行/互@链路按轮型区分）。
    shadow_direct: bool = False
    group_projection_events: list[dict] = field(default_factory=list)


class SubmittedMessages(int):
    """submit_messages 返回值。

    继承 int（== 本次写入 AgentRunLog 条数）：既有调用方 ``count = await
    svc.submit_messages(...)`` + ``assert count == N`` 零改动继续工作；同时携带
    ``published_logs`` 与 ``publish_intent``，让 router 在 DB session 归还连接后
    再执行 Redis pub/sub（QueuePool 修复 3）。
    """

    def __new__(
        cls,
        count: int,
        published_logs: list[dict],
        publish_intent: PublishIntent | None = None,
    ) -> SubmittedMessages:
        obj = super().__new__(cls, count)
        obj.published_logs = published_logs
        obj.publish_intent = publish_intent
        return obj


async def publish_submitted_messages(intent: PublishIntent) -> None:
    """在 DB session 生命周期之外执行 submit_messages 的 Redis pub/sub。

    QueuePool 修复 3：原逻辑位于 RunSyncService.submit_messages 内（夹在 commit
    与 session-close 之间），Redis publish hang 会一直持有 DB 连接导致连接池
    耗尽。现由 router 在 session commit/归还连接后调用本函数。两个 publish 块
    （agent_run channel + session channel）各自独立 try/except：单 channel 失败
    不影响另一个、不影响已 commit 的 AgentRunLog（AC-06）；Redis Pub/Sub 无历史，
    丢失实时事件不影响 DB 真相，前端重连即续流。
    """
    # ql-20260616-003：每条已持久化的 log 单独 publish 成扁平 StreamLogEvent
    # 形态，前端 SSE onmessage 直接当 StreamLogEvent 用；仍保留一条聚合 messages
    # 事件做计数/审计。
    # ql-20260826-011 之前的实现逐条 ``await redis.publish``：一个 turn 几百条
    # 流式日志 = 上千次串行 RTT，且发生在 daemon ``POST messages`` 请求处理路径
    # 上直接拉长上报回路。现两路 channel 各自 pipeline 一次往返批量发出（pipeline
    # 内命令保序，消费端所见顺序不变）；两路独立 try/except 的失败隔离语义不变。
    try:
        redis = _rsvc.get_redis()
        channel_name = f"agent_run:{intent.agent_run_id}"
        pipe = redis.pipeline()
        for log_payload in intent.published_logs:
            pipe.publish(channel_name, json.dumps(log_payload))
        # task-01 / D-003 / FR-01：run channel 的 published_logs payload 本就含
        # segment_id（service.py submit_messages 内 append 时已加）；session channel
        # 见下方 session_payload 同步透传。
        summary_payload: dict = {
            "event": "messages",
            "lease_id": str(intent.lease_id),
            "count": intent.count,
        }
        if intent.agent_run_status is not None:
            summary_payload["agent_run_status"] = intent.agent_run_status
        # ql-20260621：实时 token 透传到 run channel summary（订阅 agent_run:{id}
        # 的 SSE 也能拿累积 token，不必等 close）。
        if intent.input_tokens is not None:
            summary_payload["input_tokens"] = intent.input_tokens
        if intent.output_tokens is not None:
            summary_payload["output_tokens"] = intent.output_tokens
        if intent.cache_read_tokens is not None:
            summary_payload["cache_read_tokens"] = intent.cache_read_tokens
        if intent.cache_creation_tokens is not None:
            summary_payload["cache_creation_tokens"] = intent.cache_creation_tokens
        # task-05 / FR-01：ctx_tokens 实时透传到 run channel summary（最近一次
        # 调用提示词大小）。None 不带键——老 daemon / 子桶未上报兼容（design §9）。
        if intent.ctx_tokens is not None:
            summary_payload["ctx_tokens"] = intent.ctx_tokens
        pipe.publish(channel_name, json.dumps(summary_payload))
        await pipe.execute()
    except Exception:
        _rsvc.log.warning(
            "daemon_messages_redis_publish_failed",
            lease_id=str(intent.lease_id),
            agent_run_id=str(intent.agent_run_id),
        )

    # task-06 / D-005@v1 / FR-03：interactive run 双 publish —— 把每条扁平 log
    # 以带 run_id 标记的事件发布到 session 级 channel。batch run（agent_session_id
    # IS NULL）跳过。独立 try/except：session publish 失败不得破坏 run channel 或
    # 回滚已提交的 AgentRunLog（AC-06）。
    if intent.agent_session_id is None:
        return
    try:
        redis = _rsvc.get_redis()
        session_channel = f"agent_session:{intent.agent_session_id}"
        pipe = redis.pipeline()
        for log_payload in intent.published_logs:
            session_payload = {
                "event": "log",
                "session_id": str(intent.agent_session_id),
                "run_id": str(intent.agent_run_id),
                "log_id": log_payload["log_id"],
                "channel": log_payload["channel"],
                "content": log_payload["content"],
                "timestamp": log_payload["timestamp"],
                # task-09 / FR-08：归属透传到 session channel（interactive run 实时流）。
                "parent_tool_use_id": log_payload.get("parent_tool_use_id"),
                "subagent_type": log_payload.get("subagent_type"),
                "depth": log_payload.get("depth"),
                # 2026-07-05-agent-log-type-tags task-04 / FR-06 / R-08：tool_kind 透传到
                # session channel（interactive run 实时流），与 run channel published_logs
                # 对齐，前端实时流工具徽标 + 第二层筛选可拿到标签。
                "tool_kind": log_payload.get("tool_kind"),
                # task-01 / FR-01：segment_id 透传到 session channel（interactive run
                # 实时流）。.get() 兼容 override envelope（task-02 写 stale=True）与
                # 历史 payload（无该 key → None，brownfield 安全）。partial 行非空，
                # complete/其他行 None——前端据「非空」识别半截，override 行据此撤回。
                "segment_id": log_payload.get("segment_id"),
                # task-02 / FR-02 / design §7.2：stale 透传到 session channel。override
                # envelope（task-02 append）stale=True，普通 log 行无该 key → .get()
                # 返回 None（前端 SessionStreamEnvelope.stale 默认 false，brownfield
                # 安全）。前端据 stale=True 识别撤回令箭按 segmentId 撤回已渲染半截。
                "stale": log_payload.get("stale"),
                # ql-20260824-020：edit_patch 透传到 session channel，与 run channel
                # published_logs 对齐。.get() 兼容 override envelope 与历史 payload。
                "edit_patch": log_payload.get("edit_patch"),
                # task-07（2026-09-03-agent-provider-abstraction / FR-03）：AgentEvent
                # 结构化事件透传到 session channel（前端 normalize 双轨：有
                # agent_event → 结构化渲染，无 → 旧文本协议解析）。.get() 容错——
                # 旧轨 payload / override 信封 / 标记行无该键 → None（零影响）。
                "agent_event": log_payload.get("agent_event"),
            }
            pipe.publish(session_channel, json.dumps(session_payload))
        # ql-20260621：实时 token 透传到 session channel（onTokens）。
        if intent.input_tokens is not None or intent.output_tokens is not None:
            token_payload: dict = {
                "event": "tokens",
                "session_id": str(intent.agent_session_id),
                "run_id": str(intent.agent_run_id),
                "timestamp": intent.timestamp_iso,
            }
            if intent.input_tokens is not None:
                token_payload["input_tokens"] = intent.input_tokens
            if intent.output_tokens is not None:
                token_payload["output_tokens"] = intent.output_tokens
            if intent.cache_read_tokens is not None:
                token_payload["cache_read_tokens"] = intent.cache_read_tokens
            if intent.cache_creation_tokens is not None:
                token_payload["cache_creation_tokens"] = intent.cache_creation_tokens
            # task-05 / FR-01：ctx_tokens 实时透传到 session channel tokens 事件
            # （前端 onTokens → 上下文环分子）。None 不带键（design §9，老前端/
            # 老 daemon 双向兼容）。
            if intent.ctx_tokens is not None:
                token_payload["ctx_tokens"] = intent.ctx_tokens
            pipe.publish(session_channel, json.dumps(token_payload, default=str))
        await pipe.execute()
    except Exception:
        _rsvc.log.warning(
            "daemon_messages_session_redis_publish_failed",
            lease_id=str(intent.lease_id),
            agent_run_id=str(intent.agent_run_id),
            agent_session_id=str(intent.agent_session_id),
        )

    # task-05（2026-09-01-session-group-chat / design §5.2 改动点①的 publish 半段）
    # + quick 投影统一标记制（2026-09-02）：群频道发布——@轮与直聊轮同款，只发
    # ``agent_session:{群id}`` 上的 [[GROUP]] 转发段事件（每段一条 log 事件、
    # payload 照 session channel log 事件形态 + 成员身份三字段；**log_id=投影行
    # id**——实时事件与回放读库同 id，前端 seenLogIds 去重天然兼容）。其余
    # stdout 零投影——partial/override 令箭不发（partial 从未投影、无渲染可
    # 撤）；@轮整轮无标记的兜底行事件由 close_interactive_run 侧补发（见
    # _emit_group_mention_projection_fallback）。纯 Redis 不写库（双写只在
    # submit_messages 事务内）；独立 try/except：Redis 抖动不拖垮前两路与已
    # commit 的日志行。群上下文隐含 agent_session_id 非 None（影子 run 必挂
    # 影子会话），不受上方早退影响。
    if intent.group_id is None:
        return
    try:
        redis = _rsvc.get_redis()
        group_channel = f"agent_session:{intent.group_id}"
        pipe = redis.pipeline()
        for seg_event in intent.group_projection_events:
            group_payload: dict = {
                "event": "log",
                "session_id": str(intent.group_id),
                "run_id": str(intent.agent_run_id),
                "log_id": seg_event["log_id"],
                "channel": "stdout",
                "content": seg_event["content"],
                "timestamp": seg_event["timestamp"],
                "segment_id": None,
                "stale": None,
                # 成员身份（design §6.2 envelope 扩展）——群 UI 据此分色/归属。
                "member_id": str(intent.member_id),
                "member_name": intent.member_name,
                "member_session_id": str(intent.member_session_id),
            }
            pipe.publish(group_channel, json.dumps(group_payload, default=str))
        await pipe.execute()
    except Exception:
        _rsvc.log.warning(
            "daemon_messages_group_channel_publish_failed",
            lease_id=str(intent.lease_id),
            agent_run_id=str(intent.agent_run_id),
            group_id=str(intent.group_id),
        )


# ── Session 事件通用发布 helper（2026-08-24-platform-session-feedback-fix
#    task-01 / design §接口定义）───────────────────────────────────────────────
# plan_mode_entered / bash_status / bash_chunk / agent_task_status 四类事件经
# 现有 agent_session:{id} 频道实时推送前端，不新增持久化表（design §数据模型）。

# bash_chunk 节流间隔（秒）：同一 (session_id, command) 维度 100ms 内只发一条，
# 防高频输出刷爆 Redis / 前端。
BASH_CHUNK_THROTTLE_INTERVAL_S = 0.1
# bash_chunk 单条 content 字符上限（8KB），超出截断后发布。
BASH_CHUNK_MAX_CONTENT_CHARS = 8 * 1024
# 节流状态 dict 超过该条数时清理 60 秒以上空闲键（防长会话 / 多命令内存增长）。
_BASH_CHUNK_STATE_PRUNE_SIZE = 4096
# bash_chunk 节流状态：(session_id, command) → 上次实际发布时刻（time.monotonic）。
# asyncio 单线程事件循环内读-判-写无 await 穿插，天然原子，无需锁。
_bash_chunk_last_publish: dict[tuple[uuid.UUID, str], float] = {}


async def publish_session_event(session_id: uuid.UUID, payload: dict | BaseModel) -> None:
    """把单条事件发布到 ``agent_session:{session_id}`` 频道（task-01）。

    BaseModel payload 走 ``model_dump(mode="json", by_alias=True)``（UUID /
    Literal 自动转 JSON 兼容形态；by_alias 使带别名字段按契约名输出，如
    agent_task_status 的 ``async_`` → ``async``），dict payload 原样透传；
    ``json.dumps(..., default=str)`` 兜底不可
    序列化对象（对齐 ``_publish_gate_status_changed`` 的容错风格）。Redis 获取
    方式为 ``_rsvc.get_redis()``；发布失败仅 ``log.warning`` 不抛——Pub/Sub 无历史，
    漏发实时事件不影响 DB 真相，前端重连即续流。
    """
    if isinstance(payload, BaseModel):
        # by_alias=True：agent_task_status 的 async_ 字段按契约名 "async" 发布
        # （2026-08-27-background-subagent-progress task-05 / design §8 R-06，
        # 前端/daemon 侧契约名就是 async）；其余经此 helper 的事件模型均无别名，
        # 序列化行为不变。UUID / Literal 由 mode="json" 自动转 JSON 兼容形态。
        payload = payload.model_dump(mode="json", by_alias=True)
    try:
        redis = _rsvc.get_redis()
        await redis.publish(f"agent_session:{session_id}", json.dumps(payload, default=str))
    except Exception:
        _rsvc.log.warning(
            "session_event_redis_publish_failed",
            session_id=str(session_id),
            event_type=payload.get("event") if isinstance(payload, dict) else None,
        )


async def publish_bash_chunk_event(event: BashChunkEvent) -> bool:
    """发布 bash_chunk 事件（100ms 节流 + 8KB 截断），返回是否实际发布。

    节流按 ``(session_id, command)`` 维度：同命令输出流合并、不同命令互不影响；
    ``is_final=True`` 不节流必达（尾块被节流丢掉，命令就永远缺尾巴），但照常
    刷新该键时间戳；命中节流返回 False（调用方据此丢弃，不视为错误）。
    content 超 ``BASH_CHUNK_MAX_CONTENT_CHARS`` 截断后发布（model_copy 不改
    调用方对象）。状态 dict 超 ``_BASH_CHUNK_STATE_PRUNE_SIZE`` 条时清理 60 秒
    以上空闲键。计时用 ``time.monotonic()``——不受系统时钟调整影响，Windows /
    Linux / macOS 行为一致。
    """
    key = (event.session_id, event.command)
    now = time.monotonic()
    if not event.is_final:
        last = _bash_chunk_last_publish.get(key)
        if last is not None and (now - last) < BASH_CHUNK_THROTTLE_INTERVAL_S:
            return False
    _bash_chunk_last_publish[key] = now
    if len(_bash_chunk_last_publish) > _BASH_CHUNK_STATE_PRUNE_SIZE:
        idle_cutoff = now - 60.0
        for stale_key in [k for k, ts in _bash_chunk_last_publish.items() if ts < idle_cutoff]:
            _bash_chunk_last_publish.pop(stale_key, None)
    if len(event.content) > BASH_CHUNK_MAX_CONTENT_CHARS:
        event = event.model_copy(update={"content": event.content[:BASH_CHUNK_MAX_CONTENT_CHARS]})
    await publish_session_event(event.session_id, event)
    return True


async def _publish_run_event(
    svc,
    agent_run_id: UUID,
    *,
    event: str,
    status: str,
    **extra: object,
) -> None:
    """Publish a Redis event for an AgentRun status change.

    Failures are logged but never raised -- callers should not
    abort their workflow due to a Redis publish error.
    """
    payload = {"event": event, "status": status, **extra}
    try:
        redis = _rsvc.get_redis()
        await redis.publish(
            f"agent_run:{agent_run_id}",
            json.dumps(payload, default=str),
        )
    except Exception:
        _rsvc.log.warning(
            "publish_run_event_failed",
            agent_run_id=str(agent_run_id),
            redis_event=event,
        )
