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


def _is_sillyspec_command(cmd: str) -> bool:
    """ql-20260705-006 (C3)：command 任一段（&&/;/|）主命令是 sillyspec 才归 sillyspec。

    覆盖直接调用（sillyspec run scan）/ pnpm/npx/yarn/sudo/node 包装 / 复合命令
    任一段（git add . && sillyspec run execute）。排除脚本内容（python -c
    "...sillyspec..."）/ grep sillyspec / cat sillyspec-note.md 等参数含字样的
    误归（推翻 D-001 子串语义——DB 实测 run be48ad3a 的 41 条 sillyspec 里
    34 条 83% 是此类误归）。
    """
    for sep in ("&&", ";", "|"):
        cmd = cmd.replace(sep, "\n")
    for line in cmd.split("\n"):
        parts = line.strip().split()
        if not parts:
            continue
        idx = 0
        while idx < len(parts) - 1 and parts[idx] in {"pnpm", "npx", "yarn", "sudo", "node"}:
            idx += 1
        if parts[idx] == "sillyspec":
            return True
    return False


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
        raw_cmd = (args or {}).get("command")
        cmd = raw_cmd if isinstance(raw_cmd, str) else ""
        return "sillyspec" if _is_sillyspec_command(cmd) else "bash"
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
