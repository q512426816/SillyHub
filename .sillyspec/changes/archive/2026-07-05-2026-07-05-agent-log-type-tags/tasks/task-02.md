---
id: task-02
title: backend classify_tool_kind Python 识别函数 + 单测
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/agent/tool_kind.py
  - backend/tests/modules/agent/test_tool_kind.py
goal: 提供 Python 版工具种类识别纯函数，供 backend 落库兜底与 interactive 路径打标
implementation: 新建 tool_kind.py 实现 TOOL_KIND_VALUES(14枚举) + classify_tool_kind(tool_name,args)（design §7 逐字参照）；新建 test_tool_kind.py 全枚举+边界覆盖
acceptance: 14 枚举全覆盖；sillyspec 子串匹配（复合命令/npx wrapper）；MCP 统一 mcp；None→None；未知→other；pytest 通过
verify: cd backend && uv run pytest tests/modules/agent/test_tool_kind.py -v；uv run mypy app/modules/agent/tool_kind.py
constraints: D-001 不分 sillyspec 子命令；D-002 MCP 统一一类；与 task-03 TS 版同逻辑共享用例表（R-05 防漂移）；mypy type:ignore 禁中文
provides:
  - contract: classify_tool_kind
    fields: [TOOL_KIND_VALUES, classify_tool_kind]
expects_from: {}
---

# task-02 · backend classify_tool_kind（Python）

## goal

提供 Python 版工具种类识别纯函数，供 task-04 backend 落库兜底与 `_extract_sdk_messages` interactive 路径打标。覆盖 design §7 Python 接口、FR-02（Python 侧）。

## implementation

1. 新建 `backend/app/modules/agent/tool_kind.py`：`TOOL_KIND_VALUES` 14 元组（sillyspec/skill/bash/read/write/search/task/web/todo/plan/ask/schedule/mcp/other）+ `classify_tool_kind(tool_name, args) -> str | None`，**逐字参照 design §7 Python 实现**（判定顺序：tool_name 缺失→None；Bash+command 含 sillyspec→sillyspec，否则 bash；Skill→skill；Read→read；Write/Edit/MultiEdit/NotebookEdit→write；Grep/Glob→search；Task/Agent→task；WebSearch/WebFetch→web；TodoWrite/Task*→todo；ExitPlanMode→plan；AskUserQuestion→ask；cron*/ScheduleWakeup→schedule；mcp__ 前缀→mcp；其余→other）。
2. 新建 `backend/tests/modules/agent/test_tool_kind.py`：全枚举覆盖 + 边界（`sillyspec run x && git commit`、`npx sillyspec`、未知工具、`tool_name=None`、`mcp__playwright__browser_navigate`）。
3. 用例表与 task-03 TS 版一一对应（同输入同输出，R-05 防漂移）。

## 验收标准

- [ ] 14 枚举全覆盖（每个 kind 至少 1 个用例）
- [ ] `sillyspec` 子串匹配：复合命令 `&&`、`npx sillyspec` wrapper 都识别为 sillyspec
- [ ] MCP 工具统一 `mcp`，不细分 server/tool（D-002@v1）
- [ ] `tool_name=None`/空 → 返回 None；未知工具 → `other`
- [ ] pytest 通过；mypy 通过（type:ignore 后禁中文，记忆 mypy-type-ignore-no-chinese）

## verify

- `cd backend && uv run pytest tests/modules/agent/test_tool_kind.py -v`
- `cd backend && uv run mypy app/modules/agent/tool_kind.py`
- `cd backend && uv run ruff check app/modules/agent/tool_kind.py`

## constraints

- D-001@v1：不分子命令（所有 sillyspec 调用一个标签）。
- D-002@v1：MCP 统一一类。
- 与 task-03 TS 版同逻辑共享用例表（R-05 防漂移）；文件头注释互引。
