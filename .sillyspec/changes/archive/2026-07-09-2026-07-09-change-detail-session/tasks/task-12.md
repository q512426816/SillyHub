---
id: task-12
title: InteractiveSessionPanel props 加 changeId?/workspaceId? 并透传 createSession
title_zh: 会话面板组件支持变更绑定透传
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-11]
blocks: [task-13]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
expects_from:
  task-11:
    - contract: createSession(payload)
      needs: [change_id, workspace_id]
goal: >
  InteractiveSessionPanel props（:114）加可选 changeId?/workspaceId?，handleSend 的 createSession（:427）带上；全可选保证 runtimes 零回归。
implementation:
  - InteractiveSessionPanelProps 加 changeId?: string、workspaceId?: string
  - handleSend 首轮 createSession 调用：changeId/workspaceId 非空时加入 payload
  - 不改 manual_approval/ask_user_only 默认（D-002 复用既有权限）
acceptance:
  - 传 changeId 时 createSession payload 含 change_id；不传时不含（runtimes 零回归）
  - typecheck 通过
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test -- src/components/daemon/interactive-session-panel
constraints:
  - 新 props 全可选，runtimes 页 RuntimeSessionDialog 调用零改动
  - 不改会话权限语义
---

## 验收标准
- 传 changeId 时 createSession payload 含 change_id；不传时不含（runtimes 零回归）
- 新 props 全可选，RuntimeSessionDialog 调用零改动
- typecheck 通过

## 验证步骤
- cd frontend && pnpm typecheck
- cd frontend && pnpm test -- src/components/daemon/interactive-session-panel
