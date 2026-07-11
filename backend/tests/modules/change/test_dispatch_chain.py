"""Task-21: Integration test for dispatch+sync single stage chain.

Flow: Create AgentRun → complete → sync_stage_status → auto_dispatch_next_step.

Uses real DB objects (via conftest fixtures) and a real sillyspec.db file.
Only AgentService.start_stage_dispatch is mocked to avoid actual agent execution.
"""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    SillySpecStageDispatchService,
    auto_dispatch_next_step,
)
from app.modules.change.model import Change

# ---------------------------------------------------------------------------
# Helpers (same pattern as test_dispatch.py)
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"chain-ws-{uuid.uuid4().hex[:6]}",
        slug=f"chain-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws.id


@contextmanager
def _patch_stage_dispatch_creates_run(
    session: AsyncSession,
    change_id: uuid.UUID,
    workspace_id: uuid.UUID,
):
    """Wave0: mimic real start_stage_dispatch — create a REAL AgentRun +
    AgentRunWorkspace in DB and return the run (skips daemon dispatch).
    Post-Wave0 the Run is owned by start_stage_dispatch, not dispatch_next_step."""
    from app.modules.workspace.model import AgentRunWorkspace

    async def _impl(self, **kwargs):
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            change_id=change_id,
            agent_type="claude_code",
            provider="claude",
            model="claude-sonnet-4",
            status="running",
        )
        session.add(run)
        session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
        await session.commit()
        await session.refresh(run)
        return run

    with patch(
        "app.modules.agent.service.AgentService.start_stage_dispatch", new=_impl
    ) as mock_method:
        yield mock_method


def _create_sillyspec_db(
    tmp_path: Path,
    *,
    change_key: str = "test-change",
    current_stage: str = "brainstorm",
    stages: list[dict] | None = None,
    steps: list[dict] | None = None,
) -> Path:
    """Create a minimal sillyspec.db for testing sync_stage_status."""
    from app.core.spec_paths import SpecPathResolver

    db_path = SpecPathResolver(str(tmp_path)).db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute(
        "CREATE TABLE IF NOT EXISTS changes "
        "(id INTEGER PRIMARY KEY, name TEXT UNIQUE, current_stage TEXT, status TEXT)"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS stages "
        "(id INTEGER PRIMARY KEY, change_id INTEGER, stage TEXT, status TEXT, "
        "started_at TEXT, completed_at TEXT)"
    )
    cur.execute(
        "CREATE TABLE IF NOT EXISTS steps "
        "(id INTEGER PRIMARY KEY, stage_id INTEGER, name TEXT, status TEXT, "
        "output TEXT, completed_at TEXT, ordering INTEGER)"
    )
    cur.execute(
        "INSERT INTO changes (name, current_stage, status) VALUES (?, ?, ?)",
        (change_key, current_stage, "in-progress"),
    )
    change_id = cur.lastrowid

    if stages is None:
        stages = [{"stage": current_stage, "status": "in-progress"}]
    for s in stages:
        cur.execute(
            "INSERT INTO stages (change_id, stage, status, started_at, completed_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (change_id, s["stage"], s["status"], "2026-01-01", None),
        )
        stage_id = cur.lastrowid
        if steps:
            for i, step in enumerate(steps):
                cur.execute(
                    "INSERT INTO steps (stage_id, name, status, output, completed_at, ordering) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (stage_id, step["name"], step["status"], "", None, i),
                )

    conn.commit()
    conn.close()
    return db_path


# ---------------------------------------------------------------------------
# Task-21: Single stage chain integration tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_complete_sync_auto_dispatch(
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """完整单阶段链路：dispatch → complete → sync → auto_dispatch。

    验证：
    1. dispatch 创建 AgentRun
    2. 标记完成后 sync_stage_status 读取 sillyspec.db 并返回正确结果
    3. auto_dispatch_next_step 调用 dispatch() 创建下一个 run
    """
    from app.modules.spec_workspace.model import SpecWorkspace

    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()
    change_key = "chain-test-21"

    # Setup SpecWorkspace so sync can find sillyspec.db
    spec_root = str(tmp_path)
    spec_ws = SpecWorkspace(
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="standalone",
    )
    db_session.add(spec_ws)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title="Chain test 21",
        status="draft",
        location="active",
        path=".sillyspec/changes/chain-test-21",
        current_stage="brainstorm",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # Create sillyspec.db with partial progress: brainstorm completed, write-proposal pending
    _create_sillyspec_db(
        tmp_path,
        change_key=change_key,
        current_stage="brainstorm",
        steps=[
            {"name": "brainstorm", "status": "completed"},
            {"name": "write-proposal", "status": "pending"},
        ],
    )

    # --- Step 1: Dispatch creates AgentRun #1 ---
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        d1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )

    assert d1["dispatched"] is True
    run1_id = uuid.UUID(d1["agent_run_id"])

    # Verify AgentRun #1 exists in DB (Wave0: owned by start_stage_dispatch)
    run1 = await db_session.get(AgentRun, run1_id)
    assert run1 is not None
    assert run1.change_id == change.id

    # --- Step 2: Complete AgentRun #1 ---
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # --- Step 3: Sync stage status from sillyspec.db ---
    service = SillySpecStageDispatchService(db_session)
    from app.core.spec_paths import SpecPathResolver
    from tests.modules.change.test_dispatch import _patch_sync_to_local_db

    db_path = SpecPathResolver(str(tmp_path)).db_path()
    with _patch_sync_to_local_db(service, db_path):
        sync_result = await service.sync_stage_status(
            session=db_session,
            change_id=change.id,
            run_id=run1_id,
        )

    # Verify sync result
    assert sync_result.synced is True
    assert sync_result.current_stage == "brainstorm"
    assert sync_result.stage_completed is False
    assert sync_result.has_pending_step is True
    assert "brainstorm" in sync_result.steps_completed
    assert "write-proposal" in sync_result.steps_pending
    assert sync_result.current_step == "write-proposal"

    # Verify change.current_stage was synced (String column persisted correctly)
    await db_session.refresh(change)
    assert change.current_stage == "brainstorm"

    # --- Step 4: auto_dispatch_next_step triggers next dispatch ---
    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        mock_dispatch.return_value = {
            "dispatched": True,
            "agent_run_id": str(uuid.uuid4()),
            "stage": "brainstorm",
        }

        auto_result = await auto_dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            sync_result=sync_result,
        )

    assert auto_result["dispatched"] is True
    assert auto_result["reason"] == "auto_dispatch"
    mock_dispatch.assert_called_once()


