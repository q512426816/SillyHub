---
id: task-09
title: 后端单测 problem execute 带 file_urls（含 router→service 透传断言，FR-03, D-006）
title_zh: problem execute file_urls 单测（含透传断言）
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_problem_flow.py
expects_from:
  task-07:
    - contract: problem router 透传 file_urls
      needs: [file_urls]
goal: >
  problem execute 单测，必须含 router→service 透传 file_urls 断言（不只测 service 直传 kwarg，防 D-006 遮蔽）。
implementation:
  - problem/tests/test_problem_flow.py TestStartExecute 照现有风格（start_problem→execute_problem，db_session fixture）新增 service 层用例：execute_problem(..., file_urls=["p1"]) 落库 TaskExecute.file_urls == ["p1"]
  - 新增 router 层透传用例（照 task/tests/test_router.py 的 client/auth_headers fixture + _execute 的 **extra 传 file_urls 风格）：POST execute body 带 file_urls → 直接查 DB TaskExecute.file_urls == 传值（断言经 router 拆包透传到 service，证明 task-07 未漏改）
  - 断言不传 file_urls 保留原值（D-007）
acceptance:
  - service 层 execute_problem file_urls 落库绿
  - router 层 POST execute 带 file_urls 落库绿（证明 router 拆包未丢字段，D-006 不断裂）
  - 测试绿，现有 problem 测试零回归
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_problem_flow.py -q
constraints:
  - D-006/B1 关键约束：必须断言 router→service 透传 file_urls（不只测 service 直传 kwarg）——防 router 拆包层丢字段被 service 单测遮蔽（参照 memory「过度 mock 遮蔽真实 FK / scan-generate」教训）
  - 照现有 TestStartExecute（db_session）/ test_router 风格（client fixture）
  - 若 router 透传断言失败，说明 task-07 漏改，必须回头补 problem/router.py
---

流程位置：Wave 3（后端测试）。本任务是 D-006 防遮蔽的最后一道闸——plan.md 关键路径终点。
