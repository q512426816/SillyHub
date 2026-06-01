"""Model-level tests for Workspace, WorkspaceRelation, and M:N associations.

TDD: tests written BEFORE implementation. These cover AC-01 through AC-12
from task-01 (data model restructuring).
"""

from __future__ import annotations

import uuid

import pytest

# ---------------------------------------------------------------------------
# Step 1: Workspace model field existence
# ---------------------------------------------------------------------------


def test_workspace_has_component_metadata_fields() -> None:
    """Workspace model should contain all component metadata fields. (AC-01)"""
    from app.modules.workspace.model import Workspace

    field_names = set(Workspace.model_fields.keys())
    required = {
        "component_key",
        "type",
        "role",
        "repo_url",
        "default_branch",
        "tech_stack",
        "build_command",
        "test_command",
        "source_yaml_path",
    }
    assert required.issubset(field_names), f"Missing fields: {required - field_names}"


def test_workspace_no_sillyspec_path() -> None:
    """Workspace model should NOT contain sillyspec_path. (AC-02)"""
    from app.modules.workspace.model import Workspace

    field_names = set(Workspace.model_fields.keys())
    assert "sillyspec_path" not in field_names


# ---------------------------------------------------------------------------
# Step 2: Workspace model field defaults
# ---------------------------------------------------------------------------


def test_workspace_component_fields_default_to_none_or_empty() -> None:
    """New Workspace instances should have correct default values. (AC-03)"""
    from app.modules.workspace.model import Workspace

    ws = Workspace(name="test", slug="test", root_path="/tmp/test")
    assert ws.component_key is None
    assert ws.type is None
    assert ws.role is None
    assert ws.repo_url is None
    assert ws.default_branch == "main"
    assert ws.tech_stack == []
    assert ws.build_command is None
    assert ws.test_command is None
    assert ws.source_yaml_path is None


# ---------------------------------------------------------------------------
# Step 3: WorkspaceRelation model
# ---------------------------------------------------------------------------


def test_workspace_relation_model_fields() -> None:
    """WorkspaceRelation should contain correct fields. (AC-04 partial)"""
    from app.modules.workspace.model import WorkspaceRelation

    field_names = set(WorkspaceRelation.model_fields.keys())
    for name in ("source_id", "target_id", "relation_type", "description", "created_at"):
        assert name in field_names, f"Missing field: {name}"


def test_workspace_relation_table_constraints() -> None:
    """WorkspaceRelation table should have UQ triplet + source/target indexes. (AC-04)"""
    from app.modules.workspace.model import WorkspaceRelation

    index_names = {idx.name for idx in WorkspaceRelation.__table_args__ if hasattr(idx, "name")}
    assert "ux_workspace_relations_triplet" in index_names
    assert "ix_workspace_relations_source" in index_names
    assert "ix_workspace_relations_target" in index_names


# ---------------------------------------------------------------------------
# Step 4: M:N association models - composite PKs
# ---------------------------------------------------------------------------


def test_change_workspace_composite_pk() -> None:
    """ChangeWorkspace should use composite PK. (AC-05)"""
    from app.modules.workspace.model import ChangeWorkspace

    pk_cols = [c.name for c in ChangeWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"change_id", "workspace_id"}


def test_task_workspace_composite_pk() -> None:
    """TaskWorkspace should use composite PK. (AC-06)"""
    from app.modules.workspace.model import TaskWorkspace

    pk_cols = [c.name for c in TaskWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"task_id", "workspace_id"}


def test_agent_run_workspace_composite_pk() -> None:
    """AgentRunWorkspace should use composite PK. (AC-07)"""
    from app.modules.workspace.model import AgentRunWorkspace

    pk_cols = [c.name for c in AgentRunWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"agent_run_id", "workspace_id"}


# ---------------------------------------------------------------------------
# Step 5: Schema tests
# ---------------------------------------------------------------------------


def test_workspace_create_accepts_component_fields() -> None:
    """WorkspaceCreate should accept all component metadata fields. (AC-08)"""
    from app.modules.workspace.schema import WorkspaceCreate

    data = {
        "name": "test-ws",
        "root_path": "/tmp/test",
        "component_key": "api-gateway",
        "type": "service",
        "role": "backend",
        "repo_url": "https://github.com/org/api",
        "default_branch": "develop",
        "tech_stack": ["python", "fastapi"],
        "build_command": "make build",
        "test_command": "make test",
        "source_yaml_path": ".sillyspec/projects/api.yaml",
    }
    dto = WorkspaceCreate(**data)
    assert dto.component_key == "api-gateway"
    assert dto.tech_stack == ["python", "fastapi"]


