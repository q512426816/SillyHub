---
id: task-03
title: "profile 聚合（工号直取 + user_organizations JOIN organizations 取部门 + workspaces role_name）（覆盖：FR-03, FR-04, D-003@v1, D-004@v1）"
title_zh: 个人信息聚合查询
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-01, task-02]
blocks: [task-09]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
  - backend/app/modules/ppm/workbench/router.py
provides:
  - contract: WorkbenchProfile
    fields: [display_name, employee_no, department_name, role_name, avatar_text]
expects_from:
  - contract: UserRead
    needs: [employee_no]
  - contract: WorkbenchProfile
    needs: [WorkbenchProfile DTO 定义]
goal: >
  实现 WorkbenchService.get_profile，返回当前登录人姓名 / 工号 / 部门 / 角色 / 头像首字。
implementation:
  - "在 backend/app/modules/ppm/workbench/service.py 的 WorkbenchService 中实现 async def get_profile(self, session, user) -> WorkbenchProfile"
  - "display_name = user.display_name（auth/model.py User.display_name，可能为 None）"
  - "employee_no = user.employee_no（task-01 加的列 auth/model.py，老用户为 None）"
  - "部门查询：select(Organization.name).join(UserOrganization, UserOrganization.organization_id == Organization.id).where(UserOrganization.user_id == user.id).where(Organization.status == 'active').limit(1)；取首个 active org 的 name（无则 None）。注意 user_organizations 表本身无 status 字段，用 organizations.status='active' 过滤"
  - "role_name 查询：调用 list_user_workspace_roles(session, user_id=user.id)（auth/rbac.py:115，返回 list[tuple[workspace_id, role_key, role_name]]）；遍历取首个非空 tuple[2]（role_name），全空则 None（D-004@v1 取 workspaces[0] 语义）"
  - "avatar_text：取 display_name 首字；display_name 为空取 user.username 首字；username 也空取 user.email 首字；全空兜底 '#'；.strip() 后取 [0] 防前后空白"
  - "router handler：GET /api/ppm/workbench/profile，依赖 get_current_user 取 user，调用 service.get_profile(session, user) 返回 WorkbenchProfile(**data)"
acceptance:
  - "用户有 user_organizations 关联且对应 organizations.status='active' → department_name 返回该组织名"
  - "用户无任何组织关联或关联组织均非 active → department_name=None（R-04 nullable 兜底，UI 显示「—」）"
  - "老用户 employee_no=None → profile.employee_no=None（不报错）"
  - "role_name 取 list_user_workspace_roles 返回的首个非空 role_name；用户无任何 workspace 角色绑定 → role_name=None"
  - "avatar_text 永远返回非空单字（display_name 空→username→email→'#'）"
  - "返回对象符合 WorkbenchProfile schema（5 字段齐全）"
verify:
  - "cd backend && uv run pytest -q app/modules/ppm/workbench -k profile（task-06 单测补齐后跑通）"
  - "cd backend && uv run ruff check app/modules/ppm/workbench && uv run mypy app/modules/ppm/workbench"
constraints:
  - "部门 nullable 兜底（R-04：organizations/user_organizations 可能为空，查不到 None 不报错）"
  - "角色取 workspaces 首个非空 role_name（D-004@v1，不聚合多 workspace 角色）"
  - "不新建表、不写表（纯只读聚合，D-impl 新接口只读）"
  - "不依赖 user_organizations.status（该表无此列），用 organizations.status 过滤 active 组织"
  - "复用 auth/rbac.list_user_workspace_roles，不重写角色查询逻辑"
  - "avatar_text 在 display_name/username/email 全空时有兜底值，保证非空"
---
