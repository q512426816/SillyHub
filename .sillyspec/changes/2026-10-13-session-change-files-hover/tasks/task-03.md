---
id: task-03
title: 'frontend data layer for session changes'
title_zh: '前端数据层：gen:types + listSessionChanges/useSessionChanges + queryKeys'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:20:26
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v2, D-003@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/changes.ts
  - frontend/src/lib/query-keys.ts
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/changes.ts
  - frontend/src/lib/query-keys.ts
expects_from:
  - contract: 会话关联变更列表端点
    needs:
      - 'GET /api/workspaces/{workspace_id}/changes/-/by-session/{session_id} 路径进 OpenAPI（gen:types 数据源）'
      - '200 响应 list[ChangeSummary]'
provides:
  - contract: 会话变更数据层 hook
    fields:
      - 'listSessionChanges(workspaceId, sessionId) 返回 ChangeSummary[]'
      - 'useSessionChanges(workspaceId, sessionId, { active }) —— queryKey 走 sessionChanges 工厂，active 为真时 refetchInterval=15000 否则不轮询，staleTime 10s'
goal: >
  前端数据层供给：从 task-01 的新端点生成 API 类型 + fetch 函数 + react-query hook
  （悬浮入口显隐/徽标与下拉列表数据源，FR-01/FR-05）。
implementation:
  - 跑 `pnpm gen:types`（frontend 目录）再生成 frontend/src/lib/api-types.ts + backend/openapi.json（后端须已含 task-01 端点；gen 前确认 node_modules 健康：pnpm exec tsc --version 可跑，CLAUDE.md 规则 21）
  - frontend/src/lib/changes.ts 参照既有 listChanges（frontend/src/lib/changes.ts:92）模式加 `listSessionChanges(workspaceId, sessionId)`：GET `/api/workspaces/${workspaceId}/changes/-/by-session/${sessionId}`，返回 `components["schemas"]["ChangeSummary"][]`（类型从 api-types 取，ChangeSummary 类型既有导出复用 frontend/src/lib/changes.ts:8）
  - 同文件加 `useSessionChanges` hook（react-query 三件套惯例：fetch 函数同文件 + useQuery 封装）：queryKey `queryKeys.sessionChanges(workspaceId, sessionId)`，staleTime 10_000，refetchInterval 由参数 active 控制（active ? 15_000 : false），placeholderData 保持上次数据
  - frontend/src/lib/query-keys.ts 工厂注册 `sessionChanges(wid, sid)` 键工厂（返回 ["sessionChanges", wid, sid] as const；凡影响结果的变量进 key，本文件头规则）
acceptance:
  - api-types.ts 含新端点路径类型（grep by-session 命中），且为 gen 产物非手写（gen:types:check 无漂移）
  - useSessionChanges 在 active=true 时 15s 轮询 / false 时不轮询
  - tsc --noEmit 零错误
verify:
  - cd frontend && pnpm gen:types && git diff --exit-code src/lib/api-types.ts ../backend/openapi.json（生成后含新端点为预期 diff，非漂移）
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - api-types.ts 禁手写（必须 gen:types 生成，CLAUDE.md 规则 21）
  - 不改既有 listChanges/getChange 等函数签名
  - queryKey 全部走 query-keys.ts 工厂（禁内联字面量数组）
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
