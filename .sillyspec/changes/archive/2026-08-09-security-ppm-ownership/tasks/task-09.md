---
id: task-09
title: problem/tests/test_problem_flow.py 补 actor=admin stub（9 处 execute_problem 直调）
title_zh: test_problem_flow 补 admin stub
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-10]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_problem_flow.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  problem/tests/test_problem_flow.py 9 处 execute_problem 直调（:431/:456/:469/:483/:494/:505/:522/:542/:567）补 actor=admin stub，不改断言语义（规则 9）。9 处均 omit execute_user_id 且断言只检 status/time_spent/handle_info/file_urls 不检 execute_user_id→else actor.id 路径下测试即过。start_problem 不在范围（router:478 硬编码 user.id，非冒名面）→ 其调用不动。
provides:
  - contract: problem-tests-patched
    fields: [test_problem_flow.py actor stub]
expect_from:
  - contract: problem-service-actor
    from: task-05
    fields: [ProblemService.execute_problem.actor]
related_tests: []
implementation:
  - 模块级 admin stub：`import types; _ADMIN = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=True)`（与 test_task.py 一致风格，或提共享 fixture）
  - 9 处 svc.execute_problem(...) 补 `actor=_ADMIN`（:431/:456/:469/:483/:494/:505/:522/:542/:567）
  - start_problem 调用（:402/:420/:422/:429/:453/:463/:491/:503/:520/:540/:562/:625）不动——start_problem 不在范围，签名未改
  - 运行测试确认全绿
acceptance:
  - AC-6 test_problem_flow.py 全绿，断言语义不变
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_problem_flow.py -q --no-cov
constraints:
  - 只补 actor 参数，不改任何断言
  - 不动 start_problem 调用（不在范围）
  - admin stub 用 SimpleNamespace（不查库）
---
