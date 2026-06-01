"""Tests for stage-driven agent dispatch.

Covers: StageAgentConfig lookup, has_active_run, dispatch(), and
load_prompt_template for the clarifying stage.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
    StageAgentConfig,
    SillySpecStageDispatchService,
    dispatch,
    get_config_for_stage,
    has_active_run,
    load_prompt_template,
)
from app.modules.change.model import Change


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID | None = None,
    current_stage: str = "clarifying",
) -> Change:
    """Create a minimal Change row for testing."""
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id or uuid.uuid4(),
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test change for dispatch",
        status="draft",
        location="active",
        path="/tmp/test",
        current_stage=current_stage,
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _create_agent_run(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    status: str = "pending",
) -> AgentRun:
    """Create a minimal AgentRun row linked to a change."""
    run = AgentRun(
        id=uuid.uuid4(),
        change_id=change_id,
        agent_type="claude_code",
        status=status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    """Create a minimal Workspace row and return its id."""
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:6]}",
        slug=f"test-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws.id


# ===================================================================
# 1. StageAgentConfig lookup
# ===================================================================


def test_get_config_for_propose() -> None:
    """Propose stage has a valid config."""
    config = get_config_for_stage("propose")
    assert config is not None
    assert config.enabled is True
    assert config.prompt_template == "propose.md"
    assert config.requires_worktree is True
    assert config.read_only is False


def test_get_config_for_draft_returns_none() -> None:
    """Draft stage has no agent config."""
    assert get_config_for_stage("draft") is None


def test_get_config_for_archived_returns_none() -> None:
    """Archived stage has no agent config."""
    assert get_config_for_stage("archived") is None


def test_all_configured_stages_have_templates() -> None:
    """Every stage in STAGE_AGENT_CONFIG has a non-empty template name."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.prompt_template, f"Stage \'{stage}\' missing prompt_template"
        assert config.phase, f"Stage \'{stage}\' missing phase"


# ===================================================================
# 2. has_active_run
# ===================================================================


async def test_has_active_run_false_when_no_runs(db_session: AsyncSession) -> None:
    """No AgentRun rows -> has_active_run is False."""
    change_id = uuid.uuid4()
    assert await has_active_run(db_session, change_id) is False


async def test_has_active_run_true_with_pending(db_session: AsyncSession) -> None:
    """A pending AgentRun -> has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="pending")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_true_with_running(db_session: AsyncSession) -> None:
    """A running AgentRun -> has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="running")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_false_with_completed(db_session: AsyncSession) -> None:
    """A completed AgentRun -> has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="completed")
    assert await has_active_run(db_session, change.id) is False


async def test_has_active_run_false_with_failed(db_session: AsyncSession) -> None:
    """A failed AgentRun -> has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="failed")
    assert await has_active_run(db_session, change.id) is False


# ===================================================================
# 3. dispatch() — propose stage
# ===================================================================


