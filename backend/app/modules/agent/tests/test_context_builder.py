"""Tests for context_builder — building TaskContext and AgentSpecBundle from DB."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.base import AgentSpecBundle
from app.modules.change.model import Change, ChangeDocument
from app.modules.task.model import Task


async def _seed(session: AsyncSession) -> dict:
    ws_id = uuid.UUID("22222222-2222-2222-2222-222222222222")
    change_id = uuid.uuid4()
    task_id = uuid.uuid4()

    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="test-agent-change",
        title="Agent Test Change",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/test-agent-change",
    )
    session.add(change)

    for doc_type in ("proposal", "requirements", "design", "plan"):
        doc = ChangeDocument(
            id=uuid.uuid4(),
            change_id=change_id,
            doc_type=doc_type,
            path=f"docs/{doc_type}.md",
            exists=True,
        )
        session.add(doc)

    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-01",
        title="Build Feature",
        status="in_progress",
        allowed_paths=["src/", "tests/"],
    )
    session.add(task)
    await session.commit()
    return {"ws_id": ws_id, "change_id": change_id, "task_id": task_id}


@pytest.mark.asyncio
async def test_build_task_context_populates_fields(db_session: AsyncSession):
    from app.modules.agent.context_builder import build_task_context

    refs = await _seed(db_session)
    ctx = await build_task_context(db_session, refs["change_id"], refs["task_id"])
    assert ctx.change_title == "Agent Test Change"
    assert ctx.task_title == "Build Feature"
    assert ctx.task_key == "task-01"
    assert ctx.proposal == "docs/proposal.md"
    assert ctx.requirements == "docs/requirements.md"
    assert ctx.design == "docs/design.md"
    assert ctx.plan == "docs/plan.md"
    assert ctx.allowed_paths == ["src/", "tests/"]


@pytest.mark.asyncio
async def test_build_task_context_missing_task(db_session: AsyncSession):
    from app.modules.agent.context_builder import build_task_context

    refs = await _seed(db_session)
    with pytest.raises(ValueError, match="not found"):
        await build_task_context(db_session, refs["change_id"], uuid.uuid4())


@pytest.mark.asyncio
async def test_build_task_context_missing_change(db_session: AsyncSession):
    from app.modules.agent.context_builder import build_task_context

    refs = await _seed(db_session)
    with pytest.raises(ValueError, match="not found"):
        await build_task_context(db_session, uuid.uuid4(), refs["task_id"])


# ---------------------------------------------------------------------------
# AgentSpecBundle — build_spec_bundle tests
# ---------------------------------------------------------------------------


async def _seed_with_spec_workspace(session: AsyncSession) -> dict:
    """Seed DB with change, task, and a SpecWorkspace record."""
    from app.modules.spec_workspace.model import SpecWorkspace

    ws_id = uuid.uuid4()
    change_id = uuid.uuid4()
    task_id = uuid.uuid4()

    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="bundle-test-change",
        title="Bundle Test Change",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/bundle-test-change",
    )
    session.add(change)

    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-42",
        title="Build Bundle Feature",
        status="in_progress",
        allowed_paths=["src/", "tests/"],
        content="## Task\nImplement the feature.",
    )
    session.add(task)

    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        spec_root=".platform-specs/test",
        strategy="platform-managed",
        profile_version="0.2.0",
        sync_status="clean",
    )
    session.add(spec_ws)

    await session.commit()
    return {
        "ws_id": ws_id,
        "change_id": change_id,
        "task_id": task_id,
    }


@pytest.mark.asyncio
async def test_build_spec_bundle_assembles_correctly(db_session: AsyncSession) -> None:
    """build_spec_bundle loads task, change, spec_workspace into an AgentSpecBundle."""
    from app.modules.agent.context_builder import build_spec_bundle

    refs = await _seed_with_spec_workspace(db_session)
    bundle = await build_spec_bundle(
        db_session,
        change_id=refs["change_id"],
        task_id=refs["task_id"],
        workspace_id=refs["ws_id"],
    )

    assert isinstance(bundle, AgentSpecBundle)
    assert bundle.change_summary == "Bundle Test Change"
    assert bundle.task_key == "task-42"
    assert bundle.task_title == "Build Bundle Feature"
    assert bundle.allowed_paths == ["src/", "tests/"]
    assert bundle.spec_strategy == "platform-managed"
    assert bundle.profile_version == "0.2.0"
    assert bundle.profile_gates == []
    assert bundle.platform_metadata["workspace_id"] == str(refs["ws_id"])
    assert bundle.platform_metadata["change_id"] == str(refs["change_id"])
    assert bundle.platform_metadata["task_id"] == str(refs["task_id"])
    assert bundle.platform_metadata["change_key"] == "bundle-test-change"


@pytest.mark.asyncio
async def test_build_spec_bundle_without_spec_workspace(db_session: AsyncSession) -> None:
    """When no SpecWorkspace exists, strategy and profile_version are None."""
    from app.modules.agent.context_builder import build_spec_bundle

    # Seed without SpecWorkspace
    ws_id = uuid.uuid4()
    change_id = uuid.uuid4()
    task_id = uuid.uuid4()

    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="no-spec-ws-change",
        title="No SpecWorkspace Change",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/no-spec-ws",
    )
    db_session.add(change)

    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-99",
        title="Task Without SpecWS",
        status="in_progress",
        allowed_paths=[],
    )
    db_session.add(task)
    await db_session.commit()

    bundle = await build_spec_bundle(
        db_session,
        change_id=change_id,
        task_id=task_id,
        workspace_id=ws_id,
    )

    assert bundle.spec_strategy is None
    assert bundle.profile_version is None


@pytest.mark.asyncio
async def test_build_spec_bundle_missing_task_raises(db_session: AsyncSession) -> None:
    from app.modules.agent.context_builder import build_spec_bundle

    refs = await _seed_with_spec_workspace(db_session)
    with pytest.raises(ValueError, match="not found"):
        await build_spec_bundle(
            db_session,
            change_id=refs["change_id"],
            task_id=uuid.uuid4(),
            workspace_id=refs["ws_id"],
        )


# ---------------------------------------------------------------------------
# render_bundle_to_claude_md tests
# ---------------------------------------------------------------------------


def test_render_bundle_to_claude_md_basic() -> None:
    """render_bundle_to_claude_md produces valid markdown with task header."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Add authentication",
        task_key="task-01",
        task_title="Implement JWT login",
    )
    md = render_bundle_to_claude_md(bundle)
    assert "# Task: task-01 — Implement JWT login" in md
    assert "# Change: Add authentication" in md


