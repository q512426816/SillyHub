"""HTTP-level tests for the knowledge / quicklog router."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_knowledge(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    knowledge_dir = root / ".sillyspec" / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "INDEX.md").write_text(
        "# Knowledge Index\n\n> Reference document.\n",
        encoding="utf-8",
    )
    (knowledge_dir / "uncategorized.md").write_text(
        "# Uncategorized\n\nSome uncategorized knowledge.\n",
        encoding="utf-8",
    )

    quicklog_dir = root / ".sillyspec" / "quicklog"
    quicklog_dir.mkdir(parents=True, exist_ok=True)
    (quicklog_dir / "2026-01-15.md").write_text(
        "# Quicklog 2026-01-15\n\n- Fixed bug X\n- Added feature Y\n",
        encoding="utf-8",
    )

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "knowledge-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    return {"ws_id": ws_resp.json()["id"]}


async def test_list_knowledge(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    filenames = [item["filename"] for item in body["items"]]
    assert "INDEX.md" in filenames
    assert "uncategorized.md" in filenames


async def test_get_knowledge_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/INDEX.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "INDEX.md"
    assert body["title"] == "Knowledge Index"
    assert body["content"] is not None
    assert "Reference document" in body["content"]


async def test_get_knowledge_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_list_knowledge_no_content_in_list(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    body = resp.json()
    for item in body["items"]:
        assert item["content"] is None


async def test_list_quicklog(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["filename"] == "2026-01-15.md"


async def test_get_quicklog_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/2026-01-15.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Quicklog 2026-01-15"
    assert "Fixed bug X" in body["content"]


async def test_get_quicklog_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_knowledge_no_auth_returns_401(
    client, workspace_with_knowledge: dict
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/knowledge")
    assert resp.status_code == 401


async def test_quicklog_no_auth_returns_401(
    client, workspace_with_knowledge: dict
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/quicklog")
    assert resp.status_code == 401


async def test_unknown_workspace_knowledge_returns_404(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_empty_knowledge_directory(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "empty-k")
    knowledge_dir = root / ".sillyspec" / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "empty-k", "root_path": str(root)},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
