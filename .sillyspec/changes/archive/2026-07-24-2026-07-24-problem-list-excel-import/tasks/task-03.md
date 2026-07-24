---
id: task-03
title: Add 4 import DTOs to problem/schema.py
title_zh: problem/schema.py 增 4 个导入 DTO
author: qinyi
created_at: 2026-07-24 09:49:40
priority: P0
depends_on: []
blocks: [task-04, task-05, task-07]
requirement_ids: [FR-02]
decision_ids: [D-003@v1, D-009@v1, D-012@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/schema.py
provides:
  - contract: ProblemImportPreviewRow
    fields: [row_index, project_name, module_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, project_id, module_id, duty_user_id, audit_user_id, valid, error]
  - contract: ProblemImportPreviewResp
    fields: [rows, parse_errors, valid_count, invalid_count]
  - contract: ProblemImportCommitReq
    fields: [rows]
  - contract: ProblemImportResultResp
    fields: [created, skipped, failed_rows]
expects_from: {}
goal: >
  在 problem/schema.py 增 4 个导入 DTO，承载预览/提交/结果三段数据，
  字段对齐 design §7（含反查 UUID + valid/error + 必填语义见 D-009）。
implementation:
  - 在 schema.py 新增 ProblemImportPreviewRow（全业务字段 + 反查UUID + valid + error）
  - 新增 ProblemImportPreviewResp（rows/parse_errors/valid_count/invalid_count）
  - 新增 ProblemImportCommitReq（rows）
  - 新增 ProblemImportResultResp（created/skipped/failed_rows）
  - 时间字段声明 datetime | None（importer 产 date，service 转 D-010）
acceptance:
  - 4 个 DTO 定义存在且字段齐全
  - ProblemImportPreviewRow 含 valid/error/反查UUID
  - 加入 __all__
verify:
  - cd backend && uv run ruff check app/modules/ppm/problem/schema.py
  - cd backend && uv run mypy app/modules/ppm/problem/schema.py
constraints:
  - 不改现有 ProblemListBase/Create/Update/Resp
  - 时间字段用 datetime（转换在 service）
---
