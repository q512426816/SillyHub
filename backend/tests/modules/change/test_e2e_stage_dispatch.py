"""Task-22: End-to-end integration test for draft→brainstorm→propose full chain.

Simulates the complete lifecycle across stages:
  transition(draft→brainstorm) → dispatch → complete → sync
  → transition(brainstorm→propose) → dispatch → complete → sync

Uses real DB objects + real sillyspec.db. Mocks only AgentService to prevent
actual agent execution.
"""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col as sa_col

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    SillySpecStageDispatchService,
    auto_dispatch_next_step,
)
from app.modules.change.model import Change

# ---------------------------------------------------------------------------
# Helpers (same pattern as test_dispatch_chain.py)
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"e2e-ws-{uuid.uuid4().hex[:6]}",
        slug=f"e2e-ws-{uuid.uuid4().hex[:6]}",
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
    current_stage: str = "propose",
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


def _update_sillyspec_db(
    db_path: Path,
    *,
    change_key: str,
    current_stage: str,
    stages: list[dict] | None = None,
    steps: list[dict] | None = None,
) -> None:
    """Update the sillyspec.db with new stage/step data for the next phase.

    Deletes any existing records for the target stage to avoid duplicates.
    """
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Update current_stage
    cur.execute(
        "UPDATE changes SET current_stage = ? WHERE name = ?",
        (current_stage, change_key),
    )

    # Get change id
    row = cur.execute("SELECT id FROM changes WHERE name = ?", (change_key,)).fetchone()
    change_id = row[0]

    # Delete any existing stage+steps records for this stage to avoid duplicates
    cur.execute(
        "DELETE FROM steps WHERE stage_id IN "
        "(SELECT id FROM stages WHERE change_id = ? AND stage = ?)",
        (change_id, current_stage),
    )
    cur.execute(
        "DELETE FROM stages WHERE change_id = ? AND stage = ?",
        (change_id, current_stage),
    )

    # Insert new stage record
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


