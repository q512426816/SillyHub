"""Tests for Mission status derivation (Wave 1, 2026-06-19-multi-agent-orchestration).

Pure-function tests — no DB. Mission status is derived from child AgentRun
statuses; cancelled wins over everything.
"""

from __future__ import annotations

import uuid

from app.modules.agent.mission import derive_status
from app.modules.agent.model import AgentRun


def _run(status: str) -> AgentRun:
    return AgentRun(id=uuid.uuid4(), agent_type="claude_code", status=status)


def test_no_runs_is_planning() -> None:
    assert derive_status([]) == "planning"


def test_cancelled_wins_over_active() -> None:
    assert derive_status([_run("running")], cancelled=True) == "cancelled"


def test_active_run_is_running() -> None:
    assert derive_status([_run("pending"), _run("completed")]) == "running"
    assert derive_status([_run("running")]) == "running"


def test_all_completed_is_done() -> None:
    assert derive_status([_run("completed"), _run("completed")]) == "done"


def test_completed_and_failed_is_degraded() -> None:
    assert derive_status([_run("completed"), _run("failed")]) == "degraded"
    assert derive_status([_run("completed"), _run("killed")]) == "degraded"


def test_all_failed_no_completed_is_failed() -> None:
    assert derive_status([_run("failed")]) == "failed"
    assert derive_status([_run("killed"), _run("failed")]) == "failed"
