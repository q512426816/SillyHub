---
id: task-01
title: 'Add progress DTOs to ChangeSummary'
title_zh: 'backend ChangeSummary 进度三子 DTO（StageProgressEntry/TaskProgressSummary/ThinFlowProgress）+ 三 optional 字段 + openapi 导出'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-06, task-07]
requirement_ids: [FR-01, FR-03, FR-06]
decision_ids: [D-004, "D-008@v2"]
allowed_paths:
  - backend/app/modules/change/schema.py
  - backend/openapi.json
target_files:
  - backend/app/modules/change/schema.py
  - backend/openapi.json
provides:
  - contract: StageProgressEntry
    fields: [stage, status, steps_total, steps_completed, started_at, completed_at, duration_seconds, revision]
  - contract: TaskProgressSummary
    fields: [total, done]
  - contract: ThinFlowProgress
    fields: [phase, approved, autopilot, tasks_total, tasks_done, substeps_done, substeps_total, upgraded, adopted_from]
goal: >
  定稿三端（backend/daemon/frontend）共用的变更进度投影 DTO 契约：ChangeSummary 加 stage_progress/task_progress/thin_flow 三 optional 计算字段与三个子 DTO，并导出 openapi.json 供 gen:types 消费（W1 契约先行，后续任务全按此对齐）。
implementation:
  - 'backend/app/modules/change/schema.py:111（ChangeSummary 定义前）新增三子 DTO，字段逐字对齐本变更 design.md 接口定义：StageProgressEntry（stage/status/steps_total/steps_completed/started_at/completed_at/duration_seconds/revision）、TaskProgressSummary（total/done）、ThinFlowProgress（phase/approved/autopilot/tasks_total/tasks_done/substeps_done/substeps_total/upgraded/adopted_from）'
  - 'ChangeSummary（backend/app/modules/change/schema.py:111）加 stage_progress/task_progress/thin_flow 三 optional default None 计算字段，注释带 producer（latest_progress/tasks 表/change.stages JSON）→ enrich_summaries → consumer（前端悬浮框）链与「填充归 task-02/03/04」领地声明（对齐既有 usage 字段先例 backend/app/modules/change/schema.py:159-167）'
  - '跑 dump_openapi 导出 backend/openapi.json（脚本 backend/scripts/dump_openapi.py），确认三新 DTO 进 components/schemas 且 ChangeSummary 三新字段 default null'
acceptance:
  - 'backend/openapi.json components/schemas 含 StageProgressEntry/TaskProgressSummary/ThinFlowProgress，ChangeSummary 三新字段 optional default null，旧字段零变动（additive）'
  - '既有 ChangeSummary 消费方（变更列表页/会话悬浮框现状渲染）不受影响，enrich 既有聚焦测试全绿'
verify:
  - cd backend && python scripts/dump_openapi.py
  - cd backend && python -m pytest app/modules/change/tests/test_enrich_projection.py app/modules/change/tests/test_projection.py -q
constraints:
  - '全部新字段 optional default None（FR-07 brownfield 安全）；零表结构变更（零 Alembic migration）'
  - '本卡只落契约不动 service.py 填充逻辑（task-02/03/04 领地）；不改 sillyspec CLI；前端/daemon 双端 api-types 再生成统一归 task-11 收口（本卡只出 openapi.json）'
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
