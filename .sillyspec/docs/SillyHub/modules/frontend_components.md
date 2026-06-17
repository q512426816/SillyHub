---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_components
> 最后更新：2026-06-09
> 最近变更：ql-20260609-005-d2f7（提取共享 AgentLogViewer 组件）
> 模块路径：frontend/src/components/**

## 职责

Frontend Components 模块包含所有可复用的 UI 组件，包括业务组件（工作区卡片、扫描对话框、步骤进度条等）和基础 UI 组件（Button、Input、Badge）。

## 当前设计

### 组件清单

| 文件 | 导出 | 类型 | 说明 |
|------|------|------|------|
| `app-shell.tsx` | `AppShell` | Client Component | 应用外壳 — 侧边栏导航 + 主内容区 |
| `workspace-card.tsx` | `WorkspaceCard` | Client Component | 工作区卡片 — 展示工作区信息 + 操作按钮 |
| `workspace-scan-dialog.tsx` | `WorkspaceScanDialog` | Client Component | 扫描对话框 — 输入路径并创建工作区 |
| `component-detail-drawer.tsx` | `ComponentDetailDrawer` | Client Component | 组件详情抽屉 — 侧滑展示组件信息 |
| `health-card.tsx` | `HealthCard` | Client Component | 健康检查卡片 — 展示后端健康状态 |
| `sillyspec-step-progress.tsx` | `SillySpecStepProgress` | Client Component | 步骤进度条 — 展示 SillySpec 工作流进度 |
| `agent-log-viewer.tsx` | `AgentLogViewer`, `AgentLogRow`, `parseToolCallContent`, `parseScanCheckOutput` | Client Component | Agent 日志查看器 — 深色终端风格，支持 Bash tool 结构化渲染、扫描自检摘要卡片、pending_input 内联回复 |
| `agent-log/types.ts` | `ToolCallEntry`, `ScanCheckResult`, `AgentLogInputControls`, `ProcessedLog` | Type definitions | Agent 日志共享类型定义 |
| `agent-log/normalize.ts` | `normalizeLogs`, `parseToolCallContent`, `parseScanCheckOutput`, `isPendingReplied`, `isThinkingContent` | Pure functions | 日志事件归一化（去重 TOOL_USE、合并 TOOL_RESULT、识别 Thinking） |
| `agent-log/tool-renderers.tsx` | `ToolCallPreview`, `WriteToolPreview`, `AgentToolPreview`, `BashToolPreview`, `SearchToolPreview`, `ReadToolPreview`, `EditToolPreview` | Client Components | 工具调用专属渲染器（Write/Agent/Bash/Grep/Glob/Read/Edit） |
| `ui/button.tsx` | `Button` | Client Component (forwardRef) | 基础按钮 — 支持变体和尺寸 |
| `ui/input.tsx` | `Input` | Client Component (forwardRef) | 基础输入框 |
| `ui/badge.tsx` | `Badge` | Client Component | 徽章标签 — 支持多种变体 |
| `ui/pagination.tsx` | `Pagination` | Client Component | 通用分页 — 上一页/下一页 + 共X条·第N/M页 |

### 组件层级关系

```
AppShell
  ├── 侧边栏导航（workspace 列表、settings 链接）
  └── children（页面内容）

WorkspaceCard（被 workspaces 列表页使用）
WorkspaceScanDialog（被 workspaces 列表页使用）
ComponentDetailDrawer（被 components 页使用）
HealthCard（被首页或工作区详情页使用）
SillySpecStepProgress（被 changes 详情页使用）
AgentLogViewer（被 agent 控制台页、workspace 详情页共用）
```

## 对外接口

| 组件 | Props | 说明 |
|------|-------|------|
| `AppShell` | `{ children: ReactNode }` | 应用壳，包裹 dashboard 内容 |
| `WorkspaceCard` | `{ workspace, onChanged }` | 工作区卡片 |
| `WorkspaceScanDialog` | `{ onCreated, onCancel }` | 扫描对话框 |
| `ComponentDetailDrawer` | Props 待确认 | 组件详情侧滑 |
| `HealthCard` | 无 props | 健康状态展示 |
| `SillySpecStepProgress` | Props 包含 steps/current 等 | 工作流进度 |
| `AgentLogViewer` | `{ title, runId, logs, loading, emptyText, maxHeightClass?, compact?, variant?, isLive?, containerRef?, summary?, actions?, inputControls? }` | Agent 运行日志查看器（panel/embedded 两种布局） |
| `Button` | ButtonProps (variant, size, etc.) | 基础按钮 |
| `Input` | InputProps | 基础输入框 |
| `Badge` | BadgeProps (variant) | 徽章 |
| `Pagination` | `{ page, pageSize, total, onPageChange }` | 通用分页 |

## 关键数据流

```
页面组件
  → 导入业务组件 (WorkspaceCard, WorkspaceScanDialog 等)
  → 业务组件内部调用 @/lib/* 获取/提交数据
  → 基础 UI 组件 (Button, Input, Badge) 由业务组件组合使用
```

## 设计决策

| 决策 | 原因 |
|------|------|
| UI 组件放在 `ui/` 子目录 | 与 shadcn/ui 约定一致，方便扩展 |
| Button/Input 使用 forwardRef | 允许父组件直接操作 DOM |
| 所有业务组件标记 "use client" | 使用 hooks 和事件处理 |
| 组件粒度按功能拆分 | 每个文件一个组件，职责清晰 |

## 依赖关系

- **内部依赖**：`@/lib/*`（API 调用）, `@/stores/session`（部分组件需要认证信息）
- **外部依赖**：React 18, Tailwind CSS（样式）, Lucide React（图标，推测）, clsx + tailwind-merge（通过 `@/lib/utils`）

## 注意事项

- UI 组件 (`ui/*`) 遵循 shadcn/ui 模式，应通过 CLI 添加而非手动编辑
- `AppShell` 是全局组件，修改会影响所有 dashboard 页面
- 组件数量较少（9 个），随着功能增长需及时拆分

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-09 | ql-20260609-005-d2f7 | 提取共享 AgentLogViewer 组件，Agent 控制台和 Bootstrap 页面共用 |
| 2026-06-09 | ql-20260609-006-e3a1 | AgentLogViewer 内置自动滚动到底部 |
| 2026-06-09 | ql-20260609-013-a3f7 | 日志事件归一化 + 6 种工具专属渲染器（agent-log 子目录拆分） |
| 2026-06-09 | ql-20260609-014-c3d8 | stdout [TOOL_USE] 文本事件解析为工具卡片 |
| 2026-06-09 | ql-20260609-015-d4e9 | stdout [TOOL_RESULT] 归一化 + ToolResultCard + WorkflowSpecResultCard |
| 2026-06-17 | ql-20260617-003-3757 | 新增 Pagination 通用分页组件（上一页/下一页 + 共X条·第N/M页），用户/角色管理共用 |
