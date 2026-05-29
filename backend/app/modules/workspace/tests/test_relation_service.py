"""RelationService CRUD + cycle tests — direct DB layer, no HTTP."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    RelationDuplicate,
    RelationNotFound,
    RelationSelfLoop,
    WorkspaceNotFound,
)
from app.modules.workspace.model import Workspace, WorkspaceRelation
from app.modules.workspace.relation_schema import RelationCreate
from app.modules.workspace.relation_service import RelationService


async def _create_workspace(
    session: AsyncSession, name: str, root_path: str | None = None
) -> Workspace:
    """Create a Workspace row directly in DB (skip filesystem validation)."""
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=root_path or f"/{name.lower()}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


# ── CRUD tests ──────────────────────────────────────────────────────────────


async def test_create_relation_success(db_session: AsyncSession) -> None:
    """Create relation A->B and verify returned fields."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    payload = RelationCreate(
        target_id=ws_b.id, relation_type="depends_on", description="A needs B"
    )
    rel = await svc.create(ws_a.id, payload)

    assert rel.source_id == ws_a.id
    assert rel.target_id == ws_b.id
    assert rel.relation_type == "depends_on"
    assert rel.description == "A needs B"


async def test_create_self_loop_raises(db_session: AsyncSession) -> None:
    """source_id == target_id raises RelationSelfLoop."""
    ws_a = await _create_workspace(db_session, "Alpha")
    svc = RelationService(db_session)
    payload = RelationCreate(target_id=ws_a.id, relation_type="depends_on")

    with pytest.raises(RelationSelfLoop):
        await svc.create(ws_a.id, payload)


async def test_create_duplicate_raises(db_session: AsyncSession) -> None:
    """Same (source, target, type) triplet raises RelationDuplicate on 2nd call."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    payload = RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    await svc.create(ws_a.id, payload)

    with pytest.raises(RelationDuplicate):
        await svc.create(ws_a.id, payload)


async def test_create_with_nonexistent_source_raises(
    db_session: AsyncSession,
) -> None:
    """Source workspace does not exist -> WorkspaceNotFound."""
    svc = RelationService(db_session)
    payload = RelationCreate(
        target_id=uuid.uuid4(), relation_type="depends_on"
    )
    with pytest.raises(WorkspaceNotFound):
        await svc.create(uuid.uuid4(), payload)


async def test_create_with_nonexistent_target_raises(
    db_session: AsyncSession,
) -> None:
    """Target workspace does not exist -> WorkspaceNotFound."""
    ws_a = await _create_workspace(db_session, "Alpha")
    svc = RelationService(db_session)
    payload = RelationCreate(
        target_id=uuid.uuid4(), relation_type="depends_on"
    )
    with pytest.raises(WorkspaceNotFound):
        await svc.create(ws_a.id, payload)


async def test_list_for_workspace_outgoing(db_session: AsyncSession) -> None:
    """A->B, A->C: outgoing=2, incoming=0."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    svc = RelationService(db_session)
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_c.id, relation_type="depends_on")
    )

    result = await svc.list_for_workspace(ws_a.id)
    assert len(result.outgoing) == 2
    assert len(result.incoming) == 0


async def test_list_for_workspace_incoming(db_session: AsyncSession) -> None:
    """B->A, C->A: outgoing=0, incoming=2."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    svc = RelationService(db_session)
    await svc.create(
        ws_b.id, RelationCreate(target_id=ws_a.id, relation_type="depends_on")
    )
    await svc.create(
        ws_c.id, RelationCreate(target_id=ws_a.id, relation_type="depends_on")
    )

    result = await svc.list_for_workspace(ws_a.id)
    assert len(result.outgoing) == 0
    assert len(result.incoming) == 2


async def test_list_for_workspace_both_directions(
    db_session: AsyncSession,
) -> None:
    """A->B, C->A: outgoing=1, incoming=1."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    svc = RelationService(db_session)
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )
    await svc.create(
        ws_c.id, RelationCreate(target_id=ws_a.id, relation_type="depends_on")
    )

    result = await svc.list_for_workspace(ws_a.id)
    assert len(result.outgoing) == 1
    assert len(result.incoming) == 1