def test_workspace_create_component_fields_optional() -> None:
    """WorkspaceCreate component fields should all be optional. (AC-09)"""
    from app.modules.workspace.schema import WorkspaceCreate

    dto = WorkspaceCreate(name="plain-ws", root_path="/tmp/plain")
    assert dto.component_key is None
    assert dto.tech_stack == []


def test_workspace_create_no_spec_strategy() -> None:
    """WorkspaceCreate should NOT contain spec_strategy field."""
    from app.modules.workspace.schema import WorkspaceCreate

    field_names = set(WorkspaceCreate.model_fields.keys())
    assert "spec_strategy" not in field_names


def test_workspace_read_has_no_sillyspec_path() -> None:
    """WorkspaceRead should NOT contain sillyspec_path. (AC-10)"""
    from app.modules.workspace.schema import WorkspaceRead

    field_names = set(WorkspaceRead.model_fields.keys())
    assert "sillyspec_path" not in field_names


def test_workspace_read_has_component_metadata_fields() -> None:
    """WorkspaceRead should contain all 9 component metadata fields. (AC-11)"""
    from app.modules.workspace.schema import WorkspaceRead

    field_names = set(WorkspaceRead.model_fields.keys())
    required = {
        "component_key",
        "type",
        "role",
        "repo_url",
        "default_branch",
        "tech_stack",
        "build_command",
        "test_command",
        "source_yaml_path",
    }
    assert required.issubset(field_names), f"Missing: {required - field_names}"


def test_workspace_relation_create_schema() -> None:
    """WorkspaceRelationCreate should contain required fields. (AC-12)"""
    from app.modules.workspace.schema import WorkspaceRelationCreate

    data = {
        "target_id": str(uuid.uuid4()),
        "relation_type": "depends_on",
    }
    dto = WorkspaceRelationCreate(**data)
    assert dto.relation_type == "depends_on"
    assert dto.description is None


def test_workspace_relation_read_schema() -> None:
    """WorkspaceRelationRead should contain all fields. (AC-12)"""
    from app.modules.workspace.schema import WorkspaceRelationRead

    field_names = set(WorkspaceRelationRead.model_fields.keys())
    expected = {"id", "source_id", "target_id", "relation_type", "description", "created_at"}
    assert expected.issubset(field_names), f"Missing: {expected - field_names}"


def test_scan_response_has_no_sillyspec_path() -> None:
    """ScanResponse should NOT contain sillyspec_path."""
    from app.modules.workspace.schema import ScanResponse

    field_names = set(ScanResponse.model_fields.keys())
    assert "sillyspec_path" not in field_names


# ---------------------------------------------------------------------------
# Step 6: Migration file existence
# ---------------------------------------------------------------------------


def test_migration_file_exists() -> None:
    """workspace_graph migration file should exist."""
    from pathlib import Path

    migration_dir = Path(__file__).resolve().parents[4] / "migrations" / "versions"
    files = list(migration_dir.glob("*workspace_graph*"))
    assert len(files) == 1, f"Expected 1 migration file, found {len(files)}"


# ---------------------------------------------------------------------------
# Step 7: DB-level constraint tests (require db_session fixture)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_workspace_relation_unique_triplet(db_session) -> None:
    """Duplicate (source, target, type) should be rejected. (AC-17)"""
    from app.modules.workspace.model import Workspace, WorkspaceRelation

    ws1 = Workspace(name="ws1", slug="ws1", root_path="/tmp/ws1")
    ws2 = Workspace(name="ws2", slug="ws2", root_path="/tmp/ws2")
    db_session.add_all([ws1, ws2])
    await db_session.flush()

    rel1 = WorkspaceRelation(source_id=ws1.id, target_id=ws2.id, relation_type="depends_on")
    db_session.add(rel1)
    await db_session.flush()

    rel2 = WorkspaceRelation(source_id=ws1.id, target_id=ws2.id, relation_type="depends_on")
    db_session.add(rel2)
    with pytest.raises(Exception):  # IntegrityError on both SQLite & Postgres
        await db_session.flush()


@pytest.mark.asyncio
async def test_change_workspace_composite_pk_unique(db_session) -> None:
    """Duplicate (change_id, workspace_id) should be rejected. (AC-18)"""
    from app.modules.change.model import Change
    from app.modules.workspace.model import ChangeWorkspace, Workspace

    ws = Workspace(name="cw-test", slug="cw-test", root_path="/tmp/cw")
    db_session.add(ws)
    await db_session.flush()

    ch = Change(
        workspace_id=ws.id,
        change_key="test-change",
        location="change",
        path="/tmp/test-change",
    )
    db_session.add(ch)
    await db_session.flush()

    assoc1 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    db_session.add(assoc1)
    await db_session.flush()

    assoc2 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    db_session.add(assoc2)
    with pytest.raises(Exception):  # IntegrityError
        await db_session.flush()
