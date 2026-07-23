---
id: task-14
title: 变更详情页插入 ChangeSessionSection（执行日志区块后）
title_zh: 变更详情页接入会话区块
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-13]
blocks: [task-15]
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
expects_from:
  task-13:
    - contract: ChangeSessionSection
      needs: [workspaceId, changeId]
goal: >
  在变更详情页（changes/[cid]/page.tsx）「Agent 执行日志」区块之后插入 <ChangeSessionSection workspaceId={workspaceId} changeId={changeId} />。
implementation:
  - workspaceId=params.id, changeId=params.cid（既有 :141-142）
  - 在 AgentRunPanel 区块（:707-742）之后、文件树（:756）之前插入会话区块
  - 加区块标题「会话」
acceptance:
  - 变更详情页出现会话区块，渲染该变更会话
  - 既有区块（阶段/gate/日志/文件树/侧栏）不变
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm build
constraints:
  - 仅插入新区块，不改既有区块结构与顺序
---

## 验收标准
- 变更详情页出现会话区块，渲染该变更会话
- 既有区块（阶段/gate/日志/文件树/侧栏）不变
- typecheck / build 通过

## 验证步骤
- cd frontend && pnpm typecheck
- cd frontend && pnpm build
