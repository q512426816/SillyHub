"""Tests for stage-driven agent dispatch.

Covers: StageAgentConfig lookup, has_active_run, dispatch(), and
load_prompt_template for the clarifying stage.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
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


def test_get_config_for_brainstorm() -> None:
    """Brainstorm stage has a valid config."""
    config = get_config_for_stage("brainstorm")
    assert config is not None
    assert config.enabled is True
    assert config.prompt_template == "brainstorm.md"
    assert config.requires_worktree is False  # D-002: daemon-client 不用 worktree
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
        assert config.prompt_template, f"Stage '{stage}' missing prompt_template"
        assert config.phase, f"Stage '{stage}' missing phase"


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
# 3. dispatch() — brainstorm stage
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
        target_stage="brainstorm",
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
        target_stage="brainstorm",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert result["reason"] == "change_not_found"


async def test_dispatch_updates_last_dispatch_in_stages(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    change = await _create_change(db_session, current_stage="draft")

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        result = await dispatch(
            session=db_session,
            workspace_id=change.workspace_id,
            change_id=change.id,
            target_stage="brainstorm",
            user_id=uuid.uuid4(),
        )

    assert result["dispatched"] is True
    assert result["stage"] == "brainstorm"

    # Verify stages JSON was updated
    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "brainstorm"
    assert "at" in last_dispatch
    assert "config" in last_dispatch
    assert last_dispatch["config"]["prompt_template"] == "brainstorm.md"


# ===================================================================
# 4. load_prompt_template
# ===================================================================


def test_load_clarifying_template() -> None:
    """Clarifying template loads and contains expected sections."""
    content = load_prompt_template("clarifying.md")
    assert content
    assert "Clarifying" in content
    assert "read-only" in content


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
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is True
    assert result["stage"] == "brainstorm"
    assert result["agent_run_id"] is not None
    # Validate UUID format
    uuid.UUID(result["agent_run_id"])


async def test_dispatch_next_step_passes_prompt_template(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch receives correct stage and prompt_template."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

        # Verify start_stage_dispatch was called with correct params
        call_kwargs = mock_svc.start_stage_dispatch.call_args[1]
        assert call_kwargs["stage"] == "brainstorm"
        assert call_kwargs["prompt_template"] == "brainstorm.md"


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
        target_stage="brainstorm",
    )

    assert result["dispatched"] is False
    assert result["reason"] == "active_run_exists"
    assert result["stage"] == "brainstorm"


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
            target_stage="brainstorm",
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
            target_stage="brainstorm",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "bundle_build_error"
    assert result["stage"] == "brainstorm"


async def test_dispatch_next_step_agent_start_error(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch failure returns dispatched=False, reason=agent_start_error."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(side_effect=RuntimeError("Agent crashed"))

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "agent_start_error"
    assert result["stage"] == "brainstorm"

    # Wave0 (ql-20260619-001-f6cc): dispatch_next_step no longer pre-creates a
    # Run, so a start_stage_dispatch failure leaves NO Run behind.
    assert await _runs_for_change(db_session, change.id) == []


async def test_dispatch_next_step_records_last_dispatch(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is True

    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "brainstorm"
    assert last_dispatch["run_id"] is not None
    assert last_dispatch["config"]["phase"] == "Brainstorm"
    assert last_dispatch["config"]["requires_worktree"] is False


async def test_dispatch_next_step_creates_workspace_association(db_session: AsyncSession) -> None:
    """Dispatch creates AgentRunWorkspace record linking run to workspace."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
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

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)

        # First dispatch succeeds
        result1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )
        assert result1["dispatched"] is True

        # Second dispatch blocked by active run
        result2 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="brainstorm",
        )
        assert result2["dispatched"] is False
        assert result2["reason"] == "active_run_exists"


# ===================================================================
# 7. StageSyncResult + sync_stage_status (task-09)
# ===================================================================


import sqlite3
from pathlib import Path as SyncPath

from app.core.spec_paths import SpecPathResolver
from app.modules.change.dispatch import StageSyncResult


