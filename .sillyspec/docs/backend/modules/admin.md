---
schema_version: 1
doc_type: module-card
module_id: admin
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 用户与组织管理（admin）

## 定位
平台级用户/角色/组织管理中枢（区别于 workspace 级 RBAC）。用户全生命周期（创建/改/删/
禁登/重置密码/会话撤销/审计查询）、角色 CRUD + 启停、组织树管理。所有写操作落 AuditLog。
是 settings 模块「用户管理」面的实质实现层；auth.rbac 延迟反向引用本模块的 UserRole
收集平台级权限（admin↔auth/settings 双向引用）。

## 契约摘要
- 用户：`GET|POST /api/admin/users`、`PATCH|DELETE /users/{id}`；
  `/users/{id}/sessions` GET、`DELETE .../sessions/{sid}`、
  `POST .../sessions/revoke-all`；`/users/{id}/audit`（审计查询）、
  `.../workspaces`（所属工作区）、`.../reset-password`、`.../disable-login`、
  `.../enable-login`。
- 角色：`GET|POST /api/admin/roles`、`PATCH|DELETE /roles/{id}`、
  `POST /roles/{id}/disable|enable`、`GET /roles/{id}/users`。
- 组织：`GET|POST /api/admin/organizations`、`PATCH|DELETE /organizations/{id}`、
  `POST /organizations/{id}/disable|enable`。
- 服务（均持 session + actor_id，写前 `_set_audit_context`）：
  - `UserService`（users_service.py）：list_users / get_user / create_user /
    update_user / delete_user / disable_login / enable_login / reset_password /
    list_sessions / revoke_session / revoke_all_sessions / list_audit_logs /
    list_workspaces；用户名可用性校验（`_assert_username_available`）与
    组织/角色重写（`_rewrite_organizations` / `_rewrite_roles`）。
  - `RoleService`（roles_service.py）：list / get / create / update / disable /
    enable / delete / list_users——权限闸在 router 层，类内只管业务规则；
    `_perms_by_roles` / `_count_users_by_roles` 供列表展示。
  - `OrganizationService`（organizations_service.py）：list / get / create /
    update / disable / enable / delete；`_descendant_ids` 递归收集子树、
    `_counts`(user_count, child_count) 与 `_subtree_member_count` 级联统计。
- 模型：organizations（parent_id 自引用树 + `ix_organizations_parent_id`）、
  user_organizations、user_roles（UserRole 平台级用户-角色 M2M）。

## 关键逻辑
```
UserService.delete_user(id):
  最后一个 active admin → 拒(_active_admin_count 防自锁)
  _revoke_sessions(id) → soft-delete User(deleted_at+status) → 审计落库
授平台管理权前: _assert_actor_may_grant_platform_admin
  ——授 is_platform_admin=True 或绑定含 platform:admin 权限的角色前,
    校验 actor 自身 is_platform_admin, 否则 PermissionDenied
组织树: parent_id 自引用; 禁用/删除级联到子树(_descendant_ids 展开);
  Organization.status 受 check 约束 IN ('active','disabled')
```

## 注意事项
- 用户可见错误文案中文（error-message-l10n），技术 ID 在 `details`。
- 支配权纵深防御：router 层 `USER_WRITE` ≠ 平台管理员；`create_user`/`update_user`
  在授予 `is_platform_admin=True` 或绑定含 `platform:admin`（PLATFORM_ADMIN，
  super_admin 系统角色自带）权限的角色前必须过 `_assert_actor_may_grant_platform_admin`，
  防持 USER_WRITE 的非管理员自提权/横向提权；降级不触发，仍由 `_active_admin_count` 兜底。
- UserRole / UserOrganization 是平台级 M2M，与 auth 的 UserWorkspaceRole（workspace 级）
  严格区分，勿混用。
- 全部 service 写操作经 `_audit` 写 AuditLog（action 前缀 user./role./organization.），
  OrganizationService 直接写 workflow.AuditLog。
- `roles_service` 用延迟 import 取 UserRole（避免与 auth 循环引用），import 失败表示
  前置任务未完成。
- 改 admin 表结构需三处联测（auth.rbac 权限收集 / settings 用户管理面 / 本模块）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
