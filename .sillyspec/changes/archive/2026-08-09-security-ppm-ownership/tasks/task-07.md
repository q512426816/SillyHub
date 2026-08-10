---
id: task-07
title: 新增 ppm/common/tests/test_ownership.py resolve_owner 纯函数 + 端点双角色
title_zh: ownership 测试
priority: P0
depends_on: [task-01, task-06]
blocks: [task-10]
requirement_ids: [FR-09]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/ppm/common/tests/test_ownership.py
  - backend/app/modules/ppm/task/tests/test_router.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  新增 test_ownership.py：resolve_owner 纯函数 4 分支（None→None / admin+任意→放行 / non-admin+self→放行 / non-admin+other→PpmOwnershipDenied）+ 端点级双角色（non-admin 代填→403 / admin 代填→201·200 / 自填→201·200）。同时把 test_router.py 纳入 allowed_paths 作 admin 路径回归网（预期零改动，若发现非 admin 造数用例按规则 9 改）。
provides:
  - contract: ownership-tests
    fields: [test_ownership.py]
expect_from:
  - contract: ownership-helper
    from: task-01
    fields: [resolve_owner, PpmOwnershipDenied]
  - contract: router-actor-wired
    from: task-06
    fields: [execute_problem, start_plan_task, execute_plan_task, create_task_execute, update_task_execute, create_work_hour, update_work_hour]
related_tests: []
implementation:
  - 纯函数测试（无 DB）：构造 SimpleNamespace actor（admin/non-admin 各一）+ requested uuid，断言 None→None、admin+任意 requested→返回 requested、non-admin+self→返回、non-admin+other→pytest.raises(PpmOwnershipDenied)
  - 端点级测试（用非 admin token + admin token 双角色 fixture）：non-admin POST execute_problem/start_plan_task/create_work_hour 传他人 execute_user_id/user_id → 403 + code=HTTP_403_PPM_OWNERSHIP_DENIED；admin 代填同字段 → 201/200；non-admin 自填 → 201/200
  - 复用 conftest.py auth_admin_token（admin）+ 新建/复用 non-admin token fixture（is_platform_admin=False）
acceptance:
  - AC-1/AC-2 non-admin 代填→403；AC-3 admin 代填→201/200；AC-4 自填→201/200
  - AC-8 响应 403 + code=HTTP_403_PPM_OWNERSHIP_DENIED
verify:
  - cd backend && uv run pytest app/modules/ppm/common/tests/test_ownership.py app/modules/ppm/task/tests/test_router.py -q --no-cov
constraints:
  - 纯函数测试不依赖 DB（SimpleNamespace stub）
  - 端点测试 non-admin 角色 must be is_platform_admin=False（区别于 conftest 默认 admin token）
  - 不改既有 test_router.py 断言（仅作回归网；如个别非 admin 造数用例失败，按规则 9 改传当前用户）
---