def test_render_bundle_to_claude_md_with_docs() -> None:
    """Inlined spec documents appear as sections."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Add feature",
        task_key="task-02",
        task_title="Do the thing",
        proposal="We should add X.",
        requirements="Must support Y.",
        design="Component Z handles this.",
        plan="Step 1: implement. Step 2: test.",
        task_markdown="## Task\nDo the work.",
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Proposal" in md
    assert "We should add X." in md
    assert "## Requirements" in md
    assert "Must support Y." in md
    assert "## Design" in md
    assert "Component Z handles this." in md
    assert "## Plan" in md
    assert "Step 1: implement. Step 2: test." in md
    assert "## Task" in md
    assert "Do the work." in md


def test_render_bundle_to_claude_md_with_constraints() -> None:
    """Allowed paths and acceptance criteria appear in the output."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Refactor",
        task_key="task-03",
        task_title="Clean up",
        allowed_paths=["src/", "tests/"],
        denied_paths=["vendor/"],
        acceptance_criteria=["All tests pass", "No lint errors"],
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Allowed Paths" in md
    assert "- src/" in md
    assert "- tests/" in md
    assert "## Denied Paths" in md
    assert "- vendor/" in md
    assert "## Acceptance Criteria" in md
    assert "- [ ] All tests pass" in md
    assert "- [ ] No lint errors" in md


def test_render_bundle_to_claude_md_with_profile() -> None:
    """Profile metadata and gates appear in the output."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Add feature",
        task_key="task-04",
        task_title="Do it",
        spec_strategy="platform-managed",
        profile_version="0.2.0",
        profile_gates=[
            {"name": "require_proposal", "type": "document"},
            {"name": "require_plan", "type": "document"},
        ],
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Profile" in md
    assert "- **Strategy**: platform-managed" in md
    assert "- **Profile version**: 0.2.0" in md
    assert "## Profile Gates" in md
    assert "- require_proposal (document)" in md
    assert "- require_plan (document)" in md


def test_render_bundle_to_claude_md_omits_empty_sections() -> None:
    """When no docs/constraints/profile are set, those sections are absent."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Minimal",
        task_key="task-05",
        task_title="Minimal task",
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Proposal" not in md
    assert "## Requirements" not in md
    assert "## Design" not in md
    assert "## Plan" not in md
    assert "## Task" not in md
    assert "## Allowed Paths" not in md
    assert "## Denied Paths" not in md
    assert "## Acceptance Criteria" not in md
    assert "## Profile" not in md
    assert "## Profile Gates" not in md
    assert "## Referenced Workspaces" not in md


