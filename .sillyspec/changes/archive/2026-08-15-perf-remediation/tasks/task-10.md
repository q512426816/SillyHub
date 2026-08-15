---
id: task-10
title: "收尾回归"
title_zh: "三端回归测试 + reparse 期间 slow.request 尖峰观测（monitoring 三件套）"
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [NFR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - .sillyspec/changes/perf-remediation/verify-observation.md
  - backend/app/modules/change/service.py
goal: >
  全部前序 task 完成后的收尾回归——backend 命中模块（change/scan_docs/spec_workspace/change_writer/auth/agent）pytest 加 ruff 加 mypy、sillyhub-daemon pnpm test 加 typecheck、frontend pnpm test 加 tsc 三端全绿；dev 环境触发一次 reparse，用已上线 monitoring 三件套观测确认事件循环解放后不再出现 slow.request 尖峰，观测结论落 verify-observation.md。
implementation:
  - backend 全量命中模块回归——uv run pytest 跑 change/scan_docs/spec_workspace/change_writer/auth/agent 六模块，加 ruff check 与 mypy（按项目门禁命令）
  - sillyhub-daemon 回归——pnpm test 与 pnpm typecheck 全绿
  - frontend 回归——pnpm test（vitest 全量）与 tsc 零错误；若 schema 相关测试有预存债按惯例区分，不为本变更背书
  - dev 环境观测——触发一次完整 reparse（真实 workspace 规模），对照 backend 日志 monitoring 三件套（慢请求/慢查询日志），确认 reparse 期间无新增 slow.request 尖峰（对比 ql-008 前的 ECONNRESET 指纹）
  - 观测结论写入 .sillyspec/changes/perf-remediation/verify-observation.md——记录触发方式、耗时、slow.request 计数前后对比
  - 本 task 原则上无源码改动；若回归暴露前序 task 缺陷，回到对应 task 修复后重跑本回归，不在本卡内顺手改无关文件
acceptance:
  - backend 六命中模块 pytest 全绿，ruff 与 mypy 过
  - sillyhub-daemon pnpm test 与 typecheck 全绿
  - frontend vitest 全绿且 tsc 零错误
  - dev 环境 reparse 一次成功，期间无 slow.request 尖峰（monitoring 日志为证），结论已落 verify-observation.md
  - 行为零变更总验收——既有业务断言未被语义性修改（个别调用次数类实现细节断言除外，见 design 目标 5）
verify:
  - cd backend && uv run pytest app/modules/change app/modules/scan_docs app/modules/spec_workspace app/modules/change_writer app/modules/auth app/modules/agent -q --no-cov
  - cd backend && uv run ruff check app && uv run mypy app
  - cd sillyhub-daemon && pnpm test && pnpm typecheck
  - cd frontend && pnpm test && pnpm exec tsc --noEmit
constraints:
  - 纯回归收尾 task——allowed_paths 覆盖观测产物与代表入口，不预期源码改动；确需修复时回对应前序 task 而非在本卡内扩散
  - 观测复用已上线 monitoring 三件套（D-003），不新建 metrics 层
  - depends_on 全部前序 task——必须在 task-01 至 task-09 全部完成后执行
---
