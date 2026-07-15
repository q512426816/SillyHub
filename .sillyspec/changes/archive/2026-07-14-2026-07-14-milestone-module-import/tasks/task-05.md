---
id: task-05
title: service.import_preview 解析预览
title_zh: 导入预览服务（解析+责任人反查）
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-03, task-04]
blocks: [task-07, task-11]
requirement_ids: [FR-004]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
expects_from:
  task-03:
    - contract: parse_workbook
      needs: [sheets, rows, module_name, duty_user_name, plan_begin_time, plan_complete_time]
  task-04:
    - contract: ImportPreviewRow
      needs: [duty_matched, valid, duty_user_id]

provides:
  - contract: import_preview
    fields: [ImportPreviewResp]

goal: >
  实现导入预览服务：用线程池跑 importer.parse_workbook，ORM 查项目成员全量建姓名→UUID 反查表，
  对每行责任人反查并标记 duty_matched/valid，组装 ImportPreviewResp 返回。
implementation: |
  - PlanService 新增 async import_preview(self, file_bytes, plan_node_id, pm_project_id) -> ImportPreviewResp
  - 用 anyio.to_thread.run_sync(lambda: parse_workbook(file_bytes)) 包解析（X-002，不阻塞事件循环）
  - 直接 ORM 查 ProjectMember（where pm_project_id == self._safe_uuid(pm_project_id)，select user_id, user_name 全量，不走 REST 分页）
  - 建 {user_name: user_id} 反查表；user_name 为空的成员不进表
  - 每行责任人按顿号/逗号分隔取首个姓名，精确匹配反查表；匹配→duty_matched=True/duty_user_id 填值；
    未匹配→duty_matched=False/valid=False/error="责任人未匹配"；多人时未采用姓名写 duty_unmatched_note
  - 组装 ImportPreviewResp（sheets + parse_errors）
acceptance: |
  - 大文件解析不阻塞事件循环（anyio.to_thread）
  - 责任人匹配走 ORM 全量（不被 page_size 截断）
  - 未匹配行 valid=False，error 注明原因
  - user_name 为空的成员不参与匹配
verify: |
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_router.py -k import_preview -q
constraints: |
  - 不写 DB（preview 只解析不入库）
  - 不复用 _Crud（无 DB 操作）
  - 反查表用 ORM 全量，不分页
  - 多人责任人取首个（D-002）
---
