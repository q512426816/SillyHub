---
id: task-07
title: Frontend lib/ppm client + types for import
title_zh: lib/ppm/problem.ts + types.ts 导入 client 函数与类型
author: qinyi
created_at: 2026-07-24 09:52:04
priority: P0
depends_on: [task-04]
blocks: [task-08]
requirement_ids: [FR-02, FR-12]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/ppm/problem.ts
  - frontend/src/lib/ppm/types.ts
provides:
  - contract: importProblemsPreview
    fields: []
  - contract: importProblemsCommit
    fields: []
  - contract: ProblemImportPreviewRow
    fields: [row_index, project_name, module_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, project_id, module_id, duty_user_id, audit_user_id, valid, error]
  - contract: ProblemImportPreviewResp
    fields: [rows, parse_errors, valid_count, invalid_count]
  - contract: ProblemImportResultResp
    fields: [created, skipped, failed_rows]
expects_from:
  task-03:
    - contract: ProblemImportPreviewRow
      needs: [valid, error, project_name, module_name, pro_desc, duty_user_name, audit_user_name]
    - contract: ProblemImportPreviewResp
      needs: [rows, valid_count, invalid_count, parse_errors]
    - contract: ProblemImportResultResp
      needs: [created, skipped, failed_rows]
goal: >
  前端导入 API client（FormData preview + JSON commit）与类型，字段对齐后端 DTO。
implementation:
  - problem.ts 增 importProblemsPreview(file)->PreviewResp（FormData，apiFetch）与 importProblemsCommit(body)->ResultResp（JSON）
  - types.ts 增 ProblemImportPreviewRow/PreviewResp/CommitReq/ResultResp 类型，字段对齐后端 task-03 DTO
acceptance:
  - 两个 client 函数存在且类型正确
  - 类型字段与后端 DTO 对齐
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改现有 problem.ts/types.ts 导出
  - 走统一 apiFetch
---

# task-07 — lib/ppm/problem.ts + types.ts 导入 client 与类型

## 背景
为 task-08（import-problem-modal 三态弹窗）提供前端 API client 与 TS 类型。范式完全对齐已有
plan 子域 `importModulesPreview` / `importModulesCommit`（`plan.ts:222-248`）。差异两点：
(1) 问题清单导入端点**不带 `pm_project_id` query**——项目按 Excel 每行 `project_name` 反查（D-002），
preview 函数只收 `file: File`；
(2) DTO 形状**扁平单层 `rows`**（非 plan 的多 Sheet 结构）。

## 输入（design.md §7）
- 端点：`POST /api/ppm/problem-list/import-preview`（multipart，field=file）→ `ProblemImportPreviewResp`；
  `POST /api/ppm/problem-list/import-commit`（JSON body `ProblemImportCommitReq`）→ `ProblemImportResultResp`。
- DTO 字段全 snake_case：PreviewRow = 17 业务字段 + 4 反查 UUID + `valid`/`error`；
  PreviewResp = `{ rows, parse_errors, valid_count, invalid_count }`；
  CommitReq = `{ rows: ProblemImportPreviewRow[] }`；
  ResultResp = `{ created, skipped, failed_rows }`。
- 序列化约定：后端 datetime → ISO `string`；uuid.UUID → `string`；nullable 用 `T | null`（对齐 types.ts 既有风格）。

## deliverables
**problem.ts（+2 导出函数，不改现有导出）**
- `importProblemsPreview(file: File): Promise<ProblemImportPreviewResp>`：走 `uploadExcelWithAuth`
  （从 `./export` 引入，与 plan.ts:227 一致），POST `/api/ppm/problem-list/import-preview`，
  `await resp.json()` 断言返回（无 query 参数）。
- `importProblemsCommit(body: ProblemImportCommitReq): Promise<ProblemImportResultResp>`：走 `apiFetch`
  （`{ method: "POST", json: body }`），POST `/api/ppm/problem-list/import-commit`。

**types.ts（+4 类型，接 problem 子域段尾，约 line 878 后）**
- `ProblemImportPreviewRow`：`row_index: number` + 17 业务字段（均 `string | null`）+ `project_id`/`module_id`/
  `duty_user_id`/`audit_user_id`（`string | null`）+ `valid: boolean` + `error: string | null`。
- `ProblemImportPreviewResp`：`rows` / `parse_errors: string[]` / `valid_count: number` / `invalid_count: number`。
- `ProblemImportCommitReq`：`rows: ProblemImportPreviewRow[]`。
- `ProblemImportResultResp`：`created: number` / `skipped: number` / `failed_rows: string[]`。
- 字段名严格对齐后端 task-03 DTO（snake_case，UUID→string，datetime→string，不驼峰化不 Date 化）。

## acceptance
- 两个 client 函数存在、类型签名正确、走统一 `apiFetch` / `uploadExcelWithAuth`。
- 4 个类型字段与后端 DTO 一一对应（无驼峰化、无 Date 化）。

## verify
- `cd frontend && pnpm exec tsc --noEmit` 通过（无新增类型错误）。

## constraints
- 不改 problem.ts 现有导出与 types.ts 现有类型。
- 走统一 `apiFetch` / `uploadExcelWithAuth`，不直接 fetch。
- 不引入 `pm_project_id` / `project_id` query 参数（项目反查在服务端按 Excel `project_name`，D-002）。
