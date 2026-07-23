"""HTTP-level tests for the task router."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "changes"
TASK_FIXTURES = Path(__file__).parent / "fixtures" / "change-with-tasks"


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_tasks(
    client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn
) -> dict:
    """Create a workspace with components, a change, and task fixtures.

    2026-07-10-remove-server-local-workspace-mode: backend 读不到 client
    root_path，fixture 必须落到服务器 spec_root（扁平布局）才能 reparse。
    """
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)

    # Create workspace first
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "task-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # COMPONENT_FIXTURES（包裹式）展平到 spec_root
    spec_root = seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
    # CHANGE_FIXTURES 覆盖到 spec_root/changes/
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)
    # Add tasks under demo-feature change
    demo_feature = changes_root / "2026-05-25-demo-feature"
    shutil.copytree(TASK_FIXTURES / "tasks", demo_feature / "tasks", dirs_exist_ok=True)

    # Reparse changes to populate DB
    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # Get change ID
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")

    return {"ws_id": ws_id, "change_id": demo["id"]}


async def test_list_empty_before_reparse(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    """Tasks are not auto-parsed when changes are parsed."""
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_reparse_creates_tasks(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stats"]["created"] == 3
    assert body["stats"]["parsed"] == 3


async def test_list_after_reparse(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    keys = {i["task_key"] for i in body["items"]}
    assert keys == {"task-01", "task-02", "task-03"}


async def test_list_filter_by_status(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        params={"status": "in_progress"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["task_key"] == "task-01"


async def test_get_task_detail(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    # Get list to find task ID
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    t01 = next(i for i in list_resp.json()["items"] if i["task_key"] == "task-01")

    resp = await client.get(
        f"/api/workspaces/{ws_id}/tasks/{t01['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Setup project scaffold"
    assert body["status"] == "in_progress"
    assert body["priority"] == "P0"
    assert body["owner_key"] == "admin"
    assert body["estimated_hours"] == 8.0
    assert "platform-api" in body["affected_components"]
    assert body["depends_on"] == []
    assert "task-02" in body["blocks"]
    assert body["content"] is not None
    assert "Setup project scaffold" in body["content"]


async def test_get_task_board(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/board",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    col_map = {c["status"]: c for c in body["columns"]}
    assert col_map["in_progress"]["count"] == 1
    assert col_map["draft"]["count"] == 2
    assert col_map["done"]["count"] == 0


async def test_cross_workspace_isolation(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/00000000-0000-0000-0000-000000000000/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_no_auth_returns_401(client, workspace_with_tasks: dict) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/changes/{change_id}/tasks")
    assert resp.status_code == 401


async def test_reparse_idempotent(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    resp1 = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )
    assert resp1.status_code == 200

    resp2 = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )
    assert resp2.status_code == 200

    assert resp2.json()["stats"]["created"] == 0
    assert resp2.json()["stats"]["updated"] == 3


# ── M:N workspace_ids tests (task-03) ──────────────────────────────────────


async def test_list_tasks_contains_workspace_ids(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    """Test-05: reparse 后 task 的 workspace_ids 包含主 workspace。"""
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    for item in body["items"]:
        assert isinstance(item["workspace_ids"], list)
        assert len(item["workspace_ids"]) > 0
        assert item["workspace_ids"][0] == ws_id


async def test_get_task_detail_contains_workspace_ids(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    """Test-06: task get detail 包含 workspace_ids。"""
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks",
        headers=auth_headers,
    )
    t01 = next(i for i in list_resp.json()["items"] if i["task_key"] == "task-01")

    resp = await client.get(
        f"/api/workspaces/{ws_id}/tasks/{t01['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["workspace_ids"], list)
    assert ws_id in body["workspace_ids"]


async def test_task_board_contains_workspace_ids(
    client, workspace_with_tasks: dict, auth_headers: dict[str, str]
) -> None:
    """Test-07: task board 中所有 task item 含 workspace_ids。"""
    ws_id = workspace_with_tasks["ws_id"]
    change_id = workspace_with_tasks["change_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/tasks/board",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    for column in body["columns"]:
        for item in column["items"]:
            assert isinstance(item["workspace_ids"], list)
            assert len(item["workspace_ids"]) > 0
