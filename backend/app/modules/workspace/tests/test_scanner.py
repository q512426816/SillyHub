"""Scanner unit tests — pure filesystem, no DB."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from app.modules.workspace.scanner import (
    WARN_MISSING_PROJECTS_DIR,
    WARN_NO_SILLYSPEC,
    ScanResult,
    WorkspaceScanner,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "minimal-sillyspec"


def test_minimal_fixture_is_recognised() -> None:
    result = WorkspaceScanner().scan(FIXTURE_DIR)
    assert result.is_sillyspec is True
    assert result.warnings == []
    structure = result.structure
    assert structure.has_projects_dir is True
    assert structure.has_changes_dir is True
    assert structure.has_local_yaml is True
    assert structure.has_docs_dir is False
    assert structure.projects_count == 0
    assert structure.active_changes_count == 0
    assert structure.archived_changes_count == 0


def test_missing_sillyspec(tmp_path: Path) -> None:
    result = WorkspaceScanner().scan(tmp_path)
    assert result.is_sillyspec is False
    assert WARN_NO_SILLYSPEC in result.warnings


def test_missing_projects_dir(tmp_path: Path) -> None:
    (tmp_path / "changes" / "change").mkdir(parents=True)
    (tmp_path / "changes" / "archive").mkdir(parents=True)
    result = WorkspaceScanner().scan(tmp_path)
    assert result.is_sillyspec is True
    assert WARN_MISSING_PROJECTS_DIR in result.warnings
    assert result.structure.has_projects_dir is False


def test_counts_projects_and_changes(tmp_path: Path) -> None:
    base = tmp_path
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)

    (base / "projects" / "a.yaml").write_text("name: a\n", encoding="utf-8")
    (base / "projects" / "b.yml").write_text("name: b\n", encoding="utf-8")
    (base / "projects" / "not-yaml.txt").write_text("ignored\n", encoding="utf-8")

    (base / "changes" / "change" / "2026-05-25-foo").mkdir()
    (base / "changes" / "change" / "lone.md").write_text("# lone\n", encoding="utf-8")
    (base / "changes" / "change" / ".gitkeep").write_text("", encoding="utf-8")
    (base / "changes" / "archive" / "2026-01-01-bar").mkdir()

    result = WorkspaceScanner().scan(tmp_path)
    assert result.is_sillyspec is True
    assert result.warnings == []
    assert result.structure.projects_count == 2
    assert result.structure.active_changes_count == 2
    assert result.structure.archived_changes_count == 1


def test_handles_chinese_and_spaces(tmp_path: Path) -> None:
    nested = tmp_path / "中文 空格" / "repo"
    (nested / "projects").mkdir(parents=True)
    (nested / "changes" / "change").mkdir(parents=True)
    (nested / "changes" / "archive").mkdir(parents=True)
    result = WorkspaceScanner().scan(nested)
    assert result.is_sillyspec is True


@pytest.mark.parametrize("project_count, change_count", [(10, 20)])
def test_scan_is_fast_on_realistic_workspace(
    tmp_path: Path, project_count: int, change_count: int
) -> None:
    """AC-08: scanning a 10-component / 20-change workspace must take <200ms."""
    base = tmp_path
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    for i in range(project_count):
        (base / "projects" / f"component-{i:02d}.yaml").write_text(
            f"name: c{i}\n", encoding="utf-8"
        )
    for i in range(change_count):
        (base / "changes" / "change" / f"2026-05-25-c-{i:02d}").mkdir()

    # Warm-up: ensure FS cache is hot, otherwise CI flakes
    scanner = WorkspaceScanner()
    scanner.scan(tmp_path)

    start = time.perf_counter()
    result = scanner.scan(tmp_path)
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert result.is_sillyspec is True
    assert result.structure.projects_count == project_count
    assert result.structure.active_changes_count == change_count
    assert elapsed_ms < 200, f"scan took {elapsed_ms:.1f}ms (>= 200ms budget)"


def test_dotfiles_under_change_are_ignored(tmp_path: Path) -> None:
    base = tmp_path
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    (base / "changes" / "change" / ".gitkeep").write_text("", encoding="utf-8")
    (base / "changes" / "change" / ".hidden").write_text("nope\n", encoding="utf-8")
    result = WorkspaceScanner().scan(tmp_path)
    assert result.structure.active_changes_count == 0


# --- task-05: ScanResult parser fields ---


def test_scan_result_parser_fields_default_empty() -> None:
    """ScanResult parser fields default to empty lists (AC-01)."""
    result = ScanResult(root_path="/tmp", sillyspec_path="/tmp/.sillyspec", is_sillyspec=False)
    assert result.parsed_workspaces == []
    assert result.parsed_relations == []
    assert result.parse_warnings == []
    assert result.parse_errors == []


def test_scan_fills_parser_fields(tmp_path: Path) -> None:
    """scan() populates parsed_workspaces when projects/*.yaml exists (AC-02, AC-03)."""
    base = tmp_path
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)

    (base / "projects" / "backend.yaml").write_text(
        "id: backend\nname: Backend\n", encoding="utf-8"
    )

    result = WorkspaceScanner().scan(tmp_path)
    assert len(result.parsed_workspaces) == 1
    assert result.parsed_workspaces[0].component_key == "backend"
    assert result.parsed_workspaces[0].name == "Backend"
    assert result.parsed_relations == []
    assert result.parse_errors == []


def test_scan_empty_projects_dir_parser_fields_empty(tmp_path: Path) -> None:
    """When projects/ dir exists but is empty, parsed_workspaces is []."""
    base = tmp_path
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)

    result = WorkspaceScanner().scan(tmp_path)
    assert result.parsed_workspaces == []
    assert result.parsed_relations == []
    assert result.parse_errors == []
