"""Tests for assistant override 删 partial 去重 in run_sync (task-12 / D-002@v1 / FR-02).

变更 2026-07-30-daemon-heartbeat-dedup-fix task-12：assistant partial flush（带
segmentId + isPartial）与完整 message 双发导致 #35 重复落库。daemon task-05/06/07
在完整 assistant message 到达后 emit ``[ASSISTANT_OVERRIDE] <segmentId>`` 信号，
backend ``RunSyncService.submit_messages`` 据此回退同 segmentId 的 partial（expunge
撤销 pending INSERT）+ override 信号本身不落库（continue），消除双发。

本文件对齐 ``[THINKING_OVERRIDE]`` 链路（service.py:378-419，task-11 已实现），覆盖：

- 构造 assistant partial（带 segmentId）+ ``[ASSISTANT_OVERRIDE]`` 信号 → partial 被
  expunge 回滚、不重复落库、override 信号本身不落库（continue）。
- late partial（override 信号先到、completed_segments 已命中）→ partial 被丢弃
  （不 INSERT）。
- ``[THINKING_OVERRIDE]`` 链路不串扰：同 segmentId 的 thinking partial + thinking
  override 信号仍按 thinking 分支处理；assistant override 不会误撤 thinking partial。

segmentId 跨层一致（R-3）：daemon ``[ASSISTANT_OVERRIDE]`` metadata.segmentId 用
``${prefix}:${mid}:${blockIndex}`` 格式（task-07），backend 识别信号后从 metadata
取 segmentId 与 partial 行 metadata.segmentId 比对命中删除路径。

测试模式对齐 test_run_sync_cache_parse.py（submit_messages via DaemonService facade，
db_session fixture + mocked_redis + batch lease helper）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_run_sync_cache_parse.py） ────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"asst-ovr-{uid}@example.com",
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
    """ql-20260826-011：给 AsyncMock redis 补 pipeline() 假件。

    publish_submitted_messages 改为 pipeline 批量发布后，发布调用走
    ``pipe.publish(...)``（同步入队）+ ``await pipe.execute()``。假件把入队
    调用记录进 ``redis.pipe_publish``（MagicMock，同步记录无未 await 协程），
    供 ``_session_log_payloads`` 等断言侧读取；``redis.publish`` 保持 AsyncMock
    不变（session/service.py 等仍直接 ``await redis.publish`` 的路径继续可用）。
    """
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
    """Build an active batch-style lease + run + claim_token for submit_messages.

    对齐 test_run_sync_cache_parse.py._seed_batch_run_for_submit。
    """
    import secrets

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="pending",
        spec_strategy="oneshot",
    )
    db_session.add(run)
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
    """Build a lease + run 带 agent_session_id（interactive 形态）for submit_messages。

    task-03：override publish 测试需 ``publish_submitted_messages`` 走 session channel
    分支（``intent.agent_session_id`` 非 None 才发到 ``agent_session:{id}``）。给 run
    设 ``agent_session_id`` 即可；lease 形态不影响 submit_messages（只验 lease+token+run）。
    对齐 _seed_batch_run_for_submit 的最小构造（不引入 RunPlacementService，保持本文件
    现有简洁结构；submit_messages 不读 lease.kind）。
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


# segmentId 用 daemon 格式（${prefix}:${mid}:${blockIndex}），prefix='main' 主 agent。
SEG = "main:msg-abc:0"


# ── assistant override 删 partial ────────────────────────────────────────────


