---
id: task-02
title: schema step progress DTOs plus optional step fields on ChangeSummary/ChangeRead
title_zh: schema 新模型与 optional 字段——StepProgressSummary/StepTimelineEntry 挂载 ChangeSummary.step_progress 与 ChangeRead.step_progress+steps
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: []
blocks: [task-01]
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/change/schema.py
provides:
  - contract: StepProgressSummary
    fields: [step_total, steps_completed, current_step_name, current_step_status, current_step_desc]
  - contract: StepTimelineEntry
    fields: [name, stage, status, output, completed_at, ordering, wait_reason]
goal: >
  change 模块 schema 落地 step 级进度 DTO——两新模型 + 三 optional 字段挂载，
  字段名与类型与 design §7 逐字一致，先行落地供 task-01 提取器 import。
implementation:
  - schema.py 新增 StepProgressSummary(BaseModel)，五字段依 design §7——step_total int、steps_completed int、current_step_name str|None、current_step_status str|None（active/waiting/None 三值）、current_step_desc str|None
  - schema.py 新增 StepTimelineEntry(BaseModel)——name str、stage str、status str（CLI 原值透传七值枚举 completed/pending/in-progress/failed/blocked/waiting/stale）、output str|None、completed_at str|None（归一化 ISO 8601 字符串）、ordering int、wait_reason str|None
  - ChangeSummary 追加 step_progress StepProgressSummary|None = None（列表接口只带摘要 ~200B，不带 steps 明细）
  - ChangeRead 追加 step_progress StepProgressSummary|None = None 与 steps list[StepTimelineEntry]|None = None
  - 两新模型置于 ChangeRead 定义之前（PendingReview 之后），避免 Pydantic 前向引用延迟解析；新字段注释标注计算投影来源（service enrich 填充，非表列，零 migration），对齐 pending_review 既有注释范式
acceptance:
  - 两模型字段名与类型与 design §7 逐字一致（task-01 import 与 task-03 gen:types 的消费依赖）
  - 三新字段全部 optional 默认 None，现有 ChangeRead/ChangeSummary 消费方零 breaking（brownfield 旧客户端不受影响）
  - change 模块现有测试全绿（模块内无 schema 专属测试文件，跑全模块）；schema 无循环导入
verify:
  - cd backend && ./.venv/Scripts/python.exe -m pytest app/modules/change/tests -q --no-cov
  - cd backend && ./.venv/Scripts/python.exe -m mypy app/modules/change/schema.py
  - cd backend && ./.venv/Scripts/python.exe -m ruff format --check app/modules/change/schema.py
constraints: 不加端点不动 router/service；不动现有字段与现有模型语义；不加 migration；字段名与 design §7 逐字一致供 task-01 import；api-types.ts 禁止手写（task-03 gen:types 领地）。
---
