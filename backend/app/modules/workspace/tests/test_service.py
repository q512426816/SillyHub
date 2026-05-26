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
    assert ws.sillyspec_path.endswith(".sillyspec")
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
