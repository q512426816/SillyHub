"""Unit tests for AgentSession model and AgentRun.agent_session_id field.

Covers FR-01 (session table) / D-001@v1 (naming) / D-005@v1 (session<->run FK).
Pure Python assertions on SQLModel field metadata — no DB required.
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.agent.model import AgentRun, AgentSession

# ── AgentSession table contract ──────────────────────────────────────────────


def test_agent_session_tablename() -> None:
    assert AgentSession.__tablename__ == "agent_sessions"


def test_agent_session_has_all_16_fields() -> None:
    expected = {
        "id",
        "user_id",
        "runtime_id",
        "lease_id",
        "change_id",
        "workspace_id",
        "provider",
        "status",
        "agent_session_id",
        "config",
        "turn_count",
        "cwd",
        "created_at",
        "last_active_at",
        "ended_at",
        "deleted_at",  # 2026-07-11-unify-runtime-session-dialog / D-003 软删
    }
    actual = set(AgentSession.model_fields.keys())
    assert actual == expected, (
        f"AgentSession field mismatch. missing={expected - actual}, extra={actual - expected}"
    )
    assert len(AgentSession.model_fields) == 16


def test_agent_session_defaults() -> None:
    """Defaults per design.md §5.1 when only required fields are given."""
    user_id = uuid.uuid4()
    session = AgentSession(user_id=user_id, provider="claude")
    assert session.status == "pending"
    assert session.turn_count == 0
    assert session.agent_session_id is None
    assert session.lease_id is None
    assert session.runtime_id is None
    assert session.config is None
    assert session.cwd is None
    assert session.last_active_at is None
    assert session.ended_at is None
    assert session.provider == "claude"
    assert session.user_id == user_id


def test_agent_session_id_is_string_255_nullable() -> None:
    """agent_session_id (SDK session_id) is String(255) nullable — D-001@v1.

    Distinct from AgentRun.session_id (claude resume, String(128)).
    """
    sa_column = AgentSession.model_fields["agent_session_id"].sa_column
    assert sa_column.nullable is True
    # String(255)
    assert sa_column.type.length == 255


def test_agent_session_id_distinct_from_run_session_id() -> None:
    """D-001@v1 gatekeeper: agent_session_id and session_id are different fields."""
    run_fields = set(AgentRun.model_fields.keys())
    assert "agent_session_id" in run_fields
    assert "session_id" in run_fields
    # Session model's SDK id field name must also exist independently
    assert "agent_session_id" in AgentSession.model_fields


# ── AgentRun.agent_session_id FK field ───────────────────────────────────────


def test_agent_run_has_agent_session_id_nullable_uuid_fk() -> None:
    """D-005@v1: agent_runs.agent_session_id -> agent_sessions.id, SET NULL."""
    field = AgentRun.model_fields["agent_session_id"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.nullable is True
    # FK pointing at agent_sessions.id
    fks = list(sa_column.foreign_keys)
    assert len(fks) == 1, f"expected 1 FK on agent_session_id, got {len(fks)}"
    fk = fks[0]
    assert fk.column.table.name == "agent_sessions"
    assert fk.column.name == "id"
    assert fk.ondelete == "SET NULL"


def test_agent_run_session_id_preserved() -> None:
    """D-001@v1 gatekeeper: AgentRun.session_id (claude resume) NOT removed/renamed."""
    field = AgentRun.model_fields["session_id"]
    assert field is not None
    sa_column = field.sa_column
    # Existing contract: String(128), nullable, no FK
    assert sa_column.type.length == 128
    assert sa_column.nullable is True
    assert list(sa_column.foreign_keys) == []


# ── AgentSession indexes ─────────────────────────────────────────────────────


def test_agent_session_indexes_present() -> None:
    table = AgentSession.__table__
    index_names = {idx.name for idx in table.indexes}
    for name in (
        "ix_agent_sessions_user_id",
        "ix_agent_sessions_runtime_id",
        "ix_agent_sessions_status",
        "ix_agent_sessions_lease_id",
        "ix_agent_sessions_change_id",
    ):
        assert name in index_names, f"missing index {name}"


def test_agent_run_agent_session_id_index_present() -> None:
    table = AgentRun.__table__
    index_names = {idx.name for idx in table.indexes}
    assert "ix_agent_runs_agent_session_id" in index_names


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
