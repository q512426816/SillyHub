---
id: task-05
title: problem/schema.py ProblemExecuteReq 加 file_urls（FR-03, D-007）
title_zh: ProblemExecuteReq 加 file_urls
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-03]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/schema.py
provides:
  - contract: ProblemExecuteReq.file_urls
    fields: [file_urls]
expects_from:
  task-01:
    - contract: TaskExecute.file_urls
      needs: [file_urls]
goal: >
  ProblemExecuteReq 加 file_urls（D-007 None 默认），为 problem 侧 D-006「3 处同改」的第 1 处。
implementation:
  - problem/schema.py ProblemExecuteReq（L234-250，execute_user_id L249 后）加 file_urls: list[str] | None = None
acceptance:
  - ProblemExecuteReq 不传 file_urls 时为 None
  - mypy + ruff 通过
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/problem/schema.py
  - cd backend && uv run ruff format --check app/modules/ppm/problem/schema.py
constraints:
  - D-007：用 list[str] | None = None（非 default_factory=list）
  - D-006 problem 侧 3 处改的第 1 处，必须与 task-06（service signature）/ task-07（router 拆包）同改，只改此处 file_urls 会落不进库
---

流程位置：Wave 2（problem 侧）。problem 侧关键路径 task-05 → task-06 → task-07 → task-09（最长链）。