class _LocalFakeDelegate:
    """Fake HostFsDelegate that reads sillyspec.db from a local tmp dir.

    2026-07-10-remove-server-local-workspace-mode: sync_stage_status 永远走
    daemon-client RPC（delegate.stat/read_file）。测试把 db 建在本地 tmp，
    用本 fake 让 delegate 读取——业务逻辑（changes/stages/steps 投影）不变。
    """

    def __init__(self, db_path: SyncPath) -> None:
        self._db_path = SyncPath(db_path)

    async def stat(self, workspace, path: str) -> dict:
        # path 是相对 workspace.root_path 的 rel，但本 fake 只关心真实 db 文件
        return {
            "exists": self._db_path.is_file(),
            "size": self._db_path.stat().st_size if self._db_path.is_file() else 0,
        }

    async def read_file(self, workspace, path: str) -> str:
        return self._db_path.read_bytes().decode("latin-1")


def _patch_sync_to_local_db(service, db_path: SyncPath):
    """Context manager: patch SillySpecStageDispatchService so sync reads a
    local sillyspec.db.

    Patches ``_resolve_db_rel_candidates``（返回占位 rel）+ ``_get_host_fs_delegate``
    （返回 _LocalFakeDelegate 读本地 db），让 sync_stage_status 在无真 daemon 的
    单测里走完 daemon-client 业务逻辑。
    """
    return _patch_sync_with_delegate(service, _LocalFakeDelegate(db_path))


def _patch_sync_with_delegate(service, delegate):
    """Context manager: inject a custom fake delegate into sync_stage_status.

    For boundary tests（db missing / corrupt / unreadable），callers build a
    delegate whose ``stat`` / ``read_file`` exhibit the failure mode.
    """
    from contextlib import contextmanager
    from unittest.mock import AsyncMock, patch

    @contextmanager
    def _cm():
        patches = [
            patch.object(
                service,
                "_resolve_db_rel_candidates",
                new_callable=AsyncMock,
                return_value=["sillyspec.db"],
            ),
            patch.object(service, "_get_host_fs_delegate", return_value=delegate),
        ]
        for p in patches:
            p.start()
        try:
            yield
        finally:
            for p in patches:
                p.stop()

    return _cm()


class _MissingDbDelegate:
    """Fake delegate whose stat reports the db absent (db_not_found scenario)."""

    async def stat(self, workspace, path: str) -> dict:
        return {"exists": False, "size": 0}

    async def read_file(self, workspace, path: str) -> str:
        raise FileNotFoundError(path)


class _CorruptDbDelegate:
    """Fake delegate that returns non-db bytes (db_connect_failed scenario)."""

    def __init__(self, content: str = "not a real db") -> None:
        self._content = content

    async def stat(self, workspace, path: str) -> dict:
        return {"exists": True, "size": len(self._content)}

    async def read_file(self, workspace, path: str) -> str:
        return self._content


