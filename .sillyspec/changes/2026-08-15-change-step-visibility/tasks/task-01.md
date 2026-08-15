---
id: task-01
title: backend step extractor + projection extension (service.py)
title_zh: 后端提取器与投影扩展——三元组返回+两处解包适配+step 提取器+enrich 填充
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-02]
blocks: [task-03]
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_step_progress.py
expects_from:
  task-02:
    - contract: StepProgressSummary
      needs: [step_total, steps_completed, current_step_name, current_step_status, current_step_desc]
    - contract: StepTimelineEntry
      needs: [name, stage, status, output, completed_at, ordering, wait_reason]
goal: >
  _project_current_stage(:1506) 扩三元组 (stage, completed_stages, latest_progress) 零新增查询（D-002@v1）；新增 _extract_step_progress 提取器（STAGE_ORDER 排序/completed_at ISO 归一化/七值透传/防御判型）；
  enrich_summaries 填 summary.step_progress、enrich_with_workspace_ids 填 read.steps+read.step_progress；steps 缺失/异常返 (None, None) 前端降级（D-003@v1）。
implementation:
  - _project_current_stage 返回值改三元组——:1535 mapping 值由 (stage, completed) 改为 (stage, completed, latest_progress)，签名与 docstring 同步，不改 SQL
  - 两处二元组解包适配——_resolve_pending_change_keys(:1501) 与 enrich_summaries(:1471) 的 stage, completed = info 改三元组解包；_resolve_pending_change_keys 不消费 steps 行为不变；enrich_summaries 的 completed 仍喂 _map 算 pending_review
  - 新增静态提取器 _extract_step_progress(latest_progress) 返回 (StepProgressSummary | None, list[StepTimelineEntry] | None)——防御 isinstance 逐层判型不抛（对齐 _extract_current_stage(:1553) 范式）
  - 排序与当前步——stage 分组按 STAGE_ORDER(dispatch.py:38-44) 定序，quick 及未知 stage 追加在已知序后按 ordering，组内按 ordering；当前步=第一个非 completed 步，wait_reason 非空归一 waiting 否则 active，全完成 name/status/desc 均 None
  - 字段加工——completed_at 按 strptime %Y/%m/%d %H:%M:%S 本地时区转 UTC ISO 8601，失败保留原串；output 截断 200 字；明细 status 七值透传 CLI 原值（model.py StepStatus）不改写
  - enrich 填充——enrich_summaries 填 summary.step_progress；enrich_with_workspace_ids(:1449 stage_info 索引处) 填 read.step_progress + read.steps（transition 复用端点 additive 无害，Grill #11）
  - 新建 test_step_progress.py——提取器单测（正常/缺失/空数组/元素非 dict 返 (None,None)/七值透传/completed_at 归一化/quick 排序兜底）+ enrich 集成测试 + 两处解包回归守护（pending 集合行为不变断言）
acceptance:
  - 正常 steps 输入返回摘要+明细；latest_progress 非 dict/steps 缺失/空数组/结构异常一律 (None, None) 不抛
  - completed_at 值 2026/8/15 23:44:08 归一为 ISO 8601 UTC，非法串保留原值
  - 解包适配后 _resolve_pending_change_keys 行为不变（守护测试全绿）；enrich_summaries 既有断言零修改
  - 明细 status 七值原值透传；摘要 current_step_status 归一 active/waiting/None；查询零新增只扩现有 SELECT 返回值消费
verify:
  - cd backend && ./.venv/Scripts/python.exe -m pytest app/modules/change/tests/test_step_progress.py app/modules/change/tests -q
constraints: 不改 SQL/不新增查询（R-03）；防御判型不抛（R-01）；quick 排在已知 STAGE_ORDER 之后；schema.py 属 task-02 领地不动；不改 CLI 契约与表结构。
---
