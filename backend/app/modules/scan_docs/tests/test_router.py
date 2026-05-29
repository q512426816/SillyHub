"""HTTP-level tests for the scan docs router."""

from __future__ import annotations

from pathlib import Path

import pytest


def _make_sillyspec_workspace(tmp_path: Path, name: str = "ws") -> Path:
    """Create a minimal sillyspec workspace structure."""
    base = tmp_path / name
    sillyspec = base / ".sillyspec"
    (sillyspec / "projects").mkdir(parents=True)
    (sillyspec / "changes" / "change").mkdir(parents=True)
    (sillyspec / "changes" / "archive").mkdir(parents=True)
    return base


@pytest.fixture()
async def workspace_for_scan_docs(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """Create a workspace suitable for scan docs testing."""
    root = _make_sillyspec_workspace(tmp_path)

    # Create workspace
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "scan-docs-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    return {"ws_id": ws_id}


async def test_list_empty_before_reparse(
    client, workspace_for_scan_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_reparse_returns_ok(
    client, workspace_for_scan_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text


async def test_no_auth_returns_401(client, workspace_for_scan_docs: dict) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/scan-docs",
    )
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 404
