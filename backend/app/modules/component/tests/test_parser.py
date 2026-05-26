"""ComponentParser tests — exercise every edge case in task-03 §3.5."""

from __future__ import annotations

from pathlib import Path

from app.modules.component.parser import ComponentParser

VALID_ROOT = Path(__file__).parent / "fixtures" / "valid"
INVALID_ROOT = Path(__file__).parent / "fixtures" / "invalid"


def codes(issues) -> list[str]:
    return [i.code for i in issues]


def test_valid_fixture_parses_two_components_and_one_relation() -> None:
    parser = ComponentParser()
    result = parser.parse(VALID_ROOT)
    assert len(result.components) == 2
    keys = sorted(c.component_key for c in result.components)
    assert keys == ["silly", "silly-admin-ui"]
    assert all(c.status == "active" for c in result.components)
    assert result.warnings == []
    assert result.errors == []
    assert len(result.relations) == 1
    rel = result.relations[0]
    assert rel.source_key == "silly-admin-ui"
    assert rel.target_key == "silly"
    assert rel.relation_type == "consumes_api_from"


def test_extra_fields_and_extra_commands_preserved_on_extra() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    extras = {c.component_key: c.extra for c in result.components}
    assert "with-extras" in extras
    assert extras["with-extras"]["custom_owner"] == "qinyi"
    assert extras["with-extras"]["sla"] == {"uptime": 99.9}
    # commands beyond build/test go to extra.commands
    assert extras["with-extras"]["commands"] == {"lint": "make lint", "deploy": "make release"}


def test_missing_id_skipped_with_warning() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "missing_id" in codes(result.warnings)


def test_duplicate_id_skipped_with_warning() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "duplicate_id" in codes(result.warnings)
    dup_components = [c for c in result.components if c.component_key == "dup"]
    assert len(dup_components) == 1
    assert dup_components[0].name == "First Duplicate"


def test_yaml_syntax_error_recorded_and_other_files_survive() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "yaml_error" in codes(result.errors)
    # despite bad-syntax.yaml, other components still parsed
    assert {c.component_key for c in result.components} >= {"dup", "alone", "with-extras"}


def test_unknown_relation_target_dropped_with_warning() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "unknown_relation_target" in codes(result.warnings)


def test_self_relation_dropped_with_warning() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "self_relation" in codes(result.warnings)


def test_invalid_relation_missing_fields_dropped() -> None:
    parser = ComponentParser()
    result = parser.parse(INVALID_ROOT)
    assert "invalid_relation" in codes(result.warnings)


def test_path_missing_marked_in_status(tmp_path: Path) -> None:
    (tmp_path / ".sillyspec" / "projects").mkdir(parents=True)
    (tmp_path / ".sillyspec" / "projects" / "a.yaml").write_text(
        "id: a\nname: A\npath: ./does-not-exist\n",
        encoding="utf-8",
    )
    parser = ComponentParser()
    result = parser.parse(tmp_path)
    assert len(result.components) == 1
    assert result.components[0].status == "path_missing"


def test_missing_projects_dir_warned_and_returns_empty(tmp_path: Path) -> None:
    parser = ComponentParser()
    result = parser.parse(tmp_path)
    assert "missing_projects_dir" in codes(result.warnings)
    assert result.components == []


def test_unknown_relation_type_dropped(tmp_path: Path) -> None:
    p = tmp_path / ".sillyspec" / "projects"
    p.mkdir(parents=True)
    (p / "a.yaml").write_text("id: a\nname: A\n", encoding="utf-8")
    (p / "b.yaml").write_text(
        "id: b\nname: B\nrelations:\n  - target: a\n    type: makes_coffee_for\n",
        encoding="utf-8",
    )
    parser = ComponentParser()
    result = parser.parse(tmp_path)
    assert "unknown_relation_type" in codes(result.warnings)
    assert result.relations == []


def test_parse_throughput_under_threshold() -> None:
    """Parsing the bundled valid fixture must stay well under 200ms (task-02 AC-08 spirit)."""
    import time

    parser = ComponentParser()
    start = time.perf_counter()
    result = parser.parse(VALID_ROOT)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert len(result.components) == 2
    assert elapsed_ms < 200, f"parser took {elapsed_ms:.1f}ms (>200ms budget)"
