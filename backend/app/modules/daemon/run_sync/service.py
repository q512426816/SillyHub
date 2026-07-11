"""RunSync subdomain service — agent run status sync / interactive run closure.

Owns the AgentRun state machine (sync / close / messages / post-scan). Migrated
verbatim from DaemonService in change 2026-06-22-daemon-service-split (W4,
task-04). Behavior unchanged; see design §7.5 AgentRun status-sync lifecycle
table.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.tool_kind import classify_tool_kind
from app.modules.change import dispatch as _change_dispatch
from app.modules.change.dispatch import (
    SillySpecStageDispatchService,
    _run_gate_via_delegate,
)
from app.modules.daemon.lease.service import DaemonAgentRunNotFound
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES
from app.modules.git_gateway.service import redact_output

if TYPE_CHECKING:
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)


# ql-20260709-001：tool_result 命令输出截断上限（原 3000 → 100000）。
# 3000 字符会砍掉 scan / 构建 / 测试命令输出的关键尾部（含大量长路径行，
# 如 sillyspec scan 一次输出 59 行），用户在前端只能看到前几行、后面全丢。
# 100000（约 2000 行）覆盖绝大多数命令输出；超长追加中文标注保留原始长度
# 信息。daemon task-runner.ts 的 batch 路径同步对齐（原同样 3000 截断）。
TOOL_RESULT_MAX_CHARS = 100_000


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
    agent_session_id: uuid.UUID | None
    timestamp_iso: str


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
    try:
        redis = get_redis()
        channel_name = f"agent_run:{intent.agent_run_id}"
        for log_payload in intent.published_logs:
            await redis.publish(channel_name, json.dumps(log_payload))
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
        await redis.publish(channel_name, json.dumps(summary_payload))
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
            }
            await redis.publish(session_channel, json.dumps(session_payload))
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
            await redis.publish(session_channel, json.dumps(token_payload, default=str))
    except Exception:
        log.warning(
            "daemon_messages_session_redis_publish_failed",
            lease_id=str(intent.lease_id),
            agent_run_id=str(intent.agent_run_id),
            agent_session_id=str(intent.agent_session_id),
        )


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
            if segment_id and not is_partial and segment_id in flushed_partials:
                stale = flushed_partials.pop(segment_id)
                # 对象仅 session.add（pending，未 flush），expunge 撤销待插入即可
                # （不写库）。session.delete 要求对象已 persisted 会抛错，故走 expunge。
                self._session.expunge(stale)
                count -= 1
                published_logs = [p for p in published_logs if p["log_id"] != str(stale.id)]

            # task-12 去重判定 2：partial 到达时，若同 segment 已见完整行 / override
            # 信号（completed_segments 命中），直接跳过 INSERT + publish（late partial
            # 场景，乱序兜底）。
            if segment_id and is_partial and segment_id in completed_segments:
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
            log_entry = AgentRunLog(
                id=log_id,
                run_id=agent_run_id,
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
                }
            )

            # 登记本 segment 的状态：
            # - partial 行：记入 flushed_partials，等完整行到达时回退。
            # - 完整行：加入 completed_segments，让本调用内后到的同 segment partial
            #   被跳过（完整先到、partial 后到的乱序兜底）。
            if segment_id and is_partial:
                flushed_partials[segment_id] = log_entry
            elif segment_id and not is_partial:
                completed_segments.add(segment_id)

        # Sync AgentRun status: pending -> running on first messages
        agent_run_status: str | None = None
        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is not None:
            agent_run_status = agent_run.status
            if agent_run.status == "pending":
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
            # ql-20260617-001：session_id 实时写回（首次拿到就填，complete_lease 仍可覆盖）。
            if latest_session_id and not agent_run.session_id:
                agent_run.session_id = latest_session_id
                self._session.add(agent_run)

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
                agent_session_id=publish_session_id,
                timestamp_iso=now.isoformat().replace("+00:00", "Z"),
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

        Raises ``DaemonAgentRunNotFound`` when the run does not exist or is not
        bound to the lease's session (resource-hiding 404 — no existence leak).
        """
        lease = await self._facade._get_lease_and_verify_token(lease_id, claim_token)
        lease_meta = lease.metadata_ or {}
        bound_session_id_raw = lease_meta.get("session_id")

        agent_run = await self._session.get(AgentRun, run_id)
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
        # task-05 / M2（design §5.1 / §170）：verify 等 stage dispatch（change_id
        # 非空）成功完成时，gate_status='pending' 随终态一起 commit 落库（与
        # status/finished_at 同一 commit，gate 任务读到一致快照）。change_id=None
        # 的对话 turn 或 failed run 不进入 gate 流程（守门）。gate 决策由 task-07
        # 后台任务 cas running→decided/failed 推进。
        if agent_run.change_id is not None and agent_run.status == "completed":
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
        if result_summary:
            # Redact via git_gateway redact_output to avoid leaking secrets in
            # the stored summary (mirrors batch completeLease path).
            try:
                agent_run.output_redacted = redact_output(result_summary)
            except Exception:
                agent_run.output_redacted = result_summary[:50000]

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

        # task-05 / design §5.1：commit 后 enqueue gate 决策后台任务并立即返回 HTTP
        # （<30s，daemon notifyRunResult 不重试）。仅 change_id 非空 + completed 场景
        # enqueue（gate 只核验完成的 verify turn；对话 turn/failed 不进 gate）。不 await
        # gate 任务 —— _fire_background_task（task-03 / H4）创建 asyncio.Task 持强引用
        # 防静默 GC，enqueue 失败异常由 add_done_callback 兜底，不影响已 commit 终态行。
        # workspace_id 从 Change.workspace_id 推导（对齐 _trigger_stage_completion_callback
        # :1029 的稳定来源；AgentSession.workspace_id 亦可选，但 Change 更直接且 stage
        # run 必有 change）。task-07（Wave 3）替换 _run_gate_decision_task stub 实现真实
        # gate 决策（H1 独立 session + R3 cas + 跑 gate + 存 result + H2 内联 sync/auto_dispatch）。
        if agent_run.change_id is not None and agent_run.status == "completed":
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

        log.info(
            "interactive_run_closed",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=agent_run.status,
            sdk_status=status,
            is_error=is_error,
            subtype=subtype,
        )
        return agent_run

    # ── Driver Gate enqueue helpers（task-05 / design §5.1） ─────────────────

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
        task-01 HostFsDelegate.run_command）→ 存 gate_result + decided → 内联推进
        stage（H2 sync_stage_status + auto_dispatch_next_step，用 gate_session，**不调**
        _trigger_stage_completion_callback）→ 异常 fail-loud（failed + exit 2）。

        四条硬约束（design §10 R5-R7）：
          - **H1**：``async with get_session_factory()() as gate_session`` 独立 session。
            RunSyncService.__init__ 只接注入 session 无 session_factory 字段，后台任务
            生命周期独立于 HTTP 请求 session（R6）。全程禁用 ``self._session``。
          - **R3**：``UPDATE ... WHERE gate_status='pending'`` 原子 cas，
            ``result.rowcount == 0`` 直接 return（防 reconcile + 原任务 double-enqueue，
            R10）。生产 PG 原子可靠；SQLite 测试用真 UPDATE 验 rowcount（R9）。
          - **H2**：``SillySpecStageDispatchService(gate_session)`` 构造让内联调用用
            gate_session；绝不调 ``_trigger_stage_completion_callback``（它写死
            ``self._session``，gate 任务没有它，R7）。
          - **H4**：由 task-05 close_interactive_run 经 ``_fire_background_task`` enqueue
            （强引用 ``_background_tasks`` set 防 GC + ``add_done_callback`` 取异常防静默）。

        失败语义（design §7 异常分支）：任何异常 → ``gate_status='failed'`` +
        ``gate_result={'exit_code': 2, 'errors': [str(exc)], 'raw_envelope': {}}`` + commit
        （fail-loud 不降级，不吞异常）。auto_dispatch_next_step 据 gate_result.exit_code
        决策（0 推进 / 1 打回 / 2 卡住，design §5.4）。
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

                # H2：内联 sync_stage_status + auto_dispatch_next_step，用同一 gate_session。
                # 构造 SillySpecStageDispatchService(gate_session) 让内部分流也用 gate_session；
                # sync_stage_status 首参显式传 gate_session（参数列表要求 session，design §7）。
                # **不调 _trigger_stage_completion_callback**（它写死 self._session，R7）。
                dispatch_svc = SillySpecStageDispatchService(gate_session)
                sync_result = await dispatch_svc.sync_stage_status(
                    gate_session,
                    change_id,
                    agent_run_id,
                )
                # user_id：对齐 _trigger_stage_completion_callback 的回退策略
                # （change.owner_id → 零 UUID）。
                user_id = change.owner_id or uuid.UUID(int=0)
                # auto_dispatch_next_step 经模块属性引用（``_change_dispatch.``）调用，
                # 让单测 patch ``app.modules.change.dispatch.auto_dispatch_next_step``
                # 生效（模块级 ``from`` 导入会固化原函数引用，patch dispatch 模块属性
                # 不影响已绑定的本地名）。design §5.4：据 gate_result.exit_code 决策。
                await _change_dispatch.auto_dispatch_next_step(
                    session=gate_session,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    user_id=user_id,
                    sync_result=sync_result,
                )
                await gate_session.commit()

                # task-11 / design §5.7：gate_result 已 commit + gate_status=decided 落库后，
                # 发 gate_status_changed SSE 通知前端更新徽标（复用 agent_run:{id} channel，
                # 对齐 close_interactive_run 的 try/except 容错模式）。
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
        """A2: stage dispatch 的 AgentRun 完成后同步 sillyspec.db 并推进下一阶段。

        task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        后 path_source 形参已删，sync_stage_status 内部经 HostFsDelegate RPC 读
        sillyspec.db（D-004 / D-009），无 path_source 分流。

        仅对 stage dispatch（change_id 非空、status=completed）生效；scan
        （change_id=None）由 spec sync + scan_docs.reparse 单独回流，不走这里。
        调用范式对齐 reconcile_stale_runs（dispatch.py:466-483）。
        """
        from app.modules.change.dispatch import (
            SillySpecStageDispatchService,
            auto_dispatch_next_step,
        )
        from app.modules.change.model import Change

        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is None or agent_run.change_id is None:
            return
        if agent_run.status != "completed":
            return

        change = await self._session.get(Change, agent_run.change_id)
        if change is None:
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

        # user_id：对齐 reconcile_stale_runs 的回退策略（change.owner_id → 零 UUID）。
        user_id = change.owner_id or uuid.UUID(int=0)
        await auto_dispatch_next_step(
            session=self._session,
            workspace_id=change.workspace_id,
            change_id=agent_run.change_id,
            user_id=user_id,
            sync_result=sync_result,
        )
        log.info(
            "stage_callback_done",
            agent_run_id=str(agent_run_id),
            change_id=str(agent_run.change_id),
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
    # 展开时给每个 thinking block 标记 segmentId = ${msg.id}:${block_index}，让上层
    # submit_messages 能识别"同 segment 的 partial 已 flush"并跳过重复行。msg.id
    # 来自 SDK message_start 事件（Anthropic 标准 assistant message id），同 turn
    # 内稳定；block_index 是 content 数组下标，同一 message 内多个 thinking block
    # 各自独立 segment。msg.id 缺失时退化为 "unknown:<idx>"（仍可去重，只是跨 turn
    # 可能撞 id，前端 normalize 兜底覆盖）。design §5.3 D1/D2 / task-11 契约。
    inner_msg_id = inner.get("id")
    msg_id = inner_msg_id if isinstance(inner_msg_id, str) and inner_msg_id else "unknown"

    for idx, b in enumerate(blocks):
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
                                "segmentId": f"{msg_id}:{idx}",
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
