"""Tests for AgentEvent v2 新轨落库分支 in run_sync（task-07 / FR-03 / D-001@v1）。

变更 2026-09-03-agent-provider-abstraction task-07：backend submit_messages 双轨
接收——识别 ``kind='agent_event'`` 消息 → ``_persist_agent_event`` 展开为与旧轨
``_extract_sdk_messages`` 同款的 flat record，交既有落库循环消费（文本行前缀
逐字一致 + 结构化列 + ``metadata_['agent_event']`` + override 撤回 + usage 实时
+ session pin 无行化）；无 kind 键消息走原路径（兼容轨，D-001@v1）。

本文件用合成载荷驱动（daemon 侧 task-09 才接线，分支在 daemon 升级前休眠），
覆盖：

- 每型事件落库断言（列值 + 文本行前缀逐字 + metadata_.agent_event）：
  text→[ASSISTANT] / thinking→[THINKING]（截断一致）/ tool_use 双写（stdout
  [TOOL_USE] command 优先 + tool_call JSON + tool_kind）/ tool_result→[TOOL_RESULT]
  （edit_patch）/ error→stderr 原文 / status+turn_result 无文本行；
- 与 _extract_sdk_messages 的逐字 parity（同一 SDK 消息两轨展开签名相等）；
- override（D-004@v1）撤回后无 partial 残留 + stale 信封；
- usage（D-003@v1 实时语义，含 partial / usage-only 空事件）更新 run 统计 +
  SSE summary（input/output/cache_*/ctx_tokens）；
- session pin（status/session_started）更新 resume 指针且无行化；
- dedup_key 幂等；
- 旧形态（无 kind）消息回归（flat + SDK raw 双形状 + 混批共存 + SSE 无键零影响）。

测试模式对齐 test_run_sync_assistant_override.py（submit_messages via
DaemonService facade，db_session fixture + mocked_redis + lease helper）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_run_sync_assistant_override.py） ────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"agent-ev-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    _install_pipeline_fake(redis)
    return redis


def _install_pipeline_fake(redis: AsyncMock) -> AsyncMock:
    """ql-20260826-011：给 AsyncMock redis 补 pipeline() 假件（对齐 override 测试）。"""
    pipe_publish = MagicMock()

    class _FakePipeline:
        def publish(self, channel: str, payload: str) -> None:
            pipe_publish(channel, payload)

        async def execute(self) -> list:
            return []

    redis.pipeline = MagicMock(return_value=_FakePipeline())
    redis.pipe_publish = pipe_publish
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_batch_run_for_submit(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Build an active batch-style lease + run + claim_token（对齐 override 测试）。"""
    import secrets

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="oneshot",
        )
    )
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=run_id,
        kind="batch",
        status="pending",
        lease_expires_at=None,
        metadata_={"claim_token": secrets.token_hex(32)},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.commit()
    meta = lease.metadata_ or {}
    return lease.id, run_id, meta["claim_token"]


