---
id: task-09
title: frontend remove create-change form + empty state guidance
title_zh: 前端去表单（删新建变更入口 + 空态引导会话）
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-07]
blocks: [task-11]
requirement_ids: [FR-04a, FR-04b]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx
  - frontend/src/lib/changes.ts
goal: >
  变更中心去表单：列表页删「+ 新建变更」按钮与空态 CTA，空态引导「去会话跟 agent 对话」
  （链接会话页）；删 create-change 页面及其测试；lib/changes.ts 清理 createChange/proxyCreateChange/
  executeChange。
implementation:
  - changes/page.tsx：删「+ 新建变更」按钮（PageHeader actions + 空态 CTA，:379-449 区域）；空态改为
    引导去会话页（链接 /workspaces/[id]/sessions，文案「还没有进行中的变更。去会话跟 agent 对话，
    描述你的需求，agent 会自动立项并推进」）；「重新扫描」按钮保留作兜底
  - 删 create-change/page.tsx 整页 + create-change/__tests__/page.test.tsx（随页失效，plan P2-4 明示）
  - lib/changes.ts：删 createChange / proxyCreateChange / executeChange 方法（无调用方，符号影响面
    扫描已确认仅 create-change 页引用，随本任务一并清理）；保留 listChanges/reparseChanges/
    submitStageReview 等仍在用的方法
  - 详情页 handleAdvance 里的 agent_dispatch 消费（[cid]/page.tsx:218-230）不动（task-10 删详情页
    执行控制时一并处理），本任务只做列表页/空态/客户端清理
acceptance:
  - 变更中心列表页无任何「新建变更」入口；空态引导去会话页（链接可点）
  - create-change 页面及其测试已删除；lib/changes.ts 无 createChange/proxyCreateChange/executeChange
  - 既有 changes 列表页测试改写（删按钮/空态断言）后 vitest 通过
  - frontend typecheck/lint 通过
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck && pnpm lint
  - rg "createChange|proxyCreateChange|executeChange" frontend/src （确认无残留）
constraints:
  - 「重新扫描」保留（design FR-04c，全量兜底）
  - 后端端点删除在 task-07 已完成，本任务只清前端
  - 详情页执行控制删除在 task-10，本任务不越界
  - 中文 UI（CONVENTIONS）
---
