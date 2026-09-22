---
id: task-06
title: '类型契约——pnpm gen:types 再生成 api-types + openapi.json 提交'
title_zh: '类型契约——pnpm gen:types 再生成 api-types + openapi.json 提交'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: api-types
    fields: [WorkspaceMoveRequest, WorkspaceMoveResponse]
expects_from:
  task-02:
    - contract: WorkspaceMoveRequest
      needs: [after_id, before_id, to, page_size]
    - contract: WorkspaceMoveResponse
      needs: [workspace, rebalanced, rank]
goal: >
  执行 pnpm gen:types 把 task-02 落地的 move 端点契约再生成进 backend/openapi.json 与
  frontend/src/lib/api-types.ts，保持前端接口类型与后端 schema 同源（CLAUDE.md 规则 21），
  供 task-07 moveWorkspace 封装消费。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version 能跑（node_modules 半坏会报假的 CSSProperties / Cannot find module 错，CLAUDE.md 规则 21；修复用 pnpm install --force，普通 install 命中缓存不修 shim）
  - cd frontend && pnpm gen:types（frontend/package.json:14 —— dump backend/openapi.json + openapi-typescript 生成 frontend/src/lib/api-types.ts）
  - 检查产物：api-types.ts 含 WorkspaceMoveRequest（after_id/before_id/to/page_size）与 WorkspaceMoveResponse（workspace/rebalanced/rank）完整字段；openapi.json 含 POST /workspaces/{workspace_id}/move 路径与请求/响应 schema
  - gen:types 会联动 ../sillyhub-daemon/scripts/gen-provider-caps.mjs（provider caps 再生成），其产物不在本 task 范围——确认无意外变更、不纳入本 task 提交
  - 若生成或后续前端检查暴露与本次无关的旧测试债（如 mock 缺字段）：按惯例顺手补字段修好，而不是为躲报错回退手写类型（CLAUDE.md 规则 21）
acceptance:
  - backend/openapi.json 含 POST /workspaces/{workspace_id}/move（含 WorkspaceMoveRequest/WorkspaceMoveResponse schema）
  - frontend/src/lib/api-types.ts 含 WorkspaceMoveRequest 与 WorkspaceMoveResponse 完整字段（after_id/before_id/to/page_size + workspace/rebalanced/rank）
  - 两文件均为生成器产物更新，无手写补丁痕迹
verify:
  - git diff --stat backend/openapi.json frontend/src/lib/api-types.ts（两文件均出现在 diff 中）
  - grep -n "WorkspaceMoveRequest\|WorkspaceMoveResponse" frontend/src/lib/api-types.ts（确认 after_id/before_id/to/page_size 与 workspace/rebalanced/rank 已生成）
  - grep -n "workspaces/{workspace_id}/move" backend/openapi.json（确认 move 路径已 dump）
constraints:
  - 禁止手写 frontend/src/lib/api-types.ts（必须由 pnpm gen:types 生成，CLAUDE.md 规则 21）
  - gen:types 暴露无关旧测试债时顺手修而非回退手写；仅限确证与本变更无关的最小修复
  - 提交仅含 backend/openapi.json + frontend/src/lib/api-types.ts（连同确证必要的顺手修复），不含无关文件；sillyhub-daemon 联动产物不纳入提交
  - 禁止跑全量测试（CLAUDE.md 规则 0）
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
