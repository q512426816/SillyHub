---
id: task-04
title: "auth/router.py 新增 POST /api/auth/change-password 端点"
title_zh: 新增修改密码 HTTP 端点
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-02, task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-01]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/auth/router.py
expects_from:
  task-02:
    - contract: ChangePasswordRequest
      needs: [old_password, new_password]
  task-03:
    - contract: AuthService.change_password
      needs: []
provides:
  - contract: "POST /api/auth/change-password"
    fields: [old_password, new_password]
goal: >
  新增 POST /api/auth/change-password(204) 端点，依赖 get_current_user，
  调 AuthService.change_password，对齐既有 /login 端点风格。
implementation:
  - 在 router.py import ChangePasswordRequest（from app.modules.auth.schema）
  - 新增 POST /change-password 端点，status_code 取 204，依赖 get_current_user 取当前 user，函数参数含 session 与 settings 依赖及 payload 类型 ChangePasswordRequest
  - 调 AuthService(session, settings=settings).change_password(user_id=user.id, old_password=payload.old_password, new_password=payload.new_password)
acceptance:
  - 带 token + 正确旧密码 + 合法新密码 → 204
  - 未带 token → 401（get_current_user）
  - 端点出现在 OpenAPI（供 task-06 gen-api-types）
verify:
  - cd backend && uv run ruff check app/modules/auth/router.py
  - cd backend && uv run mypy app
constraints:
  - 已认证即可改，不检查 login_enabled（D-006）
  - 204 无 response body
---
