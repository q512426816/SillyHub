---
author: qinyi
created_at: 2026-09-09T00:50:00
---

# 模块影响分析（Module Impact）— 会话页三分屏：会话 ⇄ 工作区文件浏览器

## 受影响模块

### frontend（主影响，5 文件）

| 文件 | 改动类型 | 影响面 |
|---|---|---|
| components/sessions/portal-file-panels.tsx | 新增 | 纯新增薄壳（复用 explorer 组件），无既有消费方 |
| components/sessions/sessions-portal.tsx | 修改 | 门户主组件：状态机扩展（leftMode/selectedWorkspaceId/filePreview）+ 布局 grid→flex；四入口页（/sessions、/workspaces/[id]/sessions、change、quicklog 会话区）共用，行为兼容（默认态与现状等价） |
| components/sessions/session-list-panel.tsx | 修改 | 仅新增可选 headerExtra 插槽；直接消费方（floating-session-host、agent-log-card、workspace 页等）零变化（不传不渲染） |
| __tests__/sessions-portal.test.tsx | 修改 | 新增 describe，既有 39 用例零改动 |
| __tests__/portal-file-panels.test.tsx | 新增 | 新测试文件 |

### 间接依赖（零改动，仅消费）

- components/explorer/file-explorer.tsx、file-preview.tsx：原样 import（props 契约不变）
- components/ui/panel-resizer.tsx：原样消费（usePanelWidth/PanelResizer）
- lib/explorer.ts：原样（hooks 由 explorer 组件内部消费，portal/壳不直连，测试 mock 除外）

### 不受影响

- backend / sillyhub-daemon / 数据库 / api-types：零改动（explorer 四端点 2026-08-18 已上线）
- 工作区详情 explorer 页：独立入口不动，组件层共享升级自动受益（无）

## 兼容性

- 旧路径行为不变：不点「📁」时页面与现状等价（左栏默认宽度 320 与原栅格一致，D-005）。
- ?session= 深链语义不变（快照写入发生在既有深链验证 .then 内，不改变验证/分流逻辑）。
- 移动端 variant 零改动（不加文件浏览入口，非目标）。

## 文档同步

- frontend.changelog.md：task-04 补 change 级条目。
