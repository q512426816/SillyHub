---
id: task-02
title: '契约同步：gen:types ×2 + 提交 openapi.json 与两份 api-types'
title_zh: '契约同步：gen:types ×2 + 提交 openapi.json 与两份 api-types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-008@v1]
provides:
  - contract: "SillySpecConflictCompareResponse"
    fields: [record_label, covered_changes, path_total]
  - contract: "SpecConflictRead"
    fields: [id, status]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
goal: >
  后端 compare 响应新增三可选字段后，按规则 21 在同一 change 内再生 OpenAPI 与前端/daemon 两份类型，
  保证类型不落后后端（daemon-ci 断言面闸门⑨ fail-closed）。
implementation:
  - 前置：git status 检查 backend/openapi.json 与 frontend/src/lib/api-types.ts 是否已有他会话未提交改动（本会话开工时两者均为 M）；若有——先与用户确认提交顺序/暂缓，或只挑本 change 相关 hunk，禁止把他人 WIP 卷进本 change（frontend/scripts/gen-api-types.mjs 内置并行会话守卫，--force 仅在已核对上游 WIP 与本次无关时使用）
  - 确认前端 node_modules 健康：pnpm exec tsc --version 可跑（半坏先 pnpm install --force——规则 21）
  - cd frontend && pnpm gen:types（内含 backend/scripts/dump_openapi.py 刷新 backend/openapi.json + openapi-typescript 重写 frontend/src/lib/api-types.ts）
  - cd sillyhub-daemon && pnpm gen:types（消费同一 openapi.json，重写 sillyhub-daemon/src/api-types.ts）
  - 核对三文件 diff 仅含 record_label/covered_changes/path_total 相关增量（无无关接口漂移）
acceptance:
  - backend/openapi.json、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts 三文件均已按生成器重写，diff 仅覆盖 compare 响应新增字段（SillySpecConflictCompareResponse 内的三个可选字段）
  - cd frontend && pnpm gen:types:check 与 cd sillyhub-daemon && pnpm gen:types:check 均通过（生成物与提交一致）
verify:
  - cd frontend && pnpm gen:types && git diff --stat -- ../backend/openapi.json src/lib/api-types.ts
  - cd ../sillyhub-daemon && pnpm gen:types && git diff --stat -- src/api-types.ts
constraints:
  - 禁止手写 api-types（必须生成物）；禁止把与本次无关的漂移卷进提交；不改 daemon 业务代码（仅生成物）
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
