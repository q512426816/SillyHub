"""Wave 5 integration tests — patch apply, status sync, lease expiry rollback.

Tests the complete daemon lifecycle: register → lease → claim → start →
heartbeat → messages → complete, plus the error/recovery paths for patch
conflicts, status sync, and lease expiry with automatic rollback.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonInvalidClaimToken,
    DaemonLeaseNotClaimed,
    DaemonService,
    PatchApplyError,
)
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"test-{uid}@example.com",
        password_hash="irrelevant",
        display_name="Test",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_agent_run(
    session: AsyncSession,
    *,
    status: str = "pending",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-workspace",
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:8]}",
        slug=f"test-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _link_run_to_workspace(
    session: AsyncSession,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> None:
    link = AgentRunWorkspace(agent_run_id=run_id, workspace_id=workspace_id)
    session.add(link)
    await session.commit()


# ── Test: Patch apply ────────────────────────────────────────────────────────


class TestPatchApply:
    """Tests for DaemonService._apply_patch_to_worktree."""

    @pytest.mark.asyncio
    async def test_patch_apply_no_workspace_raises(self, db_session: AsyncSession) -> None:
        """_apply_patch_to_worktree raises PatchApplyError if no workspace linked."""
        svc = DaemonService(db_session)
        agent_run = await _create_agent_run(db_session)

        with pytest.raises(PatchApplyError):
            await svc._apply_patch_to_worktree(
                agent_run_id=agent_run.id,
                patch_data="diff --git a/file.txt b/file.txt\n",
            )

    @pytest.mark.asyncio
    async def test_patch_apply_workspace_not_found_raises(self, db_session: AsyncSession) -> None:
        """_apply_patch_to_worktree raises PatchApplyError if workspace is missing."""
        svc = DaemonService(db_session)
        agent_run = await _create_agent_run(db_session)
        fake_ws_id = uuid.uuid4()
        await _link_run_to_workspace(db_session, agent_run.id, fake_ws_id)

        with pytest.raises(PatchApplyError):
            await svc._apply_patch_to_worktree(
                agent_run_id=agent_run.id,
                patch_data="diff --git a/file.txt b/file.txt\n",
            )


# ── Test: AgentRun status sync ──────────────────────────────────────────────


class TestAgentRunStatusSync:
    """Tests for DaemonService.sync_agent_run_status."""

    @pytest.mark.asyncio
    async def test_sync_status_to_running(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status updates AgentRun to running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        # Create and claim a lease
        svc = DaemonService(db_session)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "test-token-123"},
        )
        db_session.add(lease)
        await db_session.commit()
        await db_session.refresh(lease)

        result = await svc.sync_agent_run_status(lease.id, "test-token-123", "running")

        assert result is not None
        assert result.status == "running"
        assert result.started_at is not None

    @pytest.mark.asyncio
    async def test_sync_status_to_failed_with_error(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status sets output_redacted on failure."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.sync_agent_run_status(lease.id, "tok", "failed", error="OOM killed")

        assert result is not None
        assert result.status == "failed"
        assert result.finished_at is not None
        assert result.output_redacted == "OOM killed"

    @pytest.mark.asyncio
    async def test_sync_status_no_agent_run_linked(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status returns None if lease has no agent_run_id."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.sync_agent_run_status(lease.id, "tok", "running")

        assert result is None

    @pytest.mark.asyncio
    async def test_sync_status_wrong_token_raises(self, db_session: AsyncSession) -> None:
        """sync_agent_run_status raises on wrong claim_token."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=uuid.uuid4(),
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "real-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonInvalidClaimToken):
            await svc.sync_agent_run_status(lease.id, "bad-token", "running")


# ── Test: Submit messages with status sync ───────────────────────────────────


