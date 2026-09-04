"""golden 三源对照测试（backend 侧 parity）——task-12 / FR-02 / R-01 / R-06 / D-003@v1 / D-004@v1。

变更 2026-09-03-agent-provider-abstraction task-12：把 task-03（daemon 归一化器）、
task-07（backend ``_persist_agent_event``）、task-09（kind 包装）三段各自的局部验证
收口为跨段 golden 对照。同一 fixture（``sillyhub-daemon/tests/fixtures/claude-sdk-messages/
golden-session.json``，双 turn 真实形状 SDK 会话序列）驱动三源：

- 源1 fixture：golden-session.json（38 帧，内容复用 task-03 三组 fixture，脱敏）；
- 源2 事件快照：golden-session.events.json（normalizer 事件流，daemon 侧
  ``tests/interactive/golden/claude-events-golden.test.ts`` 锚定，本文件消费）；
- 源3 旧轨展开快照：golden-session.legacy-extract.json（``_extract_sdk_messages``
  行为快照，本文件 §1 用 live 实现反向锚定，daemon 侧 §3 消费）。

本文件覆盖：

- §1 legacy 快照锚：live ``_extract_sdk_messages`` 对 fixture 完整帧（+旧 daemon 顶层
  depth）的展开 ≡ golden-session.legacy-extract.json（快照文件入库防实现漂移）；
- §2 两轨落库 parity（R-01/R-06）：同一批完整帧两种载荷——旧形态（SDK dict + 旧
  daemon 顶层附加：depth 恒挂 + usage lift 短名化，daemon.ts:3643-3666 联合语义）vs
  新形态（``kind:'agent_event'`` + 源2 事件）——分别 submit_messages，落库行
  （channel/content_redacted/tool_kind/归属三列/segment_id/edit_patch）逐字段对照
  等价 + agent_runs usage 聚合值一致 + session pin 一致；
- §3 partial→override→撤回链（D-004@v1）：新轨 partial（携带中途 usage，D-003@v1）
  →override 事件（跨调用 DELETE 已 commit partial + 标记行 + SSE stale 令箭），无
  partial 残留；同 segment 旧轨联合语义（flat partial 行 + SDK 完整帧 + 信号行）终态
  与新轨完全一致；
- §4 已知格式级差异登记（可执行文档）：①旧轨 ``json.dumps`` 默认分隔符（``", "`` /
  ``": "``）vs 新轨 daemon ``JSON.stringify`` 紧凑格式——语义等价（前端 JSON.parse
  消费），R-01「字节级一致」在 JSON 空白层面的既知偏差，§2/§3 对照函数已归一；
  ②cache_* 完整帧聚合：旧轨 flat record usage stamp 为 SDK 全名（落库循环读短名
  不命中，仅 partial 行/close 终态喂），新轨事件短名化后完整事件也聚合——改进型
  偏差（§2 冻结差异、§3 锚定 partial 路径两轨等价），归属 task-03/07 裁决。

测试模式对齐 test_run_sync_agent_events.py（submit_messages via DaemonService
facade，db_session fixture + mocked_redis + lease helper）。纯测试任务：不改生产代码。
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── golden fixture 加载（monorepo 内跨端共享：backend ↔ sillyhub-daemon） ──────

_REPO_ROOT = Path(__file__).resolve().parents[5]
_GOLDEN_DIR = _REPO_ROOT / "sillyhub-daemon" / "tests" / "fixtures" / "claude-sdk-messages"

_CONTENT_TYPES = {"text", "thinking", "tool_use", "tool_result"}


@lru_cache(maxsize=1)
def _load_golden_session() -> list[dict]:
    return json.loads((_GOLDEN_DIR / "golden-session.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_events_doc() -> dict:
    return json.loads((_GOLDEN_DIR / "golden-session.events.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_legacy_doc() -> dict:
    return json.loads(
        (_GOLDEN_DIR / "golden-session.legacy-extract.json").read_text(encoding="utf-8")
    )


def _frame_events(frame_idx: int) -> list[dict]:
    for f in _load_events_doc()["frames"]:
        if f["frame"] == frame_idx:
            return f["events"]
    return []


def _frame_depth(frame_idx: int) -> int | None:
    """帧级 depth（旧 daemon 顶层恒挂值）——取该帧首条内容事件的 depth（message 级）。"""
    for ev in _frame_events(frame_idx):
        if ev.get("type") in _CONTENT_TYPES:
            return ev.get("depth")
    return None


def _first_content_usage(frame_idx: int) -> dict | None:
    """帧首条内容事件携带的 usage（短名）——旧 daemon lift 顶层的等价产物。"""
    for ev in _frame_events(frame_idx):
        if ev.get("type") in _CONTENT_TYPES:
            return ev.get("usage")
    return None


# ── 两轨载荷构造 ──────────────────────────────────────────────────────────────


def _lift_usage(frame: dict) -> dict | None:
    """旧 daemon usage lift（daemon.ts:3643-3666）：message.usage 提到顶层 + 全名→短名。

    联合语义的 daemon 半边——backend 落库循环只读短名（``cache_read_tokens`` 等），
    顶层无 lift 时旧轨 agent_runs 聚合拿不到 cache 值。守卫对齐：input_tokens 非数
    字不 lift。
    """
    inner = frame.get("message")
    raw = inner.get("usage") if isinstance(inner, dict) else None
    if not isinstance(raw, dict) or not isinstance(raw.get("input_tokens"), (int, float)):
        return None
    lifted = dict(raw)
    for full, short in (
        ("cache_creation_input_tokens", "cache_creation_tokens"),
        ("cache_read_input_tokens", "cache_read_tokens"),
    ):
        if isinstance(lifted.get(full), (int, float)) and lifted.get(short) is None:
            lifted[short] = lifted[full]
    return lifted


def _old_form_frame(frame_idx: int) -> dict:
    """旧形态单帧：SDK dict + 顶层 depth（session-manager.ts:4569 恒挂）+ lift 后 usage。"""
    frame = dict(_load_golden_session()[frame_idx])
    depth = _frame_depth(frame_idx)
    if depth is not None:
        frame["depth"] = depth
    lifted = _lift_usage(frame)
    if lifted is not None:
        frame["usage"] = lifted
    return frame


def _old_form_messages() -> list[dict]:
    """旧轨批量载荷：全部 assistant/user 完整帧（帧 23 串内容边界照发，两轨均无行）。"""
    out: list[dict] = []
    for i, frame in enumerate(_load_golden_session()):
        if frame.get("type") in ("assistant", "user"):
            out.append(_old_form_frame(i))
    return out


def _agent_event_msg(ev: dict) -> dict:
    """新轨 wire 载荷 {"kind": "agent_event", "event": {...}}（task-09 包装形态）。"""
    return {"kind": "agent_event", "event": ev}


def _new_form_messages() -> list[dict]:
    """新轨批量载荷：帧 0 的 status/session_started（task-09 ④ 经 submitMessages 上报，
    backend resume 指针 pin）+ 全部完整帧的内容事件（源2 快照）。"""
    out: list[dict] = [_agent_event_msg(_frame_events(0)[0])]
    for f in _load_events_doc()["frames"]:
        for ev in f["events"]:
            if ev.get("type") in _CONTENT_TYPES:
                out.append(_agent_event_msg(ev))
    return out


# ── 落库行语义化对照（格式级差异归一，见 §4 登记） ─────────────────────────────


def _canon_content(channel: str, content: str | None) -> str | None:
    """content 语义化：tool_call 行剥 timestamp 后排序比较；[TOOL_USE] 行的 JSON args
    部分排序比较（旧轨 py json.dumps 空格 vs 新轨 JSON.stringify 紧凑——语义等价）。"""
    if content is None:
        return None
    if channel == "tool_call":
        parsed = json.loads(content)
        parsed.pop("timestamp", None)
        return json.dumps(parsed, sort_keys=True, ensure_ascii=False)
    if content.startswith("[TOOL_USE] "):
        m = re.match(r"^\[TOOL_USE\] ([^:]+): (.*)$", content, re.DOTALL)
        if m:
            args_part = m.group(2)
            if args_part.startswith("{") or args_part.startswith("["):
                try:
                    args_part = json.dumps(
                        json.loads(args_part), sort_keys=True, ensure_ascii=False
                    )
                except (TypeError, ValueError):
                    pass
            return f"[TOOL_USE] {m.group(1)}: {args_part}"
    return content


def _row_sig(row: AgentRunLog) -> tuple:
    """落库行对照签名：channel/content（语义化）/tool_kind/归属三列/segment_id/edit_patch
    （语义化）。metadata_（agent_event）与 dedup_key 是新轨增量列，不在 R-01 对照面
    （task-07 已分别锚定）。"""
    edit = row.edit_patch
    edit_canon = json.dumps(json.loads(edit), sort_keys=True, ensure_ascii=False) if edit else None
    return (
        row.channel,
        _canon_content(row.channel, row.content_redacted),
        row.tool_kind,
        row.parent_tool_use_id,
        row.subagent_type,
        row.depth,
        row.segment_id,
        edit_canon,
    )


def _sorted_sigs(rows: list[AgentRunLog]) -> list[str]:
    """签名集合排序（None 与 str 混位不可直接 sorted，经 JSON 序列化排序）。"""
    return sorted(json.dumps(sig, ensure_ascii=False, default=str) for sig in map(_row_sig, rows))


# ── Fixtures（对齐 test_run_sync_agent_events.py / test_run_sync_assistant_override.py）


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"golden-{uid}@example.com",
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


async def _seed_interactive_run_for_submit(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """interactive 形态 lease + run（agent_session_id 非空，session pin / SSE 用）。"""
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


# ── §1 legacy 快照锚：live _extract_sdk_messages ≡ golden-session.legacy-extract.json


class TestGoldenLegacyExtractAnchor:
    """旧轨展开快照的反向锚定——快照文件由当前实现行为固化，实现漂移即红。"""

    @staticmethod
    def _canon_row(row: dict) -> dict:
        """flat record 语义化（对齐 daemon 侧 canonRow：usage 全名→短名 / JSON 语义化）。"""
        canon: dict = {
            "event_type": row.get("event_type"),
            "channel": row.get("channel"),
        }
        content = row.get("content")
        if row.get("channel") == "tool_call":
            if "tc_payload" in row:
                # golden 快照行：生成时已剥 timestamp 存对象。
                parsed = row["tc_payload"]
            else:
                parsed = json.loads(content)
                parsed.pop("timestamp", None)
            canon["tc_payload"] = json.dumps(parsed, sort_keys=True, ensure_ascii=False)
        else:
            canon["content"] = _canon_content(row.get("channel") or "", content)
        usage = row.get("usage")
        if isinstance(usage, dict):
            short: dict = {}
            if usage.get("input_tokens") is not None:
                short["input_tokens"] = usage["input_tokens"]
            if usage.get("output_tokens") is not None:
                short["output_tokens"] = usage["output_tokens"]
            cr = usage.get("cache_read_tokens", usage.get("cache_read_input_tokens"))
            cc = usage.get("cache_creation_tokens", usage.get("cache_creation_input_tokens"))
            if cr is not None:
                short["cache_read_tokens"] = cr
            if cc is not None:
                short["cache_creation_tokens"] = cc
            canon["usage"] = short
        for k in ("session_id", "parent_tool_use_id", "subagent_type", "depth", "tool_use_id"):
            v = row.get(k)
            if v is not None:
                canon[k] = v
        if row.get("tool_kind") is not None:
            canon["tool_kind"] = row["tool_kind"]
        if row.get("edit_patch"):
            canon["edit_patch"] = json.dumps(
                json.loads(row["edit_patch"]), sort_keys=True, ensure_ascii=False
            )
        if isinstance(row.get("metadata"), dict):
            canon["metadata"] = row["metadata"]
        return canon

    def test_live_extract_matches_legacy_golden(self) -> None:
        """live ``_extract_sdk_messages``（输入 = fixture 完整帧 + 旧 daemon 顶层 depth）
        逐字段 ≡ legacy 快照行（tool_call 行剥 timestamp；usage/JSON 语义化归一）。"""
        from app.modules.daemon.run_sync.service import _extract_sdk_messages

        legacy_frames = _load_legacy_doc()["frames"]
        assert legacy_frames, "legacy 快照非空"
        for entry in legacy_frames:
            idx = entry["frame"]
            msg = _old_form_frame(idx)
            live_rows = _extract_sdk_messages(msg)
            live_canon = [self._canon_row(r) for r in live_rows]
            golden_canon = [self._canon_row(r) for r in entry["rows"]]
            assert live_canon == golden_canon, f"frame {idx} 旧轨展开与 golden 快照漂移"


# ── §2 两轨落库 parity（R-01 / R-06 验收锚） ──────────────────────────────────


class TestGoldenTwoRailParity:
    """同一批完整帧两种载荷（旧形态 vs kind:agent_event 新形态）→ 落库行逐字段等价。"""

    @pytest.mark.asyncio
    async def test_complete_frames_identical_rows_usage_session_pin(
        self, db_session, mocked_redis
    ) -> None:
        lease_a, run_a, token_a = await _seed_interactive_run_for_submit(db_session)
        lease_b, run_b, token_b = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)

        ret_a = await svc.submit_messages(lease_a, token_a, run_a, _old_form_messages())
        ret_b = await svc.submit_messages(lease_b, token_b, run_b, _new_form_messages())
        await db_session.commit()

        # 内容行计数一致（26 条内容行；9 条 backend 合成 override 标记行不计入 count）。
        assert int(ret_a) == int(ret_b) == 26

        rows_a = await _fetch_logs(db_session, run_a)
        rows_b = await _fetch_logs(db_session, run_b)
        assert len(rows_a) == len(rows_b) == 35
        assert _sorted_sigs(rows_a) == _sorted_sigs(rows_b), "两轨落库行语义化对照不一致"

        # ── 行级语义锚（在 sig 等价之上再抽关键行直接断言，两轨同断言）────────────
        for rows in (rows_a, rows_b):
            by_content = {r.content_redacted or "": r for r in rows}
            # 文本行逐字（前缀拼装归 backend，两轨同款）。
            assert "[THINKING] Let me check the environment." in by_content
            assert "[ASSISTANT] Running docker ps now." in by_content
            assert (
                "[TOOL_USE] Bash: docker ps --format "
                "'{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1 | head -40" in by_content
            ), "Bash command 优先展示行逐字一致"
            assert "[TOOL_RESULT] 391" in by_content
            # tool_call JSON 行：tool/args/tool_use_id/status/success（tool_use_id 在
            # content JSON 内，非 DB 列）。
            tc_bash = next(
                r
                for r in rows
                if r.channel == "tool_call"
                and json.loads(r.content_redacted or "{}").get("tool_use_id") == "toolu_bash01"
            )
            parsed = json.loads(tc_bash.content_redacted or "")
            assert parsed["tool"] == "Bash"
            assert parsed["args"]["command"].startswith("docker ps")
            assert parsed["status"] == "allowed" and parsed["success"] is True
            assert tc_bash.tool_kind == "bash"
            # Edit 结果行：edit_patch 列 + tool_kind 从配对 tool_use 继承（write）。
            edit_row = next(
                r
                for r in rows
                if r.content_redacted and r.content_redacted.startswith("[TOOL_RESULT] The file")
            )
            assert edit_row.tool_kind == "write"
            golden_patch = _load_golden_session()[31]["tool_use_result"]["structuredPatch"]
            assert json.loads(edit_row.edit_patch or "[]") == golden_patch
            # 归属三列：子代理 depth 1 / 嵌套孙代 depth 2 / 主 agent 0。
            sub_row = by_content["[ASSISTANT] 17 * 23 = 391"]
            assert (sub_row.parent_tool_use_id, sub_row.subagent_type, sub_row.depth) == (
                "toolu_task01",
                "general-purpose",
                1,
            )
            grand_row = by_content["[ASSISTANT] Entry names verified: forward slashes only."]
            assert (grand_row.parent_tool_use_id, grand_row.depth) == ("toolu_task03", 2)
            assert by_content["[ASSISTANT] The walker is fixed and verified. done."].depth == 0
            # 完整行 segment_id 列恒 NULL（partial 语义专属列）。
            assert all(r.segment_id is None for r in rows)
            # backend 合成 override 标记行（完整 segment 行的既有自撤机制，两轨同款）。
            markers = {
                r.content_redacted
                for r in rows
                if r.content_redacted and "_OVERRIDE] " in r.content_redacted
            }
            assert markers == {
                "[THINKING_OVERRIDE] main:msg_t1_m1:thinking",
                "[ASSISTANT_OVERRIDE] main:msg_t1_m2:text",
                "[THINKING_OVERRIDE] toolu_task01:msg_sub_001:thinking",
                "[ASSISTANT_OVERRIDE] toolu_task01:msg_sub_001:text",
                "[ASSISTANT_OVERRIDE] toolu_task01:msg_sub_002:text",
                "[ASSISTANT_OVERRIDE] main:msg_t2_m1:text",
                "[ASSISTANT_OVERRIDE] toolu_task02:msg_sub2_001:text",
                "[ASSISTANT_OVERRIDE] toolu_task03:msg_sub3_001:text",
                "[ASSISTANT_OVERRIDE] main:msg_t2_m3:text",
            }

        # ── agent_runs usage 聚合：两轨一致项（input/output 同名 + ctx 完整帧均无）。
        run_row_a = await db_session.get(AgentRun, run_a)
        run_row_b = await db_session.get(AgentRun, run_b)
        assert run_row_a and run_row_b
        for attr in ("input_tokens", "output_tokens", "ctx_tokens"):
            assert getattr(run_row_a, attr) == getattr(run_row_b, attr), f"{attr} 两轨聚合不一致"
        assert run_row_a.input_tokens == 2000  # max(100,320,210,260,900,950,300,150,2000)
        assert run_row_a.output_tokens == 120  # max(50,120,33,21,40,25,30,18,60)
        assert run_row_a.ctx_tokens is None, "完整帧无 ctx（ctx 是 partial pendingUsage 专属）"

        # ── 既知差异冻结（任务报告登记项 1，改进型偏差非回归）：cache_* 聚合 ──────
        # 旧轨完整消息的 flat record usage stamp 取 message.usage 原文（SDK 全名
        # cache_read_input_tokens），daemon lift 的顶层短名被 _extract_sdk_messages
        # 的 inner 优先分支覆盖 → 落库循环读短名（cache_read_tokens）不命中——
        # 旧链路 cache_* 仅由 partial flush 行（短名顶层）与 close 终态喂
        # （test_run_sync_cache_parse.py 全部用例均为短名 flat 形态佐证）。新轨
        # 事件 usage 为归一化器短名化产物 → 完整事件也聚合（信息更全）。partial
        # 路径的 cache 两轨等价由 §3 链测试锚定；如需绝对对齐归 task-03/07 裁决。
        assert run_row_a.cache_read_tokens is None
        assert run_row_a.cache_creation_tokens is None
        assert run_row_b.cache_read_tokens == 8000
        assert run_row_b.cache_creation_tokens == 512

        # ── session pin：两轨均 pin 到 golden 会话 id（旧轨 stamped 行 / 新轨事件）。
        assert run_row_a.session_id == "sess-sample-0003"
        assert run_row_b.session_id == "sess-sample-0003"


# ── §3 partial→override→撤回链（D-003@v1 实时 usage + D-004@v1 撤回） ───────────

# 链终态期望行（同 segment 旧轨联合语义 ≡ 新轨；[TOOL_USE] Task 行的 args JSON
# 经 _canon_content 语义化——旧轨 py 空格 vs 新轨 js 紧凑的既知格式差异，见 §4）。
_CHAIN_SEGMENT = "main:msg_t1_m2:text"
_TASK01_ARGS = {
    "description": "Compute 17 times 23",
    "prompt": "Compute 17 * 23. Return only the numerical result.",
    "subagent_type": "general-purpose",
}
_CHAIN_FINAL_CONTENTS_CANON = {
    "[ASSISTANT] Running docker ps now.",
    f"[ASSISTANT_OVERRIDE] {_CHAIN_SEGMENT}",
    "[TOOL_USE] Bash: docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1 | head -40",
    _canon_content("stdout", f"[TOOL_USE] Task: {json.dumps(_TASK01_ARGS)}"),
}


def _canon_stdout_contents(rows: list[AgentRunLog]) -> set[str | None]:
    """非 tool_call 行 content 语义化集合（[TOOL_USE] JSON args 归一）。"""
    return {
        _canon_content("stdout", r.content_redacted or "") for r in rows if r.channel != "tool_call"
    }


class TestPartialOverrideChain:
    """golden 链路：partial（中途 usage 实时）→ override（撤回 + 终态 usage）两轨一致。"""

    @pytest.mark.asyncio
    async def test_new_rail_partial_then_override_no_residual(
        self, db_session, mocked_redis
    ) -> None:
        """新轨：调用 A = kind partial 事件（源2 帧 15 快照，含轮级累计 usage +
        ctx_tokens）→ agent_runs 实时更新 + SSE summary 字段名透传；调用 B = 帧 16
        内容事件（override 完整文本 + 双 tool_use）→ 跨调用 DELETE partial + 标记行，
        DB 无 partial 残留；终态 usage 两处（agent_runs + SSE summary）。"""
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_c, run_c, token_c = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)

        # 调用 A：partial（帧 15 快照：is_partial + segment_id + usage 420/170/700/64/1084）。
        partial_ev = _load_events_doc()["frames"][15]["partials"][0]
        ret_a = await svc.submit_messages(lease_c, token_c, run_c, [_agent_event_msg(partial_ev)])
        assert int(ret_a) == 1
        await db_session.commit()

        # 中途 usage（D-003@v1）：agent_runs 实时值。
        run_row = await db_session.get(AgentRun, run_c)
        assert run_row is not None
        assert run_row.input_tokens == 420
        assert run_row.output_tokens == 170
        assert run_row.cache_read_tokens == 700
        assert run_row.cache_creation_tokens == 64
        assert run_row.ctx_tokens == 1084

        # 中途 usage：SSE summary 字段名（run channel messages 事件 + session channel
        # tokens 事件，R-07 契约字段名不变）。
        await publish_submitted_messages(ret_a.publish_intent)
        summary = next(
            p for p in _run_channel_payloads(mocked_redis, run_c) if p.get("event") == "messages"
        )
        assert summary["input_tokens"] == 420
        assert summary["output_tokens"] == 170
        assert summary["cache_read_tokens"] == 700
        assert summary["cache_creation_tokens"] == 64
        assert summary["ctx_tokens"] == 1084
        tokens_events = [
            p
            for p in _channel_payloads(mocked_redis, "agent_session:")
            if p.get("event") == "tokens"
        ]
        assert len(tokens_events) == 1
        assert tokens_events[0]["ctx_tokens"] == 1084

        # 调用 B：帧 16 内容事件（override 完整 + Bash/Task tool_use）。
        evs_16 = [e for e in _frame_events(16) if e.get("type") in _CONTENT_TYPES]
        assert evs_16[0].get("override") is True
        ret_b = await svc.submit_messages(
            lease_c, token_c, run_c, [_agent_event_msg(e) for e in evs_16]
        )
        assert int(ret_b) == 5
        await db_session.commit()

        rows = await _fetch_logs(db_session, run_c)
        # D-004@v1：DB DELETE 撤回——无 partial 残留（segment_id 列全 NULL），
        # 终态 = 完整行 + 标记行 + 双 tool_use 行组。
        assert all(r.segment_id is None for r in rows)
        tool_call_jsons = {
            json.dumps(
                {k: v for k, v in json.loads(r.content_redacted or "").items() if k != "timestamp"},
                sort_keys=True,
                ensure_ascii=False,
            )
            for r in rows
            if r.channel == "tool_call"
        }
        assert len(tool_call_jsons) == 2, "帧 16 双 tool_use 的 tool_call 行"
        assert _canon_stdout_contents(rows) == _CHAIN_FINAL_CONTENTS_CANON

        # 终态 usage 两处（task 卡验收）：agent_runs（max 累计 + ctx 保留实时最后写入）。
        run_row = await db_session.get(AgentRun, run_c)
        assert run_row is not None
        assert run_row.input_tokens == 420  # 调用 B 的 320 不拉低 max
        assert run_row.output_tokens == 170
        assert run_row.cache_read_tokens == 700
        assert run_row.cache_creation_tokens == 64
        assert run_row.ctx_tokens == 1084, "调用 B 无 ctx → 保留中途实时值"

        # 终态 usage：SSE summary（调用 B 的 publish）。
        await publish_submitted_messages(ret_b.publish_intent)
        summaries = [
            p for p in _run_channel_payloads(mocked_redis, run_c) if p.get("event") == "messages"
        ]
        assert summaries[-1]["input_tokens"] == 420
        assert summaries[-1]["output_tokens"] == 170
        assert summaries[-1]["ctx_tokens"] == 1084

        # D-004@v1：SSE stale 清除——标记行信封（stale=True + segment_id）撤回半截渲染。
        stale_env = [p for p in _session_log_payloads(mocked_redis) if p.get("stale") is True]
        assert len(stale_env) == 1, "新轨恰一条 stale 信封（backend 合成标记行）"
        assert stale_env[0]["segment_id"] == _CHAIN_SEGMENT
        assert any(
            p["content"] == "[ASSISTANT] Running docker ps now."
            for p in _session_log_payloads(mocked_redis)
            if p.get("stale") is not True
        )

    @pytest.mark.asyncio
    async def test_old_rail_joint_chain_same_outcome(self, db_session, mocked_redis) -> None:
        """旧轨联合语义（daemon flush flat partial 行 + SDK 完整帧 + [ASSISTANT_OVERRIDE]
        信号行）与新轨（kind partial/override 事件）同 segment 终态完全一致：行集合、
        agent_runs 聚合、无 partial 残留。SSE 信封条数差异（旧轨信号行多一条瞬时
        stale 信封，无 DB 效应）为既知良性差异（见 §4 / 任务报告）。"""
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_d, run_d, token_d = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)

        # 调用 A：旧 daemon partial flush flat 行（[ASSISTANT] 前缀 daemon 拼 +
        # metadata segmentId/isPartial + 顶层 lift 后 usage——与源2 帧 15 快照同值）。
        partial_ev = _load_events_doc()["frames"][15]["partials"][0]
        flat_partial = {
            "event_type": "text",
            "content": f"[ASSISTANT] {partial_ev['content']}",
            "channel": "stdout",
            "metadata": {"segmentId": _CHAIN_SEGMENT, "isPartial": True},
            "usage": partial_ev["usage"],
        }
        ret_a = await svc.submit_messages(lease_d, token_d, run_d, [flat_partial])
        assert int(ret_a) == 1
        await db_session.commit()

        # 中途 usage：与新轨完全一致（agent_runs 实时值）。
        run_row = await db_session.get(AgentRun, run_d)
        assert run_row is not None
        assert (run_row.input_tokens, run_row.output_tokens) == (420, 170)
        assert (run_row.cache_read_tokens, run_row.cache_creation_tokens) == (700, 64)
        assert run_row.ctx_tokens == 1084

        # 调用 B：SDK 完整帧 16（+depth/lift）+ 尾随 override 信号行（daemon 顺序：
        # 完整消息先行、信号随后，session-manager.ts:6136-6144 等价链）。
        signal_line = {
            "event_type": "text",
            "content": f"[ASSISTANT_OVERRIDE] {_CHAIN_SEGMENT}",
            "channel": "stdout",
            "metadata": {"segmentId": _CHAIN_SEGMENT},
        }
        ret_b = await svc.submit_messages(
            lease_d, token_d, run_d, [_old_form_frame(16), signal_line]
        )
        assert int(ret_b) == 5, "完整帧展开 5 内容行；信号行不落库"
        await db_session.commit()

        # 终态：行集合与新轨一致（[TOOL_USE] args JSON 语义化归一）。
        rows = await _fetch_logs(db_session, run_d)
        assert all(r.segment_id is None for r in rows), "跨调用 DELETE 撤回，无 partial 残留"
        assert len([r for r in rows if r.channel == "tool_call"]) == 2
        assert _canon_stdout_contents(rows) == _CHAIN_FINAL_CONTENTS_CANON

        # 终态 agent_runs 与新轨一致。
        run_row = await db_session.get(AgentRun, run_d)
        assert run_row is not None
        assert (run_row.input_tokens, run_row.output_tokens) == (420, 170)
        assert (run_row.cache_read_tokens, run_row.cache_creation_tokens) == (700, 64)
        assert run_row.ctx_tokens == 1084

        # SSE：stale 信封含目标 segment；旧轨 = 信号行 + 标记行两条（新轨一条，
        # 既知良性差异——瞬时信封不落库，DB 真相一致）。
        await publish_submitted_messages(ret_b.publish_intent)
        stale_env = [p for p in _session_log_payloads(mocked_redis) if p.get("stale") is True]
        assert len(stale_env) == 2
        assert {p["segment_id"] for p in stale_env} == {_CHAIN_SEGMENT}


# ── §4 已知格式级差异登记（可执行文档，R-01 字节级一致的既知偏差） ─────────────


class TestDocumentedFormatDivergences:
    """旧轨 ``json.dumps`` 默认分隔符（带空格）vs 新轨 daemon ``JSON.stringify``
    （紧凑）：语义等价（前端 JSON.parse 消费，功能零影响），§2/§3 对照函数已按
    语义化归一。本类把差异固化为可执行登记——若任一侧序列化器行为变化（如统一
    分隔符），此处红灯提醒同步另一侧与 golden 快照。"""

    def test_tool_use_stdout_line_and_edit_patch_json_whitespace(self) -> None:
        from app.modules.daemon.run_sync.service import _extract_sdk_messages, _persist_agent_event

        evs_30 = [e for e in _frame_events(30) if e.get("type") in _CONTENT_TYPES]
        evs_31 = [e for e in _frame_events(31) if e.get("type") in _CONTENT_TYPES]

        # [TOOL_USE] Edit stdout 行：旧轨 args = py json.dumps（", "/": " 带空格），
        # 新轨 = 事件 content（JSON.stringify 紧凑）。
        old_rows = _extract_sdk_messages(_old_form_frame(30))
        old_line = next(
            r["content"]
            for r in old_rows
            if r.get("channel") == "stdout" and r["content"].startswith("[TOOL_USE] Edit:")
        )
        new_rows = []
        for ev in evs_30:
            new_rows.extend(_persist_agent_event(_agent_event_msg(ev), ev))
        new_line = next(
            r["content"]
            for r in new_rows
            if r.get("channel") == "stdout" and r["content"].startswith("[TOOL_USE] Edit:")
        )
        # 语义等价（JSON 解析后相等）……
        assert json.loads(old_line.split(": ", 1)[1]) == json.loads(new_line.split(": ", 1)[1])
        # ……但字节级不同：旧轨 ", " / ": " vs 新轨 "," / ":"（登记项）。
        assert '", "' in old_line and '": "' in old_line
        assert '", "' not in new_line and '": "' not in new_line

        # edit_patch 列：旧轨 json.dumps(..., ensure_ascii=False)（带空格）vs
        # 新轨事件 edit_patch（JSON.stringify 紧凑）。
        old_patch = _extract_sdk_messages(_old_form_frame(31))[0]["edit_patch"]
        new_patch = next(r for r in evs_31 if r.get("edit_patch"))["edit_patch"]
        assert json.loads(old_patch) == json.loads(new_patch)
        assert '", "' in old_patch
        assert '", "' not in new_patch
