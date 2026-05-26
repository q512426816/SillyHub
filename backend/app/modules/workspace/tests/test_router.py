"""HTTP-level tests for the workspace router."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient


def _make_workspace(tmp_path: Path, name: str = "workspace") -> Path:
    base = tmp_path / name / ".sillyspec"
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    return tmp_path / name


@pytest.fixture()
def workspace_root(tmp_path: Path) -> Path:
    return _make_workspace(tmp_path)


async def test_scan_endpoint_minimal_fixture(client: AsyncClient) -> None:
    fixture = Path(__file__).parent / "fixtures" / "minimal-sillyspec"
    resp = await client.post("/api/workspaces/scan", json={"root_path": str(fixture)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_sillyspec"] is True
    assert body["warnings"] == []


async def test_scan_endpoint_path_not_found(client: AsyncClient, tmp_path: Path) -> None:
    resp = await client.post("/api/workspaces/scan", json={"root_path": str(tmp_path / "no-such")})
    assert resp.status_code == 400
    assert resp.json()["code"] == "HTTP_400_WORKSPACE_PATH_NOT_FOUND"


async def test_scan_endpoint_returns_no_sillyspec_for_plain_dir(
    client: AsyncClient, tmp_path: Path
) -> None:
    resp = await client.post("/api/workspaces/scan", json={"root_path": str(tmp_path)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_sillyspec"] is False
    assert "no_sillyspec_dir" in body["warnings"]


async def test_create_then_list(client: AsyncClient, workspace_root: Path) -> None:
    create = await client.post(
        "/api/workspaces",
        json={"name": "Test Space", "root_path": str(workspace_root)},
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["slug"] == "test-space"
    assert created["status"] == "active"

    listing = await client.get("/api/workspaces")
    assert listing.status_code == 200
    payload = listing.json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == created["id"]


async def test_create_duplicate_returns_409(client: AsyncClient, workspace_root: Path) -> None:
    first = await client.post(
        "/api/workspaces",
        json={"name": "A", "root_path": str(workspace_root)},
    )
    assert first.status_code == 201
    second = await client.post(
        "/api/workspaces",
        json={"name": "B", "root_path": str(workspace_root)},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "HTTP_409_WORKSPACE_PATH_DUPLICATE"


async def test_rescan_updates_last_scanned_at(client: AsyncClient, workspace_root: Path) -> None:
    create = await client.post(
        "/api/workspaces",
        json={"name": "Rescan Target", "root_path": str(workspace_root)},
    )
    workspace_id = create.json()["id"]
    original_ts = create.json()["last_scanned_at"]
    assert original_ts is not None

    rescan = await client.post(f"/api/workspaces/{workspace_id}/rescan")
    assert rescan.status_code == 200
    body = rescan.json()
    assert body["is_sillyspec"] is True

    detail = await client.get(f"/api/workspaces/{workspace_id}")
    assert detail.status_code == 200
    assert detail.json()["last_scanned_at"] >= original_ts


async def test_soft_delete_hides_from_default_list(
    client: AsyncClient, workspace_root: Path
) -> None:
    create = await client.post(
        "/api/workspaces",
        json={"name": "Doomed", "root_path": str(workspace_root)},
    )
    workspace_id = create.json()["id"]

    del_resp = await client.delete(f"/api/workspaces/{workspace_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    default_list = await client.get("/api/workspaces")
    assert default_list.json()["total"] == 0

    admin_list = await client.get("/api/workspaces?include_deleted=true")
    assert admin_list.json()["total"] == 1

    detail = await client.get(f"/api/workspaces/{workspace_id}")
    assert detail.status_code == 404


async def test_create_rejects_non_sillyspec(client: AsyncClient, tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    resp = await client.post(
        "/api/workspaces",
        json={"name": "x", "root_path": str(plain)},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "HTTP_400_WORKSPACE_NOT_SILLYSPEC"


async def test_create_validates_slug_format(client: AsyncClient, workspace_root: Path) -> None:
    resp = await client.post(
        "/api/workspaces",
        json={"name": "x", "slug": "Bad Slug!", "root_path": str(workspace_root)},
    )
    assert resp.status_code == 422
