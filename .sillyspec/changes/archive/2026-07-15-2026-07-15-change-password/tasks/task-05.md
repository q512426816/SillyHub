---
id: task-05
title: "tests/modules/auth/test_change_password.py 后端测试"
title_zh: 修改密码后端测试
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-03, task-04]
blocks: [task-10]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-004@v1, D-005@v1, D-006@v1]
allowed_paths:
  - backend/tests/modules/auth/test_change_password.py
goal: >
  新增 test_change_password 覆盖 AC-01~07：成功/旧密码错401/新密码短422/未认证401/改后旧密码登录失效/其他会话撤销/审计。
implementation:
  - 新建 backend/tests/modules/auth/test_change_password.py
  - 参考 tests/modules/admin/test_users_router.py 的 client+auth_headers+db_session fixture 风格
  - 用例：成功204+password_hash更新、旧密码错401 HTTP_401_PASSWORD_INCORRECT、新密码<8→422、未带token→401、改后旧密码登录401、其他session撤销、审计user.password_change
acceptance:
  - AC-01 成功204 + DB password_hash 已变
  - AC-02 旧密码错 401 HTTP_401_PASSWORD_INCORRECT
  - AC-03 新密码<8 → 422
  - AC-05 改后旧密码登录 → 401
  - AC-06 其他 session 撤销
  - AC-07 审计记录存在
verify:
  - cd backend && uv run pytest tests/modules/auth/test_change_password.py -v
constraints:
  - 用既有 fixture，不新建 DB
  - 不改非测试逻辑
---
