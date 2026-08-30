---
id: task-01
title: 'define backend usage DTO contracts'
title_zh: '后端 usage DTO 契约（schema.py 四个新 DTO + 两列表 optional 计算字段）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-02, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/change/schema.py
provides:
  - contract: ChangeUsageRead
    fields: [started_at, finished_at, duration_ms, totals, by_model]
  - contract: UsageSummaryRead
    fields: [started_at, finished_at, duration_ms, totals]
  - contract: UsageTotalsRead
    fields: [input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_requests, num_turns]
  - contract: UsageByModelItemRead
    fields: [model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_requests]
goal: >
  在 schema.py 落地四个 usage DTO 并给两个列表 DTO 加 optional usage 计算字段，为聚合服务、批量接线与端点提供统一序列化契约（纯契约零行为）。
implementation:
  - 新增 UsageByModelItemRead（model + 四维 token + api_requests，int 默认 0，注释注明兜底桶 api_requests 恒 0）
  - 新增 UsageTotalsRead（四维 token + api_requests + num_turns，int 默认 0）
  - 新增 ChangeUsageRead（started_at 与 finished_at 可空 datetime 默认 None、duration_ms 可空 int 默认 None、totals、by_model 空列表默认，注释固化 R-05 三元组 NULL 组合语义）
  - 新增 UsageSummaryRead（时间三元组默认 None + totals）
  - ChangeSummary 与 QuicklogEntryListItem 各加 usage 字段（UsageSummaryRead 或 None 默认），注释按仓库惯例写明计算字段（DTO 层）非表列零 migration，并注明 producer 为 usage_service 与 enrich 管道、consumer 为前端 api-types 生成物
acceptance:
  - 四个新 DTO 字段名与默认值与 design.md 接口定义逐字段一致
  - 两处 usage 字段均为 optional default None，既有序列化路径零回归
verify:
  - cd backend && uv run ruff check app/modules/change/schema.py && uv run mypy app
  - cd backend && uv run pytest app/modules/change -q --no-cov -n auto
constraints:
  - 零迁移不加表列；不改 daemon
  - 旧客户端兼容——新字段全部 optional default None，不读不受影响
  - 只落契约，不写填充逻辑（归 task-02/03）与测试（归 task-05）
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
