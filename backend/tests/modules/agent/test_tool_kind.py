"""classify_tool_kind 单测。

用例与 ``sillyhub-daemon/src/tool-kind.test.ts`` 共享（同输入→同输出），
R-05 防 Python/TS 两份逻辑漂移；修改须两端同步。
"""

from __future__ import annotations

import pytest

from app.modules.agent.tool_kind import TOOL_KIND_VALUES, classify_tool_kind

# ---------------------------------------------------------------------------
# 共享用例表（task-03 TS 版逐字对照）：(tool_name, args, expected)
# ---------------------------------------------------------------------------
SHARED_CASES: list[tuple[str | None, dict | None, str | None]] = [
    # --- sillyspec（ql-20260705-006 主命令判定：直接调用 / 包装 / 复合命令都归）
    ("Bash", {"command": "sillyspec run execute"}, "sillyspec"),
    ("Bash", {"command": "sillyspec run plan"}, "sillyspec"),
    ("Bash", {"command": "sillyspec run execute && git commit"}, "sillyspec"),
    ("Bash", {"command": "git add . && sillyspec run execute"}, "sillyspec"),
    ("Bash", {"command": "npx sillyspec run plan"}, "sillyspec"),
    ("Bash", {"command": "pnpm sillyspec run verify"}, "sillyspec"),
    # --- bash（普通命令 / ql-20260705-006 排除脚本内容含 sillyspec 字样误归）
    ("Bash", {"command": "ls -la"}, "bash"),
    ("Bash", {"command": "git status"}, "bash"),
    ("Bash", {"command": "uv run pytest -v"}, "bash"),
    ("Bash", {"command": "cat docs/sillyspec-note.md"}, "bash"),
    ("Bash", {"command": "grep sillyspec *.ts"}, "bash"),
    ("Bash", {}, "bash"),
    ("Bash", None, "bash"),
    # --- skill
    ("Skill", {"name": "sillyspec-execute"}, "skill"),
    ("Skill", {}, "skill"),
    # --- read
    ("Read", {"file_path": "/tmp/a.txt"}, "read"),
    # --- write（Write/Edit/MultiEdit/NotebookEdit 统一 write）
    ("Write", {"file_path": "/tmp/a.txt"}, "write"),
    ("Edit", {"file_path": "/tmp/a.txt"}, "write"),
    ("MultiEdit", {"file_path": "/tmp/a.txt"}, "write"),
    ("NotebookEdit", {"notebook_path": "/tmp/n.ipynb"}, "write"),
    # --- search（Grep/Glob）
    ("Grep", {"pattern": "foo"}, "search"),
    ("Glob", {"pattern": "**/*.py"}, "search"),
    # --- task（Task/Agent）
    ("Task", {"description": "research"}, "task"),
    ("Agent", {"description": "research"}, "task"),
    # --- web（WebSearch/WebFetch）
    ("WebSearch", {"query": "foo"}, "web"),
    ("WebFetch", {"url": "https://example.com"}, "web"),
    # --- todo（TodoWrite/TaskCreate/TaskUpdate/TaskGet/TaskList）
    ("TodoWrite", {"todos": []}, "todo"),
    ("TaskCreate", {"subject": "x"}, "todo"),
    ("TaskUpdate", {"taskId": "1"}, "todo"),
    ("TaskGet", {"taskId": "1"}, "todo"),
    ("TaskList", {}, "todo"),
    # --- plan（ExitPlanMode）
    ("ExitPlanMode", {"plan": "..."}, "plan"),
    # --- ask（AskUserQuestion）
    ("AskUserQuestion", {"question": "?"}, "ask"),
    # --- schedule（cron* / ScheduleWakeup）
    ("CronCreate", {"cron": "0 9 * * *"}, "schedule"),
    ("CronDelete", {"id": "x"}, "schedule"),
    ("CronList", {}, "schedule"),
    ("ScheduleWakeup", {"time": "2026-07-05"}, "schedule"),
    # --- mcp（D-002 统一一类，不细分 server/tool）
    ("mcp__playwright__browser_navigate", {"url": "x"}, "mcp"),
    ("mcp__playwright__browser_click", {"selector": "x"}, "mcp"),
    ("mcp__filesystem__read_file", {"path": "x"}, "mcp"),
    # --- other（未知工具）
    ("UnknownTool", {"foo": "bar"}, "other"),
    ("SomeFutureTool", {}, "other"),
    # --- None / 空（非工具调用）
    (None, {"command": "ls"}, None),
    (None, None, None),
    ("", {"command": "ls"}, None),
]


@pytest.mark.parametrize(("tool_name", "args", "expected"), SHARED_CASES)
def test_classify_tool_kind_shared_cases(
    tool_name: str | None, args: dict | None, expected: str | None
) -> None:
    """共享用例：与 TS 版逐字对照（R-05 防漂移）。"""
    assert classify_tool_kind(tool_name, args) == expected


