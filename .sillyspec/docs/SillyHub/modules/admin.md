---
schema_version: 1
doc_type: module-card
module_id: admin
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# admin

## 定位
平台「用户/角色/组织」RBAC 管理中心。跨 backend（FastAPI）+ frontend（Next.js admin-* 组件 + lib/admin.ts）三组件，提供角色 CRUD 与启停、组织树管理、用户管理（与 settings 模块 UserService 同源）的完整后台。是平台权限模型的运维入口，承载 admin 面板所有交互。

产品视角：这是平台管理员的「控制台」。在这里定义角色（绑权限点）、搭建组织树、管理用户账号与归属。权限模型由 auth 模块定义（Permission/PermissionGroup/Role），admin 做可视化运维。用户管理与 settings 同源，是历史聚合的另一半。前端 admin 面板含组织树、角色权限选择器、用户抽屉三大交互组件。

## 契约摘要
- 后端路由：`APIRouter prefix=/admin tag=admin`
  - 角色：`GET/POST /roles`（`RoleRead`/`RoleCreateRequest`）、`GET/PATCH/DELETE /roles/{id}`（`RoleUpdateRequest`）、`POST /roles/{id}/disable|enable`、`GET /roles/{id}/users`（`RoleUserListResponse`）
  - 组织：`GET/POST /organizations`（`OrganizationRead`/`OrganizationCreateRequest`）、`GET/PATCH/DELETE /organizations/{id}`（`OrganizationDetail`/`OrganizationUpdateRequest`）、`POST /organizations/{id}/disable|enable`
  - 用户：复用 `UserService`（与 settings 同源）；`UserCreateRequest`(username 必填 min3 / email Optional)、`UserUpdateRequest`(增 username/email 全 Optional 可编辑)、`UserRead`(email Optional)
- 数据：`Organization`（树形 parent_id 自引用）、`UserOrganization`（M2N）、`UserRole`（M2N）、`Role`
- 服务：`RoleService`（业务规则+审计）、`OrganizationService`（子树聚合）、`UserService`（自保护+最后管理员保护）
- 前端：`(dashboard)/admin/*` 页面 + `admin-organization-tree.tsx`（组织树）/ `admin-role-permission-picker.tsx`（权限选择）/ `admin-user-drawer.tsx`（用户抽屉）+ `lib/admin.ts`
- 依赖：`core`、`models`、`auth`（Permission/PermissionGroup/Role）；权限点 `require_permission`（管理员级）
- 跨组件协作：auth 模块提供权限模型，admin 做运维；settings 共用 UserService；前端 admin 面板全交互

## 关键逻辑
组织树与角色管理：
```
OrganizationService._descendant_ids(root_id)   # 递归取子孙组织 id 集
_counts(org_id) → (user_count, descendant_count)
RoleService: create/update/disable/enable/delete
  disable 不断关联（保留历史），delete 才解绑
  _count_users(role_id) 防 0 用户角色误判
UserService: 自保护（不能删自己）+ 最后管理员保护（_active_admin_count）
```
- 组织树通过 parent_id 自引用，`_descendant_ids` 做子树聚合统计
- 角色启停用 disable/enable 软状态，删除前校验用户数（`_count_users`）
- 用户组织/角色关联用 `_rewrite_organizations` / `_rewrite_roles` 全量重写
- `_to_read` / `_to_read(org)` 把 ORM 补全为响应 DTO（带用户数/子孙数）
- RoleService.`_audit` / OrganizationService.`_audit` 统一记录审计
- `_validate_organizations` / `_validate_roles` 校验关联实体存在性

### 角色与权限
- RoleService.create/update 接 `RoleCreateRequest`/`RoleUpdateRequest`，含 permissions 列表
- 角色权限经 `admin-role-permission-picker` 前端组件选择，映射到 auth.Permission/PermissionGroup
- disable_role 软停用，保留 user_role 关联但不生效；enable 恢复
- delete_role 硬删前 `_count_users` 校验无用户关联
- list_roles 支持搜索/分页，返回 RoleRead（含 permissions + user_count）

## 注意事项
- `_user_roles_model()` 做了延迟 import 容错（task-05 标记），import 失败提示 task 未完成
- 用户管理与 settings 模块共用 `UserService`，两处规则需保持一致勿发散
- username 为登录主账号（必填、可编辑，D-001/D-004），create/update 经 `_resolve_username` 做唯一校验（排除自身），冲突抛 409；email 可空，非空全局唯一（D-003）
- 组织删除需校验子孙与用户数，非空不允许直接删
- 角色 disable 是软状态，权限校验需考虑 disabled 角色不生效
- admin 为 needs_review 模块，文档与实现需重点对照
- 前端用户抽屉组织/角色多选 size 需匹配后端 le=100，用 allSettled 容错
- 角色/组织管理加分页（默认 20/页），pageSizeOptions [10,20,50,100]
- 组织树前端用 expandedKeys 受控全展开（defaultExpandAll 异步 treeData 不可靠）
- 自保护：用户不能禁用/删除自己；最后管理员保护：不能删光活跃管理员
- OrganizationService `_descendant_ids` 递归取子树，删除前校验非空
- `_counts` 返回 (user_count, descendant_count) 供组织详情展示
- 组织 create/update 接 OrganizationCreate/UpdateRequest，含 parent_id 建树
- list_organizations 支持树形展开，前端 organization-tree 受控 expandedKeys
- UserService `_active_admin_count` 防删光最后活跃管理员锁死系统
- admin router 与 settings router 用户端点职责重叠，改动需双向同步
- RoleService 硬删前 `_count_users` 校验无用户关联
- list_roles 返回 RoleRead 含 permissions + user_count
- 组织 disable 软停用，enable 恢复，delete 才硬删（需无子孙无用户）
- _descendant_ids 用递归 CTE 或遍历取子树 id 集
- UserService.disable_login 设 user.is_active=false，enable 反之
- list_organizations 树形返回，前端按 parent_id 组装树
- 角色权限经 PermissionGroup 分组，picker 按组展示
- 前端用户抽屉组织/角色多选用 antd Select mode=multiple
- admin router 的 /admin/users 与 settings /users 职责重叠，历史遗留
- OrganizationService 禁用组织不级联禁用户
- 角色权限变更对已登录用户需刷新会话才生效
- list_role_users 查角色下用户，供角色详情展示

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