async def test_list_for_workspace_empty(db_session: AsyncSession) -> None:
    """Workspace with no relations: both lists empty."""
    ws_a = await _create_workspace(db_session, "Alpha")

    svc = RelationService(db_session)
    result = await svc.list_for_workspace(ws_a.id)
    assert result.outgoing == []
    assert result.incoming == []


async def test_delete_relation_success(db_session: AsyncSession) -> None:
    """Delete a relation and verify list is empty afterwards."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    rel = await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )

    deleted = await svc.delete(rel.id)
    assert deleted.id == rel.id

    result = await svc.list_for_workspace(ws_a.id)
    assert result.outgoing == []
    assert result.incoming == []


async def test_delete_nonexistent_raises(db_session: AsyncSession) -> None:
    """Deleting a non-existent relation raises RelationNotFound."""
    svc = RelationService(db_session)
    with pytest.raises(RelationNotFound):
        await svc.delete(uuid.uuid4())


async def test_all_five_relation_types(db_session: AsyncSession) -> None:
    """All 5 valid relation types can be created between same pair."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    for rtype in ("depends_on", "consumes_api_from", "tests", "publishes_to", "documents"):
        await svc.create(
            ws_a.id, RelationCreate(target_id=ws_b.id, relation_type=rtype)
        )

    result = await svc.list_for_workspace(ws_a.id)
    assert len(result.outgoing) == 5
    types = {r.relation_type for r in result.outgoing}
    assert types == {"depends_on", "consumes_api_from", "tests", "publishes_to", "documents"}


# ── Cycle tests ─────────────────────────────────────────────────────────────


async def test_cycle_two_nodes(db_session: AsyncSession) -> None:
    """A->B and B->A (cycle) — verify each node sees both directions."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )
    await svc.create(
        ws_b.id, RelationCreate(target_id=ws_a.id, relation_type="depends_on")
    )

    result_a = await svc.list_for_workspace(ws_a.id)
    assert len(result_a.outgoing) == 1
    assert result_a.outgoing[0].target_id == ws_b.id
    assert len(result_a.incoming) == 1
    assert result_a.incoming[0].source_id == ws_b.id

    result_b = await svc.list_for_workspace(ws_b.id)
    assert len(result_b.outgoing) == 1
    assert result_b.outgoing[0].target_id == ws_a.id
    assert len(result_b.incoming) == 1
    assert result_b.incoming[0].source_id == ws_a.id


async def test_cycle_three_nodes(db_session: AsyncSession) -> None:
    """A->B, B->C, C->A — verify correct outgoing/incoming."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")
    ws_c = await _create_workspace(db_session, "Charlie")

    svc = RelationService(db_session)
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )
    await svc.create(
        ws_b.id, RelationCreate(target_id=ws_c.id, relation_type="depends_on")
    )
    await svc.create(
        ws_c.id, RelationCreate(target_id=ws_a.id, relation_type="depends_on")
    )

    result_a = await svc.list_for_workspace(ws_a.id)
    assert len(result_a.outgoing) == 1
    assert result_a.outgoing[0].target_id == ws_b.id
    assert len(result_a.incoming) == 1
    assert result_a.incoming[0].source_id == ws_c.id


async def test_same_pair_different_types_coexist(db_session: AsyncSession) -> None:
    """A->B (depends_on) + A->B (consumes_api_from) both succeed."""
    ws_a = await _create_workspace(db_session, "Alpha")
    ws_b = await _create_workspace(db_session, "Bravo")

    svc = RelationService(db_session)
    await svc.create(
        ws_a.id, RelationCreate(target_id=ws_b.id, relation_type="depends_on")
    )
    await svc.create(
        ws_a.id,
        RelationCreate(target_id=ws_b.id, relation_type="consumes_api_from"),
    )

    result = await svc.list_for_workspace(ws_a.id)
    assert len(result.outgoing) == 2