class TestAssistantOverrideDeletesPartial:
    """task-12 / D-002@v1：[ASSISTANT_OVERRIDE] 信号回退同 segmentId assistant partial。"""

    @pytest.mark.asyncio
    async def test_partial_then_override_partial_expunged(self, db_session, mocked_redis) -> None:
        """assistant partial（带 segmentId）+ [ASSISTANT_OVERRIDE] 同 segmentId →
        partial 被 expunge 回滚，仅 override 后到达的完整行落库；override 信号
        本身不落库（continue）。

        场景：daemon 先 flush 半截 assistant（partial），完整 message 到达后 emit
        override 信号。一次 submit_messages 内顺序：partial → override 信号。
        backend 识别 override → expunge 已 add 的 partial（pending 未 commit），
        DB 只剩 override 信号之后到达的完整行（此处无完整行，故 DB 为空）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": "[ASSISTANT] 半截回复",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "isPartial": True},
            },
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "stale": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        # partial 被 expunge + override 信号 continue → 0 条落库。
        assert count == 0

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "partial 应被回退、override 信号不落库"

    @pytest.mark.asyncio
    async def test_override_then_complete_no_duplicate(self, db_session, mocked_redis) -> None:
        """override 信号先到 + 完整 assistant 行（带同 segmentId, isComplete）后到 →
        override 把 segment 加入 completed_segments；完整行正常落库（不被 expunge），
        无重复落库。验证 #35 双发消除：只剩 1 条完整行。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "stale": True},
            },
            {
                "event_type": "text",
                "content": "[ASSISTANT] 完整回复",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "isComplete": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        # override 信号 continue（不计入），完整行 1 条落库。
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "[ASSISTANT] 完整回复"

    @pytest.mark.asyncio
    async def test_late_partial_after_override_discarded(self, db_session, mocked_redis) -> None:
        """late partial：override 信号先到（completed_segments 命中），同 segment
        的 partial 后到 → partial 被丢弃（不 INSERT）。乱序兜底场景。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "stale": True},
            },
            # late partial：override 已标记 completed_segments，此行应被丢弃。
            {
                "event_type": "text",
                "content": "[ASSISTANT] 迟到的半截",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "isPartial": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        # override 信号 continue + late partial 丢弃 → 0 条落库。
        assert count == 0

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0

    @pytest.mark.asyncio
    async def test_override_signal_not_persisted(self, db_session, mocked_redis) -> None:
        """[ASSISTANT_OVERRIDE] 信号本身绝不落库（continue 跳过 INSERT + publish），
        即使没有配对的 partial / 完整行（孤立信号也不写入 agent_run_logs）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "stale": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 0

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0
        # 确认没有任何行的 content 以 [ASSISTANT_OVERRIDE] 开头（防御性）。
        assert not any(
            r.content_redacted and r.content_redacted.startswith("[ASSISTANT_OVERRIDE]")
            for r in rows
        )

    @pytest.mark.asyncio
    async def test_override_without_segmentid_falls_through(self, db_session, mocked_redis) -> None:
        """边界：[ASSISTANT_OVERRIDE] 信号缺 segmentId（daemon 异常 / 旧版本）→
        不命中 override 分支（需 content 前缀 + segmentId 同时满足），作为普通
        stdout 行落库。保证畸形信号不静默丢日志。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                # 前缀匹配但 metadata 缺 segmentId。
                "content": "[ASSISTANT_OVERRIDE] ",
                "channel": "stdout",
                "metadata": {"stale": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 1  # 作为普通行落库

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "[ASSISTANT_OVERRIDE] "


# ── assistant override vs thinking override 不串扰 ───────────────────────────


class TestAssistantOverrideNoCrossTalkWithThinking:
    """task-12 / B2：[ASSISTANT_OVERRIDE] 与 [THINKING_OVERRIDE] 链路互不串扰。

    关键约束（service.py:378-419 / 405-419）：override 信号分支只认各自的前缀
    （``[THINKING_OVERRIDE] `` / ``[ASSISTANT_OVERRIDE] ``），按 content 前缀分流，
    不依赖 metadata.thinking 标记（assistant override metadata 严禁 thinking:true，
    但即使误带也由前缀分流隔离）。thinking partial + assistant override 信号不会
    互相误撤。
    """

    @pytest.mark.asyncio
    async def test_thinking_override_still_works_alongside_assistant(
        self, db_session, mocked_redis
    ) -> None:
        """thinking partial + [THINKING_OVERRIDE] 同 segmentId → partial 被 expunge；
        同次调用内 assistant override 信号独立处理，互不影响（对齐 task-11 既有行为）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        thinking_seg = "main:msg-think:0"
        asst_seg = "main:msg-asst:1"
        messages = [
            # thinking partial（thinking:true）。
            {
                "event_type": "text",
                "content": "[THINKING] 半截思考",
                "channel": "stdout",
                "metadata": {"thinking": True, "segmentId": thinking_seg, "isPartial": True},
            },
            # thinking override 信号 → expunge 上面的 thinking partial。
            {
                "event_type": "text",
                "content": f"[THINKING_OVERRIDE] {thinking_seg}",
                "channel": "stdout",
                "metadata": {"thinking": True, "segmentId": thinking_seg, "stale": True},
            },
            # assistant override 信号（不同 segmentId）→ 不应影响 thinking partial。
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {asst_seg}",
                "channel": "stdout",
                "metadata": {"segmentId": asst_seg, "stale": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        # thinking partial expunge + thinking override continue + assistant override continue → 0。
        assert count == 0

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0

    @pytest.mark.asyncio
    async def test_assistant_override_does_not_touch_thinking_partial(
        self, db_session, mocked_redis
    ) -> None:
        """[ASSISTANT_OVERRIDE] 信号不影响**不同 segmentId** 的 thinking partial。

        现实场景里 thinking 与 assistant text 各占不同 content block（不同 index），
        segmentId 天然不同（``main:mid:thinking_idx`` vs ``main:mid:text_idx``）。
        assistant override 撤的是 assistant segment，thinking partial 保留。本用例
        验证不串扰的真实机制：按 segmentId 隔离，而非按 kind 隔离。

        （注：service.py flushed_partials 按 segmentId 索引、不区分 kind；同
        segmentId 的 override 会撤同 segmentId 的任意已 flush partial。这是设计
        取舍——daemon 保证 thinking/assistant segmentId 不撞，故正常流不串扰。
        本用例用不同 segmentId 复现正常场景。）
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        thinking_seg = "main:msg-mix:0"  # thinking block index=0
        asst_seg = "main:msg-mix:1"  # text block index=1
        messages = [
            # thinking partial（segmentId = thinking_seg）。
            {
                "event_type": "text",
                "content": "[THINKING] 半截思考",
                "channel": "stdout",
                "metadata": {"thinking": True, "segmentId": thinking_seg, "isPartial": True},
            },
            # assistant override 撤的是 asst_seg（不同 segmentId），不影响 thinking partial。
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {asst_seg}",
                "channel": "stdout",
                "metadata": {"segmentId": asst_seg, "stale": True},
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        # assistant override continue + 无 asst_seg partial 可撤 → thinking partial 保留落库。
        assert count == 1

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "[THINKING] 半截思考"
        # assistant override 信号未落库。
        assert not any(
            r.content_redacted and r.content_redacted.startswith("[ASSISTANT_OVERRIDE]")
            for r in rows
        )


# ── task-14：跨 submit_messages 调用 override DELETE 已落库 partial ──────────


class TestCrossCallOverrideDeletesCommittedPartial:
    """task-14 / FR-02 / D-002@v1：partial 与 override 分两次 submit_messages 到达时，
    override 跨调用 DELETE 已 commit 的 partial 行（task-08 expunge 只覆盖单调用内 pending）。

    根因：daemon 流式 partial（半截）先 flush 落库（调用 A commit），完整 message +
    override 信号后到（调用 B）。``flushed_partials``（service.py:346）是函数内局部变量
    跨调用不共享，partial 已 persisted 无法 expunge，AgentRunLog 加 segment_id 列后，
    override 按 segment_id select + session.delete 跨调用删已落库 partial。
    """

    @pytest.mark.asyncio
    async def test_partial_committed_then_override_deletes(self, db_session, mocked_redis) -> None:
        """调用 A 提交 partial（带 segmentId）→ 调用 B 仅 override 信号 → 调用 B 后
        DB 中调用 A 落库的 partial 被跨调用 DELETE，无残留。override 信号本身不落库。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 调用 A：partial 落库 commit。
        count_a = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截回复",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        assert count_a == 1
        rows_after_a = await _fetch_logs(db_session, run_id)
        assert len(rows_after_a) == 1, "调用 A：partial 应已落库"
        assert rows_after_a[0].segment_id == SEG, "partial 行应持久化 segment_id"

        # 调用 B：override 信号（跨调用）。
        count_b = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "stale": True},
                }
            ],
        )
        assert count_b == 0, "override 信号本身不落库"

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "调用 A 落库的 partial 应被跨调用 DELETE"

    @pytest.mark.asyncio
    async def test_partial_then_complete_plus_override_keeps_only_complete(
        self, db_session, mocked_redis
    ) -> None:
        """真实流式场景：调用 A partial 落库 → 调用 B 同次到达完整行 + override 信号 →
        override DELETE 调用 A 的 partial，完整行保留。最终 DB 只剩 1 条完整行（#35 消除）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 调用 A：partial。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截回复",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        assert len(await _fetch_logs(db_session, run_id)) == 1

        # 调用 B：完整行 + override 信号（daemon 完整 message 之后异步 emit override）。
        count_b = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完整回复",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isComplete": True},
                },
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "stale": True},
                },
            ],
        )
        assert count_b == 1, "调用 B：仅完整行落库（override 信号 continue）"

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1, "最终只剩完整行，#35 累积重复消除"
        assert rows[0].content_redacted == "[ASSISTANT] 完整回复"
        assert rows[0].segment_id is None, "完整行 segment_id 应为 NULL"

    @pytest.mark.asyncio
    async def test_complete_row_not_deleted_by_override(self, db_session, mocked_redis) -> None:
        """边界：完整行（segment_id NULL）不受 override DELETE 影响——override 按
        segment_id 删除只命中 segment_id 非空的 partial 行，完整行保留。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 调用 A：完整行（isComplete，segment_id 落库为 NULL）。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完整回复",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isComplete": True},
                }
            ],
        )
        # 调用 B：override 信号（同 segmentId，但调用 A 的是完整行非 partial）。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "stale": True},
                }
            ],
        )

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 1, "完整行 segment_id=NULL 不被 override DELETE 误删"
        assert rows[0].content_redacted == "[ASSISTANT] 完整回复"

    @pytest.mark.asyncio
    async def test_thinking_override_cross_call_deletes_committed_thinking_partial(
        self, db_session, mocked_redis
    ) -> None:
        """对齐 thinking：thinking partial 跨调用落库后，[THINKING_OVERRIDE] 信号同样
        跨调用 DELETE 已 commit 的 thinking partial（task-14 同时覆盖 thinking 链路，
        不只 assistant）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        thinking_seg = "main:msg-think:thinking"
        # 调用 A：thinking partial。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[THINKING] 半截思考",
                    "channel": "stdout",
                    "metadata": {"thinking": True, "segmentId": thinking_seg, "isPartial": True},
                }
            ],
        )
        assert len(await _fetch_logs(db_session, run_id)) == 1

        # 调用 B：thinking override。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[THINKING_OVERRIDE] {thinking_seg}",
                    "channel": "stdout",
                    "metadata": {"thinking": True, "segmentId": thinking_seg, "stale": True},
                }
            ],
        )

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "thinking partial 跨调用也应被 DELETE"

    @pytest.mark.asyncio
    async def test_partial_persists_segment_id_complete_does_not(
        self, db_session, mocked_redis
    ) -> None:
        """segment_id 列持久化口径：partial 行写 segment_id，complete 行 NULL。
        DELETE by segment_id 因此只命中 partial，无需 is_partial 列。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        partial_seg = "main:msg-partial:text"
        complete_seg = "main:msg-complete:text"
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截",
                    "channel": "stdout",
                    "metadata": {"segmentId": partial_seg, "isPartial": True},
                },
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完整",
                    "channel": "stdout",
                    "metadata": {"segmentId": complete_seg, "isComplete": True},
                },
            ],
        )

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 2
        by_content = {r.content_redacted: r for r in rows}
        assert by_content["[ASSISTANT] 半截"].segment_id == partial_seg
        assert by_content["[ASSISTANT] 完整"].segment_id is None


