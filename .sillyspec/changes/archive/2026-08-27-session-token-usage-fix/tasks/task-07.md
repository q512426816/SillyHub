---
id: task-07
title: 'frontend gen:types + SSE envelope ctx_tokens typing'
title_zh: 'frontend gen:types + lib/daemon.ts SessionStreamEnvelope 补 ctx_tokens（手写 SSE 类型跳）'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-05']
blocks: ['task-08']
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
expects_from:
  - 'task-05：backend SessionRunRead / SSE payload 已含 ctx_tokens（backend/openapi.json 已更新）'
provides:
  - 'frontend/src/lib/api-types.ts：SessionRunRead.ctx_tokens?: number | null（task-08 runsMeta 回填消费）'
  - 'frontend/src/lib/daemon.ts：SessionStreamEnvelope.ctx_tokens?: number | null（task-08 onTokens / 终态 env 写入消费）'
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon.ts
goal: >
  打通 ctx_tokens 前端类型链路：node_modules 健康检查后跑 pnpm gen:types 让
  SessionRunRead 带 ctx_tokens，并给手写 SSE SessionStreamEnvelope 补同名字段
  （gen:types 只覆盖 REST 不覆盖此跳，漏改则前端拿不到字段，design §5 Phase 3.5 / X-07）。
implementation:
  - 前置健康检查（CLAUDE.md 规则 21 / design R-03）：cd frontend && pnpm exec tsc --version 能跑；node_modules 半坏（假报 CSSProperties / 缺 @ant-design 模块）先 pnpm install --force 修复
  - 确认 task-05 产物 backend/openapi.json 的 SessionRunRead schema 已含 ctx_tokens（缺则回 task-05 补，前端不手写类型）
  - cd frontend && pnpm gen:types（node scripts/gen-api-types.mjs）重新生成 frontend/src/lib/api-types.ts，ctx_tokens 以 nullable 字段进 SessionRunRead
  - frontend/src/lib/daemon.ts SessionStreamEnvelope（~:1073）：在 cache_creation_tokens（~:1120）后补 ctx_tokens?: number | null，注释注明 tokens / turn_completed 事件携带、仅 main 桶上报、旧 backend 不下发时为 undefined
acceptance:
  - api-types.ts 的 SessionRunRead 含 ctx_tokens?: number | null，且为脚本生成产物（pnpm gen:types:check 无 diff）
  - backend/openapi.json 与 api-types.ts 同批更新（规则 21：不让类型落后后端）
  - SessionStreamEnvelope 含 ctx_tokens 可选字段；envelope dispatch 已整包透传，无需改解析逻辑
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - api-types.ts 禁止手写，必须 pnpm gen:types 生成（CLAUDE.md 规则 21）
  - lib/daemon.ts 只加 envelope 类型字段，不改 streamSession 解析 / 分发逻辑
  - 不动 session-panel / ctx-usage-bar（消费侧归 task-08）；不加测试（归 task-09）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
