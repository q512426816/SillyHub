---
id: task-03
title: DAEMON_BORROW 权限点 + business_member 角色 + 种子迁移 + 白名单 + 缓存失效
title_zh: 新增借用权限和业务成员角色
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: []
blocks: [task-05, task-12]
requirement_ids: [FR-03]
decision_ids: [D-006@v2]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/migrations/versions/202607251300_add_daemon_borrow_permission.py
  - backend/app/modules/workspace/members_service.py
provides:
  - contract: DAEMON_BORROW
    fields: [permission_key]
  - contract: business_member
    fields: [role_key, permissions]
goal: >
  新增 DAEMON_BORROW 权限点和 business_member 工作空间角色，让业务人员能触发端点 + 借用回退。
implementation:
  - permissions.py 加 DAEMON_BORROW = "daemon:borrow"，group 属性加 daemon 前缀分支落 AGENT 组
  - 新迁移 INSERT business_member 角色 + role_permissions（task:run_agent + daemon:borrow + workspace 读集合），先用 SELECT id FROM roles WHERE key= 解析 role_id
  - members_service.py:42 ROLE_KEY_WHITELIST 加 "business_member"
  - 迁移末尾或部署流程调 invalidate_all_permissions（core/permission_cache.py:231-257）对齐 rbac-permission-cache
acceptance:
  - DAEMON_BORROW 枚举存在，group 路由正确
  - business_member 角色种子落地，含 task:run_agent + daemon:borrow
  - members_service 接受 business_member 角色授给成员
  - grant 后缓存失效（首次借用不被旧缓存挡）
verify:
  - cd backend && uv run pytest app/modules/auth app/modules/workspace -q --no-cov
  - cd backend && uv run mypy app/modules/auth
constraints:
  - 不改历史迁移 202605280900（已部署 DB 不会再跑）
  - business_member 带 task:run_agent（D-006@v2：触发端点，因无自有 daemon 必然走借用，不等于全量跑自有 agent）
  - 复用现有 agent 端点，不改 agent/router.py 鉴权
---