# ---------------------------------------------------------------------------
# Task-06: WorkspaceSpecSummary + _fetch_referenced_workspaces tests
# ---------------------------------------------------------------------------


def test_workspace_spec_summary_creation() -> None:
    """WorkspaceSpecSummary can be constructed with all fields."""
    from app.modules.agent.base import WorkspaceSpecSummary

    ws_id = uuid.uuid4()
    summary = WorkspaceSpecSummary(
        workspace_id=ws_id,
        name="api-gateway",
        slug="api-gateway",
        component_key="api-gateway",
        relation_type="depends_on",
        direction="outgoing",
        spec_root="/specs/api-gateway",
        doc_summaries={"ARCHITECTURE": "# Architecture\n..."},
    )
    assert summary.workspace_id == ws_id
    assert summary.name == "api-gateway"
    assert summary.slug == "api-gateway"
    assert summary.component_key == "api-gateway"
    assert summary.relation_type == "depends_on"
    assert summary.direction == "outgoing"
    assert summary.spec_root == "/specs/api-gateway"
    assert summary.doc_summaries == {"ARCHITECTURE": "# Architecture\n..."}


def test_workspace_spec_summary_default_doc_summaries() -> None:
    """WorkspaceSpecSummary doc_summaries defaults to empty dict."""
    from app.modules.agent.base import WorkspaceSpecSummary

    summary = WorkspaceSpecSummary(
        workspace_id=uuid.uuid4(),
        name="test",
        slug="test",
        component_key=None,
        relation_type="depends_on",
        direction="outgoing",
        spec_root=None,
    )
    assert summary.doc_summaries == {}


