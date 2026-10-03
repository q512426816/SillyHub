---
id: task-03
title: '聚合双路径——usage_service 本地段改水位差分（SQL 窗口/自引用取 next）∪ 存量整行互斥 + test_usage_stats 用例（跨变更切换守恒/异步摄取交错序列/存量兼容/quicklog/NULL ctx）'
title_zh: '聚合双路径——usage_service 本地段改水位差分（SQL 窗口/自引用取 next）∪ 存量整行互斥 + test_usage_stats 用例（跨变更切换守恒/异步摄取交错序列/存量兼容/quicklog/NULL ctx）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-03 17:50:03
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04a]
decision_ids: [D-001@v1, D-004@v1, D-002@v2]

allowed_paths:
  - backend/app/modules/change/usage_service.py
  - backend/app/modules/change/tests/test_usage_stats.py
target_files:
  - backend/app/modules/change/usage_service.py
  - backend/app/modules/change/tests/test_usage_stats.py
goal: >
  聚合双路径：水位差分（首水位隐式起点 0 锚定 D-004）∪ 存量整行互斥，跨变更归属守恒。
implementation:
  - usage_service 本地段重构：新差分子查询——水位表按 (workspace_id,log_path,seq) 自引用取 next mark（LEAD 窗口或相关子查询），无 next 取 entry 当前快照；首水位 diff=mark_first−0；每片段 max(0,next−mark) 五项、片段 ctx=change_key（quicklog 侧=quick_id）；沿用 NOT EXISTS agent_runs 谓词（join entry 行）
  - 互斥：有水位行的 entry 走差分、无水位走既有整行（两路径 SQL UNION 或 Python 合并，保持批量单查询零 N+1）；时间三元组维持 caliber-fix 口径（first/last_seen 参与不变）
  - test_usage_stats.py 用例：A→B→C 跨变更切换各得各量 Σ=累计（守恒）/摄取滞后反例序列（FR-04a 边界断言）/存量无水位 entry 数字不变/有水位 entry 不双计（不走整行）/quick_id 片段/NULL ctx 片段不计
acceptance:
  - 切换守恒（含滞后形态总量守恒+边界归属）；首水位锚定存量连续；互斥无双计；存量路径数字与改造前一致；quicklog 同构
expects_from:
  task-01:
    - contract: platform_agent_log_usage_marks 水位行
      needs: [change_key, quick_id, seq, mark_invocations, mark_input_tokens, mark_output_tokens, mark_cache_read_tokens, mark_cache_write_tokens]
related_tests:
  - backend/app/modules/change/tests/test_usage_stats.py
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_usage_stats.py -q --no-cov && uv run ruff check app/modules/change/usage_service.py && uv run mypy app
constraints:
  - 纯 SELECT 批量单查询；DTO 零变化；不动 agent_runs 段/二选一谓词/时间三元组口径
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
