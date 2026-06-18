"""Unit tests for DaemonTaskLease.kind field (D-002@v3, FR-09).

Covers batch/interactive isolation gatekeeper field. Pure Python assertions
on SQLModel field metadata — no DB required.
"""

from __future__ import annotations

import pytest

from app.modules.daemon.model import DaemonTaskLease


def test_lease_has_kind_field() -> None:
    assert "kind" in DaemonTaskLease.model_fields


def test_lease_kind_default_is_batch() -> None:
    lease = DaemonTaskLease()
    assert lease.kind == "batch"


def test_lease_kind_can_be_interactive() -> None:
    lease = DaemonTaskLease(kind="interactive")
    assert lease.kind == "interactive"


def test_lease_kind_column_contract() -> None:
    """kind: String(20), NOT NULL, server_default='batch' (FR-09 / D-002@v3)."""
    field = DaemonTaskLease.model_fields["kind"]
    assert field.default == "batch"
    sa_column = field.sa_column
    assert sa_column.type.length == 20
    assert sa_column.nullable is False
    # server_default present so brownfield add_column NOT NULL succeeds
    assert sa_column.server_default is not None


def test_existing_lease_fields_unchanged() -> None:
    """FR-09 gatekeeper: existing batch lease fields all still present."""
    fields = set(DaemonTaskLease.model_fields.keys())
    for required in (
        "id",
        "runtime_id",
        "agent_run_id",
        "status",
        "claimed_at",
        "lease_expires_at",
        "attempt_number",
        "metadata_",
        "created_at",
        "updated_at",
    ):
        assert required in fields, f"existing field {required} must still exist"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
