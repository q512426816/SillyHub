"""TopologyBuilder tests — verifies global topology graph construction."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.model import Workspace, WorkspaceRelation
from app.modules.workspace.topology import TopologyBuilder


async def _create_workspace(
    session: AsyncSession,
    name: str,
    *,
    component_key: str | None = None,
    status: str = "active",
    deleted_at: datetime | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=f"/{name.lower()}",
        status=status,
        component_key=component_key,
        deleted_at=deleted_at,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_relation(
    session: AsyncSession,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    relation_type: str = "depends_on",
    description: str | None = None,
) -> WorkspaceRelation:
    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=source_id,
        target_id=target_id,
        relation_type=relation_type,
        description=description,
    )
    session.add(rel)
    await session.commit()
    await session.refresh(rel)
    return rel


async def test_topology_empty_graph(db_session: AsyncSession) -> None:
    """No workspaces, no relations -> empty nodes and edges."""
    result = await TopologyBuilder.build(db_session)
    assert result.nodes == []
    assert result.edges == []


async def test_topology_only_workspaces(db_session: AsyncSession) -> None:
    """3 workspaces with no relations -> 3 nodes, 0 edges."""
    await _create_workspace(db_session, "Alpha")
    await _create_workspace(db_session, "Bravo")
    await _create_workspace(db_session, "Charlie")

    result = await TopologyBuilder.build(db_session)
    assert len(result.nodes) == 3
    assert result.edges == []


async def test_topology_with_relations(db_session: AsyncSession) -> None:
    """A->B, B->C -> 3 nodes, 2 edges with correct fields."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    await _create_relation(db_session, ws_a.id, ws_b.id, "depends_on", "A needs B")
    await _create_relation(db_session, ws_b.id, ws_c.id, "tests", "B tests C")

    result = await TopologyBuilder.build(db_session)
    assert len(result.nodes) == 3
    assert len(result.edges) == 2

    edge_map = {(e.source_id, e.target_id): e for e in result.edges}
    ab = edge_map.get((ws_a.id, ws_b.id))
    assert ab is not None
    assert ab.relation_type == "depends_on"
    assert ab.description == "A needs B"
    assert ab.id is not None

    bc = edge_map.get((ws_b.id, ws_c.id))
    assert bc is not None
    assert bc.relation_type == "tests"


async def test_topology_excludes_soft_deleted(db_session: AsyncSession) -> None:
    """Soft-deleted workspace not in nodes; its edges filtered out."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(
        db_session, "Bravo", status="deleted", deleted_at=datetime.now(UTC)
    )
    ws_c = await _create_workspace(db_session, "Charlie")

    # A->B edge should be excluded because B is deleted
    await _create_relation(db_session, ws_a.id, ws_b.id, "depends_on")
    # B->C edge should also be excluded (source is deleted)
    await _create_relation(db_session, ws_b.id, ws_c.id, "depends_on")

    result = await TopologyBuilder.build(db_session)
    node_ids = {n.id for n in result.nodes}
    assert ws_b.id not in node_ids
    assert ws_a.id in node_ids
    assert ws_c.id in node_ids

    # Edges involving B must be absent
    for edge in result.edges:
        assert ws_b.id not in (edge.source_id, edge.target_id)


async def test_topology_node_fields(db_session: AsyncSession) -> None:
    """TopologyNode contains id, name, slug, component_key."""
    ws = await _create_workspace(db_session, "My Service", component_key="my-svc")
    result = await TopologyBuilder.build(db_session)
    assert len(result.nodes) == 1
    node = result.nodes[0]
    assert node.id == ws.id
    assert node.name == "My Service"
    assert node.slug == "my-service"
    assert node.component_key == "my-svc"


async def test_topology_multiple_relation_types(db_session: AsyncSession) -> None:
    """Edges contain various relation_type values."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    await _create_relation(db_session, ws_a.id, ws_b.id, "depends_on")
    await _create_relation(db_session, ws_a.id, ws_b.id, "consumes_api_from")
    await _create_relation(db_session, ws_c.id, ws_a.id, "tests")

    result = await TopologyBuilder.build(db_session)
    assert len(result.nodes) == 3
    assert len(result.edges) == 3
    edge_types = {e.relation_type for e in result.edges}
    assert edge_types == {"depends_on", "consumes_api_from", "tests"}
