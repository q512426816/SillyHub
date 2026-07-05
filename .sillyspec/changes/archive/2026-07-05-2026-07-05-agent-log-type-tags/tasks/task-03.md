---
id: task-03
title: daemon classifyToolKind TS 识别函数 + 单测（与 Python 同逻辑）
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/tool-kind.ts
  - sillyhub-daemon/tests/tool-kind.test.ts
goal: 提供 TS 版工具种类识别纯函数供 daemon task-runner 打标，与 task-02 Python 版同逻辑
implementation: 新建 tool-kind.ts（TOOL_KIND_VALUES as const + ToolKind 类型 + classifyToolKind，design §7 TS 逐字参照）；新建 tool-kind.test.ts 与 Python 用例表一一对应
acceptance: 14 枚举全覆盖；与 Python 版同输入同输出（R-05）；sillyspec 子串匹配；MCP 统一 mcp；vitest 通过
verify: cd sillyhub-daemon && pnpm vitest run tests/tool-kind.test.ts（或 npm test）
constraints: 与 task-02 Python 版同逻辑（注释互引）；D-001 不分子命令；D-002 MCP 统一；测试放 tests/（daemon 既有测试目录）
provides:
  - contract: classifyToolKind
    fields: [TOOL_KIND_VALUES, ToolKind, classifyToolKind]
expects_from: {}
---

# task-03 · daemon classifyToolKind（TS）

## goal

提供 TypeScript 版工具种类识别纯函数，供 task-06 daemon `task-runner.ts` tool_use 分支打标。与 task-02 Python 版**同逻辑**（共享用例表）。覆盖 design §7 TS 接口、FR-02（TS 侧）。

## implementation

1. 新建 `sillyhub-daemon/src/tool-kind.ts`：`TOOL_KIND_VALUES as const`（14 值）+ `ToolKind` 类型 + `classifyToolKind(toolName, args) -> ToolKind | null`，**逐字参照 design §7 TypeScript 实现**（判定逻辑与 task-02 Python 完全一致）。
2. 文件头注释：「与 `backend/app/modules/agent/tool_kind.py` 保持同逻辑，单测用例共享，修改须同步」（R-05）。
3. 新建 `sillyhub-daemon/tests/tool-kind.test.ts`：与 task-02 Python test 用例表一一对应（同输入同输出），用 vitest（daemon 既有测试框架，参照 `tests/version.test.ts` 风格）。

## 验收标准

- [ ] 14 枚举全覆盖
- [ ] 与 task-02 Python 版同输入同输出（R-05 防漂移核心）
- [ ] `sillyspec` 子串匹配（复合命令、npx wrapper）
- [ ] MCP 工具统一 `mcp`；`toolName=null/undefined` → 返回 null；未知 → `other`
- [ ] vitest 通过

## verify

- `cd sillyhub-daemon && pnpm vitest run tests/tool-kind.test.ts`（或 `npm test`，按 package.json:15 `vitest run --passWithNoTests`）

## constraints

- **R-05 双实现漂移**：靠共享用例表 + 注释互引；改一边必须同步另一边。
- D-001@v1：不分子命令；D-002@v1：MCP 统一一类。
- 测试放 `tests/`（daemon 既有测试目录，参照 version.test.ts），不放 `src/`。