def _create_sillyspec_db(
    tmp_path: SyncPath,
    change_key: str = "test-change",
    current_stage: str = "brainstorm",
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
            current_stage="brainstorm",
            steps=[
                {"name": "step1", "status": "completed"},
                {"name": "step2", "status": "pending"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
            result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is True
    assert result.current_stage == "brainstorm"
    assert result.current_step == "step2"
    assert result.stage_completed is False
    assert result.has_pending_step is True
    assert "step1" in result.steps_completed
    assert "step2" in result.steps_pending

    # Verify Change.current_stage was updated
    await db_session.refresh(change)
    assert change.current_stage == "brainstorm"
    assert "brainstorm" in change.stages
    assert change.stages["brainstorm"]["steps"]["completed"] == ["step1"]


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
        current_stage="brainstorm",
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
            current_stage="brainstorm",
            stages=[{"stage": "brainstorm", "status": "completed"}],
            steps=[
                {"name": "step1", "status": "completed"},
                {"name": "step2", "status": "completed"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
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
    with _patch_sync_with_delegate(service, _MissingDbDelegate()):
        result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "not found" in result.error


async def test_sync_stage_status_db_connect_failed(db_session: AsyncSession) -> None:
    """sillyspec.db 内容损坏 — synced=False。

    2026-07-10-remove-server-local-workspace-mode: daemon-client 路径下
    delegate.read_file 先拿字节成功（latin-1 往返），写临时文件后 sqlite3
    查询才发现「file is not a database」→ 归类 db_read_failed（旧 server-local
    直连 sqlite 时是 db_connect_failed，路径不同语义相应调整）。
    """
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    run_id = uuid.uuid4()
    with _patch_sync_with_delegate(service, _CorruptDbDelegate("not a real db")):
        result = await service.sync_stage_status(db_session, change.id, run_id)

    assert result.synced is False
    assert "db_read_failed" in result.error


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
        with _patch_sync_to_local_db(service, db_path):
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
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
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
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
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
        current_stage="brainstorm",
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
            current_stage="brainstorm",
            stages=[{"stage": "brainstorm", "status": "in-progress"}],
            steps=[],  # No steps
        )
        service = SillySpecStageDispatchService(db_session)
        run_id = uuid.uuid4()
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
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
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
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


# ===================================================================
# 8. Task-20: dispatch + sync 联合单测
# ===================================================================


async def test_dispatch_then_sync_partial_progress(db_session: AsyncSession) -> None:
    """dispatch 创建 AgentRun → sync 同步部分完成状态 → 验证 sync_result 和 stages 内存状态。

    NOTE: sync_stage_status 修改 JSON 列 stages 时存在 SQLAlchemy
    in-place mutation 同引用赋值不持久化的问题。此处验证
    sync_result 返回值和内存中的 stages 状态（refresh 前）。
    """
    import tempfile

    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="t20-partial",
        title="Task20 partial",
        status="draft",
        location="active",
        path=".sillyspec/changes/t20-partial",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # --- Phase 1: dispatch_next_step ---
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        dispatch_result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert dispatch_result["dispatched"] is True
    agent_run_id = uuid.UUID(dispatch_result["agent_run_id"])

    # Verify AgentRun exists in DB (Wave0: owned by start_stage_dispatch)
    agent_run = await db_session.get(AgentRun, agent_run_id)
    assert agent_run is not None
    assert agent_run.change_id == change.id

    # --- Phase 2: Complete the AgentRun, then sync ---
    agent_run.status = "completed"
    db_session.add(agent_run)
    await db_session.commit()

    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="t20-partial",
            current_stage="brainstorm",
            steps=[
                {"name": "brainstorm", "status": "completed"},
                {"name": "write-proposal", "status": "pending"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
            sync_result = await service.sync_stage_status(
                db_session,
                change.id,
                agent_run_id,
            )

    # Verify sync_result
    assert sync_result.synced is True
    assert sync_result.current_stage == "brainstorm"
    assert sync_result.current_step == "write-proposal"
    assert sync_result.stage_completed is False
    assert sync_result.has_pending_step is True
    assert "brainstorm" in sync_result.steps_completed
    assert "write-proposal" in sync_result.steps_pending

    # Verify in-memory stages state (before refresh)
    assert "brainstorm" in change.stages
    assert change.stages["brainstorm"]["steps"]["completed"] == ["brainstorm"]

    # Verify current_stage column IS persisted (String column, no mutation issue)
    await db_session.refresh(change)
    assert change.current_stage == "brainstorm"


async def test_dispatch_then_sync_all_completed(db_session: AsyncSession) -> None:
    """dispatch → sync 返回 stage_completed=True → stages 内存标记完成。"""
    import tempfile

    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="t20-done",
        title="Task20 done",
        status="draft",
        location="active",
        path=".sillyspec/changes/t20-done",
        current_stage="brainstorm",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # Create AgentRun via dispatch
    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        dispatch_result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert dispatch_result["dispatched"] is True
    agent_run_id = uuid.UUID(dispatch_result["agent_run_id"])

    # Mark AgentRun completed
    agent_run = await db_session.get(AgentRun, agent_run_id)
    agent_run.status = "completed"
    db_session.add(agent_run)
    await db_session.commit()

    # Sync with all steps completed
    with tempfile.TemporaryDirectory() as tmp_dir:
        _create_sillyspec_db(
            SyncPath(tmp_dir),
            change_key="t20-done",
            current_stage="brainstorm",
            stages=[{"stage": "brainstorm", "status": "completed"}],
            steps=[
                {"name": "brainstorm", "status": "completed"},
                {"name": "write-proposal", "status": "completed"},
            ],
        )
        service = SillySpecStageDispatchService(db_session)
        with _patch_sync_to_local_db(service, SpecPathResolver(tmp_dir).db_path()):
            sync_result = await service.sync_stage_status(
                db_session,
                change.id,
                agent_run_id,
            )

    assert sync_result.synced is True
    assert sync_result.stage_completed is True
    assert sync_result.has_pending_step is False
    assert sync_result.steps_pending == []
    assert len(sync_result.steps_completed) == 2

    # Verify in-memory stages shows completed
    assert change.stages["brainstorm"]["status"] == "completed"


async def test_dispatch_then_sync_no_db_stops_chain(db_session: AsyncSession) -> None:
    """dispatch 成功 → sync 失败(db不存在) → 链路中断，current_stage 不变。"""
    workspace_id = await _create_workspace(db_session)
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="t20-nodb",
        title="Task20 no db",
        status="draft",
        location="active",
        path=".sillyspec/changes/t20-nodb",
        current_stage="draft",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # Dispatch
    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        dispatch_result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert dispatch_result["dispatched"] is True
    agent_run_id = uuid.UUID(dispatch_result["agent_run_id"])

    # Sync fails — db not found
    service = SillySpecStageDispatchService(db_session)
    with _patch_sync_with_delegate(service, _MissingDbDelegate()):
        sync_result = await service.sync_stage_status(db_session, change.id, agent_run_id)

    assert sync_result.synced is False
    assert "not found" in sync_result.error

    # Change.current_stage should NOT have been updated (String column persisted)
    await db_session.refresh(change)
    assert change.current_stage == "draft"


async def test_dispatch_sync_auto_dispatch_chain(db_session: AsyncSession) -> None:
    """dispatch → auto_dispatch_next_step：验证自动调度调用 dispatch() 并递增 chain_count。"""
    from app.modules.change.dispatch import auto_dispatch_next_step

    workspace_id = await _create_workspace(db_session)
    user_id = uuid.uuid4()
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="t20-chain",
        title="Task20 chain",
        status="draft",
        location="active",
        path=".sillyspec/changes/t20-chain",
        current_stage="brainstorm",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    # --- Step 1: First dispatch via SillySpecStageDispatchService ---
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

    # --- Step 2: Complete first run ---
    run1 = await db_session.get(AgentRun, run1_id)
    run1.status = "completed"
    db_session.add(run1)
    await db_session.commit()

    # --- Step 3: Build sync result manually (simulates sync from sillyspec.db) ---
    sync_result = StageSyncResult(
        synced=True,
        change_id=change.id,
        run_id=run1_id,
        current_stage="brainstorm",
        current_step="write-proposal",
        stage_completed=False,
        has_pending_step=True,
        steps_completed=["brainstorm"],
        steps_pending=["write-proposal"],
    )

    # --- Step 4: auto_dispatch_next_step → calls standalone dispatch() ---
    # Mock the standalone dispatch() function that auto_dispatch_next_step calls
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

    # Verify auto_dispatch_next_step returned success
    assert auto_result["dispatched"] is True
    assert auto_result["reason"] == "auto_dispatch"
    # Verify the standalone dispatch() was called with correct stage
    mock_dispatch.assert_called_once()
    call_kwargs = mock_dispatch.call_args
    assert call_kwargs.kwargs.get("target_stage") == "brainstorm"


# ===================================================================
# Wave0 (ql-20260619-001-f6cc): dispatch_next_step single-Run contract
# ===================================================================

from contextlib import contextmanager

from sqlalchemy import select as sa_select
from sqlmodel import col as sa_col


@contextmanager
def _patch_stage_dispatch_creates_run(
    session: AsyncSession,
    change_id: uuid.UUID,
    workspace_id: uuid.UUID,
    *,
    status: str = "running",
):
    """Patch ``AgentService.start_stage_dispatch`` to mimic the real method:
    create a REAL ``AgentRun`` + ``AgentRunWorkspace`` in the DB and return it.

    Post-Wave0 contract: the Run is owned by ``start_stage_dispatch``, NOT by
    ``dispatch_next_step``. Tests must assert against the actual DB rows the
    (mocked) ``start_stage_dispatch`` produces — a bare ``FakeRun`` would hide
    the duplicate-Run regression.
    """
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
            status=status,
        )
        session.add(run)
        session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
        await session.commit()
        await session.refresh(run)
        return run

    with patch(
        "app.modules.agent.service.AgentService.start_stage_dispatch",
        new=_impl,
    ) as mock_method:
        yield mock_method


async def _runs_for_change(session: AsyncSession, change_id: uuid.UUID) -> list[AgentRun]:
    stmt = sa_select(AgentRun).where(sa_col(AgentRun.change_id) == change_id)
    return list((await session.execute(stmt)).scalars().all())


async def test_wave0_dispatch_next_step_creates_single_run(db_session: AsyncSession) -> None:
    """验收#1: 一次 execute 只产生一个 AgentRun（由 start_stage_dispatch 拥有）。
    回归：旧实现预创建 Run A 且 start_stage_dispatch 又建 Run B，留孤儿。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is True
    assert len(await _runs_for_change(db_session, change.id)) == 1


async def test_wave0_dispatch_next_step_ids_consistent(db_session: AsyncSession) -> None:
    """验收#2/#4: 返回 id == last_dispatch.run_id == 唯一 Run 的 id（SSE/历史日志同 id）。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    returned_id = uuid.UUID(result["agent_run_id"])
    await db_session.refresh(change)
    last_dispatch_run_id = uuid.UUID(change.stages["last_dispatch"]["run_id"])
    runs = await _runs_for_change(db_session, change.id)
    assert len(runs) == 1
    assert runs[0].id == returned_id
    assert last_dispatch_run_id == returned_id


async def test_wave0_dispatch_next_step_single_workspace_association(
    db_session: AsyncSession,
) -> None:
    """验收#3: 只有且仅有一条 AgentRunWorkspace，关联到唯一 Run。"""
    from app.modules.workspace.model import AgentRunWorkspace

    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    returned_id = uuid.UUID(result["agent_run_id"])
    stmt = sa_select(AgentRunWorkspace).where(
        sa_col(AgentRunWorkspace.workspace_id) == workspace_id
    )
    assocs = list((await db_session.execute(stmt)).scalars().all())
    assert len(assocs) == 1
    assert assocs[0].agent_run_id == returned_id


async def test_wave0_dispatch_next_step_start_failure_leaves_no_run(
    db_session: AsyncSession,
) -> None:
    """验收#5: start_stage_dispatch 抛异常时，dispatch_next_step 不遗留任何 Run
    （不再预创建 Run A）。无孤儿 pending Run。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with patch(
        "app.modules.agent.service.AgentService.start_stage_dispatch",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "agent_start_error"
    assert await _runs_for_change(db_session, change.id) == []


async def test_wave0_dispatch_next_step_clears_legacy_orphan_and_unblocks(
    db_session: AsyncSession,
) -> None:
    """验收#6: 已存在的历史孤儿 Run A（旧 dispatch_next_step 残留）在新 dispatch 时
    被安全清理，change 不再被永久阻塞。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    orphan = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        change_id=change.id,
        agent_type="claude_code",
        provider=None,
        model=None,
        status="pending",
        spec_strategy="sillyspec",
    )
    db_session.add(orphan)
    await db_session.commit()

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is True  # 不再被孤儿阻塞
    await db_session.refresh(orphan)
    assert orphan.status == "killed"  # 孤儿被清理
    pending = [r for r in await _runs_for_change(db_session, change.id) if r.status == "pending"]
    assert pending == []  # 无遗留 pending（孤儿 killed，新 run running）


# ===================================================================
# Wave0: orphan dispatch Run cleanup — precise, never touches normal pending
# ===================================================================


async def test_wave0_cleanup_removes_legacy_orphan_only(db_session: AsyncSession) -> None:
    """孤儿清理精准命中旧 dispatch_next_step Run A 指纹（pending + task_id NULL +
    lease NULL + provider NULL + model NULL + spec_strategy='sillyspec'）。"""
    from app.modules.change.dispatch import cleanup_orphan_dispatch_runs

    change = await _create_change(db_session)
    orphan = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        change_id=change.id,
        agent_type="claude_code",
        provider=None,
        model=None,
        status="pending",
        spec_strategy="sillyspec",
    )
    db_session.add(orphan)
    await db_session.commit()

    cleaned = await cleanup_orphan_dispatch_runs(db_session, change.id)

    assert cleaned == [orphan.id]
    await db_session.refresh(orphan)
    assert orphan.status == "killed"


async def test_wave0_cleanup_preserves_all_normal_pending_runs(
    db_session: AsyncSession,
) -> None:
    """正常 pending Run 绝不被清理：Run B(spec=None)/task 级(task_id)/有 lease/
    有 provider/已完成 的 Run 全部不动。"""
    from app.modules.change.dispatch import cleanup_orphan_dispatch_runs

    change = await _create_change(db_session)
    preserved = [
        # Run B: start_stage_dispatch 产物，spec_strategy=None
        AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            change_id=change.id,
            agent_type="claude_code",
            provider="claude",
            model="m",
            status="pending",
            spec_strategy=None,
        ),
        # task 级 sillyspec run: 有 task_id
        AgentRun(
            id=uuid.uuid4(),
            task_id=uuid.uuid4(),
            lease_id=None,
            change_id=change.id,
            agent_type="claude_code",
            provider=None,
            model=None,
            status="pending",
            spec_strategy="sillyspec",
        ),
        # 有 worktree lease
        AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            provider=None,
            model=None,
            status="pending",
            spec_strategy="sillyspec",
        ),
        # 有 provider
        AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            change_id=change.id,
            agent_type="claude_code",
            provider="claude",
            model=None,
            status="pending",
            spec_strategy="sillyspec",
        ),
        # 已完成（非 pending）
        AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            change_id=change.id,
            agent_type="claude_code",
            provider=None,
            model=None,
            status="completed",
            spec_strategy="sillyspec",
        ),
    ]
    for r in preserved:
        db_session.add(r)
    await db_session.commit()
    original_statuses = {r.id: r.status for r in preserved}

    cleaned = await cleanup_orphan_dispatch_runs(db_session, change.id)

    assert cleaned == []
    for r in preserved:
        await db_session.refresh(r)
        assert r.status == original_statuses[r.id]


