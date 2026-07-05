---
author: qinyi
created_at: 2026-07-04T00:51:06
---

# requirements — 后端 OpenAPI 自动生成前端 TypeScript 类型

## 功能需求

### FR-01 后端 OpenAPI 静态导出
- 系统提供 `backend/scripts/dump_openapi.py`，运行后产出 `backend/openapi.json`
- 不启动 HTTP 服务、不连 DB/Redis
- 跨平台（Win/Linux/macOS）

### FR-02 前端类型生成
- `pnpm gen:types` 一条命令完成 dump + 生成 `frontend/src/lib/api-types.ts`
- 生成内容覆盖所有 FastAPI 路由的 paths + components.schemas
- 类型对后端 Pydantic 的 Literal / UUID / datetime 正确映射

### FR-03 守门
- 提供 `pnpm gen:types:check`（重新生成 + `git diff --exit-code`）
- pre-commit 提醒式检查：backend `schema.py` 改 + `api-types.ts` 未改 → 提醒（不拦截）

### FR-04 示范迁移
- `health.ts` 从手写 interface 改为引用 `api-types.ts`
- 迁移后 `tsc` 通过、现有 health 相关测试不回归

## 非功能需求

- NFR-01 跨平台：dump / 生成脚本在 Win / Linux / macOS 均可运行
- NFR-02 零运行时开销：生成的 `api-types.ts` 是 type-only（无 JS 代码进 bundle）
- NFR-03 不破坏现有：apiFetch、token-refresh、现有测试全部保持
- NFR-04 工具链最小侵入：devDep 仅加 openapi-typescript 一个

## 约束

- 复用现有 apiFetch，不替换请求层
- 不引入运行时校验库（zod / ajv）
- 兼容现有 pre-commit hook（mypy / ruff / frontend lint + typecheck + test）

## 成功标准（验收）

1. `pnpm gen:types` 成功生成 `api-types.ts`，含所有 router 的 paths
2. `api-types.ts` 中 `WorkspaceStatus`（或等价 schema）含 `pending`
3. `health.ts` 迁移后 `pnpm typecheck` 通过
4. backend `ruff` / `mypy` / `pytest` 全绿
5. frontend `lint` / `typecheck` / `test` / `build` 全绿
6. `gen:types:check` 在 api-types 已同步时 exit 0
7. pre-commit 提醒式检查正确触发（不 block commit）
