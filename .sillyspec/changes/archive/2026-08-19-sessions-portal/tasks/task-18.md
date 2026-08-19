---
id: task-18
title: 测试收口：三端新测试补齐 + 全量回归（覆盖全部 FR）
title_zh: 全量测试收口
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-012@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/
  - backend/app/modules/llm_provider/tests/
  - backend/app/modules/agent/tests/
  - sillyhub-daemon/tests/
  - frontend/src/components/sessions/__tests__/
  - frontend/src/lib/__tests__/
goal: >
  补齐跨任务的新测试并跑三端全量回归，确保新功能覆盖与既有行为零回归同时成立。
implementation:
  - 后端：切换校验 4xx 用例、供应商两级优先级矩阵、列表过滤组合、未选配置零回归、空串切回本机默认
  - daemon：reloadWithConfig resume 加新配置、pending 边界触发、SESSION_SWITCH_CONFIG handler、重启恢复带 config 快照
  - 前端：四选择器联动、控件条切换与置灰、列表筛选、who 行快照渲染、额度胶囊 null 不显示
  - 跑三端全量测试与 lint，失败逐个修复（逻辑错误修逻辑不改测试）
acceptance:
  - backend pytest 与 daemon/frontend vitest 全绿
  - npm run lint 三端零 error
verify:
  - cd backend && uv run pytest -x -q
  - cd sillyhub-daemon && npm test -- --run
  - cd frontend && pnpm exec vitest run && pnpm exec tsc --noEmit
constraints:
  - 非测试逻辑有误时禁止改测试迁就（修实现）
  - 发现前序 task 缺口时如实报告而非静默越权修改（超 allowed_paths 需回主代理）
related_tests: []
---
