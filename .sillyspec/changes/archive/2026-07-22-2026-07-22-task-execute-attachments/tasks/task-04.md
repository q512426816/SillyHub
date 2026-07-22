---
id: task-04
title: task/service.py execute_plan 逐字段赋值补 file_urls（FR-02）
title_zh: execute_plan 补 file_urls 赋值
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/task/service.py
provides:
  - contract: execute_plan 落 file_urls
    fields: [file_urls]
expects_from:
  task-03:
    - contract: ExecutePlanReq.file_urls
      needs: [file_urls]
goal: >
  execute_plan 逐字段赋值段补 file_urls，使前端传入的附件 id 落库 TaskExecute。
implementation:
  - task/service.py execute_plan 逐字段赋值段（L343-355，execute_user_id 赋值 L353-354 后、exc.current_user_id = ... L355 前）补一行：if req.file_urls is not None: exc.file_urls = req.file_urls
  - task/router.py 不用改（L203 直传 body，req 整对象自动透传——已核实源码）
acceptance:
  - execute_plan(req 带 file_urls=["a","b"]) 落库 TaskExecute.file_urls == ["a","b"]
  - req.file_urls 未传（None）时保留原值不清空
  - mypy + ruff 通过，现有 execute 流程（跨天校验/状态机）零回归
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/task/service.py
  - cd backend && uv run ruff format --check app/modules/ppm/task/service.py
constraints:
  - D-007：用 if req.file_urls is not None 守卫赋值（非直接赋值）
  - execute_plan 是逐字段赋值（非 model_dump），加 schema 字段后必须在此段补赋值，否则字段被吞
---

流程位置：Wave 2（task 侧）。task 侧共 2 处改（schema + service 赋值），router 直传 body 无需动（与 problem 侧 3 处改对照，D-006）。
