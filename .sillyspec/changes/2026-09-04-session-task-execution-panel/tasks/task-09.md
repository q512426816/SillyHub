---
id: task-09
title: '类型同步——pnpm gen:types（api-types.ts + openapi.json，先验 node_modules 健康）'
title_zh: '类型同步——pnpm gen:types（api-types.ts + openapi.json，先验 node_modules 健康）'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: [task-02]
blocks: [task-06]
requirement_ids: [FR-06]
decision_ids: [D-006@v1]
provides:
  - contract: api-types
    fields: [AgentSessionTaskRead]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  在 task-02 后端 DTO 与 GET /tasks 端点落地后跑 pnpm gen:types，重新生成 frontend/src/lib/api-types.ts 与 backend/openapi.json，让前端拿到 AgentSessionTaskRead 生成类型（task-06 listSessionTasks 返回类型的直接依赖）；产物不手写、不落后后端（CLAUDE.md 规则 21 / R-06）。
implementation:
  - 前置健康检查（CLAUDE.md 规则 21 / R-06）：cd frontend && pnpm exec tsc --version 能出版本号、node_modules/.bin 有 openapi-typescript shim；半坏先 pnpm install --force 重建 shim（普通 install 可能命中缓存不修）再继续
  - cd frontend && pnpm gen:types（scripts/gen-api-types.mjs 一条命令完成后端 openapi.json dump + openapi-typescript 类型生成，自带跨平台 shim 检查）
  - 核对产物：api-types.ts 的 components.schemas 含 AgentSessionTaskRead（18 字段，D-006 对齐事件契约）；backend/openapi.json 含 GET /api/daemon/sessions/{session_id}/tasks 端点
  - 两个产物文件一并提交（api-types.ts + backend/openapi.json），不让类型落后后端形成债
acceptance:
  - node_modules 健康检查通过后才执行生成（R-06 防半坏 node_modules 报一堆假错误判成代码问题）
  - api-types.ts 含 AgentSessionTaskRead 且字段覆盖 task-06 needs 清单（task_id / task_name / status / summary / message / started_at / finished_at / elapsed_ms / total_tokens / tool_uses 等 18 项对齐 D-006）
  - backend/openapi.json 含 GET /api/daemon/sessions/{session_id}/tasks
  - cd frontend && pnpm exec tsc --noEmit 全量通过（生成类型与现有前端代码无冲突）
  - 本卡改动仅这两个生成产物，无手写编辑 api-types.ts 的痕迹
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && grep -c AgentSessionTaskRead src/lib/api-types.ts
constraints:
  - 禁手写 / 手改 frontend/src/lib/api-types.ts——只能由 pnpm gen:types 生成（CLAUDE.md 规则 21）
  - 必须在 task-02（DTO + GET /tasks 端点）完成后执行，否则 openapi.json 无新端点可生成；W3 内必须先于 task-06
  - 只允许改这两个产物文件；若生成暴露与本次无关的旧测试债（mock 缺字段等），不在本卡顺手改（不越 allowed_paths），记录到汇报另行处理
  - Windows 兼容；pnpm 命令一律在 frontend/ 目录下执行
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
