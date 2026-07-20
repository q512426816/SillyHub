---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_components
> 最后更新：2026-06-23
> 最近变更：ql-20260720-005-e91c（StatusBadge 内部渲染改 antd Badge，17 处状态标签统一切 antd）
> 模块路径：frontend/src/components/**

## 职责

Frontend Components 模块包含所有可复用的 UI 组件，包括业务组件（工作区卡片、扫描对话框、步骤进度条等）和基础 UI 组件（Button、Input、Badge）。

## 当前设计

### 组件清单

| 文件 | 导出 | 类型 | 说明 |
|------|------|------|------|
| `app-shell.tsx` | `AppShell` | Client Component | 应用外壳 — 侧边栏导航 + 主内容区；按 `usePathname()` 过滤 section 实现 ppm 与主平台菜单完全隔离（`/ppm/*` 下仅渲染 ppm section，其它路径仅渲染非 ppm section） |
| `workspace-card.tsx` | `WorkspaceCard` | Client Component | 工作区卡片 — 展示工作区信息 + 操作按钮 |
| `workspace-scan-dialog.tsx` | `WorkspaceScanDialog` | Client Component | 扫描对话框 — 输入路径并创建工作区 |
| `component-detail-drawer.tsx` | `ComponentDetailDrawer` | Client Component | 组件详情抽屉 — 侧滑展示组件信息 |
| `health-card.tsx` | `HealthCard` | Client Component | 健康检查卡片 — 展示后端健康状态 |
| `sillyspec-step-progress.tsx` | `SillySpecStepProgress` | Client Component | 步骤进度条 — 展示 SillySpec 工作流进度 |
| `agent-log-viewer.tsx` | `AgentLogViewer`, `AgentLogRow`, `parseToolCallContent`, `parseScanCheckOutput` | Client Component | Agent 日志查看器 — 深色终端风格，支持 Bash tool 结构化渲染、扫描自检摘要卡片、pending_input 内联回复 |
| `agent-log/types.ts` | `ToolCallEntry`, `ScanCheckResult`, `AgentLogInputControls`, `ProcessedLog` | Type definitions | Agent 日志共享类型定义 |
| `agent-log/normalize.ts` | `normalizeLogs`, `parseToolCallContent`, `parseScanCheckOutput`, `isPendingReplied`, `isThinkingContent` | Pure functions | 日志事件归一化（去重 TOOL_USE、合并 TOOL_RESULT、识别 Thinking） |
| `agent-log/tool-renderers.tsx` | `ToolCallPreview`, `WriteToolPreview`, `AgentToolPreview`, `BashToolPreview`, `SearchToolPreview`, `ReadToolPreview`, `EditToolPreview` | Client Components | 工具调用专属渲染器（Write/Agent/Bash/Grep/Glob/Read/Edit） |
| `daemon/runtime-session-dialog.tsx` + `daemon/runtime-session-helpers.tsx` | `RuntimeSessionDialog`, `InteractiveSessionChatSection`, `QuickChatSessionSection` | Client Components | /runtimes 会话弹窗；Claude Code 与 Codex 均走 interactive AgentSession（`createSession`/`injectSession`/`reopenSession`），Codex 不再分流到 quick-chat（D-005@v1） |
| `daemon/remote-folder-picker.tsx` | `RemoteFolderPicker` | Client Component | 远程目录浏览器 — 基于 daemon `list_roots`+`list_dir` 的懒加载目录树（替代旧 browseFolder 系统弹窗，远程 daemon 时 Web 用户看不到原生弹窗）；props `{runtimeId,open,onClose,onPick,title?,confirmText?}`，自治（listRoots 初始化根+Tree loadData 懒加载 listDir+手输跳转校验+错误降级红条）；2026-07-09-remote-folder-picker |
| `ui/button.tsx` | `Button` | Client Component (forwardRef) | 基础按钮 — 支持变体和尺寸 |
| `ui/input.tsx` | `Input` | Client Component (forwardRef) | 基础输入框 |
| `ui/badge.tsx` | `Badge` | Client Component | 徽章标签 — 支持多种变体 |
| `antd-providers.tsx` | `AntdProviders` | Client Component | antd ConfigProvider 包裹（zhCN locale + token + Table 主题），与 AntdRegistry 配合使用 |

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
| `RuntimeSessionDialog` | `{ runtime, open, onClose, runtimes, initialSessionId? }` | /runtimes runtime 会话弹窗；按 provider 走 interactive 主路径（`InteractiveSessionChatSection`），Codex 不再分流到 `QuickChatSessionSection`（D-005@v1）；`canReopenSession()` 支持 `provider==="codex"`（D-007@v1） |
| `QuickChatSessionSection` | `{ provider: "codex" }` | 全局能力保留，**不再作为 /runtimes Codex interactive 主路径入口**（D-005@v1）；使用 `quickChat` / `streamQuickChat` / `getQuickChatResult` |
| `AskUserDialogCard` | `{ ...questions/options payload }` | 零分支复用 Codex driver 归一化后的 payload（`codex_request_user_input` / 可归一化 `mcp_elicitation` 归一化为 question/options，D-008@v1, D-010@v1）；MCP elicitation 复杂 schema 暂不支持（daemon 侧 fail-closed） |
| `Button` | ButtonProps (variant, size, etc.) | 基础按钮 |
| `Input` | InputProps | 基础输入框 |
| `Badge` | BadgeProps (variant) | 徽章 |
| `AntdProviders` | `{ children: ReactNode }` | antd ConfigProvider 包裹（在 layout.tsx 根部使用） |

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
| 2026-06-17 | ql-20260617-004-02d5 | 引入 antd 6.4，新增 AntdProviders（ConfigProvider + zhCN locale + Table token），删除 ui/pagination.tsx 由 antd Table 内置分页替代 |
| 2026-06-24 | ql-20260624-001-a3b7 | ppm-resource-table.tsx:199 局部 `const DEFAULT_PAGE_SIZE = 10` → `= 20`(修复 projects/customers/project-stakeholders 三页实际查 10 条的根因:该常量与 shared.tsx 的 DEFAULT_PAGE_SIZE=20 重名但不同源,PpmResourceTable useState 用的是自己局部的 10)。三页 + 所有 PpmResourceTable 消费方默认变 20。ql-026 核实结论"三页已 20"系误判(未发现局部常量) |
| 2026-06-23 | ql-20260623-025-e6f9 | ppm-project-members-table.tsx pageSize useState(10)→20(对齐 ppm 所有列表页默认 20 条);work-hour-statistics 聚合+明细表 pageSize 50→20 见 frontend_app |
| 2026-06-23 | ql-20260623-019-3a8c | PpmSubTable 移除 expandable.columnTitle='展开'（默认 expand 列无表头文字，与其他列表头高度一致）；ppm-status-actions.tsx PlanDetailActions + ProblemActions 在 buttons.length===0 时兜底从 `<span>—</span>` 改为 null，避免 done/archived 状态明细行操作列出现破折号（详情按钮仍在，只去掉多余 —） |
| 2026-06-21 | ql-20260621-003-menu-isolation | AppShell 侧边栏按路径隔离菜单：`/ppm/*` 仅渲染 ppm section，其它路径仅渲染非 ppm section（overview/management/admin/system），ppm 与主平台菜单互不可见 |
| 2026-06-21 | ql-20260621-013-b2e5 | AskUserDialogCard 改常驻手动输入框：每问选项下方常驻输入框（填写即以此作答，覆盖选项），移除"选 Other 才出框"的两步操作 |
| 2026-06-21 | ql-20260621-004-c4a1 | AntdProviders 全局补 dayjs locale zh-cn：antd v5 DatePicker 日历表头星期/月份/边界取自 dayjs 全局 locale，仅 ConfigProvider locale={zhCN} 不够（只管 antd 自有文案），需 dayjs.locale('zh-cn') 双保险，否则日历显示英文星期 |
| 2026-06-23 | codex-runtime-conversation-fix | /runtimes Codex 会话从 Claude interactive SessionManager 分流到 quick-chat SSE，避免触发 daemon UnsupportedProviderError；Claude Code 会话保持 interactive 路径（**临时降级，已被 2026-06-23-codex-interactive-session 覆盖**） |
| 2026-06-23 | 2026-06-23-codex-interactive-session | /runtimes Codex 改回 interactive panel（`InteractiveSessionChatSection`），`QuickChatSessionSection` 降级为非 /runtimes Codex 主路径（全局能力保留，D-005@v1）；`canReopenSession` 支持 Codex（D-007@v1）；`AskUserDialogCard` 支持 Codex `request_user_input` / 可归一化 MCP elicitation 归一化 payload（D-008@v1/D-010@v1） |
| 2026-07-20 | ql-20260720-005-e91c | StatusBadge 内部渲染由自写 tailwind 圆角药丸改 antd Badge(status+text),删 KIND_STYLES/SIZE_STYLES/DOT_SIZE_STYLES 色表;StatusKind→antd status 映射;API 不变,17 处调用点自动生效,外观从「圆角药丸+浅背景」变「小圆点+文字」 |