async def test_dispatch_no_config_for_stage(db_session: AsyncSession) -> None:
    """Draft stage has no config -> dispatch returns early."""
    result = await dispatch(
        session=db_session,
        workspace_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
        target_stage="draft",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert "no_config" in result["reason"]


async def test_dispatch_active_run_blocks(db_session: AsyncSession) -> None:
    """An existing running agent blocks new dispatch."""
    change = await _create_change(db_session, current_stage="draft")
    await _create_agent_run(db_session, change_id=change.id, status="running")

    result = await dispatch(
        session=db_session,
        workspace_id=change.workspace_id,
        change_id=change.id,
        target_stage="propose",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert result["reason"] == "active_run_exists"


async def test_dispatch_change_not_found(db_session: AsyncSession) -> None:
    """Non-existent change_id -> dispatch returns gracefully."""
    result = await dispatch(
        session=db_session,
        workspace_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
        target_stage="propose",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert result["reason"] == "change_not_found"


async def test_dispatch_updates_last_dispatch_in_stages(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    change = await _create_change(db_session, current_stage="draft")

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        result = await dispatch(
            session=db_session,
            workspace_id=change.workspace_id,
            change_id=change.id,
            target_stage="propose",
            user_id=uuid.uuid4(),
        )

    assert result["dispatched"] is True
    assert result["stage"] == "propose"

    # Verify stages JSON was updated
    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "propose"
    assert "at" in last_dispatch
    assert "config" in last_dispatch
    assert last_dispatch["config"]["prompt_template"] == "propose.md"


# ===================================================================
# 4. load_prompt_template
# ===================================================================


def test_load_clarifying_template() -> None:
    """Clarifying template loads and contains expected sections."""
    content = load_prompt_template("clarifying.md")
    assert content
    assert "Clarification Agent" in content
    assert "READ-ONLY" in content


def test_load_template_with_context() -> None:
    """Template placeholders are replaced with context values."""
    content = load_prompt_template(
        "clarifying.md",
        context={
            "change_title": "My Test Change",
            "change_key": "test-001",
            "current_stage": "draft",
        },
    )
    assert "My Test Change" in content
    assert "test-001" in content


def test_load_missing_template_returns_empty() -> None:
    """Missing template file returns empty string."""
    content = load_prompt_template("nonexistent_template.md")
    assert content == ""


# ===================================================================
# 5. SillySpecStageDispatchService — dispatch_next_step
# ===================================================================


from app.core.errors import ChangeNotFound


async def test_dispatch_next_step_creates_agent_run(db_session: AsyncSession) -> None:
    """dispatch_next_step creates an AgentRun and returns dispatched=True."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True
    assert result["stage"] == "propose"
    assert result["agent_run_id"] is not None
    # Validate UUID format
    uuid.UUID(result["agent_run_id"])


async def test_dispatch_next_step_passes_prompt_template(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch receives correct stage and prompt_template."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

        # Verify start_stage_dispatch was called with correct params
        call_kwargs = mock_svc.start_stage_dispatch.call_args[1]
        assert call_kwargs["stage"] == "propose"
        assert call_kwargs["prompt_template"] == "propose.md"


async def test_dispatch_next_step_unconfigured_stage(db_session: AsyncSession) -> None:
    """Unknown stage returns dispatched=False, reason=stage_not_configured."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    result = await service.dispatch_next_step(
        session=db_session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=uuid.uuid4(),
        target_stage="unknown",
    )

    assert result["dispatched"] is False
    assert result["reason"] == "stage_not_configured"
    assert result["stage"] == "unknown"


async def test_dispatch_next_step_active_run_exists(db_session: AsyncSession) -> None:
    """Existing pending AgentRun blocks new dispatch."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    await _create_agent_run(db_session, change_id=change.id, status="pending")

    service = SillySpecStageDispatchService(db_session)
    result = await service.dispatch_next_step(
        session=db_session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=uuid.uuid4(),
        target_stage="propose",
    )

    assert result["dispatched"] is False
    assert result["reason"] == "active_run_exists"
    assert result["stage"] == "propose"


async def test_dispatch_next_step_change_not_found(db_session: AsyncSession) -> None:
    """Non-existent change_id raises ChangeNotFound."""
    workspace_id = await _create_workspace(db_session)

    service = SillySpecStageDispatchService(db_session)
    with pytest.raises(ChangeNotFound):
        await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            target_stage="propose",
        )


async def test_dispatch_next_step_bundle_build_error(db_session: AsyncSession) -> None:
    """_build_stage_bundle failure returns dispatched=False, reason=bundle_build_error."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    with patch.object(
        service,
        "_build_stage_bundle",
        new_callable=AsyncMock,
        side_effect=RuntimeError("DB error"),
    ):
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "bundle_build_error"
    assert result["stage"] == "propose"


async def test_dispatch_next_step_agent_start_error(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch failure returns dispatched=False, reason=agent_start_error."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(
            side_effect=RuntimeError("Agent crashed")
        )

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "agent_start_error"
    assert result["stage"] == "propose"

    # Verify the AgentRun was marked as failed
    from sqlalchemy import select as sa_select
    from sqlmodel import col as sa_col

    stmt = sa_select(AgentRun).where(
        sa_col(AgentRun.change_id) == change.id,
        sa_col(AgentRun.status) == "failed",
    )
    failed_run = (await db_session.execute(stmt)).scalars().first()
    assert failed_run is not None
    assert "Agent start failed" in (failed_run.output_redacted or "")


async def test_dispatch_next_step_records_last_dispatch(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True

    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "propose"
    assert last_dispatch["run_id"] is not None
    assert last_dispatch["config"]["phase"] == "Propose"
    assert last_dispatch["config"]["requires_worktree"] is True


async def test_dispatch_next_step_creates_workspace_association(db_session: AsyncSession) -> None:
    """Dispatch creates AgentRunWorkspace record linking run to workspace."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True
    run_id = uuid.UUID(result["agent_run_id"])

    # Verify AgentRunWorkspace association exists
    from sqlalchemy import select as sa_select
    from sqlmodel import col as sa_col
    from app.modules.workspace.model import AgentRunWorkspace

    stmt = sa_select(AgentRunWorkspace).where(
        sa_col(AgentRunWorkspace.agent_run_id) == run_id,
        sa_col(AgentRunWorkspace.workspace_id) == workspace_id,
    )
    assoc = (await db_session.execute(stmt)).scalars().first()
    assert assoc is not None


# ===================================================================
# 6. Idempotency — dispatch twice in a row
# ===================================================================


async def test_dispatch_next_step_idempotency(db_session: AsyncSession) -> None:
    """Dispatching the same change twice: first succeeds, second blocked by active_run."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    user_id = uuid.uuid4()

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)

        # First dispatch succeeds
        result1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
        assert result1["dispatched"] is True

        # Second dispatch blocked by active run
        result2 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
        assert result2["dispatched"] is False
        assert result2["reason"] == "active_run_exists"



# ===================================================================
# 7. StageSyncResult + sync_stage_status (task-09)
# ===================================================================


import sqlite3
from pathlib import Path as SyncPath
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.spec_paths import SpecPathResolver
from app.modules.change.dispatch import StageSyncResult, SillySpecStageDispatchService


def _create_sillyspec_db(
    tmp_path: SyncPath,
    change_key: str = "test-change",
    current_stage: str = "propose",
    stages: list[dict] | None = None,
    steps: list[dict] | None = None,
) -> SyncPath:
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


async def test_sync_stage_status_normal_sync(db_session: AsyncSession) -> None:
    """正常同步 — sillyspec.db 中有 change_key、stage in-progress、部分 steps completed。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-sync",
        title="Test sync",
        status="draft",
        location="active",
        path=".sillyspec/changes/test-sync",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="test-sync",
            current_stage="propose",
            steps=[
                {"name": "step1", "status": "completed"},
                {"name": "step2", "status": "pending"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    assert result.current_stage == "propose"
    assert result.current_step == "step2"
    assert result.stage_completed is False
    assert result.has_pending_step is True
    assert "step1" in result.steps_completed
    assert "step2" in result.steps_pending

    # Verify Change.current_stage was updated
    await db_session.refresh(change)
    assert change.current_stage == "propose"
    assert "propose" in change.stages
    assert change.stages["propose"]["steps"]["completed"] == ["step1"]


async def test_sync_stage_status_all_steps_completed(db_session: AsyncSession) -> None:
    """stage completed — 所有 steps 状态为 completed。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-completed",
        title="Test completed",
        status="draft",
        location="active",
        path=".sillyspec/changes/test-completed",
        current_stage="propose",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="test-completed",
            current_stage="propose",
            stages=[{"stage": "propose", "status": "completed"}],
            steps=[
                {"name": "step1", "status": "completed"},
                {"name": "step2", "status": "completed"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    assert result.stage_completed is True
    assert result.has_pending_step is False
    assert result.steps_pending == []
    assert len(result.steps_completed) == 2


async def test_sync_stage_status_db_not_found(db_session: AsyncSession) -> None:
    """sillyspec.db 不存在 — synced=False，无异常。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    run_id = uuid.uuid4()
    with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
        mock_resolve.return_value = SyncPath("/nonexistent/sillyspec.db")
        result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "not found" in result.error


async def test_sync_stage_status_db_connect_failed(db_session: AsyncSession) -> None:
    """sillyspec.db 连接失败 — synced=False。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    run_id = uuid.uuid4()

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create a dummy file so is_file() returns True
        dummy_db = SyncPath(tmp_dir) / "sillyspec.db"
        dummy_db.write_text("not a real db")
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = dummy_db
            with patch("app.modules.change.dispatch.sqlite3.connect", side_effect=sqlite3.Error("corrupt")):
                result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "db_connect_failed" in result.error


async def test_sync_stage_status_db_read_failed(db_session: AsyncSession) -> None:
    """sillyspec.db 读取失败 — synced=False。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create a valid db so connect succeeds but make execute fail
        db_path = SyncPath(tmp_dir) / ".sillyspec" / ".runtime" / "sillyspec.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE changes (id INTEGER PRIMARY KEY, name TEXT)")
        conn.commit()
        conn.close()

        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = db_path
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "db_read_failed" in result.error


async def test_sync_stage_status_change_key_not_in_db(db_session: AsyncSession) -> None:
    """changes 表中无 change_key — synced=False。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(SyncPath(tmp_dir), change_key="other-change")

        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "change_key not found" in result.error


async def test_sync_stage_status_change_not_found(db_session: AsyncSession) -> None:
    """Change 不存在 — 抛出 ChangeNotFound。"""
    from app.core.errors import ChangeNotFound

    service = SillySpecStageDispatchService(db_session)
    run_id = uuid.uuid4()
    with pytest.raises(ChangeNotFound):
        await service.sync_stage_status(db_session, uuid.uuid4(), run_id)


async def test_sync_stage_status_no_stage_record(db_session: AsyncSession) -> None:
    """stages 表无当前 stage 记录 — synced=True, stage_completed=False。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-no-stage",
        title="Test no stage",
        status="draft",
        location="active",
        path=".sillyspec/changes/test-no-stage",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="test-no-stage",
            current_stage="plan",
            stages=[],  # No stage records
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    assert result.stage_completed is False
    assert result.current_stage == "plan"

    # Verify Change.current_stage was updated
    await db_session.refresh(change)
    assert change.current_stage == "plan"


async def test_sync_stage_status_empty_steps(db_session: AsyncSession) -> None:
    """steps 表为空 — synced=True, has_pending_step=False。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-empty-steps",
        title="Test empty steps",
        status="draft",
        location="active",
        path=".sillyspec/changes/test-empty-steps",
        current_stage="propose",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="test-empty-steps",
            current_stage="propose",
            stages=[{"stage": "propose", "status": "in-progress"}],
            steps=[],  # No steps
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    assert result.has_pending_step is False
    assert result.steps_completed == []
    assert result.steps_pending == []


async def test_sync_stage_status_updates_change_stages_json(db_session: AsyncSession) -> None:
    """Change.stages JSON 已更新包含 steps 投影。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-json",
        title="Test json",
        status="draft",
        location="active",
        path=".sillyspec/changes/test-json",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="test-json",
            current_stage="plan",
            stages=[{"stage": "plan", "status": "in-progress"}],
            steps=[
                {"name": "task-1", "status": "completed"},
                {"name": "task-2", "status": "pending"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with patch.object(service, "_resolve_db_path", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = SpecPathResolver(tmp_dir).db_path()
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    await db_session.refresh(change)
    stage_info = change.stages.get("plan")
    assert stage_info is not None
    assert stage_info["status"] == "in_progress"
    assert stage_info["steps"]["completed"] == ["task-1"]
    assert stage_info["steps"]["pending"] == ["task-2"]
    assert stage_info["current_step"] == "task-2"
    assert "synced_at" in stage_info
    assert str(run_id) == stage_info["synced_from_run"]
