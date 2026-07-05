---
author: qinyi
created_at: 2026-07-04T00:51:06
---

# tasks — 后端 OpenAPI 自动生成前端 TypeScript 类型

> 任务供 plan.md 细化为 Wave；此处列实施清单。

## T-01 后端 dump 脚本
- 新增 `backend/scripts/dump_openapi.py`
- 跑 `uv run python scripts/dump_openapi.py` 产出 `backend/openapi.json`
- 验证：JSON 合法、含 paths、跨平台

## T-02 前端生成脚本 + devDep
- `cd frontend && pnpm add -D openapi-typescript`
- 新增 `frontend/scripts/gen-api-types.mjs`
- `package.json` 加 `gen:types` / `gen:types:check`

## T-03 生成首版 api-types.ts
- 跑 `pnpm gen:types`
- 提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`
- 验证含 `pending` 状态（漂移修复确认）

## T-04 health.ts 示范迁移
- 核实 `/api/health` 响应是否有 schema；无则补 `HealthResponse` Pydantic 模型
- `health.ts` 改为引用 `api-types.ts`
- `pnpm typecheck` 通过

## T-05 pre-commit 提醒式守门
- 改 `.claude/hooks/pre-commit-ci-check.cjs`：backend `schema.py` 改 + `api-types.ts` 未改 → log 提醒
- 不 block commit

## T-06 全量验收
- backend：`ruff check` / `ruff format --check` / `mypy app` / `pytest`
- frontend：`lint` / `typecheck` / `test` / `build`
- `gen:types:check` exit 0
- 更新模块文档（`modules/frontend.md` 注意事项 + 变更索引）
