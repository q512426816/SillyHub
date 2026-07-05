---
id: task-06
title: daemon task-runner tool_use 分支打 tool_kind
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
goal: daemon batch 路径 tool_use 分支识别工具种类，写 tool_call JSON message 顶层 tool_kind 字段
implementation: task-runner.ts:1708-1798 tool_use 分支调 classifyToolKind(task-03)；写 tool_call JSON message(1794-1798)顶层 tool_kind 字段；stdout 文本行(1762-1766)不带；decline分支(1716-1727)不打
acceptance: tool_use 的 tool_call JSON message 含顶层 tool_kind；stdout 文本行不带；decline 不受影响；batch 单测验证
verify: cd sillyhub-daemon && pnpm vitest run tests/task-runner*.test.ts（或现有 task-runner 测试）
constraints: C-01 message metadata→顶层字段；C-02 只 tool_call JSON 行带（design §5）；classifyToolKind 来自 task-03；D-001 不下放子命令
provides:
  - contract: daemon_message
    fields: [tool_kind]
expects_from:
  task-03:
    - contract: classifyToolKind
      needs: [classifyToolKind]
---

# task-06 · daemon task-runner tool_use 打标

## goal

daemon batch 路径（task-runner）在 tool_use 分支识别工具种类，写入 tool_call JSON message 的**顶层** `tool_kind` 字段（C-01/02 Grill 修正）。覆盖 design §5 Phase 2 daemon 段、FR-03。

## implementation

1. **task-runner.ts:1708-1798** tool_use 分支：从 `md.tool_name`（1710）+ `md.tool_input`（1728）调 `classifyToolKind`（task-03）得 tool_kind。
2. **写 tool_call JSON message（1794-1798）顶层**：在 `messages.push({ event_type, content: tcContent, channel: 'tool_call' })` 对象加 `tool_kind` 属性（与 event_type/content/channel 同级，参照 1778/1787 toolUseId 条件展开注入模式）。
3. **stdout `[TOOL_USE]` 文本 message（1762-1766）不带** tool_kind（C-02：它是 SemanticCategory=log，不在工具筛选维度）。
4. **approval decline 分支（1716-1727）不打**（走 stderr，非工具调用语义）。

## 验收标准

- [ ] tool_use 的 tool_call JSON message 含顶层 `tool_kind` 字段
- [ ] 配对的 stdout `[TOOL_USE]` 文本 message 不带 tool_kind
- [ ] decline 分支不受影响（仍走 stderr）
- [ ] batch 路径单测验证（含 null 退化向后兼容）

## verify

- `cd sillyhub-daemon && pnpm vitest run tests/task-runner*.test.ts`（或现有 task-runner 测试模块）

## constraints

- **C-01 措辞修正**："message metadata" → message 顶层 `tool_kind` 字段（design §5 已修正，避免与 `msg.metadata` segmentId 混淆）。
- **C-02**：只 tool_call JSON 行带 tool_kind，配对 stdout 文本行不带。
- `classifyToolKind` 来自 task-03；D-001@v1 不下放 sillyspec 子命令。
