# 与 sillyhub-daemon/src/tool-kind.ts 保持同逻辑，单测用例共享，修改须同步。
"""工具种类识别纯函数。

提供 ``TOOL_KIND_VALUES`` 枚举常量与 ``classify_tool_kind`` 识别函数，供
backend 落库兜底（``submit_messages``）与 interactive 路径打标
（``_extract_sdk_messages``）使用。

判定顺序与 TS 版（``sillyhub-daemon/src/tool-kind.ts``）逐字对齐，单测用例
共享，修改须两端同步（design.md §7 / R-05）。
"""

from __future__ import annotations

TOOL_KIND_VALUES: tuple[str, ...] = (
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


def classify_tool_kind(
    tool_name: str | None,
    args: dict | None,
) -> str | None:
    """从 tool_name + args 推导 tool_kind。

    Returns:
        TOOL_KIND_VALUES 之一，或 None（非工具调用 / tool_name 缺失）。
    """
    if not tool_name:
        return None
    name = tool_name.lower()
    if name == "bash":
        cmd = (args or {}).get("command") or ""
        return "sillyspec" if "sillyspec" in cmd else "bash"
    if name == "skill":
        return "skill"
    if name == "read":
        return "read"
    if name in {"write", "edit", "multiedit", "notebookedit"}:
        return "write"
    if name in {"grep", "glob"}:
        return "search"
    if name in {"task", "agent"}:
        return "task"
    if name in {"websearch", "webfetch"}:
        return "web"
    if name in {"todowrite", "taskcreate", "taskupdate", "taskget", "tasklist"}:
        return "todo"
    if name == "exitplanmode":
        return "plan"
    if name == "askuserquestion":
        return "ask"
    if name.startswith("cron") or name == "schedulewakeup":
        return "schedule"
    if name.startswith("mcp__"):
        return "mcp"
    return "other"
