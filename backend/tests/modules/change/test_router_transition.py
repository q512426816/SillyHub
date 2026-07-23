"""Tests for transition endpoint returning TransitionResponse (task-14).

Verifies the transition endpoint returns a properly structured TransitionResponse:
  - dispatch success: agent_dispatch with dispatched=true, agent_run_id, stage
  - dispatch failure: agent_dispatch=null
  - dispatch exception: agent_dispatch=null
  - change field has full change data
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# backend/tests/modules/change/ → parents[3] = backend/
_FIXTURES_BASE = (
    Path(__file__).resolve().parents[3] / "app" / "modules" / "change" / "tests" / "fixtures"
)
COMPONENT_FIXTURES = _FIXTURES_BASE / "valid"
CHANGE_FIXTURES = _FIXTURES_BASE / "changes"


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def ws_with_changes(
    client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn
) -> dict:
    """Create a workspace with change fixtures for API testing.

    2026-07-10-remove-server-local-workspace-mode: fixture 落到服务器 spec_root
    （扁平布局），backend 才能 reparse。
    """
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "transition-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # COMPONENT_FIXTURES（包裹式）展平到 spec_root + CHANGE_FIXTURES 覆盖 changes/
    spec_root = seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)

    # Reparse to create change records
    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    return {"ws_id": ws_id}


async def _get_demo_change_id(client, ws_id, auth_headers):
    """Helper: get the demo-feature change ID."""
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")
    return demo["id"]


# ── Tests ────────────────────────────────────────────────────────────────


class TestTransitionResponseFormat:
    """Verify transition endpoint returns TransitionResponse structure."""

    async def test_dispatch_success_returns_transition_response(
        self, client, ws_with_changes: dict, auth_headers: dict[str, str]
    ):
        """AC-01 & AC-02: dispatch success → agent_dispatch with dispatched=true."""
        ws_id = ws_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        mock_dispatch_result = {
            "dispatched": True,
            "agent_run_id": str(uuid.uuid4()),
            "stage": "plan",
            "phase": "Plan",
        }

        with patch(
            "app.modules.change.dispatch.dispatch",
            new_callable=AsyncMock,
            return_value=mock_dispatch_result,
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()

        # AC-01: response has correct top-level structure
        assert "change" in body
        assert "agent_dispatch" in body

        # AC-02: agent_dispatch has correct fields when dispatched
        dispatch = body["agent_dispatch"]
        assert dispatch is not None
        assert dispatch["dispatched"] is True
        assert dispatch["agent_run_id"] is not None
        assert dispatch["stage"] == "plan"

        # change contains full change data
        assert body["change"]["id"] == change_id
        assert body["change"]["current_stage"] == "plan"

    async def test_dispatch_failure_returns_null_agent_dispatch(
        self, client, ws_with_changes: dict, auth_headers: dict[str, str]
    ):
        """AC-03: dispatch failure (dispatched=False) → agent_dispatch=null."""
        ws_id = ws_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        mock_dispatch_result = {
            "dispatched": False,
            "reason": "no_config_for_stage",
        }

        with patch(
            "app.modules.change.dispatch.dispatch",
            new_callable=AsyncMock,
            return_value=mock_dispatch_result,
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "change" in body
        # dispatched=False → router maps to agent_dispatch=null
        assert body["agent_dispatch"] is None

    async def test_dispatch_exception_returns_null_agent_dispatch(
        self, client, ws_with_changes: dict, auth_headers: dict[str, str]
    ):
        """AC-04: dispatch exception → agent_dispatch=null, transition succeeds."""
        ws_id = ws_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        with patch(
            "app.core.db.get_session_factory",
            side_effect=RuntimeError("DB connection failed"),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "change" in body
        assert body["change"]["current_stage"] == "plan"
        # Dispatch exception → service returns {dispatched: false} → router maps to null
        assert body["agent_dispatch"] is None

    async def test_change_field_has_full_data(
        self, client, ws_with_changes: dict, auth_headers: dict[str, str]
    ):
        """change field contains full ChangeRead data."""
        ws_id = ws_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        with patch(
            "app.core.db.get_session_factory",
            side_effect=RuntimeError("skip dispatch"),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        change = resp.json()["change"]

        # Verify ChangeRead fields present
        assert change["id"] == change_id
        assert change["current_stage"] == "plan"
        assert "change_key" in change
        assert "status" in change
        assert "stages" in change
        assert "created_at" in change
        assert "updated_at" in change

    async def test_other_endpoints_unaffected(
        self, client, ws_with_changes: dict, auth_headers: dict[str, str]
    ):
        """AC-07: other endpoints (agent-status) not affected by TransitionResponse."""
        ws_id = ws_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # agent-status endpoint still returns DispatchResponse
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/agent-status",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["change_id"] == change_id
        assert "has_active_run" in body
        assert "config_enabled" in body
