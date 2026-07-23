---
id: task-14
title: 全量前端 test+tsc / 后端 ruff+mypy+pytest
title_zh: 全局质量门禁
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13]
blocks: [task-15]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001, D-002, D-003, D-004, D-005, D-006]
allowed_paths: [docs/sillyspec/verification/task-14-quality-gate.md]
provides:
  - gate: full_quality_gate
goal: >
  跑全局质量门：前端 pnpm tsc --noEmit + pnpm test 全绿，后端 ruff check + ruff format check + mypy app + pytest（daemon session + change 用例）全绿覆盖率 ≥60%。
implementation:
  - 后端：cd backend && uv run ruff check && uv run ruff format --check && uv run mypy app
  - 后端：cd backend && uv run pytest（重点 daemon session + change 用例，覆盖率 ≥60%）
  - 前端：cd frontend && pnpm tsc --noEmit
  - 前端：cd frontend && pnpm test（SessionListLayout / runtime-session-dialog / logsToTurns / change-session-section / interactive-session-panel 全绿）
  - Alembic：cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head（可逆）
acceptance:
  - 前端 pnpm tsc --noEmit 通过
  - 前端 pnpm test 全绿（含 task-09/13 新增测试，零回归）
  - 后端 ruff check + ruff format --check + mypy app 通过
  - 后端 pytest 全绿，覆盖率 ≥60%
  - Alembic upgrade head + downgrade -1 均成功（可逆）
verify:
  - cd frontend && pnpm tsc --noEmit
  - cd frontend && pnpm test
  - cd backend && uv run ruff check && uv run ruff format --check && uv run mypy app
  - cd backend && uv run pytest
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
constraints:
  - 非测试逻辑本身有误时禁止改测试「通过」（CLAUDE.md 规则 8），全量门失败时回查实现而非迁就测试
  - 改 router 必跑 test_router 不只 test_service（记忆 [[backend-router-change-run-router-tests]]）
  - mypy type:ignore 禁中文（记忆 [[mypy-type-ignore-no-chinese]]），只留 code
  - coverage ≥60%（requirements 非功能需求）
  - 此任务不写新代码，仅跑门禁；若失败回查对应 task 修复
---

## 验收标准
- 前端 pnpm tsc --noEmit 通过
- 前端 pnpm test 全绿（含 task-09/13 新增测试，零回归）
- 后端 ruff check + ruff format --check + mypy app 通过
- 后端 pytest 全绿，覆盖率 ≥60%
- Alembic upgrade head + downgrade -1 均成功（可逆）

## 验证步骤
- cd frontend && pnpm tsc --noEmit
- cd frontend && pnpm test
- cd backend && uv run ruff check && uv run ruff format --check && uv run mypy app
- cd backend && uv run pytest
- cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