# ---------------------------------------------------------------------------
# Task-22: Full chain end-to-end tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_e2e_draft_brainstorm_propose_chain(
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """完整链路：draft → brainstorm → propose，每阶段 dispatch + sync。

    验证：
    1. transition(draft→brainstorm) 成功，dispatch 创建 AgentRun
    2. 完成 run，sync 正确反映 brainstorm 进度
    3. transition(brainstorm→propose) 成功，dispatch 创建第二个 AgentRun
    4. 完成第二个 run，sync 正确反映 propose 进度
    """
    from app.modules.change.service import ChangeService
    from app.modules.spec_workspace.model import SpecWorkspace

    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()
    change_key = "e2e-chain-test"

    # Setup SpecWorkspace for sync path resolution
    spec_root = str(tmp_path)
    spec_ws = SpecWorkspace(
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="standalone",
    )
    db_session.add(spec_ws)

    # Create change in draft stage
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title="E2E chain test",
        status="draft",
        location="active",
        path=".sillyspec/changes/e2e-chain-test",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # ================================================================
    # Phase 1: draft → brainstorm
    # ================================================================

    # Transition: draft → brainstorm (admin role has full access)
    change_svc = ChangeService(db_session)
    change = await change_svc.transition(
        workspace_id=workspace_id,
        change_id=change.id,
        target_stage="brainstorm",
        user_role="admin",
        reason="Start brainstorm phase",
    )
    assert change.current_stage == "brainstorm"

    # Dispatch agent for brainstorm stage
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        dispatch_svc = SillySpecStageDispatchService(db_session)
        d1 = await dispatch_svc.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )

    assert d1["dispatched"] is True
    run1_id = uuid.UUID(d1["agent_run_id"])

    # Complete AgentRun #1
    run1 = await db_session.get(AgentRun, run1_id)
    assert run1 is not None
    assert run1.change_id == change.id
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # Create sillyspec.db with brainstorm stage completed
    db_path = _create_sillyspec_db(
        tmp_path,
        change_key=change_key,
        current_stage="brainstorm",
        steps=[
            {"name": "analyze-requirements", "status": "completed"},
            {"name": "generate-documents", "status": "completed"},
        ],
        stages=[{"stage": "brainstorm", "status": "completed"}],
    )

    # Sync brainstorm stage status
    sync_result1 = await dispatch_svc.sync_stage_status(
        session=db_session,
        change_id=change.id,
        run_id=run1_id,
    )
    assert sync_result1.synced is True
    assert sync_result1.current_stage == "brainstorm"
    assert sync_result1.stage_completed is True

    # Verify change.current_stage is still "brainstorm" (sync doesn't change completed stages)
    await db_session.refresh(change)
    assert change.current_stage == "brainstorm"

    # Auto dispatch should NOT trigger (human_gate is active after brainstorm)
    with (
        patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as _mock_dispatch,
        patch("app.modules.change.service.ChangeService.reparse", new_callable=AsyncMock),
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
            sync_result=sync_result1,
        )
    assert auto_result["dispatched"] is False
    assert auto_result["reason"] in ("stage_completed", "human_gate_active")

    # ================================================================
    # Phase 2: brainstorm → propose
    # ================================================================

    # Transition: brainstorm → propose
    change = await change_svc.transition(
        workspace_id=workspace_id,
        change_id=change.id,
        target_stage="propose",
        user_role="admin",
        reason="Move to propose phase",
    )
    assert change.current_stage == "propose"

    # Update sillyspec.db: now in "propose" stage with some progress
    _update_sillyspec_db(
        db_path,
        change_key=change_key,
        current_stage="propose",
        steps=[
            {"name": "write-proposal", "status": "pending"},
            {"name": "write-requirements", "status": "pending"},
        ],
    )

    # Dispatch agent for propose stage
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        d2 = await dispatch_svc.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )

    assert d2["dispatched"] is True
    run2_id = uuid.UUID(d2["agent_run_id"])

    # Complete AgentRun #2
    run2 = await db_session.get(AgentRun, run2_id)
    assert run2 is not None
    assert run2.change_id == change.id
    run2.status = "completed"
    db_session.add(run2)
    await db_session.commit()

    # Update sillyspec.db: propose stage with partial progress
    _update_sillyspec_db(
        db_path,
        change_key=change_key,
        current_stage="propose",
        steps=[
            {"name": "write-proposal", "status": "completed"},
            {"name": "write-requirements", "status": "pending"},
        ],
    )

    # Sync propose stage status
    sync_result2 = await dispatch_svc.sync_stage_status(
        session=db_session,
        change_id=change.id,
        run_id=run2_id,
    )
    assert sync_result2.synced is True
    assert sync_result2.current_stage == "propose"
    assert sync_result2.stage_completed is False
    assert sync_result2.has_pending_step is True
    assert "write-proposal" in sync_result2.steps_completed
    assert "write-requirements" in sync_result2.steps_pending

    # ================================================================
    # Final assertions: verify full chain state
    # ================================================================

    # Verify 2 AgentRuns created for this change
    stmt = sa_select(AgentRun).where(
        sa_col(AgentRun.change_id) == change.id,
    )
    all_runs = (await db_session.execute(stmt)).scalars().all()
    assert len(all_runs) == 2
    assert all(r.status == "completed" for r in all_runs)
    assert {str(r.id) for r in all_runs} == {str(run1_id), str(run2_id)}

    # Verify change.current_stage is "propose" (String column — persisted correctly)
    await db_session.refresh(change)
    assert change.current_stage == "propose"


@pytest.mark.asyncio
async def test_e2e_dispatch_prevents_concurrent_runs_across_stages(
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """跨阶段并发保护：brainstorm 阶段的 run 仍在运行时，propose dispatch 被拒绝。"""
    from app.modules.change.service import ChangeService

    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()

    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="e2e-concurrent",
        title="E2E concurrent test",
        status="draft",
        location="active",
        path=".sillyspec/changes/e2e-concurrent",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # Transition to brainstorm
    change_svc = ChangeService(db_session)
    change = await change_svc.transition(
        workspace_id=workspace_id,
        change_id=change.id,
        target_stage="brainstorm",
        user_role="admin",
    )

    # Dispatch for brainstorm — run stays "pending"
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        dispatch_svc = SillySpecStageDispatchService(db_session)
        d1 = await dispatch_svc.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )
    assert d1["dispatched"] is True

    # Transition to propose (admin can do this even while brainstorm run is active)
    change = await change_svc.transition(
        workspace_id=workspace_id,
        change_id=change.id,
        target_stage="propose",
        user_role="admin",
    )
    assert change.current_stage == "propose"

    # Dispatch for propose should be blocked — active run exists
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        d2 = await dispatch_svc.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
    assert d2["dispatched"] is False
    assert d2["reason"] == "active_run_exists"

    # Now complete the brainstorm run
    run1 = await db_session.get(AgentRun, uuid.UUID(d1["agent_run_id"]))
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # Dispatch for propose should succeed now
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        d3 = await dispatch_svc.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
    assert d3["dispatched"] is True
