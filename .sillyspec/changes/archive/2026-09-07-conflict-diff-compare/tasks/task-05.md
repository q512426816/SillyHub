---
id: task-05
title: 'gen:types 重新生成 api-types.ts + openapi.json'
title_zh: 'gen:types 重新生成 api-types.ts + openapi.json'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-10]
decision_ids: []
provides:
  - contract: ApiTypes
    fields: [SillySpecConflictCompareResponse, DaemonHeartbeatSillySpecConflict.ql_id]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  task-04 的 compare 端点 + DaemonHeartbeatSillySpecConflict.ql_id 落进后端 schema 后，按
  CLAUDE.md:36 硬规则跑 pnpm gen:types 重新生成 api-types.ts 并同步 openapi.json，让
  task-06/07/08 有真实生成类型可消费，不留类型债。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version 能跑且 .bin 有 shim；node_modules 半坏（假 CSSProperties/缺 @ant-design/icons 报错）先 pnpm install --force（普通 install 命中缓存不修）
  - cd frontend && pnpm gen:types（scripts/gen-api-types.mjs，backend OpenAPI 经 openapi-typescript 生成）
  - 核对产物：api-types.ts 含 SillySpecConflictCompareResponse（files[]/progress_rows[]/local_updated_at/platform_updated_at/ql_id/response_truncated/dropped_paths）与 DaemonHeartbeatSillySpecConflict 新增可选 ql_id；backend/openapi.json 含 compare 端点路径与同名字段
  - 两产物随本变更一起提交（FR-10，类型不落后后端）
acceptance:
  - api-types.ts 含 compare 新端点类型 SillySpecConflictCompareResponse 与 DaemonHeartbeatSillySpecConflict.ql_id 字段
  - backend/openapi.json 同步更新，与 api-types.ts 同变更提交
  - cd frontend && pnpm exec tsc --noEmit 通过（生成类型无语法/引用破损）
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - api-types.ts 只从后端 OpenAPI 生成，禁止手写或手工修补
  - gen:types 若暴露与本变更无关的旧测试债（如 mock 缺字段），按 CLAUDE.md:39 顺手补字段修好，不为躲报错改回手写
  - 不改 scripts/gen-api-types.mjs 与任何后端源文件（schema 改动归 task-04）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