async def _seed_interactive_run_for_submit(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Build a lease + run 带 agent_session_id（interactive 形态，session pin 用）。

    返回 (lease_id, run_id, claim_token)；会话 id 经 db_session 查询获取。
    """
    import secrets

    from app.modules.agent.model import AgentSession

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=session_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=0,
            runtime_id=rt.id,
            created_at=datetime.now(UTC),
            last_active_at=datetime.now(UTC),
        )
    )
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=session_id,
        )
    )
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=run_id,
        kind="batch",
        status="pending",
        lease_expires_at=None,
        metadata_={"claim_token": secrets.token_hex(32)},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.commit()
    meta = lease.metadata_ or {}
    return lease.id, run_id, meta["claim_token"]


async def _fetch_session_row(
    db_session: AsyncSession, run_id: uuid.UUID
) -> tuple[AgentRun, object]:
    from app.modules.agent.model import AgentSession

    run = await db_session.get(AgentRun, run_id)
    assert run is not None and run.agent_session_id is not None
    session_row = await db_session.get(AgentSession, run.agent_session_id)
    assert session_row is not None
    return run, session_row


async def _fetch_logs(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    return list(
        (
            await db_session.execute(
                select(AgentRunLog)
                .where(AgentRunLog.run_id == run_id)
                .order_by(AgentRunLog.timestamp, AgentRunLog.id)
            )
        )
        .scalars()
        .all()
    )


def _channel_payloads(mocked_redis: AsyncMock, prefix: str) -> list[dict]:
    """解析 mocked redis 发布记录中指定前缀 channel 的 JSON payload（pipeline+直发）。"""
    calls = [*mocked_redis.publish.call_args_list]
    pipe_publish = getattr(mocked_redis, "pipe_publish", None)
    if pipe_publish is not None:
        calls.extend(pipe_publish.call_args_list)
    out: list[dict] = []
    for call in calls:
        args, _ = call
        if len(args) < 2:
            continue
        channel, raw = args[0], args[1]
        if not isinstance(channel, str) or not channel.startswith(prefix):
            continue
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(payload, dict):
            out.append(payload)
    return out


def _session_log_payloads(mocked_redis: AsyncMock) -> list[dict]:
    return [p for p in _channel_payloads(mocked_redis, "agent_session:") if p.get("event") == "log"]


def _run_channel_payloads(mocked_redis: AsyncMock, run_id: uuid.UUID) -> list[dict]:
    return _channel_payloads(mocked_redis, f"agent_run:{run_id}")


def _agent_event_msg(ev: dict, dedup_key: str | None = None) -> dict:
    """构造新轨 wire 载荷 {"kind": "agent_event", "event": ..., "dedup_key"?}。"""
    msg: dict = {"kind": "agent_event", "event": ev}
    if dedup_key is not None:
        msg["dedup_key"] = dedup_key
    return msg


def _rows_by_content(rows: list[AgentRunLog]) -> dict[str, AgentRunLog]:
    return {r.content_redacted or "": r for r in rows}


# ── 每型事件落库（列值 + 文本行前缀逐字 + metadata_.agent_event） ────────────


class TestPerTypeEventPersistence:
    """task-07：AgentEvent v2 八型（除 complete 别名外）逐型落库断言。"""

    @pytest.mark.asyncio
    async def test_text_event_persists_assistant_line(self, db_session, mocked_redis) -> None:
        """text 事件 → ``[ASSISTANT] <content>`` stdout 行（前缀逐字对齐旧轨），主
        agent depth=0 落列（现行为），metadata_.agent_event 存完整事件；带 segment_id
        的完整行伴随 backend 合成 override 标记行（quick-0e56260f 既有语义）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "text",
            "content": "完整回复原文",
            "segment_id": "main:msg-t1:text",
            "depth": 0,
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert "[ASSISTANT] 完整回复原文" in by_content
        text_row = by_content["[ASSISTANT] 完整回复原文"]
        assert text_row.channel == "stdout"
        assert text_row.tool_kind is None
        assert text_row.depth == 0, "主 agent depth=0 也落（对齐现行为）"
        assert text_row.parent_tool_use_id is None
        assert text_row.subagent_type is None
        assert text_row.segment_id is None, "完整行 segment_id 列为 NULL（partial 语义）"
        assert text_row.metadata_ == {"agent_event": ev}
        # 完整行 → backend 合成 override 标记行（既有语义，不渲染）。
        assert "[ASSISTANT_OVERRIDE] main:msg-t1:text" in by_content

    @pytest.mark.asyncio
    async def test_thinking_event_persists_thinking_line_with_truncation(
        self, db_session, mocked_redis
    ) -> None:
        """thinking 事件 → ``[THINKING] <content[:20000]+...>``（截断与 _extract_sdk_messages
        一致且幂等——daemon 归一化器已按同规则截断，backend 重复应用结果不变）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        long_text = "思" * 25000
        # daemon 归一化器已截断的形态（task-03 同规则）。
        daemon_preview = long_text[:20000] + "..."
        ev = {
            "type": "thinking",
            "content": daemon_preview,
            "segment_id": "main:msg-t2:thinking",
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        expected = f"[THINKING] {daemon_preview}"
        assert expected in by_content
        assert by_content[expected].channel == "stdout"
        # 幂等：backend 再截断不改变 daemon 已截断的内容。
        assert daemon_preview == (long_text[:20000] + "...")
        # thinking 完整行 → [THINKING_OVERRIDE] 标记行。
        assert "[THINKING_OVERRIDE] main:msg-t2:thinking" in by_content

    @pytest.mark.asyncio
    async def test_tool_use_event_double_writes_stdout_and_tool_call(
        self, db_session, mocked_redis
    ) -> None:
        """tool_use 事件双写：stdout ``[TOOL_USE] Bash: echo hi``（command 优先展示，
        前缀逐字对齐）+ tool_call 通道 tc_payload JSON（tool/args/tool_use_id/
        tool_kind）。两行 metadata_.agent_event 均存完整事件。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "tool_use",
            "tool_name": "Bash",
            "content": json.dumps({"command": "echo hi"}),
            "call_id": "toolu_t3",
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 2, "tool_use 双写（stdout 文本行 + tool_call JSON 行）"

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        stdout_row = by_content["[TOOL_USE] Bash: echo hi"]
        assert stdout_row.channel == "stdout"
        assert stdout_row.tool_kind is None, "stdout [TOOL_USE] 文本行不带 tool_kind（现状）"
        assert stdout_row.metadata_ == {"agent_event": ev}

        tc_rows = [r for r in rows if r.channel == "tool_call"]
        assert len(tc_rows) == 1
        tc_row = tc_rows[0]
        parsed = json.loads(tc_row.content_redacted or "")
        assert parsed["tool"] == "Bash"
        assert parsed["args"] == {"command": "echo hi"}
        assert parsed["tool_use_id"] == "toolu_t3"
        assert parsed["status"] == "allowed"
        assert parsed["success"] is True
        assert "timestamp" in parsed
        assert tc_row.tool_kind == "bash", "tool_kind 复用 tool_kind.py 映射（classify 兜底）"
        assert tc_row.metadata_ == {"agent_event": ev}

    @pytest.mark.asyncio
    async def test_tool_use_args_json_fallback_line(self, db_session, mocked_redis) -> None:
        """tool_use 无 command 键 → ``[TOOL_USE] Read: <args JSON>``（content 原文作
        args_line，对齐 _extract_sdk_messages「否则整体 JSON」分支）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        args_json = json.dumps({"file_path": "a.py"})
        ev = {
            "type": "tool_use",
            "tool_name": "Read",
            "content": args_json,
            "call_id": "toolu_t4",
        }
        await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert f"[TOOL_USE] Read: {args_json}" in by_content

    @pytest.mark.asyncio
    async def test_tool_use_tool_input_metadata_preferred(self, db_session, mocked_redis) -> None:
        """args 来源=ev.metadata.tool_input 优先（结构化），command 提取照旧；
        tool_kind 缺失时 classify_tool_kind 兜底（sillyspec 命中）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "tool_use",
            "tool_name": "Bash",
            "content": "",
            "call_id": "toolu_t5",
            "metadata": {"tool_input": {"command": "sillyspec run scan"}},
        }
        await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert "[TOOL_USE] Bash: sillyspec run scan" in by_content
        tc_rows = [r for r in rows if r.channel == "tool_call"]
        assert tc_rows[0].tool_kind == "sillyspec"

    @pytest.mark.asyncio
    async def test_tool_result_event_with_edit_patch_and_kind_inheritance(
        self, db_session, mocked_redis
    ) -> None:
        """tool_result 事件 → ``[TOOL_RESULT] <content>`` stdout 行（截断归 daemon
        所有）；edit_patch 直填列；tool_kind 经 call_id 从同调用配对 tool_use 继承
        （tool_kind_by_tool_use_id 现机制）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        patch = json.dumps([{"oldStart": 1, "newStart": 1, "lines": ["-a", "+b"]}])
        messages = [
            _agent_event_msg(
                {
                    "type": "tool_use",
                    "tool_name": "Edit",
                    "content": json.dumps({"file_path": "x.ts"}),
                    "call_id": "toolu_t6",
                }
            ),
            _agent_event_msg(
                {
                    "type": "tool_result",
                    "content": "The file has been updated.",
                    "call_id": "toolu_t6",
                    "edit_patch": patch,
                }
            ),
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 3

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        result_row = by_content["[TOOL_RESULT] The file has been updated."]
        assert result_row.channel == "stdout"
        assert result_row.edit_patch == patch
        assert result_row.tool_kind == "write", "tool_kind 从配对 tool_use 继承（Edit→write）"
        assert result_row.metadata_ is not None and "agent_event" in result_row.metadata_

    @pytest.mark.asyncio
    async def test_error_event_persists_stderr_verbatim(self, db_session, mocked_redis) -> None:
        """error 事件 → stderr 通道原文（无前缀、无截断）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {"type": "error", "content": "API Error: Request rejected (429)"}
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].channel == "stderr"
        assert rows[0].content_redacted == "API Error: Request rejected (429)"
        assert rows[0].metadata_ == {"agent_event": ev}

    @pytest.mark.asyncio
    async def test_subagent_attribution_columns(self, db_session, mocked_redis) -> None:
        """归属三列（parent_tool_use_id/subagent_type/depth）直填（子代理 depth=1）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "text",
            "content": "子代理输出",
            "parent_tool_use_id": "toolu_parent",
            "subagent_type": "general-purpose",
            "depth": 1,
        }
        await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        row = by_content["[ASSISTANT] 子代理输出"]
        assert row.parent_tool_use_id == "toolu_parent"
        assert row.subagent_type == "general-purpose"
        assert row.depth == 1

    @pytest.mark.asyncio
    async def test_status_and_turn_result_no_rows(self, db_session, mocked_redis) -> None:
        """status（非 session_started）与 turn_result 不生成文本行——status 会话信号
        走 daemon 侧 onSessionEvent；turn_result 终态走 close_interactive_run。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            _agent_event_msg({"type": "status", "subtype": "bash_chunk", "content": "xx"}),
            _agent_event_msg({"type": "turn_result", "content": "done", "usage": {}}),
            _agent_event_msg({"type": "complete", "content": "alias"}),
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 0

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0

    @pytest.mark.asyncio
    async def test_invalid_event_payload_skipped(self, db_session, mocked_redis) -> None:
        """kind='agent_event' 但 event 缺失/非 dict → 告警跳过，不抛错不落库。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        count = await svc.submit_messages(lease_id, token, run_id, [{"kind": "agent_event"}])
        assert count == 0
        assert len(await _fetch_logs(db_session, run_id)) == 0


# ── 与 _extract_sdk_messages 的逐字 parity ──────────────────────────────────


class TestParityWithExtractSdkMessages:
    """task-07 验收：同一 SDK 消息两轨展开的 flat record 逐字一致。"""

    @staticmethod
    def _signature(records: list[dict]) -> list[tuple]:
        out: list[tuple] = []
        for rec in records:
            content = rec.get("content", "")
            if rec.get("channel") == "tool_call":
                parsed = json.loads(content)
                parsed.pop("timestamp", None)
                content = json.dumps(parsed, sort_keys=True)
            meta = rec.get("metadata") if isinstance(rec.get("metadata"), dict) else {}
            out.append(
                (
                    rec.get("event_type"),
                    rec.get("channel"),
                    content,
                    rec.get("parent_tool_use_id"),
                    rec.get("subagent_type"),
                    rec.get("depth"),
                    rec.get("tool_use_id"),
                    rec.get("tool_kind"),
                    meta.get("segmentId"),
                    meta.get("isPartial"),
                )
            )
        return out

    def test_text_thinking_tool_use_lines_byte_identical(self) -> None:
        """旧轨（_extract_sdk_messages 展开 raw SDK 消息）vs 新轨（_persist_agent_event
        展开等价 AgentEvent）产出的行签名相等：event_type/channel/content（tool_call
        除 timestamp 外逐字）/归属三列/tool_use_id/tool_kind/segment 惯例。"""
        from app.modules.daemon.run_sync.service import (
            _extract_sdk_messages,
            _persist_agent_event,
        )

        sdk_msg = {
            "type": "assistant",
            "message": {
                "id": "msg-parity",
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "完整回复"},
                    {"type": "thinking", "thinking": "思考过程"},
                    {
                        "type": "tool_use",
                        "id": "toolu_p1",
                        "name": "Bash",
                        "input": {"command": "ls -la"},
                    },
                ],
            },
            "parent_tool_use_id": "toolu_parent",
            "subagent_type": "general-purpose",
            "depth": 1,
        }
        legacy = _extract_sdk_messages(sdk_msg)

        new = []
        for ev in (
            {
                "type": "text",
                "content": "完整回复",
                "segment_id": "toolu_parent:msg-parity:text",
                "parent_tool_use_id": "toolu_parent",
                "subagent_type": "general-purpose",
                "depth": 1,
            },
            {
                "type": "thinking",
                "content": "思考过程",
                "segment_id": "toolu_parent:msg-parity:thinking",
                "parent_tool_use_id": "toolu_parent",
                "subagent_type": "general-purpose",
                "depth": 1,
            },
            {
                "type": "tool_use",
                "tool_name": "Bash",
                "content": json.dumps({"command": "ls -la"}),
                "call_id": "toolu_p1",
                "parent_tool_use_id": "toolu_parent",
                "subagent_type": "general-purpose",
                "depth": 1,
            },
        ):
            new.extend(_persist_agent_event(_agent_event_msg(ev), ev))

        assert self._signature(legacy) == self._signature(new)


# ── partial / override（D-004@v1） ──────────────────────────────────────────


class TestPartialAndOverride:
    """partial 行落 segment_id；override 事件撤回已落库 partial（自撤机制）。"""

    @pytest.mark.asyncio
    async def test_partial_row_persists_segment_id(self, db_session, mocked_redis) -> None:
        """is_partial 行落库带 segment_id 列（partial 截断口径照现状——循环内
        [:50000] 封顶），metadata_.agent_event 照存。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "text",
            "content": "流式半截",
            "is_partial": True,
            "segment_id": "main:msg-p1:text",
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "[ASSISTANT] 流式半截"
        assert rows[0].segment_id == "main:msg-p1:text"
        assert rows[0].metadata_ == {"agent_event": ev}

    @pytest.mark.asyncio
    async def test_override_revokes_committed_partial_no_residual(
        self, db_session, mocked_redis
    ) -> None:
        """调用 A 落 partial（commit）→ 调用 B override 事件（override:true +
        segment_id + 完整内容，D-004@v1）→ 复用完整行自撤链：partial 被跨调用
        DELETE，DB 只剩完整行 + backend 合成标记行，无 partial 残留。"""
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        seg = "main:msg-ovr:text"

        # 调用 A：partial 落库 commit。
        partial_ev = {
            "type": "text",
            "content": "半截回复",
            "is_partial": True,
            "segment_id": seg,
        }
        count_a = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(partial_ev)])
        assert count_a == 1
        rows_a = await _fetch_logs(db_session, run_id)
        assert len(rows_a) == 1 and rows_a[0].segment_id == seg

        # 调用 B：override 事件（完整内容）。
        override_ev = {
            "type": "text",
            "content": "完整回复全文",
            "override": True,
            "segment_id": seg,
        }
        result_b = await svc.submit_messages(
            lease_id, token, run_id, [_agent_event_msg(override_ev)]
        )
        assert int(result_b) == 1, "override 事件 = 完整行落库（count 只计内容行）"
        await db_session.commit()

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert set(by_content) == {
            "[ASSISTANT] 完整回复全文",
            f"[ASSISTANT_OVERRIDE] {seg}",
        }, "override 撤回后无 partial 残留（完整行 + 标记行）"
        assert all(r.segment_id is None for r in rows)

        # SSE：完整行 + stale 令箭信封（前端撤回半截渲染的既有机制）。
        await publish_submitted_messages(result_b.publish_intent)
        stale_env = [p for p in _session_log_payloads(mocked_redis) if p.get("stale") is True]
        assert len(stale_env) == 1
        assert stale_env[0]["segment_id"] == seg
        full_entries = [
            p for p in _session_log_payloads(mocked_redis) if p.get("stale") is not True
        ]
        assert any(p["content"] == "[ASSISTANT] 完整回复全文" for p in full_entries)

    @pytest.mark.asyncio
    async def test_same_call_partial_then_complete_keeps_only_complete(
        self, db_session, mocked_redis
    ) -> None:
        """同调用内 partial → 完整（同 segment）：partial 被 expunge 回退，只剩完整行
        + 标记行（flushed_partials 现机制，新轨复用）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        seg = "main:msg-same:text"
        messages = [
            _agent_event_msg(
                {"type": "text", "content": "半截", "is_partial": True, "segment_id": seg}
            ),
            _agent_event_msg({"type": "text", "content": "全文", "segment_id": seg}),
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert set(by_content) == {"[ASSISTANT] 全文", f"[ASSISTANT_OVERRIDE] {seg}"}


# ── usage 实时语义（D-003@v1：任意携带事件即更新，含 partial） ──────────────


class TestUsageRealtime:
    """usage 更新 agent_runs token 统计 + SSE summary 透传（含 ctx_tokens）。"""

    @pytest.mark.asyncio
    async def test_partial_usage_updates_run_and_sse_summary(
        self, db_session, mocked_redis
    ) -> None:
        """partial flush 事件携带 usage（D-003@v1）→ run 统计实时更新（max 累计）
        + run channel summary 与 session channel tokens 事件透传
        input/output/cache_read/cache_creation/ctx_tokens（对齐现链路）。"""
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "text",
            "content": "流式中",
            "is_partial": True,
            "segment_id": "main:msg-u1:text",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 20,
                "cache_read_tokens": 5,
                "cache_creation_tokens": 3,
                "ctx_tokens": 18,
            },
        }
        ret = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert int(ret) == 1
        await db_session.commit()

        run, _ = await _fetch_session_row(db_session, run_id)
        assert run.input_tokens == 10
        assert run.output_tokens == 20
        assert run.cache_read_tokens == 5
        assert run.cache_creation_tokens == 3
        assert run.ctx_tokens == 18

        # SSE summary 实时透传（现链路锚 service.py:357-370）。
        await publish_submitted_messages(ret.publish_intent)
        summary = next(
            p for p in _run_channel_payloads(mocked_redis, run_id) if p.get("event") == "messages"
        )
        assert summary["input_tokens"] == 10
        assert summary["output_tokens"] == 20
        assert summary["cache_read_tokens"] == 5
        assert summary["cache_creation_tokens"] == 3
        assert summary["ctx_tokens"] == 18
        tokens_events = [
            p
            for p in _channel_payloads(mocked_redis, "agent_session:")
            if p.get("event") == "tokens"
        ]
        assert len(tokens_events) == 1
        assert tokens_events[0]["ctx_tokens"] == 18

    @pytest.mark.asyncio
    async def test_usage_only_empty_event_no_row(self, db_session, mocked_redis) -> None:
        """usage-only 空事件（task-03 对齐旧轨空 content 行）→ 不落日志行，usage
        照常提取（无行化语义）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {
            "type": "text",
            "content": "",
            "usage": {"input_tokens": 7, "output_tokens": 8, "ctx_tokens": 7},
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 0
        assert len(await _fetch_logs(db_session, run_id)) == 0

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.input_tokens == 7
        assert run.output_tokens == 8
        assert run.ctx_tokens == 7


# ── session pin（status/session_started 无行化） ─────────────────────────────


class TestSessionPin:
    """session_started 事件 → resume 指针守卫更新（对齐现 latest_session_id 链）。"""

    @pytest.mark.asyncio
    async def test_session_started_pins_resume_pointer_without_row(
        self, db_session, mocked_redis
    ) -> None:
        """status/session_started + session_id → AgentRun.session_id（仅空时写）+
        AgentSession.agent_session_id（最新值覆盖，会话列语义）双守卫更新；
        不产生 AgentRunLog 行（design §7.5 无行化）。"""
        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        run, session_row = await _fetch_session_row(db_session, run_id)
        assert run.session_id is None
        session_row.agent_session_id = "old-sdk-session-id"
        await db_session.commit()

        ev = {
            "type": "status",
            "subtype": "session_started",
            "content": "",
            "session_id": "sess-new",
        }
        count = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        assert count == 0, "session_started 无行化"
        await db_session.commit()

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "不产生 AgentRunLog 行"

        run, session_row = await _fetch_session_row(db_session, run_id)
        assert run.session_id == "sess-new"
        assert session_row.agent_session_id == "sess-new", "会话列最新值覆盖（fork/reload 换新 id）"


# ── dedup_key 幂等 ──────────────────────────────────────────────────────────


class TestDedupKeyIdempotency:
    """消息顶层 dedup_key 透传 → (run_id, dedup_key) 幂等去重（daemon 重试场景）。"""

    @pytest.mark.asyncio
    async def test_same_dedup_key_submitted_twice_single_row(
        self, db_session, mocked_redis
    ) -> None:
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {"type": "text", "content": "幂等内容"}
        msg = _agent_event_msg(ev, dedup_key="run-1:seq-9")

        count_a = await svc.submit_messages(lease_id, token, run_id, [msg])
        assert count_a == 1
        await db_session.commit()

        count_b = await svc.submit_messages(lease_id, token, run_id, [msg])
        assert count_b == 0, "同 dedup_key 重发 → 跳过 INSERT"

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].dedup_key == "run-1:seq-9"
        assert rows[0].metadata_ == {"agent_event": ev}