def test_agent_spec_bundle_has_referenced_workspaces() -> None:
    """AgentSpecBundle has referenced_workspaces field, defaulting to empty list."""
    bundle = AgentSpecBundle(
        change_summary="Test",
        task_key="task-10",
        task_title="Test task",
    )
    assert bundle.referenced_workspaces == []

    from app.modules.agent.base import WorkspaceSpecSummary

    summary = WorkspaceSpecSummary(
        workspace_id=uuid.uuid4(),
        name="ws-b",
        slug="ws-b",
        component_key="b",
        relation_type="depends_on",
        direction="outgoing",
        spec_root=None,
    )
    bundle2 = AgentSpecBundle(
        change_summary="Test",
        task_key="task-10",
        task_title="Test task",
        referenced_workspaces=[summary],
    )
    assert len(bundle2.referenced_workspaces) == 1
    assert bundle2.referenced_workspaces[0].name == "ws-b"


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_no_relations(db_session: AsyncSession) -> None:
    """Workspace with no relations returns empty list."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="solo",
        slug="solo",
        root_path="/solo",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws.id)
    assert result == []


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_outgoing_relation(
    db_session: AsyncSession,
) -> None:
    """Outgoing relation A->B produces a summary with direction='outgoing'."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(
        id=uuid.uuid4(),
        name="B",
        slug="b",
        root_path="/b",
        status="active",
        component_key="service-b",
    )
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id)
    assert len(result) == 1
    assert result[0].workspace_id == ws_b.id
    assert result[0].name == "B"
    assert result[0].slug == "b"
    assert result[0].component_key == "service-b"
    assert result[0].relation_type == "depends_on"
    assert result[0].direction == "outgoing"
    assert result[0].spec_root is None
    assert result[0].doc_summaries == {}


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_incoming_relation(
    db_session: AsyncSession,
) -> None:
    """Incoming relation A->B when querying B produces direction='incoming'."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="consumes_api_from",
    )
    db_session.add(rel)
    await db_session.commit()

    # Query from B's perspective — A is incoming
    result = await _fetch_referenced_workspaces(db_session, ws_b.id)
    assert len(result) == 1
    assert result[0].workspace_id == ws_a.id
    assert result[0].direction == "incoming"
    assert result[0].relation_type == "consumes_api_from"


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_skips_deleted_workspace(
    db_session: AsyncSession,
) -> None:
    """Relations pointing to a soft-deleted workspace are skipped."""
    from datetime import datetime

    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_deleted = Workspace(
        id=uuid.uuid4(),
        name="Deleted",
        slug="deleted",
        root_path="/deleted",
        status="deleted",
        deleted_at=datetime.utcnow(),
    )
    db_session.add_all([ws_a, ws_deleted])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_deleted.id,
        relation_type="depends_on",
    )
    db_session.add(rel)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id)
    assert result == []


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_skips_no_spec_workspace(
    db_session: AsyncSession,
) -> None:
    """Workspace without SpecWorkspace record still produces a summary."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)
    await db_session.commit()

    # ws_b has no SpecWorkspace record
    result = await _fetch_referenced_workspaces(db_session, ws_a.id)
    assert len(result) == 1
    assert result[0].spec_root is None
    assert result[0].doc_summaries == {}


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_reads_doc_snippets(
    db_session: AsyncSession,
) -> None:
    """ScanDocument content is read and truncated to snippet_max_chars."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.scan_docs.model import ScanDocument
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)

    # Add scan_document for ws_b with content stored directly
    doc = ScanDocument(
        id=uuid.uuid4(),
        workspace_id=ws_b.id,
        doc_type="ARCHITECTURE",
        path="arch.md",
        title="Architecture Doc",
        exists=True,
        content="# Architecture Overview\nThis is the architecture.",
    )
    db_session.add(doc)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, snippet_max_chars=2000)
    assert len(result) == 1
    assert "ARCHITECTURE" in result[0].doc_summaries
    assert "Architecture Overview" in result[0].doc_summaries["ARCHITECTURE"]


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_snippet_truncation(
    db_session: AsyncSession,
) -> None:
    """Content longer than snippet_max_chars is truncated."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.scan_docs.model import ScanDocument
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)

    long_content = "x" * 5000
    doc = ScanDocument(
        id=uuid.uuid4(),
        workspace_id=ws_b.id,
        doc_type="STRUCTURE",
        path="structure.md",
        exists=True,
        content=long_content,
    )
    db_session.add(doc)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, snippet_max_chars=100)
    assert len(result) == 1
    snippet = result[0].doc_summaries["STRUCTURE"]
    assert len(snippet) == 100
    assert snippet == "x" * 100


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_circular_dependency(
    db_session: AsyncSession,
) -> None:
    """A->B and B->A does not cause infinite recursion; each workspace appears once."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel_ab = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    rel_ba = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_b.id,
        target_id=ws_a.id,
        relation_type="depends_on",
    )
    db_session.add_all([rel_ab, rel_ba])
    await db_session.commit()

    # From A's perspective: B is outgoing, A is NOT incoming (A is self, filtered by visited)
    result = await _fetch_referenced_workspaces(db_session, ws_a.id)
    # B appears once (outgoing), A is the origin and should not appear
    ws_ids = [s.workspace_id for s in result]
    assert ws_a.id not in ws_ids
    assert ws_b.id in ws_ids
    assert len(result) == 1


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_invalid_max_depth(
    db_session: AsyncSession,
) -> None:
    """max_depth <= 0 raises ValueError."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace

    ws = Workspace(id=uuid.uuid4(), name="X", slug="x", root_path="/x", status="active")
    db_session.add(ws)
    await db_session.commit()

    with pytest.raises(ValueError, match="max_depth must be >= 1"):
        await _fetch_referenced_workspaces(db_session, ws.id, max_depth=0)

    with pytest.raises(ValueError, match="max_depth must be >= 1"):
        await _fetch_referenced_workspaces(db_session, ws.id, max_depth=-1)


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_multiple_relations_same_pair(
    db_session: AsyncSession,
) -> None:
    """Two relations A->B (depends_on + consumes_api_from) yields only one summary for B."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel1 = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    rel2 = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="consumes_api_from",
    )
    db_session.add_all([rel1, rel2])
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id)
    assert len(result) == 1
    assert result[0].workspace_id == ws_b.id
    # relation_type is from the first encounter
    assert result[0].relation_type in ("depends_on", "consumes_api_from")


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_zero_snippet_chars(
    db_session: AsyncSession,
) -> None:
    """snippet_max_chars=0 yields empty string for all doc summaries."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.scan_docs.model import ScanDocument
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    db_session.add_all([ws_a, ws_b])

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)

    doc = ScanDocument(
        id=uuid.uuid4(),
        workspace_id=ws_b.id,
        doc_type="ARCHITECTURE",
        path="arch.md",
        exists=True,
        content="Some content here",
    )
    db_session.add(doc)
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, snippet_max_chars=0)
    assert len(result) == 1
    assert result[0].doc_summaries["ARCHITECTURE"] == ""


