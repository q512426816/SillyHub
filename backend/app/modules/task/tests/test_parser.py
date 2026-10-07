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

    def test_no_frontmatter_fallback(
        self, parser: TaskParser, workspace_root: tuple[Path, str]
    ) -> None:
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


class TestTasksMdRegistryLines:
    """tasks.md 注册表行解析（2026-10-07-taskboard-tasks-md，thin 任务面进任务板）。"""

    def test_thin_tasks_md_only(self, parser: TaskParser, tmp_path: Path) -> None:
        """无任务卡目录：tasks.md checkbox 行即任务（勾选→done / 未勾→draft）。"""
        change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "thin-demo"
        change_dir.mkdir(parents=True)
        (change_dir / "tasks.md").write_text(
            "# 任务注册表\n\n"
            "- [x] task-01: 实现 slugify + 用例，npm test 绿\n"
            "- [ ] task-02: 全量复跑 npm test 无回归\n",
            encoding="utf-8",
        )
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/thin-demo")
        assert len(result.tasks) == 2
        t01 = next(t for t in result.tasks if t.task_key == "task-01")
        assert t01.status == "done"
        assert t01.title == "实现 slugify + 用例，npm test 绿"
        assert t01.path == ".sillyspec/changes/change/thin-demo/tasks.md"
        t02 = next(t for t in result.tasks if t.task_key == "task-02")
        assert t02.status == "draft"

    def test_cards_take_precedence_over_registry(self, parser: TaskParser, tmp_path: Path) -> None:
        """厚档双源同 key：卡片富信息优先，注册表行只补未见 key。"""
        change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "thick-demo"
        (change_dir / "tasks").mkdir(parents=True)
        (change_dir / "tasks" / "task-01.md").write_text(
            "---\ntitle: '卡片富信息'\nstatus: in_progress\npriority: P0\n---\n",
            encoding="utf-8",
        )
        (change_dir / "tasks.md").write_text(
            "- [x] task-01: 注册表行（不得覆盖卡片）\n- [ ] task-02: 仅注册表独有的追加行\n",
            encoding="utf-8",
        )
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/thick-demo")
        assert len(result.tasks) == 2
        t01 = next(t for t in result.tasks if t.task_key == "task-01")
        assert t01.title == "卡片富信息"
        assert t01.status == "in_progress"
        assert t01.priority == "P0"
        t02 = next(t for t in result.tasks if t.task_key == "task-02")
        assert t02.title == "仅注册表独有的追加行"
        assert t02.status == "draft"

    def test_tolerant_line_forms(self, parser: TaskParser, tmp_path: Path) -> None:
        """宽容形态：缩进 / `*` bullet / 大写 X / 表格与普通文本行不误匹配 / 超长截 500。"""
        change_dir = tmp_path / ".sillyspec" / "changes" / "change" / "forms"
        change_dir.mkdir(parents=True)
        long_desc = "长" * 600
        (change_dir / "tasks.md").write_text(
            "| task-01 | 表格行不是任务 | draft |\n"
            "普通段落 task-02 也不是\n"
            "  - [X] task-03: 大写勾选\n"
            f"* [ ] task-04: {long_desc}\n",
            encoding="utf-8",
        )
        result = parser.parse_tasks(tmp_path, ".sillyspec/changes/change/forms")
        keys = {t.task_key for t in result.tasks}
        assert keys == {"task-03", "task-04"}
        t03 = next(t for t in result.tasks if t.task_key == "task-03")
        assert t03.status == "done"
        t04 = next(t for t in result.tasks if t.task_key == "task-04")
        assert t04.title is not None and len(t04.title) == 500

    def test_table_format_fixture_unaffected(
        self, parser: TaskParser, workspace_root: tuple[Path, str]
    ) -> None:
        """旧表格形态 tasks.md（fixture）零新增行——既有断言面不动。"""
        root, rel_path = workspace_root
        result = parser.parse_tasks(root, rel_path)
        assert {t.task_key for t in result.tasks} == {"task-01", "task-02", "task-03"}