# ── SSE agent_event 透传（run channel + session channel） ────────────────────


class TestSseAgentEventPassthrough:
    """published_logs 与 session_payload 增可选 agent_event 键（.get() 容错）。"""

    @pytest.mark.asyncio
    async def test_agent_event_in_published_logs_and_session_channel(
        self, db_session, mocked_redis
    ) -> None:
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ev = {"type": "text", "content": "透传正文"}
        ret = await svc.submit_messages(lease_id, token, run_id, [_agent_event_msg(ev)])
        await db_session.commit()

        # run channel：published_logs entry（扁平 StreamLogEvent）带 agent_event。
        real_entries = [e for e in ret.published_logs if e.get("stale") is not True]
        assert any(e.get("agent_event") == ev for e in real_entries)

        await publish_submitted_messages(ret.publish_intent)
        # session channel：log payload 带 agent_event。
        matching = [p for p in _session_log_payloads(mocked_redis) if p.get("agent_event") == ev]
        assert len(matching) == 1
        assert matching[0]["content"] == "[ASSISTANT] 透传正文"
        # run channel 整 payload 直发同样携带。
        assert any(
            p.get("event") != "messages" and p.get("agent_event") == ev
            for p in _run_channel_payloads(mocked_redis, run_id)
        )


# ── 旧形态（无 kind）兼容轨回归 ─────────────────────────────────────────────


