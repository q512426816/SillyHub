---
id: task-13
title: converge three review paths
title_zh: 收敛三条审核链路
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P2
depends_on: [task-12]
blocks: [task-18]
allowed_paths:
  - "C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx"
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/lib/changes.ts
goal: >
  收敛前端三条并存审核链路（gate 面板 / transition 推进 / 旧 approval_status+submitReview）：旧 approval_status / submitReview 退役或明确边界，统一到 task-08 submit_stage_review + task-09 run_verify_gate 触发模型（FR-06）。
implementation:
  - 盘点 page.tsx / lib/changes.ts 中三条审核相关 UI 与调用
  - gate 面板 → 调 run_verify_gate（task-09/12）
  - transition 推进 → 调 advance-stage（task-11/12）
  - 审核 → 调 submit_stage_review（task-08；若前端走 HTTP 则补 review 端点客户端方法）
  - 旧 approval_status / submitReview：退役或标注只读边界，避免与新 tool 链路并存混淆
acceptance:
  - 前端只剩一条审核语义（submit_stage_review），无三链路并存
  - 旧 approval_status 不再驱动推进
verify:
  - pnpm --filter frontend test
  - 手测：审核/推进/gate 三动作各走唯一链路
constraints:
  - 退役旧链路时不破坏既有 review 数据展示（只读保留）
  - 与 task-08 tool 对齐（HTTP 端点若缺则补 review 端点客户端方法）
provides:
  - 前端审核链路收敛（单一 submit_stage_review）
expects_from:
  task-12:
    - contract: handleDispatch 已接 change 阶层 HTTP，前端按需触发骨架就绪
      needs: [lib/changes.ts 客户端方法基座]
---

# task-13 实现笔记

FR-06。优先级 P2（收敛性，非阻塞主流程）。范围以 page.tsx + lib/changes.ts 为主，必要时顺带 review 端点客户端方法。