class TestSubmitMessagesSync:
    """Tests for DaemonService.submit_messages with AgentRun status sync."""

    @pytest.mark.asyncio
    async def test_submit_messages_activates_pending_run(self, db_session: AsyncSession) -> None:
        """submit_messages changes AgentRun from pending to running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "msg-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "msg-token",
            agent_run.id,
            [{"channel": "stdout", "content": "Hello from daemon"}],
        )

        assert count == 1
        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at is not None

    @pytest.mark.asyncio
    async def test_submit_messages_does_not_downgrade_running(
        self, db_session: AsyncSession
    ) -> None:
        """submit_messages keeps AgentRun as running if already running."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        old_started = agent_run.started_at

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "msg-token"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "msg-token",
            agent_run.id,
            [{"channel": "stdout", "content": "More output"}],
        )

        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at == old_started

    @pytest.mark.asyncio
    async def test_submit_messages_extracts_sdk_assistant_content(
        self, db_session: AsyncSession
    ) -> None:
        """ql-006：interactive session（SDK driver）发原始 SDK assistant msg，content
        nested 在 message.content。backend 必须按 block 展开——每个 text block 一条
        [ASSISTANT] 日志——否则 count=0、quick-chat 无输出。旧实现拼接成 1 条，现在
        每块独立落库（与 batch mode task-runner._eventToMessages 对齐）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "sdk-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "sdk-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "你好，我是 GLM"},
                            {"type": "text", "text": "，有什么可以帮你"},
                        ],
                    },
                }
            ],
        )
        # 每个 text block 一条日志（不再拼接）
        assert count == 2

        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert [lg.channel for lg in logs] == ["stdout", "stdout"]
        assert logs[0].content_redacted == "[ASSISTANT] 你好，我是 GLM"
        assert logs[1].content_redacted == "[ASSISTANT] ，有什么可以帮你"

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_thinking_block(self, db_session: AsyncSession) -> None:
        """ql-006：assistant message 的 thinking block 必须落成 [THINKING] 日志，
        不再被丢弃。超 20000 字截断并加 '...' 后缀（ql-20260709-002 放宽，对齐 task-runner）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "think-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        long_text = "x" * 25000
        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "think-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": long_text},
                        ],
                    },
                }
            ],
        )
        assert count == 1
        stmt = select(AgentRunLog).where(col(AgentRunLog.run_id) == agent_run.id)
        lg = (await db_session.execute(stmt)).scalars().first()
        assert lg is not None
        assert lg.channel == "stdout"
        # [THINKING] (9) + 20000 个 x + "..." (3) = 20012
        assert lg.content_redacted == "[THINKING] " + ("x" * 20000) + "..."

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_tool_use_block(self, db_session: AsyncSession) -> None:
        """ql-006：assistant message 的 tool_use block 必须落 2 条日志——
        stdout [TOOL_USE] Name: cmd + tool_call JSON（前端 ToolCallCard 渲染）。
        旧实现整条丢弃，导致前端看不到任何工具调用。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tu-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "tu-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "toolu_01",
                                "name": "Bash",
                                "input": {"command": "ls -la"},
                            }
                        ],
                    },
                }
            ],
        )
        assert count == 2
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        # 第一条：stdout 文本行
        assert logs[0].channel == "stdout"
        assert logs[0].content_redacted == "[TOOL_USE] Bash: ls -la"
        # 第二条：tool_call JSON
        assert logs[1].channel == "tool_call"
        assert logs[1].content_redacted is not None
        tc = json.loads(logs[1].content_redacted)
        assert tc["tool"] == "Bash"
        assert tc["args"] == {"command": "ls -la"}
        assert tc["status"] == "allowed"
        assert tc["success"] is True

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_tool_use_block_carries_tool_use_id(
        self, db_session: AsyncSession
    ) -> None:
        """task-13 / D-002@v1：interactive 模式（_extract_sdk_messages 展开完整
        SDK assistant message）必须把 tool_use block 的 id（toolu_xxx）透传到
        tool_call JSON 的 tool_use_id 字段，让前端 normalize 全局配对（task-14）。

        batch 模式（task-runner.ts）已对齐，本测试覆盖 interactive 模式。
        两路径必须一致（边界5）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tui-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "tui-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "toolu_test456",
                                "name": "Read",
                                "input": {"file_path": "/x"},
                            }
                        ],
                    },
                }
            ],
        )
        assert count == 2
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        # 第一条 stdout 文本
        assert logs[0].channel == "stdout"
        assert logs[0].content_redacted == '[TOOL_USE] Read: {"file_path": "/x"}'
        # 第二条 tool_call JSON 含 tool_use_id（snake_case）
        assert logs[1].channel == "tool_call"
        tc = json.loads(logs[1].content_redacted)
        assert tc["tool"] == "Read"
        assert tc["tool_use_id"] == "toolu_test456"
        assert tc["args"] == {"file_path": "/x"}
        assert tc["status"] == "allowed"
        assert tc["success"] is True

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_tool_use_block_no_id_omits_field(
        self, db_session: AsyncSession
    ) -> None:
        """task-13 退化：SDK tool_use block 无 id 字段时，tool_call JSON 应省略
        tool_use_id（不崩、不报错），前端 normalize 回退 ±3 窗口（task-14）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "noid-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "noid-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                # 故意省略 id
                                "name": "Bash",
                                "input": {"command": "echo hi"},
                            }
                        ],
                    },
                }
            ],
        )
        assert count == 2
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        tc = json.loads(logs[1].content_redacted)
        # 无 id → 省略字段（前端 hasOwnProperty 判断走退化分支）
        assert "tool_use_id" not in tc
        assert tc["tool"] == "Bash"
        assert tc["args"] == {"command": "echo hi"}

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_tool_result_block(self, db_session: AsyncSession) -> None:
        """ql-006：user message（role=user）的 tool_result block 必须落成
        [TOOL_RESULT] 日志。content 可能是 str 或 [{type:text,text:...}]。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tr-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "tr-tok",
            agent_run.id,
            [
                {
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "toolu_01",
                                "content": [
                                    {"type": "text", "text": "total 0\ndrwxr-xr-x src"},
                                ],
                            }
                        ],
                    },
                }
            ],
        )
        assert count == 1
        stmt = select(AgentRunLog).where(col(AgentRunLog.run_id) == agent_run.id)
        lg = (await db_session.execute(stmt)).scalars().first()
        assert lg is not None
        assert lg.channel == "stdout"
        assert lg.content_redacted == "[TOOL_RESULT] total 0\ndrwxr-xr-x src"

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_mixed_assistant_message(
        self, db_session: AsyncSession
    ) -> None:
        """ql-006：一条 assistant message 同时含 thinking + text + tool_use 时，
        必须展开成 4 条日志（1 thinking + 1 text + 2 tool_use），全部保留。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "mix-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "mix-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": "让我想想"},
                            {"type": "text", "text": "我来执行 ls"},
                            {
                                "type": "tool_use",
                                "id": "toolu_02",
                                "name": "Bash",
                                "input": {"command": "ls"},
                            },
                        ],
                    },
                }
            ],
        )
        # thinking(1) + text(1) + tool_use stdout(1) + tool_use tool_call(1) = 4
        assert count == 4
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert [lg.channel for lg in logs] == [
            "stdout",
            "stdout",
            "stdout",
            "tool_call",
        ]
        assert logs[0].content_redacted == "[THINKING] 让我想想"
        assert logs[1].content_redacted == "[ASSISTANT] 我来执行 ls"
        assert logs[2].content_redacted == "[TOOL_USE] Bash: ls"

    # ── task-12 / D-002@v1 / FR-07 FR-08：thinking 按 segmentId 去重 ─────────
    #
    # partial（daemon 节流 flush 的增量 thinking 片段）与完整 assistant message
    # 的 [THINKING] 展开行重复（design §5.3 D1/D2）。task-11 daemon 端给 partial
    # message 加 metadata.segmentId + isPartial:true，并紧跟 [THINKING_OVERRIDE]
    # <segmentId> 信号；完整 message 的 thinking block segmentId = ${msg.id}:${idx}。
    # 本组测试验证 backend submit_messages 单次调用内按 segmentId 去重 —— 完整优先，
    # 同 segment partial 被丢弃；override 信号不落库。

    @pytest.mark.asyncio
    async def test_submit_messages_thinking_same_segment_partial_then_complete_dedup(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：同一次 submit_messages 调用里，partial（segmentId=msg_a:0）
        先到、完整 message（thinking block index=0 → segmentId=msg_a:0）后到 ——
        AgentRunLog 只剩完整 thinking 行，partial 被丢弃。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "dedup-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "dedup-tok",
            agent_run.id,
            [
                # 1) partial 增量片段（daemon 节流 flush）
                {
                    "event_type": "text",
                    "content": "[THINKING] 正在想",
                    "channel": "stdout",
                    "metadata": {"thinking": True, "segmentId": "msg_a:0", "isPartial": True},
                },
                # 2) 完整 assistant message —— _extract_sdk_messages 展开为
                #    [THINKING] 完整内容，segmentId = msg_a:0
                {
                    "type": "assistant",
                    "message": {
                        "id": "msg_a",
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": "正在想完整版"},
                        ],
                    },
                },
            ],
        )
        # partial(0) + 完整 thinking(1) = 1（partial 被去重跳过）
        assert count == 1
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert len(logs) == 1
        assert logs[0].channel == "stdout"
        # 只剩完整行（内容是完整版的 [THINKING]）
        assert logs[0].content_redacted == "[THINKING] 正在想完整版"

    @pytest.mark.asyncio
    async def test_submit_messages_thinking_override_signal_not_persisted(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：[THINKING_OVERRIDE] <segmentId> 信号 message 不落库（仅是
        daemon→backend 的"已覆盖"通知），且信号声明的 segment 被加入 completed
        集合，后续同 segment partial 被跳过。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "ov-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "ov-tok",
            agent_run.id,
            [
                # 1) override 信号（完整 message 已到达，daemon 通知"该 segment 已覆盖"）
                {
                    "event_type": "text",
                    "content": "[THINKING_OVERRIDE] msg_b:0",
                    "channel": "stdout",
                    "metadata": {
                        "thinking": True,
                        "segmentId": "msg_b:0",
                        "stale": True,
                    },
                },
                # 2) 迟到的同 segment partial —— 应被跳过
                {
                    "event_type": "text",
                    "content": "[THINKING] 迟到的片段",
                    "channel": "stdout",
                    "metadata": {
                        "thinking": True,
                        "segmentId": "msg_b:0",
                        "isPartial": True,
                    },
                },
            ],
        )
        # override 信号不落库 + late partial 被去重 → 0
        assert count == 0
        stmt = select(AgentRunLog).where(col(AgentRunLog.run_id) == agent_run.id)
        logs = (await db_session.execute(stmt)).scalars().all()
        assert len(logs) == 0

    @pytest.mark.asyncio
    async def test_submit_messages_thinking_complete_then_override_skips_late_partial(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：完整 thinking 行先落库（_extract_sdk_messages 产出
        segmentId=msg_c:0 isComplete=true），随后 [THINKING_OVERRIDE] 信号到达，
        再后到的同 segment partial 被跳过 —— 覆盖完整先到、partial 后到的乱序场景。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "late-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "late-tok",
            agent_run.id,
            [
                # 1) 完整 message 先到（thinking block index=0 → segmentId=msg_c:0）
                {
                    "type": "assistant",
                    "message": {
                        "id": "msg_c",
                        "role": "assistant",
                        "content": [
                            {"type": "thinking", "thinking": "完整版C"},
                        ],
                    },
                },
                # 2) override 信号（声明 msg_c:0 已覆盖）
                {
                    "event_type": "text",
                    "content": "[THINKING_OVERRIDE] msg_c:0",
                    "channel": "stdout",
                    "metadata": {"thinking": True, "segmentId": "msg_c:0", "stale": True},
                },
                # 3) 迟到的同 segment partial —— 应被跳过
                {
                    "event_type": "text",
                    "content": "[THINKING] 迟到C",
                    "channel": "stdout",
                    "metadata": {
                        "thinking": True,
                        "segmentId": "msg_c:0",
                        "isPartial": True,
                    },
                },
            ],
        )
        # 完整(1) + override 不落库 + late partial 跳过 = 1
        assert count == 1
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert len(logs) == 1
        assert logs[0].content_redacted == "[THINKING] 完整版C"

    @pytest.mark.asyncio
    async def test_submit_messages_thinking_different_segments_kept(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：不同 segmentId 的 partial 互不影响 —— segment_a:0 被完整覆盖，
        但 segment_b:0 的 partial 没有 override / 完整行，照常落库。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "diff-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "diff-tok",
            agent_run.id,
            [
                # segment_a:0 partial + override（被覆盖）
                {
                    "event_type": "text",
                    "content": "[THINKING] 片段A",
                    "channel": "stdout",
                    "metadata": {
                        "thinking": True,
                        "segmentId": "seg_a:0",
                        "isPartial": True,
                    },
                },
                {
                    "event_type": "text",
                    "content": "[THINKING_OVERRIDE] seg_a:0",
                    "channel": "stdout",
                    "metadata": {"thinking": True, "segmentId": "seg_a:0", "stale": True},
                },
                # segment_b:0 partial（无 override、无完整行）→ 保留
                {
                    "event_type": "text",
                    "content": "[THINKING] 片段B",
                    "channel": "stdout",
                    "metadata": {
                        "thinking": True,
                        "segmentId": "seg_b:0",
                        "isPartial": True,
                    },
                },
            ],
        )
        # seg_a partial(跳过) + override(不落库) + seg_b partial(保留) = 1
        assert count == 1
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert len(logs) == 1
        assert logs[0].content_redacted == "[THINKING] 片段B"

    @pytest.mark.asyncio
    async def test_submit_messages_thinking_no_segment_id_backward_compat(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：无 segmentId 的老格式 message（daemon 未升级到 task-11）行为不变 ——
        每条 partial / 完整行都照常落库，不做去重判断（没有 segmentId 无法识别同段）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "compat-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "compat-tok",
            agent_run.id,
            [
                # 无 metadata / segmentId —— 老格式，行为不变（两条都落库，不去重）
                {
                    "event_type": "text",
                    "content": "[THINKING] 老格式片段A",
                    "channel": "stdout",
                },
                {
                    "event_type": "text",
                    "content": "[THINKING] 老格式片段B",
                    "channel": "stdout",
                },
            ],
        )
        # 老格式无 segmentId → 两条都落库（无去重）
        assert count == 2
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == agent_run.id)
            .order_by(col(AgentRunLog.timestamp))
        )
        logs = (await db_session.execute(stmt)).scalars().all()
        assert len(logs) == 2
        assert logs[0].content_redacted == "[THINKING] 老格式片段A"
        assert logs[1].content_redacted == "[THINKING] 老格式片段B"

    @pytest.mark.asyncio
    async def test_extract_sdk_messages_thinking_carries_segment_id(self) -> None:
        """task-12：_extract_sdk_messages 完整 assistant message 的 thinking block
        展开行必须带 metadata.segmentId（${msg.id}:${block_idx}）+ isComplete=True，
        让 submit_messages 去重逻辑生效。"""
        from app.modules.daemon.run_sync.service import _extract_sdk_messages

        msg = {
            "type": "assistant",
            "message": {
                "id": "msg_d",
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "完整思考D"},
                ],
            },
        }
        out = _extract_sdk_messages(msg)
        assert len(out) == 1
        rec = out[0]
        assert rec["content"] == "[THINKING] 完整思考D"
        assert rec["channel"] == "stdout"
        # 关键：segmentId + isComplete 标记
        md = rec.get("metadata")
        assert isinstance(md, dict)
        assert md.get("segmentId") == "msg_d:0"
        assert md.get("isComplete") is True

    @pytest.mark.asyncio
    async def test_extract_sdk_messages_thinking_segment_id_uses_block_index(self) -> None:
        """task-12：同一 message 内多个 thinking block 必须用 block index 区分
        segmentId（msg:0 / msg:1），不能共享同一 id（design §5.3 边界2）。"""
        from app.modules.daemon.run_sync.service import _extract_sdk_messages

        msg = {
            "type": "assistant",
            "message": {
                "id": "msg_e",
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "第一段"},
                    {"type": "text", "text": "中间文本"},
                    {"type": "thinking", "thinking": "第二段"},
                ],
            },
        }
        out = _extract_sdk_messages(msg)
        # 2 thinking + 1 text
        assert len(out) == 3
        thinking_recs = [r for r in out if r["content"].startswith("[THINKING]")]
        assert len(thinking_recs) == 2
        seg_ids = {r["metadata"]["segmentId"] for r in thinking_recs}
        assert seg_ids == {"msg_e:0", "msg_e:2"}

    @pytest.mark.asyncio
    async def test_submit_messages_sdk_extracts_inner_usage(self, db_session: AsyncSession) -> None:
        """ql-006：真实 SDK assistant message 的 usage 在 message.usage（不在顶层），
        _extract_sdk_messages 必须把它透传到 flat record，让 submit_messages 实时
        回写 AgentRun.input_tokens/output_tokens。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "u-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "u-tok",
            agent_run.id,
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "hi"}],
                        "usage": {"input_tokens": 42, "output_tokens": 7},
                    },
                    "session_id": "sess-inner-001",
                }
            ],
        )
        await db_session.refresh(agent_run)
        assert agent_run.input_tokens == 42
        assert agent_run.output_tokens == 7
        assert agent_run.session_id == "sess-inner-001"

    @pytest.mark.asyncio
    async def test_submit_messages_extracts_usage_from_content_message(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260617-001：daemon 把 usage 透传到带 content 的首条 message（[ASSISTANT]
        text 行），backend 必须从这种 message 提取 usage 实时回写 AgentRun。
        旧实现仅处理 content="" 的 message，导致 token 永远停留在「等待用量」。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "usage-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        # 模拟 task-runner.ts _eventToMessages 真实输出：首条 [ASSISTANT] 带 content
        # 同时 usage 透传，第二条 tool_call JSON 也带 usage snapshot。
        await svc.submit_messages(
            lease.id,
            "usage-tok",
            agent_run.id,
            [
                {
                    "event_type": "text",
                    "channel": "stdout",
                    "content": "[ASSISTANT] Hello world",
                    "session_id": "sess-abc-123",
                    "usage": {"input_tokens": 1500, "output_tokens": 200},
                },
                {
                    "event_type": "tool_use",
                    "channel": "tool_call",
                    "content": '{"tool":"Bash","args":{}}',
                    "usage": {"input_tokens": 1800, "output_tokens": 350},
                },
            ],
        )

        await db_session.refresh(agent_run)
        # max(1500, 1800) = 1800；max(200, 350) = 350
        assert agent_run.input_tokens == 1800
        assert agent_run.output_tokens == 350
        assert agent_run.session_id == "sess-abc-123"

    @pytest.mark.asyncio
    async def test_submit_messages_writes_zero_usage(self, db_session: AsyncSession) -> None:
        """ql-20260705-001：daemon 透传 0/0（Claude 中间事件 或 prompt cache 全命中）
        时，backend 写入 0（不再当噪声丢）。前端顶部 stat 用 >0 守卫仍显示"执行中…"，
        不会显示假 0；底部徽标 formatTokenCount(0)="0" 准确反映"未命中 cache 的输入
        为 0"。"0 不覆盖已有真实值"由 max + 仅增不减写回保证（见
        test_run_sync_cache_parse.test_zero_does_not_clobber_existing）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "zero-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "zero-tok",
            agent_run.id,
            [
                {
                    "channel": "stdout",
                    "content": "[ASSISTANT] partial",
                    "session_id": "sess-xyz",
                    "usage": {"input_tokens": 0, "output_tokens": 0},
                }
            ],
        )

        await db_session.refresh(agent_run)
        # ql-20260705-001：0 写入（不再 None）；session_id 仍写回。
        assert agent_run.input_tokens == 0
        assert agent_run.output_tokens == 0
        assert agent_run.session_id == "sess-xyz"

    @pytest.mark.asyncio
    async def test_submit_messages_usage_takes_max_across_batches(
        self, db_session: AsyncSession
    ) -> None:
        """多次 submit_messages（assistant 事件流）应单调递增，取最大值。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=120),
            metadata_={"claim_token": "max-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "max-tok",
            agent_run.id,
            [
                {
                    "channel": "stdout",
                    "content": "[ASSISTANT] turn 1",
                    "usage": {"input_tokens": 1000, "output_tokens": 50},
                }
            ],
        )
        await svc.submit_messages(
            lease.id,
            "max-tok",
            agent_run.id,
            [
                {
                    "channel": "stdout",
                    "content": "[ASSISTANT] turn 2",
                    "usage": {"input_tokens": 2500, "output_tokens": 120},
                }
            ],
        )

        await db_session.refresh(agent_run)
        assert agent_run.input_tokens == 2500
        assert agent_run.output_tokens == 120


