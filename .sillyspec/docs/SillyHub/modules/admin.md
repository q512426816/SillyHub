---
schema_version: 1
doc_type: module-card
module_id: admin
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台用户与角色管理（admin）

## 定位
平台「用户 / 角色 / 组织」RBAC 管理中心，backend（`/admin` 路由）+ frontend（`(dashboard)/admin/*` 页面、admin-* 组件、lib/admin.ts）双组件。
这是平台管理员的运维控制台：定义角色（绑权限点）、搭建组织树、管理用户账号与会话。

不负责：权限校验执行（auth.rbac / core.auth_deps）、业务工作区的成员与角色分配（workspace members）。
权限模型本身（Permission/Role 枚举与表）归 auth 模块，admin 只做可视化运维；用户管理与 settings 模块共用同一 UserService（settings 侧仅为向后兼容 re-export）。

## 契约摘要
- **角色管理**：
  - 列表（搜索/分页）/详情/创建/更新（含 permissions 列表）。
  - **platform:admin 写入支配权（ql-20260827-019）**：create/update 的 permission_keys 含 `platform:admin` 时仅平台管理员可写（403 `ROLE_PLATFORM_ADMIN_FORBIDDEN`）——否则持 ws `role:write` 者可"先绑普通角色、再改角色权限加回 platform:admin"自我提权（users_service 的绑定时校验只快照绑定时点的角色权限）。
  - disable/enable 软停用——disable 不断 user_role 关联（保留历史）但不生效，enable 恢复。
  - delete 硬删——删前 `_count_users` 校验无用户关联。
  - 角色下用户列表；RoleRead 带 permissions + user_count。
- **组织管理**：
  - 树形 CRUD（parent_id 自引用）；disable/enable 软停用（不级联禁用户）；delete 需无子孙且子树无成员。
  - OrganizationDetail 带用户数/子孙数统计（`_counts`）。
- **用户管理**（UserService，与 settings 同源）：
  - 列表（搜索/分页 + `?ids=` 批量精确查——供前端回填已选用户真实姓名）/详情/创建/更新/删除。
  - username 为登录主账号：必填、可编辑、唯一（`_resolve_username`/`_assert_username_available` 排除自身，冲突 409）；email 可空、非空全局唯一。
  - 新建用户密码可选：缺省落模块常量 `DEFAULT_INITIAL_PASSWORD`（`SillyHub@123`），显式传仍按 min_length=8 校验；admin/settings 两入口共用 schema 行为一致；前端抽屉不渲染密码框、展示默认密码提示。
  - 重置密码：不传新密码时随机生成一次性口令经响应下发（BS-1）；保留「自定义密码」；审计 details 记 `used_default_password`。**支配权（ql-20260827-019）：非平台管理员重置平台管理员密码 → 403 `PLATFORM_ADMIN_RESET_FORBIDDEN`**（重置响应含明文新口令，不校验则任意 ws `user:write` 持有者可接管超管账号）。
  - disable/enable 登录（is_active 翻转，伴随 `_revoke_sessions` 吊销会话防已禁用账号持 token 继续操作）。
  - 会话列表 / 吊销单个 / 吊销全部；用户审计日志列表；用户工作区视图（含组织成员关系）。
- **审计**：RoleService/OrganizationService/UserService 统一写审计行；AuditLog 模型来自 workflow 模块（admin 对 workflow 的唯一依赖）。
- **前端交互**：组织树（受控 expandedKeys 全展开，defaultExpandAll 对异步 treeData 不可靠）、角色权限选择器（按 PermissionGroup 分组）、用户弹窗（antd Modal + Form，组织 TreeSelect / 角色 Select multiple）；列表分页默认 20/页，多选 size 匹配后端 le=100。

## 关键逻辑
```
# 组织树聚合
_descendant_ids(root_id) 递归取子孙 id 集 → _counts(org_id)=(user_count, descendant_count)
_subtree_member_count 删除前校验子树成员；非空拒删

# 角色生命周期
disable 软停用（关联保留不生效）→ enable 恢复；delete 硬删前 _count_users 校验

# 用户保护（三条硬约束）
自保护：不能禁用/删除自己
最后管理员保护：_active_admin_count 防删光活跃管理员锁死系统
平台管理员授予守卫：_assert_actor_may_grant_platform_admin（普通管理员不能授予 platform_admin 权限）

# 关联全量重写
update 用户时 _rewrite_organizations / _rewrite_roles 整体替换关联行（配 _validate_* 存在性校验）
```

## 注意事项
- 用户管理规则与 settings 模块同源（同一 UserService）：改行为只改一处、两入口自动一致；admin 与 settings 的用户端点职责重叠是历史遗留，改路由需双向确认。
- 软停用语义：角色 disable 后其权限不再生效但关联保留；组织 disable 不级联禁用户；角色/组织变更对已登录用户需刷新会话才生效。
- 默认初始密码 `SillyHub@123` 是模块常量，改动需同步前端提示文案、重置密码流程与安全基线。
- `_user_roles_model()` 延迟 import 容错（roles_service），import 失败提示 task 未完成，勿改成顶层 import。
- 用户删除/禁用必须伴随会话吊销（`_revoke_sessions`），勿在新增的用户状态端点里漏掉。
- 审计 details 字段命名已从 `auto_generated` 改为 `used_default_password`，消费审计数据的报表需注意。
- 前端组织树/多选的交互约束见契约摘要前端段，改动组件时勿破坏 size/le=100 对齐。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