# ---------------------------------------------------------------------------
# Task-06: build_spec_bundle integration with referenced_workspaces
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_spec_bundle_includes_referenced_workspaces(
    db_session: AsyncSession,
) -> None:
    """build_spec_bundle includes referenced_workspaces when relations exist."""
    from app.modules.agent.context_builder import build_spec_bundle
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    # Primary workspace
    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    # Related workspace with spec
    ws_b = Workspace(
        id=uuid.uuid4(),
        name="B",
        slug="b",
        root_path="/b",
        status="active",
        component_key="service-b",
    )
    db_session.add_all([ws_a, ws_b])

    spec_ws_a = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws_a.id,
        spec_root="/specs/a",
        strategy="platform-managed",
        profile_version="0.2.0",
    )
    db_session.add(spec_ws_a)

    rel = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    db_session.add(rel)

    change_id = uuid.uuid4()
    task_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_a.id,
        change_key="cross-ws-change",
        title="Cross WS Change",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/cross-ws",
    )
    task = Task(
        id=task_id,
        workspace_id=ws_a.id,
        change_id=change_id,
        task_key="task-06",
        title="Cross-space context",
        status="in_progress",
        allowed_paths=["src/"],
    )
    db_session.add_all([change, task])
    await db_session.commit()

    bundle = await build_spec_bundle(
        db_session,
        change_id=change_id,
        task_id=task_id,
        workspace_id=ws_a.id,
    )

    assert len(bundle.referenced_workspaces) == 1
    assert bundle.referenced_workspaces[0].workspace_id == ws_b.id
    assert bundle.referenced_workspaces[0].name == "B"
    assert bundle.referenced_workspaces[0].relation_type == "depends_on"
    assert bundle.referenced_workspaces[0].direction == "outgoing"


@pytest.mark.asyncio
async def test_build_spec_bundle_no_relations_empty_list(
    db_session: AsyncSession,
) -> None:
    """build_spec_bundle with no relations yields empty referenced_workspaces."""
    from app.modules.agent.context_builder import build_spec_bundle
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace

    ws = Workspace(id=uuid.uuid4(), name="Solo", slug="solo", root_path="/solo", status="active")
    db_session.add(ws)
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root="/specs/solo",
        strategy="platform-managed",
    )
    db_session.add(spec_ws)

    change_id = uuid.uuid4()
    task_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws.id,
        change_key="solo-change",
        title="Solo Change",
        status="in_progress",
        location="change",
        path=".sillyspec/changes/change/solo",
    )
    task = Task(
        id=task_id,
        workspace_id=ws.id,
        change_id=change_id,
        task_key="task-solo",
        title="Solo task",
        status="in_progress",
    )
    db_session.add_all([change, task])
    await db_session.commit()

    bundle = await build_spec_bundle(
        db_session,
        change_id=change_id,
        task_id=task_id,
        workspace_id=ws.id,
    )
    assert bundle.referenced_workspaces == []


# ---------------------------------------------------------------------------
# Task-06: render_bundle_to_claude_md with referenced_workspaces
# ---------------------------------------------------------------------------


