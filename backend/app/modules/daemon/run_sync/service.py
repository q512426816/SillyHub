"""RunSync subdomain service — agent run status sync / interactive run closure.

Owns the AgentRun state machine (sync / close / messages / post-scan). Migrated
verbatim from DaemonService in change 2026-06-22-daemon-service-split (W4,
task-04). Behavior unchanged; see design §7.5 AgentRun status-sync lifecycle
table.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.lease.service import DaemonAgentRunNotFound
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES
from app.modules.git_gateway.service import redact_output

if TYPE_CHECKING:
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)


class RunSyncService:
    """AgentRun 状态同步子 service。构造接 AsyncSession。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 跨子域辅助：W4 早于 W5(session)/W6(lease)，_get_lease_and_verify_token
        # 与 _publish_session_event 仍在 facade（task-05/06 才迁）。持有 facade
        # 引用反向委托（design §7.2），task-05/06 落位后 facade 保留委托，本引用
        # 继续工作（委托到对应子 service），不耦合 Wave 顺序。
        self._facade: DaemonService | None = None

    # ── public ────────────────────────────────────────────────────────────

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> int:
        """Submit agent conversation messages for a lease.

        Writes to AgentRunLog, syncs AgentRun status, and publishes via Redis
        pub/sub. Returns the number of messages written.
        """
        await self._facade._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        count = 0
        published_logs: list[dict] = []
        # ql-20260617-001：daemon _eventToMessages 把 usage/session_id 透传到首条
        # message（task-runner.ts:1142-1155），但首条 message 总有 content（[ASSISTANT]/
        # [TOOL_USE]/[TOOL_RESULT] 等），所以「仅在 content 为空时提取 usage」的旧分支
        # 永远走不到。现在对所有 message 都提取 usage/session_id（取 max 防御乱序）。
        # ql-20260617-003：Claude CLI stream-json 的中间 assistant 事件 usage 永远是
        # {input_tokens:0, output_tokens:0}（只在最终 result 事件才有真实值）。
        # 所以 daemon 透传的 usage 经常是 0/0 —— 我们把它当成"无数据"，不覆盖
        # AgentRun 已有的非零值（complete_lease 路径会用 result 事件的真实值覆盖）。
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
                if isinstance(in_tok, (int, float)) and int(in_tok) > 0:
                    latest_input_tokens = max(latest_input_tokens or 0, int(in_tok))
                if isinstance(out_tok, (int, float)) and int(out_tok) > 0:
                    latest_output_tokens = max(latest_output_tokens or 0, int(out_tok))
                if isinstance(cache_read_tok, (int, float)) and int(cache_read_tok) > 0:
                    latest_cache_read_tokens = max(
                        latest_cache_read_tokens or 0, int(cache_read_tok)
                    )
                if isinstance(cache_creation_tok, (int, float)) and int(cache_creation_tok) > 0:
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
            log_entry = AgentRunLog(
                id=log_id,
                run_id=agent_run_id,
                timestamp=now,
                channel=channel,
                content_redacted=content[:5000],
                dedup_key=dedup_key,
            )
            self._session.add(log_entry)
            count += 1
            published_logs.append(
                {
                    "log_id": str(log_id),
                    "channel": channel,
                    "content": content[:5000],
                    "timestamp": now.isoformat().replace("+00:00", "Z"),
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

        if count > 0 or (agent_run is not None and agent_run_status == "running"):
            await self._session.commit()

        # ql-20260616-003：每条已持久化的 log 单独 publish 成扁平 StreamLogEvent
        # 形态（{channel, content, timestamp, log_id}），前端 SSE onmessage 直接当
        # StreamLogEvent 用，无需识别 {event:"messages"} 包装。仍保留一条聚合
        # messages 事件做计数/审计（event 字段区分）。
        try:
            redis = get_redis()
            channel_name = f"agent_run:{agent_run_id}"
            for log_payload in published_logs:
                await redis.publish(channel_name, json.dumps(log_payload))
            summary_payload: dict = {
                "event": "messages",
                "lease_id": str(lease_id),
                "count": count,
            }
            if agent_run_status is not None:
                summary_payload["agent_run_status"] = agent_run_status
            # ql-20260621：实时 token 透传到 run channel summary（与下方 session
            # channel 的 tokens 事件同源）。订阅 agent_run:{run_id} 的 SSE 客户端
            # 也能拿到累积 token，不必等 close。
            if agent_run is not None:
                if agent_run.input_tokens is not None:
                    summary_payload["input_tokens"] = agent_run.input_tokens
                if agent_run.output_tokens is not None:
                    summary_payload["output_tokens"] = agent_run.output_tokens
            await redis.publish(channel_name, json.dumps(summary_payload))
        except Exception:
            log.warning(
                "daemon_messages_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )

        # task-06 / D-005@v1 / FR-03：interactive run 双 publish —— 保留上面
        # agent_run:{run_id} 不变，同时把每条扁平 log 以带 run_id 标记的事件
        # 发布到 session 级 channel ``agent_session:{session_id}``，让单条 SSE
        # 连接跨多个 turn 不断流。batch run（agent_session_id IS NULL）跳过。
        # 独立 try/except：session publish 失败不得破坏 run channel 或回滚已
        # 提交的 AgentRunLog（AC-06）；Redis Pub/Sub 无历史，丢失实时事件不
        # 影响 DB 真相，前端重连即续流。
        if agent_run is not None and agent_run.agent_session_id is not None:
            try:
                redis = get_redis()
                session_channel = f"agent_session:{agent_run.agent_session_id}"
                for log_payload in published_logs:
                    session_payload = {
                        "event": "log",
                        "session_id": str(agent_run.agent_session_id),
                        "run_id": str(agent_run_id),
                        "log_id": log_payload["log_id"],
                        "channel": log_payload["channel"],
                        "content": log_payload["content"],
                        "timestamp": log_payload["timestamp"],
                    }
                    await redis.publish(session_channel, json.dumps(session_payload))
                # ql-20260621：实时 token 透传到 session channel。DB 里 AgentRun
                # 的 input_tokens/output_tokens 在上方（1180-1189）已按「仅增不减」
                # 更新并 commit，这里把它推给前端 SSE onTokens，让 UI 执行过程中
                # 实时显示累积输入/输出词元，不必等 turn_completed / close 才有值。
                # 与 run channel 的 summary_payload 同源（同一个 agent_run 对象）。
                if agent_run.input_tokens is not None or agent_run.output_tokens is not None:
                    token_payload: dict = {
                        "event": "tokens",
                        "session_id": str(agent_run.agent_session_id),
                        "run_id": str(agent_run_id),
                        "timestamp": now.isoformat().replace("+00:00", "Z"),
                    }
                    if agent_run.input_tokens is not None:
                        token_payload["input_tokens"] = agent_run.input_tokens
                    if agent_run.output_tokens is not None:
                        token_payload["output_tokens"] = agent_run.output_tokens
                    await redis.publish(session_channel, json.dumps(token_payload, default=str))
            except Exception:
                log.warning(
                    "daemon_messages_session_redis_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(agent_run_id),
                    agent_session_id=str(agent_run.agent_session_id),
                )

        log.info(
            "daemon_messages_submitted",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            count=count,
            agent_run_status=agent_run_status,
        )
        return count

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

        agent_run.finished_at = now
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
                agent_run.output_redacted = result_summary[:4000]

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

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

    # ── private helpers（随主方法归位，design §6 / §10 R6） ───────────────

    async def _trigger_stage_completion_callback(self, agent_run_id: uuid.UUID) -> None:
        """A2: stage dispatch 的 AgentRun 完成后同步 sillyspec.db 并推进下一阶段。

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
        sync_result = await svc.sync_stage_status(self._session, agent_run.change_id, agent_run.id)
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

    async def _run_post_scan_validation(self, lease: DaemonTaskLease) -> None:
        """C: scan 完成后跑平台侧结构化校验（PostScanValidator）。

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

        validator = PostScanValidator(source_root, spec_root, runtime_root, str(agent_run.id))
        result = validator.validate(agent_run.output_redacted or "", agent_run.exit_code or 0)
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
        - ``thinking``   → 1× ``[THINKING] <text[:2000]>`` (stdout)
        - ``tool_use``   → 2×: ``[TOOL_USE] <name>: <args>`` (stdout)
                           + ``{tool,args,timestamp,status,success}`` (tool_call)
      user.content:
        - ``tool_result`` → 1× ``[TOOL_RESULT] <content[:3000]>`` (stdout)

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
                preview = text[:2000] + ("..." if len(text) > 2000 else "")
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
            stdout_content = f"[TOOL_USE] {name}: {args_line}"[:2000]
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
            out.append(
                {
                    "event_type": "tool_use",
                    "content": tc_json,
                    "channel": "tool_call",
                }
            )

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
            if text:
                out.append(
                    stamp(
                        {
                            "event_type": "tool_result",
                            "content": f"[TOOL_RESULT] {text[:3000]}",
                            "channel": "stdout",
                        }
                    )
                )

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
