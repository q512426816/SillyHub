"""HTTP-level tests for the change router."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_changes(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """Create a workspace with components and change fixtures."""
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)

    # Add change fixtures
    sillyspec_changes = root / ".sillyspec" / "changes"
    shutil.copytree(CHANGE_FIXTURES, sillyspec_changes)

    # Create workspace
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "change-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    return {"ws_id": ws_id}


async def test_list_after_auto_reparse(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # create() auto-reparses changes, so they already exist
    assert body["total"] > 0
    assert len(body["items"]) > 0


async def test_reparse_updates_existing_changes(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # create() auto-reparses changes, so second reparse sees updates
    assert body["stats"]["updated"] > 0
    assert body["stats"]["parsed"] > 0


async def test_list_after_reparse(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3  # demo-feature, demo-archived, conflict-status

    # Filter by location
    resp_active = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    assert resp_active.status_code == 200
    assert resp_active.json()["total"] == 2  # demo-feature + conflict-status

    resp_archive = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "archive"},
        headers=auth_headers,
    )
    assert resp_archive.status_code == 200
    assert resp_archive.json()["total"] == 1  # demo-archived


async def test_get_change_detail(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # List to get an ID
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")

    # Get detail
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # Title comes from proposal.md's first heading ("# Proposal"); metadata
    # fields are DB-owned and no longer read from MASTER frontmatter.
    assert body["title"] == "Proposal"
    assert body["status"] == "draft"
    assert body["change_type"] is None
    assert body["location"] == "active"
    assert body["affected_components"] == []


async def test_get_document_matrix(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

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
    demo = next(
        i for i in list_resp.json()["items"] if i["change_key"] == "2026-05-25-demo-feature"
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}/documents",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["change_id"] == demo["id"]
    existing_types = {d["doc_type"] for d in body["documents"] if d["exists"]}
    assert "MASTER" in existing_types
    assert "proposal" in existing_types
    assert "requirements" in existing_types
    assert "design" in existing_types


async def test_get_single_doc_content(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    demo = next(
        i for i in list_resp.json()["items"] if i["change_key"] == "2026-05-25-demo-feature"
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}/documents/proposal",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_type"] == "proposal"
    assert body["exists"] is True
    assert "demo feature" in body["content"].lower()


async def test_get_missing_doc(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    demo = next(
        i for i in list_resp.json()["items"] if i["change_key"] == "2026-05-25-demo-feature"
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}/documents/plan",
        headers=auth_headers,
    )
    assert resp.status_code == 404  # doc exists=False, ChangeDocNotFound


async def test_cross_workspace_isolation(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """AC-08: Changes from one workspace not visible in another."""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # Fake workspace ID
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_no_auth_returns_401(client, workspace_with_changes: dict) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/changes")
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_reparse_idempotent(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    resp1 = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp1.status_code == 200

    resp2 = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp2.status_code == 200

    # Second reparse should have 0 created, all updated
    assert resp2.json()["stats"]["created"] == 0
    assert resp2.json()["stats"]["updated"] > 0


# ── M:N workspace_ids tests (task-03) ──────────────────────────────────────


async def test_list_changes_contains_workspace_ids(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """Test-01: reparse 后 change 的 workspace_ids 包含主 workspace。"""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    for item in body["items"]:
        assert isinstance(item["workspace_ids"], list)
        assert len(item["workspace_ids"]) > 0
        assert item["workspace_ids"][0] == ws_id


async def test_get_change_detail_contains_workspace_ids(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """Test-02: change 的 get detail 包含 workspace_ids。"""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["workspace_ids"], list)
    assert ws_id in body["workspace_ids"]
    assert body["workspace_id"] == ws_id  # backward compat


async def test_workspace_ids_degrades_to_single_when_no_mn(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """Test-03: workspace_ids 在无 M:N 时降级为 [workspace_id]。"""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["workspace_ids"] == [ws_id]


async def test_list_changes_no_duplicate_items(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """Test-04: list 去重 — 同一 change 不重复出现。"""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    ids = [i["id"] for i in body["items"]]
    assert len(ids) == len(set(ids)), "Duplicate change IDs found in list"
    assert body["total"] == len(body["items"])
