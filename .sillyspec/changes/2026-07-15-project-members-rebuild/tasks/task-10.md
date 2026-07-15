---
id: task-10
title: "联调验收 — tsc/lint/后端 pytest/Docker rebuild 实测对照原型"
title_zh: 全量联调验收
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/project-members/page.tsx
goal: 全量验收前后端联动、成员数实时更新、负责人推算、projects 抽屉不回归、embedded 展开行视觉。
implementation:
  - 跑 tsc / lint / 后端 pytest
  - Docker rebuild frontend（+ backend 若有镜像变更）
  - 浏览器实测 plan.md 全局验收 5 条：两级展开/两种新增/6 维搜索/成员数实时更新/负责人推算/projects 抽屉不回归/embedded 视觉对照原型
acceptance:
  - tsc + lint + 后端 pytest 全过
  - Docker healthy
  - 实测全部通过（含 embedded 展开行视觉 G1）
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
  - cd frontend && pnpm test
  - cd backend && pytest app/modules/ppm/project -q
  - cd deploy && docker compose up -d --build
constraints:
  - 实测不只靠 tsc（Docker 不热重载需 rebuild）
  - 对照原型核对 embedded 展开行（G1）
---

# task-10 — 全量联调验收

依据 plan.md 全局验收标准 + design.md §12 验收 10 条。回归类 task（allowed_paths 填关键入口）。
