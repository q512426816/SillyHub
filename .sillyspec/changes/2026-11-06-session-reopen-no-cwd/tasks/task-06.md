---
id: task-06
title: 'gen:types 双端生成物（api-types ×2 + openapi.json）+ 聚焦测试收口'
title_zh: 'gen:types 双端生成物（api-types ×2 + openapi.json）+ 聚焦测试收口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v2]
depends_on: [task-03, task-04, task-05]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
goal: >
  schema 变更落 OpenAPI 并双端生成类型（仓规则 21/⑨ gen:types 义务），随后聚焦测试全绿收口——不跑全量（规则 0）。
implementation:
  - 确认 frontend node_modules 健康（`pnpm exec tsc --version` 能跑）后跑 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types`，核对生成物含新可选 cwd 字段、DaemonSessionNoCWD 错误码从 OpenAPI 面消失
  - 聚焦测试收口：backend `uv run --project backend pytest app/modules/daemon/tests/test_session_reopen.py app/modules/daemon/tests/test_session_reconnect_sweep.py -x -q`；daemon `pnpm -C sillyhub-daemon test -- daemon-session-resume-route`；如改 openapi 断言类既有测试受影响一并修复（schema 演进属有意变更）
acceptance:
  - frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts + backend/openapi.json 三件生成物更新且包含新 cwd 可选字段
  - OpenAPI 中无 DaemonSessionNoCWD 残留（grep 断言）
  - 两侧聚焦测试全绿
verify:
  - pnpm gen:types && pnpm -C sillyhub-daemon gen:types
  - uv run --project backend pytest app/modules/daemon/tests/test_session_reopen.py app/modules/daemon/tests/test_session_reconnect_sweep.py -x -q
  - pnpm -C sillyhub-daemon test -- daemon-session-resume-route
constraints:
  - 禁跑全量测试（规则 0）
  - 生成物只含本变更 schema 演进的差异（发现无关旧债按惯例顺手修好并如实报告）
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
