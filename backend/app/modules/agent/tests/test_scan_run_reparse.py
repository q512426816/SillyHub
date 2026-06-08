"""Unit tests for ``AgentService._execute_scan_run`` success-finalize reparse.

Covers the contract introduced by task-02 (service.py:1167-1194):
  - exit_code == 0 -> WorkspaceService.reparse(workspace_id) called exactly once
  - exit_code != 0 -> reparse NOT called
  - reparse raising -> run stays "completed"/exit_code==0, no exception propagated

All external dependencies (claude adapter, WorkspaceService.reparse, the
background session factory) are mocked; no real CLI / Redis / Postgres needed.
"""

from __future__ import annotations

import json  # noqa: F401  (kept per blueprint import contract)
import uuid
from contextlib import asynccontextmanager
from datetime import datetime  # noqa: F401  (kept per blueprint import contract)
from pathlib import Path  # noqa: F401  (kept per blueprint import contract)
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.base import AgentRunResult, AgentSpecBundle
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
from app.modules.workspace.model import Workspace

# Patch-target string constants (centralized per TDD step 5).
_RUN_WITH_BUNDLE = "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle"
_REPARSE = "app.modules.workspace.service.WorkspaceService.reparse"
_SESSION_FACTORY = "app.core.db.get_session_factory"
_POST_SCAN = "app.modules.agent.post_scan_validator.PostScanValidator.validate"
_RESUME_STATE = "app.modules.agent.post_scan_validator.validate_resume_state"


def _fake_post_scan_result():
    from app.modules.agent.post_scan_validator import PostScanValidationResult, ScanRunStatus

    return PostScanValidationResult(status=ScanRunStatus.SUCCESS)


def _fake_result(exit_code: int) -> AgentRunResult:
    """Build an AgentRunResult for scan run tests."""
    return AgentRunResult(
        exit_code=exit_code,
        stdout="scan output",
        stderr="",
        redacted_output="scan output",
    )


def _factory_returning(session: AsyncSession) -> MagicMock:
    """Return a ``get_session_factory`` replacement whose factory() yields ``session``.

    ``_execute_scan_run`` does ``factory = get_session_factory()`` then
    ``async with factory() as session``. We must NOT let the real
    ``__aexit__`` close the shared db_session fixture, so we wrap it in a
    no-op async context manager.
    """

    @asynccontextmanager
    async def _cm():
        yield session

    factory = MagicMock(return_value=_cm())
    return MagicMock(return_value=factory)


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Scan WS",
        slug=f"scan-ws-{ws_id.hex[:8]}",
        root_path=f"/scan-{ws_id.hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_pending_run(session: AsyncSession) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        change_id=None,
        agent_type="claude_code",
        status="pending",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _bundle() -> AgentSpecBundle:
    return AgentSpecBundle(
        change_summary="scan",
        task_key="scan",
        task_title="Scan workspace",
    )


async def _reload(session: AsyncSession, run_id: uuid.UUID) -> AgentRun:
    session.expire_all()
    obj = await session.get(AgentRun, run_id)
    assert obj is not None
    return obj


# ---------------------------------------------------------------------------
# Case 1: success -> reparse called once with correct workspace_id
# ---------------------------------------------------------------------------
async def test_scan_run_success_triggers_reparse(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 1, "relations_created": 0}, [], [])
    )

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(0))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_awaited_once()
    assert reparse_spy.await_args.args[0] == ws.id

    reloaded = await _reload(db_session, run.id)
    assert reloaded.status == "completed"
    assert reloaded.exit_code == 0


# ---------------------------------------------------------------------------
# Case 2: failure -> reparse NOT called
# ---------------------------------------------------------------------------
async def test_scan_run_failure_skips_reparse(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(1))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_not_awaited()

    reloaded = await _reload(db_session, run.id)
    assert reloaded.status == "failed"
    assert reloaded.exit_code == 1


