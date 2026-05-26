"""ComponentService tests — drive reparse / list / get / topology against in-memory SQLite."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from app.core.errors import ComponentNotFound
from app.modules.component.service import ComponentService
from app.modules.workspace.schema import WorkspaceCreate
from app.modules.workspace.service import WorkspaceService

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "valid"
INVALID_FIXTURE = Path(__file__).parent / "fixtures" / "invalid"


def _copy_fixture(src: Path, tmp_path: Path) -> Path:
    """Copy a fixture tree to a tmp location so per-test mutations stay isolated."""
    dst = tmp_path / "ws"
    shutil.copytree(src, dst)
    return dst


async def _make_workspace(session, root: Path, name: str | None = None):
    """Create a workspace under ``root``. ``name`` is derived from the parent
    directory by default so two workspaces co-existing in the same test get
    distinct slugs without manual bookkeeping."""
    if name is None:
        name = f"{root.parent.name}-{root.name}".strip("-") or root.name
    return await WorkspaceService(session).create(
        WorkspaceCreate(name=name, root_path=str(root)),
        created_by=None,
    )


async def test_reparse_creates_components_and_relations(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)

    parse, stats, components, relations = await service.reparse(ws.id)
    assert parse.errors == []
    assert parse.warnings == []
    assert stats["parsed"] == 2
    assert stats["created"] == 2
    assert stats["updated"] == 0
    assert stats["relations_created"] == 1
    assert len(components) == 2
    assert len(relations) == 1
    assert all(c.workspace_id == ws.id for c in components)


async def test_reparse_is_idempotent_via_upsert(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)

    await service.reparse(ws.id)
    _, stats, components, relations = await service.reparse(ws.id)
    assert stats["created"] == 0
    assert stats["updated"] == 2
    assert stats["deleted"] == 0
    assert len(components) == 2
    assert len(relations) == 1


async def test_reparse_drops_removed_yaml_files(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)
    await service.reparse(ws.id)

    (root / ".sillyspec" / "projects" / "silly-admin-ui.yaml").unlink()
    _, stats, components, relations = await service.reparse(ws.id)
    assert stats["deleted"] == 1
    assert stats["parsed"] == 1
    assert {c.component_key for c in components} == {"silly"}
    assert relations == []


async def test_reparse_surfaces_parser_warnings(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(INVALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)

    parse, _, _, _ = await service.reparse(ws.id)
    codes = {i.code for i in parse.warnings}
    error_codes = {i.code for i in parse.errors}
    assert "missing_id" in codes
    assert "duplicate_id" in codes
    assert "unknown_relation_target" in codes
    assert "yaml_error" in error_codes


async def test_list_isolates_workspaces(db_session, tmp_path: Path) -> None:
    root_a = _copy_fixture(VALID_FIXTURE, tmp_path / "a")
    # Move ws b's fixture under a separate tmp subdir so paths don't collide.
    (tmp_path / "b").mkdir()
    root_b = _copy_fixture(VALID_FIXTURE, tmp_path / "b")
    ws_a = await _make_workspace(db_session, root_a)
    ws_b = await _make_workspace(db_session, root_b)

    service = ComponentService(db_session)
    await service.reparse(ws_a.id)
    await service.reparse(ws_b.id)

    items_a, total_a = await service.list_(ws_a.id)
    items_b, total_b = await service.list_(ws_b.id)
    assert total_a == 2
    assert total_b == 2
    a_ids = {c.id for c in items_a}
    b_ids = {c.id for c in items_b}
    assert a_ids.isdisjoint(b_ids), "components must not leak across workspaces"


async def test_get_nonexistent_component_raises(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)
    await service.reparse(ws.id)
    with pytest.raises(ComponentNotFound):
        await service.get(ws.id, uuid.uuid4())


async def test_get_cross_workspace_blocked(db_session, tmp_path: Path) -> None:
    root_a = _copy_fixture(VALID_FIXTURE, tmp_path / "a")
    (tmp_path / "b").mkdir()
    root_b = _copy_fixture(VALID_FIXTURE, tmp_path / "b")
    ws_a = await _make_workspace(db_session, root_a)
    ws_b = await _make_workspace(db_session, root_b)
    service = ComponentService(db_session)
    await service.reparse(ws_a.id)
    items_a, _ = await service.list_(ws_a.id)

    with pytest.raises(ComponentNotFound):
        await service.get(ws_b.id, items_a[0].id)


async def test_topology_returns_nodes_and_edges(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)
    await service.reparse(ws.id)
    components, relations = await service.topology(ws.id)
    assert len(components) == 2
    assert len(relations) == 1


async def test_path_missing_status_persisted(db_session, tmp_path: Path) -> None:
    root = _copy_fixture(VALID_FIXTURE, tmp_path)
    # remove the on-disk dir so silly.yaml's "./silly" path becomes missing
    shutil.rmtree(root / "silly")
    ws = await _make_workspace(db_session, root)
    service = ComponentService(db_session)
    await service.reparse(ws.id)
    items, _ = await service.list_(ws.id)
    silly = next(c for c in items if c.component_key == "silly")
    assert silly.status == "path_missing"
