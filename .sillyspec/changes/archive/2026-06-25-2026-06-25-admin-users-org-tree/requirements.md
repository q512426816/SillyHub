---
author: WhaleFall
created_at: 2026-06-25T15:50:00
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 有 USER_READ 权限，查看/筛选/管理全部用户与组织 |

## 功能需求

### FR-01: 按组织过滤用户列表
覆盖决策：D-004@v1（exists 子查询）
Given 组织树已建（parent_id 自引用，user_organizations M2N 绑定）
When 调用 `/api/admin/users?organization_id=<id>&include_children=true`
Then 返回该组织 + 所有下级组织的 distinct 用户（一用户在子树多组织只返回一次），total/分页正确

Given include_children=false（或前端固定 true 场景外的调用）
When `organization_id=<id>&include_children=false`
Then 只返回该组织直接成员

Given organization_id 未传
When 查询
Then 行为完全不变（全部用户），零兼容影响

### FR-02: OrganizationRead 增 subtree_member_count
覆盖决策：D-003@v1（distinct user_id）
Given 组织树
When list_organizations / get_organization 返回
Then 每个组织含 subtree_member_count = 当前+所有下级 distinct 成员数；member_count/children_count 保留不变

### FR-03: 前端组织树组件
覆盖决策：D-001@v1（固定含下级）、D-002@v1（只显 active）
Given listOrganizations 返回 flat organizations
When 渲染 admin-org-tree
Then 按 parent_id 组装树；顶部「全部组织」节点；节点显示 name + subtree_member_count（fallback member_count）；只渲染 status==='active' 组织；支持展开/折叠

Given 用户点击某组织节点
When onSelect
Then 设置 selectedOrgId + 重置 page=1 + 刷新右侧用户列表

Given 用户点击「全部组织」
When onSelect
Then selectedOrgId=null，显示全部用户

### FR-04: users page 左树右表布局 + 筛选叠加
Given admin/users 页面
When 渲染
Then 左侧组织树 + 右侧查询表格（搜索/状态/组织叠加）；右侧顶部显示当前筛选（全部组织 / 组织名(含下级组织)）

Given 同时设置搜索关键词 + 状态 + 组织
When 查询
Then 三维度叠加过滤（listUsers 透传 q/status/organization_id/include_children）

### FR-05: 新建用户带入选中组织
覆盖决策：Design Grill X-001（drawer 加 prop）
Given 用户选中某组织（selectedOrgId 非空）
When 点「+新建用户」打开 AdminUserDrawer（create 模式）
Then drawer 默认 organization_ids=[selectedOrgId]（通过 defaultOrganizationIds prop 预填）

Given 未选中组织（selectedOrgId=null）
When 新建
Then drawer organization_ids=[]（行为不变）

### FR-06: 现有功能不受影响
Given 现有搜索/状态筛选/分页/编辑/删除/会话/审计/重置密码
When 操作
Then 全部正常工作（organization_id 默认 None 时零影响）

## 非功能需求

- 兼容性：organization_id 默认 None，未传时 list_users 行为零变化；OrganizationRead 新增字段旧前端忽略不报错。
- 可回退：组织过滤为 query 参数叠加，移除参数即回退。
- 可测试：FR-01~06 均有 Given/When/Then，后端 pytest + 前端 vitest 覆盖。
- 性能：exists 子查询 + 实时算 subtree_member_count，数据量小未上线可接受（R-01/R-02）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-03, FR-04 | include_children 固定 true |
| D-002@v1 | FR-03 | 树只显 active，subtree 聚合含 disabled 下级 |
| D-003@v1 | FR-02 | subtree_member_count = distinct user_id |
| D-004@v1 | FR-01 | exists 子查询过滤 |
| D-005@v1 | FR-02 | 实时算不缓存 |
