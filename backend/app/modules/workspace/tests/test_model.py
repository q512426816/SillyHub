"""Model-level tests for Workspace, WorkspaceRelation, and M:N associations.

TDD: tests written BEFORE implementation. These cover AC-01 through AC-12
from task-01 (data model restructuring).
"""

from __future__ import annotations

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


# ---------------------------------------------------------------------------
# Step 4: M:N association models - composite PKs
# ---------------------------------------------------------------------------


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


def test_workspace_create_has_spec_strategy_default_platform_managed() -> None:
    """WorkspaceCreate 含 spec_strategy 字段，默认 platform-managed（D-004）。

    2026-06-28-daemon-client-spec-sync-strategy 起支持 platform-managed/repo-mirrored/repo-native，
    daemon-client workspace 创建时用户可选源项目已有 .sillyspec 如何进入平台。
    """
    from app.modules.workspace.schema import WorkspaceCreate

    field = WorkspaceCreate.model_fields.get("spec_strategy")
    assert field is not None
    assert field.default == "platform-managed"


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


def test_scan_response_has_sillyspec_path() -> None:
    """ScanResponse should contain sillyspec_path."""
    from app.modules.workspace.schema import ScanResponse

    field_names = set(ScanResponse.model_fields.keys())
    assert "sillyspec_path" in field_names


# ---------------------------------------------------------------------------
# Step 6: Migration file existence
# ---------------------------------------------------------------------------


def test_migration_file_exists() -> None:
    """workspace_graph migration file should exist."""
    from pathlib import Path

    migration_dir = Path(__file__).resolve().parents[4] / "migrations" / "versions"
    files = list(migration_dir.glob("*workspace_graph*"))
    assert len(files) == 1, f"Expected 1 migration file, found {len(files)}"
