---
id: task-13
title: 前端业务人员无感触发 agent + 方案查看
title_zh: 业务人员触发借用与查看方案
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P1
depends_on: [task-10]
blocks: []
requirement_ids: [FR-04, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/agent/
  - frontend/src/app/(dashboard)/files/
  - frontend/src/app/(dashboard)/workbench/
goal: >
  业务人员正常触发 agent（背后自动借用无感）+ 在文件中心/工作台看产出的业务方案。
implementation:
  - 业务人员触发 agent 复用现有触发 UI（背后 placement 自动借用，前端无感，不需选 daemon）
  - 文件中心/工作台展示 owner_type=workspace、created_by=业务人员的借用方案文件
acceptance:
  - 业务人员（business_member）点触发 agent 能跑通（借用共享 daemon）
  - 产出的方案在文件中心/工作台可见
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 触发无感（复用现有，不新增"选 daemon"交互，D-002）
  - 方案按 owner_type=workspace + created_by 归属展示
---
