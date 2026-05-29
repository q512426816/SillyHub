"""TaskWorkspace M:N association tests — direct DB layer."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change
from app.modules.task.model import Task
from app.modules.task.schema import TaskRead
from app.modules.workspace.model import TaskWorkspace, Workspace


async def _create_workspace(session: AsyncSession, name: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=f"/{name.lower()}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_change(
    session: AsyncSession, workspace_id: uuid.UUID, key: str = "test-change"
) -> Change:
    ch = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=key,
        title=f"Change {key}",
        status="draft",
        location="change",
        path=f".sillyspec/changes/change/{key}",
    )
    session.add(ch)
    await session.commit()
    await session.refresh(ch)
    return ch


async def _create_task(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    task_key: str = "task-01",
) -> Task:
    t = Task(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_id=change_id,
        task_key=task_key,
        title=f"Task {task_key}",
        status="draft",
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


async def test_create_task_workspace_link(db_session: AsyncSession) -> None:
    """Create TaskWorkspace row and verify it exists."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)

    tw = TaskWorkspace(task_id=task.id, workspace_id=ws.id, role="primary")
    db_session.add(tw)
    await db_session.commit()

    stmt = select(TaskWorkspace).where(
        TaskWorkspace.task_id == task.id,
        TaskWorkspace.workspace_id == ws.id,
    )
    result = (await db_session.execute(stmt)).scalars().first()
    assert result is not None
    assert result.role == "primary"


async def test_create_multiple_workspaces_for_task(
    db_session: AsyncSession,
) -> None:
    """One task linked to two workspaces."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws1.id, role="primary"))
    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws2.id, role="affected"))
    await db_session.commit()

    stmt = select(TaskWorkspace).where(TaskWorkspace.task_id == task.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert len(rows) == 2


async def test_multiple_tasks_one_workspace(db_session: AsyncSession) -> None:
    """Two tasks linked to the same workspace."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    t1 = await _create_task(db_session, ws.id, ch.id, "task-01")
    t2 = await _create_task(db_session, ws.id, ch.id, "task-02")

    db_session.add(TaskWorkspace(task_id=t1.id, workspace_id=ws.id, role="primary"))
    db_session.add(TaskWorkspace(task_id=t2.id, workspace_id=ws.id, role="primary"))
    await db_session.commit()

    stmt = select(TaskWorkspace).where(TaskWorkspace.workspace_id == ws.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert len(rows) == 2


async def test_role_field_values(db_session: AsyncSession) -> None:
    """Role field accepts primary, affected, referenced, and None."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ws3 = await _create_workspace(db_session, "WS3")
    ws4 = await _create_workspace(db_session, "WS4")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)

    for ws, role in [(ws1, "primary"), (ws2, "affected"), (ws3, "referenced"), (ws4, None)]:
        db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws.id, role=role))
    await db_session.commit()

    stmt = select(TaskWorkspace).where(TaskWorkspace.task_id == task.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert len(rows) == 4
    roles = {r.workspace_id: r.role for r in rows}
    assert roles[ws1.id] == "primary"
    assert roles[ws2.id] == "affected"
    assert roles[ws3.id] == "referenced"
    assert roles[ws4.id] is None


async def test_cascade_delete_on_task(db_session: AsyncSession) -> None:
    """Deleting a task cascades to TaskWorkspace rows."""
    # Enable FK enforcement for cascade to work on SQLite
    await db_session.execute(text("PRAGMA foreign_keys=ON"))

    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws.id, role="primary"))
    await db_session.commit()

    await db_session.delete(task)
    await db_session.commit()

    stmt = select(TaskWorkspace).where(TaskWorkspace.task_id == task.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert rows == []


async def test_cascade_delete_on_workspace(db_session: AsyncSession) -> None:
    """Deleting a workspace cascades to TaskWorkspace rows."""
    # Enable FK enforcement for cascade to work on SQLite
    await db_session.execute(text("PRAGMA foreign_keys=ON"))

    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws2.id, role="affected"))
    await db_session.commit()

    await db_session.delete(ws2)
    await db_session.commit()

    stmt = select(TaskWorkspace).where(TaskWorkspace.workspace_id == ws2.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert rows == []


async def test_duplicate_composite_pk_rejected(db_session: AsyncSession) -> None:
    """Same (task_id, workspace_id) pair twice -> IntegrityError."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws.id, role="primary"))
    await db_session.commit()

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws.id, role="affected"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_read_schema_includes_workspace_ids(db_session: AsyncSession) -> None:
    """TaskRead.workspace_ids contains linked workspace IDs."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)

    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws1.id, role="primary"))
    db_session.add(TaskWorkspace(task_id=task.id, workspace_id=ws2.id, role="affected"))
    await db_session.commit()

    data = TaskRead.model_validate(task)
    # Default workspace_ids is [] — enrich happens at service layer
    assert data.workspace_ids == []
    data.workspace_ids = [ws1.id, ws2.id]
    assert ws1.id in data.workspace_ids
    assert ws2.id in data.workspace_ids
