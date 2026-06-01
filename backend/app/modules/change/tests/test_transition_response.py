"""Tests for TransitionDispatchResponse and TransitionResponse schemas (task-13)."""

import json


def test_import_transition_schemas():
    """AC-06: schemas can be imported without error."""
    from app.modules.change.schema import (
        TransitionDispatchResponse,
        TransitionResponse,
    )

    assert TransitionDispatchResponse is not None
    assert TransitionResponse is not None


class TestTransitionDispatchResponse:
    """Tests for TransitionDispatchResponse schema."""

    def test_dispatch_success_serialization(self):
        """AC-01: dispatched=True with all fields."""
        from app.modules.change.schema import TransitionDispatchResponse

        resp = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id="abc-123",
            stage="propose",
        )
        data = json.loads(resp.model_dump_json())

        assert data["dispatched"] is True
        assert data["agent_run_id"] == "abc-123"
        assert data["stage"] == "propose"
        assert data["reason"] is None

    def test_dispatch_failure_serialization(self):
        """AC-02: dispatched=False with reason."""
        from app.modules.change.schema import TransitionDispatchResponse

        resp = TransitionDispatchResponse(
            dispatched=False,
            reason="config_disabled",
        )
        data = json.loads(resp.model_dump_json())

        assert data["dispatched"] is False
        assert data["agent_run_id"] is None
        assert data["stage"] is None
        assert data["reason"] == "config_disabled"


class TestTransitionResponse:
    """Tests for TransitionResponse schema."""

    def test_with_dispatch(self):
        """AC-03: TransitionResponse with agent_dispatch."""
        from app.modules.change.schema import (
            TransitionDispatchResponse,
            TransitionResponse,
        )

        resp = TransitionResponse(
            change={"id": "test-id", "status": "active"},
            agent_dispatch=TransitionDispatchResponse(
                dispatched=True,
                agent_run_id="run-1",
                stage="plan",
            ),
        )
        data = json.loads(resp.model_dump_json())

        assert data["change"]["id"] == "test-id"
        assert data["agent_dispatch"]["dispatched"] is True
        assert data["agent_dispatch"]["agent_run_id"] == "run-1"

    def test_without_dispatch(self):
        """AC-04: TransitionResponse with agent_dispatch=None."""
        from app.modules.change.schema import TransitionResponse

        resp = TransitionResponse(
            change={"id": "test-id"},
            agent_dispatch=None,
        )
        data = json.loads(resp.model_dump_json())

        assert data["change"]["id"] == "test-id"
        assert data["agent_dispatch"] is None

    def test_existing_dispatch_response_unchanged(self):
        """AC-05: existing DispatchResponse is not affected."""
        from app.modules.change.schema import DispatchResponse

        resp = DispatchResponse(
            change_id="00000000-0000-0000-0000-000000000001",
            current_stage="propose",
            has_active_run=True,
            config_enabled=True,
        )
        data = json.loads(resp.model_dump_json())

        assert data["change_id"] == "00000000-0000-0000-0000-000000000001"
        assert data["current_stage"] == "propose"
        assert data["has_active_run"] is True
        assert "dispatched" not in data  # DispatchResponse has no 'dispatched'
