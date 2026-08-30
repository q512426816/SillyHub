---
id: task-05
title: 'backend-usage-stats-tests'
title_zh: '后端聚合测试 test_usage_stats.py（并集去重/兜底桶/时间 NULL 组合/404/批量投影）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/tests/test_usage_stats.py
goal: >
  为 ChangeUsageQueryService 聚合语义与两个 usage 端点写 DB 造数测试，锁定并集去重/兜底桶/时间 NULL 组合/404/批量投影口径。
expects_from:
  task-02:
    - contract: ChangeUsageQueryService
      needs: [get_change_usage, get_quicklog_usage, summarize_changes, summarize_quicklogs]
  task-04:
    - contract: usage-endpoints
      needs: [GET_changes_usage, GET_quicklog_usage]
implementation:
  - 测试骨架复用根 conftest 的 client/db_session/auth_headers fixture 与既有私有造数 helper 模式（参照 test_quicklog_sessions_api.py），新增 _make_change/_make_session/_make_model_usage 等 ORM 直写 helper
  - 详情聚合用例——纯明细（多模型桶+api_requests）/纯兜底（无明细行四维并入「未记录」桶、api_requests=0、ctx_tokens 排除）/混合 totals/空集合（200 且 totals 全 0、by_model 空列表、时间三元组 None）
  - 集合语义用例——并集去重（同 run 双锚点 change_id+会话 link 只计一次）/跨变更共享会话两变更各完整计一次/软删会话（deleted_at 非空）执行计入/quicklog 恒走 quicklog_session_links 会话链路
  - 时间三元组用例（D-001）——无执行三值 None/进行中（started_at 有值 finished_at NULL）/全完（MIN started_at、MAX finished_at、SUM duration_ms）
  - 端点与列表用例——usage 端点 404（不存在/跨工作区；deleted 变更 200 同既有口径）与 403/401；list_changes 与 list_quicklog_entries 批量 usage 投影多变更一次查询、deleted 行 usage=None
acceptance:
  - 同 run 双锚点只计一次、跨变更共享会话两变更各完整计一次、软删会话执行计入
  - 兜底桶 api_requests=0 且 ctx_tokens 不参与；空集合 totals 全 0、by_model 空列表、时间三元组 None
  - 时间三元组三种 NULL 组合（无执行/进行中/全完）与 D-001 口径一致
  - 端点 404 覆盖不存在/跨工作区（deleted 变更 200 同既有口径）且 403/401 可复现；列表批量投影零 N+1、deleted 行 usage=None
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_usage_stats.py -q --no-cov -n auto
constraints:
  - 只新增测试文件不改任何产品代码（发现实现缺陷回报处理，不在测试里绕过）
  - 对齐既有 conftest fixture 惯例（根 conftest client/db_session/auth_headers + 模块 conftest 自包含建表模式），不自造新 fixture 体系
  - 造数直写 ORM 不 mock 聚合 SQL，断言数字与 DB 手工 SUM 对齐
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
