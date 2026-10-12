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

## FR-admin-007 后端三处响应 DTO 的 email 改为可空并补充 username 字段,对应 service 查询补 select/构造
变更：2026-10-12-nullable-email-dto-fix
状态：active
摘要：DTO 契约与取数补齐
全文：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/requirements.md#FR-01
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-nullable-email-dto-fix:flow:测试绑定FR-01
  tests: backend/tests/modules/admin/test_roles_router.py「test_list_role_users_email_null_username_present」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-nullable-email-dto-fix
  status: active

## FR-admin-008 GET /api/admin/roles/{role_id}/users 对 email 为 NULL 的绑定用户返回 200(email=null 且 username 有值),不再 500
变更：2026-10-12-nullable-email-dto-fix
状态：active
摘要：平台级绑定的纯用户名账号；工作区级绑定的纯用户名账号
全文：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/requirements.md#FR-02
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-nullable-email-dto-fix:flow:测试绑定FR-02
  tests: backend/tests/modules/admin/test_roles_router.py「test_list_role_users_email_null_username_present」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-nullable-email-dto-fix
  status: active

## FR-admin-009 工作区成员列表与邀请搜索接口对 email 为 NULL 的用户同样返回 200
变更：2026-10-12-nullable-email-dto-fix
状态：active
摘要：成员列表含纯用户名账号；邀请搜索命中纯用户名账号
全文：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/requirements.md#FR-03
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-nullable-email-dto-fix:flow:测试绑定FR-03
  tests: backend/tests/modules/workspace/test_members_router.py「test_list_and_search_return_200_for_email_null_user」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-nullable-email-dto-fix
  status: active

## FR-admin-010 前端类型同步与空值回退展示,排序不再对 null 调 localeCompare
变更：2026-10-12-nullable-email-dto-fix
状态：active
摘要：角色用户表渲染纯用户名账号
全文：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/requirements.md#FR-04
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-nullable-email-dto-fix:flow:测试绑定FR-04
  tests: frontend/src/components/workspace-member-row.test.tsx「email null 时回退展示 username 且不崩」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-nullable-email-dto-fix
  status: active

## FR-admin-011 相关测试全绿与产物提交
变更：2026-10-12-nullable-email-dto-fix
状态：active
摘要：回归验证
全文：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/requirements.md#FR-05
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-nullable-email-dto-fix:flow:测试绑定FR-05
  tests: backend/tests/modules/admin/test_roles_router.py「全文件回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-nullable-email-dto-fix
  status: active
