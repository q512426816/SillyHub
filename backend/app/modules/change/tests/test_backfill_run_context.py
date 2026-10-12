"""存量 run 变更上下文回填测试（2026-10-12-backfill-run-change-context）。

验证游标重放语义与线上运行时逐点对齐（FR-01..05）：

- 命令所在轮保持旧上下文、下一轮才继承（先打锚再推进游标，FR-01）；
- 幂等重跑零新增（FR-02）、已锚 run 跳过但命令推进游标（FR-02）；
- 未知 change_key 跳过计数、不建 placeholder（FR-03）；
- 游标终值仅在解析出命令时写会话列（FR-04）；
- 工作区编排只处理有链接会话（FR-05）。

DB 用例走根 conftest ``db_session`` SQLite create_all（镜像 test_spec_binding.py
模式）；日志行按 submit_steps 收集口径造（channel=tool_call / tool_kind=sillyspec /
content=JSON ``args.command``）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.change.backfill_service import ChangeContextBackfillService
from app.modules.change.model import Change, ChangeSessionLink
from app.modules.workspace.model import Workspace

_T0 = datetime(2026, 10, 12, 10, 0, 0, tzinfo=UTC)


async def _make_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"bfc-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="Bfc",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_ws(db_session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="backfill ws",
        slug=f"bfc-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/backfill-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_change(db_session: AsyncSession, workspace_id: uuid.UUID, key: str) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=key,
        title=key,
        status="active",
        location="active",
        path=f"changes/{key}",
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)
    return change


async def _make_session(
    db_session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> AgentSession:
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        provider="claude",
        status="ended",
        created_at=_T0,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _make_link(db_session: AsyncSession, change_id: uuid.UUID, session_id: uuid.UUID) -> None:
    db_session.add(ChangeSessionLink(id=uuid.uuid4(), change_id=change_id, session_id=session_id))
    await db_session.commit()


async def _make_run(
    db_session: AsyncSession,
    session_id: uuid.UUID,
    *,
    seq: int,
    change_id: uuid.UUID | None = None,
    commands: list[str] | None = None,
) -> AgentRun:
    """run 行 + 可选 sillyspec 命令日志（消息序按 timestamp 递增）。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=session_id,
        change_id=change_id,
        created_at=_T0 + timedelta(minutes=seq),
    )
    db_session.add(run)
    await db_session.flush()
    for i, command in enumerate(commands or []):
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=_T0 + timedelta(minutes=seq, seconds=i),
                channel="tool_call",
                tool_kind="sillyspec",
                content_redacted=json.dumps({"tool": "Bash", "args": {"command": command}}),
                dedup_key=f"{run.id}:{i}",
            )
        )
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def _run_anchors(db_session: AsyncSession, session_id: uuid.UUID) -> list[uuid.UUID | None]:
    runs = list(
        (
            await db_session.execute(
                select(AgentRun)
                .where(AgentRun.agent_session_id == session_id)
                .order_by(AgentRun.created_at, AgentRun.id)
            )
        )
        .scalars()
        .all()
    )
    return [r.change_id for r in runs]


# ── FR-01：游标重放拆分两变更 ────────────────────────────────────────────────


async def test_backfill_replays_cursor_in_run_order_splitting_two_changes(db_session):
    """r0 无命令保持 NULL；r1 含 start a 保持 NULL（命令所在轮不归新变更）；
    r2 含 start b 打锚 a（先打锚再推进）；r3 无命令打锚 b。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-bfc-a")
    change_b = await _make_change(db_session, ws.id, "2026-10-12-bfc-b")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_link(db_session, change_b.id, sess.id)

    await _make_run(db_session, sess.id, seq=0)
    await _make_run(
        db_session, sess.id, seq=1, commands=["sillyspec flow start --change 2026-10-12-bfc-a"]
    )
    await _make_run(
        db_session, sess.id, seq=2, commands=["sillyspec flow start --change 2026-10-12-bfc-b"]
    )
    await _make_run(db_session, sess.id, seq=3)

    stats = await ChangeContextBackfillService(db_session).backfill_session(sess.id)

    assert stats.runs_stamped == 2  # r2→a, r3→b
    assert stats.commands_parsed == 2
    assert await _run_anchors(db_session, sess.id) == [None, None, change_a.id, change_b.id]
    assert stats.cursor_written is True
    assert stats.cursor_change_id == change_b.id
    await db_session.refresh(sess)
    assert sess.current_change_id == change_b.id


# ── FR-02：幂等 + 已锚跳过 ──────────────────────────────────────────────────


async def test_backfill_is_idempotent_second_run_stamps_zero(db_session):
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-idem-a")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_run(
        db_session, sess.id, seq=0, commands=["sillyspec flow start --change 2026-10-12-idem-a"]
    )
    await _make_run(db_session, sess.id, seq=1)

    svc = ChangeContextBackfillService(db_session)
    first = await svc.backfill_session(sess.id)
    assert first.runs_stamped == 1

    second = await svc.backfill_session(sess.id)
    assert second.runs_stamped == 0
    assert await _run_anchors(db_session, sess.id) == [None, change_a.id]


async def test_anchored_run_skipped_but_advances_cursor(db_session):
    """已锚 run（派发形态）不打锚但命令推进游标：其后无锚轮归命令目标。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-anch-a")
    change_b = await _make_change(db_session, ws.id, "2026-10-12-anch-b")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_link(db_session, change_b.id, sess.id)

    await _make_run(db_session, sess.id, seq=0)
    # 派发 run：已锚 b（其消息里也有绑定命令）。
    await _make_run(
        db_session,
        sess.id,
        seq=1,
        change_id=change_b.id,
        commands=["sillyspec flow done --change 2026-10-12-anch-b"],
    )
    tail = await _make_run(db_session, sess.id, seq=2)

    stats = await ChangeContextBackfillService(db_session).backfill_session(sess.id)

    assert stats.runs_already_anchored == 1
    assert stats.runs_stamped == 1  # 只有 tail（→ b）
    anchors = await _run_anchors(db_session, sess.id)
    assert anchors == [None, change_b.id, change_b.id]
    assert anchors[2] == tail.change_id