# ── Test: Lease expiry and rollback ─────────────────────────────────────────


class TestLeaseExpiryRollback:
    """Tests for DaemonService.handle_lease_expiry and handle_expired_leases_batch."""

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_rollback_to_pending(self, db_session: AsyncSession) -> None:
        """handle_lease_expiry resets AgentRun to pending for re-execution."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        # Create an expired lease
        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=1,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "pending"
        assert agent_run.started_at is None
        assert agent_run.finished_at is None

        # Verify a new pending lease was created with attempt_number=2
        stmt = (
            select(DaemonTaskLease)
            .where(
                col(DaemonTaskLease.agent_run_id) == agent_run.id,
                col(DaemonTaskLease.status) == "pending",
            )
            .order_by(col(DaemonTaskLease.created_at).desc())
        )
        new_lease = (await db_session.execute(stmt)).scalars().first()
        assert new_lease is not None
        assert new_lease.attempt_number == 2

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_max_retries_marks_failed(
        self, db_session: AsyncSession
    ) -> None:
        """handle_lease_expiry marks AgentRun as failed after 3 attempts."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=3,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "failed"
        assert agent_run.finished_at is not None
        assert agent_run.exit_code == -1
        assert "3 attempt" in (agent_run.output_redacted or "")

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_skips_terminal_state(self, db_session: AsyncSession) -> None:
        """handle_lease_expiry skips AgentRun already in terminal state."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="completed")

        past = datetime.now(UTC) - timedelta(seconds=120)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="expired",
            claimed_at=past,
            lease_expires_at=past,
            attempt_number=1,
            metadata_={},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "completed"

    @pytest.mark.asyncio
    async def test_handle_expired_leases_batch(self, db_session: AsyncSession) -> None:
        """handle_expired_leases_batch processes multiple expired leases."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        run_a = await _create_agent_run(db_session, status="running")
        run_b = await _create_agent_run(db_session, status="running")

        past = datetime.now(UTC) - timedelta(seconds=120)
        for run in [run_a, run_b]:
            lease = DaemonTaskLease(
                id=uuid.uuid4(),
                runtime_id=rt.id,
                agent_run_id=run.id,
                status="claimed",
                claimed_at=past,
                lease_expires_at=past,
                attempt_number=1,
                metadata_={"claim_token": "tok"},
            )
            db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.handle_expired_leases_batch()

        assert count == 2

        await db_session.refresh(run_a)
        await db_session.refresh(run_b)
        assert run_a.status == "pending"
        assert run_b.status == "pending"

    @pytest.mark.asyncio
    async def test_handle_lease_expiry_no_expired_lease_is_noop(
        self, db_session: AsyncSession
    ) -> None:
        """handle_lease_expiry is a no-op if no expired lease exists."""
        agent_run = await _create_agent_run(db_session, status="running")

        svc = DaemonService(db_session)
        await svc.handle_lease_expiry(agent_run.id)

        await db_session.refresh(agent_run)
        assert agent_run.status == "running"


