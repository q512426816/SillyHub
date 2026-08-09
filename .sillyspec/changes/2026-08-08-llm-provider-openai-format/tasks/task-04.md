---
id: task-04
title: regenerate OpenAPI + frontend api-types, hand-add api_format to llm-providers.ts
title_zh: OpenAPI 重生成 + 前端 gen:types + llm-providers.ts 手写补 api_format（债登记）
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-02]
blocks: [task-05, task-06]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/openapi.json
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/lib/api-types.ts
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/lib/api/llm-providers.ts
related_tests: []
goal: >
  schema 加 api_format（task-02）后，backend 重生成 openapi.json；前端 pnpm gen:types 重生成 api-types.ts；lib/api/llm-providers.ts 手写 LlmProvider* 类型补 api_format 字段并显式登记手写债（FR-10, 规则 20）。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version（能跑 + .bin 有 shim）；若报假的 CSSProperties/@ant-design/icons 缺失 → pnpm install --force 修 node_modules（规则 20 坑，根因 csstype 间接依赖）
  - backend：按本仓库既有方式重生成 openapi.json（local.yaml 或 package.json 脚本，对照 local.yaml 的 backend gen:openapi 等价命令），确认 openapi.json 的 LlmProvider* schema 含 api_format
  - frontend：cd frontend && pnpm gen:types 重生成 src/lib/api-types.ts；确认生成的 LlmProvider*（或 components[schemas] 形态）含 api_format: "anthropic"|"openai_chat"
  - frontend/src/lib/api/llm-providers.ts：手写 LlmProvider* 类型（LlmProviderCreate/Update/Read/FetchModelsRequest 等本文件定义的）补 api_format: "anthropic"|"openai_chat"（Create/Update 可选 default anthropic，Read 必填）
  - 文件头注释 / 债登记：在 llm-providers.ts 顶部自述区显式标注「本模块 LlmProvider* 仍手写，未整体迁 components[schemas] 生成类型（独立 frontend-type-migration 坑）；本期 api_format 走手写补字段」——design §6 文件清单第 8 行已声明该债，不在本变更做整体迁移
  - 提交 openapi.json + api-types.ts + llm-providers.ts 三件套（规则 20：schema 改动必须同 change 跑 gen:types 并提交，不让类型落后后端）
acceptance:
  - backend/openapi.json 的 LlmProvider* schema 含 api_format 字段
  - frontend/src/lib/api-types.ts 含 api_format（gen:types 产出，非手写）
  - frontend/src/lib/api/llm-providers.ts 手写 LlmProvider* 类型补 api_format，文件头债登记在
  - gen:types 未暴露与本次改动无关的旧测试债（若暴露按惯例顺手补字段修好，而非改回手写——规则 20）
verify:
  - cd frontend && pnpm exec tsc --version（node_modules 健康）
  - cd backend && 重生成 openapi.json 后 grep "api_format" backend/openapi.json（命中）
  - cd frontend && pnpm gen:types && grep "api_format" frontend/src/lib/api-types.ts（命中）
  - grep -n "api_format" frontend/src/lib/api/llm-providers.ts（手写类型命中 + 债注释在）
constraints:
  - gen:types 前必须确认 node_modules 健康（规则 20 坑：半坏 node_modules 报假的类型错误）
  - llm-providers.ts 的手写路径仅补 api_format，不顺带做 components[schemas] 整体迁移（独立坑，design §6 显式登记）
  - 仅当 gen:types 暴露与本次改动无关的旧测试债时，按惯例顺手补字段修好；否则不动其它无关类型
  - 不改 model/schema/service 实现（task-01/02 范围）
provides:
  - backend/openapi.json 含 api_format（后端契约对外发布）
  - frontend/src/lib/api-types.ts 含 api_format（生成态类型，供 task-05 表单 / task-06 预设消费）
  - frontend/src/lib/api/llm-providers.ts 手写 LlmProvider* 补 api_format + 债登记注释
expects_from:
  task-02: [LlmProviderCreate/Update/Read/FetchModelsRequest.api_format 字段进 OpenAPI（schema 已加 Literal 字段即自动暴露）]
---

# task-04 实现笔记

design 锚点：§6 文件清单第 8 行（openapi + api-types + llm-providers.ts 手写债）/ plan 任务总表 task-04 行（FR-10）/ 规则 20（前端接口类型从 OpenAPI 生成 + gen:types 前确认 node_modules 健康）。

执行顺序硬约束：先 `pnpm exec tsc --version` 验 node_modules 健康 → 再 backend 生成 openapi.json → 再 `pnpm gen:types` → 最后手写 llm-providers.ts 补字段。半坏 node_modules 会报一堆假的 CSSProperties 错误（规则 20 坑），切勿误判为代码问题，先 `pnpm install --force`。

本任务 blocks task-05（表单）/ task-06（预设）：两前端任务消费 api-types.ts 的 api_format 类型与 llm-providers.ts 手写类型，必须等本任务产出落地。手写债显式登记到文件头注释，留给独立 frontend-type-migration 坑后续清理。
