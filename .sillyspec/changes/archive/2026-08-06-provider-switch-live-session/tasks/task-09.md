---
id: task-09
title: Frontend switch/stop result toast with type alignment and gen types
title_zh: 前端切换停止结果 toast 加类型对齐加 gen:types
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P1
depends_on: [task-05]
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-list.tsx
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/api/__tests__/llm-providers.test.ts
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
goal: >
  前端切换/停止后按后端 SetDefaultResult 显示结果 toast（受影响会话数、回退本机凭证、失败原因），
  对齐 lib setDefaultProvider/unsetDefaultProvider 返回类型，跑 pnpm gen:types 同步 api-types.ts 与 openapi.json。
implementation:
  - llm-provider-list.tsx handleSetDefault 成功后读 affected_sessions 提示「N 个运行中会话将生效」
  - handleUnsetDefault 成功后提示「运行中会话将回退本机凭证」并带 affected_sessions
  - 切换失败(switched=false 或抛错)时 toast 显示后端返回 error 具体原因
  - lib setDefaultProvider 与 unsetDefaultProvider 返回类型由 LlmProviderRead 改为 SetDefaultResult
  - 跑 pnpm gen:types 同步 frontend/src/lib/api-types.ts 与 backend/openapi.json
acceptance:
  - 切换成功提示受影响运行中会话数
  - 停止成功提示回退本机凭证
  - 失败提示具体失败原因
  - 类型同步无漂移 gen:types 产出与后端 OpenAPI 一致
verify:
  - cd frontend && pnpm lint
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - gen:types 前确认 node_modules 健康(tsc --version 能跑)，半坏先 pnpm install --force 否则假报 CSSProperties 缺失，规则20
  - UI 文案中文规则12 且参考前端样式系统规则19
  - api-types.ts 必须由 gen:types 生成禁止手写规则20
expects_from: {task-05: [{contract: SetDefaultResult, needs: [switched, affected_sessions, error]}]}
---
