---
id: task-07
title: frontend 类型加 tool_kind + toolKindMeta 徽标映射
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P1
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-08, FR-09]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/agent.ts
  - frontend/src/components/agent-log/tool-kind-meta.ts
goal: 前端 AgentRunLogEntry/StreamLogEvent 加 tool_kind 字段 + 提供 toolKindMeta 徽标映射（14枚举+null兜底）
implementation: agent.ts:46-68 手写类型加 tool_kind（不走 codegen，agent.ts 手写）；新建 tool-kind-meta.ts toolKindMeta(kind)->{label,Icon,badgeClass} 沿用 semanticCategoryMeta 配色风格
acceptance: 14 枚举+null 都有徽标；null 显示灰色通用「工具」；配色与 SemanticCategory 视觉协调；样式参考 archive frontend-style-system
verify: cd frontend && pnpm test（tool-kind-meta 单测）；pnpm lint
constraints: agent.ts 手写类型不走 OpenAPI codegen（核实确认）；D-001/002 枚举对齐 backend；lucide 图标贴合成语；标签≤3字
provides:
  - contract: toolKindMeta
    fields: [toolKindMeta, TOOL_KIND_META]
  - contract: AgentRunLogEntry
    fields: [tool_kind]
expects_from:
  task-01:
    - contract: AgentRunLogEntry
      needs: [tool_kind]
---

# task-07 · frontend 类型 + toolKindMeta

## goal

前端 `AgentRunLogEntry`/`StreamLogEvent` 加 `tool_kind` 字段 + 提供 `toolKindMeta(kind)` 徽标映射（14 枚举 + null 兜底），供 task-08 viewer 渲染。覆盖 design §5 Phase 3、FR-08/09。

## implementation

1. **agent.ts:46-68** 手写类型 `AgentRunLogEntry` + `StreamLogEvent` 加 `tool_kind?: string | null`（**核实确认**：frontend 有 codegen 但 `agent.ts` 不 import `api-types`，是手写类型，直接手改两处，**不跑 codegen**）。
2. **新建 `frontend/src/components/agent-log/tool-kind-meta.ts`**：`TOOL_KIND_META` 记录 14 枚举 → `{label(中文≤3字), Icon(lucide), badgeClass(tailwind border-200/bg-50/text-700)}`；`toolKindMeta(kind)` 函数，null/undefined/未知 → 灰色兜底 `{label:'工具', Icon:Wrench, badgeClass: 灰色}`。
3. 配色与现有 SemanticCategory 错开（避开 user 紫/ask-system 琥珀/assistant-result 天蓝/tool 蓝/result 绿/error 红）→ sillyspec 紫红/skill 玫红/bash 绿/read 青/write 蓝绿/search 靛/task 橙/web 青/todo 黄/mcp 石板/other 锌。
4. lucide 图标建议：Bash=Terminal/SillySpec= branded/技能=Zap/读=FileText/写=Pencil/搜索=Search/子任务=Bot/网搜=Globe/清单=ListTodo/MCP=Plug/其他=CircleDot。

## 验收标准

- [ ] 14 枚举 + null 都有徽标映射
- [ ] null/undefined/未知 kind 显示灰色通用「工具」徽标
- [ ] 配色与现有 SemanticCategory 视觉协调（不撞色）
- [ ] 样式参考 `archive/2026-06-21-2026-06-21-frontend-style-system`
- [ ] tool-kind-meta 单测通过

## verify

- `cd frontend && pnpm test`（tool-kind-meta 单测）
- `cd frontend && pnpm lint`

## constraints

- **agent.ts 手写类型**：核实确认不走 OpenAPI codegen（`agent.ts` 无 `api-types` import），直接手改，**不跑 codegen**（避免误生成覆盖手写）。
- D-001/002：枚举对齐 backend `TOOL_KIND_VALUES`。
- 标签 ≤3 字适配徽标固定宽度（参照 semanticCategoryMeta ≤2 字约定，工具徽标可放宽到 3 字）。