# ---------------------------------------------------------------------------
# Case 3: reparse raises -> run stays completed, no exception propagates
# ---------------------------------------------------------------------------
async def test_scan_run_reparse_exception_keeps_completed(
    db_session: AsyncSession, tmp_path
) -> None:
    ws = await _create_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(side_effect=RuntimeError("parse boom"))
    warning_spy = MagicMock()

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(0))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
        patch("app.modules.agent.service.log.warning", new=warning_spy),
    ):
        svc = AgentService(db_session)
        # Must NOT raise (no pytest.raises wrapper).
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_awaited_once()

    reloaded = await _reload(db_session, run.id)
    # Not flipped to failed by the outer except, not exit_code -1.
    assert reloaded.status == "completed"
    assert reloaded.exit_code == 0
    assert reloaded.finished_at is not None

    # AC-4: warning logged once with the scan_run_reparse_failed event key.
    warning_spy.assert_called_once()
    assert warning_spy.call_args.args[0] == "scan_run_reparse_failed"


# ---------------------------------------------------------------------------
# Case 5: empty created stats -> still completes, reparse called once
# ---------------------------------------------------------------------------
async def test_scan_run_reparse_empty_created(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(0))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_awaited_once()

    reloaded = await _reload(db_session, run.id)
    assert reloaded.status == "completed"
    assert reloaded.exit_code == 0


# ---------------------------------------------------------------------------
# Case 6 (bonus): adapter missing -> early return, reparse not called, failed
# ---------------------------------------------------------------------------
async def test_scan_run_adapter_missing_skips_reparse(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch("app.modules.agent.service.ADAPTERS", new={}),
        patch(_REPARSE, new=reparse_spy),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_not_awaited()

    reloaded = await _reload(db_session, run.id)
    assert reloaded.status == "failed"


# ---------------------------------------------------------------------------
# Case 7 (bonus): missing run record -> early return, reparse not called, no raise
# ---------------------------------------------------------------------------
async def test_scan_run_missing_run_skips_reparse(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_workspace(db_session)
    user_id = uuid.uuid4()
    missing_run_id = uuid.uuid4()  # never persisted

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(0))),
        patch(_REPARSE, new=reparse_spy),
    ):
        svc = AgentService(db_session)
        # Must not raise even though the run row does not exist.
        await svc._execute_scan_run(
            run_id=missing_run_id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    reparse_spy.assert_not_awaited()


# ---------------------------------------------------------------------------
# Case 8: success on a pending workspace -> promoted to active (so /workspaces
# list_() no longer filters it out).
# ---------------------------------------------------------------------------
async def _create_pending_workspace(session: AsyncSession) -> Workspace:
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Pending WS",
        slug=f"pending-ws-{ws_id.hex[:8]}",
        root_path=f"/pending-{ws_id.hex[:8]}",
        status="pending",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def test_scan_run_success_activates_pending_workspace(
    db_session: AsyncSession, tmp_path
) -> None:
    ws = await _create_pending_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )
    info_spy = MagicMock()

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(0))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
        patch("app.modules.agent.service.log.info", new=info_spy),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    # The in-DB row was flipped to active before reparse ran.
    assert ws.status == "active"
    # The activation event fired exactly once for this workspace.
    activated = [
        c for c in info_spy.call_args_list if c.args and c.args[0] == "scan_run_workspace_activated"
    ]
    assert len(activated) == 1


# ---------------------------------------------------------------------------
# Case 9: failure on a pending workspace -> stays pending (not promoted).
# ---------------------------------------------------------------------------
async def test_scan_run_failure_keeps_workspace_pending(db_session: AsyncSession, tmp_path) -> None:
    ws = await _create_pending_workspace(db_session)
    run = await _create_pending_run(db_session)
    user_id = uuid.uuid4()

    reparse_spy = AsyncMock(
        return_value=(MagicMock(), {"created": 0, "relations_created": 0}, [], [])
    )
    info_spy = MagicMock()

    with (
        patch(_SESSION_FACTORY, new=_factory_returning(db_session)),
        patch(_RUN_WITH_BUNDLE, new=AsyncMock(return_value=_fake_result(1))),
        patch(_REPARSE, new=reparse_spy),
        patch(_POST_SCAN, return_value=_fake_post_scan_result()),
        patch(_RESUME_STATE, return_value={"is_resume": False}),
        patch("app.modules.agent.service.log.info", new=info_spy),
    ):
        svc = AgentService(db_session)
        await svc._execute_scan_run(
            run_id=run.id,
            bundle=_bundle(),
            work_dir=tmp_path,
            workspace_id=ws.id,
            user_id=user_id,
        )

    # Failed run must not promote the workspace.
    assert ws.status == "pending"
    activated = [
        c for c in info_spy.call_args_list if c.args and c.args[0] == "scan_run_workspace_activated"
    ]
    assert activated == []
