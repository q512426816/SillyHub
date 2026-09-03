"""RunSync subdomain service — agent run status sync / interactive run closure.

Owns the AgentRun state machine (sync / close / messages / post-scan). Migrated
verbatim from DaemonService in change 2026-06-22-daemon-service-split (W4,
task-04). Behavior unchanged; see design §7.5 AgentRun status-sync lifecycle
table.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import (
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentRunModelUsage,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.agent.tool_kind import classify_tool_kind
from app.modules.change.binding import bind_session_to_change, extract_spec_bindings
from app.modules.change.dispatch import _run_gate_via_delegate
from app.modules.daemon.lease.service import DaemonAgentRunNotFound
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.model_error import ModelErrorDTO
from app.modules.daemon.schema import BashChunkEvent, ModelUsageItemRead
from app.modules.daemon.session.service import (
    TERMINAL_TURN_STATUSES,
    _apply_session_terminal_status,
    _send_session_end_best_effort,
    get_session_readiness,
)
from app.modules.daemon.session_events import publish_sessions_changed
from app.modules.git_gateway.service import redact_output

if TYPE_CHECKING:
    from app.modules.agent.model import AgentMission
    from app.modules.change.model import Change
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)

# ql-20260903-011：claude CLI 把模型网关返回的 401 统一合成
# "Not logged in · Please run /login" 错误消息注入对话（transcript 侧特征：
# model=<synthetic>、error=authentication_failed、isApiErrorMessage=true）——
# 文案把远端瞬时抖动误导成本地凭证缺失。该正则用于识别这类「CLI 合成鉴权
# 错误」，命中即视为可自动重投的瞬时失败（实证：同一进程同一份密钥 13 秒后
# 重发即成功，2026-09-03 会话 cb56fabf 事故）。
_CLI_AUTH_TRANSIENT_RE = re.compile(r"Not\s+logged\s+in|Please\s+run\s+/login", re.IGNORECASE)


# ql-20260709-001：tool_result 命令输出截断上限（原 3000 → 100000）。
# 3000 字符会砍掉 scan / 构建 / 测试命令输出的关键尾部（含大量长路径行，
# 如 sillyspec scan 一次输出 59 行），用户在前端只能看到前几行、后面全丢。
# 100000（约 2000 行）覆盖绝大多数命令输出；超长追加中文标注保留原始长度
# 信息。daemon task-runner.ts 的 batch 路径同步对齐（原同样 3000 截断）。
TOOL_RESULT_MAX_CHARS = 100_000


# ── task-06 / FR-05 / D-003@v1：submit_messages 跨轮归位（后台子代理） ─────────
# 后台子代理的日志行（带 parent_tool_use_id）经同 session 的**后续 run** 上报，
# 若按上报 run 落库，前端子代理目录按「派发 tool_use → 子代理行」聚合时找不到
# 行（孤儿 stub）。submit_messages 落库时把这类行的 run_id 归写**派发 run**
# （派发 tool_use 行所在的 run，design §5 Phase 2 P2.2）。tool_use_id → 派发
# run_id 的映射两级供给：进程级 LRU（热路径零查询）+ 冷启动反查 agent_run_logs
# （_resolve_dispatch_run_id）。只改写入归因，不改 AgentRun/AgentSession 状态机，
# 历史行不迁移（N4）。

# LRU 容量 1024（task-06 契约）：长会话多轮派发的 tool_use 映射上限，防膨胀。
_TOOL_USE_RUN_LRU_CAPACITY = 1024


class _ToolUseRunLRU:
    """(agent_session_id, tool_use_id) → 派发 run_id 的进程级 LRU。

    - 手写 OrderedDict 而非 functools.lru_cache：lru_cache 会把 None 返回值也
      缓存（等价负缓存），冷启动反查失败一次后会被永久短路，违背「派发行迟到
      时后续上报仍可归位」的语义；本类只在反查成功时写入。
    - asyncio 单线程事件循环内读-判-写无 await 穿插，天然原子，无需锁（对齐
      下方 _bash_chunk_last_publish 的并发口径）。
    """

    def __init__(self, capacity: int = _TOOL_USE_RUN_LRU_CAPACITY) -> None:
        self._capacity = capacity
        self._data: OrderedDict[tuple[uuid.UUID, str], uuid.UUID] = OrderedDict()

    def get(self, key: tuple[uuid.UUID, str]) -> uuid.UUID | None:
        """查映射：命中移到 MRU 端并返回 run_id；未命中返回 None（不写负缓存）。"""
        run_id = self._data.get(key)
        if run_id is not None:
            self._data.move_to_end(key)
        return run_id

    def put(self, key: tuple[uuid.UUID, str], run_id: uuid.UUID) -> None:
        """写映射并维持容量上限（超出淘汰最老条目）。"""
        self._data[key] = run_id
        self._data.move_to_end(key)
        while len(self._data) > self._capacity:
            self._data.popitem(last=False)

    def clear(self) -> None:
        """清空缓存（测试隔离用，task-08 单测在用例间清态）。"""
        self._data.clear()


# 进程级单例：跨 submit_messages 调用、跨 run 共享（同会话第二轮起命中热路径）。
_tool_use_run_lru = _ToolUseRunLRU()


# ── task-05（2026-09-01-session-group-chat / design §5.2）：桥接投影 ─────────────
# 群成员影子会话（AgentSession.session_kind='group_member'）的 agent 回复在落库
# 影子 run 的同时，**同事务双写**一行「投影行」到群载体 run（新 PK；dedup_key
# 复用原值；身份进 metadata_ 列）——刷新/重连回放走 get_agent_session_logs 按
# agent_session_id=群会话 聚合天然覆盖；实时群频道事件（publish_submitted_messages
# 群分支）log_id=投影行 id，实时与回放读库同 id，前端 seenLogIds 去重两端对齐。
# 判定铁律：session_kind=='group_member' 精确命中——单聊（chat）/ worker 回流 /
# quick-chat 会话零行为变化（constraints）。


@dataclass(frozen=True)
class _GroupBridgeContext:
    """submit_messages 事务内解析出的群桥接上下文（落库时刻快照，publish 阶段不查库）。

    - ``group_id``：群 id == 群会话 id（design §3.2 不变式；群频道
      ``agent_session:{group_id}`` 与回放聚合共用该 id）；
    - ``member_name``：身份按落库时刻快照（成员改名不回填历史投影行）；
    - ``carrier_run_id``：触发本轮的群消息载体 run（投影行 run_id 指向；
      从本 run 最近一条 user_input 日志 metadata_.source_carrier_run_id 解析，
      task-03 注入时落、§4.4 链 id 透传同源）；
    - ``shadow_direct``（quick 2026-09-02 影子直聊）：本 run 最近 user_input
      metadata.source=="shadow_direct" 命中——直聊轮标记。投影已统一标记制
      （@轮与直聊轮同款：完整 assistant 文本仅 ``[[GROUP]]`` 标记段投影，见
      extract_group_broadcast_segments）；本标志仅区分轮型供消费方判定
      （互@检测直聊轮早退、@轮无标记兜底行仅对非直聊轮生效）。
    """

    group_id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    member_session_id: uuid.UUID
    carrier_run_id: uuid.UUID
    shadow_direct: bool = False


async def resolve_group_member_identity(
    db: AsyncSession, *, shadow_session_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """影子会话 → ``(group_id, member_id, member_name)``；非群影子返回 None。

    kind 判定（'group_member' 精确）+ 成员表反向指针（§5.1：群↔影子唯一关联
    通道）。submit_messages 的投影上下文解析与 close_interactive_run 的群
    turn_completed 共用。
    """
    kind = (
        await db.execute(
            select(AgentSession.session_kind).where(AgentSession.id == shadow_session_id)
        )
    ).scalar_one_or_none()
    if kind != "group_member":
        return None
    member = (
        await db.execute(
            select(AgentGroupMember).where(AgentGroupMember.shadow_session_id == shadow_session_id)
        )
    ).scalar_one_or_none()
    if member is None:
        return None
    return member.group_id, member.id, member.display_name


# 群时间线投影过滤（design §5.2「投影范围」）：仅 assistant 文本回复——前端
# classifySessionLog 的 reply 口径服务端复刻（session-log-assembler.ts），thinking /
# tool_use / tool_result / stderr / 系统行 / 任务生命周期行 / override 令箭 / 技能
# 装载行一律不投影（保持群聊干净）。partial 半截行照常投影（segment_id 语义
# 保留），override 到达时按 (载体 run, segment_id) DELETE 撤回——与单聊同机制。
_GROUP_SYSTEM_LINE_RE = re.compile(r"^\[(?:SYSTEM|RESULT)[^\]]*\]")
_GROUP_TASK_LINE_RE = re.compile(r"^\[TASK_(?:STARTED|PROGRESS|NOTIFICATION)\b")
_GROUP_OVERRIDE_LINE_RE = re.compile(r"^\[(?:ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s")
_GROUP_SKILL_LINE_RE = re.compile(r"^\[ASSISTANT\]\s*Base directory for this skill:", re.IGNORECASE)


def is_group_projectable_reply(channel: str | None, content: object) -> bool:
    """日志行是否为可投影进群时间线的 assistant 文本段（reply 口径）。"""
    if channel != "stdout":
        # tool_call（工具 JSON 卡）/ stderr / user_input（注入 prompt）不投影。
        return False
    if not isinstance(content, str):
        return False
    text = content.strip()
    if not text:
        return False
    if "AskUserQuestion" in text:
        return False  # 审批卡片协议行（前端丢弃口径）
    if text.startswith("[TOOL_RESULT] User answered"):
        return False
    if _GROUP_SYSTEM_LINE_RE.match(text) or _GROUP_TASK_LINE_RE.match(text):
        return False
    if _GROUP_OVERRIDE_LINE_RE.match(text):
        return False  # 撤回令箭非正文（stale 信封另行发群频道）
    if text.startswith(("[TOOL_USE]", "[TOOL_RESULT]", "[THINKING]")):
        return False  # 工具回显 / thinking 不进群时间线
    # 技能装载协议载荷（非用户答复）不投影；其余即 assistant 文本段（reply）。
    return _GROUP_SKILL_LINE_RE.match(text) is None


# ── quick 影子直聊（2026-09-02）：[[GROUP]] 选择性转发标记（投影统一标记制）──
# 直聊轮（user_input metadata.source=="shadow_direct"）与群 @ 轮（无 source）
# 投影同款标记制：agent 按 prompt 指引（直聊头 / 群回应要求行）在回复中用
# [[GROUP]]...[[/GROUP]] 包裹要转发的段落——投影层仅抽该段生成投影行（标记
# 剥离只投内容；同轮多段各成一行、保序）。标记原文保留在影子会话 stdout
# 原文（会话内显示完整含标记）；未闭合标记不匹配（不转发半截）。@轮整轮
# 无标记时由 close_interactive_run 补一行兜底行（quick 群 P1 起为回复首段
# 摘要 + 「完整内容见成员会话」，防群里死寂，见
# _emit_group_mention_projection_fallback）。标记词与 daemon/group/service.py
# _SHADOW_DIRECT_HEADER / _GROUP_REPLY_MARKER_REQUIREMENT 中的说明逐字节一致
# （[[GROUP]] / [[/GROUP]]，大小写敏感）。
_GROUP_BROADCAST_MARKER_RE = re.compile(r"\[\[GROUP\]\](.*?)\[\[/GROUP\]\]", re.DOTALL)


def extract_group_broadcast_segments(text: str) -> list[str]:
    """抽 assistant 文本中的 ``[[GROUP]]...[[/GROUP]]`` 转发段（保序、去空白）。"""
    return [m.strip() for m in _GROUP_BROADCAST_MARKER_RE.findall(text) if m.strip()]


# quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——见
# RunSyncService._emit_group_mention_projection_fallback。quick 群 P1（2026-09-02）
# 兜底升级：优先投影本轮回复首段摘要（前 ``GROUP_FALLBACK_SUMMARY_CHARS`` 字），
# 无文本可取时回退本模板行（保底不变）。
GROUP_PROJECTION_FALLBACK_TEMPLATE = "（{member_name} 已在会话内处理，点击成员卡查看）"
# 兜底摘要截断长度（首段前缀）。
GROUP_FALLBACK_SUMMARY_CHARS = 200


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
        redis = get_redis()
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
        log.warning(
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
        redis = get_redis()
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
        log.warning(
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
        redis = get_redis()
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
        log.warning(
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
    方式为 ``get_redis()``；发布失败仅 ``log.warning`` 不抛——Pub/Sub 无历史，
    漏发实时事件不影响 DB 真相，前端重连即续流。
    """
    if isinstance(payload, BaseModel):
        # by_alias=True：agent_task_status 的 async_ 字段按契约名 "async" 发布
        # （2026-08-27-background-subagent-progress task-05 / design §8 R-06，
        # 前端/daemon 侧契约名就是 async）；其余经此 helper 的事件模型均无别名，
        # 序列化行为不变。UUID / Literal 由 mode="json" 自动转 JSON 兼容形态。
        payload = payload.model_dump(mode="json", by_alias=True)
    try:
        redis = get_redis()
        await redis.publish(f"agent_session:{session_id}", json.dumps(payload, default=str))
    except Exception:
        log.warning(
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


class RunSyncService:
    """AgentRun 状态同步子 service。构造接 AsyncSession。"""

    # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收
    _background_tasks: set[asyncio.Task] = set()

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 跨子域辅助：W4 早于 W5(session)/W6(lease)，_get_lease_and_verify_token
        # 与 _publish_session_event 仍在 facade（task-05/06 才迁）。持有 facade
        # 引用反向委托（design §7.2），task-05/06 落位后 facade 保留委托，本引用
        # 继续工作（委托到对应子 service），不耦合 Wave 顺序。
        self._facade: DaemonService | None = None

    # ------------------------------------------------------------------
    # Background task lifecycle helpers（H4 / R5，逐字对齐 agent/service.py:347-386）
    # task-05（gate enqueue）/ task-07（gate 任务派发）将复用本能力；
    # 本 task 仅提取 helper，不接通调用点、不实现 gate 业务。
    # ------------------------------------------------------------------

    def _fire_background_task(
        self,
        coro,
        *,
        workspace_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> asyncio.Task:
        """Create a background task and hold a strong reference to prevent GC."""
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._on_background_task_done)
        log.info(
            "background_task_fired",
            task_id=id(task),
            workspace_id=str(workspace_id),
            run_id=str(run_id),
        )
        return task

    @staticmethod
    def _on_background_task_done(task: asyncio.Task) -> None:
        """Remove task from the tracking set and surface exceptions."""
        RunSyncService._background_tasks.discard(task)
        try:
            exc = task.exception()
        except (asyncio.InvalidStateError, asyncio.CancelledError):
            return
        if exc is not None:
            log.exception("background_task_failed", task_id=id(task), exc_info=exc)

    async def _revoke_committed_partials(self, agent_run_id: uuid.UUID, segment_id: str) -> int:
        """task-14 / FR-02：跨 submit_messages 调用撤销已 commit 的同 segmentId partial 行。

        partial（半截）与 override 信号常分两次 submit_messages 到达——partial 在先前
        调用已 commit 落库，本调用局部 ``flushed_partials`` 查不到、且对象已 persisted
        无法 expunge。此处按 segment_id 把已落库的 partial 行 select 出来再
        ``session.delete``（ORM 级，正确同步 identity map；非 bulk delete，避免同 session
        跨调用脏对象），让 DB 只剩完整行。complete 行 segment_id=NULL 不被命中（仅 partial
        行写 segment_id）。

        返回删除行数（观测用）。本方法只标记 DELETE、不 commit，随 submit_messages 事务提交。
        """
        rows = (
            (
                await self._session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == agent_run_id,
                        AgentRunLog.segment_id == segment_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            await self._session.delete(row)
        if rows:
            log.info(
                "daemon_messages_override_deleted_committed_partial",
                agent_run_id=str(agent_run_id),
                segment_id=segment_id,
                deleted=len(rows),
            )
        return len(rows)

    async def _resolve_group_bridge_context(
        self, agent_run: AgentRun | None
    ) -> _GroupBridgeContext | None:
        """解析影子 run 的群桥接上下文（design §5.2 改动点①，task-05）。

        判定链：run → 影子会话（``session_kind=='group_member'`` 精确判定，单聊/
        worker/quick-chat 零进入）→ 成员表反向指针（群/成员身份 + 快照昵称）→
        本 run 最近一条 user_input 日志 ``metadata_.source_carrier_run_id``
        （task-03 注入时落；排队派发 run 的链 metadata 透传在 task-04 接线）。
        任一环缺失（含排队派发未透传）返回 None，本调用零投影——fail-open：
        消息照常落影子 run，不因桥接缺环阻塞上报。
        """
        if agent_run is None or agent_run.agent_session_id is None:
            return None
        identity = await resolve_group_member_identity(
            self._session, shadow_session_id=agent_run.agent_session_id
        )
        if identity is None:
            return None
        group_id, member_id, member_name = identity
        turn_meta = (
            (
                await self._session.execute(
                    select(AgentRunLog.metadata_)
                    .where(
                        AgentRunLog.run_id == agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                    .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        carrier_raw = (
            turn_meta.get("source_carrier_run_id") if isinstance(turn_meta, dict) else None
        )
        if not isinstance(carrier_raw, str) or not carrier_raw:
            return None
        try:
            carrier_run_id = uuid.UUID(carrier_raw)
        except ValueError:
            log.warning(
                "group_bridge_invalid_carrier_run_id",
                agent_run_id=str(agent_run.id),
                shadow_session_id=str(agent_run.agent_session_id),
            )
            return None
        # quick 影子直聊（2026-09-02）：source=="shadow_direct" 标记直聊轮——
        # 投影已统一标记制（@轮与直聊轮均仅 [[GROUP]] 段投影），本标志供
        # 互@检测（直聊轮早退）与 @轮无标记兜底行（仅非直聊轮）区分轮型。
        shadow_direct = (
            turn_meta.get("source") == "shadow_direct" if isinstance(turn_meta, dict) else False
        )
        return _GroupBridgeContext(
            group_id=group_id,
            member_id=member_id,
            member_name=member_name,
            member_session_id=agent_run.agent_session_id,
            carrier_run_id=carrier_run_id,
            shadow_direct=shadow_direct,
        )

    @staticmethod
    def _build_group_projection_row(
        ctx: _GroupBridgeContext,
        *,
        source_row: AgentRunLog,
        dedup_key: str | None,
        content_override: str | None = None,
        timestamp_override: datetime | None = None,
    ) -> AgentRunLog:
        """构造群时间线投影行（调用方 add 进同一事务；design §5.2 双写细则）。

        - ``id=新 uuid``：原 log_id 已被影子行占用，复用必 PK 冲突（D-008 Grill P0）；
        - ``run_id=载体 run``：回放走 get_agent_session_logs 按群会话聚合天然覆盖；
        - ``dedup_key`` 复用原值——载体 run 与影子 run 不同 run，(run_id, dedup_key)
          部分唯一索引不冲突；daemon 重试去重仍按影子 run 判定，投影不重复产生；
        - ``segment_id`` 原值透传（partial 半截行语义保留，override 按此列 DELETE）；
        - ``metadata_``：成员身份快照（member_name 按落库时刻，改名不回填）+
          source_log_id（溯源影子行）+ projection 标记（群摘要/回放行源判别，
          §4.2 ``channel='stdout' AND metadata IS NOT NULL`` 同口径）；
        - ``content_override``（quick 投影统一标记制 2026-09-02）：[[GROUP]]
          转发段的投影正文（标记剥离只投内容；影子行原文含标记不受影响；@轮
          与直聊轮同款）。携带时 ``dedup_key`` 必须传 None——同源多段共享
          dedup_key 会撞载体 run 的 (run_id, dedup_key) 部分唯一索引；
        - ``timestamp_override``：多段投影的保序微调（同源多段同 timestamp 下
          时间线排序退化到随机 id——逐段 +1µs 保证段序稳定）。
        """
        return AgentRunLog(
            id=uuid.uuid4(),
            run_id=ctx.carrier_run_id,
            timestamp=timestamp_override
            if timestamp_override is not None
            else source_row.timestamp,
            channel="stdout",
            content_redacted=content_override
            if content_override is not None
            else source_row.content_redacted,
            dedup_key=dedup_key,
            segment_id=source_row.segment_id,
            metadata_={
                "member_id": str(ctx.member_id),
                "member_name": ctx.member_name,
                "source_log_id": str(source_row.id),
                "projection": True,
            },
        )

    # quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——群 @ 轮改为
    # 仅 [[GROUP]] 段投影后，agent 忘记打标记 → 群里整轮死寂（用户不知成员
    # 已处理）。收口时补一行简短系统行防死寂（群前端现有渲染显示为普通
    # agent 气泡，可接受）。
    # quick 群 P1（2026-09-02）兜底升级：模板行 → 回复首段摘要——查影子 run
    # 本轮完整 assistant 文本（``is_group_projectable_reply`` 同口径过滤，
    # 剥 ``[ASSISTANT]`` 前缀），取首个非空文本段前
    # ``GROUP_FALLBACK_SUMMARY_CHARS`` 字投影；无文本可取（整轮纯工具/thinking）
    # 回退原模板行（保底不变）。
    async def _emit_group_mention_projection_fallback(self, agent_run: AgentRun) -> None:
        """群 @ 轮收口时的无标记兜底行（quick 投影统一标记制 2026-09-02）。

        判定：本 run 为群 @ 轮（非 shadow_direct——直聊轮群内静默是设计语义，
        不兜底）且载体 run 上**本成员**无任何投影行（[[GROUP]] 段已投影 / 兜底
        已发过均算「有」）→ 补一行 stdout 投影行到载体 run + publish 群频道
        log 事件（log_id=投影行 id，实时与回放读库同 id）。metadata 携带成员
        身份 + ``projection_fallback: True``（前端/回放可辨识兜底行）。幂等：
        兜底行本身带成员身份 metadata，重复收口（终态守卫后不会发生）或并发
        下二次进入时按「已有本成员投影行」跳过。

        兜底内容（quick 群 P1）：影子 run 本轮首个非空 assistant 文本段前
        200 字 + 「…（完整内容见成员会话）」；无文本可取回退模板行。

        独立小事务（close 主 commit 之后追加），fail-open：异常不阻断
        turn_completed / 互@检测 / 排队派发（调用方 try/except 包裹）。
        """
        ctx = await self._resolve_group_bridge_context(agent_run)
        if ctx is None or ctx.shadow_direct:
            return
        carrier_rows = (
            (
                await self._session.execute(
                    select(AgentRunLog.metadata_).where(
                        AgentRunLog.run_id == ctx.carrier_run_id,
                        AgentRunLog.channel == "stdout",
                    )
                )
            )
            .scalars()
            .all()
        )
        for meta in carrier_rows:
            if isinstance(meta, dict) and meta.get("member_id") == str(ctx.member_id):
                return
        now = datetime.now(UTC)
        fallback_id = uuid.uuid4()
        # quick 群 P1 兜底升级：优先投影回复首段摘要；无文本可取回退模板行。
        summary = await self._build_group_fallback_summary(agent_run)
        if summary is not None:
            fallback_content = f"{summary}…（完整内容见成员会话）"
        else:
            fallback_content = GROUP_PROJECTION_FALLBACK_TEMPLATE.format(
                member_name=ctx.member_name
            )
        self._session.add(
            AgentRunLog(
                id=fallback_id,
                run_id=ctx.carrier_run_id,
                timestamp=now,
                channel="stdout",
                content_redacted=fallback_content,
                dedup_key=None,
                metadata_={
                    "member_id": str(ctx.member_id),
                    "member_name": ctx.member_name,
                    "projection": True,
                    "projection_fallback": True,
                },
            )
        )
        await self._session.commit()
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_session:{ctx.group_id}",
                json.dumps(
                    {
                        "event": "log",
                        "session_id": str(ctx.group_id),
                        "run_id": str(agent_run.id),
                        "log_id": str(fallback_id),
                        "channel": "stdout",
                        "content": fallback_content,
                        "timestamp": now.isoformat().replace("+00:00", "Z"),
                        "segment_id": None,
                        "stale": None,
                        # 成员身份（design §6.2 envelope 扩展）——群 UI 据此分色/归属。
                        "member_id": str(ctx.member_id),
                        "member_name": ctx.member_name,
                        "member_session_id": str(ctx.member_session_id),
                    },
                    default=str,
                ),
            )
        except Exception:
            log.warning(
                "group_projection_fallback_redis_publish_failed",
                agent_run_id=str(agent_run.id),
                group_id=str(ctx.group_id),
            )

    async def _build_group_fallback_summary(self, agent_run: AgentRun) -> str | None:
        """兜底行摘要（quick 群 P1）：影子 run 本轮首个非空 assistant 文本段。

        过滤口径与投影判定同源（``is_group_projectable_reply``——thinking/tool/
        系统行不进摘要），剥 ``[ASSISTANT]`` 前缀后取前
        ``GROUP_FALLBACK_SUMMARY_CHARS`` 字；整轮无可取文本（纯工具/thinking 轮）
        返回 None（调用方回退模板行）。
        """
        rows = (
            await self._session.execute(
                select(AgentRunLog.channel, AgentRunLog.content_redacted)
                .where(AgentRunLog.run_id == agent_run.id)
                .order_by(AgentRunLog.timestamp, AgentRunLog.id)
            )
        ).all()
        for channel, content in rows:
            if not is_group_projectable_reply(channel, content):
                continue
            text = content.strip()
            if text.startswith("[ASSISTANT]"):
                text = text[len("[ASSISTANT]") :].strip()
            if text:
                return text[:GROUP_FALLBACK_SUMMARY_CHARS]
        return None

    async def _resolve_dispatch_run_id(
        self,
        agent_session_id: uuid.UUID,
        tool_use_id: str,
    ) -> uuid.UUID | None:
        """task-06 / FR-05：冷启动反查 tool_use_id 的派发 run_id。

        进程级 LRU 未命中时（进程重启 / 容量逐出 / 首次上报）从 agent_run_logs
        反查：同 agent_session_id 的 run 集合中，channel='tool_call' 且 content
        JSON 含该 tool_use_id 的**最早**一行的 run_id。取最早是因为派发 tool_use
        在时间上先于任何子代理回显，可防子代理输出里偶现同 id 串的误配。查询走
        既有索引两步最小化：先 ix_agent_runs_agent_session_id 取同 session 的
        run id 列表，再 run_id IN + channel 过滤（ix_agent_run_logs_run）定位。
        查不到（极端：派发 run 日志已被清理）返回 None，调用方保持当前 run_id
        兜底不抛错（design §5 P2.2 / N4 历史行不迁移）。
        """
        try:
            # 第一步：同 session 的 run id 列表（索引命中，避免 agent_run_logs 全表扫）。
            run_ids = (
                (
                    await self._session.execute(
                        select(AgentRun.id).where(AgentRun.agent_session_id == agent_session_id)
                    )
                )
                .scalars()
                .all()
            )
            if not run_ids:
                return None
            # 第二步：这些 run 的 tool_call 行中定位 content 含该 tool_use_id 的行。
            dispatch_run_id = (
                (
                    await self._session.execute(
                        select(AgentRunLog.run_id)
                        .where(
                            AgentRunLog.run_id.in_(run_ids),
                            AgentRunLog.channel == "tool_call",
                            # LIKE 模式给 id 带双引号，匹配 JSON 字符串值
                            # （"tool_use_id":"toolu_xxx"，interactive 与 batch 两路
                            # 径的 tc_content 均含该键）；toolu id 字符集为字母
                            # 数字下划线，不含 LIKE 通配符，无需转义。
                            AgentRunLog.content_redacted.like(f'%"{tool_use_id}"%'),
                        )
                        .order_by(AgentRunLog.timestamp.asc())
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )
        except Exception:
            # 未命中路径不抛错（task-06 验收）：查询异常视作未找到，调用方兜底。
            log.debug(
                "daemon_messages_parent_dispatch_lookup_error",
                agent_session_id=str(agent_session_id),
                tool_use_id=tool_use_id,
            )
            return None
        return dispatch_run_id

    @staticmethod
    def _override_marker_content(segment_id: str, thinking: bool) -> str:
        """quick-0e56260f：完整行落库时合成的 override 标记行/信封正文。

        格式与 daemon 信号（task-07）逐字节一致（``[ASSISTANT_OVERRIDE] <segmentId>``
        / ``[THINKING_OVERRIDE] <segmentId>``），前端 OVERRIDE_RE / 撤回链路零改动。
        """
        prefix = "THINKING" if thinking else "ASSISTANT"
        return f"[{prefix}_OVERRIDE] {segment_id}"

    async def _override_marker_exists(self, agent_run_id: uuid.UUID, segment_id: str) -> bool:
        """quick-0e56260f：该 segment 的完整行是否已处理（override 标记行已落库）。

        partial 行落库前的守护：完整行先到（HTTP 并发乱序 / daemon 重试迟到）时，
        该 segment 已被覆盖，partial 整行跳过（不 INSERT 不 publish）——堵住
        「完整行调用跑完 DELETE 后 partial 事务才提交」的竞态（会话 0ef651b6 实证：
        partial 03:30:45.437 开始处理、full 03:30:45.580，full 的跨调用 DELETE
        查不到未提交的 partial，擦肩留库）。标记行 segment_id=NULL（不会被
        _revoke_committed_partials 误删），以 content 精确匹配识别。
        """
        row = (
            await self._session.execute(
                select(AgentRunLog.id).where(
                    AgentRunLog.run_id == agent_run_id,
                    AgentRunLog.content_redacted.in_(
                        [
                            self._override_marker_content(segment_id, False),
                            self._override_marker_content(segment_id, True),
                        ]
                    ),
                )
            )
        ).scalar_one_or_none()
        return row is not None

    # ── public ────────────────────────────────────────────────────────────

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> SubmittedMessages:
        """Submit agent conversation messages for a lease.

        Writes to AgentRunLog and syncs AgentRun status, then returns a
        :class:`SubmittedMessages` (an ``int`` == messages written) carrying
        the Redis pub/sub :class:`PublishIntent`. The caller (router) publishes
        AFTER the DB session has committed / released its connection via
        :func:`publish_submitted_messages` (QueuePool fix: Redis hangs must not
        pin DB connections).
        """
        await self._facade._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        count = 0
        published_logs: list[dict] = []
        # ql-20260617-001：daemon _eventToMessages 把 usage/session_id 透传到首条
        # message（task-runner.ts:1142-1155），但首条 message 总有 content（[ASSISTANT]/
        # [TOOL_USE]/[TOOL_RESULT] 等），所以「仅在 content 为空时提取 usage」的旧分支
        # 永远走不到。现在对所有 message 都提取 usage/session_id（取 max 防御乱序）。
        # ql-20260617-003 + ql-20260705-001：Claude CLI stream-json 的中间 assistant
        # 事件 usage 永远是 {0,0}（真实值只在最终 result 事件）。但 prompt cache 全
        # 命中时 result 事件的 input_tokens 也是合法的 0（真实输入在 cache_read）。
        # 旧 >0 守卫把合法 0 当噪声丢，致 AgentRun.input_tokens 永久 NULL；现接受 0，
        # 靠 max 累积 + 仅增不减写回（service.py:478-501）防御中间事件 0/0。
        latest_input_tokens: int | None = None
        latest_output_tokens: int | None = None
        # task-07 / FR-02：prompt cache 词元累积（同 input/output，取 max 防御
        # Claude 中间事件 usage=0/0 乱序）。daemon Wave1 task-01/02/03 已把
        # snake_case cache_read_tokens/cache_creation_tokens 写入 usage dict。
        latest_cache_read_tokens: int | None = None
        latest_cache_creation_tokens: int | None = None
        latest_session_id: str | None = None
        # task-05 / FR-01 / D-002@v1：ctx_tokens（最近一次 API 调用的提示词大小 =
        # input + cache_read + cache_creation，daemon 仅 main 桶 pendingUsage 携带）。
        # 瞬时量可上可下——批内最后出现值胜出直接赋值（last-write-wins），刻意
        # 不用 input/output 的 max 累积（design §7 守卫差异）。
        latest_ctx_tokens: int | None = None
        # ql-006：interactive session（SDK driver）的 onTurnMessage 发原始 SDK msg
        # （{type:"assistant"|"user", message:{content:[ContentBlock]}}），顶层无
        # content/event_type。旧代码只拼 text blocks、丢弃 thinking/tool_use/tool_result，
        # 导致 agent_run_logs 只有纯文本 stdout。这里先把每条 SDK msg 用
        # _extract_sdk_messages 展开成 0..N 条 flat {event_type, content, channel}
        # （对齐 task-runner _eventToMessages），再统一进入下面的写入循环。
        # batch mode（已 flat）原样透传，行为不变。
        flat_messages: list[dict] = []
        for msg in messages:
            event_type = msg.get("event_type") or ""
            content = msg.get("content", "")
            if event_type or content:
                flat_messages.append(msg)
                continue
            # 顶层无 event_type/content → 当作 SDK 原始格式展开
            flat_messages.extend(_extract_sdk_messages(msg))

        # task-21 / FR-08 / D-001@v2：dedup_key 幂等去重。daemon ResilienceService
        # 重试/outbox 补发会重复提交同一 (run_id, dedup_key)；此处查 DB 已存在的
        # dedup_key，写入循环跳过它们（等价 INSERT ON CONFLICT DO NOTHING，但 dialect
        # 无关——SQLite 测试 + PG 生产一致）。dedup_key 由 daemon 注入 message 顶层
        # （task-19），旧 daemon / 未注入路径无 dedup_key → None → 不约束（照常 append）。
        existing_dedup_keys: set[str] = set()
        submitted_dedup_keys = {
            str(m["dedup_key"]) for m in flat_messages if m.get("dedup_key") is not None
        }
        if submitted_dedup_keys:
            existing_rows = await self._session.execute(
                select(AgentRunLog.dedup_key).where(
                    AgentRunLog.run_id == agent_run_id,
                    AgentRunLog.dedup_key.in_(submitted_dedup_keys),
                )
            )
            existing_dedup_keys = {str(r[0]) for r in existing_rows.all() if r[0] is not None}

        # task-12 / D-002@v1 / FR-07 FR-08：本次 submit_messages 调用内"已完成"
        # thinking segment 集合。来源：(1) [THINKING_OVERRIDE] 信号声明的 segment；
        # (2) 完整 thinking 行（_extract_sdk_messages 产出 isComplete=true 的 record）
        # 落库后登记的 segment。同 segment 的 partial 到达时若已在集合内，跳过 INSERT
        # （丢弃重复）。跨调用去重交给前端 normalize 覆盖（task-14 范围，design §5.3
        # 修复1 简化方案 / 实现要求 6 优先简化）。
        completed_segments: set[str] = set()
        # task-12：partial 先到、完整后到（daemon 真实流式顺序，最常见场景）——
        # 同 segment 的 partial 已 session.add 进 pending（未 commit），完整行到达
        # 时必须回退旧 partial（从 session 删除 + 从 published_logs 移除），让 DB /
        # SSE 只剩完整行（验收点："只落库完整行"）。AgentRunLog 无 metadata 列，无法
        # 软删标记；commit 前 pending 对象还在 identity map，session.delete 直接撤销
        # 即可，无额外 SQL 开销。
        flushed_partials: dict[str, AgentRunLog] = {}
        # ql-20260706-002：tool_use_id → tool_kind 缓存（tool_kind 跨消息继承）。
        # _extract_sdk_messages 的 tool_result 分支产出的 stdout 行无 tool_kind，但
        # 自带 tool_use_id（Anthropic API）；配对的 tool_use（同 id）在上一轮 assistant
        # message 已被 classify_tool_kind 打标。SDK 消息顺序恒为 assistant(tool_use)
        # → user(tool_result)，本循环按顺序处理：tool_use 行登记 id→kind，后续
        # tool_result 行回查补 kind。让 [TOOL_RESULT] 命令输出也带 tool_kind，前端
        # 第二层 SillySpec 筛选才能命中 sillyspec 的 ✅ Step 进度等（d751a871 根因）。
        # 缓存单次调用内有效；跨调用的 tool_result 查不到则保持 None（兼容不报错）。
        tool_kind_by_tool_use_id: dict[str, str] = {}
        # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：落库循环中
        # 收集的 sillyspec 命令原文（tool_kind=sillyspec 且 channel=tool_call 的
        # 入库行），循环后经 run 二跳定位会话再走 change.binding 落绑定
        # （design §5 W2.1 / §7.5 生命周期契约表第 1 行）。仅 sillyspec 行触发
        # 收集（R-03 低频热路径），空列表时循环后零额外查询。
        sillyspec_commands: list[str] = []
        # task-06 / FR-05 / D-003@v1：跨轮归位预处理。提前 get AgentRun（原在
        # 循环后状态同步处；identity map 复用，无额外查询），取 agent_session_id
        # 作归位映射的会话维度 key——后台子代理行经同 session 的后续 run 上报，
        # 归位映射必须按会话隔离。batch run（agent_session_id=None）无会话维度，
        # 跳过登记与归位（batch 无跨轮后台子代理场景，行为不变）。
        agent_run = await self._session.get(AgentRun, agent_run_id)
        attribution_session_id = agent_run.agent_session_id if agent_run is not None else None
        # task-05（2026-09-01-session-group-chat / design §5.2）：群桥接投影上下文。
        # session_kind=='group_member' 精确判定（单聊/worker/quick-chat 解析为 None
        # 零进入）；解析失败 fail-open——消息照常落影子 run，不因桥接缺环阻塞上报。
        group_bridge = await self._resolve_group_bridge_context(agent_run)
        # last_projection_log_id：本次调用最后一条投影行 id（PublishIntent 快照
        # 标量）。投影行仅由完整行抽 [[GROUP]] 段产生（partial 从不投影），无
        # 投影 partial 回退需求（影子行 partial 的 flushed_partials 机制照旧）。
        last_projection_log_id: str | None = None
        # quick 投影统一标记制（2026-09-02）：[[GROUP]] 转发段的群频道事件（每段
        # 一项，与投影行一一对应；timestamp 口径与 published_logs 同款 Z 后缀
        # ISO；@轮与直聊轮同款）。
        group_projection_events: list[dict] = []
        # 冷启动反查未命中集合（本次调用局部）：同一 parent_tool_use_id 的多行
        # 只查一次 DB；不做跨调用负缓存——派发行迟到时后续调用反查仍可成功
        # （design §5 P2.2），失败行保持当前 run_id 兜底。
        cold_lookup_misses: set[tuple[uuid.UUID, str]] = set()

        for msg in flat_messages:
            # ql-20260616-003：daemon _eventToMessage 不发 channel/timestamp/log_id，
            # 后端按 event_type 映射 channel（text→stdout, tool_use/tool_result→tool_call,
            # error→stderr），避免前端 SSE 实时流出现 Invalid Date + channel 误判。
            event_type = msg.get("event_type") or ""
            content = msg.get("content", "")
            channel = msg.get("channel") or _channel_from_event_type(event_type)

            # task-12 / D-002@v1 / FR-07 FR-08：thinking 按 segmentId 去重。
            # daemon task-11 在 partial message 的 metadata 加 segmentId + isPartial，
            # 并在完整 message 到达后 emit [THINKING_OVERRIDE] <segmentId> 信号。
            # _extract_sdk_messages 完整 thinking 行带 metadata.segmentId + isComplete。
            # 这里解析 segmentId / 是否 partial，并识别 override 信号做单次调用内去重。
            metadata = msg.get("metadata") if isinstance(msg, dict) else None
            segment_id = metadata.get("segmentId") if isinstance(metadata, dict) else None
            is_partial = bool(metadata.get("isPartial")) if isinstance(metadata, dict) else False

            # 识别 [THINKING_OVERRIDE] <segmentId> 信号 —— daemon → backend 的"该
            # segment 已被完整 message 覆盖"通知。信号本身不落库（continue 跳过
            # INSERT + publish），仅把 segmentId 加入 completed_segments，让后续同
            # segment 的 partial 被丢弃。design §5.3 D1/D2 / task-11 契约。
            if (
                isinstance(content, str)
                and content.startswith("[THINKING_OVERRIDE] ")
                and segment_id
            ):
                completed_segments.add(segment_id)
                # 若同 segment 的 partial 已落库（罕见：override 早于 partial flush），
                # 一并回退，保持 DB 真相一致。
                stale = flushed_partials.pop(segment_id, None)
                if stale is not None:
                    # 对象仅 session.add（pending，未 flush），用 expunge 撤销待插入
                    # 即可（不会写库）。session.delete 要求对象已 persisted，会抛
                    # InvalidRequestError。
                    self._session.expunge(stale)
                    count -= 1
                    published_logs = [p for p in published_logs if p["log_id"] != str(stale.id)]
                # task-14：跨 submit_messages 调用——partial 已在先前调用 commit 落库，
                # 本调用局部 flushed_partials 查不到、也无法 expunge（已 persisted）。按
                # segment_id DELETE 已 commit 的 partial（complete 行 segment_id=NULL 不受
                # 影响），让 DB 只剩完整行。
                # quick 投影统一标记制（2026-09-02）：partial 从不投影（完整行统一
                # 抽段），载体 run 无投影 partial 可回退——影子行回退照旧即可。
                await self._revoke_committed_partials(agent_run_id, segment_id)
                # task-02 / FR-02 / D-003：override 撤回令箭从「截断不发」改为「publish
                # 到 SSE 但不落库」。前端收到 stale=True 信号后按 segmentId 精确撤回已渲染
                # 的半截，消除实时流「半截+全文」重复。INSERT 与 publish 已解耦（本方法
                # 返回纯标量 PublishIntent，router commit 后调 publish_submitted_messages
                # 真正 publish），故 override envelope 直接 append 到 published_logs 即复用
                # 现成两路 publish（agent_run channel + session channel），无需 helper。
                # envelope 不进 log_entry 构造、不 session.add → agent_run_logs 无 override
                # 行，历史回显保持干净（保留 task-14 override 不污染历史的设计）。
                # P2：必须补全 session_payload(:168) 直取的 4 个 key（log_id/channel/
                # content/timestamp），否则 publish_submitted_messages KeyError。
                published_logs.append(
                    {
                        "log_id": None,
                        "channel": "stdout",
                        "content": content,
                        "timestamp": now.isoformat().replace("+00:00", "Z"),
                        # task-02：被撤回的 segmentId（取循环变量 segment_id，override
                        # 行 metadata.segmentId 即是目标 segment）。
                        "segment_id": segment_id,
                        "stale": True,
                        # 归属四字段走 .get() 容错（override 行无需归属，保留 None）。
                        "parent_tool_use_id": msg.get("parent_tool_use_id")
                        if isinstance(msg, dict)
                        else None,
                        "subagent_type": msg.get("subagent_type")
                        if isinstance(msg, dict)
                        else None,
                        "depth": msg.get("depth") if isinstance(msg, dict) else None,
                        "tool_kind": msg.get("tool_kind") if isinstance(msg, dict) else None,
                    }
                )
                continue

            # task-08 / D-002@v1：识别 [ASSISTANT_OVERRIDE] <segmentId> 信号 —— daemon
            # task-05/06/07 在完整 assistant message 到达后 emit 该信号，通知"该 segment
            # 已被完整 message 覆盖"，让 backend 删同 segmentId 的 assistant partial
            # （对齐 [THINKING_OVERRIDE] :378-394 模板，消除 #35 双发）。信号本身不落库
            # （continue 跳过 INSERT + publish），仅把 segmentId 加入 completed_segments
            # 兜底后续乱序 late partial。daemon [ASSISTANT_OVERRIDE] metadata 不含
            # thinking:True（assistant 专属），segmentId 用 daemon 格式
            # （${prefix}:${mid}:${blockIndex}）与 daemon partial 行 metadata.segmentId
            # 一致，命中删除路径。
            if (
                isinstance(content, str)
                and content.startswith("[ASSISTANT_OVERRIDE] ")
                and segment_id
            ):
                completed_segments.add(segment_id)
                # 若同 segment 的 assistant partial 已 flush（pending 未 commit），回退
                # 保持 DB 真相一致。对齐 thinking 模板：用 expunge 撤销待插入
                # （session.delete 要求对象已 persisted，会抛 InvalidRequestError）。
                stale = flushed_partials.pop(segment_id, None)
                if stale is not None:
                    self._session.expunge(stale)
                    count -= 1
                    published_logs = [p for p in published_logs if p["log_id"] != str(stale.id)]
                # task-14：跨 submit_messages 调用——assistant partial 已在先前调用 commit
                # 落库（半截先到、完整+override 后到的真实流式顺序），本调用局部
                # flushed_partials 查不到。按 segment_id DELETE 已落库 partial，
                # 让 DB 只剩完整行（消除 #35 累积重复）。对齐 thinking override 同款 DELETE。
                # quick 投影统一标记制（2026-09-02）：载体 run 无投影 partial 可回退
                # （partial 从不投影），影子行回退照旧。
                await self._revoke_committed_partials(agent_run_id, segment_id)
                # task-02 / FR-02 / D-003：override 撤回令箭 publish 到 SSE 但不落库（对齐
                # 上面 [THINKING_OVERRIDE] 分支的改法）。前端据 stale=True + segment_id
                # 撤回已渲染的 assistant 半截。envelope 直接 append published_logs 跳
                # INSERT / log_entry 构造（INSERT 与 publish 已解耦），复用现成两路 publish。
                # P2：补全 session_payload(:168) 直取的 4 个 key，否则 KeyError。
                published_logs.append(
                    {
                        "log_id": None,
                        "channel": "stdout",
                        "content": content,
                        "timestamp": now.isoformat().replace("+00:00", "Z"),
                        "segment_id": segment_id,
                        "stale": True,
                        "parent_tool_use_id": msg.get("parent_tool_use_id")
                        if isinstance(msg, dict)
                        else None,
                        "subagent_type": msg.get("subagent_type")
                        if isinstance(msg, dict)
                        else None,
                        "depth": msg.get("depth") if isinstance(msg, dict) else None,
                        "tool_kind": msg.get("tool_kind") if isinstance(msg, dict) else None,
                    }
                )
                continue

            # ql-20260617-001：usage / session_id 在每条 message 顶层（daemon 透传），
            # 与 content 是否为空无关，全部提取。
            usage = msg.get("usage")
            if isinstance(usage, dict):
                in_tok = usage.get("input_tokens")
                out_tok = usage.get("output_tokens")
                # task-07：prompt cache 词元（Claude cache_read/cache_creation；
                # codex/OpenAI 无 cache → None → 跳过）。对齐 input/output 的
                # max 累积（service.py:69-72 乱序防御注释）。
                cache_read_tok = usage.get("cache_read_tokens")
                cache_creation_tok = usage.get("cache_creation_tokens")
                # task-05 / FR-01：ctx_tokens——最近一次调用提示词大小（daemon
                # message_start 三分量求和，仅 main 桶注入）。last-write-wins：
                # 批内最后出现值胜出直接赋值（非 max）；缺键（老 daemon / 子桶
                # pendingUsage）→ isinstance 守卫不命中 → None 不写，天然兼容。
                ctx_tok = usage.get("ctx_tokens")
                # ql-20260705-001：接受 0（Claude prompt cache 全命中时 input_tokens
                # 合法为 0，真实输入在 cache_read_tokens）。旧 >0 守卫把合法 0 当噪声
                # 丢，致 AgentRun.input_tokens 永久 NULL。改由 max 累积 + 仅增不减写回
                # （service.py:478-501）防御中间事件 0/0 —— 0 不拉低已有非零值。
                if isinstance(in_tok, (int, float)):
                    latest_input_tokens = max(latest_input_tokens or 0, int(in_tok))
                if isinstance(out_tok, (int, float)):
                    latest_output_tokens = max(latest_output_tokens or 0, int(out_tok))
                if isinstance(cache_read_tok, (int, float)):
                    latest_cache_read_tokens = max(
                        latest_cache_read_tokens or 0, int(cache_read_tok)
                    )
                if isinstance(cache_creation_tok, (int, float)):
                    latest_cache_creation_tokens = max(
                        latest_cache_creation_tokens or 0, int(cache_creation_tok)
                    )
                if isinstance(ctx_tok, (int, float)):
                    latest_ctx_tokens = int(ctx_tok)
            msg_session_id = msg.get("session_id")
            if isinstance(msg_session_id, str) and msg_session_id:
                latest_session_id = msg_session_id

            if not content:
                # 无 content 的 message（理论上 daemon 不产生）跳过日志写入，
                # 但 usage / session_id 已在上面提取。
                continue

            # task-12 去重判定 1：完整行到达时，若同 segment 的 partial 已落库，
            # 回退旧 partial（撤销 pending INSERT + 从 published_logs 移除），然后
            # 照常 INSERT 完整行。对应验收点"partial + 完整同 segment 时只落库完整
            # 行"。仅 thinking 完整行（is_partial=False 且有 segment_id）触发。
            # quick 投影统一标记制（2026-09-02）：投影 partial 不存在（partial
            # 从不投影），影子行回退照旧即可。
            if segment_id and not is_partial and segment_id in flushed_partials:
                stale = flushed_partials.pop(segment_id)
                # 对象仅 session.add（pending，未 commit），expunge 撤销待插入即可
                # （不写库）。session.delete 要求对象已 persisted 会抛错，故走 expunge。
                self._session.expunge(stale)
                count -= 1
                published_logs = [p for p in published_logs if p["log_id"] != str(stale.id)]

            # task-12 去重判定 2：partial 到达时，若同 segment 已见完整行 / override
            # 信号（completed_segments 命中），直接跳过 INSERT + publish（late partial
            # 场景，乱序兜底）。
            if segment_id and is_partial and segment_id in completed_segments:
                continue

            # quick-0e56260f 去重判定 3（跨调用）：partial 到达时，若该 segment 的
            # 完整行已在先前调用处理过（override 标记行已 commit），跳过 INSERT +
            # publish——堵「完整行调用跑完 DELETE 后 partial 事务才提交」的并发
            # 竞态（会话 0ef651b6 实证：partial 03:30:45.437 开始处理、full
            # 03:30:45.580，full 的跨调用 DELETE 查不到未提交的 partial，擦肩留库），
            # 也拦 daemon 重试迟到的同 segmentId 窗口。
            if (
                segment_id
                and is_partial
                and await self._override_marker_exists(agent_run_id, segment_id)
            ):
                continue

            # task-21 / FR-08：dedup_key 幂等——已存在的 (run_id, dedup_key) 跳过 INSERT
            # （daemon 重试/outbox 补发的重复消息）。无 dedup_key 的消息照常 append（NULL 不约束）。
            dedup_key = msg.get("dedup_key") if isinstance(msg, dict) else None
            if dedup_key is not None:
                dedup_key = str(dedup_key)
                if dedup_key in existing_dedup_keys:
                    continue
                existing_dedup_keys.add(dedup_key)

            log_id = uuid.uuid4()
            # 2026-07-05-agent-log-type-tags task-04 / FR-05：batch 路径 tool_kind
            # 兜底落库。优先 msg.get("tool_kind")（新 daemon 已带，含 _extract_sdk_messages
            # 主路径打标值）；缺则仅对 channel=='tool_call' 行 JSON.parse(content)
            # 取 tool/args 调 classify_tool_kind 兜底（旧 daemon 无 tool_kind 字段时启用）。
            # stdout 文本行（[TOOL_USE]/[ASSISTANT]/...）不兜底（tool_kind=None），
            # design §5 Phase 2 明确：DB 列层面只 tool_call 行有值。
            # 防御：classify_tool_kind 在 bash + args.command 非 str 时会抛 TypeError
            # （Python 版未强转），JSON.parse 失败也会抛；统一 try/except 静默退 None，
            # 不阻塞落库（design §6 / R-08）。
            tool_kind = msg.get("tool_kind") if isinstance(msg, dict) else None
            if tool_kind is None and channel == "tool_call":
                try:
                    parsed = json.loads(content) if isinstance(content, str) and content else {}
                    if isinstance(parsed, dict):
                        tool_kind = classify_tool_kind(
                            parsed.get("tool"),
                            parsed.get("args") if isinstance(parsed.get("args"), dict) else None,
                        )
                except Exception:
                    tool_kind = None
            else:
                # msg.get 优先命中（含 _extract_sdk_messages 注入值 + 新 daemon 直传）；
                # 显式归一 None，避免下游 publish 拿到非预期类型。
                tool_kind = tool_kind if isinstance(tool_kind, str) and tool_kind else None

            # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：sillyspec
            # 命令收集（仅 tool_kind=sillyspec 且 channel=tool_call 的**入库**行
            # 触发——dedup 跳过 / override 信号行已在上方 continue，不进本分支，
            # R-03 禁全量消息扫描）。content 两路径同构：batch 为 daemon tc_content
            # JSON，interactive 为 _extract_sdk_messages 产出的 {"tool","args",...}
            # JSON，均取 json.loads(content)["args"]["command"]；解析失败 / 结构
            # 不符静默跳过（不抛错不落绑定）。同命令去重，减少循环后重复解析。
            if channel == "tool_call" and tool_kind == "sillyspec" and isinstance(content, str):
                try:
                    parsed_call = json.loads(content)
                    call_args = parsed_call.get("args") if isinstance(parsed_call, dict) else None
                    raw_command = call_args.get("command") if isinstance(call_args, dict) else None
                    if (
                        isinstance(raw_command, str)
                        and raw_command
                        and raw_command not in sillyspec_commands
                    ):
                        sillyspec_commands.append(raw_command)
                except Exception:
                    # JSON 解析失败等异常静默吞（与上方 classify_tool_kind 兜底同款
                    # 防御口径），不影响落库主流程。
                    pass

            # ql-20260706-002：tool_kind 跨消息继承——tool_result（命令输出 stdout 行）
            # 继承配对 tool_use（命令调用 tool_call 行）的 tool_kind。tool_use 行
            # （带 tool_kind + tool_use_id）登记 id→kind 缓存；tool_result 行（stdout，
            # 无 tool_kind）按自带 tool_use_id 回查补 kind。让 stdout 的 [TOOL_RESULT]
            # 行也带 tool_kind，前端第二层筛选命中 sillyspec 步骤进度等命令输出
            # （d751a871 根因）。batch mode 扁平 [TOOL_RESULT] 文本行无 tool_use_id
            # → msg.get 返回 None → 跳过，行为不变；tool_use_id 在缓存缺失时也跳过。
            _msg_tuid = msg.get("tool_use_id") if isinstance(msg, dict) else None
            if isinstance(_msg_tuid, str) and _msg_tuid:
                if event_type == "tool_use" and tool_kind:
                    tool_kind_by_tool_use_id[_msg_tuid] = tool_kind
                elif event_type == "tool_result" and not tool_kind:
                    _inherited = tool_kind_by_tool_use_id.get(_msg_tuid)
                    if isinstance(_inherited, str) and _inherited:
                        tool_kind = _inherited

            # task-06 / FR-05 / D-003@v1：跨轮归位——带 parent_tool_use_id 的行
            # （后台子代理输出 / [TASK_*] 行，经同 session 后续 run 上报）run_id
            # 归写**派发 run**，消除前端孤儿 stub。两级映射：进程级 LRU → 冷启动
            # 反查 agent_run_logs；仍失败保持当前 run_id 兜底不抛错（design §5
            # P2.2）。batch run（attribution_session_id=None）/ 主 agent 行（无
            # parent）不经本分支，行为不变。
            parent_tuid = msg.get("parent_tool_use_id") if isinstance(msg, dict) else None
            effective_run_id = agent_run_id
            if isinstance(parent_tuid, str) and parent_tuid and attribution_session_id is not None:
                lru_key = (attribution_session_id, parent_tuid)
                dispatch_run_id = _tool_use_run_lru.get(lru_key)
                if dispatch_run_id is None and lru_key not in cold_lookup_misses:
                    # LRU 未命中且本调用内未查过 → 冷启动反查；失败记入局部集合，
                    # 同一 parent id 的后续行不再重复打 DB（一次 submit 常含多行）。
                    dispatch_run_id = await self._resolve_dispatch_run_id(
                        attribution_session_id, parent_tuid
                    )
                    if dispatch_run_id is not None:
                        _tool_use_run_lru.put(lru_key, dispatch_run_id)
                    else:
                        cold_lookup_misses.add(lru_key)
                        log.debug(
                            "daemon_messages_parent_dispatch_lookup_miss",
                            agent_run_id=str(agent_run_id),
                            agent_session_id=str(attribution_session_id),
                            parent_tool_use_id=parent_tuid,
                        )
                if dispatch_run_id is not None:
                    effective_run_id = dispatch_run_id

            # task-06 / FR-05：assistant tool_use 行（channel=tool_call 的 JSON 卡）
            # 落库时登记 (session_id, tool_use_id) → 本行 run_id，供后续 parent 行
            # 归位命中热路径。登记值用 effective_run_id（归位后的落库 run）而非
            # 上报 run——嵌套子代理（孙代）的 parent 是子代 tool_use，其行已归位
            # 到派发 run，孙代据此同样归位，两层语义一致。interactive 路径
            # tool_use_id 在 flat record 顶层；batch 路径（旧 daemon）仅在 content
            # JSON 内，兜底解析（解析失败静默跳过，不阻塞落库）。
            if channel == "tool_call" and attribution_session_id is not None:
                dispatch_reg_tuid = _msg_tuid if isinstance(_msg_tuid, str) and _msg_tuid else ""
                if not dispatch_reg_tuid and isinstance(content, str) and content:
                    try:
                        parsed_reg = json.loads(content)
                        reg_val = (
                            parsed_reg.get("tool_use_id") if isinstance(parsed_reg, dict) else None
                        )
                        dispatch_reg_tuid = reg_val if isinstance(reg_val, str) and reg_val else ""
                    except Exception:
                        dispatch_reg_tuid = ""
                if dispatch_reg_tuid:
                    _tool_use_run_lru.put(
                        (attribution_session_id, dispatch_reg_tuid), effective_run_id
                    )

            log_entry = AgentRunLog(
                id=log_id,
                run_id=effective_run_id,
                timestamp=now,
                channel=channel,
                # ql-20260626-001 放宽（原 5000 截断 agent 长答复/总结）
                content_redacted=content[:50000],
                dedup_key=dedup_key,
                # 2026-06-28-daemon-subagent-transcript task-09 / FR-07：归属三列。
                # daemon session-manager 注入 msg.depth（D-007）+ SDK 顶层
                # parent_tool_use_id/subagent_type，_extract_sdk_messages（task-08）透传到
                # 每条 flat record；此处读出落库。主 agent / 未升级 daemon → None
                # （brownfield，design §9）。msg 是 flat record（submit_messages 循环变量）。
                parent_tool_use_id=msg.get("parent_tool_use_id") if isinstance(msg, dict) else None,
                subagent_type=msg.get("subagent_type") if isinstance(msg, dict) else None,
                depth=msg.get("depth") if isinstance(msg, dict) else None,
                # task-04 / FR-04 FR-05：tool_kind 落库列（_extract_sdk_messages 主路径
                # 或 JSON.parse 兜底；stdout 行为 None）。
                tool_kind=tool_kind,
                # task-14 / FR-02：partial 行持久化 segment_id 供 override 跨调用 DELETE；
                # complete 行（is_partial=False）写 None，DELETE by segment_id 不误删完整行。
                segment_id=segment_id if is_partial else None,
                # ql-20260824-020：Edit structuredPatch JSON（_extract_sdk_messages 注入
                # flat record），落库供 REST 历史 + SSE 实时两路透传前端 diff 真实行号。
                edit_patch=msg.get("edit_patch") if isinstance(msg, dict) else None,
            )
            self._session.add(log_entry)
            count += 1
            published_logs.append(
                {
                    "log_id": str(log_id),
                    "channel": channel,
                    "content": content[:50000],  # ql-20260626-001 同 DB 放宽
                    "timestamp": now.isoformat().replace("+00:00", "Z"),
                    # 2026-06-28-daemon-subagent-transcript task-09 / FR-08：归属三列
                    # 透传到 SSE 实时流——run channel publish 整个 payload，session
                    # channel（publish_submitted_messages）也取这三字段。让前端实时
                    # 流（不经 DB 查询）也能渲染子代理归属，与 DB 查询路径一致。
                    "parent_tool_use_id": log_entry.parent_tool_use_id,
                    "subagent_type": log_entry.subagent_type,
                    "depth": log_entry.depth,
                    # 2026-07-05-agent-log-type-tags task-04 / FR-06 / R-08：tool_kind
                    # 透传到 SSE 实时流（run channel）。前端实时日志行渲染工具徽标 +
                    # 第二层筛选需此字段，DB 列与实时流保持一致。
                    "tool_kind": log_entry.tool_kind,
                    # task-01 / D-003 / FR-01：segment_id 透传到 SSE 实时流（run channel）。
                    # **必须用 log_entry.segment_id**（complete 行为 None），切勿用循环顶部
                    # 局部变量 segment_id（它取自 metadata.segmentId，complete 行也非 None，
                    # 会让前端误判 complete 全文为半截触发错误撤回）。partial 行非空
                    # "main:msg_xxx:N"，complete/其他行 None。前端据「非空」识别半截。
                    "segment_id": log_entry.segment_id,
                    # ql-20260824-020：edit_patch 透传到 SSE 实时流（run channel），
                    # 与 DB 列一致；非 Edit 结果行为 None。
                    "edit_patch": log_entry.edit_patch,
                }
            )

            # task-05（design §5.2 改动点①）+ quick 投影统一标记制（2026-09-02）：
            # 群桥接双写投影行——影子行落库后同事务插投影行到群载体 run（仅本轮
            # run 自身的 assistant 文本段：effective_run_id!=agent_run_id 的后台子
            # 代理归位行属过程信息不投影；thinking/tool/stderr/系统行由
            # is_group_projectable_reply 过滤）。**@轮与直聊轮同款标记制**：完整
            # assistant 文本仅 [[GROUP]] 标记段投影（标记剥离只投内容、同轮多段
            # 各成一行保序；段外推理过程/工具细节只留影子会话）；partial 半截行
            # 不解析（标记可能被流式截断，完整行到达统一抽段，免半截投影+撤回
            # 抖动——partial 因此从不投影，投影行 segment_id 恒 None）。dedup_key
            # =None：同源多段共享 dedup_key 会撞载体 run 的 (run_id, dedup_key)
            # 部分唯一索引。@轮整轮无标记的「群里死寂」由 close_interactive_run
            # 的兜底行补齐（见 _emit_group_mention_projection_fallback）。
            if (
                group_bridge is not None
                and effective_run_id == agent_run_id
                and is_group_projectable_reply(channel, content)
                and not log_entry.segment_id
                and isinstance(content, str)
            ):
                for seg_idx, seg_text in enumerate(extract_group_broadcast_segments(content)):
                    projection_row = self._build_group_projection_row(
                        group_bridge,
                        source_row=log_entry,
                        dedup_key=None,
                        content_override=seg_text,
                        timestamp_override=now + timedelta(microseconds=seg_idx),
                    )
                    self._session.add(projection_row)
                    group_projection_events.append(
                        {
                            "log_id": str(projection_row.id),
                            "content": seg_text,
                            "timestamp": now.isoformat().replace("+00:00", "Z"),
                        }
                    )
                    last_projection_log_id = str(projection_row.id)

            # 登记本 segment 的状态：
            # - partial 行：记入 flushed_partials，等完整行到达时回退。
            # - 完整行：加入 completed_segments，让本调用内后到的同 segment partial
            #   被跳过（完整先到、partial 后到的乱序兜底）。
            if segment_id and is_partial:
                flushed_partials[segment_id] = log_entry
            elif segment_id and not is_partial:
                completed_segments.add(segment_id)
                # quick-9f86d2c3（会话 e87622aa）：完整行跨调用清理——interactive
                # 流式真实顺序是「partial 已在前次 submit_messages commit、完整行
                # 本次到达」，判定 1（同调用 expunge）够不到已 commit 行。按
                # segment_id DELETE 已落库 partial（complete 行 segment_id 恒 NULL
                # 不受影响），DB 收敛「只剩完整行」——轮后对账 / 断线重放不再把
                # 半截行复活成直播重复段（daemon override 信号生产环境未观测到
                # 到达，本清理不依赖它）。对齐 override 分支同款 DELETE。
                await self._revoke_committed_partials(agent_run_id, segment_id)
                # quick 投影统一标记制（2026-09-02）：载体 run 无投影 partial 可
                # DELETE（partial 从不投影、投影行 segment_id 恒 None），下方合成
                # stale 令箭只发 run/session 频道（群频道零进入）。
                # quick-0e56260f（会话 0ef651b6）：backend 合成 override 撤回信号。
                # 动机：直播期 partial 窗口经 Redis 发布是 best-effort，部分窗口
                # 丢失后前端按到达顺序拼出「乱序胶水段」（非完整行前缀），全部
                # 前缀收编失效 → 重复段；且 daemon 信号生产从未到达（见已知问题）。
                # backend 在完整行落库点确知 segmentId，就地补发令箭：
                #   ① 落一行标记（content=override 令箭、segment_id=NULL 防 revoke
                #      误删）——跨调用竞态守护（见 _override_marker_exists）+ 完整行
                #      实时发布丢失时轮后对账重放补投，前端据令箭按段 id 任意位置
                #      撤回乱序胶水段（不依赖前缀判定）；
                #   ② published_logs 追加同形信封（stale=True），实时直播立即治愈。
                # 格式与 daemon 信号（task-07）逐字节一致，前端 OVERRIDE_RE /
                # 撤回链路零改动；标记行在历史回放被分类为 override 不渲染，
                # 「历史干净」语义保持（仅多一行不可见行）。不计入 count（count
                # 语义=内容消息数）。message.id 缺失的退化段（mid=unknown）跳过
                # ——daemon 退化 partial 用 runId:thinking 格式永不对齐，标记无用。
                if ":unknown:" not in segment_id:
                    marker_thinking = isinstance(content, str) and content.startswith("[THINKING]")
                    marker_content = self._override_marker_content(segment_id, marker_thinking)
                    marker_id = uuid.uuid4()
                    self._session.add(
                        AgentRunLog(
                            id=marker_id,
                            run_id=agent_run_id,
                            timestamp=now,
                            channel="stdout",
                            content_redacted=marker_content,
                            dedup_key=None,
                            parent_tool_use_id=msg.get("parent_tool_use_id")
                            if isinstance(msg, dict)
                            else None,
                            subagent_type=msg.get("subagent_type")
                            if isinstance(msg, dict)
                            else None,
                            depth=msg.get("depth") if isinstance(msg, dict) else None,
                            tool_kind=None,
                            segment_id=None,
                            edit_patch=None,
                        )
                    )
                    published_logs.append(
                        {
                            "log_id": str(marker_id),
                            "channel": "stdout",
                            "content": marker_content,
                            "timestamp": now.isoformat().replace("+00:00", "Z"),
                            "segment_id": segment_id,
                            "stale": True,
                            "parent_tool_use_id": msg.get("parent_tool_use_id")
                            if isinstance(msg, dict)
                            else None,
                            "subagent_type": msg.get("subagent_type")
                            if isinstance(msg, dict)
                            else None,
                            "depth": msg.get("depth") if isinstance(msg, dict) else None,
                            "tool_kind": None,
                        }
                    )

        # Sync AgentRun status: pending -> running on first messages
        # task-06：agent_run 已在落库循环前 get（归位需要 agent_session_id），此处
        # 复用同一对象（identity map），无额外查询。
        agent_run_status: str | None = None
        if agent_run is not None:
            agent_run_status = agent_run.status
            if agent_run.status == "pending":
                # 原子条件 UPDATE：只在 DB 当前仍为 pending 时推进 running。
                # submit_messages 与 close_interactive_run 并发时，迟到的协程可能
                # 持有旧快照（仍读到 pending），直接 ORM 内存写 status=running 会
                # 覆盖 close 已 commit 的 completed 终态（lost update → run 卡
                # running，前端一直"等待本轮完成"）。WHERE status='pending' 让已进入
                # 终态的 run 不被覆盖；rowcount=0 即已被别处推进，跳过本协程激活。
                activated = await self._session.execute(
                    update(AgentRun)
                    .where(AgentRun.id == agent_run_id, AgentRun.status == "pending")
                    .values(status="running", started_at=now)
                )
                if activated.rowcount:
                    agent_run.status = "running"
                    agent_run.started_at = now
                    agent_run_status = "running"
                    self._session.add(agent_run)
                    log.info(
                        "daemon_messages_agent_run_activated",
                        agent_run_id=str(agent_run_id),
                        lease_id=str(lease_id),
                    )
            # ql-20260616-004：实时 token 写回。仅在数值增大时覆盖（防御乱序），
            # 让前端 5s 轮询拿到中间过程的累积 token，不必等 result 事件汇总。
            if latest_input_tokens is not None and (
                agent_run.input_tokens is None or latest_input_tokens > agent_run.input_tokens
            ):
                agent_run.input_tokens = latest_input_tokens
                self._session.add(agent_run)
            if latest_output_tokens is not None and (
                agent_run.output_tokens is None or latest_output_tokens > agent_run.output_tokens
            ):
                agent_run.output_tokens = latest_output_tokens
                self._session.add(agent_run)
            # task-07：cache 词元实时写回（仅增不减，对齐上面 input/output max
            # 守卫）。前端 5s 轮询即可拿到累积 cache，不必等 result 事件汇总。
            if latest_cache_read_tokens is not None and (
                agent_run.cache_read_tokens is None
                or latest_cache_read_tokens > agent_run.cache_read_tokens
            ):
                agent_run.cache_read_tokens = latest_cache_read_tokens
                self._session.add(agent_run)
            if latest_cache_creation_tokens is not None and (
                agent_run.cache_creation_tokens is None
                or latest_cache_creation_tokens > agent_run.cache_creation_tokens
            ):
                agent_run.cache_creation_tokens = latest_cache_creation_tokens
                self._session.add(agent_run)
            # task-05 / FR-01 / design §7 守卫差异：ctx_tokens 实时写回——
            # last-write-wins 直接赋值（瞬时量可上可下），刻意不做上面
            # input/output/cache_* 的仅增不减守卫。close_interactive_run 终态
            # 不触碰该列（SDK result 无 per-call 拆分，保留实时最后写入值）。
            if latest_ctx_tokens is not None:
                agent_run.ctx_tokens = latest_ctx_tokens
                self._session.add(agent_run)
            # ql-20260617-001：session_id 实时写回（首次拿到就填，complete_lease 仍可覆盖）。
            if latest_session_id and not agent_run.session_id:
                agent_run.session_id = latest_session_id
                self._session.add(agent_run)
            # 2026-08-21-session-reopen-resume task-01 / DS-1 / FR-01：增量回填
            # AgentSession.agent_session_id（SDK resume key，reopen 硬依赖该列）。
            # 与上面 AgentRun.session_id 的「仅空时写」（D-001@v1）语义刻意不同 ——
            # 会话列做**最新值覆盖**：fork/reload 后 SDK 换新 id，旧 key resume 会
            # 回到分叉前历史，语义错误。守卫：仅 interactive run（agent_session_id
            # 会话 FK 非空）；batch run 该 FK 为 None，不触碰 agent_sessions 表。
            # 并发语义：最终一致（以最后到达消息为准），乱序迟到的旧 id 短暂回退
            # 由同会话下一次上报自愈（design DS-1 审查修订，不加去重复杂度）。
            # 事务：与消息落库走同一 commit()（含 IntegrityError 幂等回滚分支）。
            if latest_session_id and agent_run.agent_session_id is not None:
                # task-05 注：AgentSession 已提到模块顶部 import（下方 sillyspec
                # 绑定块也要用）；此处原局部 import 会把名字变函数局部作用域，
                # 导致绑定块引用 UnboundLocalError，故移除。
                session_row = await self._session.get(AgentSession, agent_run.agent_session_id)
                # get 返回 None（理论不应发生：会话行在 create_session 的 commit 后
                # 必然已存在）静默跳过；值相同不写（避免无谓 dirty）。
                if session_row is not None and session_row.agent_session_id != latest_session_id:
                    session_row.agent_session_id = latest_session_id
                    self._session.add(session_row)

            # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：sillyspec
            # 命令自动绑定——落库循环收集的命令经 run 二跳定位平台会话
            # （AgentRun.agent_session_id → AgentSession.workspace_id）后，走
            # change/binding 公共入口落 change_session_links（design §5 W2.1 /
            # §7.5 生命周期契约表第 1 行；禁止在 run_sync 重复实现 placeholder /
            # default 守卫 / savepoint）。守卫（X-002）：agent_session_id 为 None
            # （batch run 无会话 / 会话被删 FK 置空）、会话行不存在或会话无
            # workspace_id → 静默跳过全部绑定，消息照常入库。绑定全程 best-effort：
            # bind 函数自带 savepoint + log.warning 不抛（task-02 契约），外层再兜
            # try/except，任何异常不阻断 AgentRunLog 落库与 SubmittedMessages 返回；
            # 不自行 commit，跟随本方法末尾既有 commit 事务边界。
            if sillyspec_commands and agent_run.agent_session_id is not None:
                binding_session_row = await self._session.get(
                    AgentSession, agent_run.agent_session_id
                )
                if binding_session_row is not None and binding_session_row.workspace_id is not None:
                    for sillyspec_command in sillyspec_commands:
                        # extract_spec_bindings 解析规则：quick 子命令 / 非 run 子
                        # 命令无产出（D-004），--change default 解析层跳过 + bind
                        # 函数内兜底双保险（D-005@v2）。
                        for spec_binding in extract_spec_bindings(sillyspec_command):
                            try:
                                await bind_session_to_change(
                                    self._session,
                                    binding_session_row.workspace_id,
                                    spec_binding.change_key,
                                    binding_session_row.id,
                                )
                            except Exception as exc:
                                # 外层兜底：bind 自身已 best-effort，此处仅防御
                                # 意外（如 ORM 状态异常），绑定失败不影响消息入库。
                                log.warning(
                                    "daemon_messages_spec_bind_failed",
                                    agent_run_id=str(agent_run_id),
                                    change_key=spec_binding.change_key,
                                    error=str(exc),
                                )

        # QueuePool 修复 3：commit 前从 agent_run 提取 publish 所需标量。commit()
        # 后 SQLAlchemy 默认 expire_on_commit 会令 ORM 属性失效，再读会触发 lazy
        # reload 重新占用 DB 连接——违背"publish 移出 session 生命周期"的目的。
        # 提前取好，PublishIntent 只含标量，publish 时完全不碰 session/连接。
        publish_input_tokens = agent_run.input_tokens if agent_run is not None else None
        publish_output_tokens = agent_run.output_tokens if agent_run is not None else None
        # ql-cache：prompt cache 词元同步提取（对齐 input/output），供 publish 实时透传。
        publish_cache_read_tokens = agent_run.cache_read_tokens if agent_run is not None else None
        publish_cache_creation_tokens = (
            agent_run.cache_creation_tokens if agent_run is not None else None
        )
        # task-05 / FR-01：ctx_tokens 同步提取（对齐 input/output），供 publish
        # 实时透传（run channel summary + session channel tokens 事件）。
        publish_ctx_tokens = agent_run.ctx_tokens if agent_run is not None else None
        publish_session_id = agent_run.agent_session_id if agent_run is not None else None

        if count > 0 or (agent_run is not None and agent_run_status == "running"):
            # QueuePool 修复 2：dedup 竞态下 (run_id, dedup_key) 唯一约束冲突会令
            # session 中毒（事务未结束、连接不归还 → QueuePool 耗尽）。捕获
            # IntegrityError → rollback，视为幂等成功：daemon ResilienceService 会
            # 重试/outbox 补发，前端实时流容忍丢失/重复。继续用已构造的
            # published_logs 走 publish（count 不变）。
            try:
                await self._session.commit()
            except IntegrityError:
                await self._session.rollback()
                log.warning(
                    "daemon_messages_commit_integrity_conflict",
                    lease_id=str(lease_id),
                    agent_run_id=str(agent_run_id),
                    count=count,
                )

        log.info(
            "daemon_messages_submitted",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            count=count,
            agent_run_status=agent_run_status,
        )
        # QueuePool 修复 3：不再在持有 session 的 service 内 publish。返回纯标量
        # PublishIntent，router 在 session commit/归还连接后调用
        # publish_submitted_messages 执行 Redis pub/sub（Redis 卡死不再拖垮连接池）。
        return SubmittedMessages(
            count,
            published_logs,
            PublishIntent(
                agent_run_id=agent_run_id,
                lease_id=lease_id,
                count=count,
                published_logs=published_logs,
                agent_run_status=agent_run_status,
                input_tokens=publish_input_tokens,
                output_tokens=publish_output_tokens,
                cache_read_tokens=publish_cache_read_tokens,
                cache_creation_tokens=publish_cache_creation_tokens,
                ctx_tokens=publish_ctx_tokens,
                agent_session_id=publish_session_id,
                timestamp_iso=now.isoformat().replace("+00:00", "Z"),
                # task-05：群桥接标量快照（事务内已解析的群上下文 + 最后投影行 id）。
                # 非群场景 group_id=None → publish_submitted_messages 群分支零进入。
                group_id=group_bridge.group_id if group_bridge is not None else None,
                member_id=group_bridge.member_id if group_bridge is not None else None,
                member_name=group_bridge.member_name if group_bridge is not None else None,
                member_session_id=(
                    group_bridge.member_session_id if group_bridge is not None else None
                ),
                projection_log_id=last_projection_log_id,
                # quick 影子直聊：直聊投影模式 + [[GROUP]] 段事件（群分支消费）。
                shadow_direct=group_bridge.shadow_direct if group_bridge is not None else False,
                group_projection_events=group_projection_events,
            ),
        )

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        """Sync AgentRun status from daemon side.

        Validates the lease + claim_token, locates the associated AgentRun,
        updates its status and timestamps, and publishes a Redis event.

        Returns the updated AgentRun, or None if no AgentRun is linked.

        终态守卫（2026-08-25 会话审查 P1）：run 已处于终态
        （completed/failed/killed）时忽略非终态回退——迟到的 ``running`` 上报
        （daemon 重试 / 网络延迟）不得把已收口的 run 复活回 running；同值重发
        幂等放行（finished_at 等字段仅在为 None 时补写，重发无副作用）。
        """
        lease = await self._facade._get_lease_and_verify_token(lease_id, claim_token)

        if lease.agent_run_id is None:
            log.warning(
                "daemon_sync_no_agent_run",
                lease_id=str(lease_id),
            )
            return None

        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            raise DaemonAgentRunNotFound(
                f"AgentRun '{lease.agent_run_id}' not found for lease '{lease_id}'.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(lease.agent_run_id),
                },
            )

        # 终态守卫：已终态的 run 收到非终态（running）回退 → 记 warning 并按
        # 幂等处理直接返回当前行，不落库、不发布（迟到上报不复活终态）。
        if agent_run.status in TERMINAL_TURN_STATUSES and status not in TERMINAL_TURN_STATUSES:
            log.warning(
                "daemon_sync_terminal_run_regression_ignored",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
                current_status=agent_run.status,
                incoming_status=status,
            )
            return agent_run

        now = datetime.now(UTC)
        agent_run.status = status

        if status == "running" and agent_run.started_at is None:
            agent_run.started_at = now
        if status in ("completed", "failed", "killed") and agent_run.finished_at is None:
            agent_run.finished_at = now
        if status == "killed" and agent_run.exit_code is None:
            agent_run.exit_code = -1
        if error is not None and status == "failed":
            agent_run.output_redacted = error

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

        # Publish status change via Redis
        try:
            redis = get_redis()
            redis_payload: dict = {
                "event": "status_changed",
                "status": status,
                "lease_id": str(lease_id),
                "agent_run_id": str(agent_run.id),
            }
            if error is not None:
                redis_payload["error"] = error
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(redis_payload),
            )
        except Exception:
            log.warning(
                "daemon_sync_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
            )

        log.info(
            "daemon_agent_run_status_synced",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=status,
            error=error,
        )
        return agent_run

    async def _is_gate_rejected_first_failure(
        self, agent_run: AgentRun, session: AgentSession
    ) -> bool:
        """task-06 / FR-06 / D-006@v1（Grill M1-R 终版）：闸拒绝失败收口触发面判定。

        daemon 会话闸（task-04 SessionManager.create 抛 SessionLimitReached）拒绝
        的分身子会话：daemon notifyRunResult 标首 run failed 回传，但会话从未
        mark_ready（闸拒绝发生在 create 阶段，daemon 从未上报 ready——探测口径
        对齐 session/service.py :3021 clear 先例）。三条件齐备才命中，缺一不可：

        ① ``run.status == "failed"``（首 run completed 不涉及）；
        ② 首 run——该会话 AgentRun 行数恰 1（即本 run；调用点 pending 写入已
           add，count 查询 autoflush 后本 run 在内，追问轮行数 > 1 不命中）；
        ③ 会话从未 ready（readiness 单例只读直探 ``_ready`` 成员——不建
           ``_events`` 残留槽位）且 ``parent_session_id`` 非空（分身子会话，
           普通用户会话 NULL 不涉及）。

        追问轮中途失败的存活分身（曾 mark_ready / 已有更早 run）、首 run
        completed、parent NULL 普通会话均不命中（触发面收窄防误杀——turn 失败
        ≠会话死亡，P1 原则）。命中由调用方覆写多轮 keep-active 为 failed（对齐
        P1 ``_fail_worker_subsession`` 语义，非 ended），杜绝闸拒绝后子会话占
        daemon 会话额度且 mission 卡死。

        Note: 只读探测（readiness 单例 + 一次 count 查询），不改
        daemon/session/service.py（约束铁律），不修改传入对象。
        """
        if agent_run.status != "failed":
            return False
        if session.parent_session_id is None:
            return False
        if session.id in get_session_readiness()._ready:
            return False
        run_count = await self._session.scalar(
            select(func.count())
            .select_from(AgentRun)
            .where(AgentRun.agent_session_id == session.id)
        )
        return run_count == 1

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
        # ── SDKResultSuccess usage / cost / duration 透传（修复 interactive 路径
        # AgentRun.{total_cost_usd,num_turns,duration_ms,duration_api_ms,
        # input_tokens,output_tokens} 全 NULL 问题）。None 表示 daemon 未传，
        # 保留 AgentRun 原值不覆盖。
        total_cost_usd: float | None = None,
        num_turns: int | None = None,
        duration_ms: int | None = None,
        duration_api_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        # task-07 / FR-02：prompt cache 词元透传（SDKResultSuccess.usage.cache_*）。
        # None=daemon 未传，保留 AgentRun 原值不覆盖（对齐 D-001@v1 codex 无 cache）。
        # 终态一次写入直接覆盖（无 max 守卫，对齐 input/output 终态覆盖模式）。
        cache_read_tokens: int | None = None,
        cache_creation_tokens: int | None = None,
        # task-03（2026-08-29-usage-by-provider-model / FR-01-3 / design §2 §4.1）：
        # daemon 终态上报的逐模型用量明细行（SDK result.modelUsage 拆行；行内
        # api_requests 已由 daemon 按各模型 input+output 占比分摊，各行求和 ==
        # run 级总数——backend 不重复分摊，直接落行）+ run 级 API 调用次数精确值
        # （AgentRun 无该列，精确值只入日志观测，落库承载在明细行）。
        # None/空列表=老 daemon 未传 → 明细零行、run 列不填（N-01 兼容）。
        model_usage: list[ModelUsageItemRead] | None = None,
        api_requests: int | None = None,
        # task-06 / FR-02：daemon classifyModelError 回传的模型层错误。None=daemon
        # 未传（旧 daemon / 成功 run），AgentRun.error_detail 保持 None（design §9）。
        error: ModelErrorDTO | None = None,
    ) -> AgentRun:
        """Close an interactive AgentRun from daemon SDK result (gap-3 / design §4).

        Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → this
        endpoint. The lease is verified via ``claim_token``; the run is located by
        ``run_id`` (interactive lease has ``agent_run_id=NULL`` per D-005@v1, so we
        cannot read it off the lease row) and bound to the lease's session via
        ``lease.metadata.session_id`` to prevent cross-session run injection.

        Terminal mapping (design §4):
          - status=success → AgentRun.status='completed'
          - status=error_during_execution → AgentRun.status='failed'
            (interrupted semantics; error_code='interactive_interrupted')
          - any other is_error → AgentRun.status='failed'
            (error_code='interactive_failed')

        Idempotent: an AgentRun already in TERMINAL_TURN_STATUSES is a no-op
        (returns the row unchanged) so daemon retries after a transient network
        blip do not double-write or flip a completed run back to failed.

        ``cache_read_tokens`` / ``cache_creation_tokens`` (task-07 / FR-02): prompt
        cache 词元，daemon 从 SDKResultSuccess.usage 透传；None 表示 daemon 未传
        （老 daemon / codex 无 cache），保留 AgentRun 原值不覆盖。终态一次写入
        直接覆盖（无 max 守卫），对齐既有 input/output 终态覆盖语义。

        ``model_usage`` (task-03 / 2026-08-29-usage-by-provider-model / FR-01-3):
        daemon 终态上报的逐模型用量明细——事务内同 run 先 DELETE 后 INSERT 全部
        行（等价幂等 upsert by (run_id, model)，design §4.1）；run.model 终态填
        input+output 最大行的 model；run.llm_provider_id **仅空时**填会话当前值
        （dispatch 已按轮写入生效供应商，终态覆盖会造成切供应商竞态错归因，
        R-08）。明细落库 best-effort：savepoint 包裹，失败仅 warn 不阻塞 close。
        None/空列表（老 daemon）→ 零行为变化（N-01）。

        Raises ``DaemonAgentRunNotFound`` when the run does not exist or is not
        bound to the lease's session (resource-hiding 404 — no existence leak).
        """
        lease = await self._facade._get_lease_and_verify_token(lease_id, claim_token)
        lease_meta = lease.metadata_ or {}
        bound_session_id_raw = lease_meta.get("session_id")

        # P1 修复（2026-08-25 会话审查）：FOR UPDATE 行锁读 run——终态判定
        # （下方 TERMINAL 守卫）与终态写入（completed/failed）原子化。原
        # ``self._session.get`` 无锁，并发 end_session 先 commit killed 后，本处
        # 基于未加锁的旧快照（running）过守卫并把 killed 覆写成 completed。
        agent_run = (
            await self._session.execute(
                select(AgentRun).where(AgentRun.id == run_id).with_for_update()
            )
        ).scalar_one_or_none()
        if agent_run is None:
            raise DaemonAgentRunNotFound(
                f"AgentRun '{run_id}' not found for lease '{lease_id}'.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(run_id),
                },
            )

        # Bind check: the run must belong to the lease's session. interactive
        # lease.agent_run_id is NULL (D-005@v1), so session_id is the link.
        # Missing bound session_id in metadata is treated as invariant failure.
        if (
            bound_session_id_raw is None
            or agent_run.agent_session_id is None
            or str(agent_run.agent_session_id) != str(bound_session_id_raw)
        ):
            raise DaemonAgentRunNotFound(
                f"AgentRun '{run_id}' is not bound to lease '{lease_id}' session.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(run_id),
                    "lease_session_id": bound_session_id_raw,
                    "run_session_id": (
                        str(agent_run.agent_session_id) if agent_run.agent_session_id else None
                    ),
                },
            )

        # Idempotent: already terminal → no-op return (daemon retry safety).
        if agent_run.status in TERMINAL_TURN_STATUSES:
            log.info(
                "interactive_run_close_already_terminal",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
                status=agent_run.status,
            )
            # 已持 FOR UPDATE 行锁：rollback 释放（无写入可回滚），refresh 重取
            # 属性供响应序列化读取（rollback 会过期 ORM 实例属性）。
            await self._session.rollback()
            await self._session.refresh(agent_run)
            return agent_run

        now = datetime.now(UTC)
        # Map SDK result → AgentRun terminal status (design §4).
        if status == "success" and not is_error:
            agent_run.status = "completed"
            agent_run.exit_code = 0
        elif status == "error_during_execution" or is_error:
            agent_run.status = "failed"
            agent_run.exit_code = 1
            # error_during_execution = interrupted turn (spike D1 / SDK abort);
            # other errors are genuine failures. error_code keeps them distinct.
            agent_run.error_code = (
                "interactive_interrupted"
                if status == "error_during_execution"
                else "interactive_failed"
            )
        else:
            # Unknown status → conservative failed (never leave a half-state).
            agent_run.status = "failed"
            agent_run.exit_code = 1
            agent_run.error_code = "interactive_unknown_status"

        # task-06 / FR-02 / D-009：模型层错误详情写入 error_detail（JSON 列）。
        # 与 error_code（上面 status 映射设置的调度层/系统错误）正交，不互相覆盖：
        # 这里只持久化 ModelError，绝不动 error_code。daemon 契约（design §7.5）
        # error 总伴随 is_error=true → 上面已置 failed；此处补存错误详情供前端展示。
        # model_dump(mode='json') 把 StrEnum 等转成 JSON 原生类型，适配 JSON 列存储。
        if error is not None:
            agent_run.error_detail = error.model_dump(mode="json")

        # task-05（D-003@v1）修正：interactive run 走 close_interactive_run（非
        # complete_lease，因 interactive lease agent_run_id=NULL per D-005），stage
        # 回写在此接线。从 agent_run.status 推导 changes.stages.last_dispatch.status
        # （running→completed/failed），不读 sillyspec.db，独立路径。try/except 容错。
        if agent_run.change_id is not None:
            try:
                from app.modules.change.model import Change

                change = await self._session.get(Change, agent_run.change_id)
                if change is not None:
                    stages = dict(change.stages or {})
                    last_dispatch = stages.get("last_dispatch")
                    if isinstance(last_dispatch, dict) and last_dispatch:
                        stage_status = "completed" if agent_run.status == "completed" else "failed"
                        # dict() copy 避免 SQLAlchemy JSON in-place mutation 不持久化
                        # （对齐 lease/service.py:_sync_stage_status_from_run 的模式）。
                        # 原地改 last_dispatch["status"] 会令旧 change.stages 同步被改
                        # （浅拷贝共享嵌套引用），change.stages = stages 时新旧值相等
                        # → SQLAlchemy 不标记 dirty → 回写不入库（stage 永远卡 running）。
                        new_last_dispatch = dict(last_dispatch)
                        new_last_dispatch["status"] = stage_status
                        stages["last_dispatch"] = new_last_dispatch
                        change.stages = stages
                        self._session.add(change)
                        log.info(
                            "stage_status_synced_from_run",
                            change_id=str(change.id),
                            run_id=str(agent_run.id),
                            status=stage_status,
                        )
                    else:
                        log.warning(
                            "sync_stage_status_from_run_no_last_dispatch",
                            change_id=str(change.id),
                        )
            except Exception as exc:
                log.warning(
                    "sync_stage_status_from_run_failed",
                    run_id=str(agent_run.id),
                    error=str(exc),
                )

        agent_run.finished_at = now
        # task-05 / M2（design §5.1 / §170）：仅 verify stage 的 completed run 设
        # gate_status='pending'（随终态同 commit，gate 任务读到一致快照）。change_id=None
        # 的对话 turn、failed run，以及 quick/brainstorm/plan/execute/archive 等非 verify
        # stage 不进 gate——这些 stage 无 verify gate 产物，强行 gate verify 必然解析
        # 失败 exit 2 误报失败（_gate_applicable 守门）。gate 决策由 task-07 后台任务
        # cas running→decided/failed 推进。
        if await self._gate_applicable(agent_run):
            agent_run.gate_status = "pending"
        # SDKResultSuccess 透传：usage / cost / duration（None 不覆盖 AgentRun 原值，
        # daemon 老版本不传这些字段时保持兼容）。对应 AgentRun.{total_cost_usd,
        # num_turns,duration_ms,duration_api_ms,input_tokens,output_tokens}，
        # 这几个列在 model.py 已存在（interactive 路径原先没写，导致全 NULL）。
        if total_cost_usd is not None:
            agent_run.total_cost_usd = total_cost_usd
        if num_turns is not None:
            agent_run.num_turns = num_turns
        if duration_ms is not None:
            agent_run.duration_ms = duration_ms
        if duration_api_ms is not None:
            agent_run.duration_api_ms = duration_api_ms
        if input_tokens is not None:
            agent_run.input_tokens = input_tokens
        if output_tokens is not None:
            agent_run.output_tokens = output_tokens
        # task-07：prompt cache 词元终态透传（直接覆盖，无 max — 终态一次写入，
        # 对齐上面 input/output 直接覆盖模式）。
        if cache_read_tokens is not None:
            agent_run.cache_read_tokens = cache_read_tokens
        if cache_creation_tokens is not None:
            agent_run.cache_creation_tokens = cache_creation_tokens

        # ── task-03（2026-08-29-usage-by-provider-model / FR-01-3 / design §1.2 §4.1）：
        # model_usage 明细落库 + run.model / llm_provider_id 填充。api_requests 无
        # run 级列——run 总数已由 daemon 按 design §2 分摊进各行（各行求和 == run
        # 总数），backend 不重复分摊直接落行；run 级精确值仅入下方 close 日志观测。
        if model_usage:
            try:
                # run 列填充（design §1.2）：model 终态填 input+output 最大行的
                # model（该列确从未写入，终态无条件覆盖对齐 input/output 模式）；
                # llm_provider_id 仅空时填会话当前值——dispatch（session/service.py
                # :3359）已按轮写入生效供应商，终态无条件覆盖会把 dispatch 时点的
                # 准确值改成终态会话当前值（切供应商竞态错归因，R-08），非空不触碰。
                agent_run.model = max(
                    model_usage,
                    key=lambda item: item.input_tokens + item.output_tokens,
                ).model
                if agent_run.llm_provider_id is None:
                    bound_session = await self._session.get(
                        AgentSession, agent_run.agent_session_id
                    )
                    if bound_session is not None:
                        agent_run.llm_provider_id = bound_session.llm_provider_id
                # 明细幂等 upsert：同 run 先 DELETE 后 INSERT 全部行（等价 upsert
                # by (run_id, model)，重放同 payload 不叠行）。savepoint 包裹——
                # 明细落库失败只回滚本块，不阻塞 close 主事务（design §4.1
                # best-effort，对齐 session/service.py:1491 落绑定范式）。
                async with self._session.begin_nested():
                    await self._session.execute(
                        delete(AgentRunModelUsage).where(AgentRunModelUsage.run_id == agent_run.id)
                    )
                    for item in model_usage:
                        self._session.add(
                            AgentRunModelUsage(
                                run_id=agent_run.id,
                                model=item.model,
                                input_tokens=item.input_tokens,
                                output_tokens=item.output_tokens,
                                cache_read_tokens=item.cache_read_tokens,
                                cache_creation_tokens=item.cache_creation_tokens,
                                api_requests=item.api_requests,
                            )
                        )
                    await self._session.flush()
            except Exception as exc:
                log.warning(
                    "model_usage_persist_failed",
                    run_id=str(agent_run.id),
                    error=str(exc),
                )
        if result_summary:
            # Redact via git_gateway redact_output to avoid leaking secrets in
            # the stored summary (mirrors batch completeLease path).
            try:
                agent_run.output_redacted = redact_output(result_summary)
            except Exception:
                agent_run.output_redacted = result_summary[:50000]

        self._session.add(agent_run)

        # task-03 / D-001 / D-009：run 终态回写 session 终态（同事务）。
        # close_interactive_run 是 daemon 回灌 run 终态的唯一收口点，病灶 B：自然
        # 覆盖批量路径（dispatch_to_daemon 创建的 pending session）的 pending/active
        # session 必须在此收口，否则 session 永远停在 active（D-001）。
        # D-009：必须新建 query（禁止复用 :1039 _resolve_gate_workspace_id 的 session
        # query，它在 commit 之后调用，回写不进同一事务）；D-005 幂等由
        # _apply_session_terminal_status 守卫（已 ended/failed 返 None）。
        _session_end_intent: tuple[uuid.UUID, uuid.UUID | None, uuid.UUID | None] | None = None
        # task-03（2026-08-24-sessions-live-updates）：run 终态翻 session ended/failed
        # 时记下列表信号意图（session_id + user_id），commit 后广播 status_changed——
        # 多轮对话仅刷 last_active_at 的分支不置此意图（列表视图无状态变化，不发）。
        # user_id 同样须在 expire_on_commit 前取标量。
        _sessions_changed_intent: tuple[uuid.UUID, uuid.UUID | None] | None = None
        if agent_run.agent_session_id is not None:
            # AgentSession 走模块顶 import（与上方 task-03 model_usage 块共用）：
            # 此处若保留函数内局部 import，Python 会把 AgentSession 判为整个
            # 函数体的局部名，上方先于本行执行的引用直接 UnboundLocalError。
            session = await self._session.get(AgentSession, agent_run.agent_session_id)
            if session is not None:
                new_status = _apply_session_terminal_status(agent_run, session)
                # task-06 / FR-06 / D-006@v1（Grill M1-R 终版）：闸拒绝失败收口
                # ——命中优先于多轮 keep-active。daemon 会话闸拒绝的分身子会话首
                # run 回传 failed 时，_apply_session_terminal_status 对 interactive
                # 多轮返 active 会让子会话永驻 active（占 daemon 会话额度 + mission
                # 卡死）；触发面三条件齐备（_is_gate_rejected_first_failure）则覆写
                # 为 failed（非 ended），复用下方既有翻转块（ended_at + SESSION_END
                # + publish 链）。幂等守卫不变：new_status=None（会话已 ended/
                # failed）时下方整体跳过，本规则不复活终态会话。
                if new_status == "active" and await self._is_gate_rejected_first_failure(
                    agent_run, session
                ):
                    new_status = "failed"
                if new_status is not None:
                    session.status = new_status
                    if new_status in ("ended", "failed"):
                        session.ended_at = now
                        _sessions_changed_intent = (session.id, session.user_id)
                        # ql-20260823-006：会话被 run 终态翻成 ended/failed 时记下
                        # 发送意图，commit 后补发 SESSION_END 清理 daemon 内存副本——
                        # 否则 daemon SessionStore 残留活条目（backend 终态 ≠ daemon
                        # 感知），后续 reopen 全撞 SESSION_ALREADY_EXISTS 死循环
                        # （2026-08-23 会话 bdec91a4 事故）。expire_on_commit 前取标量。
                        _session_end_intent = (session.id, session.lease_id, session.runtime_id)
                    else:
                        session.last_active_at = now
                    self._session.add(session)

        await self._session.commit()
        await self._session.refresh(agent_run)

        # ql-20260903-011：CLI 合成鉴权错误（远端 401 被误报为 "Not logged in"）
        # 自动重投一次——终态已 commit，重投走排队消息表 + 后台派发（供应商/档案
        # 快照随条目重放，派发语义与忙轮入队一致）。helper 全程静默容错。
        await self._maybe_autoretry_auth_transient_turn(agent_run, error)

        # ql-20260823-006：run 终态翻会话 ended/failed → commit 后 best-effort 补发
        # SESSION_END（失败仅日志，不影响已 commit 终态），daemon 侧 end() 收口
        # （kill driver + close InputQueue + 终态条目不再落盘）。
        if _session_end_intent is not None:
            flip_session_id, flip_lease_id, flip_runtime_id = _session_end_intent
            await _send_session_end_best_effort(
                self._session,
                session_id=flip_session_id,
                lease_id=flip_lease_id,
                runtime_id=flip_runtime_id,
                reason="run_terminal_flip",
            )

        # task-03（design §3 生命周期契约表）：run 终态翻 session ended/failed →
        # 广播列表变更信号（status_changed），打开的会话列表秒级收敛。publish 内部
        # 静默容错（Redis 抖动不拖垮已 commit 的终态）；仅刷 last_active_at 的多轮
        # 分支意图为 None，零发布。
        if _sessions_changed_intent is not None:
            changed_sid, changed_uid = _sessions_changed_intent
            await publish_sessions_changed("status_changed", changed_sid, changed_uid)

        # task-10 / FR-06 / D-010@v1：借用 agent run 完成 → 方案文本落文件中心 +
        # 补 daemon_borrow_audit.usage_summary。仅 borrowed lease 生效（helper 内部
        # 判别 ``lease_meta.borrowed=True``），普通 lease 零回归。helper 自带 try/except
        # 守门（落 file/审计失败仅记日志，不影响已 commit 的 run 终态——H4）。
        try:
            from app.modules.agent.service import AgentService

            await AgentService(self._session).persist_borrow_run_output(agent_run, lease_meta)
        except Exception as exc:
            log.warning(
                "borrow_run_output_hook_failed",
                run_id=str(agent_run.id),
                error=str(exc),
            )

        # task-05 / design §5.1：commit 后 enqueue gate 决策后台任务并立即返回 HTTP
        # （<30s，daemon notifyRunResult 不重试）。仅 verify stage 的 completed run
        # enqueue（对话 turn / failed / 非 verify stage 不进 gate，_gate_applicable 守门）。不 await
        # gate 任务 —— _fire_background_task（task-03 / H4）创建 asyncio.Task 持强引用
        # 防静默 GC，enqueue 失败异常由 add_done_callback 兜底，不影响已 commit 终态行。
        # workspace_id 从 Change.workspace_id 推导（对齐 _trigger_stage_completion_callback
        # :1029 的稳定来源；AgentSession.workspace_id 亦可选，但 Change 更直接且 stage
        # run 必有 change）。task-07（Wave 3）替换 _run_gate_decision_task stub 实现真实
        # gate 决策（H1 独立 session + R3 cas + 跑 gate + 存 result + H2 内联 sync/auto_dispatch）。
        if await self._gate_applicable(agent_run):
            gate_workspace_id = await self._resolve_gate_workspace_id(agent_run)
            if gate_workspace_id is not None:
                self._fire_background_task(
                    self._run_gate_decision_task(
                        agent_run_id=agent_run.id,
                        workspace_id=gate_workspace_id,
                        change_id=agent_run.change_id,
                    ),
                    workspace_id=gate_workspace_id,
                    run_id=agent_run.id,
                )

        # Publish terminal event so SSE stream (task-06) emits turn_completed.
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(
                    {
                        "event": "status_changed",
                        "status": agent_run.status,
                        "lease_id": str(lease_id),
                        "agent_run_id": str(agent_run.id),
                        "subtype": subtype,
                    },
                    default=str,
                ),
            )
        except Exception:
            log.warning(
                "interactive_run_close_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
            )

        # design §6 step3 / §8.2：往 session 级 channel 发 turn_completed，让前端
        # SSE onTurnCompleted 清空 currentRunId、解锁输入框发下一条。否则 turn 在
        # 后端已完成（status_changed 只发到 agent_run:{run_id}），但前端只订阅
        # agent_session:{session_id}，收不到结束信号 → UI 永远停在「运行中」、发不
        # 了下一条（用户报告的现象）。契约见 frontend/src/lib/daemon.ts
        # SessionStreamEnvelope（event=turn_completed + status + exit_code）。
        # _publish_session_event 自带 try/except，Redis 抖动不影响已提交的终态行。
        await self._facade._publish_session_event(
            agent_run.agent_session_id,
            {
                "event": "turn_completed",
                "session_id": str(agent_run.agent_session_id),
                "run_id": str(agent_run.id),
                "status": agent_run.status,
                "exit_code": agent_run.exit_code,
                # ql-20260621：终态 token 一并推送，前端 onTurnCompleted 收敛时
                # 同步显示最终输入/输出词元（与执行中 onTokens 推送的累积值一致，
                # 覆盖 daemon 老版本不实时推 token 的情形）。
                "input_tokens": agent_run.input_tokens,
                "output_tokens": agent_run.output_tokens,
                "timestamp": now.isoformat().replace("+00:00", "Z"),
            },
        )

        # task-05（2026-09-01-session-group-chat / design §5.2 改动点②）：影子 run
        # 收口 → 群频道 turn_completed。现 session 频道事件只有 run_id/session_id，
        # 群 UI 无法判「哪个成员说完了」——本事件补 member_id/member_name/
        # member_session_id（design §6.2 envelope 扩展），status/exit_code/词元字段
        # 照原事件。session_id 用群会话 id（频道自身 id，对齐 group/service
        # _publish_group_channel_event 惯例），影子会话 id 走 member_session_id。
        # 非 group_member 会话（单聊/worker/quick-chat）解析为 None 零行为变化。
        # ── 互@检测挂接点（design §4.4，task-04 接线，本卡不实现）──
        # 本事件发布后，应对该 run 本轮的最终回复文本（载体 run 最新投影行 /
        # AgentRun.output_redacted）执行与用户消息相同的 @解析（群开关
        # agent_cross_mention + Redis 链护栏 group_chain:{载体run_id} 深度/去重/
        # 限频），命中的其他 agent 成员走 §4.1-4.3 触发管线（注入 prompt 的
        # 「当前消息」标注为来自 Agent 成员的协作请求）。
        if agent_run.agent_session_id is not None:
            group_identity = await resolve_group_member_identity(
                self._session, shadow_session_id=agent_run.agent_session_id
            )
            if group_identity is not None:
                group_id, group_member_id, group_member_name = group_identity
                # quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——completed
                # 的群 @ 轮若载体 run 上无本成员任何投影行（整轮没打 [[GROUP]]
                # 标记），补一行简短系统行防群里死寂（fail-open：异常不阻断
                # turn_completed / 互@检测 / 排队派发）。直聊轮不兜底（群内静默
                # 是直聊的设计语义）。
                if agent_run.status == "completed":
                    try:
                        await self._emit_group_mention_projection_fallback(agent_run)
                    except Exception:
                        log.warning(
                            "group_projection_fallback_failed",
                            agent_run_id=str(agent_run.id),
                            group_id=str(group_id),
                            exc_info=True,
                        )
                try:
                    redis = get_redis()
                    await redis.publish(
                        f"agent_session:{group_id}",
                        json.dumps(
                            {
                                "event": "turn_completed",
                                "session_id": str(group_id),
                                "run_id": str(agent_run.id),
                                "status": agent_run.status,
                                "exit_code": agent_run.exit_code,
                                "input_tokens": agent_run.input_tokens,
                                "output_tokens": agent_run.output_tokens,
                                "timestamp": now.isoformat().replace("+00:00", "Z"),
                                "member_id": str(group_member_id),
                                "member_name": group_member_name,
                                "member_session_id": str(agent_run.agent_session_id),
                            },
                            default=str,
                        ),
                    )
                except Exception:
                    log.warning(
                        "group_turn_completed_redis_publish_failed",
                        lease_id=str(lease_id),
                        agent_run_id=str(agent_run.id),
                        group_id=str(group_id),
                    )
                # 群聊运行态可见 quick（2026-09-02）：终态 typing 止息——run 收口
                # 即冲掉该成员的 typing 指示器（completed/failed/killed 全发：
                # 无论成败，成员都不再「正在输入」；前端 TTL 过期之外的服务端
                # 确定性信号）。延迟 import 同下方互@挂接先例（run_sync ↔ group
                # 循环依赖）；_publish_group_typing_event 自吞 Redis 抖动，外层
                # try 兜 import 级异常——失败仅 warning 不阻断已 commit 的收口。
                try:
                    from app.modules.daemon.group.service import (
                        _publish_group_typing_event,
                        _typing_payload,
                    )

                    await _publish_group_typing_event(
                        group_id,
                        _typing_payload(
                            member_name=group_member_name,
                            member_kind="agent",
                            typing=False,
                            preview=None,
                            member_id=str(group_member_id),
                        ),
                    )
                except Exception:
                    log.warning(
                        "group_typing_stop_publish_failed",
                        lease_id=str(lease_id),
                        agent_run_id=str(agent_run.id),
                        group_id=str(group_id),
                    )
                # task-04（design §4.4）：互@检测——编排与 Redis 护栏全在
                # group/service.py，此处仅最小挂接（completed 轮；fail-open：
                # 异常不阻断已 commit 的 run 终态收口与后续排队派发）。
                if agent_run.status == "completed":
                    try:
                        from app.modules.daemon.group.service import (
                            run_cross_mention_detection,
                        )

                        await run_cross_mention_detection(
                            self._session,
                            group_id=group_id,
                            member_id=group_member_id,
                            member_name=group_member_name,
                            run=agent_run,
                        )
                    except Exception:
                        log.warning(
                            "group_cross_mention_detection_failed",
                            agent_run_id=str(agent_run.id),
                            group_id=str(group_id),
                            exc_info=True,
                        )

        log.info(
            "interactive_run_closed",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=agent_run.status,
            sdk_status=status,
            is_error=is_error,
            subtype=subtype,
            # task-03：run 级 API 调用次数精确值（AgentRun 无该列，日志观测；
            # 落库承载在 agent_run_model_usage 明细行，各行求和 == 该值，design §2）。
            api_requests=api_requests,
        )

        # ql-20260825-011（后端真实排队）：turn 终态 → 后台派发下一条排队消息。
        # 先查有无 pending 条目（close 已 commit，读快照零锁）——绝大多数会话
        # 无排队，不起空转任务；有才 fire（H4 强引用防 GC，独立 DB session H1）。
        # 会话可能已被终态翻成 ended/failed（dispatch 内部自查自弃）。
        if agent_run.agent_session_id is not None:
            from app.modules.agent.model import AgentSessionQueuedMessage

            has_pending = (
                await self._session.execute(
                    select(AgentSessionQueuedMessage.id)
                    .where(
                        AgentSessionQueuedMessage.agent_session_id == agent_run.agent_session_id,
                        AgentSessionQueuedMessage.status == "pending",
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if has_pending is not None:
                from app.modules.daemon.session.service import dispatch_next_queued_message

                self._fire_background_task(
                    dispatch_next_queued_message(agent_run.agent_session_id),
                    run_id=agent_run.id,
                )
        return agent_run

    async def _maybe_autoretry_auth_transient_turn(
        self,
        agent_run: AgentRun,
        error: ModelErrorDTO | None,
    ) -> None:
        """CLI 合成鉴权错误自动重投一次（ql-20260903-011）。

        背景：claude CLI 把模型网关返回的 401 统一合成 "Not logged in · Please
        run /login" 错误消息注入对话（transcript 特征 model=<synthetic> /
        error=authentication_failed / isApiErrorMessage）——远端瞬时抖动被误导成
        本地凭证缺失，且 retryable=false 不引导重试，用户只能手动重发。实证
        （2026-09-03 会话 cb56fabf）：同一进程同一份密钥，13 秒后重发即成功。

        处理：把本 run 的 user_input 追加为排队消息（携带 run 上的供应商/档案
        快照），由 close 末尾既有的排队派发钩子（ql-20260825-011）随即重放——
        排队条目派发语义与忙轮入队一致（供应商配置原样重放、至多一个活跃 run）。

        防循环（至多一次自动重投）：紧邻的上一条同会话 run 若同为 CLI 鉴权失败
        且 user_input 相同 → 本 run 已是那次自动重投的结果（网关持续性故障），
        不再追加，交回用户处理。另查同文 pending 条目防与用户手动重发叠加。

        调用点：close_interactive_run 主事务 commit 之后（终态已落库）。全程
        静默容错——任何一步失败仅回滚本 helper 的事务并 warn，绝不影响已
        commit 的 run 终态。
        """
        raw = (error.raw if error is not None else None) or ""
        if agent_run.status != "failed" or not _CLI_AUTH_TRANSIENT_RE.search(raw):
            return
        session_id = agent_run.agent_session_id
        if session_id is None or agent_run.user_id is None:
            return
        try:
            session = await self._session.get(AgentSession, session_id)
            # 会话已终态（ended/failed）→ 排队派发也无意义，直接放弃。
            if session is None or session.status != "active":
                return
            # 本 run 的原始输入（与 group/service.py 等生产查询同形态绑 UUID）。
            prompt = (
                await self._session.execute(
                    select(AgentRunLog.content_redacted)
                    .where(
                        AgentRunLog.run_id == agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                    .order_by(AgentRunLog.timestamp)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if prompt is None or not prompt.strip():
                return
            prompt = prompt.strip()
            # 防循环：紧邻上一条同会话 run 同为 CLI 鉴权失败且输入相同 → 已重投过。
            prev_run = (
                await self._session.execute(
                    select(AgentRun)
                    .where(
                        AgentRun.agent_session_id == session_id,
                        AgentRun.started_at < agent_run.started_at,
                        AgentRun.id != agent_run.id,
                    )
                    .order_by(AgentRun.started_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if prev_run is not None and prev_run.status == "failed":
                prev_raw = ""
                if isinstance(prev_run.error_detail, dict):
                    prev_raw = str(prev_run.error_detail.get("raw") or "")
                if _CLI_AUTH_TRANSIENT_RE.search(prev_raw):
                    prev_prompt = (
                        await self._session.execute(
                            select(AgentRunLog.content_redacted)
                            .where(
                                AgentRunLog.run_id == prev_run.id,
                                AgentRunLog.channel == "user_input",
                            )
                            .order_by(AgentRunLog.timestamp)
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if (prev_prompt or "").strip() == prompt:
                        log.info(
                            "auth_transient_autoretry_skipped_already_retried",
                            run_id=str(agent_run.id),
                            session_id=str(session_id),
                        )
                        return
            # 用户已手动重发同文并排队（pending）→ 不重复追加。
            dup_pending = (
                await self._session.execute(
                    select(func.count())
                    .select_from(AgentSessionQueuedMessage)
                    .where(
                        AgentSessionQueuedMessage.agent_session_id == session_id,
                        AgentSessionQueuedMessage.status == "pending",
                        AgentSessionQueuedMessage.prompt == prompt,
                    )
                )
            ).scalar_one()
            if dup_pending:
                return
            position = (
                await self._session.execute(
                    select(func.coalesce(func.max(AgentSessionQueuedMessage.position), -1)).where(
                        AgentSessionQueuedMessage.agent_session_id == session_id
                    )
                )
            ).scalar_one()
            self._session.add(
                AgentSessionQueuedMessage(
                    agent_session_id=session_id,
                    sender_user_id=agent_run.user_id,
                    prompt=prompt,
                    # 供应商/档案快照随 run 重放（排队条目契约：发送时配置原样重放）。
                    llm_provider_id=(
                        str(agent_run.llm_provider_id) if agent_run.llm_provider_id else None
                    ),
                    agent_profile_id=(
                        str(agent_run.agent_profile_id) if agent_run.agent_profile_id else None
                    ),
                    status="pending",
                    position=int(position) + 1,
                )
            )
            await self._session.commit()
            log.info(
                "auth_transient_turn_autoretry_enqueued",
                run_id=str(agent_run.id),
                session_id=str(session_id),
                # close 末尾的排队派发钩子检测 pending 条目存在即触发重放。
            )
        except Exception as exc:
            await self._session.rollback()
            log.warning(
                "auth_transient_autoretry_failed",
                run_id=str(agent_run.id),
                session_id=str(agent_run.agent_session_id),
                error=str(exc),
            )

    # ── Driver Gate enqueue helpers（task-05 / design §5.1） ─────────────────

    async def _gate_applicable(self, agent_run: AgentRun) -> bool:
        """gate 仅 verify stage 的 completed run 跑（design §5.4 gate 当前仅 verify）。

        change_id 非空 + completed 但 ``current_stage`` 非 verify（quick / brainstorm /
        plan / execute / archive）的 run 不进 gate：这些 stage 无 verify gate 产物，
        强行跑 ``sillyspec gate verify`` 必然解析失败 exit 2 误报失败（quick 独立
        quicklog 流程、change_key 含中文等尤甚——实测见 ql-20260813-006）。落库的
        ``change`` 经 identity map 命中（close 内已 get 过），不额外查库。
        """
        if agent_run.change_id is None or agent_run.status != "completed":
            return False
        from app.modules.change.model import Change

        change = await self._session.get(Change, agent_run.change_id)
        return change is not None and change.current_stage == "verify"

    async def _resolve_gate_workspace_id(self, agent_run: AgentRun) -> uuid.UUID | None:
        """推导 gate 任务所需 workspace_id（task-05）。

        稳定来源优先级（design §5.1）：
          1. Change.workspace_id —— stage run 必有 change，且与
             _trigger_stage_completion_callback:1029 同一来源，一致。
          2. AgentSession.workspace_id（D-003@v1 change-scoped binding）兜底。
        失败返回 None（caller 已守门 change_id 非空，此处只兜底查不到的极端），
        不抛 —— gate enqueue 不得影响已 commit 的终态行（H4 守门）。
        """
        from app.modules.change.model import Change

        try:
            change = await self._session.get(Change, agent_run.change_id)
            if change is not None:
                return change.workspace_id
        except Exception as exc:
            log.warning(
                "gate_resolve_workspace_change_failed",
                run_id=str(agent_run.id),
                change_id=str(agent_run.change_id),
                error=str(exc),
            )

        if agent_run.agent_session_id is not None:
            from app.modules.agent.model import AgentSession

            try:
                session = await self._session.get(AgentSession, agent_run.agent_session_id)
                if session is not None:
                    return session.workspace_id
            except Exception as exc:
                log.warning(
                    "gate_resolve_workspace_session_failed",
                    run_id=str(agent_run.id),
                    session_id=str(agent_run.agent_session_id),
                    error=str(exc),
                )
        return None

    async def _run_gate_decision_task(
        self,
        *,
        agent_run_id: uuid.UUID,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> None:
        """Gate 决策后台任务（task-07，design §5.2 / §7 / §7.5）。

        Wave 2 task-05 仅接通 close_interactive_run 的 enqueue 调用点；本方法为
        task-07 的真实逻辑：在独立 session（H1）里 cas 抢占 gate_status pending→running
        （R3 防双发）→ 跑 sillyspec gate verify（task-06 _run_gate_via_delegate →
        task-01 HostFsDelegate.run_command）→ 存 gate_result + decided → 发
        gate_status_changed SSE（形态A task-01：不再自动推进 stage，current_stage 不变，
        推进交 advance_change_stage tool 读 gate_result 显式决策）→ 异常 fail-loud
        （failed + exit 2）。

        四条硬约束（design §10 R5-R7）：
          - **H1**：``async with get_session_factory()() as gate_session`` 独立 session。
            RunSyncService.__init__ 只接注入 session 无 session_factory 字段，后台任务
            生命周期独立于 HTTP 请求 session（R6）。全程禁用 ``self._session``。
          - **R3**：``UPDATE ... WHERE gate_status='pending'`` 原子 cas，
            ``result.rowcount == 0`` 直接 return（防 reconcile + 原任务 double-enqueue，
            R10）。生产 PG 原子可靠；SQLite 测试用真 UPDATE 验 rowcount（R9）。
          - **H2**（形态A task-01 修订）：原 H2 内联 sync_stage_status +
            auto_dispatch_next_step 块已删（砍自动连轴，design §4.1 调用点①）；gate_session
            仅用于 cas + 落 gate_result + 发 SSE，current_stage 不变。
          - **H4**：由 task-05 close_interactive_run 经 ``_fire_background_task`` enqueue
            （强引用 ``_background_tasks`` set 防 GC + ``add_done_callback`` 取异常防静默）。

        失败语义（design §7 异常分支）：任何异常 → ``gate_status='failed'`` +
        ``gate_result={'exit_code': 2, 'errors': [str(exc)], 'raw_envelope': {}}`` + commit
        （fail-loud 不降级，不吞异常）。形态A：gate_result 交 advance_change_stage tool
        / 前端据 exit_code 显式决策（0 推进 / 1 打回 / 2 卡住，design §5.4）。
        """
        from app.modules.change.model import Change
        from app.modules.workspace.model import Workspace

        # H1：独立 session（get_session_factory），禁用 self._session。后台任务生命
        # 周期独立于 HTTP 请求；conftest._redirect_session_factory 让测试同引擎。
        session_factory = get_session_factory()
        async with session_factory() as gate_session:
            try:
                # R3：cas gate_status pending→running（原子防 double-enqueue）。
                # rowcount==0 表示已被抢（reconcile + 原任务并发 / 已 decided/failed），
                # 直接 return 不跑 gate（design §7.5 生命周期契约表 + R10）。
                cas_stmt = (
                    update(AgentRun)
                    .where(
                        AgentRun.id == agent_run_id,
                        AgentRun.gate_status == "pending",
                    )
                    .values(gate_status="running")
                )
                cas_result = await gate_session.execute(cas_stmt)
                await gate_session.commit()
                if cas_result.rowcount == 0:
                    log.info(
                        "gate_decision_task_cas_miss",
                        agent_run_id=str(agent_run_id),
                    )
                    return

                # 取 workspace / change（gate 命令需 change.name + spec_root + workspace 对象）。
                workspace = await gate_session.get(Workspace, workspace_id)
                if workspace is None:
                    raise RuntimeError(f"workspace not found: {workspace_id}")
                change = await gate_session.get(Change, change_id)
                if change is None:
                    raise RuntimeError(f"change not found: {change_id}")
                change_name = change.change_key
                code_root, spec_dir = await self._resolve_gate_spec_root(
                    gate_session, workspace, change
                )
                if not code_root:
                    raise RuntimeError(f"gate code_root unresolvable for change {change_id}")

                # task-06 _run_gate_via_delegate（走 task-01 HostFsDelegate.run_command
                # 在 daemon 跑 sillyspec gate verify，27s+），已含 _read_gate_result 解析
                # 返回 {exit_code, errors, raw_envelope}。
                gate_result = await _run_gate_via_delegate(
                    gate_session,
                    workspace,
                    change_name,
                    code_root,
                    spec_dir,
                    stage="verify",
                )

                # 存 gate_result + decided；flag_modified 防 SQLAlchemy JSON in-place
                # mutation 不标记 dirty（对齐 lease.service._sync_stage_status_from_run
                # 的模式，gate_result 是 dict 原地改不入库——这里整体替换则自然 dirty）。
                run_row = await gate_session.get(AgentRun, agent_run_id)
                if run_row is None:
                    raise RuntimeError(f"agent_run disappeared during gate task: {agent_run_id}")
                run_row.gate_result = gate_result
                run_row.gate_status = "decided"
                flag_modified(run_row, "gate_result")
                await gate_session.commit()

                # 形态A task-01（design §4.1 调用点①）：砍 auto_dispatch 自动连轴。
                # gate 结果已落库（gate_result + gate_status=decided），current_stage
                # 不变；推进交 advance_change_stage tool 读 gate_result 显式决策。
                # task-11 / design §5.7：commit 后发 gate_status_changed SSE 通知前端
                # 更新徽标（复用 agent_run:{id} channel，对齐 close 的 try/except 容错）。
                await self._publish_gate_status_changed(run_row, gate_result)

                log.info(
                    "gate_decision_task_done",
                    agent_run_id=str(agent_run_id),
                    change_id=str(change_id),
                    gate_exit_code=gate_result.get("exit_code"),
                )
            except Exception as exc:
                # design §7 异常分支：fail-loud——gate_status=failed + exit 2 +
                # errors 含异常信息（不吞异常、不降级为 read_verify_result）。
                # rollback 撤销 cas running 及任何未提交改动，重新置 failed + gate_result。
                await gate_session.rollback()
                failed_gate_result = {
                    "exit_code": 2,
                    "errors": [str(exc)],
                    "raw_envelope": {},
                }
                try:
                    run_row = await gate_session.get(AgentRun, agent_run_id)
                    if run_row is not None:
                        run_row.gate_result = failed_gate_result
                        run_row.gate_status = "failed"
                        flag_modified(run_row, "gate_result")
                        await gate_session.commit()
                        # task-11 / design §5.7：failed 分支 gate_status=failed + gate_result
                        # commit 成功后发 gate_status_changed SSE（复用 agent_run:{id}
                        # channel，对齐 close 的 try/except 容错）。此处 run_row 确定
                        # 非 None 且已 commit，failed_gate_result 含 errors=[str(exc)]。
                        await self._publish_gate_status_changed(run_row, failed_gate_result)
                except Exception as commit_exc:
                    log.exception(
                        "gate_decision_task_failed_commit_error",
                        agent_run_id=str(agent_run_id),
                        error=str(commit_exc),
                    )
                log.exception(
                    "gate_decision_task_failed",
                    agent_run_id=str(agent_run_id),
                    change_id=str(change_id),
                    error=str(exc),
                    exc_info=exc,
                )

    async def _publish_gate_status_changed(
        self,
        agent_run: AgentRun,
        gate_result: dict | None,
    ) -> None:
        """发 Redis ``gate_status_changed`` SSE 事件（task-11 / design §5.7）。

        gate 后台任务 27s+ 完成（decided/failed）后，前端需更新 gate_status 徽标
        （"客观核验中"→"已通过"/"失败"）。close 的 SSE 只发 ``turn_completed``（agent
        完成），gate 完成无 SSE → 徽标卡住。本方法补这一条事件，**复用现有
        ``agent_run:{id}`` channel**（task-12 前端按 event 字段分流，不新建 channel）。

        对齐 ``close_interactive_run:955-975`` 的 try/except 容错模式：Redis 抖动只
        warning，不影响已 commit 的 gate_result（gate_result 已落库，SSE 漏发不回滚）。

        ``errors_summary`` 取 ``gate_result.errors`` 的 ``str()[:500]``（截断防超大
        payload）；errors 为空 / None 时 ``errors_summary=None``。
        """
        try:
            redis = get_redis()
            errors = (gate_result or {}).get("errors") if isinstance(gate_result, dict) else None
            errors_summary = (str(errors)[:500]) if errors else None  # 截断防超大 payload
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(
                    {
                        "event": "gate_status_changed",
                        "agent_run_id": str(agent_run.id),
                        "gate_status": agent_run.gate_status,
                        "errors_summary": errors_summary,
                    },
                    default=str,
                ),
            )
        except Exception:
            log.warning(
                "gate_status_changed_redis_publish_failed",
                agent_run_id=str(agent_run.id),
                gate_status=agent_run.gate_status,
            )

    async def _publish_stage_status_changed(
        self,
        agent_run: AgentRun,
        change_id: uuid.UUID,
        stage: str | None,
        status: str,
    ) -> None:
        """发 Redis ``stage_status_changed`` SSE 事件（形态A 按需触发，design §4.1）。

        砍 auto_dispatch 自动连轴后，single stage 完成（task-02）/ team stage 推进
        （task-03）都不再自动 dispatch 下一 stage。本事件提示前端 / agent：当前
        stage 已落「完成待触发」态，需显式调 ``advance_change_stage`` MCP/HTTP 推进。

        复用现有 ``agent_run:{id}`` channel（对齐 ``_publish_gate_status_changed``，
        前端按 event 字段分流，不新建 channel）；Redis 抖动只 warning，不影响已
        commit 的状态（gate_result / current_stage 已落库，SSE 漏发不回滚）。
        """
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(
                    {
                        "event": "stage_status_changed",
                        "agent_run_id": str(agent_run.id),
                        "change_id": str(change_id),
                        "stage": stage,
                        "status": status,
                    },
                    default=str,
                ),
            )
        except Exception:
            log.warning(
                "stage_status_changed_redis_publish_failed",
                agent_run_id=str(agent_run.id),
                change_id=str(change_id),
                stage=stage,
            )

    async def _resolve_gate_spec_root(
        self,
        gate_session: AsyncSession,
        workspace: "object",
        change: "object",
    ) -> tuple[str | None, str | None]:
        """解析 gate 的 ``(code_root, spec_dir)``（task-01 gate-cwd-specdir-fix）。

        返回二元组，分离 gate 的 cwd（跑测试）与 specBase（读 local.yaml/spec 产物）：

        - **code_root**：gate 跑测试的 cwd（项目代码根，有 backend/frontend 代码）。
        - **spec_dir**：gate 读 local.yaml/spec 产物的 specBase（via ``--spec-dir``）。

        daemon-client platform-managed/repo-mirrored：``code_root=workspace.root_path``
        + ``spec_dir=SpecWorkspace.spec_root``（平台 specDir）。
        repo-native/无 SpecWorkspace：``code_root=workspace.root_path`` + ``spec_dir=None``
        （gate specBase 走默认 ``resolveSpecDir(code_root)=code_root/.sillyspec``）。
        ``workspace.root_path`` 缺失返回 ``(None, None)``（caller 抛 RuntimeError 置
        gate_status=failed，fail-loud）。

        之前（P3 task-07）返回单个 ``spec_root`` 一肩挑两担（cwd 既跑测试又读
        local.yaml），daemon-client 平台模式下 cwd=specDir 跑不了测试 / cwd=代码根
        找不到 local.yaml（坑 3）。本变更分离，配合 sillyspec runGate cwd/specBase
        分离（machine-interface.js:107 + index.js:323 接线）。
        """
        from sqlmodel import col as _col

        from app.core.spec_paths import SpecPathResolver

        code_root = getattr(workspace, "root_path", None)
        if not code_root:
            return None, None
        code_root = str(code_root)

        try:
            from app.modules.spec_workspace.model import SpecWorkspace

            stmt = select(SpecWorkspace).where(
                _col(SpecWorkspace.workspace_id) == change.workspace_id
            )
            spec_ws = (await gate_session.execute(stmt)).scalars().first()
            if spec_ws is not None and spec_ws.strategy != "repo-native" and spec_ws.spec_root:
                # platform-managed：spec_root 本身即扁平根（SpecPathResolver
                # platform_managed=True 的 _spec_root() == self.root）；repo-mirrored
                # 同理（spec_root 为 daemon 同步的扁平快照根）。spec_dir 用它，
                # code_root 仍用 workspace.root_path（项目代码根，跑测试）。
                resolver = SpecPathResolver(
                    spec_ws.spec_root,
                    platform_managed=True,
                )
                return code_root, str(resolver._spec_root())
        except Exception as exc:
            log.warning(
                "gate_resolve_spec_root_spec_ws_failed",
                workspace_id=str(getattr(change, "workspace_id", None)),
                error=str(exc),
            )

        # repo-native / 无 SpecWorkspace：spec_dir=None（gate specBase 走默认
        # resolveSpecDir(code_root)=code_root/.sillyspec）。
        # 单一 daemon-client 模式（D-007@2026-07-10）：无 path_source 分流，
        # code_root 即 workspace.root_path，gate 自己解析 .sillyspec。
        return code_root, None

    # ── private helpers（随主方法归位，design §6 / §10 R6） ───────────────

    async def _trigger_stage_completion_callback(
        self,
        agent_run_id: uuid.UUID,
    ) -> None:
        """stage dispatch 的 AgentRun 完成后同步 sillyspec.db 视图并留痕待触发。

        形态A task-02（design §4.1 调用点③）：砍 single 分支的 auto_dispatch 自动
        连轴。single stage 完成后只 ``sync_stage_status``（更新 sillyspec.db 视图）
        + 发 ``stage_status_changed`` SSE 提示前端/agent 显式推进，current_stage 不
        自动前进，停在「阶段完成待触发」态。

        task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        后 path_source 形参已删，sync_stage_status 内部经 HostFsDelegate RPC 读
        sillyspec.db（D-004 / D-009），无 path_source 分流。

        仅对 stage dispatch（change_id 非空、status=completed）生效；scan
        （change_id=None）由 spec sync + scan_docs.reparse 单独回流，不走这里。
        team 分流（mission_id 非空 + team_mode）交 ``_handle_team_run_completion``
        → ``_advance_team_stage``（task-03），不在本分支。
        """
        from app.modules.change.dispatch import SillySpecStageDispatchService
        from app.modules.change.model import Change

        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is None or agent_run.change_id is None:
            return
        if agent_run.status != "completed":
            return

        change = await self._session.get(Change, agent_run.change_id)
        if change is None:
            return

        # team→change 生命周期修复（task-11 接线）：team-mission run（mission_id
        # 非空 + change.stages.team_mode=True）走 team 生命周期——schedule_loop 收敛
        # 兜底 + 收敛后桥接推进 stage。single stage run（mission_id=None）保持既有
        # sillyspec.db sync 路径不变（零回归）。team 工作由 worker 经 MCP 完成，不落
        # sillyspec.db step，故不能走 single 的 sync_stage_status（会读到
        # stage_completed=False 把变更卡在 execute/verify）。
        stages_peek = change.stages if isinstance(change.stages, dict) else {}
        if agent_run.mission_id is not None and stages_peek.get("team_mode") is True:
            try:
                await self._handle_team_run_completion(agent_run, change)
            except Exception as exc:
                log.warning(
                    "team_run_completion_handler_failed",
                    agent_run_id=str(agent_run_id),
                    change_id=str(agent_run.change_id),
                    mission_id=str(agent_run.mission_id),
                    error=str(exc),
                )
            return

        svc = SillySpecStageDispatchService(self._session)
        sync_result = await svc.sync_stage_status(
            self._session,
            agent_run.change_id,
            agent_run.id,
        )
        if not sync_result.synced:
            log.info(
                "stage_callback_sync_skipped",
                agent_run_id=str(agent_run_id),
                change_id=str(agent_run.change_id),
                error=sync_result.error,
            )
            return

        # 形态A task-02（design §4.1 调用点③）：砍 auto_dispatch_next_step 自动连轴。
        # single stage 完成后停在「阶段完成待触发」态，current_stage 不自动前进；
        # 发 stage_status_changed SSE 提示前端/agent 显式调 advance_change_stage 推进。
        await self._publish_stage_status_changed(
            agent_run,
            change_id=agent_run.change_id,
            stage=sync_result.current_stage,
            status="completed_pending_trigger",
        )
        log.info(
            "stage_callback_done",
            agent_run_id=str(agent_run_id),
            change_id=str(agent_run.change_id),
            stage=sync_result.current_stage,
        )

    async def _handle_team_run_completion(
        self,
        agent_run: AgentRun,
        change: Change,
    ) -> None:
        """team-mission run（worker 或 orchestrator）完成后：触发 schedule_loop
        收敛兜底（缺口 A）+ 收敛成功后桥接推进变更 stage（缺口 B）。

        缺口 A：``OrchestratorService.schedule_loop`` 是 team mission 后端收敛兜底
        （worker 全终态→收敛 / budget 触顶→强收），但 task-11 未接线、生产无调用方，
        主 agent 不主动 converge 时 mission 永久挂起。本方法在每次 team run 完成
        （worker / 主 agent）时调用它——schedule_loop 内部判条件，未达收敛返 None。

        缺口 B：team 工作由 worker 经 MCP 完成，不写 sillyspec.db step，single 的
        sync_stage_status 读到 stage_completed=False 不推进。收敛成功后本方法走
        ``_advance_team_stage`` 推进（execute→verify，verify→archive）。

        幂等：仅当 ``change.current_stage == team_stage`` 时推进；complete_stage 后
        current_stage 已变，后续重复触发（多 worker 依次完成）自然跳过，不重复推进。
        """
        from app.modules.agent.model import AgentMission
        from app.modules.agent.orchestrator import OrchestratorService

        mission = await self._session.get(AgentMission, agent_run.mission_id)
        if mission is None:
            return

        constraints = mission.constraints if isinstance(mission.constraints, dict) else {}
        team_stage = constraints.get("stage") or "execute"

        # 幂等护栏：change 已离开 team_stage（已被推进过 / 被其它路径改态）→ 跳过。
        if change.current_stage != team_stage:
            log.info(
                "team_run_completion_skip_stage_advanced",
                change_id=str(change.id),
                team_stage=team_stage,
                current_stage=change.current_stage,
            )
            return

        # 缺口 A：触发后端收敛兜底。返回 None = 本次未收敛（仍有 worker 在跑 / 未触顶）。
        orchestrator = OrchestratorService(self._session)
        mission_status = await orchestrator.schedule_loop(mission.id)
        if mission_status is None:
            return

        log.info(
            "team_run_completion_converged_advancing",
            change_id=str(change.id),
            mission_id=str(mission.id),
            team_stage=team_stage,
            mission_status=mission_status,
        )
        await self._advance_team_stage(change, mission, team_stage)

    async def _advance_team_stage(
        self,
        change: Change,
        mission: AgentMission,
        team_stage: str,
    ) -> None:
        """team mission 收敛后推进变更 stage（缺口 B / 形态A task-03，design §4.3）。

        形态A 砍 auto_dispatch 后，本方法是 team mission 收敛→change.current_stage
        推进的**唯一桥**，不能整个删。保留两件事：
          - ``merge_gate_results``：verify stage 合并 worker gate_results 落主 agent
            run.gate_result（gate 决策数据源，advance_change_stage tool / review 据此
            显式决策）。
          - ``ChangeService.complete_stage``：推进 current_stage + 落 pending_review
            （execute→verify / verify+passed→archive / archive→archived）。

        删除原 ``StageSyncResult`` 伪造 + ``auto_dispatch_next_step`` 自动 dispatch
        下一 stage 的整块（design §4.1 调用点④）——下一 stage team mission 交
        ``advance_change_stage`` MCP/HTTP tool 显式触发 ``_dispatch_execute_team``。
        推进完成后发 ``stage_status_changed`` SSE 留痕（team stage 已推进，下一 stage
        待显式触发）。

        幂等：由 ``_handle_team_run_completion`` 的 ``current_stage == team_stage``
        护栏保证（complete_stage 后 current_stage 已变，重复触发自然跳过）。
        """
        from app.modules.agent.control import MissionControlService
        from app.modules.change.dispatch import merge_gate_results
        from app.modules.change.service import ChangeService

        ctrl = MissionControlService(self._session)
        all_runs = await ctrl.worker_runs(mission.id)
        main_run = next((r for r in all_runs if r.role == "orchestrator"), None)

        # verify stage：合并 worker gate_results 落主 agent run，作为 gate 决策数据源
        # （对齐 task-07 single gate task：gate_status=decided + gate_result 落库）。
        # execute stage 无 gate（workers 产 patch 不产 gate_result）。
        # dict() copy 防 SQLAlchemy JSON 列原地改不标记 dirty（对齐 dispatch.py 模式）。
        stage_result: str | None = None
        if team_stage == "verify":
            worker_runs = [r for r in all_runs if r.role != "orchestrator"]
            gate_results = [r.gate_result for r in worker_runs if isinstance(r.gate_result, dict)]
            merged = merge_gate_results(gate_results)
            if main_run is not None:
                main_run.gate_result = dict(merged)
                main_run.gate_status = "decided"
                self._session.add(main_run)
                await self._session.commit()
                await self._session.refresh(main_run)
                log.info(
                    "team_verify_gate_merged",
                    change_id=str(change.id),
                    mission_id=str(mission.id),
                    merged_exit=merged.get("exit_code"),
                    worker_count=merged.get("worker_count"),
                )
            # verify → archive 需 result="passed"（_resolve_stage_completion）。
            # exit 0 视为 passed；非 0 不推进（stage_result 保持 None → complete_stage
            # verify+非 passed 返回 (verify, None)），change 停在 verify，交
            # advance_change_stage tool / review 显式决策（形态A：不自动 kickback/block）。
            if merged.get("exit_code") == 0:
                stage_result = "passed"

        # 桥：complete_stage 推进 current_stage + 落 pending_review（design §4.3）。
        # complete_stage 内部经 _resolve_stage_completion(stage, result) 决定 new_stage。
        cs = ChangeService(self._session)
        complete_result = await cs.complete_stage(
            workspace_id=change.workspace_id,
            change_id=change.id,
            stage=team_stage,
            result=stage_result,
            summary=None,
        )

        # 留痕 SSE：team stage 已推进（或 verify gate 未过停留），下一 stage 待显式触发。
        sse_run = main_run if main_run is not None else (all_runs[0] if all_runs else None)
        if sse_run is not None:
            await self._publish_stage_status_changed(
                sse_run,
                change_id=change.id,
                stage=complete_result.change.current_stage,
                status="completed_pending_trigger",
            )
        log.info(
            "team_stage_advanced",
            change_id=str(change.id),
            mission_id=str(mission.id),
            team_stage=team_stage,
            new_stage=complete_result.change.current_stage,
            dispatch_target=complete_result.dispatch_target,
        )

    async def _run_post_scan_validation(
        self,
        lease: DaemonTaskLease,
    ) -> None:
        """C: scan 完成后跑平台侧结构化校验（PostScanValidator）。

        task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        后 path_source 分流整段删除，delegate + workspace 无条件解析。path_source
        形参同步清除（complete_lease 调用方 task-09 已改无参透传）。

        消费 sillyspec 平台模式产出的结构化回执：manifest.json / platform-scan.json
        / postcheck-result / 源码污染检测 / 7 份 scan 文档齐全性。仅对 scan run
        （``AgentRun.change_id`` 为空且 ``spec_strategy == "platform-managed"``）触发；
        校验结果写入 ``lease.metadata['post_scan_validation']``，**不翻转** scan 的
        成功语义（避免破坏现有行为，仅做增强校验与留痕）。

        daemon-client 模式下 source_root 可能不在 server 本机，PostScanValidator
        内部以 ``exists()`` 容错；外层另有 try/except 保证不阻塞 lease 完成。
        """
        from app.modules.agent.post_scan_validator import PostScanValidator

        if not lease.agent_run_id:
            return
        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            return
        # 仅 scan run：无 change_id 且平台托管（stage run 走 _trigger_stage_completion_callback）
        if agent_run.change_id is not None:
            return
        if getattr(agent_run, "spec_strategy", None) != "platform-managed":
            return

        meta = dict(lease.metadata_ or {})
        source_root = meta.get("root_path")
        spec_root = meta.get("spec_root")
        runtime_root = meta.get("runtime_root") or (
            str(Path(spec_root) / "runtime") if spec_root else None
        )
        if not source_root or not spec_root or not runtime_root:
            log.info(
                "post_scan_validation_skipped_no_paths",
                lease_id=str(lease.id),
                has_root_path=bool(source_root),
                has_spec_root=bool(spec_root),
            )
            return

        # task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        # 后 path_source 分流整段删除（server-local 路径已废）。delegate + workspace
        # 无条件解析（复用 task-05 的 lazy facade + _resolve_lease_workspace），异常仍
        # 按 warning 降级到 delegate=None（NFR-02 零回归）。delegate 由 task-06 lazy
        # property 注入。
        delegate = None
        workspace = None
        if self._facade is not None:
            try:
                delegate = self._facade.host_fs_delegate
                workspace = await self._resolve_lease_workspace(lease)
            except Exception as exc:  # delegate 构造/workspace 反查不应中断 lease
                log.warning(
                    "post_scan_validation_delegate_unavailable",
                    lease_id=str(lease.id),
                    error=str(exc),
                )
                delegate = None
                workspace = None

        validator = PostScanValidator(
            source_root,
            spec_root,
            runtime_root,
            str(agent_run.id),
            delegate=delegate,
            workspace=workspace,
        )
        result = await validator.validate(agent_run.output_redacted or "", agent_run.exit_code or 0)
        meta["post_scan_validation"] = {
            "status": str(result.status.value),
            "has_errors": result.has_errors,
            "has_warnings": result.has_warnings,
            "errors": [
                {"code": e.code, "severity": e.severity, "message": e.message}
                for e in result.errors
            ],
            "warnings": [
                {"code": w.code, "severity": w.severity, "message": w.message}
                for w in result.warnings
            ],
            "metadata": result.metadata,
        }
        lease.metadata_ = meta
        flag_modified(lease, "metadata_")
        self._session.add(lease)
        await self._session.commit()

        log.info(
            "post_scan_validation_done",
            lease_id=str(lease.id),
            agent_run_id=str(agent_run.id),
            status=str(result.status.value),
            errors=len(result.errors),
            warnings=len(result.warnings),
        )

    async def _resolve_lease_workspace(self, lease: DaemonTaskLease):
        """反查 lease 关联 workspace（task-09 单一 daemon-client 模式）。

        链路同 lease/service.py:_resolve_lease_workspace_path_source：经 M:N
        关联表 AgentRunWorkspace。失败返回 None（不抛，caller 已 try/except
        兜底降级到 delegate=None，NFR-02 零回归）。
        """
        from sqlmodel import col

        from app.modules.workspace.model import AgentRunWorkspace, Workspace

        if lease.agent_run_id is None:
            return None
        ws_stmt = (
            select(AgentRunWorkspace.workspace_id)
            .where(col(AgentRunWorkspace.agent_run_id) == lease.agent_run_id)
            .limit(1)
        )
        ws_row = (await self._session.execute(ws_stmt)).first()
        if ws_row is None:
            return None
        return await self._session.get(Workspace, ws_row[0])

    async def _publish_run_event(
        self,
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
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run_id}",
                json.dumps(payload, default=str),
            )
        except Exception:
            log.warning(
                "publish_run_event_failed",
                agent_run_id=str(agent_run_id),
                redis_event=event,
            )


# ---------------------------------------------------------------------------
# Helpers (随 submit_messages 迁入，design §10 R2：私有辅助随主方法归位)
# ---------------------------------------------------------------------------


def _extract_sdk_messages(msg: dict) -> list[dict]:
    """Expand a raw SDK driver message (interactive mode) into one or more flat
    log messages ``{event_type, content, channel, ...}``.

    ql-006：interactive session（SDK driver）的 ``onTurnMessage`` 把 *原始* SDK
    message 直接发给后端，形状为 ``{type:"assistant"|"user", message:{role,
    content:[ContentBlock]}}``。与 batch mode 不同（task-runner ``_eventToMessages``
    已把每个 content block 拆成 [ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]
    行），interactive mode 把整块 block 数组交给后端。旧实现只拼 ``type=="text"``
    的 blocks，丢弃 thinking/tool_use/tool_result，导致 ``agent_run_logs`` 只有纯
    文本 stdout，前端 ToolCallCard / thinking 面板永不渲染。

    本函数 1:1 复现 ``sillyhub-daemon/dist/task-runner.js`` 的 ``_eventToMessages``
    （L980-1126）规则，让 interactive-mode 日志与 batch-mode 字节兼容：

      assistant.content:
        - ``text``       → 1× ``[ASSISTANT] <text>`` (stdout)
        - ``thinking``   → 1× ``[THINKING] <text[:20000]>`` (stdout)
        - ``tool_use``   → 2×: ``[TOOL_USE] <name>: <args>`` (stdout)
                           + ``{tool,args,timestamp,status,success}`` (tool_call)
      user.content:
        - ``tool_result`` → 1× ``[TOOL_RESULT] <content[:100000]>`` (stdout，超长追加截断标注)

    usage / session_id（真实 SDK 形态在 ``message.usage``，daemon 也可能透传到顶层）
    只注入到产出的*第一条* flat record，避免同一 SDK message 的多个 sibling block
    重复累加 usage。返回 ``[]`` 表示不可识别的形状（调用方视作跳过）。
    """
    sdk_type = msg.get("type")
    inner = msg.get("message")
    if not isinstance(sdk_type, str) or not isinstance(inner, dict):
        return []
    blocks = inner.get("content")
    if not isinstance(blocks, list):
        return []

    # Carried fields injected onto the FIRST produced record only.
    base: dict = {}
    inner_usage = inner.get("usage")
    if isinstance(inner_usage, dict):
        base["usage"] = inner_usage
    top_usage = msg.get("usage")
    if isinstance(top_usage, dict) and "usage" not in base:
        base["usage"] = top_usage
    session_id = msg.get("session_id") or inner.get("session_id")
    if isinstance(session_id, str) and session_id:
        base["session_id"] = session_id

    out: list[dict] = []
    stamped = False

    def stamp(rec: dict) -> dict:
        nonlocal stamped
        if not stamped and base:
            rec.update(base)
            stamped = True
        return rec

    # task-12 / D-002@v1 / FR-07 FR-08：thinking segmentId 去重 —— 完整 message
    # 展开时给每个 thinking block 标记 segmentId，让上层 submit_messages 能识别
    # "同 segment 的 partial 已 flush"并跳过重复行。
    # quick-9f86d2c3（会话 e87622aa）：格式从 ``${msg.id}:${block_index}`` 对齐为
    # daemon partial 的 task-13 格式 ``${parent}:${mid}:${type}``（type=text/thinking）——
    # 旧格式与 daemon partial（main:<mid>:text）永不匹配，submit_messages 判定 1/2
    # 与 _revoke_committed_partials 全部空转（partial 行永久滞留 DB 的根因之一）。
    # parent 前缀与 block type 与 daemon _resolveSegmentId / _extractCompletedSegments
    # 逐段对齐（同 message 多个同 type block 共享 segmentId——对齐 daemon 语义）。
    inner_msg_id = inner.get("id")
    msg_id = inner_msg_id if isinstance(inner_msg_id, str) and inner_msg_id else "unknown"
    _raw_parent = msg.get("parent_tool_use_id")
    parent_key = _raw_parent if isinstance(_raw_parent, str) and _raw_parent else "main"

    for b in blocks:
        if not isinstance(b, dict):
            continue
        btype = b.get("type")

        if btype == "text":
            text = str(b.get("text", "") or "")
            if text:
                out.append(
                    stamp(
                        {
                            "event_type": "text",
                            "content": f"[ASSISTANT] {text}",
                            "channel": "stdout",
                            # task-08：完整 assistant 文本行标记 segmentId + isComplete，
                            # 让 submit_messages 识别 [ASSISTANT_OVERRIDE] 信号后丢弃/回退
                            # 同 segment 的 assistant partial（对齐 thinking :1847-1866）。
                            # assistant 文本不带 thinking:True（仅 thinking block 才打该
                            # 标记），让 daemon 端 / submit_messages 能区分两类 segment。
                            "metadata": {
                                "segmentId": f"{parent_key}:{msg_id}:text",
                                "isComplete": True,
                            },
                        }
                    )
                )

        elif btype == "thinking":
            text = str(b.get("thinking", b.get("text", "")) or "")
            if text:
                preview = text[:20000] + ("..." if len(text) > 20000 else "")
                out.append(
                    stamp(
                        {
                            "event_type": "text",
                            "content": f"[THINKING] {preview}",
                            "channel": "stdout",
                            # task-12：完整 thinking 行标记 segmentId + isComplete，
                            # 让 submit_messages 单次调用内丢弃同 segment 的 partial。
                            "metadata": {
                                "thinking": True,
                                "segmentId": f"{parent_key}:{msg_id}:thinking",
                                "isComplete": True,
                            },
                        }
                    )
                )

        elif btype == "tool_use":
            name = str(b.get("name", "") or "unknown") or "unknown"
            raw_input = b.get("input")
            input_obj = raw_input if isinstance(raw_input, dict) else {}
            # task-13 / D-002@v1：提取 tool_use_id（SDK tool_use block 的 id，toolu_xxx）。
            # Anthropic API 标准 assistant message content block 在 type=tool_use 时带
            # id 字段（如 "toolu_01abc..."）。仅非空字符串才采用；缺失 → ""
            # （退化，前端 normalize 回退 ±3 窗口，task-14 范围）。
            raw_id = b.get("id")
            tool_use_id = raw_id if isinstance(raw_id, str) and raw_id else ""
            # stdout text line：command 优先，否则整体 JSON（对齐 task-runner L1068-1083）
            cmd = str(input_obj.get("command", "") or "")
            if cmd:
                args_line = cmd
            else:
                try:
                    args_line = json.dumps(input_obj)
                except (TypeError, ValueError):
                    args_line = ""
            stdout_content = f"[TOOL_USE] {name}: {args_line}"[:20000]
            out.append(
                stamp(
                    {
                        "event_type": "tool_use",
                        "content": stdout_content,
                        "channel": "stdout",
                    }
                )
            )
            # 第二条：tool_call channel 的 JSON，前端 parseToolCallContent 渲染
            # ToolCallCard（对齐 task-runner.js L1091-1115 的 tc_content 格式）。
            # task-13：补 tool_use_id 字段（snake_case，对齐 Anthropic API 命名 +
            # task-runner 一致），让前端 normalize 全局配对（task-14）。
            ts = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            tc_payload: dict = {
                "tool": name,
                "args": input_obj,
                "timestamp": ts,
                "status": "allowed",
                "success": True,
            }
            # tool_use_id 仅非空时携带（省略 vs null 均可让前端 hasOwnProperty 判断
            # "无 id" 分支）。用条件注入省略字段，退化路径保持原形状。
            if tool_use_id:
                tc_payload["tool_use_id"] = tool_use_id
            try:
                tc_json = json.dumps(tc_payload)
            except (TypeError, ValueError):
                tc_payload["args"] = {}
                tc_json = json.dumps(tc_payload)
            # 2026-07-05-agent-log-type-tags task-04 / FR-04：interactive 路径
            # tool_use 打标。从 SDK block 的 name + input 调 classify_tool_kind（task-02）
            # 识别，结果挂到 tool_call JSON 那条 flat record 顶层 tool_kind 字段（与
            # event_type/content/channel 同级），后续 submit_messages 落库 +
            # publish payload 都从 msg.get("tool_kind") 取（FR-05/06）。
            # 配对的 stdout [TOOL_USE] 文本行不带 tool_kind（design §5 Phase 2）。
            # 防御：classify_tool_kind 在 bash + args.command 非 str（list/dict）
            # 时 "sillyspec" in cmd 会抛 TypeError，包 try/except 静默退 None。
            try:
                tool_kind = classify_tool_kind(name, input_obj)
            except Exception:
                tool_kind = None
            # ql-20260706-002：tool_use_id 挂到 flat record *顶层*（不止 tc_payload
            # JSON 内），让 submit_messages 登记 tool_use_id → tool_kind 缓存，供配对
            # 的 tool_result 行继承（d751a871 根因：命令输出 [TOOL_RESULT] 漏 tool_kind
            # 致前端 SillySpec 筛选看不到 sillyspec 的 ✅ Step 进度）。tool_use_id 仅
            # 非空时携带（与 tc_payload 内字段同步，退化路径保持原形状）。
            tc_record: dict = {
                "event_type": "tool_use",
                "content": tc_json,
                "channel": "tool_call",
                "tool_kind": tool_kind,
            }
            if tool_use_id:
                tc_record["tool_use_id"] = tool_use_id
            out.append(tc_record)

        elif btype == "tool_result":
            # tool_result content 可能是 str 或 [{type:"text",text:...}] blocks
            raw = b.get("content")
            if isinstance(raw, list):
                parts = []
                for rb in raw:
                    if isinstance(rb, dict):
                        parts.append(str(rb.get("text", "")))
                    else:
                        parts.append(str(rb))
                text = "".join(parts)
            else:
                text = str(raw or "")
            # ql-20260706-002：tool_result block 自带 tool_use_id（Anthropic API 标准，
            # user message content 里 {type:"tool_result", tool_use_id:"toolu_xxx", ...}），
            # 提取挂到 flat record 顶层，让 submit_messages 回查 tool_use→tool_kind 缓存
            # 继承配对命令调用的 tool_kind（d751a871 根因修复）。
            raw_tuid = b.get("tool_use_id")
            result_tool_use_id = raw_tuid if isinstance(raw_tuid, str) and raw_tuid else ""
            if text:
                # ql-20260709-001：放宽截断上限（3000→TOOL_RESULT_MAX_CHARS），
                # 超长追加中文标注，保留"已截断 + 原始长度"信息供前端展示。
                if len(text) > TOOL_RESULT_MAX_CHARS:
                    body = (
                        text[:TOOL_RESULT_MAX_CHARS]
                        + f"\n...(输出过长，已截断，共 {len(text)} 字符)"
                    )
                else:
                    body = text
                rec: dict = {
                    "event_type": "tool_result",
                    "content": f"[TOOL_RESULT] {body}",
                    "channel": "stdout",
                }
                if result_tool_use_id:
                    rec["tool_use_id"] = result_tool_use_id
                # ql-20260824-020：Edit 真实文件行号透传。SDK 把 Edit 结果放在
                # ``msg.tool_use_result.structuredPatch``（hunks 带 oldStart/newStart
                # 文件内行号），原实现只读 content 丢弃该字段。此处读出来序列化成
                # ``edit_patch`` JSON 挂到 flat record 顶层，供前端 Edit 展开渲染
                # 带文件内真实行号的 diff（缺则前端回退 LCS 自算）。仅 Edit（有
                # structuredPatch）才附加，Bash/Read 等零变化。
                tur = msg.get("tool_use_result")
                if isinstance(tur, dict):
                    patch = tur.get("structuredPatch")
                    if isinstance(patch, list) and patch:
                        try:
                            rec["edit_patch"] = json.dumps(patch, ensure_ascii=False)
                        except (TypeError, ValueError):
                            pass
                out.append(stamp(rec))

    # 2026-06-28-daemon-subagent-transcript task-08 / D-008@v1（Grill X-001）：
    # 归属字段（parent_tool_use_id/subagent_type/depth）从 msg 顶层读，注入到*每条*
    # flat record——归属是 message 级属性，同一 SDK message 的所有 content block
    # （text/thinking/tool_use/tool_result）同属一个子代理，每行 log 都要带归属
    # （否则同 message 展开多行归属不一致：thinking 行有归属、紧随 text 行 NULL）。
    # 与 usage/session_id 区分：后者是 message 级聚合量，仍走 stamp() 仅首条避免重复
    # 累加；归属不经 stamp，循环后统一写入每条。主 agent（parent=null）→ attribution
    # 空 → 不注入 → 落库三列 NULL（brownfield 兼容，design §9）。
    attribution: dict = {}
    _raw_ptui = msg.get("parent_tool_use_id")
    if isinstance(_raw_ptui, str) and _raw_ptui:
        attribution["parent_tool_use_id"] = _raw_ptui
    _raw_st = msg.get("subagent_type")
    if isinstance(_raw_st, str) and _raw_st:
        attribution["subagent_type"] = _raw_st
    _raw_depth = msg.get("depth")
    if isinstance(_raw_depth, int) and not isinstance(_raw_depth, bool):
        attribution["depth"] = _raw_depth
    if attribution:
        for _rec in out:
            _rec.update(attribution)

    return out


def _channel_from_event_type(event_type: str) -> str:
    """Map daemon AgentEvent type to AgentRunLog channel.

    ql-20260616-003：daemon 的 _eventToMessage 不发 channel 字段（只发 event_type），
    后端按事件类型补全 channel，让前端 SSE 实时流能正确渲染 TOOL/WARN/INFO 徽章。

    Args:
        event_type: daemon AgentEvent.type，5 种取值之一
            （text / tool_use / tool_result / error / complete）。

    Returns:
        AgentRunLog channel：tool_call / stderr / stdout 之一。
    """
    if event_type in ("tool_use", "tool_result"):
        return "tool_call"
    if event_type == "error":
        return "stderr"
    return "stdout"
