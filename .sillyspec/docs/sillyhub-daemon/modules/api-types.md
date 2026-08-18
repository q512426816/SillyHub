---
schema_version: 1
doc_type: module-card
module_id: api-types
author: qinyi
created_at: 2026-08-18 01:45:00
---

# API 类型生成物（api-types）

## 定位
后端 OpenAPI 契约的 TypeScript 类型生成物（openapi-typescript 生成，约 32k 行），头部注释明示 auto-generated / do not make direct changes。daemon 侧与 backend REST 契约对齐的类型面来源。

## 契约摘要
- 导出四个类型命名空间：`paths` / `components` / `operations` / `webhooks`（openapi-typescript 标准产物）。
- 生成链：backend 跑 `dump_openapi.py`（或前端 `pnpm gen:types`）刷新 `backend/openapi.json` → daemon 跑 `pnpm gen:types`（`scripts/gen-api-types.mjs`）产出 `src/api-types.ts`。
- 守护脚本：`pnpm gen:types:check` = 重新生成后 `git diff --exit-code src/api-types.ts`，防生成物与 openapi.json 漂移。
- gen 脚本内置 node_modules 健康自检（openapi-typescript 的 .bin shim 必须在，pnpm 半坏时报错而非生成假失败）。

## 关键逻辑
```text
backend/openapi.json --openapi-typescript--> src/api-types.ts
后端 schema（DTO/请求/响应）有改动 → 同一 change 内必须重新生成并提交
```

## 注意事项
- **生成物，禁止手写/手改**；要改契约只能改 backend schema 后重新生成。
- 实测（grep 全 src）**src 内无任何模块 import 它**——类型面供外部/测试用；scan 文档中「hub-client 类型全部来自 api-types」的说法与现状不符，hub-client 实际自带手写 body 类型（snake_case 对齐 backend Pydantic）。
- 后端 OpenAPI 改动不让此文件同步更新会形成类型债；CI/流程上靠 gen:types:check 拦截。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