# ── task-03：override publish 到 SSE 不落库 + segment_id 透传 ──────────────────
#
# 变更 2026-08-03-session-stream-partial-revoke Wave1：task-01 给 SSE envelope 加
# segment_id 字段（取 log_entry.segment_id，complete 行 None）；task-02 把 override
# 信号从「continue 截断」改为「publish 到 SSE 但不落库」（append 到 published_logs，
# 复用 publish_submitted_messages 两路 publish）。本组测试锁定这两条行为：
#   - override envelope 出现在 published_logs（content/stale/segment_id/log_id=None）。
#   - override 不落库（agent_run_logs 无 override 行，保留 task-14 override 不污染历史）。
#   - session channel（agent_session:{id}）收到 override envelope（publish_submitted_messages
#     经 mocked_redis.publish 捕获）。
#   - segment_id 透传：partial 行 published_logs entry 非空、complete 行 None。


def _session_log_payloads(mocked_redis: AsyncMock) -> list[dict]:
    """从 mocked redis 的发布调用里挑出 session channel 的 log 事件 payload。

    publish_submitted_messages 对每条 log 发两类发布：
      1. agent_run:{run_id} channel —— 整个 published_logs entry（扁平 StreamLogEvent）。
      2. agent_session:{session_id} channel —— session_payload（带 event/session_id/run_id）。
    本 helper 只取 session channel（topic 以 "agent_session:" 开头）且 event=='log'
    的 payload，解析 JSON 返回 dict 列表。ql-20260826-011 起批量发布走
    pipeline（``redis.pipe_publish``），单条路径仍走 ``redis.publish``，两者都读。
    """
    import json

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
        if not isinstance(channel, str) or not channel.startswith("agent_session:"):
            continue
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(payload, dict) and payload.get("event") == "log":
            out.append(payload)
    return out


