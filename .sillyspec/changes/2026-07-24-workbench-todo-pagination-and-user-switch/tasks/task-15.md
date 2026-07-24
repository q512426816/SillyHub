---
id: task-15
title: 端到端核对（覆盖：FR-01, FR-02, FR-03, FR-04）
title_zh: 端到端 — 切换全跟随/分页/越权/兼容
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-06, task-12, task-14]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/page.tsx
goal: >
  端到端核对：切换用户后 profile/指标/日历/待办/任务表全部跟随；待办分页正确；越权 403；不传 target 行为不变。
implementation:
  - 核对 WEB：切换用户后五块数据一致变化 + 提示条 + 返回我自己
  - 核对 APP：切换后 profile/指标/日历/待办跟随 + 待办卡片分页
  - 核对越权：非可见集 target→403（前端不崩，提示）
  - 核对兼容：不传 target 全工作台与旧版一致
acceptance:
  - 切换后全工作台跟随 target（无残留旧用户数据）
  - 待办分页 WEB+APP 正确
  - 越权 403 不泄露
  - 不传 target 完全兼容
verify:
  - cd backend && uv run pytest app/modules/ppm -q --no-cov
  - cd frontend && pnpm test
constraints:
  - 本地 SQLite + 本地 dev 核对为主（生产 e2e 留部署后）
---
