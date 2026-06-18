"""Unit tests for tool failure rate monitor (task-09 / FR-08b / D-008 / R-GLM).

Covers AC-09.10~09.12:
  - _aggregate_tool_failure counts tool_result logs and failed subset;
  - threshold warn fires only when tool_total >= MIN_SAMPLE (4) AND rate >= threshold;
  - threshold configurable via env GLM_TOOL_FAILURE_RATE_THRESHOLD;
  - works for both glm and anthropic providers (no provider branch);
  - result.is_error (turn-level) does NOT count as tool failure.

The persisted AgentRunLog schema is flat: (channel, content_redacted).
Daemon serializes tool_result as content_redacted "[TOOL_RESULT] <preview>"
(channel "stdout" in batch path; "tool_call" also accepted). is_error is not
a structured field — failure is inferred from content error markers.

These tests are pure-Python (no DB): they exercise the aggregator + the warn
predicate directly.
"""

from __future__ import annotations

import logging
import uuid

import pytest

from app.modules.agent.model import AgentRunLog
from app.modules.agent.service import (
    ToolFailureStats,
    aggregate_tool_failure,
    should_warn_tool_failure,
)


def _make_log(channel: str, content: str, run_id: uuid.UUID | None = None) -> AgentRunLog:
    return AgentRunLog(
        run_id=run_id or uuid.uuid4(),
        channel=channel,
        content_redacted=content,
    )


# ── aggregate_tool_failure ────────────────────────────────────────────────────


def test_aggregate_empty_logs() -> None:
    stats = aggregate_tool_failure([])
    assert stats.tool_total == 0
    assert stats.tool_failed == 0
    assert stats.failure_rate == 0.0


def test_aggregate_counts_tool_result_logs() -> None:
    logs = [
        _make_log("stdout", "[TOOL_RESULT] file written"),
        _make_log("stdout", "[TOOL_RESULT] permission error: write denied"),
        _make_log("stdout", "[TOOL_RESULT] Error: command not found"),
        _make_log("tool_call", "[TOOL_RESULT] ok"),
    ]
    stats = aggregate_tool_failure(logs)
    assert stats.tool_total == 4
    # 2 failed (permission error / Error: ...).
    assert stats.tool_failed == 2
    assert stats.failure_rate == pytest.approx(0.5)


def test_aggregate_ignores_non_tool_logs() -> None:
    logs = [
        _make_log("stdout", "[ASSISTANT] hello"),
        _make_log("stderr", "Error: crash"),  # stderr but not a tool_result
        _make_log("stdout", "[SYSTEM:foo] bar"),
        _make_log("tool_call", '{"tool":"Bash","args":{}}'),  # tool_use, not result
    ]
    stats = aggregate_tool_failure(logs)
    assert stats.tool_total == 0
    assert stats.tool_failed == 0


def test_aggregate_failure_rate_zero_division_safe() -> None:
    # No tool_result logs → rate 0.0 (no ZeroDivisionError).
    logs = [_make_log("stdout", "[ASSISTANT] hi")]
    stats = aggregate_tool_failure(logs)
    assert stats.failure_rate == 0.0


def test_aggregate_all_failed() -> None:
    logs = [
        _make_log("stdout", "[TOOL_RESULT] permission error: denied"),
        _make_log("stdout", "[TOOL_RESULT] PermissionError: no write"),
        _make_log("stdout", "[TOOL_RESULT] failed: exit code 1"),
        _make_log("stdout", "[TOOL_RESULT] error: timeout"),
    ]
    stats = aggregate_tool_failure(logs)
    assert stats.tool_total == 4
    assert stats.tool_failed == 4
    assert stats.failure_rate == 1.0


# ── should_warn_tool_failure (threshold + sample floor) ───────────────────────


def test_warn_at_threshold_boundary_sample4_rate050() -> None:
    # tool_total=4 rate=0.5 == default threshold 0.5 → warn.
    stats = ToolFailureStats(tool_total=4, tool_failed=2, failure_rate=0.5)
    assert should_warn_tool_failure(stats, threshold=0.5) is True


def test_warn_not_fired_below_sample_floor() -> None:
    # tool_total=3 rate=1.0 but < MIN_TOOL_FAILURE_SAMPLE(4) → no warn.
    stats = ToolFailureStats(tool_total=3, tool_failed=3, failure_rate=1.0)
    assert should_warn_tool_failure(stats, threshold=0.5) is False


def test_warn_not_fired_zero_tools() -> None:
    stats = ToolFailureStats(tool_total=0, tool_failed=0, failure_rate=0.0)
    assert should_warn_tool_failure(stats, threshold=0.5) is False


