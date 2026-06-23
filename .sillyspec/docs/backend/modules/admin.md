---
schema_version: 1
doc_type: module-card
module_id: admin
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# admin

## 定位
平台级用户/角色/组织管理中枢（区别于 workspace 级 RBAC）。提供用户全生命周期（创建/改/删/禁登/重置密码/会话撤销/审计查询）、角色 CRUD + 启停、组织树（自引用 parent_id）管理。所有写操作落 AuditLog。是 settings 模块用户管理的实质实现层。

## 契约摘要
- `/api/admin/users` — GET 列表 / POST 创建 / PATCH 更新 / DELETE 删除
- `/api/admin/users/{id}` — GET 详情；`.../sessions` GET 列 / DELETE 撤销单会话 / `.../sessions/revoke-all` POST 撤销全部
- `/api/admin/users/{id}/audit` GET 审计；`.../workspaces` GET 工作区；`.../reset-password` POST
- `/api/admin/users/{id}/disable-login` / `enable-login` POST
- `/api/admin/roles` — GET 列表 / POST 创建 / PATCH 更新 / DELETE 删除 / `.../disable` / `.../enable` POST / `.../users` GET
- `/api/admin/organizations` — GET 列表 / POST 创建 / PATCH 更新 / DELETE 删除 / `.../disable` / `.../enable` POST
- Service：`UserService` / `RoleService` / `OrganizationService`（均持 session + actor_id）

## 关键逻辑
```
UserService.delete_user(target_id):
  if target 是最后一个 active admin: raise（_active_admin_count 防自锁）
  _revoke_sessions(target_id)          # 清会话
  soft-delete User（deleted_at + status）
  AuditLog("user.delete"); commit

OrganizationService: 组织树用 parent_id 自引用
  _descendant_ids(root) 递归收集子节点；禁用/删除级联到子树
  _counts(org) 返回 (user_count, child_count)
```

## 注意事项
- UserRole / UserOrganization 是平台级 M2M（非 workspace 级），与 auth 模块的 UserWorkspaceRole 区分
- `_active_admin_count` 防止删除/禁用最后一个平台管理员导致系统锁死
- 组织为层级树（parent_id 自引用，有 `ix_organizations_parent_id`），禁用/删除需级联子树（`_descendant_ids`）
- Organization.status 受 check 约束 `status IN ('active','disabled')`
- 所有 service 写操作经 `_audit` 写 AuditLog（action 含 user./role./organization. 前缀），OrganizationService 直接写 workflow.AuditLog
- roles_service 用 `_user_roles_model()` 延迟 import UserRole（避免循环），import 失败表示前置任务未完成
- auth.rbac 延迟 import admin.UserRole 收集权限，settings.service/schema 也 import admin，形成 admin↔auth/settings 双向引用

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
