"""WorkspaceService tests — exercise scan + persistence against in-memory SQLite."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.core.errors import (
    WorkspaceNotFound,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspacePermissionDenied,
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


async def test_create_duplicate_root_path_returns_existing(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    first = await service.create(
        WorkspaceCreate(name="first", root_path=str(root)),
        created_by=None,
    )
    # Creating with same root_path returns the existing workspace
    second = await service.create(
        WorkspaceCreate(name="second", root_path=str(root)),
        created_by=None,
    )
    assert second.id == first.id


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


async def test_soft_delete_by_non_owner_raises(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    owner_id = uuid.uuid4()
    ws = await service.create(
        WorkspaceCreate(name="ws", root_path=str(root)),
        created_by=owner_id,
    )
    other_id = uuid.uuid4()
    with pytest.raises(WorkspacePermissionDenied):
        await service.soft_delete(ws.id, deleted_by=other_id)


async def test_soft_delete_by_owner_succeeds(db_session, tmp_path: Path) -> None:
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    owner_id = uuid.uuid4()
    ws = await service.create(
        WorkspaceCreate(name="ws", root_path=str(root)),
        created_by=owner_id,
    )
    deleted = await service.soft_delete(ws.id, deleted_by=owner_id)
    assert deleted.status == "deleted"
    assert deleted.deleted_at is not None


async def test_soft_delete_by_none_created_by_skips_owner_check(db_session, tmp_path: Path) -> None:
    """Legacy records with created_by=None can be deleted by anyone."""
    root = _make_workspace(tmp_path)
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(name="ws", root_path=str(root)),
        created_by=None,
    )
    deleted = await service.soft_delete(ws.id, deleted_by=uuid.uuid4())
    assert deleted.status == "deleted"


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


async def test_get_pending_workspace_validates_as_read_schema(db_session, tmp_path: Path) -> None:
    """A pending workspace (bootstrap lifecycle) must serialize via WorkspaceRead.

    Regression: WorkspaceStatusLiteral originally omitted "pending", so
    GET /api/workspaces/{id} raised 500 when the row was still pending.
    """
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.schema import WorkspaceRead

    root = _make_workspace(tmp_path)
    ws = Workspace(
        id=uuid.uuid4(),
        name="Pending One",
        slug="pending-one",
        root_path=str(root),
        status="pending",
    )
    db_session.add(ws)
    await db_session.flush()

    service = WorkspaceService(db_session)
    fetched = await service.get(ws.id)
    assert fetched.status == "pending"
    validated = WorkspaceRead.model_validate(fetched)
    assert validated.status == "pending"


async def test_list_includes_pending_workspaces(db_session, tmp_path: Path) -> None:
    """Pending (still-generating) workspaces must appear in the default list.

    Users want to see a workspace in /workspaces while its spec is still being
    generated, then click into the detail page to watch progress.
    """
    from app.modules.workspace.model import Workspace

    root = _make_workspace(tmp_path)
    pending = Workspace(
        id=uuid.uuid4(),
        name="Still Generating",
        slug="still-generating",
        root_path=str(root),
        status="pending",
    )
    db_session.add(pending)
    await db_session.flush()

    service = WorkspaceService(db_session)
    items, total = await service.list_()
    assert total == 1
    assert any(w.id == pending.id and w.status == "pending" for w in items)


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
    """Resurrecting handles slug conflicts by auto-generating a unique slug.

    If another active workspace already holds the slug we want to revive,
    the system automatically appends a suffix to preserve uniqueness.
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
    _ws_b = await service.create(
        WorkspaceCreate(name="B", slug="shared", root_path=str(root_b)),
        created_by=None,
    )

    # Resurrecting A with the same slug should auto-generate a unique slug
    ws_a_revived = await service.create(
        WorkspaceCreate(name="A again", slug="shared", root_path=str(root_a)),
        created_by=None,
    )
    assert ws_a_revived.slug.startswith("shared-")
    assert ws_a_revived.slug != "shared"
