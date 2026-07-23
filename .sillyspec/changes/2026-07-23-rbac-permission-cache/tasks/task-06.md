---
id: task-06
title: admin/users_service 失效 hook（FR-04, D-002@v2）
title_zh: admin/users_service 用户平台角色 CRUD 失效 hook
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P4
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - backend/app/modules/admin/users_service.py
goal: >
  在用户平台角色相关的写操作(create_user / update_user / delete_user)commit 后调用 invalidate_all_permissions,
  保证 UserRole、_rewrite_roles、is_platform_admin 翻转后权限缓存立即清空。
implementation:
  - create_user(L158)、update_user(L280,含 _rewrite_roles@368/490-496、is_platform_admin 翻转@355)、delete_user(L401):每个 commit 后调 `await invalidate_all_permissions()`
  - 从 core.permission_cache 导入 invalidate_all_permissions
  - 注:disable_login/enable_login/reset_password/revoke_session 非权限写,不加 hook
acceptance:
  - create_user/update_user/delete_user 任一 commit 后,perm:* + ppm-scope:* 全部清空
  - invalidate 失败时记 ERROR 且不阻断业务
verify:
  - cd backend && uv run pytest app/modules/admin/tests/ tests/modules/admin/ -q -k "user"
  - cd backend && uv run mypy app/modules/admin/users_service.py
  - cd backend && uv run ruff check app/modules/admin/users_service.py
constraints:
  - D-002@v2:commit 后调失效
  - 仅 create_user/update_user/delete_user 加 hook;登录/密码/会话操作非权限写不动
---

流程位置:Wave 2(失效触发,依赖 task-01)。与 task-03~05/07~09 同 Wave 可并行。
