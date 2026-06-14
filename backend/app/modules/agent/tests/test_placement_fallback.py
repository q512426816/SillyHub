"""Tests for placement provider strict-match + offline fallback (task-02).

Covers FR-03 of ``2026-06-14-agent-runtime-selection``: when a provider is
requested but no online runtime with that provider exists, fall back to any
online runtime and emit ``placement_provider_fallback`` so dispatch never
silently fails due to the requested provider being offline.

AC mapping:
- AC-01: all online + provider="claude" -> strict match, no warning.
- AC-02: claude offline + codex/hermes online + provider="claude" -> fallback
  runtime + ``placement_provider_fallback`` warning (wanted="claude").
- AC-03: no online runtime at all -> None.
- AC-04: provider=None -> most recent heartbeat runtime, no warning.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.modules.agent.placement import RunPlacementService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# ---- helpers -----------------------------------------------------------------


async def _create_user(session) -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _add_runtime(
    session,
    user_id: uuid.UUID,
    *,
    provider: str,
    status: str = "online",
    heartbeat_offset: int = 0,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"{provider}-daemon",
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC) - timedelta(seconds=heartbeat_offset),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _patch_log(monkeypatch) -> list[dict]:
    """Replace the placement module logger with one that records warnings."""
    warnings: list[dict] = []

    def _warning(*args, **kwargs):
        warnings.append({"event": args[0] if args else None, **kwargs})

    fake_log = MagicMock()
    fake_log.warning = _warning
    fake_log.info = MagicMock()
    monkeypatch.setattr("app.modules.agent.placement.log", fake_log)
    return warnings


# ---- AC-01: strict match -----------------------------------------------------


@pytest.mark.asyncio
async def test_strict_match_when_provider_online(db_session, monkeypatch):
    """All online + provider="claude" -> claude runtime, no fallback warning."""
    user_id = await _create_user(db_session)
    await _add_runtime(db_session, user_id, provider="claude", heartbeat_offset=0)
    await _add_runtime(db_session, user_id, provider="codex", heartbeat_offset=10)
    await _add_runtime(db_session, user_id, provider="hermes", heartbeat_offset=20)

    warnings = _patch_log(monkeypatch)
    svc = RunPlacementService(db_session)
    row = await svc._get_online_runtime(user_id, provider="claude")

    assert row is not None
    assert row["provider"] == "claude"
    assert not any(w["event"] == "placement_provider_fallback" for w in warnings), warnings


# ---- AC-02: fallback + warning -----------------------------------------------


@pytest.mark.asyncio
async def test_fallback_when_provider_offline(db_session, monkeypatch):
    """claude offline + codex/hermes online + provider="claude" -> fallback + warn."""
    user_id = await _create_user(db_session)
    await _add_runtime(db_session, user_id, provider="claude", status="offline")
    await _add_runtime(db_session, user_id, provider="codex", heartbeat_offset=5)
    await _add_runtime(db_session, user_id, provider="hermes", heartbeat_offset=10)

    warnings = _patch_log(monkeypatch)
    svc = RunPlacementService(db_session)
    row = await svc._get_online_runtime(user_id, provider="claude")

    assert row is not None
    assert row["provider"] in {"codex", "hermes"}
    fallbacks = [w for w in warnings if w["event"] == "placement_provider_fallback"]
    assert len(fallbacks) == 1
    assert fallbacks[0]["wanted"] == "claude"
    assert fallbacks[0]["actual"] == row["provider"]


# ---- AC-03: no online runtime -----------------------------------------------


@pytest.mark.asyncio
async def test_returns_none_when_no_online(db_session, monkeypatch):
    """No online runtime (all offline) -> None even with provider requested."""
    user_id = await _create_user(db_session)
    await _add_runtime(db_session, user_id, provider="claude", status="offline")

    warnings = _patch_log(monkeypatch)
    svc = RunPlacementService(db_session)
    row = await svc._get_online_runtime(user_id, provider="claude")

    assert row is None
    assert not any(w["event"] == "placement_provider_fallback" for w in warnings)


# ---- AC-04: provider=None -> most recent heartbeat --------------------------


@pytest.mark.asyncio
async def test_no_provider_returns_most_recent(db_session, monkeypatch):
    """provider=None -> most recent heartbeat wins, no warning."""
    user_id = await _create_user(db_session)
    await _add_runtime(db_session, user_id, provider="codex", heartbeat_offset=30)
    await _add_runtime(db_session, user_id, provider="claude", heartbeat_offset=5)
    await _add_runtime(db_session, user_id, provider="hermes", heartbeat_offset=15)

    warnings = _patch_log(monkeypatch)
    svc = RunPlacementService(db_session)
    row = await svc._get_online_runtime(user_id, provider=None)

    assert row is not None
    assert row["provider"] == "claude"  # smallest offset = most recent
    assert not any(w["event"] == "placement_provider_fallback" for w in warnings)
