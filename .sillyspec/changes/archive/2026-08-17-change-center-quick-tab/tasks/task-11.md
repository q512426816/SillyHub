---
id: task-11
title: 全量测试回归 + 模块文档变更索引同步（覆盖 —）
title_zh: 回归与文档收口
author: qinyi
created_at: 2026-08-17 00:42:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
provides: {}
expects_from: {}
goal: >
  全量回归收口：backend pytest 全量 + frontend vitest + tsc + lint，确保本变更零回归；
  同步模块文档变更索引（backend.md/frontend.md 补快速修复 tab 相关变更条目）。
implementation:
  - cd backend && uv run pytest -q（全量）
  - cd frontend && pnpm vitest run && pnpm exec tsc --noEmit && pnpm lint
  - .sillyspec/docs/multi-agent-platform/modules/backend.md 补变更索引（quicklog 端点/解析器/表）
  - frontend.md 补变更索引（快速修复 tab/抽屉/反向区块）
  - 冒烟：变更中心快速修复 tab 实机/浏览器验证（如可达）
acceptance:
  - backend 全量 pytest 通过（既有测试零回归，新增 quicklog 用例绿）
  - frontend vitest + tsc + lint 零错
  - 模块文档变更索引已同步
verify:
  - 见 implementation（local.yaml 命令）
constraints:
  - 不因本变更改既有测试逻辑；预存债按惯例顺手修但需标注
  - 模块文档索引条目格式对齐既有变更索引（ql-xxx / change 名）
related_tests: []
---
