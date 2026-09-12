"""task-07（2026-09-10-group-agent-direct-chat）汇总收口状态机测试。

覆盖（design §5.2/§5.4/§7，任务卡 acceptance）：

- ``_parse_group_mentions`` split_broadcast：单 @ 文本出现序 / @全体成员表
  序展开 / 混合两段独立（D-003 汇总人选择基准）；旧调用（合并返回）零变化；
- ``create_consensus_task``：members pending 初始化 + deadline=now+timeout、
  carrier_run_id 幂等（重复建任务返回既有行）、状态卡 channel='system' 落
  载体 run + collecting 卡面；
- ``write_consensus_card``：UPDATE 单行模式（同 log 行 content/metadata 替换，
  不产生第二行）+ 各 phase 卡面文案（collecting/converging/终态）；
- ``record_collaborator_outcome``：delivered 登记 + opinion 快照落 JSONB；
  部分终态仍 collecting；全员终态且 ≥1 delivered → 收口指令注入
  （inject_converge_directive 被调）+ status=closing；零 delivered 全终态
  → aborted；终态幂等（重复登记跳过）；
- ``inject_converge_directive``：coordinator 影子 ended → 任务 aborted 不注入；
  健康 → 注入 prompt 含意见全文与未响应名单、turn_metadata role=converge
  且**无 dm_target**（投影放行契约，D-007 唯一例外）+ timed_out 版
  pending→timeout 标注。

夹具范式镜像 ``test_group_cross_mention.py``（in-memory SQLite db_session），
注入点 ``SessionService.inject_session_as_service`` 全部 mock——状态机语义
单测，不跑引擎链路。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupConsensusTask,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.schema import GroupMemberAgentConfig
from app.modules.auth.model import User
from app.modules.daemon.group.service import (
    CONSENSUS_MEMBER_DELIVERED,
    CONSENSUS_MEMBER_FAILED,
    CONSENSUS_MEMBER_PENDING,
    CONSENSUS_MEMBER_TIMEOUT,
    CONSENSUS_PHASE_ABORTED,
    CONSENSUS_PHASE_COLLECTING,
    CONSENSUS_PHASE_CONVERGING,
    CONSENSUS_TASK_ABORTED,
    CONSENSUS_TASK_CLOSING,
    CONSENSUS_TASK_OPEN,
    CONSENSUS_TASK_TIMEOUT,
    _parse_group_mentions,
    collect_collaborator_opinion,
    consensus_member_states,
    consensus_sweep_once,
    create_consensus_task,
    inject_converge_directive,
    record_collaborator_outcome,
    write_consensus_card,
)
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# ── 夹具（最小行集：群 + 成员 + 载体 run + 影子会话）────────────────────────


async def _make_user(db_session: AsyncSession, name: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"cons-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_group_env(db_session: AsyncSession) -> SimpleNamespace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="cons-ws",
        slug=f"cons-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/cons-ws",
        status="active",
    )
    db_session.add(ws)
    owner = await _make_user(db_session, "群主")
    group = AgentGroupChat(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        workspace_id=ws.id,
        project_id=None,
        title="汇总测试群",
        created_by=owner.id,
        agent_cross_mention=True,
        cross_mention_depth=4,
        context_window=20,
        consensus_mode=True,
        consensus_timeout_seconds=600,
        created_at=datetime.now(UTC),
    )
    db_session.add(group)
    # 载体 run（群会话维度）+ 触发消息行。
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="group",
        agent_session_id=group.session_id,
        user_id=owner.id,
        status="completed",
        started_at=datetime.now(UTC),
        spec_strategy="group_carrier",
    )
    db_session.add(carrier)
    await db_session.flush()
    return SimpleNamespace(ws=ws, owner=owner, group=group, carrier=carrier)


async def _make_member(
    db_session: AsyncSession,
    group: AgentGroupChat,
    *,
    name: str,
    owner_id: uuid.UUID,
    shadow_ended: datetime | None = None,
) -> AgentGroupMember:
    shadow = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        name=f"影子-{name}",
        session_kind="group_member",
        provider="claude",
        status="active",
        turn_count=0,
        created_at=datetime.now(UTC),
        ended_at=shadow_ended,
    )
    db_session.add(shadow)
    await db_session.flush()
    member = AgentGroupMember(
        id=uuid.uuid4(),
        group_id=group.id,
        member_type="agent",
        display_name=name,
        config=GroupMemberAgentConfig(
            display_name=name,
            runtime_id=uuid.uuid4(),
            provider="claude",
        ),
        joined_at=datetime.now(UTC),
        created_by=owner_id,
        shadow_session_id=shadow.id,
    )
    db_session.add(member)
    await db_session.flush()
    return member


async def _seed_task(
    db_session: AsyncSession,
    env: SimpleNamespace,
    *,
    coordinator: AgentGroupMember,
    collaborators: list[AgentGroupMember],
) -> AgentGroupConsensusTask:
    return await create_consensus_task(
        db_session,
        group=env.group,
        carrier_run_id=env.carrier.id,
        coordinator=coordinator,
        collaborators=collaborators,
        created_by=env.owner.id,
        timeout_seconds=600,
        source_summary="触发消息摘要",
    )


async def _card_row(db_session: AsyncSession, carrier_run_id: uuid.UUID) -> AgentRunLog | None:
    return (
        (
            await db_session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == carrier_run_id,
                    AgentRunLog.channel == "system",
                )
            )
        )
        .scalars()
        .first()
    )


# ── split_broadcast（D-003 汇总人选择基准）─────────────────────────────────


def _member_stub(name: str, member_id: uuid.UUID | None = None) -> AgentGroupMember:
    return AgentGroupMember(
        id=member_id or uuid.uuid4(),
        group_id=uuid.uuid4(),
        member_type="agent",
        display_name=name,
        joined_at=datetime.now(UTC),
    )


class TestSplitBroadcast:
    def test_explicit_order_by_text(self):
        a, b, c = _member_stub("甲"), _member_stub("乙"), _member_stub("丙")
        explicit, broadcast = _parse_group_mentions(
            "@丙 帮忙看下 @甲 @乙", [a, b, c], split_broadcast=True
        )
        assert [m.display_name for m in explicit] == ["丙", "甲", "乙"]
        assert broadcast == []

    def test_broadcast_expands_member_table_order(self):
        a, b, c = _member_stub("甲"), _member_stub("乙"), _member_stub("丙")
        explicit, broadcast = _parse_group_mentions("@全体", [a, b, c], split_broadcast=True)
        assert explicit == []
        assert [m.display_name for m in broadcast] == ["甲", "乙", "丙"]

    def test_mixed_two_segments_independent(self):
        a, b, c = _member_stub("甲"), _member_stub("乙"), _member_stub("丙")
        explicit, broadcast = _parse_group_mentions("@乙 @全体", [a, b, c], split_broadcast=True)
        assert [m.display_name for m in explicit] == ["乙"]
        assert [m.display_name for m in broadcast] == ["甲", "乙", "丙"]

    def test_legacy_merged_return_unchanged(self):
        a, b = _member_stub("甲"), _member_stub("乙")
        merged = _parse_group_mentions("@乙 @甲", [a, b])
        assert [m.display_name for m in merged] == ["乙", "甲"]


# ── create_consensus_task（§5.2 建任务 + 状态卡）────────────────────────────


class TestCreateConsensusTask:
    async def test_members_pending_and_deadline(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        c2 = await _make_member(db_session, env.group, name="成员二", owner_id=env.owner.id)
        before = datetime.now(UTC)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1, c2])
        await db_session.commit()
        assert task.status == CONSENSUS_TASK_OPEN
        assert task.coordinator_member_id == coordinator.id
        states = consensus_member_states(task)
        assert [r["member_name"] for r in states] == ["成员一", "成员二"]
        assert all(r["state"] == CONSENSUS_MEMBER_PENDING for r in states)
        assert task.deadline_at is not None
        delta = task.deadline_at - before
        assert timedelta(seconds=599) <= delta <= timedelta(seconds=601)

    async def test_idempotent_by_carrier_run(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        first = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        second = await create_consensus_task(
            db_session,
            group=env.group,
            carrier_run_id=env.carrier.id,
            coordinator=coordinator,
            collaborators=[c1],
            created_by=env.owner.id,
            source_summary="重复建",
        )
        assert second.id == first.id

    async def test_status_card_lands_on_carrier(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        card = await _card_row(db_session, env.carrier.id)
        assert card is not None
        assert "汇总收集中" in (card.content_redacted or "")
        assert card.metadata_["consensus_card"]["coordinator_name"] == "汇总人"
        assert card.metadata_["consensus_task_id"] == str(task.id)


# ── write_consensus_card（UPDATE 单行模式）──────────────────────────────────


class TestWriteConsensusCard:
    async def test_update_reuses_single_row(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        first = await _card_row(db_session, env.carrier.id)
        states = consensus_member_states(task)
        states[0]["state"] = CONSENSUS_MEMBER_DELIVERED
        task.members = states
        await write_consensus_card(
            db_session,
            group=env.group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_COLLECTING,
        )
        await db_session.commit()
        rows = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == env.carrier.id,
                        AgentRunLog.channel == "system",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert "已交意见 1/1" in (rows[0].content_redacted or "")
        assert rows[0].id == first.id

    async def test_terminal_phases_render(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await write_consensus_card(
            db_session,
            group=env.group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_CONVERGING,
        )
        card = await _card_row(db_session, env.carrier.id)
        assert "汇总收口中" in (card.content_redacted or "")
        await write_consensus_card(
            db_session,
            group=env.group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_ABORTED,
        )
        card = await _card_row(db_session, env.carrier.id)
        assert "中止" in (card.content_redacted or "")
        await db_session.commit()


# ── record_collaborator_outcome（登记 + 收口判定内聚）───────────────────────


class TestRecordCollaboratorOutcome:
    async def test_partial_terminal_stays_collecting(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        c2 = await _make_member(db_session, env.group, name="成员二", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1, c2])
        await db_session.commit()
        converge_calls: list = []
        monkeypatch.setattr(
            "app.modules.daemon.group.service.consensus.inject_converge_directive",
            AsyncMock(side_effect=lambda *a, **k: converge_calls.append(k)),
        )
        await record_collaborator_outcome(
            db_session,
            task_id=task.id,
            member_id=c1.id,
            state=CONSENSUS_MEMBER_DELIVERED,
            opinion_text="成员一的意见全文",
        )
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_OPEN
        states = consensus_member_states(task)
        row1 = next(r for r in states if r["member_name"] == "成员一")
        assert row1["state"] == CONSENSUS_MEMBER_DELIVERED
        assert row1["opinion"] == "成员一的意见全文"
        assert converge_calls == []

    async def test_all_terminal_with_delivered_triggers_converge(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        c2 = await _make_member(db_session, env.group, name="成员二", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1, c2])
        await db_session.commit()
        calls: list = []
        monkeypatch.setattr(
            "app.modules.daemon.group.service.consensus.inject_converge_directive",
            AsyncMock(side_effect=lambda *a, **k: calls.append(k)),
        )
        await record_collaborator_outcome(
            db_session,
            task_id=task.id,
            member_id=c1.id,
            state=CONSENSUS_MEMBER_DELIVERED,
            opinion_text="意见一",
        )
        await record_collaborator_outcome(
            db_session,
            task_id=task.id,
            member_id=c2.id,
            state=CONSENSUS_MEMBER_FAILED,
        )
        await db_session.refresh(task)
        # 状态推进（status→closing）在 inject_converge_directive 内（此处被
        # mock）——本断言只验「全员终态触发收口注入一次」，status 变更见
        # TestInjectConvergeDirective。
        assert len(calls) == 1
        assert calls[0]["timed_out"] is False

    async def test_all_terminal_zero_delivered_aborts(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        monkeypatch.setattr(
            "app.modules.daemon.group.service.consensus.inject_converge_directive",
            AsyncMock(),
        )
        await record_collaborator_outcome(
            db_session, task_id=task.id, member_id=c1.id, state=CONSENSUS_MEMBER_FAILED
        )
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_ABORTED

    async def test_terminal_state_idempotent(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        calls: list = []
        monkeypatch.setattr(
            "app.modules.daemon.group.service.consensus.inject_converge_directive",
            AsyncMock(side_effect=lambda *a, **k: calls.append(k)),
        )
        await record_collaborator_outcome(
            db_session,
            task_id=task.id,
            member_id=c1.id,
            state=CONSENSUS_MEMBER_DELIVERED,
            opinion_text="意见一",
        )
        # 重复登记（终态不可逆）：不再触发第二次收口注入。
        await record_collaborator_outcome(
            db_session,
            task_id=task.id,
            member_id=c1.id,
            state=CONSENSUS_MEMBER_FAILED,
        )
        await db_session.refresh(task)
        assert len(calls) == 1
        states = consensus_member_states(task)
        assert states[0]["state"] == CONSENSUS_MEMBER_DELIVERED


# ── inject_converge_directive（收口指令注入 + 健康检查）────────────────────


def _inject_calls(monkeypatch) -> list:
    calls: list = []

    async def _fake_inject(session_id, *, prompt=None, turn_metadata=None, **kwargs):
        calls.append({"session_id": session_id, "prompt": prompt, "meta": turn_metadata})
        return SimpleNamespace(agent_run=None, queued=False, mid_turn=False)

    fake_service = SimpleNamespace(inject_session_as_service=_fake_inject)
    monkeypatch.setattr(
        "app.modules.daemon.group.service.SessionService",
        lambda db: fake_service,
    )
    return calls


class TestInjectConvergeDirective:
    async def test_coordinator_shadow_ended_aborts(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session,
            env.group,
            name="汇总人",
            owner_id=env.owner.id,
            shadow_ended=datetime.now(UTC),
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        await db_session.commit()
        calls = _inject_calls(monkeypatch)
        await inject_converge_directive(db_session, task=task, timed_out=False)
        await db_session.commit()
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_ABORTED
        assert calls == []
        card = await _card_row(db_session, env.carrier.id)
        assert "中止" in (card.content_redacted or "")

    async def test_inject_metadata_no_dm_target(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        c2 = await _make_member(db_session, env.group, name="成员二", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1, c2])
        states = consensus_member_states(task)
        states[0]["state"] = CONSENSUS_MEMBER_DELIVERED
        states[0]["opinion"] = "成员一的完整意见"
        states[1]["state"] = CONSENSUS_MEMBER_TIMEOUT
        task.members = states
        await db_session.commit()
        calls = _inject_calls(monkeypatch)
        await inject_converge_directive(db_session, task=task, timed_out=False)
        await db_session.commit()
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_CLOSING
        assert len(calls) == 1
        assert calls[0]["session_id"] == coordinator.shadow_session_id
        assert "成员一的完整意见" in calls[0]["prompt"]
        assert "成员二" in calls[0]["prompt"]  # 未响应名单
        meta = calls[0]["meta"]
        assert meta["consensus_role"] == "converge"
        assert meta["consensus_task_id"] == str(task.id)
        # D-007 唯一例外：converge 轮无 dm_target → 投影放行。
        assert "dm_target_member_id" not in meta

    async def test_timed_out_marks_pending_timeout(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        c2 = await _make_member(db_session, env.group, name="成员二", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1, c2])
        states = consensus_member_states(task)
        states[0]["state"] = CONSENSUS_MEMBER_DELIVERED
        states[0]["opinion"] = "意见一"
        task.members = states
        await db_session.commit()
        calls = _inject_calls(monkeypatch)
        await inject_converge_directive(db_session, task=task, timed_out=True)
        await db_session.commit()
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_TIMEOUT
        states = consensus_member_states(task)
        assert states[1]["state"] == CONSENSUS_MEMBER_TIMEOUT
        assert "成员二" in calls[0]["prompt"]
        assert len(calls) == 1


# ── collect_collaborator_opinion（意见聚合口径）────────────────────────────


class TestCollectOpinion:
    async def test_filters_and_strips_prefix(self, db_session):
        env = await _make_group_env(db_session)
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            agent_session_id=uuid.uuid4(),
            user_id=env.owner.id,
            status="completed",
            started_at=datetime.now(UTC),
        )
        db_session.add(run)
        base = datetime.now(UTC)
        rows = [
            AgentRunLog(
                run_id=run.id,
                timestamp=base,
                channel="user_input",
                content_redacted="触发消息",
            ),
            AgentRunLog(
                run_id=run.id,
                timestamp=base + timedelta(seconds=1),
                channel="stdout",
                content_redacted="[ASSISTANT]第一段意见",
            ),
            AgentRunLog(
                run_id=run.id,
                timestamp=base + timedelta(seconds=2),
                channel="thinking",
                content_redacted="[THINKING]内部推理",
            ),
            AgentRunLog(
                run_id=run.id,
                timestamp=base + timedelta(seconds=3),
                channel="stdout",
                content_redacted="[ASSISTANT]第二段意见",
            ),
        ]
        db_session.add_all(rows)
        await db_session.commit()
        opinion = await collect_collaborator_opinion(db_session, run_id=run.id)
        assert opinion is not None
        assert "触发消息" not in opinion
        assert "[THINKING]" not in opinion
        assert "第一段意见" in opinion
        assert "第二段意见" in opinion


class TestConsensusSweepOnce:
    """task-09：超时任务巡检——零 delivered→aborted / 有 delivered→超时收口注入。"""

    async def test_not_due_returns_zero(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        task = await _seed_task(
            db_session, env, coordinator=coordinator, collaborators=[coordinator]
        )
        processed = await consensus_sweep_once(db_session)
        assert processed == 0
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_OPEN

    async def test_zero_delivered_overdue_aborts(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        task.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()
        processed = await consensus_sweep_once(db_session)
        assert processed == 1
        # 真实集成修正（2026-09-12 E2E）：rollback 丢弃未提交改动后重读，
        # 验证 sweep 零 delivered 分支的 aborted 已持久化（同事务 refresh
        # 可见未提交改动，无法检出缺 commit）。检测不到则 status 回 open。
        await db_session.rollback()
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_ABORTED
        assert task.converged_at is not None

    async def test_delivered_overdue_triggers_timed_out_converge(self, db_session, monkeypatch):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        task.members = [
            {
                "member_id": str(c1.id),
                "member_name": c1.display_name,
                "state": CONSENSUS_MEMBER_DELIVERED,
                "delivered_at": datetime.now(UTC).isoformat(),
                "opinion": "意见已转交",
            }
        ]
        task.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()
        calls: list[dict] = []

        async def fake_inject(db, *, task, timed_out):
            calls.append({"task_id": task.id, "timed_out": timed_out})

        monkeypatch.setattr(
            "app.modules.daemon.group.service.consensus.inject_converge_directive",
            fake_inject,
        )
        processed = await consensus_sweep_once(db_session)
        assert processed == 1
        assert len(calls) == 1
        assert calls[0]["timed_out"] is True
        assert calls[0]["task_id"] == task.id
        # 真实集成修正（2026-09-12 E2E）：sweep 调 inject 后的持久化由真函数内
        # commit 兑现——本用例 mock 掉 inject（status=timeout 赋值在真函数内，
        # 职责边界归 TestInjectConvergeDirective），此处 rollback 重读验证 sweep
        # 自身未产生意外未提交改动（回 committed 基线 open）。
        await db_session.rollback()
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_OPEN

    async def test_dissolved_group_silent_abort(self, db_session):
        env = await _make_group_env(db_session)
        coordinator = await _make_member(
            db_session, env.group, name="汇总人", owner_id=env.owner.id
        )
        c1 = await _make_member(db_session, env.group, name="成员一", owner_id=env.owner.id)
        task = await _seed_task(db_session, env, coordinator=coordinator, collaborators=[c1])
        task.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        env.group.ended_at = datetime.now(UTC)
        await db_session.commit()
        processed = await consensus_sweep_once(db_session)
        assert processed == 1
        await db_session.refresh(task)
        assert task.status == CONSENSUS_TASK_ABORTED
