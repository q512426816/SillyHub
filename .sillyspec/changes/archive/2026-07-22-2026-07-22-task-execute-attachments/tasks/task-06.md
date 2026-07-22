---
id: task-06
title: problem/service.py execute_problem signature+赋值补 file_urls（FR-03, D-006）
title_zh: execute_problem 补 file_urls 参数+赋值
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-05]
blocks: [task-07]
requirement_ids: [FR-03]
decision_ids: [D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
provides:
  - contract: execute_problem(file_urls param)
    fields: [file_urls]
expects_from:
  task-05:
    - contract: ProblemExecuteReq.file_urls
      needs: [file_urls]
goal: >
  execute_problem signature 加 file_urls 参数 + 赋值段补赋值，为 problem 侧 D-006「3 处同改」的第 2 处。
implementation:
  - problem/service.py execute_problem signature（L522-533，execute_user_id 参数 L532 后）加 file_urls: list[str] | None = None
  - 赋值段（L585-594，execute_user_id 赋值 L592-594 后）补：if file_urls is not None: exc.file_urls = file_urls
acceptance:
  - execute_problem(..., file_urls=["x"]) 落库 TaskExecute.file_urls == ["x"]
  - file_urls 未传（None）保留原值
  - mypy + ruff 通过，现有 problem execute 流程（跨天校验/3 态状态机/累加 time_spent）零回归
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/problem/service.py
  - cd backend && uv run ruff format --check app/modules/ppm/problem/service.py
constraints:
  - D-006：execute_problem 取独立 kwargs（非 req 整对象，与 task 侧 execute_plan(req) 结构不同），signature 必须显式加 file_urls 参数
  - D-007：if file_urls is not None 守卫赋值
  - 逐字段赋值（非 model_dump），加参数后必须在此段补赋值
---

流程位置：Wave 2（problem 侧）。第 2 处改；第 3 处 router 拆包（task-07）是 D-006 最高风险点。
