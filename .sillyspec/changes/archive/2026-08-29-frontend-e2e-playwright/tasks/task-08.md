---
id: task-08
title: 'End-to-end verification of e2e suite'
title_zh: '端到端验证（本机实跑 + 隔离回归 + CI 首跑）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-001@v1, D-002@v2, D-003@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1, D-008@v1, D-009@v1]
allowed_paths:
  - frontend/e2e/README.md
goal: >
  收口验收（对照 plan 全局验收 6 条）：本机 dev 环境实跑 pnpm test:e2e 全绿（8 用例）；
  typecheck 0 错；vitest 隔离回归（现有测试不受影响）；CI e2e-ci.yml 首跑绿；依赖树无
  puppeteer。发现问题回修对应 task 的产出。
implementation:
  - 按 e2e/README.md 前置准备本机环境（compose dev 起 pg/redis + backend/.env 配 bootstrap admin 与限流 60 + uvicorn + next dev）
  - cd frontend && pnpm test:e2e 全绿（auth.spec 4 + navigation.spec 4）；失败用 trace 定位（playwright show-trace），属断言元素选择器问题则按实际 DOM 校正 spec（task-03/04 已声明此延后项），属设计缺口回 design
  - cd frontend && pnpm exec tsc --noEmit（AC-2）
  - cd frontend && pnpm test 全绿（AC-3：vitest 不收集 e2e，157 现有测试零回归——只观察是否有与本变更相关的失败，预存债不算）
  - push 分支触发 e2e-ci.yml 首跑并盯绿（AC-4，20min 内）；失败看 artifact trace
  - 复核 AC-5：pnpm install --frozen-lockfile + grep puppeteer 零命中
  - 复核 AC-6：git diff 确认未触碰 frontend/src 与 backend
acceptance:
  - AC-1 本机 pnpm test:e2e 8 用例全绿
  - AC-2 typecheck 0 错（含 e2e）
  - AC-3 pnpm test 现有测试零回归且不收集 e2e
  - AC-4 CI e2e-ci.yml 首跑绿
  - AC-5 依赖树无 puppeteer + frozen-lockfile 一致
  - AC-6 业务代码零改动（git diff frontend/src backend 为空）
verify:
  - cd frontend && pnpm test:e2e && pnpm exec tsc --noEmit && pnpm test
  - gh run watch（或 Actions 页面）确认 e2e-ci 首跑绿
constraints:
  - 本任务只允许修正测试代码自身的断言元素选择器（task-03/04 声明的延后项）与 README 笔误；发现产品代码 bug 不修，回报用户另立变更
  - 遵守 CLAUDE.md 规则 0：pnpm test 是 frontend 子项目级测试（157 文件属相关回归范围，非全仓全量）
  - CI 首跑若超 20min，调整 timeout 并在 README 记录（R3）
---
