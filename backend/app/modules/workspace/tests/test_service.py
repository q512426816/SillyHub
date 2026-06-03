"""WorkspaceService tests — exercise scan + persistence against in-memory SQLite."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.core.errors import (
    WorkspaceNotFound,
    WorkspaceNotSillyspec,
    WorkspacePathDuplicate,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspaceSlugDuplicate,
)
from app.modules.workspace.schema import WorkspaceCreate
from app.modules.workspace.service import WorkspaceService


@pytest.fixture()
def fixture_root() -> Path:
    return Path(__file__).parent / "fixtures" / "minimal-sillyspec"


def _make_workspace(tmp_path: Path, name: str = "workspace") -> Path:
    base = tmp_path / name / ".sillyspec"
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    return tmp_path / name


async def test_scan_returns_result_for_minimal_fixture(db_session, fixture_root: Path) -> None:
    service = WorkspaceService(db_session)
    result = service.scan(str(fixture_root))
    assert result.is_sillyspec is True
    assert result.warnings == []


async def test_scan_raises_when_path_missing(db_session, tmp_path: Path) -> None:
    service = WorkspaceService(db_session)
    with pytest.raises(WorkspacePathNotFound):
        service.scan(str(tmp_path / "does-not-exist"))


async def test_scan_raises_when_path_is_file(db_session, tmp_path: Path) -> None:
    f = tmp_path / "a-file.txt"
    f.write_text("hi", encoding="utf-8")
    service = WorkspaceService(db_session)
    with pytest.raises(WorkspacePathNotDir):
        service.scan(str(f))


async def test_create_persists_workspace(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="My Workspace", root_path=str(root)),
        created_by=None,
    )
    assert ws.id is not None
    assert ws.slug == "my-workspace"
    assert ws.root_path == str(root.resolve())
    assert ws.last_scanned_at is not None


async def test_create_fails_when_not_sillyspec(db_session, tmp_path: Path) -> None:
    plain = tmp_path / "no-spec"
    plain.mkdir()
    service = WorkspaceService(db_session)
    with pytest.raises(WorkspaceNotSillyspec):
        await service.create(
            WorkspaceCreate(name="x", root_path=str(plain)),
            created_by=None,
        )


async def test_create_duplicate_root_path(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    await service.create(
        WorkspaceCreate(name="first", root_path=str(root)),
        created_by=None,
    )
    with pytest.raises(WorkspacePathDuplicate):
        await service.create(
            WorkspaceCreate(name="second", root_path=str(root)),
            created_by=None,
        )


async def test_create_duplicate_slug(db_session, tmp_path: Path) -> None:
    root_a = _make_workspace(tmp_path, "a")
    root_b = _make_workspace(tmp_path, "b")
    service = WorkspaceService(db_session)
    await service.create(
        WorkspaceCreate(name="name", slug="same-slug", root_path=str(root_a)),
        created_by=None,
    )
    with pytest.raises(WorkspaceSlugDuplicate):
        await service.create(
            WorkspaceCreate(name="other", slug="same-slug", root_path=str(root_b)),
            created_by=None,
        )


async def test_list_filters_soft_deleted_by_default(db_session, tmp_path: Path) -> None:
    root_a = _make_workspace(tmp_path, "a")
    root_b = _make_workspace(tmp_path, "b")
    service = WorkspaceService(db_session)
    ws_a = await service.create(
        WorkspaceCreate(name="a", root_path=str(root_a)),
        created_by=None,
    )
    await service.create(WorkspaceCreate(name="b", root_path=str(root_b)), created_by=None)
    await service.soft_delete(ws_a.id)

    items, total = await service.list_()
    assert total == 1
    assert all(w.deleted_at is None for w in items)

    _, total_all = await service.list_(include_deleted=True)
    assert total_all == 2


async def test_rescan_updates_timestamp(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="ws", root_path=str(root)),
        created_by=None,
    )
    original = ws.last_scanned_at
    assert original is not None

    rescanned, _ = await service.rescan(ws.id)
    assert rescanned.last_scanned_at is not None
    assert rescanned.last_scanned_at >= original


async def test_get_unknown_workspace_raises(db_session) -> None:
    service = WorkspaceService(db_session)
    with pytest.raises(WorkspaceNotFound):
        await service.get(uuid.uuid4())


async def test_get_soft_deleted_raises(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="x", root_path=str(root)),
        created_by=None,
    )
    await service.soft_delete(ws.id)
    with pytest.raises(WorkspaceNotFound):
        await service.get(ws.id)


async def test_create_resurrects_soft_deleted_workspace(db_session, tmp_path: Path) -> None:
    """Re-registering a path of a soft-deleted workspace revives the row.

    Documented in task-02 AC-04b. Soft-deleting then re-registering must NOT
    raise 409; instead, the original row comes back to life with refreshed
    fields. The primary key is preserved so downstream references survive.
    """
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)

    first = await service.create(
        WorkspaceCreate(name="Original Name", root_path=str(root)),
        created_by=None,
    )
    original_id = first.id
    await service.soft_delete(first.id)

    revived = await service.create(
        WorkspaceCreate(name="New Name", root_path=str(root)),
        created_by=None,
    )

    assert revived.id == original_id, "resurrection must preserve primary key"
    assert revived.deleted_at is None
    assert revived.status == "active"
    assert revived.name == "New Name"
    assert revived.slug == "new-name"

    items, total = await service.list_()
    assert total == 1
    assert items[0].id == original_id


async def test_create_resurrect_conflicts_with_active_slug(db_session, tmp_path: Path) -> None:
    """Resurrecting must respect the *active* unique constraint on slug.

    If another active workspace already holds the slug we want to revive
    with, we must 409 instead of silently corrupting unique invariants.
    """
    root_a = _make_workspace(tmp_path, "a")
    root_b = _make_workspace(tmp_path, "b")
    service = WorkspaceService(db_session)

    ws_a = await service.create(
        WorkspaceCreate(name="A", slug="shared", root_path=str(root_a)),
        created_by=None,
    )
    await service.soft_delete(ws_a.id)

    # Now register B with the slug we want to reuse.
    await service.create(
        WorkspaceCreate(name="B", slug="shared", root_path=str(root_b)),
        created_by=None,
    )

    with pytest.raises(WorkspaceSlugDuplicate):
        await service.create(
            WorkspaceCreate(name="A again", slug="shared", root_path=str(root_a)),
            created_by=None,
        )


# ── task-05: reparse helpers + tests ─────────────────────────────────────────


def _write_yaml(directory: Path, filename: str, content: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    p = directory / filename
    p.write_text(content, encoding="utf-8")
    return p


def _make_workspace_with_projects(tmp_path: Path, name: str = "ws") -> Path:
    """Create a workspace with .sillyspec/projects/ directory."""
    return _make_workspace(tmp_path, name)


async def _create_parent_and_reparse(
    service: WorkspaceService,
    root: Path,
) -> tuple:
    """Helper: create a parent workspace from root, then call reparse.

    Note: ``service.create()`` triggers an implicit reparse via
    ``_ensure_spec_workspace``, so the *second* explicit ``reparse()``
    call will see updates, not creates.  The test assertions are
    written accordingly.
    """
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )
    return await service.reparse(ws.id)


async def test_reparse_creates_child_workspaces(db_session, tmp_path: Path) -> None:
    """reparse creates independent child Workspaces from YAML (AC-04, AC-05)."""
    root = _make_workspace_with_projects(tmp_path)
    projects = root / ".sillyspec" / "projects"

    _write_yaml(
        projects,
        "backend.yaml",
        "id: backend\nname: Backend Service\ntype: service\npath: backend\n"
        "tech_stack:\n  - python\n  - fastapi\ncommands:\n  build: pip install\n"
        "  test: pytest\nrelations:\n  - target: frontend\n    type: consumes_api_from\n",
    )
    _write_yaml(
        projects,
        "frontend.yaml",
        "id: frontend\nname: Frontend App\ntype: frontend\npath: frontend\n"
        "tech_stack:\n  - typescript\n  - react\n",
    )

    service = WorkspaceService(db_session)
    _parse_result, stats, children, relations = await _create_parent_and_reparse(service, root)

    assert stats["parsed"] == 2
    # create() already ran an implicit reparse, so second reparse sees updates
    assert stats["created"] == 0
    assert stats["updated"] == 2

    assert len(children) == 2
    by_key = {c.component_key: c for c in children}
    assert "backend" in by_key
    assert "frontend" in by_key

    be = by_key["backend"]
    assert be.name == "Backend Service"
    assert be.type == "service"
    assert be.tech_stack == ["python", "fastapi"]
    assert be.build_command == "pip install"
    assert be.test_command == "pytest"
    assert be.status == "active"

    fe = by_key["frontend"]
    assert fe.name == "Frontend App"
    assert fe.type == "frontend"
    assert fe.tech_stack == ["typescript", "react"]

    # Relation
    assert stats["relations_created"] == 1
    assert len(relations) == 1
    rel = relations[0]
    assert rel.source_id == by_key["backend"].id
    assert rel.target_id == by_key["frontend"].id
    assert rel.relation_type == "consumes_api_from"


async def test_reparse_updates_existing_children(db_session, tmp_path: Path) -> None:
    """Second reparse updates metadata instead of creating new rows (AC-06)."""
    root = _make_workspace_with_projects(tmp_path)
    projects = root / ".sillyspec" / "projects"

    _write_yaml(projects, "backend.yaml", "id: backend\nname: Backend\ntype: service\n")
    _write_yaml(projects, "frontend.yaml", "id: frontend\nname: Frontend\ntype: frontend\n")

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )

    # First reparse (create() already ran implicit reparse, so this is second)
    _, stats1, _children1, _ = await service.reparse(ws.id)
    assert stats1["created"] == 0
    assert stats1["updated"] == 2

    # Modify YAML content
    _write_yaml(projects, "backend.yaml", "id: backend\nname: Backend V2\ntype: library\n")

    # Second reparse
    _, stats2, children2, _ = await service.reparse(ws.id)
    assert stats2["created"] == 0
    assert stats2["updated"] == 2

    by_key = {c.component_key: c for c in children2}
    assert by_key["backend"].name == "Backend V2"
    assert by_key["backend"].type == "library"


async def test_reparse_soft_deletes_removed_components(db_session, tmp_path: Path) -> None:
    """Removed YAML triggers soft-delete of child Workspace (AC-07)."""
    root = _make_workspace_with_projects(tmp_path)
    projects = root / ".sillyspec" / "projects"

    _write_yaml(projects, "backend.yaml", "id: backend\nname: Backend\n")
    _write_yaml(projects, "frontend.yaml", "id: frontend\nname: Frontend\n")
    _write_yaml(projects, "shared.yaml", "id: shared\nname: Shared Lib\n")

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )

    # First reparse (create() already ran implicit reparse, so this is second)
    _, stats1, _, _ = await service.reparse(ws.id)
    assert stats1["parsed"] == 3
    assert stats1["created"] == 0
    assert stats1["updated"] == 3

    # Remove one YAML
    (projects / "shared.yaml").unlink()

    # Second reparse
    _, stats2, children2, _ = await service.reparse(ws.id)
    assert stats2["parsed"] == 2
    assert stats2["deleted"] == 1
    assert len(children2) == 2

    # Verify the soft-deleted workspace
    from sqlalchemy import select
    from sqlmodel import col

    from app.modules.workspace.model import Workspace

    stmt = select(Workspace).where(col(Workspace.component_key) == "shared")
    deleted_ws = (await db_session.execute(stmt)).scalars().first()
    assert deleted_ws is not None
    assert deleted_ws.deleted_at is not None
    assert deleted_ws.status == "deleted"


async def test_reparse_empty_projects_dir(db_session, tmp_path: Path) -> None:
    """Empty projects/ results in all-zero stats, no errors (E-01)."""
    root = _make_workspace_with_projects(tmp_path)
    # projects/ dir exists but is empty

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )
    _, stats, children, relations = await service.reparse(ws.id)

    assert stats["parsed"] == 0
    assert stats["created"] == 0
    assert stats["updated"] == 0
    assert stats["deleted"] == 0
    assert stats["relations_created"] == 0
    assert stats["relations_deleted"] == 0
    assert len(children) == 0
    assert len(relations) == 0


async def test_reparse_unknown_workspace_raises(db_session) -> None:
    """Random UUID raises WorkspaceNotFound (AC-08)."""
    service = WorkspaceService(db_session)
    with pytest.raises(WorkspaceNotFound):
        await service.reparse(uuid.uuid4())


async def test_reparse_soft_deleted_parent_raises(db_session, tmp_path: Path) -> None:
    """Soft-deleted parent raises WorkspaceNotFound (E-08)."""
    root = _make_workspace_with_projects(tmp_path)
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )
    await service.soft_delete(ws.id)
    with pytest.raises(WorkspaceNotFound):
        await service.reparse(ws.id)


async def test_reparse_path_missing_correction(db_session, tmp_path: Path) -> None:
    """path_missing corrected when subdirectory exists (AC-09)."""
    root = _make_workspace_with_projects(tmp_path)
    projects = root / ".sillyspec" / "projects"

    # YAML references a path that we'll create on disk
    _write_yaml(projects, "backend.yaml", "id: backend\nname: Backend\npath: backend\n")

    # Create the subdirectory so path_missing gets corrected
    (root / "backend").mkdir(parents=True, exist_ok=True)

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="Parent", root_path=str(root)),
        created_by=None,
    )
    _, stats, children, _ = await service.reparse(ws.id)

    assert stats["parsed"] == 1
    # create() already ran implicit reparse, so second reparse sees update
    assert stats["created"] == 0
    assert stats["updated"] == 1
    assert len(children) == 1
    assert children[0].status == "active"
    assert "backend" in children[0].root_path