def test_render_bundle_includes_referenced_workspaces_section() -> None:
    """render_bundle_to_claude_md includes Referenced Workspaces section."""
    from app.modules.agent.base import WorkspaceSpecSummary
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    summary = WorkspaceSpecSummary(
        workspace_id=uuid.uuid4(),
        name="api-gateway",
        slug="api-gateway",
        component_key="api-gateway",
        relation_type="depends_on",
        direction="outgoing",
        spec_root="/specs/api-gateway",
        doc_summaries={"ARCHITECTURE": "# Architecture\nComponent overview."},
    )
    bundle = AgentSpecBundle(
        change_summary="Add feature",
        task_key="task-06",
        task_title="Cross-space task",
        referenced_workspaces=[summary],
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Referenced Workspaces" in md
    assert "api-gateway" in md
    assert "depends_on" in md
    assert "**component_key**: api-gateway" in md
    assert "**spec_root**: /specs/api-gateway" in md
    assert "**ARCHITECTURE**:" in md
    assert "Component overview." in md
    # outgoing uses arrow
    assert "→" in md


def test_render_bundle_referenced_workspaces_incoming_arrow() -> None:
    """Incoming referenced workspace uses left arrow."""
    from app.modules.agent.base import WorkspaceSpecSummary
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    summary = WorkspaceSpecSummary(
        workspace_id=uuid.uuid4(),
        name="consumer",
        slug="consumer",
        component_key=None,
        relation_type="consumes_api_from",
        direction="incoming",
        spec_root=None,
    )
    bundle = AgentSpecBundle(
        change_summary="Test",
        task_key="task-07",
        task_title="Test incoming",
        referenced_workspaces=[summary],
    )
    md = render_bundle_to_claude_md(bundle)
    assert "← consumer" in md


def test_render_bundle_no_referenced_workspaces() -> None:
    """When referenced_workspaces is empty, the section is absent."""
    from app.modules.agent.context_builder import render_bundle_to_claude_md

    bundle = AgentSpecBundle(
        change_summary="Test",
        task_key="task-08",
        task_title="No refs",
    )
    md = render_bundle_to_claude_md(bundle)
    assert "## Referenced Workspaces" not in md


# ---------------------------------------------------------------------------
# Task-08: _fetch_referenced_workspaces depth=2 tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_depth_2(
    db_session: AsyncSession,
) -> None:
    """A->B, B->C with max_depth=2 returns B and C (two hops)."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    ws_c = Workspace(id=uuid.uuid4(), name="C", slug="c", root_path="/c", status="active")
    db_session.add_all([ws_a, ws_b, ws_c])

    rel_ab = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    rel_bc = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_b.id,
        target_id=ws_c.id,
        relation_type="depends_on",
    )
    db_session.add_all([rel_ab, rel_bc])
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, max_depth=2)
    ws_ids = {s.workspace_id for s in result}
    assert ws_b.id in ws_ids
    assert ws_c.id in ws_ids


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_depth_2_with_cycle(
    db_session: AsyncSession,
) -> None:
    """A->B, B->C, C->A with max_depth=2 — no infinite recursion, returns B and C."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    ws_c = Workspace(id=uuid.uuid4(), name="C", slug="c", root_path="/c", status="active")
    db_session.add_all([ws_a, ws_b, ws_c])

    rel_ab = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    rel_bc = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_b.id,
        target_id=ws_c.id,
        relation_type="depends_on",
    )
    rel_ca = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_c.id,
        target_id=ws_a.id,
        relation_type="depends_on",
    )
    db_session.add_all([rel_ab, rel_bc, rel_ca])
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, max_depth=2)
    ws_ids = {s.workspace_id for s in result}
    # A is the origin, should not be in results
    assert ws_a.id not in ws_ids
    # B and C should be found
    assert ws_b.id in ws_ids
    assert ws_c.id in ws_ids


@pytest.mark.asyncio
async def test_fetch_referenced_workspaces_depth_1_excludes_second_hop(
    db_session: AsyncSession,
) -> None:
    """A->B, B->C with max_depth=1 returns only B, not C."""
    from app.modules.agent.context_builder import _fetch_referenced_workspaces
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws_a = Workspace(id=uuid.uuid4(), name="A", slug="a", root_path="/a", status="active")
    ws_b = Workspace(id=uuid.uuid4(), name="B", slug="b", root_path="/b", status="active")
    ws_c = Workspace(id=uuid.uuid4(), name="C", slug="c", root_path="/c", status="active")
    db_session.add_all([ws_a, ws_b, ws_c])

    rel_ab = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_a.id,
        target_id=ws_b.id,
        relation_type="depends_on",
    )
    rel_bc = WorkspaceRelation(
        id=uuid.uuid4(),
        source_id=ws_b.id,
        target_id=ws_c.id,
        relation_type="depends_on",
    )
    db_session.add_all([rel_ab, rel_bc])
    await db_session.commit()

    result = await _fetch_referenced_workspaces(db_session, ws_a.id, max_depth=1)
    ws_ids = {s.workspace_id for s in result}
    assert ws_b.id in ws_ids
    assert ws_c.id not in ws_ids
