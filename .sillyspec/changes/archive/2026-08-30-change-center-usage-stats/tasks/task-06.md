---
id: task-06
title: 'gen-types-and-usage-api-wrappers'
title_zh: '契约生成与前端 API 封装（pnpm gen:types + lib/changes.ts + lib/quicklog.ts）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/changes.ts
  - frontend/src/lib/quicklog.ts
goal: >
  跑 pnpm gen:types 同步 openapi.json 与 api-types.ts，并在 lib/changes.ts / lib/quicklog.ts 封装两个 usage 取数函数，为前端用量卡提供类型化入口。
expects_from:
  task-01:
    - contract: ChangeUsageRead
      needs: [started_at, finished_at, duration_ms, totals, by_model]
    - contract: UsageSummaryRead
      needs: [started_at, finished_at, duration_ms, totals]
  task-04:
    - contract: usage-endpoints
      needs: [GET_changes_usage, GET_quicklog_usage]
provides:
  - contract: ChangeUsageRead-types
    fields: [ChangeUsageRead, UsageSummaryRead]
  - contract: usage-api-client
    fields: [getChangeUsage, getQuicklogUsage]
implementation:
  - 先确认前端 node_modules 健康（pnpm exec tsc --version 能跑，CLAUDE.md 规则 21），再跑 pnpm gen:types 生成 api-types.ts 与 backend/openapi.json，复核含 4 个新 schema（UsageByModelItemRead/UsageTotalsRead/UsageSummaryRead/ChangeUsageRead）与 2 个新端点路径
  - lib/changes.ts 新增 ChangeUsageRead 类型别名（components.schemas.ChangeUsageRead）与 getChangeUsage(workspaceId, changeId)，请求 GET /api/workspaces/{wid}/changes/{cid}/usage，apiFetch 封装风格对齐 getChange
  - lib/quicklog.ts 新增 getQuicklogUsage(workspaceId, qlId) 返回生成物 ChangeUsageRead，请求 GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/usage，qlId 经 encodeURIComponent 对齐 getQuicklogDetail
acceptance:
  - api-types.ts 含 4 个新 schema 且 ChangeSummary/QuicklogEntryListItem 带 optional usage 字段
  - getChangeUsage/getQuicklogUsage 路径与签名正确，返回类型对齐生成物
  - openapi.json 与 api-types.ts 同步更新且一并提交
verify:
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - api-types.ts 与 openapi.json 为生成物禁止手改
  - gen:types 前确认 node_modules 健康（CLAUDE.md 规则 21，半坏会报假 CSSProperties 错，用 pnpm install --force 修复）
  - 生成物随本任务一并提交，不让类型落后后端形成债
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
