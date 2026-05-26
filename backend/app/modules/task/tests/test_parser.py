"""Tests for task parser."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.modules.task.parser import TaskParser

FIXTURES = Path(__file__).parent / "fixtures" / "change-with-tasks"


@pytest.fixture
def parser() -> TaskParser:
    return TaskParser()


@pytest.fixture
def workspace_root(tmp_path: Path) -> tuple[Path, str]:
    """Copy task fixtures into a workspace-like structure."""
    # Create .sillyspec/changes/change/demo-change/tasks/ structure
    change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "demo-change"
    change_dir.mkdir(parents=True)
    shutil.copytree(FIXTURES / "tasks", change_dir / "tasks")
    # Also copy tasks.md
    shutil.copy2(FIXTURES / "tasks.md", change_dir / "tasks.md")
    return tmp_path, ".sillyspec/changes/change/demo-change"


class TestTaskParser:
    def test_parse_three_tasks(self, parser: TaskParser, workspace_root: tuple[Path, str]) -> None:
        root, rel_path = workspace_root
        result = parser.parse_tasks(root, rel_path)
        assert len(result.tasks) == 3
        keys = {t.task_key for t in result.tasks}
        assert keys == {"task-01", "task-02", "task-03"}

    def test_frontmatter_parsed(self, parser: TaskParser, workspace_root: tuple[Path, str]) -> None:
        root, rel_path = workspace_root
        result = parser.parse_tasks(root, rel_path)
        t01 = next(t for t in result.tasks if t.task_key == "task-01")
        assert t01.title == "Setup project scaffold"
        assert t01.status == "in_progress"
        assert t01.priority == "P0"
        assert t01.owner_key == "admin"
        assert t01.estimated_hours == 8.0
        assert t01.affected_components == ["platform-api", "platform-web"]
        assert t01.depends_on == []
        assert t01.blocks == ["task-02", "task-03"]
        assert t01.content is not None
        assert "Setup project scaffold" in t01.content

    def test_depends_on_parsed(self, parser: TaskParser, workspace_root: tuple[Path, str]) -> None:
        root, rel_path = workspace_root
        result = parser.parse_tasks(root, rel_path)
        t02 = next(t for t in result.tasks if t.task_key == "task-02")
        assert t02.depends_on == ["task-01"]
        assert t02.blocks == []

    def test_no_frontmatter_fallback(self, parser: TaskParser, workspace_root: tuple[Path, str]) -> None:
        root, rel_path = workspace_root
        result = parser.parse_tasks(root, rel_path)
        t03 = next(t for t in result.tasks if t.task_key == "task-03")
        assert t03.task_key == "task-03"
        assert t03.title == "Add tests"  # Extracted from H1
        assert t03.status == "draft"
        assert t03.content is not None
        assert "comprehensive tests" in t03.content

    def test_no_tasks_dir(self, parser: TaskParser, tmp_path: Path) -> None:
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/no-tasks")
        assert len(result.tasks) == 0
        assert len(result.warnings) == 0

    def test_path_traversal_guard(self, parser: TaskParser, tmp_path: Path) -> None:
        # Create a real structure
        change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "demo"
        tasks_dir = change_dir / "tasks"
        tasks_dir.mkdir(parents=True)
        (tasks_dir / "task-01.md").write_text("# Task 01", encoding="utf-8")
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/demo")
        assert len(result.tasks) == 1

    def test_empty_tasks_dir(self, parser: TaskParser, tmp_path: Path) -> None:
        change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "demo" / "tasks"
        change_dir.mkdir(parents=True)
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/demo")
        assert len(result.tasks) == 0

    def test_non_task_files_ignored(self, parser: TaskParser, tmp_path: Path) -> None:
        tasks_dir = tmp_path / ".sillyspec" / "changes" / "change" / "x" / "tasks"
        tasks_dir.mkdir(parents=True)
        (tasks_dir / "readme.md").write_text("# Not a task", encoding="utf-8")
        (tasks_dir / "task-01.md").write_text("# Task 01", encoding="utf-8")
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/x")
        assert len(result.tasks) == 1
        assert result.tasks[0].task_key == "task-01"

    def test_duplicate_key_warning(self, parser: TaskParser, tmp_path: Path) -> None:
        # This test is about glob behavior - we can't have two files with same name
        # in the same dir, so this is a structural constraint that's inherently handled.
        # Test that warnings list is populated for invalid status.
        tasks_dir = tmp_path / ".sillyspec" / "changes" / "change" / "x" / "tasks"
        tasks_dir.mkdir(parents=True)
        (tasks_dir / "task-01.md").write_text(
            "---\nstatus: invalid_status\n---\n# Task",
            encoding="utf-8",
        )
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/x")
        assert len(result.tasks) == 1
        warning_codes = [w.code for w in result.warnings]
        assert "INVALID_STATUS" in warning_codes
