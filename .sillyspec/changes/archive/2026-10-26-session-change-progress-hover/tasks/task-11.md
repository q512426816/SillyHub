---
id: task-11
title: 'Regenerate dual api-types and openapi'
title_zh: '双 gen:types 收口（frontend+sillyhub-daemon api-types.ts + backend/openapi.json 同提交）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10]
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
goal: >
  schema 定稿后最终态收口：前端与 daemon 双 api-types 再生成 + openapi.json 同提交（CLAUDE.md 规则 21 双义务，防类型落后后端成债）。
implementation:
  - '确认 backend/app/modules/change/schema.py 与 heartbeat 载荷 schema 均为最终态（task-01~07 全落地后）'
  - 'cd frontend && pnpm gen:types；cd sillyhub-daemon && pnpm gen:types（daemon 侧拉掉 task-07 手写过渡 interface 换生成类型）'
  - '三文件（frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、backend/openapi.json）同一提交核对（断言面闸门⑨口径）'
acceptance:
  - '生成物含三新 DTO 与 ChangeSummary/心跳载荷新字段；手写过渡类型已移除；双端 typecheck 通过'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - '生成前确认 node_modules 健康（CLAUDE.md 规则 21：pnpm exec tsc --version 可跑；半坏会报假 CSSProperties/模块缺失错，修复 pnpm install --force）'
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
