---
id: task-06
title: 'Two-stage polling and truncated hint in events card'
title_zh: '前端卡片两段拉取+truncated+gen:types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: ['task-04', 'task-05']
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/lib/changes.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/components/changes/detail/change-events-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx
  - backend/openapi.json
target_files:
  - frontend/src/lib/changes.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/components/changes/detail/change-events-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx
  - backend/openapi.json
expects_from:
  task-04:
    - contract: ChangeEventListResponseV3
      needs: [v3, truncated, receivedAt]
  task-05:
    - contract: ObservationAlertBar
      needs: [alerts]
goal: >
  卡片探测式两段拉取：首轮 limit=200 探测（与 v2 同请求），响应含 v3=true 后升级
  limit=2000 全量 30s 重拉（不做增量游标）+ truncated 尾行 + 开态挂告警条；gen:types
  重生成类型（D-007）。
implementation:
  - frontend/src/lib/changes.ts listChangeEvents 的 limit 参数透传放宽（200/2000 两段）
  - frontend/src/components/changes/detail/change-events-card.tsx：mode 状态（首请求 200；query.data.v3===true 时切 queryKey 含 mode 升级 limit=2000）；truncated=true 渲染尾行「已截断 · 共 N 条，仅显示最近 2000 条」；开态于卡片上方挂 ObservationAlertBar（alerts=items 中 severity 属 warning/error 的条目）
  - 先确认前端 node_modules 健康（pnpm exec tsc --version 可跑，半坏坑见 docs/sillyspec/），再跑 pnpm gen:types 重生成 api-types.ts 并同步 backend/openapi.json（同批提交）
  - 扩展 frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx：关态断言（响应无 v3 字段→不渲染告警条/无 truncated 行/请求恒 limit=200）+ 开态断言（v3=true→升级请求 2000+truncated 行+告警条挂载）；既有断言一律不弱化只增补
acceptance:
  - 关态：请求形态与渲染与 v2 一致（恒 limit=200、无告警条、无 truncated 行），既有测试零弱化全绿
  - 开态：探测后升级 limit=2000 轮询；truncated 行按 total>2000 渲染；告警条挂载且一次决策生效
  - api-types.ts 与 backend/openapi.json 由 gen:types 生成且无 drift（gen:types:check 口径）
verify:
  - cd frontend && pnpm exec vitest run src/components/changes/detail/__tests__/change-events-card.test.tsx
  - cd frontend && pnpm gen:types:check
constraints:
  - api-types.ts 禁手写；gen:types 前确认 node_modules 健康（半坏时假错坑）
  - 30s refetchInterval 与失败静默隐藏（isError 返回 null）语义不变
  - 前端不做增量游标（不携带 since 参数）
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
