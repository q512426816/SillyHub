---
id: task-10
title: 'contract closeout and full regression'
title_zh: '契约收口（api-types.ts + openapi.json 复核同步）与回归（change 模块 pytest + frontend 测试 + tsc）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-05', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/changes/detail/change-usage-card.tsx
goal: >
  契约收口（api-types.ts 与 openapi.json 同后端复核同步）加全链路回归（change 模块 pytest + frontend 相关测试 + tsc），确认全 FR 验收达标、既有测试零回归。
expects_from:
  task-06:
    - contract: ChangeUsageRead-types
      needs: [ChangeUsageRead, UsageSummaryRead]
  task-07:
    - contract: ChangeUsageCard
      needs: [kind, workspaceId, refKey]
implementation:
  - 复核 pnpm gen:types 产物与后端一致——api-types.ts 含 ChangeUsageRead/UsageSummaryRead/UsageByModelItemRead/UsageTotalsRead 四 schema 与两个 usage 端点、ChangeSummary 与 QuicklogEntryListItem 的 usage 字段，openapi.json 同步；有偏差重跑 gen:types 落盘入 git
  - 回归后端 change 模块 pytest 全绿，重点确认 test_enrich_projection 等既有用例零回归（R-06）
  - 回归前端——change-usage-card/quicklog-table/quicklog-drawer 相关测试全绿，tsc 0 错
  - 对照 plan 全局验收标准 1-6 逐项复核收口（聚合口径/列表零 N+1/端点 404/前端展示/契约同步/零迁移兼容）
acceptance:
  - api-types.ts 与 backend/openapi.json 同后端一致，gen:types 重跑幂等无 diff
  - change 模块 pytest 全绿（含 test_enrich_projection 既有用例）；frontend 相关测试全绿、tsc 0 错
  - plan 全局验收标准逐项核对通过，无未收口残留
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- src/components/changes
  - cd backend && uv run pytest app/modules/change -q --no-cov -n auto
constraints:
  - 不动移动端 m/** 页面
  - 不改 daemon 侧任何代码
  - 样式走双主题规范（brand-* 语义阶、阴影走主题 token，禁手写 blue-* 色阶）
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
