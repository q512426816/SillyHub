---
plan_level: light
author: qinyi
created_at: 2026-07-04T00:51:06
---

# 轻量计划：后端 OpenAPI 自动生成前端 TypeScript 类型

## 来源
proposal.md / design.md（changeDir 下）。建立「后端 schema 改 → 前端类型自动跟改」闭环，消除前端 lib/ 手写类型漂移（铁证：前端 WorkspaceStatus 漏 pending，workspaces.ts:26 vs schema.py:12）。

## 范围
- `backend/scripts/dump_openapi.py`（新增，静态导出 openapi.json，不连 DB/不跑 lifespan）
- `backend/openapi.json`（新增，dump 产物，git 提交作前端输入源）
- `frontend/scripts/gen-api-types.mjs`（新增，dump + 生成一体脚本）
- `frontend/src/lib/api-types.ts`（新增，openapi-typescript 生成的类型，git 提交）
- `frontend/package.json`（改，加 devDep openapi-typescript + scripts `gen:types` / `gen:types:check`）
- `frontend/src/lib/health.ts`（改，示范迁移：手写 interface → 引用 api-types.ts）
- `.claude/hooks/pre-commit-ci-check.cjs`（改，提醒式守门）
- `backend/app/modules/health/router.py`（视情况改：若 `/api/health` 返回 dict 无 schema，补 Pydantic 响应模型）

## Wave 1：工具链搭建
- [ ] task-01: 新增 `backend/scripts/dump_openapi.py`（import app.main:app → app.openapi() dump），跑 `uv run python scripts/dump_openapi.py` 产出 `backend/openapi.json`，验证 JSON 合法且含 paths（覆盖：FR-01, D-002@V1）
- [ ] task-02: `cd frontend && pnpm add -D openapi-typescript`；新增 `frontend/scripts/gen-api-types.mjs`（dump + npx openapi-typescript 一体）；`package.json` 加 `gen:types` / `gen:types:check` scripts（覆盖：FR-02, NFR-04, D-001@V1）（依赖 task-01）
- [ ] task-03: 跑 `pnpm gen:types` 生成首版 `frontend/src/lib/api-types.ts`；验证含 paths + components.schemas，且 WorkspaceStatus 含 `pending`（漂移修复确认）（覆盖：FR-02, D-003@V1）（依赖 task-01, task-02）

## Wave 2：迁移、守门与验收
- [ ] task-04: 核实 `/api/health` 响应有否 schema，无则后端补 `HealthResponse` Pydantic 响应模型；改 `frontend/src/lib/health.ts` 引用 `api-types.ts`；`pnpm typecheck` 通过（覆盖：FR-04）（依赖 task-03）
- [ ] task-05: 改 `.claude/hooks/pre-commit-ci-check.cjs` 加提醒式检查（backend `schema.py` 改 + `api-types.ts` 未同步 → log 提醒，不 block）（覆盖：FR-03, D-004@V1）
- [ ] task-06: 全量验收 — backend `ruff check` / `ruff format --check` / `mypy app` / `pytest`；frontend `lint` / `typecheck` / `test` / `build`；`gen:types:check` exit 0；更新 `modules/frontend.md` 注意事项 + 变更索引（覆盖：FR-03, NFR-01/02/03, D-005@V1）（依赖 task-01~05）

## 验收
- AC-01: `backend/openapi.json` 含所有 router 的 paths，JSON 合法
- AC-02: `pnpm gen:types` 成功生成 `frontend/src/lib/api-types.ts`
- AC-03: `api-types.ts` 中 WorkspaceStatus 含 `"pending"`（漂移修复）
- AC-04: `health.ts` 迁移后 `pnpm typecheck` 通过
- AC-05: backend `ruff check` / `ruff format --check` / `mypy app` / `pytest` 全绿
- AC-06: frontend `lint` / `typecheck` / `test` / `build` 全绿
- AC-07: `pnpm gen:types:check` 在 api-types 已同步时 exit 0
- AC-08: pre-commit 提醒式检查正确触发且不 block commit

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1 | task-02 | AC-02 |
| D-002@V1 | task-01 | AC-01 |
| D-003@V1 | task-03 | AC-02, AC-03 |
| D-004@V1 | task-05 | AC-08 |
| D-005@V1 | task-04, task-06 | AC-04 |
