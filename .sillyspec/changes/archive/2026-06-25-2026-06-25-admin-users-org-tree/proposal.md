---
author: WhaleFall
created_at: 2026-06-25T15:50:00
---

# Proposal

## 动机

`/admin/users` 已加载 organizations 但仅用于编辑抽屉，无法按组织维度筛选用户。用户量大时管理员无法快速查看某组织（及其下级）的成员，需结合搜索/状态/组织三维度筛选。后端 organizations 已是 parent_id 树、用户↔组织 M2N，具备过滤条件，仅缺 API 参数与前端组织树。

## 关键问题

1. `/api/admin/users` 无 organization_id 过滤参数，无法按组织维度查询。
2. `OrganizationRead` 只有直接 member_count，无「子树成员数」，树节点无法显示含下级的总人数。
3. 前端无组织树组件，organizations flat 列表无法可视化层级 + 点击筛选。

## 变更范围

- 后端：list_users 增 organization_id/include_children（exists 子查询过滤，复用 _descendant_ids）；OrganizationRead 增 subtree_member_count；router 增 query 透传。
- 前端：lib/admin.ts 类型同步；新增 admin-org-tree 组件（flat 组装树、显示 subtree_member_count、只显 active、点击过滤）；users page 改左树右表布局 + selectedOrgId + 新建带入；admin-user-drawer 加 defaultOrganizationIds prop。

## 不在范围内（显式清单）

- 不做 include_children 的 UI 切换开关（固定 true）。
- 不做 subtree_member_count 缓存（实时算）。
- 不改 organizations 表结构、不加 ORM relationship。
- 不做"只看自己组织"的授权限制（保持 USER_READ 全可见）。
- 不优化 _user_with_relations 既有 N+1。
- 不在树中显示 disabled 组织。

## 成功标准（可验证）

1. 点「全部组织」显全部用户（organization_id 不传，行为不变）。
2. 点叶子组织只显该组织用户。
3. 点父组织（include_children=true）显当前+下级组织用户。
4. 树节点显示 subtree_member_count（fallback member_count）。
5. 搜索 + 状态 + 组织筛选可叠加。
6. 分页切换正常；现有编辑/删除/会话/审计/重置密码不受影响。
7. 新建用户时若选中组织，drawer 默认带入该组织。
8. organization_id 未传时 list_users 行为零变化（兼容）。
