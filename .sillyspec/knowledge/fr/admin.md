## FR-admin-001 按组织过滤用户列表
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 组织树已建（parent_id 自引用，user_organizations M2N 绑定） include_children=false（或前端固定 true；When 调用 `/api/admin/users?organization_id=<id>&include_children=true` `organization_i；Then 返回该组织 + 所有下级组织的 distinct 用户（一用户在子树多组织只返回一次），total/分页正确 只返回该组织直接成员 行为完全不变（全部用户），零
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-01
最近确认：5a6a57578

## FR-admin-002 OrganizationRead 增 subtree_member_count
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 组织树；When list_organizations / get_organization 返回；Then 每个组织含 subtree_member_count = 当前+所有下级 distinct 成员数；member_count/children_count 保留
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-02
最近确认：5a6a57578

## FR-admin-003 前端组织树组件
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given listOrganizations 返回 flat organizations 用户点击某组织节点 用户点击「全部组织」；When 渲染 admin-org-tree onSelect onSelect；Then 按 parent_id 组装树；顶部「全部组织」节点；节点显示 name + subtree_member_count（fallback member_coun
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-03
最近确认：5a6a57578

## FR-admin-004 users page 左树右表布局 + 筛选叠加
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given admin/users 页面 同时设置搜索关键词 + 状态 + 组织；When 渲染 查询；Then 左侧组织树 + 右侧查询表格（搜索/状态/组织叠加）；右侧顶部显示当前筛选（全部组织 / 组织名(含下级组织)） 三维度叠加过滤（listUsers 透传 q/
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-04
最近确认：5a6a57578

## FR-admin-005 新建用户带入选中组织
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户选中某组织（selectedOrgId 非空） 未选中组织（selectedOrgId=null）；When 点「+新建用户」打开 AdminUserDrawer（create 模式） 新建；Then drawer 默认 organization_ids=[selectedOrgId]（通过 defaultOrganizationIds prop 预填） dr
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-05
最近确认：5a6a57578

## FR-admin-006 现有功能不受影响
变更：2026-06-25-2026-06-25-admin-users-org-tree
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 现有搜索/状态筛选/分页/编辑/删除/会话/审计/重置密码；When 操作；Then 全部正常工作（organization_id 默认 None 时零影响）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-admin-users-org-tree/requirements.md#FR-06
最近确认：5a6a57578
