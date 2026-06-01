"""WorkspaceParser unit tests — pure filesystem, no DB."""

from __future__ import annotations

from pathlib import Path

from app.modules.workspace.parser import (
    ParsedWorkspace,
    ParseResult,
    WorkspaceParser,
)


def _write_yaml(directory: Path, filename: str, content: str) -> Path:
    """Helper: write a YAML file and return its path."""
    directory.mkdir(parents=True, exist_ok=True)
    p = directory / filename
    p.write_text(content, encoding="utf-8")
    return p


# ── 1. Normal parse ──────────────────────────────────────────────────────


def test_normal_parse(tmp_path: Path) -> None:
    """Two valid YAML files with one relation -> 2 workspaces, 1 relation."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "backend.yaml",
        (
            "id: backend\n"
            "name: Backend API\n"
            "type: service\n"
            "role: api\n"
            "path: backend\n"
            "repo_url: https://github.com/example/backend\n"
            "default_branch: main\n"
            "tech_stack:\n"
            "  - python\n"
            "  - fastapi\n"
            "commands:\n"
            "  build: pip install -e .\n"
            "  test: pytest\n"
            "relations:\n"
            "  - target: frontend\n"
            "    type: publishes_to\n"
        ),
    )
    _write_yaml(
        projects,
        "frontend.yaml",
        (
            "id: frontend\n"
            "name: Frontend App\n"
            "type: frontend\n"
            "role: ui\n"
            "path: frontend\n"
            "tech_stack:\n"
            "  - typescript\n"
            "  - react\n"
        ),
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 2
    assert len(result.relations) == 1
    assert result.warnings == []
    assert result.errors == []

    ws_map = {w.component_key: w for w in result.workspaces}
    assert "backend" in ws_map
    assert "frontend" in ws_map

    backend = ws_map["backend"]
    assert backend.name == "Backend API"
    assert backend.type == "service"
    assert backend.role == "api"
    assert backend.path == "backend"
    assert backend.repo_url == "https://github.com/example/backend"
    assert backend.default_branch == "main"
    assert backend.tech_stack == ["python", "fastapi"]
    assert backend.build_command == "pip install -e ."
    assert backend.test_command == "pytest"
    assert backend.source_yaml_path == ".sillyspec/projects/backend.yaml"
    assert backend.status == "path_missing"  # backend/ dir doesn't exist

    rel = result.relations[0]
    assert rel.source_key == "backend"
    assert rel.target_key == "frontend"
    assert rel.relation_type == "publishes_to"


# ── 2. Missing id fallback ───────────────────────────────────────────────


def test_missing_id_fallback_to_name(tmp_path: Path) -> None:
    """YAML without 'id' field falls back to 'name'."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "my-component.yaml",
        "name: My Component\ntype: library\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 1
    ws = result.workspaces[0]
    assert ws.component_key == "My Component"
    assert ws.name == "My Component"
    assert any(w.code == "missing_id" for w in result.warnings)


# ── 3. Duplicate id ──────────────────────────────────────────────────────


