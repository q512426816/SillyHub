---
id: task-14
title: type-sync-and-module-docs-finalize
title_zh: 类型同步（frontend/daemon api-types + backend openapi.json）+ agent/daemon 模块文档更新收尾
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P1
depends_on: [task-05, task-06, task-08, task-10, task-11, task-12, task-13]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/changes/2026-08-22-team-session-unify/module-impact.md
goal: >
  变更收尾——task-05~08/10~13 合入后再生三份类型产物（frontend api-types.ts +
  backend openapi.json + daemon api-types.ts，CLAUDE.md 规则 21 禁止手写），并按
  module-impact.md 把三份模块文档的更新结果表回填 done。
implementation:
  - frontend 类型再生——先做 node_modules 健康预检（pnpm exec tsc --version 可跑 半坏先 pnpm install --force）再 cd frontend && pnpm gen:types 产出 src/lib/api-types.ts 与 backend/openapi.json 一并提交
  - daemon 类型再生——cd sillyhub-daemon && pnpm gen:types 同步 src/api-types.ts（team-mission 新端点/DTO 与 5 个 MCP 端点参数可选化后的 schema）
  - 模块文档回填——按 module-impact.md 模块影响矩阵刷新 modules/backend.md（mission 会话绑定/双标记/converge 语义/端点增删/patrol 适配）、modules/sillyhub-daemon.md（注入谓词/MCP 会话上下文）、modules/frontend.md（TeamTaskBlock/触发入口/删旧页面）并把 module-impact.md 更新结果表三行 pending 改 done
  - 若 gen:types 暴露与本次无关旧测试债（mock 缺字段）按惯例顺手补齐 不改回手写
acceptance:
  - cd frontend && pnpm gen:types 成功且 api-types.ts 与 openapi.json 均提交（类型不落后后端）
  - daemon api-types 同步完成（新增端点/DTO 与可选化参数出现在 sillyhub-daemon/src/api-types.ts）
  - 三份模块文档按 module-impact.md 更新结果表回填 done
verify:
  - cd frontend && pnpm gen:types && pnpm typecheck
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 纯同步与文档收尾 不改任何业务源码；api-types 与 openapi.json 仅由生成器产出 禁止手写
  - 端点与 schema 形态以 task-05~08/10~13 实际合入代码为准 对不上先回对应任务修 不在本卡改契约
  - 文档只动三份模块卡与 module-impact.md 结果表 不动 scan 目录 CONVENTIONS/ARCHITECTURE
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
