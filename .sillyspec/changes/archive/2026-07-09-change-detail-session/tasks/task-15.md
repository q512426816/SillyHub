---
id: task-15
title: frontend 组件测试（区块渲染/props 透传/历史/新建带 change_id/runtimes 零回归）
title_zh: 前端组件测试与回归守护
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-13, task-14]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/changes/
  - frontend/src/components/daemon/__tests__/
goal: >
  覆盖 ChangeSessionSection 渲染/历史加载/新建带 change_id，以及 InteractiveSessionPanel props 透传与 runtimes 页 RuntimeSessionDialog 零回归。
implementation:
  - ChangeSessionSection 测试：渲染列出 listChangeSessions 结果；新建会话 createSession payload 含 change_id；切换历史项触发 attach
  - InteractiveSessionPanel 测试：传 changeId 时 createSession 含 change_id；不传时不含
  - runtimes 页回归：RuntimeSessionDialog 不传 changeId，行为不变
  - 注：markdown-text 等动态组件在 jsdom 下需 vi.mock 纯文本（见 memory frontend-markdown-text-jsdom-null）
acceptance:
  - 新增前端测试全绿
  - runtimes 页既有测试零回归
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 不为通过测试而改非测试逻辑（CLAUDE.md 规则8）
  - 复杂动态组件测试按既有 vi.mock 模式处理
---

## 验收标准
- 新增前端测试全绿（区块渲染/props 透传/历史/新建带 change_id）
- runtimes 页既有测试零回归
- typecheck 通过

## 验证步骤
- cd frontend && pnpm test
- cd frontend && pnpm typecheck
