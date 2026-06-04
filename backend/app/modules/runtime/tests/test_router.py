"""HTTP-level tests for the runtime router."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


PROGRESS_PAYLOAD = {
    "_version": 2,
    "project": "test-project",
    "currentStage": "execute",
    "currentChange": "change-001",
    "stages": {
        "scan": {
            "status": "completed",
            "steps": [],
            "startedAt": "2026-01-01T00:00:00Z",
            "completedAt": "2026-01-01T00:01:00Z",
        },
        "execute": {
            "status": "in_progress",
            "steps": [{"name": "step-1", "status": "completed"}],
            "startedAt": "2026-01-01T00:02:00Z",
            "completedAt": None,
        },
    },
    "lastActive": "2026-01-01T00:03:00Z",
}


@pytest.fixture()
async def workspace_with_runtime(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "runtime-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # Create progress.json in platform storage (since .runtime is ignored during copy)
    # Platform storage path: C:\data\sillyspec-data\{workspace_id}\.sillyspec\.runtime
    platform_runtime_dir = Path(r"C:\data\sillyspec-data") / ws_id / ".sillyspec" / ".runtime"
    platform_runtime_dir.mkdir(parents=True, exist_ok=True)
    (platform_runtime_dir / "progress.json").write_text(
        json.dumps(PROGRESS_PAYLOAD), encoding="utf-8"
    )

    return {"ws_id": ws_id}


async def test_get_runtime_progress(
    client, workspace_with_runtime: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_runtime["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 2
    assert body["project"] == "test-project"
    assert body["current_stage"] == "execute"
    assert body["current_change"] == "change-001"
    assert "scan" in body["stages"]
    assert body["stages"]["scan"]["status"] == "completed"
    assert "execute" in body["stages"]
    assert body["stages"]["execute"]["status"] == "in_progress"


async def test_get_runtime_missing_file(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "no-runtime")
    runtime_dir = root / ".sillyspec" / ".runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "no-runtime", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() is None


async def test_get_runtime_invalid_json(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "bad-json")
    runtime_dir = root / ".sillyspec" / ".runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "progress.json").write_text("NOT VALID JSON{{{{", encoding="utf-8")

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "bad-json", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() is None


async def test_no_auth_returns_401(client, tmp_path: Path, auth_headers: dict[str, str]) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "auth-test", "root_path": str(root)},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(f"/api/workspaces/{ws_id}/runtime")
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 404
