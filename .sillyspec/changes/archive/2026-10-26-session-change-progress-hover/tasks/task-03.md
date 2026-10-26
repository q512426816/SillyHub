---
id: task-03
title: 'Aggregate task progress in single IN query'
title_zh: 'backend _aggregate_task_progress 批量聚合（tasks 表 IN 单查询防 N+1，done 计分子/total 排除 cancelled）+ 用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: ['D-005@v1']
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_progress_projection_ext.py
target_files:
  - backend/app/modules/change/service.py
  - NEW:backend/app/modules/change/tests/test_progress_projection_ext.py
expects_from:
  - 'task-01 contract TaskProgressSummary（total/done，backend/app/modules/change/schema.py）'
goal: >
  enrich_summaries 管道新增任务进度聚合器：tasks 表按 change_id IN 单查询批量聚合 done/total（execute 圈口径），投影 ChangeSummary.task_progress，杜绝 N+1。
implementation:
  - 'service.py 新增 _aggregate_task_progress(session, change_ids)：单条 SELECT change_id, status FROM tasks WHERE change_id IN (...) 内存聚合——done=status=="done" 计分子、total 排除 status=="cancelled"（status 6 值见 backend/app/modules/task/model.py:44）'
  - '挂入 enrich_summaries（backend/app/modules/change/service.py:2294）与 usage 聚合同拍填充 summary.task_progress（批量模式先例 backend/app/modules/change/service.py:2348 usage_map）'
  - 'test_progress_projection_ext.py 补用例：主路径（12 行 task：8 done/1 cancelled/3 draft → {total:11,done:8}）+ 盲区#2（全 cancelled → total=0 不除零）+ 无 N+1 断言（单条 IN 查询）'
acceptance:
  - 'task_progress 口径正确（done 计分子、cancelled 不计分母）；会话多变更场景聚合单条 IN 查询零 N+1'
verify:
  - cd backend && python -m pytest app/modules/change/tests/test_progress_projection_ext.py -q
constraints:
  - '禁止逐 change_id 循环查询（R-03 N+1 禁令）；不改 tasks 表与 task 模块'
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
