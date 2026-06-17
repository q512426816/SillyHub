"""Tests for workspace default_agent schema/service (task-04,
2026-06-14-agent-runtime-selection).

Covers FR-01: ``default_agent`` readable/writable via the workspace API —
create optional, PATCH set/clear/omit (``exclude_unset``), GET reads back.

AC mapping:
- AC-01: PATCH {"default_agent":"claude"} -> read back "claude".
- AC-02: default=claude, PATCH {"default_agent":null} -> read back None.
- AC-03: default=claude, PATCH without default_agent -> unchanged.
- AC-04: WorkspaceCreate accepts default_agent; ORM persists; Read returns it.
- AC-05: WorkspaceCreate without default_agent -> None.

Workspaces are inserted via ORM (bypassing the filesystem scan) so the test
focuses on schema + service.update semantics.
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.workspace.model import Workspace
from app.modules.workspace.schema import (
    WorkspaceCreate,
    WorkspaceRead,
    WorkspaceUpdate,
)
from app.modules.workspace.service import WorkspaceService


async def _make_workspace(
    db_session,
    *,
    default_agent: str | None = None,
    default_model: str | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="ws",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:6]}",
        status="active",
        default_agent=default_agent,
        default_model=default_model,
        tech_stack=[],
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


# ---- AC-04/05: WorkspaceCreate field ----------------------------------------


def test_workspace_create_accepts_default_agent():
    dto = WorkspaceCreate(
        name="x",
        root_path="/tmp/x",
        default_agent="claude",
        default_model="claude-sonnet-4",
    )
    assert dto.default_agent == "claude"
    assert dto.default_model == "claude-sonnet-4"


def test_workspace_create_default_agent_optional():
    dto = WorkspaceCreate(name="x", root_path="/tmp/x")
    assert dto.default_agent is None
    assert dto.default_model is None


# ---- AC-01: PATCH set --------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_sets_default_agent(db_session):
    ws = await _make_workspace(db_session, default_agent=None)
    svc = WorkspaceService(db_session)
    await svc.update(
        ws.id,
        WorkspaceUpdate(default_agent="claude", default_model="claude-sonnet-4"),
    )
    refreshed = await svc.get(ws.id)
    assert refreshed.default_agent == "claude"
    assert refreshed.default_model == "claude-sonnet-4"


# ---- AC-02: PATCH clear (explicit null) -------------------------------------


@pytest.mark.asyncio
async def test_patch_clears_default_agent(db_session):
    ws = await _make_workspace(
        db_session,
        default_agent="claude",
        default_model="claude-sonnet-4",
    )
    svc = WorkspaceService(db_session)
    await svc.update(ws.id, WorkspaceUpdate(default_agent=None, default_model=None))
    refreshed = await svc.get(ws.id)
    assert refreshed.default_agent is None
    assert refreshed.default_model is None


# ---- AC-03: PATCH omit keeps value (exclude_unset) --------------------------


@pytest.mark.asyncio
async def test_patch_omit_keeps_default_agent(db_session):
    ws = await _make_workspace(
        db_session,
        default_agent="claude",
        default_model="claude-sonnet-4",
    )
    svc = WorkspaceService(db_session)
    # Patch an unrelated field; default_agent must remain untouched.
    await svc.update(ws.id, WorkspaceUpdate(name="renamed"))
    refreshed = await svc.get(ws.id)
    assert refreshed.default_agent == "claude"
    assert refreshed.default_model == "claude-sonnet-4"
    assert refreshed.name == "renamed"


# ---- AC-04: ORM persists + WorkspaceRead reads back -------------------------


@pytest.mark.asyncio
async def test_workspace_read_reads_default_agent(db_session):
    ws = await _make_workspace(
        db_session,
        default_agent="codex",
        default_model="gpt-5-codex",
    )
    read = WorkspaceRead.model_validate(ws)
    assert read.default_agent == "codex"
    assert read.default_model == "gpt-5-codex"


@pytest.mark.asyncio
async def test_workspace_read_default_agent_none(db_session):
    ws = await _make_workspace(db_session, default_agent=None)
    read = WorkspaceRead.model_validate(ws)
    assert read.default_agent is None
    assert read.default_model is None
