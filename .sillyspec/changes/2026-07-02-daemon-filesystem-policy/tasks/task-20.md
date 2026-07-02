---
id: task-20
title: frontend 审计页 page.tsx
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P1
depends_on: [task-19]
blocks: [task-21]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx
  - frontend/src/app/(dashboard)/runtimes/[id]/audit/page.test.tsx
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-20

> goal: 审计页 UI（统计概览 + 筛选 + ALLOW/DENY 列表 + 分页）（D-006）。

## implementation
- `runtimes/[id]/audit/page.tsx`: 参照 `prototype-policy-audit.html` 线框
- 统计概览（ALLOW/DENY 24h 计数）+ 筛选区（decision/provider/tool/path/时间）+ 记录列表 + 分页
- Antd Table + Form，TanStack Query 调 fetchPolicyAudit
- 中文文案

## 验收标准
- 审计页展示某 runtime 的 ALLOW/DENY 记录
- 支持按 decision/provider/tool/path/时间筛选 + 分页
- 布局对齐 prototype-policy-audit.html

## 验证
- `cd frontend && pnpm test audit`
- `cd frontend && pnpm lint`

## constraints
- 前端样式参考 archive 的 frontend-style-system（CLAUDE.md 规则 15）
- Antd 6 + Tailwind
- 路径 `/runtimes/[id]/audit`
