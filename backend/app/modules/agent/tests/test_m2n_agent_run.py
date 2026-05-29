"""AgentRunWorkspace M:N association + enrich tests — direct DB layer."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.schema import AgentRunResponse
from app.modules.agent.service import AgentService
from app.modules.change.model import Change
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, Workspace


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
    session: AsyncSession, workspace_id: uuid.UUID
) -> Change:
    ch = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="test-change",
        title="Test Change",
        status="draft",
        location="change",
        path=".sillyspec/changes/change/test-change",
    )
    session.add(ch)
    await session.commit()
    await session.refresh(ch)
    return ch


async def _create_task(
    session: AsyncSession, workspace_id: uuid.UUID, change_id: uuid.UUID
) -> Task:
    t = Task(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_id=change_id,
        task_key="task-01",
        title="Test Task",
        status="draft",
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


async def _create_agent_run(
    session: AsyncSession, task_id: uuid.UUID
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=task_id,
        agent_type="claude_code",
        status="pending",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def test_create_agent_run_workspace_link(db_session: AsyncSession) -> None:
    """Create AgentRunWorkspace row and verify it exists."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    arw = AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id)
    db_session.add(arw)
    await db_session.commit()

    stmt = select(AgentRunWorkspace).where(
        AgentRunWorkspace.agent_run_id == run.id,
        AgentRunWorkspace.workspace_id == ws.id,
    )
    result = (await db_session.execute(stmt)).scalars().first()
    assert result is not None


async def test_create_multiple_workspaces_for_agent_run(
    db_session: AsyncSession,
) -> None:
    """One agent run linked to multiple workspaces."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws1.id))
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws2.id))
    await db_session.commit()

    stmt = select(AgentRunWorkspace).where(AgentRunWorkspace.agent_run_id == run.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert len(rows) == 2


async def test_cascade_delete_on_agent_run(db_session: AsyncSession) -> None:
    """Deleting an agent run cascades to AgentRunWorkspace rows."""
    # Enable FK enforcement for cascade to work on SQLite
    await db_session.execute(text("PRAGMA foreign_keys=ON"))

    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()

    await db_session.delete(run)
    await db_session.commit()

    stmt = select(AgentRunWorkspace).where(AgentRunWorkspace.agent_run_id == run.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert rows == []


async def test_cascade_delete_on_workspace(db_session: AsyncSession) -> None:
    """Deleting a workspace cascades to AgentRunWorkspace rows."""
    # Enable FK enforcement for cascade to work on SQLite
    await db_session.execute(text("PRAGMA foreign_keys=ON"))

    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws2.id))
    await db_session.commit()

    await db_session.delete(ws2)
    await db_session.commit()

    stmt = select(AgentRunWorkspace).where(AgentRunWorkspace.workspace_id == ws2.id)
    rows = list((await db_session.execute(stmt)).scalars().all())
    assert rows == []


async def test_duplicate_composite_pk_rejected(db_session: AsyncSession) -> None:
    """Same (agent_run_id, workspace_id) pair twice -> IntegrityError."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_enrich_with_workspace_ids(db_session: AsyncSession) -> None:
    """AgentService.enrich_with_workspace_ids returns correct workspace_ids."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws1.id))
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws2.id))
    await db_session.commit()

    svc = AgentService(db_session)
    enriched = await svc.enrich_with_workspace_ids(run)

    assert isinstance(enriched, AgentRunResponse)
    assert set(enriched.workspace_ids) == {ws1.id, ws2.id}


async def test_enrich_empty_workspace_ids(db_session: AsyncSession) -> None:
    """Agent run with no M:N links returns workspace_ids=[]."""
    ws = await _create_workspace(db_session, "WS1")
    ch = await _create_change(db_session, ws.id)
    task = await _create_task(db_session, ws.id, ch.id)
    run = await _create_agent_run(db_session, task.id)

    svc = AgentService(db_session)
    enriched = await svc.enrich_with_workspace_ids(run)
    assert enriched.workspace_ids == []


async def test_list_runs_by_workspace(db_session: AsyncSession) -> None:
    """list_runs(ws) returns only agent runs associated with that workspace."""
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    ch = await _create_change(db_session, ws1.id)
    task = await _create_task(db_session, ws1.id, ch.id)

    run1 = await _create_agent_run(db_session, task.id)
    run2 = await _create_agent_run(db_session, task.id)

    db_session.add(AgentRunWorkspace(agent_run_id=run1.id, workspace_id=ws1.id))
    db_session.add(AgentRunWorkspace(agent_run_id=run2.id, workspace_id=ws1.id))
    db_session.add(AgentRunWorkspace(agent_run_id=run2.id, workspace_id=ws2.id))
    await db_session.commit()

    svc = AgentService(db_session)

    runs_ws1 = await svc.list_runs(ws1.id)
    assert len(runs_ws1) == 2
    run_ids_ws1 = {r.id for r in runs_ws1}
    assert run1.id in run_ids_ws1
    assert run2.id in run_ids_ws1

    runs_ws2 = await svc.list_runs(ws2.id)
    assert len(runs_ws2) == 1
    assert runs_ws2[0].id == run2.id