# ── Test: Start lease with Redis event ──────────────────────────────────────


class TestStartLeaseRedis:
    """Tests for start_lease method with AgentRun status and Redis event."""

    @pytest.mark.asyncio
    async def test_start_lease_updates_agent_run(self, db_session: AsyncSession) -> None:
        """start_lease sets AgentRun to running with started_at."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="pending")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "start-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.start_lease(lease.id, "start-tok")

        assert result is not None
        await db_session.refresh(agent_run)
        assert agent_run.status == "running"
        assert agent_run.started_at is not None

    @pytest.mark.asyncio
    async def test_start_lease_wrong_status_raises(self, db_session: AsyncSession) -> None:
        """start_lease raises if lease is not claimed."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="pending",
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonLeaseNotClaimed):
            await svc.start_lease(lease.id, "tok")


# ── Test: Complete lease with result ────────────────────────────────────────


class TestCompleteLeaseWithResult:
    """Tests for complete_lease with AgentRun stats update."""

    @pytest.mark.asyncio
    async def test_complete_lease_updates_agent_run_stats(self, db_session: AsyncSession) -> None:
        """complete_lease writes usage stats to AgentRun."""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "comp-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.complete_lease(
            lease.id,
            "comp-tok",
            {
                "status": "completed",
                "stats": {
                    "total_cost_usd": 0.05,
                    "duration_ms": 12000,
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "session_id": "sess-123",
                    "exit_code": 0,
                },
            },
        )

        assert result.status == "completed"
        await db_session.refresh(agent_run)
        assert agent_run.status == "completed"
        assert agent_run.total_cost_usd == 0.05
        assert agent_run.duration_ms == 12000
        assert agent_run.input_tokens == 1000
        assert agent_run.output_tokens == 500
        assert agent_run.session_id == "sess-123"
        assert agent_run.exit_code == 0

    @pytest.mark.asyncio
    async def test_complete_lease_does_not_overwrite_killed_with_cancelled(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260616-006：AgentRun 已 killed（syncStatus 写入）时，
        complete_lease 上报 cancelled 不应降级覆盖。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="killed")
        # 模拟 syncStatus 已写入 finished_at
        agent_run.finished_at = datetime.now(UTC)
        db_session.add(agent_run)
        await db_session.commit()

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "kill-tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        # daemon cancel 后会 complete_lease with status='cancelled'
        result = await svc.complete_lease(
            lease.id,
            "kill-tok",
            {"status": "cancelled", "error": "task cancelled"},
        )

        assert result.status == "completed"  # lease 标 completed（自身生命周期结束）
        await db_session.refresh(agent_run)
        # AgentRun 不应被 cancelled 覆盖（killed 优先级更高）
        assert agent_run.status == "killed"


