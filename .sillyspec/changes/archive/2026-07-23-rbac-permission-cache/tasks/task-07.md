---
id: task-07
title: workspace/members_service 失效 hook（FR-04, D-002@v2）
title_zh: workspace/members_service 工作区成员变更失效 hook
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P4
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - backend/app/modules/workspace/members_service.py
goal: >
  在工作区成员的所有写操作(add_or_update_member / update_member_role / remove_member / transfer_ownership)commit 后
  调用 invalidate_all_permissions,保证 UserWorkspaceRole 变更后权限缓存立即清空。
implementation:
  - add_or_update_member(L222)、update_member_role(L288)、remove_member(L348)、transfer_ownership(L401,owner 逻辑@375-497):每个 commit 后调 `await invalidate_all_permissions()`
  - 从 core.permission_cache 导入 invalidate_all_permissions
acceptance:
  - 四个成员写方法任一 commit 后,perm:* + ppm-scope:* 全部清空
  - invalidate 失败时记 ERROR 且不阻断业务
verify:
  - cd backend && uv run pytest app/modules/workspace/tests/ -q -k "member or role or transfer or ownership"
  - cd backend && uv run mypy app/modules/workspace/members_service.py
  - cd backend && uv run ruff check app/modules/workspace/members_service.py
constraints:
  - D-002@v2:commit 后调失效
  - 仅 4 个成员写方法加 hook
---

流程位置:Wave 2(失效触发,依赖 task-01)。与 task-03~06/08~09 同 Wave 可并行。
