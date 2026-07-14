---
id: task-08
title: 前端 export.ts 抽取 uploadExcelWithAuth（FormData + token 刷新）+ plan.ts 加 importModulesPreview / importModulesCommit 及 TS 类型
title_zh: 前端 FormData 上传与导入 API 函数
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-07]
blocks: [task-09, task-12]
requirement_ids: [FR-008]
decision_ids: []
allowed_paths:
  - frontend/src/lib/ppm/export.ts
  - frontend/src/lib/ppm/plan.ts
  - frontend/src/lib/ppm/types.ts

provides:
  - contract: importModulesPreview
    fields: [ImportPreviewResp]
  - contract: importModulesCommit
    fields: [ImportResultResp]

goal: >
  抽取带 token 刷新的 FormData 上传函数（不复用强制 JSON 的 apiFetch），并新增导入预览/提交两个 API client 函数及对应 TS 类型，供 task-09 弹窗调用。
context: |
  - design.md §6 文件清单：export.ts 复用/抽取带 token 刷新的 fetch 新增 uploadExcelWithAuth；plan.ts 新增 importModulesPreview / importModulesCommit；types.ts 新增导入相关 TS 类型
  - design.md §7.1 端点：POST /api/ppm/plan-node/{plan_node_id}/modules/import-preview?pm_project_id=...（UploadFile）、POST .../modules/import-commit（ImportCommitReq JSON → ImportResultResp）
  - design.md §7.2 DTO：ImportPreviewRow / ImportPreviewSheet / ImportPreviewResp / ImportCommitReq / ImportCommitSheet / ImportResultResp（字段名与后端 snake_case 一致）
  - 现状 export.ts：downloadExcel 用裸 fetch + ensureFreshAccessToken 做 401 单飞刷新重试一次，二次 401 清 session 跳 /login；blob 模式，不解析 JSON
  - 现状 api.ts apiFetch：强制 accept: application/json + JSON.stringify(json)，会把 .xlsx 二进制响应当 JSON 解析；且 body 不支持 FormData，故上传必须独立 fetch
  - 现状 plan.ts：导出函数风格见 L93-113（downloadExcel 直调）；其余 CRUD 统一走 apiFetch(path, {method, json})
implementation: |
  - export.ts 新增 uploadExcelWithAuth(url: string, file: File): Promise<Response>：构造 FormData 只 append file；fetch 时仅带 Authorization + x-request-id，不设 Content-Type（让浏览器自动 multipart boundary）；401 按 downloadExcel 模式调 ensureFreshAccessToken() 拿新 token 重试一次，二次 401 清 session 跳 /login 并抛错；非 2xx 抛 Error（含 status）。返回 Response 由调用方按需 .json()
  - plan.ts 新增 importModulesPreview(planNodeId, projectId, file): Promise<ImportPreviewResp>：调 uploadExcelWithAuth(`/api/ppm/plan-node/${planNodeId}/modules/import-preview?pm_project_id=${projectId}`, file)，return (await resp.json()) as ImportPreviewResp
  - plan.ts 新增 importModulesCommit(planNodeId, payload: ImportCommitReq): Promise<ImportResultResp>：走 apiFetch(`/api/ppm/plan-node/${planNodeId}/modules/import-commit`, { method: "POST", json: payload })
  - types.ts 定义与后端 DTO 对齐的 TS 类型：ImportPreviewRow（sheet_name/plan_type/module_name/detailed_stage/task_theme/task_description/plan_workload/duty_user_name/duty_user_id/duty_matched/duty_unmatched_note/plan_begin_time/plan_complete_time/valid/error）、ImportPreviewSheet（name/plan_type/row_count/rows）、ImportPreviewResp（sheets/parse_errors）、ImportCommitSheet（name/plan_type/rows）、ImportCommitReq（sheets）、ImportResultResp（created_modules/merged_modules/created_details/skipped_rows/failed_rows）；日期字段用 string（ISO），UUID 用 string
acceptance: |
  - uploadExcelWithAuth 支持 FormData 上传，不设 Content-Type，带 Authorization，401 token 刷新重试一次
  - importModulesPreview 用 uploadExcelWithAuth，importModulesCommit 用 apiFetch；函数签名清晰、返回类型化
  - TS 类型与 task-04 后端 DTO 字段名/语义一致（snake_case）
  - pnpm exec tsc --noEmit 通过
verify: |
  - cd frontend && pnpm exec tsc --noEmit
constraints: |
  - 不复用 apiFetch 上传文件（其强制 accept JSON + JSON body，不支持 FormData）
  - token 刷新逻辑复用 export.ts downloadExcel 现有单飞刷新模式，不重复造轮子
  - TS 类型字段与后端 DTO 完全对齐，不私自改名或漏字段
---
