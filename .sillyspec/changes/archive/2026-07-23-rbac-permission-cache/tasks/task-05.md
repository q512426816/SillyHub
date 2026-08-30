---
id: task-05
title: admin/roles_service 失效 hook（FR-04, D-002@v2）
title_zh: admin/roles_service 角色 CRUD 失效 hook
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P4
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - backend/app/modules/admin/roles_service.py
goal: >
  在角色定义的所有写操作(create / update / disable / enable / delete)commit 后调用 invalidate_all_permissions,
  保证角色或 RolePermission 变更后权限缓存立即整体清空。
implementation:
  - create(L201)、update(L231,含 RolePermission 删插 L249-255、is_active 翻转)、disable(L263)、enable(L279)、delete(L290):每个 await session.commit() 之后调 `await invalidate_all_permissions()`
  - 从 core.permission_cache 导入 invalidate_all_permissions
acceptance:
  - create/update/disable/enable/delete 任一执行并 commit 后,perm:* + ppm-scope:* 全部被清空
  - invalidate 失败时记 ERROR 且不阻断业务(已 commit)
verify:
  - cd backend && uv run pytest app/modules/admin/tests/ tests/modules/admin/ -q -k "role"
  - cd backend && uv run mypy app/modules/admin/roles_service.py
  - cd backend && uv run ruff check app/modules/admin/roles_service.py
constraints:
  - D-002@v2:commit 后调失效;invalidate 失败升 ERROR 不阻断
  - 仅这 5 个写方法加 hook,查询方法不动
---

流程位置:Wave 2(失效触发,依赖 task-01)。与 task-03/04(读接入)、task-06~09(其它失效点)同 Wave 可并行。
