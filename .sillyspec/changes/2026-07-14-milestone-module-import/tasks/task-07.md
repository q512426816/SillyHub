---
id: task-07
title: router 导入两端点
title_zh: 导入预览/提交 API 端点
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-05, task-06]
blocks: [task-08, task-11]
requirement_ids: [FR-008]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/router.py
expects_from:
  task-05:
    - contract: import_preview
      needs: [ImportPreviewResp]
  task-06:
    - contract: import_commit
      needs: [ImportResultResp]

goal: >
  新增两个导入 API 端点（预览 + 提交），显式声明 response_model，复用 PPM_PLAN_WRITE 权限，
  前端通过它们完成「预览后确认」两阶段流程（D-006@v1）。
implementation: |
  - "POST /plan-node/{plan_node_id}/modules/import-preview：plan_node_id(str, Path)、pm_project_id(str, Query(...))、file(UploadFile = File(...))；权限 require_permission_any(Permission.PPM_PLAN_WRITE)；response_model=ImportPreviewResp；await file.read() 取 bytes 调 PlanService(session).import_preview(file_bytes, plan_node_id, pm_project_id) 并直接 return（service 已返回 ImportPreviewResp）"
  - "POST /plan-node/{plan_node_id}/modules/import-commit：plan_node_id(str, Path)、body(ImportCommitReq)；权限 PPM_PLAN_WRITE；response_model=ImportResultResp；调 PlanService(session).import_commit(body, plan_node_id) 直接 return"
  - 两端点声明在「模块 CRUD」段内、list_modules(/plan-node/{plan_node_id}/modules) 附近（保持前置注册习惯；R-06 实测与 /plan-node-module/{item_id}、/plan-node/{item_id} 前缀/段数/method 均不冲突，无需额外回归）
  - 从 fastapi 补充导入 UploadFile, File, Path（Query 已导入）
  - 从 schema 补充导入 ImportPreviewResp、ImportCommitReq、ImportResultResp
acceptance: |
  - 两端点显式 response_model（不裸返回 dict）
  - 权限 PPM_PLAN_WRITE 生效（与 create_module 同款 require_permission_any）
  - import-preview 接收 multipart 文件（UploadFile=File(...)）、import-commit 接收 JSON body
  - OpenAPI 文档正确生成两端点及对应 schema
verify: |
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_router.py -k import -q
constraints: |
  - 复用 PPM_PLAN_WRITE，不新增权限
  - 端点薄封装，业务逻辑（解析/反查/分组/汇总/原子提交）全在 service
  - import-preview 的 anyio.to_thread 在 service 内完成，router 不再包线程池
  - 端点 return service 结果，不做 model_validate 二次包装（service 已返回目标 schema 实例）
---
