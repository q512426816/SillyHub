---
id: task-13
title: 'gen:types sync and openapi.json update'
title_zh: 'gen:types 同步与 openapi.json 更新'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/package.json
  - frontend/openapi-ts.config.ts
goal: >
  在 task-02 新增 plan-response 端点与 SSE 事件 DTO 后，
  通过 `pnpm gen:types` 重新从前端 OpenAPI 生成 TypeScript 类型，
  确保 frontend/src/lib/api-types.ts 与后端 schema 严格一致，
  避免前端消费 Plan/Bash 新事件时出现类型漂移。
implementation:
  - 确认前端 node_modules 健康：`cd frontend && pnpm exec tsc --version` 正常输出版本；若异常先 `pnpm install --force` 修复间接依赖（csstype 等）。
  - 执行 `cd frontend && pnpm gen:types`，从 backend/openapi.json 重新生成 frontend/src/lib/api-types.ts。
  - 检查生成 diff：确认出现 `/api/daemon/sessions/{session_id}/plan-response` 端点、`PlanResponseRequest`、`PlanModeEnteredEvent`、`BashStatusEvent`、`BashChunkEvent` 等 schema 类型。
  - 运行 `cd frontend && pnpm exec tsc --noEmit`，确保生成类型无编译错误；若暴露与本次无关的旧 mock 债，顺手补字段而非改回手写。
  - 将 backend/openapi.json 与 frontend/src/lib/api-types.ts 作为同一对产物提交，保持 OpenAPI 与类型同步。
acceptance:
  - frontend/src/lib/api-types.ts 包含 plan-response 端点 operation 与新事件相关 components schemas。
  - pnpm exec tsc --noEmit 在 frontend 通过。
  - backend/openapi.json 与 api-types.ts 的 diff 仅含本次新增内容，无无关回退。
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁止在 api-types.ts 中手写类型；所有类型必须从 OpenAPI 生成。
  - openapi.json 与 api-types.ts 必须成对提交，不可只提交其中一个。
  - 本 task 不改动业务实现，只同步类型与 OpenAPI 产物。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