def test_warn_not_fired_below_threshold() -> None:
    # tool_total=4 rate=0.25 < threshold 0.5 → no warn.
    stats = ToolFailureStats(tool_total=4, tool_failed=1, failure_rate=0.25)
    assert should_warn_tool_failure(stats, threshold=0.5) is False


def test_warn_threshold_configurable_lower() -> None:
    # Lower threshold to 0.25 → rate 0.25 now triggers.
    stats = ToolFailureStats(tool_total=4, tool_failed=1, failure_rate=0.25)
    assert should_warn_tool_failure(stats, threshold=0.25) is True


def test_warn_threshold_configurable_higher() -> None:
    # Raise threshold to 0.75 → rate 0.5 no longer triggers.
    stats = ToolFailureStats(tool_total=4, tool_failed=2, failure_rate=0.5)
    assert should_warn_tool_failure(stats, threshold=0.75) is False


# ── monitor_session_logs integration (structured warn) ────────────────────────


@pytest.mark.asyncio
async def test_monitor_session_logs_warns_when_above_threshold(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.agent import service as svc

    # Force threshold (default 0.5). 2 failed / 4 total = 0.5 == threshold → warn.
    monkeypatch.setenv("GLM_TOOL_FAILURE_RATE_THRESHOLD", "0.5")

    run_id = uuid.uuid4()
    logs = [
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
    ]

    with caplog.at_level(logging.WARNING, logger="app.modules.agent.service"):
        await svc.monitor_session_tool_failures(
            agent_session_id=uuid.uuid4(), logs=logs, provider="glm"
        )

    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warning_records) == 1
    rec = warning_records[0]
    assert getattr(rec, "event", None) == "glm_tool_failure_rate_exceeded" or (
        "tool_failure" in rec.getMessage().lower()
    )
    # extra 携带结构化字段（session_id / tool_total / tool_failed / failure_rate / threshold）。
    assert getattr(rec, "tool_total", None) == 4
    assert getattr(rec, "tool_failed", None) == 2
    assert getattr(rec, "failure_rate", None) == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_monitor_session_logs_silent_below_sample_floor(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.agent import service as svc

    monkeypatch.setenv("GLM_TOOL_FAILURE_RATE_THRESHOLD", "0.5")
    run_id = uuid.uuid4()
    logs = [
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        # 3 failed / 3 total but < MIN_TOOL_FAILURE_SAMPLE(4) → no warn.
    ]

    with caplog.at_level(logging.WARNING, logger="app.modules.agent.service"):
        await svc.monitor_session_tool_failures(
            agent_session_id=uuid.uuid4(), logs=logs, provider="glm"
        )

    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warning_records) == 0


@pytest.mark.asyncio
async def test_monitor_session_logs_silent_when_all_success(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.agent import service as svc

    monkeypatch.setenv("GLM_TOOL_FAILURE_RATE_THRESHOLD", "0.5")
    run_id = uuid.uuid4()
    logs = [
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
    ]

    with caplog.at_level(logging.WARNING, logger="app.modules.agent.service"):
        await svc.monitor_session_tool_failures(
            agent_session_id=uuid.uuid4(), logs=logs, provider="anthropic"
        )

    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warning_records) == 0


@pytest.mark.asyncio
async def test_monitor_session_logs_anthropic_provider_also_counted(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D-008 normalized_requirement: monitoring is provider-agnostic (no branch)."""
    from app.modules.agent import service as svc

    monkeypatch.setenv("GLM_TOOL_FAILURE_RATE_THRESHOLD", "0.5")
    run_id = uuid.uuid4()
    logs = [
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] permission error: denied", run_id),
        _make_log("stdout", "[TOOL_RESULT] ok", run_id),
    ]

    with caplog.at_level(logging.WARNING, logger="app.modules.agent.service"):
        await svc.monitor_session_tool_failures(
            agent_session_id=uuid.uuid4(), logs=logs, provider="anthropic"
        )

    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    # 3/4 = 0.75 >= 0.5 threshold, sample >= 4 → warn even for anthropic.
    assert len(warning_records) == 1


# ── result.is_error (turn-level) does NOT count as tool failure (AC-09.12) ────


def test_aggregate_ignores_turn_level_result_is_error() -> None:
    # turn-level result logged as stderr "[RESULT:failed]" — not a tool_result.
    logs = [
        _make_log("stderr", "[RESULT:failed] turn crashed"),
        _make_log("stdout", "[TOOL_RESULT] ok"),
    ]
    stats = aggregate_tool_failure(logs)
    assert stats.tool_total == 1
    assert stats.tool_failed == 0