def test_tool_kind_values_contains_all_14() -> None:
    """TOOL_KIND_VALUES 必须为 14 枚举且顺序固定（schema/前端对齐）。"""
    assert TOOL_KIND_VALUES == (
        "sillyspec",
        "skill",
        "bash",
        "read",
        "write",
        "search",
        "task",
        "web",
        "todo",
        "plan",
        "ask",
        "schedule",
        "mcp",
        "other",
    )
    assert len(TOOL_KIND_VALUES) == 14
    assert len(set(TOOL_KIND_VALUES)) == 14  # 无重复


def test_every_kind_covered_by_shared_cases() -> None:
    """每个 kind 至少 1 个用例（含 None 兜底）—— 验收标准硬约束。"""
    covered: set[str | None] = {result for _, _, result in SHARED_CASES}
    for kind in TOOL_KIND_VALUES:
        assert kind in covered, f"kind 缺少用例: {kind}"
    assert None in covered  # tool_name 缺失兜底


def test_case_insensitive() -> None:
    """工具名大小写归一化（.lower()）。"""
    assert classify_tool_kind("BASH", {"command": "ls"}) == "bash"
    assert classify_tool_kind("Bash", {"command": "sillyspec run plan"}) == "sillyspec"
    assert classify_tool_kind("READ", {"file_path": "x"}) == "read"
    assert classify_tool_kind("skill", {"name": "x"}) == "skill"
    assert classify_tool_kind("MCP__X__Y", {}) == "mcp"
    assert classify_tool_kind("EXITPLANMODE", {}) == "plan"


def test_bash_missing_command_key() -> None:
    """Bash 但 args 无 command 键 → bash（非 sillyspec）。"""
    assert classify_tool_kind("Bash", {"foo": "bar"}) == "bash"
    assert classify_tool_kind("Bash", {}) == "bash"
    assert classify_tool_kind("Bash", None) == "bash"


def test_bash_command_not_string() -> None:
    """ql-20260705-006：Bash command 非 str → 兜底 "" 归 bash（isinstance 守卫）。"""
    # design 实现：raw_cmd if isinstance(raw_cmd, str) else ""——非 str 兜底 ""，
    # 与 TS `typeof rawCmd === 'string' ? rawCmd : ''` 同逻辑（R-05 防漂移）。
    assert classify_tool_kind("Bash", {"command": 123}) == "bash"  # type: ignore[arg-type]


def test_sillyspec_main_command_semantics() -> None:
    """ql-20260705-006 (C3)：推翻 D-001 子串语义，改主命令判定。

    command 任一段主命令是 sillyspec 才归 sillyspec；脚本内容/grep/cat 含
    sillyspec 字样不再误归（DB 实测 run be48ad3a 41 条 sillyspec 83% 误归）。
    """
    # 主命令判定：直接调用 + pnpm/npx 包装 + 复合命令任一段都归 sillyspec
    assert classify_tool_kind("Bash", {"command": "sillyspec run scan"}) == "sillyspec"
    assert classify_tool_kind("Bash", {"command": "npx sillyspec run plan"}) == "sillyspec"
    assert (
        classify_tool_kind("Bash", {"command": "git add . && sillyspec run execute"}) == "sillyspec"
    )
    # 排除误归：脚本内容 / grep / cat 含 sillyspec 字样 → bash
    assert classify_tool_kind("Bash", {"command": "cat docs/sillyspec-note.md"}) == "bash"
    assert classify_tool_kind("Bash", {"command": "grep sillyspec *.ts"}) == "bash"
    assert classify_tool_kind("Bash", {"command": "python -c \"print('sillyspec')\""}) == "bash"
    # 大小写：cmd 不归一化，SillySpec 大写 != sillyspec → bash
    assert classify_tool_kind("Bash", {"command": "SillySpec run plan"}) == "bash"


def test_mcp_prefix_only() -> None:
    """D-002：mcp__ 前缀统一 mcp，不细分 server/tool。"""
    assert classify_tool_kind("mcp__anything__sub", {}) == "mcp"
    # 不是 mcp__ 前缀（仅包含 mcp）→ other
    assert classify_tool_kind("my_mcp_tool", {}) == "other"


def test_cron_prefix_and_schedule_wakeup() -> None:
    """schedule：cron* 前缀或 ScheduleWakeup。"""
    assert classify_tool_kind("CronCreate", {}) == "schedule"
    assert classify_tool_kind("cronList", {}) == "schedule"  # 小写前缀
    assert classify_tool_kind("ScheduleWakeup", {}) == "schedule"
    # 仅前缀含 cron 但非开头 → other
    assert classify_tool_kind("Recron", {}) == "other"