# ── FR-03：未知 key 跳过 ────────────────────────────────────────────────────


async def test_unknown_change_key_skipped_without_placeholder(db_session):
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-unk-a")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_run(
        db_session, sess.id, seq=0, commands=["sillyspec flow start --change 2026-10-12-unk-a"]
    )
    await _make_run(
        db_session, sess.id, seq=1, commands=["sillyspec flow start --change ghost-key"]
    )
    tail = await _make_run(db_session, sess.id, seq=2)

    changes_before = list(
        (await db_session.execute(select(Change).where(Change.workspace_id == ws.id)))
        .scalars()
        .all()
    )

    stats = await ChangeContextBackfillService(db_session).backfill_session(sess.id)

    assert stats.commands_skipped_unknown_key == 1
    assert stats.unknown_keys == ["ghost-key"]
    # ghost 轮不推进游标：tail 仍归 a（游标保持 a）。
    assert tail.change_id == change_a.id
    changes_after = list(
        (await db_session.execute(select(Change).where(Change.workspace_id == ws.id)))
        .scalars()
        .all()
    )
    assert changes_after == changes_before  # 未建 placeholder


# ── FR-04：无命令不写游标 ───────────────────────────────────────────────────


async def test_session_cursor_written_only_when_commands_found(db_session):
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-cur-a")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_run(db_session, sess.id, seq=0)

    stats = await ChangeContextBackfillService(db_session).backfill_session(sess.id)

    assert stats.commands_parsed == 0
    assert stats.cursor_written is False
    await db_session.refresh(sess)
    assert sess.current_change_id is None


# ── P1-2 修复面：同 submit 批次并列绑定组显式计数 ───────────────────────────


async def test_same_batch_parallel_binding_commands_counted_ambiguous(db_session):
    """同 run 同 timestamp（同一 submit 批次）两条不同绑定命令：批内消息序 DB
    不可复原——必须计入 ambiguous_parallel_groups（dry-run 报告可见），且重放
    确定性成立（id 序固定，重跑同锚幂等）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-amb-a")
    change_b = await _make_change(db_session, ws.id, "2026-10-12-amb-b")
    sess = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, sess.id)
    await _make_link(db_session, change_b.id, sess.id)

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=sess.id,
        created_at=_T0,
    )
    db_session.add(run)
    await db_session.flush()
    same_ts = _T0 + timedelta(minutes=1)
    for i, command in enumerate(
        [
            "sillyspec flow done --change 2026-10-12-amb-a",
            "sillyspec flow start --change 2026-10-12-amb-b",
        ]
    ):
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=same_ts,  # 同一 submit 批次：timestamp 全同
                channel="tool_call",
                tool_kind="sillyspec",
                content_redacted=json.dumps({"tool": "Bash", "args": {"command": command}}),
                dedup_key=f"{run.id}:{i}",
            )
        )
    await db_session.commit()

    svc = ChangeContextBackfillService(db_session)
    first = await svc.backfill_session(sess.id)
    assert first.ambiguous_parallel_groups == 1
    assert first.commands_parsed == 2

    second = await svc.backfill_session(sess.id)
    assert second.runs_stamped == 0  # 幂等：重跑同序同锚零新增
    assert second.ambiguous_parallel_groups == 1


# ── FR-05：工作区编排范围 ───────────────────────────────────────────────────


async def test_workspace_scope_filters_linked_sessions(db_session):
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    change_a = await _make_change(db_session, ws.id, "2026-10-12-ws-a")
    linked = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    unlinked = await _make_session(db_session, user_id=user.id, workspace_id=ws.id)
    await _make_link(db_session, change_a.id, linked.id)
    await _make_run(
        db_session,
        linked.id,
        seq=0,
        commands=["sillyspec flow start --change 2026-10-12-ws-a"],
    )
    await _make_run(db_session, linked.id, seq=1)
    await _make_run(
        db_session,
        unlinked.id,
        seq=0,
        commands=["sillyspec flow start --change 2026-10-12-ws-a"],
    )
    await _make_run(db_session, unlinked.id, seq=1)

    stats = await ChangeContextBackfillService(db_session).backfill_workspace(ws.id)

    # 只有链接会话进处理面。
    assert stats.runs_scanned == 2
    assert stats.runs_stamped == 1
    assert await _run_anchors(db_session, linked.id) == [None, change_a.id]
    assert await _run_anchors(db_session, unlinked.id) == [None, None]
