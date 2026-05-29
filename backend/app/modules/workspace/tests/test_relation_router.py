"""HTTP-level tests for workspace relation CRUD + topology endpoints."""

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


async def _create_workspace(
    client: AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    name: str,
) -> dict:
    """Helper to create a workspace and return its JSON body."""
    ws_root = _make_workspace(tmp_path, name)
    resp = await client.post(
        "/api/workspaces",
        json={"name": name, "root_path": str(ws_root)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Test 1: Create relation success ──────────────────────────────────────────


async def test_create_relation_success(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")

    resp = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={
            "target_id": ws_b["id"],
            "relation_type": "depends_on",
            "description": "A depends on B",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["source_id"] == ws_a["id"]
    assert body["target_id"] == ws_b["id"]
    assert body["relation_type"] == "depends_on"
    assert body["description"] == "A depends on B"


# ── Test 2: Create duplicate relation returns 409 ────────────────────────────


async def test_create_duplicate_relation_returns_409(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")

    payload = {
        "target_id": ws_b["id"],
        "relation_type": "depends_on",
    }
    resp1 = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json=payload,
        headers=auth_headers,
    )
    assert resp1.status_code == 201

    resp2 = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json=payload,
        headers=auth_headers,
    )
    assert resp2.status_code == 409
    assert resp2.json()["code"] == "HTTP_409_RELATION_DUPLICATE"


# ── Test 3: Create self-loop returns 400 ─────────────────────────────────────


async def test_create_self_loop_returns_400(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")

    resp = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={
            "target_id": ws_a["id"],
            "relation_type": "depends_on",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "HTTP_400_RELATION_SELF_LOOP"


# ── Test 4: Create relation target not found returns 404 ─────────────────────


async def test_create_relation_target_not_found(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")

    resp = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={
            "target_id": "00000000-0000-0000-0000-000000000000",
            "relation_type": "depends_on",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404_WORKSPACE_NOT_FOUND"


# ── Test 5: Create relation source not found returns 404 ─────────────────────


async def test_create_relation_source_not_found(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/relations",
        json={
            "target_id": "00000000-0000-0000-0000-000000000001",
            "relation_type": "depends_on",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404_WORKSPACE_NOT_FOUND"


# ── Test 6: List relations includes outgoing and incoming ────────────────────


async def test_list_relations_outgoing_and_incoming(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")
    ws_c = await _create_workspace(client, auth_headers, tmp_path, "workspace-c")

    # A -> B (depends_on)
    await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    # C -> A (consumes_api_from)
    await client.post(
        f"/api/workspaces/{ws_c['id']}/relations",
        json={"target_id": ws_a["id"], "relation_type": "consumes_api_from"},
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_a['id']}/relations",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["outgoing"]) == 1
    assert body["outgoing"][0]["target_id"] == ws_b["id"]
    assert len(body["incoming"]) == 1
    assert body["incoming"][0]["source_id"] == ws_c["id"]


# ── Test 7: Delete relation success ──────────────────────────────────────────


async def test_delete_relation_success(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")

    create_resp = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    relation_id = create_resp.json()["id"]

    del_resp = await client.delete(
        f"/api/workspaces/relations/{relation_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["id"] == relation_id

    # Verify relation is gone
    list_resp = await client.get(
        f"/api/workspaces/{ws_a['id']}/relations",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["outgoing"]) == 0


# ── Test 8: Delete non-existent relation returns 404 ─────────────────────────


async def test_delete_nonexistent_relation_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    resp = await client.delete(
        "/api/workspaces/relations/00000000-0000-0000-0000-000000000000",
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404_RELATION_NOT_FOUND"


# ── Test 9: Topology returns global graph ────────────────────────────────────


async def test_topology_returns_global_graph(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")
    ws_c = await _create_workspace(client, auth_headers, tmp_path, "workspace-c")

    # A -> B (depends_on)
    await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    # B -> C (tests)
    await client.post(
        f"/api/workspaces/{ws_b['id']}/relations",
        json={"target_id": ws_c["id"], "relation_type": "tests"},
        headers=auth_headers,
    )

    resp = await client.get(
        "/api/workspaces/topology",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["nodes"]) >= 3
    assert len(body["edges"]) >= 2

    edge_types = {
        (e["source_id"], e["target_id"]): e["relation_type"] for e in body["edges"]
    }
    assert (ws_a["id"], ws_b["id"]) in edge_types
    assert edge_types[(ws_a["id"], ws_b["id"])] == "depends_on"
    assert (ws_b["id"], ws_c["id"]) in edge_types
    assert edge_types[(ws_b["id"], ws_c["id"])] == "tests"


# ── Test 10: Topology excludes soft-deleted workspaces ────────────────────────


async def test_topology_excludes_deleted_workspaces(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")
    ws_c = await _create_workspace(client, auth_headers, tmp_path, "workspace-c")

    # A -> B (depends_on)
    await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )

    # Soft-delete B
    await client.delete(
        f"/api/workspaces/{ws_b['id']}",
        headers=auth_headers,
    )

    resp = await client.get(
        "/api/workspaces/topology",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()

    node_ids = [n["id"] for n in body["nodes"]]
    assert ws_b["id"] not in node_ids
    # Edges involving B should also be excluded
    for edge in body["edges"]:
        assert ws_b["id"] not in (edge["source_id"], edge["target_id"])


# ── Test 11: List relations for workspace with no relations ──────────────────


async def test_list_relations_empty(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")

    resp = await client.get(
        f"/api/workspaces/{ws_a['id']}/relations",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["outgoing"] == []
    assert body["incoming"] == []


# ── Test 12: Same pair different relation types coexist ───────────────────────


async def test_same_pair_different_types_coexist(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")

    resp1 = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    assert resp1.status_code == 201

    resp2 = await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "consumes_api_from"},
        headers=auth_headers,
    )
    assert resp2.status_code == 201

    list_resp = await client.get(
        f"/api/workspaces/{ws_a['id']}/relations",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["outgoing"]) == 2


# ── Test 13-16: No-auth tests ─────────────────────────────────────────────────


async def test_no_auth_create_relation_returns_401(
    client: AsyncClient, tmp_path: Path
) -> None:
    """POST /api/workspaces/{id}/relations without Authorization returns 401."""
    resp = await client.post(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/relations",
        json={"target_id": "00000000-0000-0000-0000-000000000001", "relation_type": "depends_on"},
    )
    assert resp.status_code == 401


async def test_no_auth_list_relations_returns_401(
    client: AsyncClient, tmp_path: Path
) -> None:
    """GET /api/workspaces/{id}/relations without Authorization returns 401."""
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/relations",
    )
    assert resp.status_code == 401


async def test_no_auth_delete_relation_returns_401(
    client: AsyncClient,
) -> None:
    """DELETE /api/workspaces/relations/{id} without Authorization returns 401."""
    resp = await client.delete(
        "/api/workspaces/relations/00000000-0000-0000-0000-000000000000",
    )
    assert resp.status_code == 401


async def test_no_auth_topology_returns_401(
    client: AsyncClient,
) -> None:
    """GET /api/workspaces/topology without Authorization returns 401."""
    resp = await client.get("/api/workspaces/topology")
    assert resp.status_code == 401


# ── Test 17-18: Cycle tests via HTTP ──────────────────────────────────────────


async def test_cycle_two_nodes_via_http(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """A->B and B->A cycle through HTTP, topology returns 2 edges."""
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")

    await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    await client.post(
        f"/api/workspaces/{ws_b['id']}/relations",
        json={"target_id": ws_a["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )

    resp = await client.get("/api/workspaces/topology", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    cycle_edges = [
        e for e in body["edges"]
        if (e["source_id"] == ws_a["id"] and e["target_id"] == ws_b["id"])
        or (e["source_id"] == ws_b["id"] and e["target_id"] == ws_a["id"])
    ]
    assert len(cycle_edges) == 2


async def test_cycle_three_nodes_via_http(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """A->B, B->C, C->A cycle through HTTP, topology returns 3 nodes + 3 edges."""
    ws_a = await _create_workspace(client, auth_headers, tmp_path, "workspace-a")
    ws_b = await _create_workspace(client, auth_headers, tmp_path, "workspace-b")
    ws_c = await _create_workspace(client, auth_headers, tmp_path, "workspace-c")

    await client.post(
        f"/api/workspaces/{ws_a['id']}/relations",
        json={"target_id": ws_b["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    await client.post(
        f"/api/workspaces/{ws_b['id']}/relations",
        json={"target_id": ws_c["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )
    await client.post(
        f"/api/workspaces/{ws_c['id']}/relations",
        json={"target_id": ws_a["id"], "relation_type": "depends_on"},
        headers=auth_headers,
    )

    resp = await client.get("/api/workspaces/topology", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    node_ids = {n["id"] for n in body["nodes"]}
    assert ws_a["id"] in node_ids
    assert ws_b["id"] in node_ids
    assert ws_c["id"] in node_ids
    assert len(body["edges"]) >= 3