class TestOverridePublishsToSseNotPersisted:
    """task-02 / FR-02：override 信号 publish 到 session SSE 但不落库。"""

    @pytest.mark.asyncio
    async def test_assistant_override_envelope_in_published_logs(
        self, db_session, mocked_redis
    ) -> None:
        """assistant partial + [ASSISTANT_OVERRIDE] 同 segmentId → published_logs 含
        一条 override envelope（content 前缀正确、segment_id=被撤回 id、stale=True、
        log_id=None、channel=stdout），且 override 信号本身不落库（agent_run_logs 无
        override 行）。count 仍 0（不进 log_entry 构造）。
        """
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": "[ASSISTANT] 半截回复",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "isPartial": True},
            },
            {
                "event_type": "text",
                "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                "channel": "stdout",
                "metadata": {"segmentId": SEG, "stale": True},
            },
        ]
        result = await svc.submit_messages(lease_id, token, run_id, messages)
        # partial 被 expunge + override 不进 log_entry → count 0（task-14 行为不变）。
        assert result == 0
        # 但 published_logs 含 override envelope（task-02 新行为）。
        override_entries = [e for e in result.published_logs if e.get("stale") is True]
        assert len(override_entries) == 1, "override envelope 应 append 到 published_logs"
        env = override_entries[0]
        assert env["content"] == f"[ASSISTANT_OVERRIDE] {SEG}"
        assert env["segment_id"] == SEG
        assert env["stale"] is True
        assert env["log_id"] is None
        assert env["channel"] == "stdout"
        assert "timestamp" in env, "envelope 必须带 timestamp（session_payload 直取）"

        # override 不落库：agent_run_logs 无任何 override 行。
        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "override 信号不落库，partial 已被 expunge"

        # 触发 publish（router 在 commit 后调），验证 session channel 收到 override envelope。
        await publish_submitted_messages(result.publish_intent)
        session_logs = _session_log_payloads(mocked_redis)
        override_session = [s for s in session_logs if s.get("stale") is True]
        assert len(override_session) == 1, "session channel 应收到 override envelope"
        assert override_session[0]["content"] == f"[ASSISTANT_OVERRIDE] {SEG}"
        assert override_session[0]["segment_id"] == SEG
        assert override_session[0]["stale"] is True

    @pytest.mark.asyncio
    async def test_thinking_override_envelope_in_published_logs(
        self, db_session, mocked_redis
    ) -> None:
        """对齐 thinking：thinking partial + [THINKING_OVERRIDE] 同 segmentId →
        published_logs 含 override envelope（content [THINKING_OVERRIDE] 前缀），
        且 session channel 收到、不落库。覆盖 :413 thinking 分支。
        """
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        thinking_seg = "main:msg-think:0"
        messages = [
            {
                "event_type": "text",
                "content": "[THINKING] 半截思考",
                "channel": "stdout",
                "metadata": {"thinking": True, "segmentId": thinking_seg, "isPartial": True},
            },
            {
                "event_type": "text",
                "content": f"[THINKING_OVERRIDE] {thinking_seg}",
                "channel": "stdout",
                "metadata": {"thinking": True, "segmentId": thinking_seg, "stale": True},
            },
        ]
        result = await svc.submit_messages(lease_id, token, run_id, messages)
        assert result == 0

        override_entries = [e for e in result.published_logs if e.get("stale") is True]
        assert len(override_entries) == 1
        env = override_entries[0]
        assert env["content"] == f"[THINKING_OVERRIDE] {thinking_seg}"
        assert env["segment_id"] == thinking_seg
        assert env["stale"] is True
        assert env["log_id"] is None

        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "thinking override 也不落库"

        await publish_submitted_messages(result.publish_intent)
        session_logs = _session_log_payloads(mocked_redis)
        override_session = [s for s in session_logs if s.get("stale") is True]
        assert len(override_session) == 1
        assert override_session[0]["content"] == f"[THINKING_OVERRIDE] {thinking_seg}"

    @pytest.mark.asyncio
    async def test_cross_call_override_publishs_and_deletes(self, db_session, mocked_redis) -> None:
        """跨调用场景：调用 A partial 落库 → 调用 B override 信号 → 调用 B 既
        DELETE 调用 A 的 partial（task-14 R-05 不回归），又 publish override envelope
        到 session SSE（task-02 新行为）。验证两条机制叠加正确。
        """
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 调用 A：partial 落库 commit。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截回复",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        assert len(await _fetch_logs(db_session, run_id)) == 1

        # 调用 B：override 信号（跨调用 DELETE + publish）。
        result_b = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "stale": True},
                }
            ],
        )
        assert result_b == 0, "override 信号本身不落库"

        # 调用 A 的 partial 被跨调用 DELETE。
        rows = await _fetch_logs(db_session, run_id)
        assert len(rows) == 0, "调用 A 落库的 partial 应被 DELETE（task-14 R-05 不回归）"

        # 调用 B 的 published_logs 含 override envelope（task-02 新行为）。
        override_entries = [e for e in result_b.published_logs if e.get("stale") is True]
        assert len(override_entries) == 1
        assert override_entries[0]["segment_id"] == SEG

        # session channel 收到 override envelope。
        await publish_submitted_messages(result_b.publish_intent)
        session_logs = _session_log_payloads(mocked_redis)
        assert any(s.get("stale") is True for s in session_logs)


