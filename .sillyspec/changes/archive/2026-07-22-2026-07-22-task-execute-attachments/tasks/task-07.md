---
id: task-07
title: problem/router.py 拆包补 file_urls=body.file_urls（FR-03, D-006 关键）
title_zh: problem router 拆包补 file_urls
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-05, task-06]
blocks: [task-09]
requirement_ids: [FR-03]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/router.py
provides:
  - contract: problem router 透传 file_urls
    fields: [file_urls]
expects_from:
  task-06:
    - contract: execute_problem(file_urls param)
      needs: [file_urls]
goal: >
  problem/router.py execute 端点拆包处补 file_urls=body.file_urls，为 problem 侧 D-006「3 处同改」的第 3 处（最高风险）。
implementation:
  - problem/router.py execute 端点（L313-322，execute_user_id=body.execute_user_id or user.id L321 后）补一行：file_urls=body.file_urls,
  - task/router.py 不用改（对照：task 侧 L203 直传 body 整对象不拆包，已核实）
acceptance:
  - POST /problem/{id}/execute body 带 file_urls → 经 router 拆包 → execute_problem → 落库（不断裂）
  - mypy + ruff 通过
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/problem/router.py
  - cd backend && uv run ruff format --check app/modules/ppm/problem/router.py
constraints:
  - D-006/B1 最高风险：problem 侧 router 逐字段拆包传 execute_problem，漏改 file_urls 则该字段在解包层被丢弃、永远落不进库；且 service 单测直传 kwarg 能过、缺陷被遮蔽（参照 memory「过度 mock 遮蔽真实 FK」教训），仅在 e2e 暴露
  - task 侧 router 不改（直传 body 自动透传）——这是两侧结构差异核心（D-006）
---

流程位置：Wave 2（problem 侧）。plan.md 标注的 D-006 关键风险点；task-09 的透传断言专防此处遗漏。
