---
id: task-21
title: frontend runtime 卡片加审计日志入口
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P2
depends_on: [task-20]
blocks: [task-22]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-21

> goal: runtime 卡片加「审计日志」入口链接到审计页。

## implementation
- `runtimes/page.tsx:746` 附近，「可写目录」按钮同级加「审计日志」按钮/链接
- 跳转到 `/runtimes/[id]/audit`
- 权限：所有可访问 runtime 的用户可见（审计是平台用户功能）

## 验收标准
- runtime 卡片有「审计日志」入口
- 点击跳转到对应 runtime 审计页
- 布局与现有「可写目录」按钮风格一致

## 验证
- `cd frontend && pnpm test runtimes`
- `cd frontend && pnpm lint`

## constraints
- 入口位置与「可写目录」同级
- 中文文案「审计日志」
- 不改现有 runtime 卡片其他功能