def test_duplicate_id(tmp_path: Path) -> None:
    """Two YAML files with same id -> second skipped."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(projects, "a.yaml", "id: same-id\nname: A\n")
    _write_yaml(projects, "b.yaml", "id: same-id\nname: B\n")

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 1
    assert result.workspaces[0].name == "A"
    dup_warnings = [w for w in result.warnings if w.code == "duplicate_id"]
    assert len(dup_warnings) == 1
    assert "same-id" in dup_warnings[0].detail


# ── 4. YAML syntax error ────────────────────────────────────────────────


def test_yaml_error(tmp_path: Path) -> None:
    """Malformed YAML -> error recorded, other files still parsed."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(projects, "bad.yaml", "id: [\n  invalid\n")
    _write_yaml(projects, "good.yaml", "id: good\nname: Good\n")

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 1
    assert result.workspaces[0].component_key == "good"
    assert any(e.code == "yaml_error" for e in result.errors)


# ── 5. Unknown relation target ───────────────────────────────────────────


def test_unknown_relation_target(tmp_path: Path) -> None:
    """Relation referencing non-existent target -> warning, relation dropped."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "a.yaml",
        "id: a\nname: A\nrelations:\n  - target: nonexistent\n    type: depends_on\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 1
    assert len(result.relations) == 0
    assert any(w.code == "unknown_relation_target" for w in result.warnings)


# ── 6. Self relation ────────────────────────────────────────────────────


def test_self_relation(tmp_path: Path) -> None:
    """Relation where target == source -> warning, relation dropped."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "a.yaml",
        "id: a\nname: A\nrelations:\n  - target: a\n    type: depends_on\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.relations) == 0
    assert any(w.code == "self_relation" for w in result.warnings)


# ── 7. Projects directory missing ────────────────────────────────────────


def test_missing_projects_dir(tmp_path: Path) -> None:
    """No .sillyspec/projects/ -> empty result, warning."""
    result = WorkspaceParser().parse(tmp_path)

    assert result.workspaces == []
    assert result.relations == []
    assert any(w.code == "missing_projects_dir" for w in result.warnings)


# ── 8. Path missing ─────────────────────────────────────────────────────


def test_path_missing(tmp_path: Path) -> None:
    """parsed.path points to non-existent directory -> status='path_missing'."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "a.yaml",
        "id: a\nname: A\npath: nonexistent-dir\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.workspaces) == 1
    assert result.workspaces[0].status == "path_missing"


# ── 9. Unknown relation type ────────────────────────────────────────────


def test_unknown_relation_type(tmp_path: Path) -> None:
    """Relation with invalid type -> warning, relation dropped."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(projects, "a.yaml", "id: a\nname: A\n")
    _write_yaml(
        projects,
        "b.yaml",
        "id: b\nname: B\nrelations:\n  - target: a\n    type: invalid_type\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert len(result.relations) == 0
    assert any(w.code == "unknown_relation_type" for w in result.warnings)


# ── Additional edge cases ────────────────────────────────────────────────


def test_yaml_not_mapping(tmp_path: Path) -> None:
    """YAML that parses to a non-mapping -> error."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(projects, "list.yaml", "- item1\n- item2\n")

    result = WorkspaceParser().parse(tmp_path)

    assert any(e.code == "yaml_not_mapping" for e in result.errors)


def test_empty_projects_dir(tmp_path: Path) -> None:
    """Projects dir exists but is empty -> empty result."""
    (tmp_path / ".sillyspec" / "projects").mkdir(parents=True)

    result = WorkspaceParser().parse(tmp_path)

    assert result.workspaces == []
    assert result.relations == []


def test_parse_result_fields_renamed() -> None:
    """ParseResult uses 'workspaces' not 'components'."""
    pr = ParseResult()
    assert hasattr(pr, "workspaces")
    assert not hasattr(pr, "components")


def test_parsed_workspace_dataclass_fields() -> None:
    """ParsedWorkspace has all required fields."""
    ws = ParsedWorkspace(
        component_key="test",
        name="Test",
        type=None,
        role=None,
        path=None,
        repo_url=None,
        default_branch=None,
        tech_stack=[],
        build_command=None,
        test_command=None,
        source_yaml_path="test.yaml",
        status="active",
        extra={},
    )
    assert ws.component_key == "test"
    assert ws.tech_stack == []


def test_invalid_relation_entry_not_dict(tmp_path: Path) -> None:
    """Relation entry that is not a dict -> warning."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(
        projects,
        "a.yaml",
        "id: a\nname: A\nrelations:\n  - just_a_string\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert any(w.code == "invalid_relation" for w in result.warnings)


def test_relation_missing_target_and_type(tmp_path: Path) -> None:
    """Relation with missing target or type -> warning."""
    projects = tmp_path / ".sillyspec" / "projects"
    _write_yaml(projects, "a.yaml", "id: a\nname: A\n")
    _write_yaml(
        projects,
        "b.yaml",
        "id: b\nname: B\nrelations:\n  - description: no target or type\n",
    )

    result = WorkspaceParser().parse(tmp_path)

    assert any(w.code == "invalid_relation" for w in result.warnings)


def test_no_pure_function_no_db_imports() -> None:
    """WorkspaceParser must not import DB or FastAPI dependencies."""
    import importlib

    import app.modules.workspace.parser as parser_mod

    source = importlib.util.find_spec("app.modules.workspace.parser")
    assert source is not None
    import inspect

    src = inspect.getsource(parser_mod)
    for forbidden in ("sqlalchemy", "sqlmodel", "fastapi"):
        assert forbidden not in src, f"parser.py must not import {forbidden}"