class TestLegacyTrackRegression:
    """无 kind 键消息走原路径，行为与现状完全一致（D-001@v1 兼容轨）。"""

    @pytest.mark.asyncio
    async def test_legacy_flat_and_sdk_raw_mixed_with_agent_event(
        self, db_session, mocked_redis
    ) -> None:
        """同批混发：flat 消息（batch）+ SDK raw 消息（interactive 旧轨）+
        agent_event 新轨——三轨各按原路径展开，互不串扰；legacy 行 metadata_ 为
        NULL、published_logs entry agent_event 为 None（旧载荷零影响）。"""
        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        legacy_flat = {
            "event_type": "text",
            "content": "[ASSISTANT] 旧轨 flat",
            "channel": "stdout",
        }
        legacy_sdk = {
            "type": "assistant",
            "message": {
                "id": "msg-legacy",
                "role": "assistant",
                "content": [{"type": "text", "text": "旧轨 SDK 展开"}],
            },
        }
        ev = {"type": "text", "content": "新轨事件"}
        messages = [legacy_flat, legacy_sdk, _agent_event_msg(ev)]

        ret = await svc.submit_messages(lease_id, token, run_id, messages)
        await db_session.commit()

        rows = await _fetch_logs(db_session, run_id)
        by_content = _rows_by_content(rows)
        assert "[ASSISTANT] 旧轨 flat" in by_content
        assert "[ASSISTANT] 旧轨 SDK 展开" in by_content
        assert "[ASSISTANT] 新轨事件" in by_content

        # legacy 行无 agent_event（metadata_ NULL）；新轨行有。
        assert by_content["[ASSISTANT] 旧轨 flat"].metadata_ is None
        assert by_content["[ASSISTANT] 新轨事件"].metadata_ == {"agent_event": ev}

        # published_logs：legacy entry agent_event=None（键存在值 None，消费端
        # .get() 容错零影响）；新轨 entry 带 ev。
        legacy_entry = next(
            e for e in ret.published_logs if e.get("content") == "[ASSISTANT] 旧轨 flat"
        )
        assert legacy_entry.get("agent_event") is None

    @pytest.mark.asyncio
    async def test_legacy_session_payload_agent_event_none(self, db_session, mocked_redis) -> None:
        """纯 legacy 提交的 session channel log payload agent_event 为 None
        （.get() 容错——旧载荷不带键时零影响）。"""
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        ret = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "text", "content": "[ASSISTANT] 纯旧轨", "channel": "stdout"}],
        )
        await db_session.commit()
        await publish_submitted_messages(ret.publish_intent)

        payloads = _session_log_payloads(mocked_redis)
        assert len(payloads) == 1
        assert payloads[0]["agent_event"] is None
        assert payloads[0]["content"] == "[ASSISTANT] 纯旧轨"
