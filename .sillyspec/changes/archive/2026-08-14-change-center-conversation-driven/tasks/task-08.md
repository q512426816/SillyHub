---
id: task-08
title: frontend workspace sessions page + WorkspaceSessionSection
title_zh: 前端工作区会话页 + 抽 WorkspaceSessionSection
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-06]
blocks: [task-11]
requirement_ids: [FR-03a, FR-03b]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/workspace-tabs.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/lib/daemon.ts
goal: >
  工作区独立「会话」入口（与变更中心平级）：workspace-tabs 加 tab + 新页 /workspaces/[id]/sessions
  （左侧会话列表 + 右侧复用 InteractiveSessionPanel），从 change-session-section 抽通用
  WorkspaceSessionSection（只传 workspaceId，不传 changeId）。建会话为 workspace 级。
implementation:
  - frontend/src/components/workspace-tabs.tsx：TABS 加 `{ key: "sessions", label: "会话", path: "/sessions" }`
  - frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx：新页，左侧 workspace 级会话列表
    （含已结束，调 lib/daemon.ts 会话列表 + include_ended=true）+ 发起新会话入口，右侧复用
    InteractiveSessionPanel（建会话传 workspace_id，不绑 change_id）
  - frontend/src/components/workspace-session-section.tsx：从 change-session-section.tsx 抽通用组件
    （props 只含 workspaceId，去掉 changeId 依赖；InteractiveSessionPanel 已支持可选 workspaceId）
  - frontend/src/lib/daemon.ts：确认 createSession 已收 workspace_id；会话列表方法透传 include_ended
    （task-06 后端配套）
  - 可复用现有会话组件（runtime-session-helpers / session-log-sanitize）渲染逻辑，不重复造轮子
acceptance:
  - 工作区一级导航出现「会话」tab，可进入会话页
  - 会话页左侧列出 workspace 级会话（含已结束），右侧可发起新会话 / 与 agent 对话
  - 新会话 workspace 级（不绑 change），多轮对话/工具调用可见/中断可用
  - frontend vitest 会话页 + pnpm typecheck 通过
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 复用 InteractiveSessionPanel / 既有会话组件，不重写会话机制
  - 会话页与变更平级，不内嵌变更上下文的会话逻辑（那是 change-session-section 职责）
  - 中文 UI（CONVENTIONS）
---