class TestSegmentIdTransmittedToSse:
    """task-01 / FR-01：segment_id 透传到 SSE envelope（partial 非空、complete None）。"""

    @pytest.mark.asyncio
    async def test_partial_complete_segment_id_in_published_logs(
        self, db_session, mocked_redis
    ) -> None:
        """partial 行 published_logs entry 的 segment_id 非空（"main:msg_xxx:N" 格式），
        complete 行 segment_id 为 None。D-003 铁律：取 log_entry.segment_id（complete
        行 None），不用循环顶部局部变量 segment_id（complete 行也非 None 会误判）。
        """
        from app.modules.daemon.run_sync.service import publish_submitted_messages

        lease_id, run_id, token = await _seed_interactive_run_for_submit(db_session)
        svc = DaemonService(db_session)
        partial_seg = "main:msg-partial:text"
        complete_seg = "main:msg-complete:text"
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截",
                    "channel": "stdout",
                    "metadata": {"segmentId": partial_seg, "isPartial": True},
                },
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完整",
                    "channel": "stdout",
                    "metadata": {"segmentId": complete_seg, "isComplete": True},
                },
            ],
        )
        # 过滤掉 override envelope（stale=True），只看真实 log 行。
        real_entries = [e for e in result.published_logs if e.get("stale") is not True]
        by_content = {e["content"]: e for e in real_entries}
        assert by_content["[ASSISTANT] 半截"]["segment_id"] == partial_seg, (
            "partial 行 segment_id 应非空（取 log_entry.segment_id）"
        )
        assert by_content["[ASSISTANT] 完整"]["segment_id"] is None, (
            "complete 行 segment_id 应为 None（D-003：取 log_entry.segment_id 而非"
            "循环顶部局部变量，否则会被误判为半截）"
        )

        # session channel 透传一致。
        await publish_submitted_messages(result.publish_intent)
        session_logs = _session_log_payloads(mocked_redis)
        session_by_content = {s["content"]: s for s in session_logs}
        assert session_by_content["[ASSISTANT] 半截"]["segment_id"] == partial_seg
        assert session_by_content["[ASSISTANT] 完整"]["segment_id"] is None
