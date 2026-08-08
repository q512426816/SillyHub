---
id: task-12
title: frontend handleDispatch to change-stage HTTP
title_zh: 前端 handleDispatch 接 change 阶层 HTTP
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P1
depends_on: [task-11]
blocks: [task-13, task-18]
allowed_paths:
  - "C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx"
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/lib/changes.ts
goal: >
  前端 handleDispatch/triggerDispatch 改调 task-11 的 change 阶层 HTTP 端点（POST /changes/{id}/advance-stage + /run-verify-gate），不再依赖后端 auto_dispatch 自动连轴（FR-06/D-005）。
implementation:
  - 在 lib/changes.ts 加 advanceChangeStage(cid, target_stage, opts) + runVerifyGate(cid) 客户端方法
  - page.tsx 的 handleDispatch/triggerDispatch 改调上述客户端方法
  - gate_status_changed / stage_status_changed SSE 收到后刷新阶段视图（接 task-01/02/03 SSE）
  - 阶段“完成待触发”态显式给“推进”按钮提示（解 R-01）
acceptance:
  - 前端点“推进”触发 advance-stage，阶段按需推进
  - 不再出现依赖 auto_dispatch 的“自动连轴”预期
verify:
  - pnpm --filter frontend test（changes page 既有 __tests__ 通过）
  - 手测：change 详情页推进 + gate 触发流转
constraints:
  - 复用既有 handleDispatch/triggerDispatch 命名与 UI 骨架（design §4.2 P3）
  - 不改路由结构，仅换数据源
provides:
  - 前端按需触发（接 change 阶层 HTTP）
expects_from:
  task-11:
    - contract: advance-stage + run-verify-gate HTTP 端点已就绪，前端可直调
      needs: [端点路径与 body 契约]
---

# task-12 实现笔记

FR-06/D-005。前端路径含 (dashboard)/[id]/[cid]，YAML 中需引号。
