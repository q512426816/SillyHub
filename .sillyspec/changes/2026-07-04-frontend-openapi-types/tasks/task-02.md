---
id: task-02
title: 前端类型生成工具链（openapi-typescript + 生成脚本）
author: qinyi
created_at: 2026-07-04T00:51:06
priority: high
depends_on: [task-01]
blocks: [task-03]
allowed_paths:
  - frontend/scripts/gen-api-types.mjs
  - frontend/package.json
  - frontend/pnpm-lock.yaml
---

## 目标
接入 openapi-typescript，提供 `pnpm gen:types` / `gen:types:check` 一条命令完成 dump + 类型生成。

## 实现步骤
- `cd frontend && pnpm add -D openapi-typescript`
- 新增 `frontend/scripts/gen-api-types.mjs`：先 `uv run python scripts/dump_openapi.py`（cwd=backend），再 `npx openapi-typescript backend/openapi.json -o src/lib/api-types.ts`
- `package.json` 加 `"gen:types": "node scripts/gen-api-types.mjs"` 与 `"gen:types:check": "node scripts/gen-api-types.mjs && git diff --exit-code src/lib/api-types.ts"`

## 验收标准
- `openapi-typescript` 进 devDependencies
- `pnpm gen:types` 成功执行无报错（依赖 task-01 的 dump 脚本）

## 验证方式
`cd frontend && pnpm gen:types` 退出码 0

## 约束
- 脚本用 node:path / node:child_process（跨平台）
- 不改 apiFetch、不替换请求层
- devDep 仅加 openapi-typescript 一个
