---
id: task-04
title: 'Project thin_flow from stages JSON'
title_zh: 'backend thin_flow 读侧投影（change.stages JSON→ChangeSummary.thin_flow，缺键 None fail-open）+ 用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-03, FR-07]
decision_ids: ['D-008@v2']
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_progress_projection_ext.py
target_files:
  - backend/app/modules/change/service.py
expects_from:
  - 'task-01 contract ThinFlowProgress（backend/app/modules/change/schema.py）'
goal: >
  enrich_summaries 读侧投影：从 change.stages JSON 的 thin_flow 子键（task-05 写入）投影 ChangeSummary.thin_flow，供前端轻量相位行消费；缺键/畸形 fail-open。
implementation:
  - 'service.py enrich_summaries 内：changes 行 stages JSON 含 thin_flow 键时经 pydantic 校验投影 summary.thin_flow（结构异常 try/except → None，R-01 fail-open）'
  - '投影纯读：不写 stages、不刷 updated_at（写入属 task-05 写侧路径，读写分离）'
  - 'test_progress_projection_ext.py 补用例：正常投影字段全透传/缺键 → None/坏 JSON → None 不抛/盲区#5（is_thin=true 但 thin_flow=None → 后端如实投影 None，降级归前端）'
acceptance:
  - 'stages.thin_flow 在场且结构合法 → ChangeSummary.thin_flow 逐字段透传；缺键/畸形 → None 不抛'
verify:
  - cd backend && python -m pytest app/modules/change/tests/test_progress_projection_ext.py -q
constraints:
  - '只读投影零写入；phase 等字段原值透传（归一在写侧 task-05 完成）'
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