# ── 2026-06-24-daemon-network-resilience task-22（FR-08 / D-001@v2）─────────────
# submit_messages 的 dedup_key 幂等去重：重复 (run_id, dedup_key) 仅落一行；
# 无 dedup_key 的消息照常 append（NULL 不约束）。


class TestSubmitMessagesDedupKey:
    """dedup_key 幂等：daemon 重试/outbox 补发重复提交同一 dedup_key 仅落库一行。"""

    @pytest.mark.asyncio
    async def test_duplicate_dedup_key_dedupes(self, db_session: AsyncSession) -> None:
        """同一 dedup_key 二次提交 → AgentRunLog 仅 1 行。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        # 首次提交
        c1 = await svc.submit_messages(
            lease.id,
            "tok",
            agent_run.id,
            [{"channel": "stdout", "content": "msg-a", "dedup_key": "dk-1"}],
        )
        assert c1 == 1
        # 重复提交同一 dedup_key（daemon 重试/outbox 补发场景）
        c2 = await svc.submit_messages(
            lease.id,
            "tok",
            agent_run.id,
            [{"channel": "stdout", "content": "msg-a-dup", "dedup_key": "dk-1"}],
        )
        assert c2 == 0  # 去重：不落新行

        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == agent_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 1
        assert logs[0].dedup_key == "dk-1"
        assert logs[0].content_redacted == "msg-a"  # 保留首次，丢弃重复

    @pytest.mark.asyncio
    async def test_different_dedup_keys_both_written(self, db_session: AsyncSession) -> None:
        """不同 dedup_key → 各落一行（不误去重 R-01）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease.id,
            "tok",
            agent_run.id,
            [
                {"channel": "stdout", "content": "a", "dedup_key": "dk-1"},
                {"channel": "stdout", "content": "b", "dedup_key": "dk-2"},
            ],
        )
        assert count == 2
        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == agent_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 2

    @pytest.mark.asyncio
    async def test_none_dedup_key_appends_freely(self, db_session: AsyncSession) -> None:
        """无 dedup_key（None）→ 不约束，重复内容照常 append（兼容旧 daemon）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run = await _create_agent_run(db_session, status="running")
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=agent_run.id,
            status="claimed",
            claimed_at=datetime.now(UTC),
            lease_expires_at=datetime.now(UTC) + timedelta(seconds=60),
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease.id,
            "tok",
            agent_run.id,
            [{"channel": "stdout", "content": "same"}],
        )
        await svc.submit_messages(
            lease.id,
            "tok",
            agent_run.id,
            [{"channel": "stdout", "content": "same"}],
        )
        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == agent_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 2  # 无 dedup_key → 不去重，两行都落
        assert all(row.dedup_key is None for row in logs)
