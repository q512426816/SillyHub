---
id: task-03
title: '聚合本地段——usage_service 详情/列表/quicklog 三处 + schema 注释 + test_usage_stats.py 用例（双计防护/守恒/NULL 跳过）'
title_zh: '聚合本地段——usage_service 详情/列表/quicklog 三处 + schema 注释 + test_usage_stats.py 用例（双计防护/守恒/NULL 跳过）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-02 23:14:36
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/change/usage_service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/tests/test_usage_stats.py
target_files:
  - backend/app/modules/change/usage_service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/tests/test_usage_stats.py
provides:
  - contract: ChangeUsageRead/UsageSummaryRead 本地段并入
    fields: [totals 四维含本地量, by_model 含「本地 CLI」桶行]
expects_from:
  task-01:
    - contract: platform_agent_logs 快照五列
      needs: [usage_input_tokens, usage_output_tokens, usage_cache_read_tokens, usage_cache_write_tokens, usage_parsed_at]
related_tests:
  - backend/app/modules/change/tests/test_usage_stats.py
goal: >
  变更/快速修复用量聚合并入本地 CLI 段（D-001@v1）：会话级二选一防双计（run 权威），
  「本地 CLI」桶行保持 totals=Σby_model 守恒，本地段不贡献时间三元组/轮次/请求次数。
implementation:
  - backend/app/modules/change/usage_service.py 详情 _aggregate_usage（:242-380）追加本地段：platform_agent_logs JOIN agent_sessions JOIN change_session_links（锚点 change_id），WHERE NOT EXISTS(agent_runs WHERE agent_session_id=s.id) AND usage_parsed_at IS NOT NULL，SUM 四维（COALESCE）；结果并入既有 buckets（桶名「本地 CLI」，api_requests=0，input+output 降序参与排序、「未记录」仍恒末位）——totals 经 _merge 自动守恒；时间三元组/SUM(num_turns)/api_requests 不动（无来源诚实值）
  - 列表 _summarize_anchor（:384-439）与 summarize_quicklogs 加本地段：单条聚合查询 GROUP BY change_id（quicklog 侧 GROUP BY workspace_id+ql_id 锚点换 quicklog_session_links），Python 侧与 run 段摘要按 id 合并（四维相加，三元组/轮次/请求不动）——保持零 N+1
  - backend/app/modules/change/schema.py：UsageByModelItemRead/ChangeUsageRead 注释更新（声明「本地 CLI」桶语义与本地段口径；DTO 结构不变）
  - backend/app/modules/change/tests/test_usage_stats.py 追加用例：纯本地变更（无 runs，快照非空）totals 含本地量+桶行出现+三元组 None+轮次 0；混合双计防护（同会话有 runs 也有快照→只计 run）；共享会话两变更各计一次；存量 NULL 快照不计入；quicklog 同口径；列表批量摘要与详情一致
acceptance:
  - 混合场景不双计：同会话 runs 与快照并存时聚合值=run 段值（NOT EXISTS 生效）
  - totals = Σ by_model（含「本地 CLI」桶 api_requests=0）；本地段不改变时间三元组/轮次/请求次数
  - 列表批量单查询（无 per-change 本地段查询）；既有聚合用例（并集去重/兜底桶/共享会话）不回归
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_usage_stats.py -q --no-cov
  - cd backend && uv run ruff check app/modules/change/usage_service.py && uv run mypy app
constraints:
  - 纯 SELECT 聚合零新迁移；DTO 字段集不变（对外契约兼容）
  - 不动摄取链路（归 task-02）；软删会话口径延续（计入）
  - 「本地 CLI」桶名与前端 task-04 判定值约定一致（design 数据模型节）
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
