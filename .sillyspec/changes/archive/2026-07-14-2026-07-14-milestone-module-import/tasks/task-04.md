---
id: task-04
title: schema.py 导入相关 DTO
title_zh: 导入预览/提交/结果 Pydantic DTO
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-01]
blocks: [task-05, task-06, task-07]
requirement_ids: [FR-008]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/schema.py
provides:
  - contract: ImportPreviewRow
    fields: [sheet_name, plan_type, module_name, detailed_stage, task_theme, task_description, plan_workload, duty_user_name, duty_user_id, duty_matched, duty_unmatched_note, plan_begin_time, plan_complete_time, valid, error]
  - contract: ImportPreviewSheet
    fields: [name, plan_type, row_count, rows]
  - contract: ImportPreviewResp
    fields: [sheets, parse_errors]
  - contract: ImportCommitReq
    fields: [sheets]
  - contract: ImportCommitSheet
    fields: [name, plan_type, rows]
  - contract: ImportResultResp
    fields: [created_modules, merged_modules, created_details, skipped_rows, failed_rows]

goal: >
  定义导入功能两阶段（预览/提交）所需的全部 Pydantic DTO，供 service 与 router 共用。
implementation: |
  - 在 schema.py 新增 ImportPreviewRow（字段见 design §7.2，含 duty_matched: bool / valid: bool / error: str|None）
  - 新增 ImportPreviewSheet（name, plan_type, row_count, rows: list[ImportPreviewRow]）
  - 新增 ImportPreviewResp（sheets: list[ImportPreviewSheet], parse_errors: list[str]）
  - 新增 ImportCommitSheet（name, plan_type, rows）+ ImportCommitReq（sheets: list[ImportCommitSheet]，不含 pm_project_id —— Grill X-008 删除）
  - 新增 ImportResultResp（created_modules, merged_modules, created_details: int；skipped_rows: int；failed_rows: list[str]）
  - 继承项目 PydanticModel 基类（= pydantic.BaseModel 别名，L14），与 PlanNodeModuleResp（L119-124）风格一致；6 个新名加入 __all__
acceptance: |
  - 6 个 DTO 定义完整，字段类型与 design §7.2 一致
  - ImportCommitReq 不含 pm_project_id（Grill X-008）
  - mypy app 通过；新名进入 __all__
verify: |
  - cd backend && .venv/Scripts/python.exe -m mypy app/modules/ppm/plan/schema.py
constraints: |
  - 只定义 DTO，不含业务逻辑
  - 所有可空字段用 | None；可空集合用 Field(default_factory=list)
  - 不改现有 DTO；ImportCommitSheet.rows 复用 ImportPreviewRow（前端回传确认行）
---