# ===================================================================
# Wave0: stale pending orphan backstop (ql-20260620-001)
# Generic, time-windowed — catches pending orphans that match neither
# reconcile (running only) nor the legacy sillyspec fingerprint.
# ===================================================================


async def test_cleanup_stale_pending_runs_removes_overdue(
    db_session: AsyncSession,
) -> None:
    """超龄 pending 孤儿（任何来源）被清理。模拟 start_stage_dispatch commit Run
    后、dispatch_to_daemon 前抛异常遗留的 Run：spec_strategy=None（不命中 legacy
    指纹），created_at 远超阈值。"""
    from datetime import UTC, datetime, timedelta

    from app.modules.change.dispatch import cleanup_stale_pending_runs

    change = await _create_change(db_session)
    orphan = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        change_id=change.id,
        agent_type="claude_code",
        provider=None,
        model=None,
        status="pending",
        spec_strategy=None,
        created_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(orphan)
    await db_session.commit()

    cleaned = await cleanup_stale_pending_runs(db_session, change.id)

    assert cleaned == [orphan.id]
    await db_session.refresh(orphan)
    assert orphan.status == "killed"
    assert orphan.exit_code == -1
    assert orphan.finished_at is not None


async def test_cleanup_stale_pending_runs_preserves_fresh_pending(
    db_session: AsyncSession,
) -> None:
    """刚创建的 pending Run（正常启动中）绝不被误杀——时间窗保护。"""
    from app.modules.change.dispatch import cleanup_stale_pending_runs

    change = await _create_change(db_session)
    fresh = await _create_agent_run(db_session, change_id=change.id, status="pending")

    cleaned = await cleanup_stale_pending_runs(db_session, change.id)

    assert cleaned == []
    await db_session.refresh(fresh)
    assert fresh.status == "pending"


