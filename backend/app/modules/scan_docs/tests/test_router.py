"""HTTP-level tests for the scan docs router."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "component" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_docs(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """Create a workspace with components and scan docs, return ids."""
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    # Add scan docs for silly component
    scan_dir = root / ".sillyspec" / "docs" / "silly" / "scan"
    scan_dir.mkdir(parents=True, exist_ok=True)
    (scan_dir / "ARCHITECTURE.md").write_text(
        "# Silly Backend Architecture\n\nFastAPI-based backend service.\n\n```python\napp/main.py\n```\n",
        encoding="utf-8",
    )
    (scan_dir / "STRUCTURE.md").write_text(
        "# Project Structure\n\n```\nsilly/\n├── backend/\n└── deploy/\n```\n",
        encoding="utf-8",
    )

    # Add scan docs for silly-admin-ui component (only CONVENTIONS)
    scan_dir_ui = root / ".sillyspec" / "docs" / "silly-admin-ui" / "scan"
    scan_dir_ui.mkdir(parents=True, exist_ok=True)
    (scan_dir_ui / "CONVENTIONS.md").write_text(
        "# Dev Conventions\n\nUse ruff for formatting.\n",
        encoding="utf-8",
    )

    # Create workspace
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "scan-docs-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # Reparse components first
    comp_resp = await client.post(
        f"/api/workspaces/{ws_id}/components/reparse",
        headers=auth_headers,
    )
    assert comp_resp.status_code == 200, comp_resp.text
    components = comp_resp.json()["components"]
    silly_id = next(c["id"] for c in components if c["component_key"] == "silly")
    admin_ui_id = next(c["id"] for c in components if c["component_key"] == "silly-admin-ui")

    return {"ws_id": ws_id, "silly_id": silly_id, "admin_ui_id": admin_ui_id}


async def test_list_empty_before_reparse(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_reparse_creates_docs(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_docs["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stats"]["created"] > 0


async def test_list_after_reparse(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # 7 standard types for silly: 2 exist + 5 missing
    assert body["total"] == 7
    exists_count = sum(1 for item in body["items"] if item["exists"])
    assert exists_count == 2


async def test_get_single_doc_with_content(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs/ARCHITECTURE",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_type"] == "ARCHITECTURE"
    assert body["title"] == "Silly Backend Architecture"
    assert body["content"] is not None
    assert "FastAPI" in body["content"]
    assert body["exists"] is True


async def test_get_missing_doc_returns_placeholder(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )

    # CONCERNS.md doesn't exist for silly — returns placeholder row
    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs/CONCERNS",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["exists"] is False
    assert body["content"] is None


async def test_cross_component_isolation(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    """AC-08: A component cannot see B component's docs."""
    ws_id = workspace_with_docs["ws_id"]
    admin_ui_id = workspace_with_docs["admin_ui_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )

    # admin-ui has no real ARCHITECTURE doc — returns placeholder (exists=False)
    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{admin_ui_id}/scan-docs/ARCHITECTURE",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    arch_body = resp.json()
    assert arch_body["exists"] is False
    assert arch_body["content"] is None

    # But CONVENTIONS has real content for admin-ui
    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{admin_ui_id}/scan-docs/CONVENTIONS",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Dev Conventions"


async def test_reparse_updates_modified_at(
    client, workspace_with_docs: dict, auth_headers: dict[str, str]
) -> None:
    """AC-06: Reparse updates last_modified_at."""
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]

    resp1 = await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )
    assert resp1.status_code == 200

    await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs/ARCHITECTURE",
        headers=auth_headers,
    )

    resp2 = await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )
    assert resp2.status_code == 200

    doc2_resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs/ARCHITECTURE",
        headers=auth_headers,
    )
    doc2 = doc2_resp.json()

    # last_modified_at should be present after reparse
    assert doc2["last_modified_at"] is not None


async def test_no_auth_returns_401(client, workspace_with_docs: dict) -> None:
    ws_id = workspace_with_docs["ws_id"]
    silly_id = workspace_with_docs["silly_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/components/{silly_id}/scan-docs",
    )
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000"
        "/components/00000000-0000-0000-0000-000000000000/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 404
