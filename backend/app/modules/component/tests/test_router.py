"""HTTP-level tests for the component router.

Drives the FastAPI app end-to-end via the in-memory SQLite fixture from
``conftest.py``. Fixture trees are copied into ``tmp_path`` so each test
has its own root.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "valid"
INVALID_FIXTURE = Path(__file__).parent / "fixtures" / "invalid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_id(client, tmp_path: Path, auth_headers: dict[str, str]) -> str:
    """Register a workspace pointing at the valid fixture and return its id."""
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    resp = await client.post(
        "/api/workspaces",
        json={"name": "valid-fixture", "root_path": str(root)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_list_components_empty_before_reparse(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/components",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"items": [], "total": 0}


async def test_reparse_returns_components_and_relations(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        f"/api/workspaces/{workspace_id}/components/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stats"]["parsed"] == 2
    assert body["stats"]["created"] == 2
    assert body["stats"]["relations_created"] == 1
    assert len(body["components"]) == 2
    assert len(body["relations"]) == 1
    assert body["warnings"] == []
    assert body["errors"] == []


async def test_list_after_reparse_returns_components(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    await client.post(
        f"/api/workspaces/{workspace_id}/components/reparse",
        headers=auth_headers,
    )
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/components",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    keys = sorted(c["component_key"] for c in body["items"])
    assert keys == ["silly", "silly-admin-ui"]


async def test_get_component_returns_full_detail(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    reparse = await client.post(
        f"/api/workspaces/{workspace_id}/components/reparse",
        headers=auth_headers,
    )
    cid = next(c["id"] for c in reparse.json()["components"] if c["component_key"] == "silly")
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/components/{cid}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["component_key"] == "silly"
    assert body["status"] == "active"
    assert body["tech_stack"] == ["Python", "FastAPI", "PostgreSQL"]
    assert body["build_command"] == "uv build"
    assert body["extra"]["commands"] == {"dev": "uv run uvicorn app.main:app --reload"}


async def test_topology_endpoint_shape(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    await client.post(
        f"/api/workspaces/{workspace_id}/components/reparse",
        headers=auth_headers,
    )
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/components/topology",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["nodes"]) == 2
    assert len(body["edges"]) == 1
    edge = body["edges"][0]
    assert edge["relation_type"] == "consumes_api_from"


async def test_reparse_surfaces_warnings_for_invalid_fixture(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(INVALID_FIXTURE, tmp_path)
    create = await client.post(
        "/api/workspaces",
        json={"name": "invalid-fixture", "root_path": str(root)},
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    ws_id = create.json()["id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/components/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    warning_codes = {w["code"] for w in body["warnings"]}
    error_codes = {e["code"] for e in body["errors"]}
    assert "missing_id" in warning_codes
    assert "duplicate_id" in warning_codes
    assert "unknown_relation_target" in warning_codes
    assert "yaml_error" in error_codes


async def test_get_component_404_when_unknown(
    client, workspace_id: str, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/components/00000000-0000-0000-0000-000000000000",
        headers=auth_headers,
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "HTTP_404_COMPONENT_NOT_FOUND"


async def test_components_404_for_unknown_workspace(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/components",
        headers=auth_headers,
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "HTTP_404_WORKSPACE_NOT_FOUND"
