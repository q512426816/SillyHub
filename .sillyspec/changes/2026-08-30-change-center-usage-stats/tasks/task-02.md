---
id: task-02
title: 'implement ChangeUsageQueryService aggregation'
title_zh: '后端聚合服务 usage_service.py（去重执行集合 + 详情两段聚合 + 批量摘要）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-01']
blocks: [task-03, task-04]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/usage_service.py
expects_from:
  task-01:
    - contract: ChangeUsageRead
      needs: [started_at, finished_at, duration_ms, totals, by_model]
    - contract: UsageSummaryRead
      needs: [started_at, finished_at, duration_ms, totals]
provides:
  - contract: ChangeUsageQueryService
    fields: [get_change_usage, get_quicklog_usage, summarize_changes, summarize_quicklogs]
goal: >
  新建 ChangeUsageQueryService，以去重执行集合语义实现变更与快速修复的详情两段聚合、时间三元组与批量摘要，作为接线与端点的唯一数据源。
implementation:
  - 变更执行集合——agent_runs.change_id 等值过滤 UNION change_session_links 会话内 runs（UNION 整行去重，同 run 双锚点只计一次）；quicklog 集合按 quicklog_session_links 的 workspace_id 与 ql_id JOIN runs 再 DISTINCT
  - 详情两段聚合对齐 session-usage 范式——明细段 agent_run_model_usage JOIN 集合 GROUP BY model 求和五指标；兜底段集合中无明细行的 run 按 COALESCE(run.model) 归并「未记录」桶，四维 token 列逐列 SUM(COALESCE(col, 0))，ctx_tokens 快照列排除，api_requests 兜底 0
  - 时间三元组与轮次在集合上 MIN(started_at)、MAX(finished_at)、SUM(duration_ms)、SUM(num_turns)，SQL 聚合自动忽略 NULL，全 NULL 归 None（R-05 三种组合语义）
  - 批量摘要 summarize_changes 以 (change_id, run_id) 维度 UNION 去重后外层 GROUP BY change_id；summarize_quicklogs 以 DISTINCT (ql_id, run_id) 后 GROUP BY ql_id——一次查询出整页摘要，不拉 run 行进内存
  - 软删会话不过滤（D-006 消耗真实发生），孤儿 run 经派发锚点 change_id 仍命中不丢数
acceptance:
  - 同 run 双锚点只计一次；跨变更共享会话在两个变更各完整计一次
  - 兜底桶 api_requests 恒 0 且 ctx_tokens 不参与任何求和；空集合 totals 全 0、by_model 空、时间三元组 None
verify:
  - cd backend && uv run ruff check app/modules/change/usage_service.py && uv run mypy app
constraints:
  - SQLAlchemy select 实现聚合，不 Python 循环 run 列表（防 IN 膨胀）
  - 零迁移不加表列；不改 daemon
  - 不改 service.py 与 router.py（接线归 task-03/04）；不写测试（归 task-05）
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
