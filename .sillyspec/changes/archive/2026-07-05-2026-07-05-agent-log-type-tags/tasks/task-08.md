---
id: task-08
title: frontend agent-log-viewer 第二层筛选按钮组 + 工具徽标渲染
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-10, FR-11]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/agent-log-viewer.tsx
  - frontend/src/components/agent-log/
  - frontend/src/components/__tests__/agent-log-viewer.test.tsx
goal: agent-log-viewer 新增第二层「工具类型」筛选按钮组（多选）+ tool_call 行渲染彩色工具徽标（含旧日志兼容）
implementation: 现有10个SemanticCategory按钮(711)保留为第一层；新增第二层11按钮多选 active Set；筛选逻辑 active非空→只显示tool_kind∈active的tool_call行；行渲染 type徽标旁加工具徽标；null显示灰色兜底；单测含 jsdom markdown-text mock 坑
acceptance: 第二层11按钮多选筛选生效；两层正交可叠加；tool_call 行渲染彩色徽标；null 显示灰色兜底；测试通过
verify: cd frontend && pnpm test agent-log-viewer；pnpm lint
constraints: R-03 按钮拥挤（第二层仅工具视图显示+横向滚动）；R-07 null 兼容灰色兜底；jsdom 测试 mock markdown-text 为纯文本；样式参考 archive frontend-style-system
provides:
  - contract: agent_log_viewer_layer2_filter
    fields: [toolKindFilter]
expects_from:
  task-07:
    - contract: toolKindMeta
      needs: [toolKindMeta, TOOL_KIND_META]
---

# task-08 · frontend 第二层筛选 + 工具徽标

## goal

`agent-log-viewer.tsx` 新增第二层「工具类型」筛选按钮组（多选）+ tool_call 行渲染彩色工具徽标（含旧日志 tool_kind=null 兼容）。覆盖 design §5 Phase 3、FR-10/11。

## implementation

1. **第一层不动**：现有 10 个 SemanticCategory 按钮（agent-log-viewer.tsx:711）保留。
2. **第二层新增**：11 个工具类型按钮（SillySpec/技能/命令行/读文件/写文件/搜索/子任务/网搜/清单/MCP/其他），多选用 `active Set<ToolKind>`；第一层选中「工具」或「全部」时显示第二层（R-03 防拥挤）；可横向滚动。
3. **筛选逻辑**：active 非空 → 只显示 `tool_kind ∈ active` 的 tool_call 行；非工具行（assistant/thinking/user/...）不受第二层影响；active 空 → 显示全部工具调用。
4. **行渲染（307-378 区域）**：tool_call 行在 type 徽标旁渲染 `toolKindMeta(log.tool_kind)` 工具徽标；`tool_kind=null` 显示灰色兜底徽标（R-07）。
5. **单测**：两层筛选正交、多选 active、null 兼容；**jsdom mock markdown-text 为纯文本**（记忆 frontend-markdown-text-jsdom-null，避免 next/dynamic ssr:false 导致 getByText 失败）。

## 验收标准

- [ ] 第二层 11 按钮多选筛选生效（点亮多个=交集）
- [ ] 两层正交可叠加（第一层工具 + 第二层 SillySpec/技能 = 只看这两类工具调用）
- [ ] tool_call 行渲染彩色工具徽标
- [ ] `tool_kind=null` 旧日志显示灰色兜底徽标，不报错
- [ ] 测试通过（含 jsdom markdown mock）

## verify

- `cd frontend && pnpm test agent-log-viewer`
- `cd frontend && pnpm lint`

## constraints

- **R-03 按钮拥挤**：第二层仅工具视图显示 + 横向滚动。
- **R-07 null 兼容**：灰色 tk-none 兜底徽标。
- **jsdom 坑**：测试文件顶部 `vi.mock` markdown-text 为纯文本渲染（frontend-markdown-text-jsdom-null 记忆）。
- 样式参考 `archive/2026-06-21-2026-06-21-frontend-style-system`；react-query 迁移不影响此组件（无数据 hook）。
- 11 按钮是 14 枚举的 UI 简化（plan/ask/schedule 低频归「其他」或不单独列）。
