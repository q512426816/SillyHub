---
id: task-11
title: 前端联调与测试零回归（覆盖 FR-01~07）
title_zh: 前端联调与回归验证
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-10]
blocks: []
requirement_ids: [FR-01, FR-05, FR-06, FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/page.tsx
goal: >
  对工时热力功能做前端联调与全量回归，确认新视图可用且现有看板功能零回归。
implementation:
  - 跑前端全量测试确认零回归
  - 跑类型检查与 lint 确认无新增报错
  - 核对两个 tab 切换与网格渲染与配色符合预期
acceptance:
  - 前端测试类型检查 lint 全部通过
  - 现有看板功能无回归
verify:
  - cd frontend && pnpm test
constraints:
  - 不因新功能修改无关旧测试
  - 发现旧债按惯例顺手补字段不回避
---
