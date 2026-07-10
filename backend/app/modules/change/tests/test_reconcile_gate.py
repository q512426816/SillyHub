"""task-10 测试：reconcile_pending_gate_decisions（重启兜底）。

P3 driver-gate-pilot design §5.5（reconcile 重启恢复）/§10 R1（重启丢 in-flight
gate 任务）/ R10（double-fire cas 兜底）/ M3（挂 lifespan startup 非 per-dispatch）。

覆盖（对齐 TaskCard acceptance 4 条）：
1. 无孤儿 → no-op（orphan_count=0）。
2. 扫孤儿（completed + change_id + gate_status pending/running）全重置 pending + reenqueue。
3. 非孤儿（decided/failed/无 change_id/非 completed）不动。
4. double-fire 由 R3 cas 兜底（reconcile reenqueue + 原任务并发，cas 只一个跑——
   此处验证 reenqueue 调用次数 == 孤儿数，cas 行为由 task-07 测试覆盖）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.change.dispatch import SillySpecStageDispatchService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"rec-{uid}@example.com",
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


async def _seed_run(
    db_session: AsyncSession,
    *,
    status: str,
    gate_status: str | None,
    with_change: bool = True,
) -> uuid.UUID:
    """建 user/runtime/workspace/change(可选)/agent_session/agent_run，返回 run_id。"""
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="ws-rec",
            slug=f"ws-rec-{uuid.uuid4().hex[:6]}",
            root_path=f"/host-projects/rec-{uuid.uuid4().hex[:8]}",
            path_source="daemon-client",
            daemon_runtime_id=rt.id,
            status="active",
        )
    )
    change_id: uuid.UUID | None = None
    if with_change:
        change_id = uuid.uuid4()
        db_session.add(
            Change(
                id=change_id,
                workspace_id=ws_id,
                change_key=f"rec-{uuid.uuid4().hex[:6]}",
                title="reconcile test",
                status="in-progress",
                location="active",
                path=".sillyspec/changes/rec",
                current_stage="verify",
                stages={},
                owner_id=uid,
            )
        )
    sess_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sess_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            runtime_id=rt.id,
            last_active_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
    )
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_session_id=sess_id,
            user_id=uid,
            agent_type="claude",
            provider="claude",
            status=status,
            change_id=change_id,
            gate_status=gate_status,
            started_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return run_id


async def test_no_orphans_is_noop(db_session: AsyncSession) -> None:
    """无孤儿时返回全 0，不 reenqueue。"""
    # 建几个非孤儿（不应被扫到）
    await _seed_run(db_session, status="completed", gate_status="decided")
    await _seed_run(db_session, status="completed", gate_status=None)

    with (
        patch.object(RunSyncService, "_fire_background_task") as fire_mock,
        patch.object(RunSyncService, "_run_gate_decision_task") as gate_mock,
    ):
        svc = SillySpecStageDispatchService(db_session)
        result = await svc.reconcile_pending_gate_decisions(db_session)

    assert result == {"orphan_count": 0, "reset_to_pending": 0, "reenqueue": 0}
    fire_mock.assert_not_called()
    gate_mock.assert_not_called()


async def test_resets_pending_and_running_orphans_and_reenqueues(
    db_session: AsyncSession,
) -> None:
    """孤儿（pending + running）全重置 pending + reenqueue。"""
    r_pending = await _seed_run(db_session, status="completed", gate_status="pending")
    r_running = await _seed_run(db_session, status="completed", gate_status="running")
    # 非孤儿（不应被重置 / reenqueue）
    r_decided = await _seed_run(db_session, status="completed", gate_status="decided")
    r_failed = await _seed_run(db_session, status="completed", gate_status="failed")
    r_no_change = await _seed_run(
        db_session, status="completed", gate_status="pending", with_change=False
    )
    # status='running'（非 completed）+ pending 也不被扫（reconcile 仅 completed）。
    await _seed_run(db_session, status="running", gate_status="pending")

    with (
        patch.object(RunSyncService, "_fire_background_task") as fire_mock,
        patch.object(RunSyncService, "_run_gate_decision_task", new=MagicMock()) as gate_mock,
    ):
        svc = SillySpecStageDispatchService(db_session)
        result = await svc.reconcile_pending_gate_decisions(db_session)

    # 仅 pending + running 孤子（2 个），其余非孤儿不计。
    assert result["orphan_count"] == 2
    assert result["reset_to_pending"] == 2
    assert result["reenqueue"] == 2
    assert fire_mock.call_count == 2
    assert gate_mock.call_count == 2

    # 验证 pending/running 孤子都重置 pending；非孤儿不变。
    db_session.expire_all()
    for rid in (r_pending, r_running):
        row = await db_session.get(AgentRun, rid)
        assert row is not None
        assert row.gate_status == "pending"
    for rid in (r_decided, r_failed):
        row = await db_session.get(AgentRun, rid)
        assert row is not None
        # decided/failed 不被重置
        assert row.gate_status in ("decided", "failed")
    no_change_row = await db_session.get(AgentRun, r_no_change)
    assert no_change_row is not None
    assert no_change_row.gate_status == "pending"  # 状态是 pending 但无 change 不算孤儿？


async def test_no_change_id_run_not_counted_as_orphan(db_session: AsyncSession) -> None:
    """无 change_id 的 run（对话 turn）即使 gate_status pending 也不是 gate 孤儿。"""
    await _seed_run(db_session, status="completed", gate_status="pending", with_change=False)

    with (
        patch.object(RunSyncService, "_fire_background_task") as fire_mock,
        patch.object(RunSyncService, "_run_gate_decision_task") as gate_mock,
    ):
        svc = SillySpecStageDispatchService(db_session)
        result = await svc.reconcile_pending_gate_decisions(db_session)

    assert result["orphan_count"] == 0
    fire_mock.assert_not_called()
    gate_mock.assert_not_called()


async def test_reenqueue_passes_correct_ids(db_session: AsyncSession) -> None:
    """reenqueue 传 agent_run_id/workspace_id/change_id 三者正确。"""
    r = await _seed_run(db_session, status="completed", gate_status="running")

    with (
        patch.object(RunSyncService, "_fire_background_task") as fire_mock,
        patch.object(RunSyncService, "_run_gate_decision_task", new=MagicMock()) as gate_mock,
    ):
        svc = SillySpecStageDispatchService(db_session)
        await svc.reconcile_pending_gate_decisions(db_session)

    gate_mock.assert_called_once()
    gate_kwargs = gate_mock.call_args.kwargs
    assert gate_kwargs["agent_run_id"] == r
    assert "workspace_id" in gate_kwargs
    assert "change_id" in gate_kwargs
    fire_mock.assert_called_once()
    fire_kwargs = fire_mock.call_args.kwargs
    assert fire_kwargs["run_id"] == r
