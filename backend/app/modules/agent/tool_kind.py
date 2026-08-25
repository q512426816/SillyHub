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

# 包装前缀集合（ql-20260705-006 C3）：pnpm/npx/yarn/sudo/node 包装的 sillyspec
# 调用同样归 sillyspec。与 TS 版 tool-kind.ts 逐字对齐，修改须两端同步。
_WRAPPER_PREFIXES = frozenset({"pnpm", "npx", "yarn", "sudo", "node"})


def iter_command_segments(command: str) -> list[str]:
    """按 &&/;/| 分段并剥 pnpm/npx/yarn/sudo/node 包装前缀，返回裸命令段列表。

    2026-08-25-session-spec-binding task-02（design §5 W1.4）：自
    ``_is_sillyspec_command`` 内部逻辑原样提取为公共函数，供 tool_kind 打标与
    change/binding.py 的 ``extract_spec_bindings`` 复用；空白归一为单空格
    （``parts[idx:]`` 重新 join），供下游做段首/前缀判定。

    语义与提取前逐字一致（行为不变，test_tool_kind.py 既有共享用例锁行为）：

    - 分段：``&&`` / ``;`` / ``|`` 全部替换为换行再 split（继承原实现，替换顺序
      依次进行，``||`` 会被拆成两个空段，跳过空段）。
    - 剥包装：段首连续的包装前缀 token 逐个跳过，但「段只剩一个 token」时不动
      （原 ``idx < len(parts) - 1`` 守卫，如裸 ``pnpm`` 不是命令）。
    - 段格式：从首个非包装 token 起的 token 以单空格 join（如
      ``pnpm sillyspec run plan`` → ``sillyspec run plan``；
      ``pnpm exec sillyspec …`` → ``exec sillyspec …``，exec 不在剥除集合）。
    """
    for sep in ("&&", ";", "|"):
        command = command.replace(sep, "\n")
    segments: list[str] = []
    for line in command.split("\n"):
        parts = line.strip().split()
        if not parts:
            continue
        idx = 0
        while idx < len(parts) - 1 and parts[idx] in _WRAPPER_PREFIXES:
            idx += 1
        segments.append(" ".join(parts[idx:]))
    return segments


def _is_sillyspec_command(cmd: str) -> bool:
    """ql-20260705-006 (C3)：command 任一段（&&/;/|）主命令是 sillyspec 才归 sillyspec。

    覆盖直接调用（sillyspec run scan）/ pnpm/npx/yarn/sudo/node 包装 / 复合命令
    任一段（git add . && sillyspec run execute）。排除脚本内容（python -c
    "...sillyspec..."）/ grep sillyspec / cat sillyspec-note.md 等参数含字样的
    误归（推翻 D-001 子串语义——DB 实测 run be48ad3a 的 41 条 sillyspec 里
    34 条 83% 是此类误归）。

    2026-08-25-session-spec-binding task-02：分段+剥包装已提取为
    :func:`iter_command_segments`，本函数改为消费其结果——主命令 = 裸命令段
    首 token（等价于提取前 ``parts[idx] == "sillyspec"`` 判定），行为零变化。
    """
    return any(segment.split()[0] == "sillyspec" for segment in iter_command_segments(cmd))


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