async def test_cleanup_stale_pending_runs_preserves_non_pending(
    db_session: AsyncSession,
) -> None:
    """running/completed/failed/killed 的超龄 Run 一律不动（pending 专属）。"""
    from datetime import UTC, datetime, timedelta

    from app.modules.change.dispatch import cleanup_stale_pending_runs

    change = await _create_change(db_session)
    old = datetime.now(UTC) - timedelta(minutes=30)
    others = []
    for status in ("running", "completed", "failed", "killed"):
        run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status=status,
            created_at=old,
        )
        db_session.add(run)
        others.append(run)
    await db_session.commit()

    cleaned = await cleanup_stale_pending_runs(db_session, change.id)

    assert cleaned == []
    for run in others:
        await db_session.refresh(run)
        assert run.status != "pending"


async def test_cleanup_stale_pending_runs_ignores_other_changes(
    db_session: AsyncSession,
) -> None:
    """只清理目标 change 的孤儿，不误伤其他 change 的超龄 pending Run。"""
    from datetime import UTC, datetime, timedelta

    from app.modules.change.dispatch import cleanup_stale_pending_runs

    change_a = await _create_change(db_session)
    change_b = await _create_change(db_session)
    other = AgentRun(
        id=uuid.uuid4(),
        change_id=change_b.id,
        agent_type="claude_code",
        status="pending",
        created_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(other)
    await db_session.commit()

    cleaned = await cleanup_stale_pending_runs(db_session, change_a.id)

    assert cleaned == []
    await db_session.refresh(other)
    assert other.status == "pending"


async def test_dispatch_next_step_unblocks_after_stale_pending_orphan(
    db_session: AsyncSession,
) -> None:
    """验收：start_stage_dispatch 内部失败遗留的 pending 孤儿（spec=None，不命中
    legacy 指纹），经时间窗清理后新 dispatch 不再被永久阻塞。这是 612e71a 之后
    仍存在的缺口——现有 wave0 测试 mock 整个 start_stage_dispatch 抛异常（Run 未
    创建），未覆盖 commit-后-抛异常的真实孤儿路径。"""
    from datetime import UTC, datetime, timedelta

    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    orphan = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        change_id=change.id,
        agent_type="claude_code",
        provider=None,
        model=None,
        status="pending",
        spec_strategy=None,
        created_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(orphan)
    await db_session.commit()

    with _patch_stage_dispatch_creates_run(db_session, change.id, workspace_id):
        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="brainstorm",
        )

    assert result["dispatched"] is True  # 孤儿被时间窗清理，不再阻塞
    await db_session.refresh(orphan)
    assert orphan.status == "killed"
    pending = [r for r in await _runs_for_change(db_session, change.id) if r.status == "pending"]
    assert pending == []


# ===================================================================
# Wave0 ql-20260619-003-0f87: dispatch() last_dispatch.run_id persistence
# ===================================================================


async def test_dispatch_persists_last_dispatch_run_id(db_session: AsyncSession) -> None:
    """dispatch() 必须持久化 last_dispatch.run_id。回归：JSON in-place mutation
    (stages = change.stages or {} 在 change.stages 非空时同引用) 导致 run_id 回填
    不持久化，前端订阅 last_dispatch.run_id 拿不到真实 run id。
    与 ql-001 dispatch_next_step Step7 同类 bug。"""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id, current_stage="draft")

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch("app.modules.agent.service.AgentService") as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        result = await dispatch(
            session=db_session,
            workspace_id=change.workspace_id,
            change_id=change.id,
            target_stage="brainstorm",
            user_id=uuid.uuid4(),
        )

    assert result["dispatched"] is True
    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch.get("run_id") == str(mock_run.id)
