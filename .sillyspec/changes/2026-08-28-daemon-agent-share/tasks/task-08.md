---
id: task-08
title: regen-openapi-types-sync-commit
title_zh: 'gen:types 再生成（backend/openapi.json + frontend api-types.ts 同步提交，CLAUDE.md 规则 21）'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-03', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: ['task-09', 'task-10']
expects_from:
  task-04:
    - contract: SharedAgentView
      needs: [writable_dir, enabled]
  task-06:
    - contract: SharedDaemonsGrantField
      needs: [grant_id]
  task-07:
    - contract: MachinesSharedToMe
      needs: [shared_to_me]
requirement_ids: [FR-01, FR-04, FR-05]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  在 task-03~07 后端 schema 与端点改动完成后重新生成 backend/openapi.json 与 frontend/src/lib/api-types.ts 并放入同一提交，保证前端类型不落后后端（CLAUDE.md 规则 21）。
implementation:
  - 前置确认 task-03/04/05/06/07 的后端 schema 改动已合入——machines/runtimes-page 响应 shared_to_me 字段、shared-agents 端点 DTO、shared-daemons 响应 grant_id
  - node_modules 健康预检——cd frontend && pnpm exec tsc --version 可跑且 node_modules/.bin 有 openapi-typescript shim；半坏先 pnpm install --force 修，不把假错当代码问题（CLAUDE.md 规则 21）
  - cd frontend && pnpm gen:types（脚本为 node scripts/gen-api-types.mjs，内部先在 backend 跑 uv run python scripts/dump_openapi.py 刷新 openapi.json，再 npx --no-install openapi-typescript 生成 api-types.ts）
  - 核对 api-types.ts diff 含预期新面（shared_to_me 与 SharedAgent 系列类型、grant_id 字段）且无预期外漂移；暴露与本次无关的旧类型债按惯例顺手修，不回退手写
  - backend/openapi.json 与 frontend/src/lib/api-types.ts 放入同一提交，两文件同时入库不让类型形成债
acceptance:
  - api-types.ts 含 machines/runtimes-page 响应的 shared_to_me 字段类型与 /daemon/shared-agents 相关请求/响应类型
  - cd frontend && pnpm typecheck 通过（tsc --noEmit，消费 api-types 的现有前端代码零类型错误）
  - backend/openapi.json 与 frontend/src/lib/api-types.ts 属同一提交，且再跑 pnpm gen:types:check 无 diff（生成物已同步提交）
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm gen:types:check
constraints:
  - 两文件必须同一提交（backend/openapi.json 与 frontend/src/lib/api-types.ts，CLAUDE.md 规则 21），禁止只提其一
  - gen:types 前必须做 node_modules 健康预检；node_modules 半坏时报的 CSSProperties 缺属性与 Cannot find module 是假错，先 pnpm install --force 不误判成代码问题
  - 禁止手写 api-types.ts，类型只能由 gen:types 生成；本卡不改后端 Python schema，发现 schema 缺口回对应 task 修
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
