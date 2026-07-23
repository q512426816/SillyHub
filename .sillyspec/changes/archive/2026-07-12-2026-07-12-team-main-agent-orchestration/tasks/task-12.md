---
id: task-12
title: backend pytest + frontend vitest + daemon vitest 全量零回归 + mypy/ruff 全过
title_zh: 全量回归与 lint
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
blocks: [task-13]
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/main.py
goal: >
  全量单测零回归 + lint 全过，作为 execute 完成的质量门。
implementation:
  - backend pytest 全量（local.yaml: uv run pytest）
  - frontend vitest 全量（pnpm test）
  - daemon vitest（pnpm test）
  - mypy（uv run mypy app）+ ruff（uv run ruff check . && ruff format --check .）
  - frontend typecheck（pnpm typecheck）+ lint（pnpm lint）
acceptance:
  - backend pytest 全绿（覆盖率 ≥60%）
  - frontend vitest 全绿
  - daemon vitest 全绿
  - mypy + ruff + frontend lint/typecheck 全过
verify:
  - cd backend && uv run pytest -q --no-cov
  - cd frontend && pnpm test && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - 零回归（现有测试不挂）
  - 不改测试逻辑迁就实现（CLAUDE.md 规则 9）
  - 回归类 task（allowed_paths 填验证入口 main.py）
---