@pytest.mark.asyncio
async def test_dispatch_complete_sync_stage_done_no_auto_dispatch(
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """单阶段链路：当 stage 已完成时，auto_dispatch 不触发。"""
    from app.modules.spec_workspace.model import SpecWorkspace

    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()
    change_key = "chain-test-21-done"

    spec_root = str(tmp_path)
    spec_ws = SpecWorkspace(
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="standalone",
    )
    db_session.add(spec_ws)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title="Chain test 21 done",
        status="draft",
        location="active",
        path=".sillyspec/changes/chain-test-21-done",
        current_stage="brainstorm",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # All steps completed → stage_completed=True
    _create_sillyspec_db(
        tmp_path,
        change_key=change_key,
        current_stage="brainstorm",
        stages=[{"stage": "brainstorm", "status": "completed"}],
        steps=[
            {"name": "brainstorm", "status": "completed"},
            {"name": "write-proposal", "status": "completed"},
        ],
    )

    # Dispatch
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        d1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )

    run1_id = uuid.UUID(d1["agent_run_id"])

    # Complete run
    run1 = await db_session.get(AgentRun, run1_id)
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # Sync — stage fully completed
    from app.core.spec_paths import SpecPathResolver
    from tests.modules.change.test_dispatch import _patch_sync_to_local_db

    db_path = SpecPathResolver(str(tmp_path)).db_path()
    with _patch_sync_to_local_db(service, db_path):
        sync_result = await service.sync_stage_status(
            session=db_session,
            change_id=change.id,
            run_id=run1_id,
        )

    assert sync_result.synced is True
    assert sync_result.stage_completed is True
    assert sync_result.has_pending_step is False

    # Auto dispatch should NOT trigger
    with (
        patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch,
        patch("app.modules.change.service.ChangeService.reparse", new_callable=AsyncMock),
        # brainstorm 完成后 _resolve_stage_completion 真实返回 dispatch_target="plan"
        # (auto-advance)。本测试聚焦 auto_dispatch 在 dispatch_target=None 时不调度
        # 的分支，故 mock complete_stage 返回 None（对齐 e2e 同名场景）。
        patch(
            "app.modules.change.service.ChangeService.complete_stage",
            new_callable=AsyncMock,
            return_value=MagicMock(dispatch_target=None, stage="brainstorm"),
        ),
    ):
        auto_result = await auto_dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            sync_result=sync_result,
        )

    assert auto_result["dispatched"] is False
    assert auto_result["reason"] == "stage_completed"
    mock_dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_dispatch_complete_sync_no_db_stops_chain(
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """单阶段链路：sillyspec.db 不存在时 sync 失败，auto_dispatch 不触发。"""
    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()

    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="chain-no-db",
        title="Chain no db",
        status="draft",
        location="active",
        path=".sillyspec/changes/chain-no-db",
        current_stage="brainstorm",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # Dispatch (no SpecWorkspace → _resolve_db_path returns None)
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        d1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )

    run1_id = uuid.UUID(d1["agent_run_id"])

    # Complete run
    run1 = await db_session.get(AgentRun, run1_id)
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # Sync fails — no sillyspec.db
    from tests.modules.change.test_dispatch import _MissingDbDelegate, _patch_sync_with_delegate

    with _patch_sync_with_delegate(service, _MissingDbDelegate()):
        sync_result = await service.sync_stage_status(
            session=db_session,
            change_id=change.id,
            run_id=run1_id,
        )
    assert sync_result.synced is False
    assert "not found" in sync_result.error

    # Auto dispatch should NOT trigger on sync failure
    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        auto_result = await auto_dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            sync_result=sync_result,
        )

    assert auto_result["dispatched"] is False
    assert auto_result["reason"] == "sync_failed"
    mock_dispatch.assert_not_called()
