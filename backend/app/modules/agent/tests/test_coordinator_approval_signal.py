"""coordinator 审批态迁移的列表变更信号单测（2026-10-20-session-status-live-sync）。

背景：run→pending_approval（request_approval）与审批通过翻回 pending（approve）
是左侧徽标「正在执行」↔「在等你」的翻转边沿，此前不发布 agent_sessions:changed
——用户在右侧看到审批弹框，左侧徽标最长 10~30s 不动。修复：两方法 commit 后
补发 status_changed 哑信号。

覆盖：

- request_approval 成功 → 恰一条 ("status_changed", session_id, 会话属主)；
- approve 成功 → 同款一条（徽标翻回「正在执行」）；
- token 无效 / 状态不在 pending_approval → 异常路径零发布；
- run 无绑定会话（agent_session_id=None）→ 静默跳过零发布。

harness 对齐 test_close_interactive_run_session_status.py（最小 seed：user +
session + run；本组不涉 lease/claim，直接落行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession

SignalCalls = list[tuple[str, uuid.UUID, Any]]


@pytest.fixture()
def list_signal_spy(monkeypatch) -> SignalCalls:
    calls: SignalCalls = []

    async def spy_publish(event, session_id, user_id, **kwargs):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr("app.modules.agent.coordinator.publish_sessions_changed", spy_publish)
    return calls


async def _seed(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
    with_session: bool = True,
) -> tuple[uuid.UUID, AgentRun]:
    """建 user + session + run，返回 (属主 user_id, run)。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"approval-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    now = datetime.now(UTC)
    session_id = uuid.uuid4()
    if with_session:
        db_session.add(
            AgentSession(
                id=session_id,
                user_id=uid,
                provider="claude",
                status="active",
                config={},
                turn_count=1,
                created_at=now,
                last_active_at=now,
            )
        )
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="interactive",
        agent_session_id=session_id if with_session else None,
    )
    db_session.add(run)
    await db_session.commit()
    return uid, run


class TestApprovalListSignal:
    @pytest.mark.asyncio
    async def test_request_approval_publishes_signal(
        self, db_session: AsyncSession, list_signal_spy: SignalCalls
    ) -> None:
        """→pending_approval 成功 commit → 恰一条 status_changed（会话属主受众）。"""
        from app.modules.agent.coordinator import ExecutionCoordinatorService

        uid, run = await _seed(db_session, run_status="running")

        svc = ExecutionCoordinatorService(db_session)
        await svc.request_approval(run.id)

        assert list_signal_spy == [("status_changed", run.agent_session_id, uid)]

    @pytest.mark.asyncio
    async def test_approve_publishes_signal(
        self, db_session: AsyncSession, list_signal_spy: SignalCalls
    ) -> None:
        """审批通过翻回 pending → 同款一条（徽标翻回「正在执行」）。"""
        from app.modules.agent.coordinator import ExecutionCoordinatorService

        uid, run = await _seed(db_session, run_status="pending_approval")
        token = "tok-abc"
        run.approval_token = token
        db_session.add(run)
        await db_session.commit()

        svc = ExecutionCoordinatorService(db_session)
        approved = await svc.approve(run.id, token)

        assert approved.status == "pending"
        assert list_signal_spy == [("status_changed", run.agent_session_id, uid)]

    @pytest.mark.asyncio
    async def test_approve_invalid_token_no_publish(
        self, db_session: AsyncSession, list_signal_spy: SignalCalls
    ) -> None:
        """token 无效 → 异常路径零发布（右侧保持原状态，列表无需翻转）。"""
        from app.modules.agent.coordinator import (
            ExecutionCoordinatorService,
            InvalidTokenError,
        )

        _, run = await _seed(db_session, run_status="pending_approval")
        run.approval_token = "tok-right"
        db_session.add(run)
        await db_session.commit()

        svc = ExecutionCoordinatorService(db_session)
        with pytest.raises(InvalidTokenError):
            await svc.approve(run.id, "tok-wrong")

        assert list_signal_spy == []

    @pytest.mark.asyncio
    async def test_approve_wrong_status_no_publish(
        self, db_session: AsyncSession, list_signal_spy: SignalCalls
    ) -> None:
        """run 不在 pending_approval → AgentRunNotPendingApproval，零发布。"""
        from app.modules.agent.coordinator import (
            AgentRunNotPendingApproval,
            ExecutionCoordinatorService,
        )

        _, run = await _seed(db_session, run_status="running")

        svc = ExecutionCoordinatorService(db_session)
        with pytest.raises(AgentRunNotPendingApproval):
            await svc.approve(run.id, "any")

        assert list_signal_spy == []

    @pytest.mark.asyncio
    async def test_run_without_session_no_publish(
        self, db_session: AsyncSession, list_signal_spy: SignalCalls
    ) -> None:
        """run 无绑定会话（非交互 run）→ 静默跳过，零发布。"""
        from app.modules.agent.coordinator import ExecutionCoordinatorService

        _, run = await _seed(db_session, run_status="running", with_session=False)

        svc = ExecutionCoordinatorService(db_session)
        await svc.request_approval(run.id)

        assert list_signal_spy == []
