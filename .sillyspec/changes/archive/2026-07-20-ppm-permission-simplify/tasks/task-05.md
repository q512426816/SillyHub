---
id: task-05
title: 新增 ppm 接口最小冒烟测试 backend/tests/modules/ppm/test_router_smoke.py（登录 200 / 未登录 401）（覆盖：FR-08, R-04）
title_zh: 为当前零测试的 ppm 模块补最小冒烟测试，守护"登录可访问 / 未登录 401"，弥补删权限校验后的回归守护空缺
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - backend/tests/modules/ppm/test_router_smoke.py
  - backend/tests/modules/ppm/__init__.py
goal: >
  给当前零 router 测试的 ppm 模块补一个最小冒烟测试，断言"登录用户调用代表性 ppm GET 端点返回 200、未登录调用返回 401"，作为 task-01 去掉 require_permission_any 后的回归守护（对应 R-04 / AC-4）。
implementation:
  - 新建 backend/tests/modules/ppm/__init__.py（空文件，使该目录成为可被 pytest 采集的 package）。
  - 新建 backend/tests/modules/ppm/test_router_smoke.py，复用全局 conftest fixture（backend/conftest.py 暴露的 client: AsyncClient 与 db_session: AsyncSession），参考 backend/tests/modules/auth/test_api_key_router.py 的 _make_user helper 模式：用 password_hasher.hash 建一个 is_platform_admin=True 的 active User，commit + refresh，调 create_access_token 生成 JWT，请求头 Authorization: Bearer <token>。
  - 选一个代表性的、task-01 之后已改为仅认证（Depends(get_current_principal)）的 ppm GET 端点（推荐 /api/ppm/workbench/profile —— 工作台骨架端点，无复杂业务前置条件；或备选 /api/ppm/projects 列表），写两条断言：①带登录头请求返回 200；②不带 Authorization 头请求返回 401。
  - 不依赖任何被删的 17 个 ppm 操作权限（测试里禁止 import Permission.PPM_* 或 hardcode "ppm:*:write|delete|export|assign" 字符串）；仅靠"登录拿 token"即可访问。
acceptance:
  - backend/tests/modules/ppm/__init__.py 与 test_router_smoke.py 存在；test_router_smoke.py 包含至少两条 case（登录 200 + 未登录 401）。
  - 登录用例：携带有效 JWT 请求选定 ppm GET 端点，resp.status_code == 200。
  - 未登录用例：不带 Authorization 头请求同一端点，resp.status_code == 401。
  - 测试文件中无对 Permission.PPM_* 的引用，也无任何被删 17 个 ppm 操作权限字符串字面量（grep 零命中）。
verify:
  - cd backend && uv run pytest tests/modules/ppm/test_router_smoke.py -v
constraints:
  - 只做最小冒烟，不追求 ppm 接口全面覆盖（CRUD/数据范围/所有权等业务行为不在本 task 范围，与 ppm-data-scope 变更正交）。
  - 复用现有 fixture 模式（client / db_session / _make_user / create_access_token / password_hasher），不新造测试基础设施轮子。
  - 强依赖 task-01：本 task 的"登录即可访问"断言前提是 6 个 ppm router 已去掉 require_permission_any；若 task-01 未完成，未持权限用户会拿 403 而非 200，断言会失败。
  - 选端点时避开有强前置数据依赖的端点（如需先建项目/任务才能查的详情端点），优先选骨架/列表类 GET，确保单测自洽不依赖造数据。
  - 测试内不 hardcode 被删权限字符串，不 import 被删枚举成员（task-04 删枚举后此类引用会 ImportError / mypy 失败）。
provides: []
expects_from: []
---
