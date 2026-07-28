---
id: task-14
title: 全量回归测试
title_zh: workspace 与 ppm 模块零回归
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-08, task-12]
blocks: [task-15]
requirement_ids: [FR-08, NFR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/workspace
  - backend/app/modules/ppm
goal: >
  运行 workspace 与 ppm 模块全量测试,确认本次关联变更对已上线 PPM 模块零回归。
implementation:
  - 运行 backend workspace 模块 + ppm 模块全量测试
  - 运行前端全量测试
  - 排查任何回归(区分预存失败与本次引入)
acceptance:
  - workspace + ppm 后端测试全通过(预存失败需确认非本次引入)
  - 前端测试零回归
  - PPM 原有功能(增删改查/导出/成员管理)无回归
verify:
  - "cd backend && uv run pytest app/modules/workspace app/modules/ppm -q --no-cov"
  - "cd frontend && pnpm test --run"
constraints:
  - 零回归,区分 main 预存失败(memory 后端全量预存 errors 是瞬时非真实)
  - 不修改测试逻辑通过(CLAUDE.md 规则 9)
---
