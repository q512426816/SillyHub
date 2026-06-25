---
author: WhaleFall
created_at: 2026-06-25T15:45:00
---

# design — admin/users 组织树筛选

## 1. 背景

`/admin/users` 已加载 organizations/roles，但 organizations 仅用于 AdminUserDrawer；主体仍是顶部搜索 + 用户表格。后端 organizations 支持 parent_id 树结构（`OrganizationRead` 已返回 member_count/children_count），用户↔组织通过 `user_organizations` M2N（复合主键 `(user_id, organization_id)`）。`/api/admin/users` 现仅支持 q/status/role/sort/order/limit/offset，不支持组织维度过滤。

目标：左侧增加组织树筛选，显示节点人数（subtree_member_count），点击组织后右侧用户列表按「当前组织 + 所有下级」过滤。

## 2. 设计目标

- 后端 `/api/admin/users` 支持 `organization_id` + `include_children` 过滤。
- `list_users` 用 **exists 子查询**过滤（无 join、无重复行，total/分页天然正确）。
- 复用现有模块级 `_descendant_ids`。
- `OrganizationRead` 增 `subtree_member_count`（当前+所有下级 distinct 成员数）。
- 前端左侧组织树（flat 按 parent_id 组装、显示 subtree_member_count、只显 active、点击过滤）。
- 新建用户带入选中组织。
- 现有搜索/状态/分页/编辑/删除/会话/审计/重置密码不受影响。

## 3. 非目标

- 不做 `include_children` 的 UI 切换开关（前端固定传 true）。
- 不做 `subtree_member_count` 缓存（实时算，数据量小未上线）。
- 不改 organizations 表结构、不加 ORM relationship（子树查询仍走手写 SQL）。
- 不做"只看自己组织"的授权限制（保持 `USER_READ` 全可见）。
- 不优化 `_user_with_relations` 既有 N+1。
- 不在树中显示 disabled 组织（只显 active）。

## 4. 拆分判断

单一功能（组织树筛选），前后端紧密耦合一个功能，不满足拆分条件（非 3+ 独立模块/角色/跨页流转），非批量模式（任务 <10）。单一变更。

## 5. 总体方案（Phase）

### Phase 0 后端 schema（`admin/schema.py`）
- `OrganizationRead`（:140-165）增 `subtree_member_count: int`。
- `UserQueryParams`（:247-254）增 `organization_id: uuid.UUID | None = None`、`include_children: bool = True`。
- 注：router 现用裸 `Query`（非 UserQueryParams），Phase 3 router 同步增裸 Query；UserQueryParams 保持定义同步以备未来迁移。

### Phase 1 后端 organizations_service（`organizations_service.py`）
- 复用模块级 `_descendant_ids(session, root_id) -> set[uuid]`（:51-76，BFS，返回**不含 root**）。
- 新增 `_subtree_member_count(session, org_id) -> int`：`org_ids = {org_id} ∪ _descendant_ids(session, org_id)`；`SELECT count(distinct user_id) FROM user_organizations WHERE organization_id IN :org_ids`。
- `_to_read`（:100-114）调用 `_subtree_member_count` 注入 `OrganizationRead.subtree_member_count`。

### Phase 2 后端 UserService.list_users（`users_service.py:85-124`）
- 签名增 `organization_id: uuid.UUID | None = None`、`include_children: bool = True`。
- organization_id 非空：`org_ids = {organization_id} ∪ (_descendant_ids(session, organization_id) if include_children else set())`；base 加 `.where(exists(select(1).select_from(user_organizations).where((user_organizations.c.user_id == User.id) & (user_organizations.c.organization_id.in_(org_ids)))))`。
- include_children 前端固定 true，参数保留灵活性。
- **无 join、无 group_by**，User 行不重复，total/分页天然正确。
- 从 `organizations_service` import `_descendant_ids`（同 admin 模块内）。

### Phase 3 后端 router（`admin/router.py:338-365`）
- list_users 端点增 `organization_id: uuid.UUID | None = Query(None)`、`include_children: bool = Query(True)`。
- 透传 `svc.list_users(organization_id=..., include_children=...)`。

### Phase 4 前端 `lib/admin.ts`
- `UserListParams` 增 `organization_id?: string`、`include_children?: boolean`。
- `OrganizationRead` 增 `subtree_member_count: number`。
- `listUsers` 透传 organization_id/include_children。

### Phase 5 前端新组件 `components/admin-org-tree.tsx`
- props: `{ organizations: OrganizationRead[]; selectedOrgId: string | null; onSelect: (id: string | null) => void }`。
- 客户端组装树：按 parent_id 分组递归构建 children；过滤 `status === 'active'`（disabled 不显示）。
- TreeDataNode：顶部「全部组织」（key='all'）+ 各组织节点（key=org.id，title=`name + subtree_member_count`，fallback member_count）。
- antd Tree，受控 expandedKeys（默认全展开），selectedKeys=[selectedOrgId ?? 'all']。
- onSelect → `onSelect(key === 'all' ? null : key)`。

### Phase 6 前端 `admin/users/page.tsx`
- 增 `selectedOrgId: string | null`（null=全部）；include_children 固定 true 直接传。
- `load`：`listUsers({ ..., organization_id: selectedOrgId ?? undefined, include_children: true })`。
- 点树节点：`setSelectedOrgId(id) + setPage(1)` → load 触发。
- 布局：主体 `<div className="flex gap-4">` 左 `<aside className="w-56 shrink-0"><SectionCard title="组织"><AdminOrgTree/></SectionCard></aside>` + 右 `<div className="min-w-0 flex-1">`（现有 SectionCard 查询 + DataTable）。
- 右侧顶部显当前筛选：null→「全部组织」，否则「组织名(含下级组织)」。
- 新建用户：**AdminUserDrawer 加 `defaultOrganizationIds?: string[]` prop**（create 模式 useEffect 预填 `setOrganizationIds(defaultOrganizationIds ?? [])`，edit 模式仍用 user 现有 orgs）；users page 传 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}`。现状 drawer create 模式 organizationIds 硬编码 `[]`（admin-user-drawer.tsx:75），无此 prop → 必须改 drawer（Design Grill X-001 发现）。

### Phase 7 测试 + 部署
- 后端 list_users 测试：全部(无 org) / 叶子组织 / include_children=true 含下级 / distinct 去重（一用户在子树多组织）/ 叠加 q+status+分页。
- 前端：admin-org-tree 组装 / 点击筛选 / 新建带入（vitest）。
- ruff + mypy + tsc + lint 全绿。
- rebuild Docker 部署。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/admin/schema.py | OrganizationRead +subtree_member_count；UserQueryParams +organization_id/include_children |
| 修改 | backend/app/modules/admin/organizations_service.py | +_subtree_member_count；_to_read 注入 |
| 修改 | backend/app/modules/admin/users_service.py | list_users +organization_id/include_children +exists 过滤；import _descendant_ids |
| 修改 | backend/app/modules/admin/router.py | list_users 端点 +organization_id/include_children Query |
| 修改 | backend/tests/modules/admin/test_users_router.py | +组织过滤用例 |
| 修改 | frontend/src/lib/admin.ts | UserListParams +organization_id/include_children；OrganizationRead +subtree_member_count；listUsers 透传 |
| 新增 | frontend/src/components/admin-org-tree.tsx | 组织树组件 |
| 修改 | frontend/src/components/admin-user-drawer.tsx | +defaultOrganizationIds prop，create 模式预填 organizationIds（Design Grill X-001）|
| 修改 | frontend/src/app/(dashboard)/admin/users/page.tsx | +selectedOrgId；左树右表布局；新建带入（传 defaultOrganizationIds）|

## 7. 接口定义

### 7.1 `/api/admin/users` query（增）
```
organization_id?: uuid (Query None)
include_children?: bool (Query True)
```

### 7.2 `UserService.list_users` 签名（增参）
```python
async def list_users(self, *, q=None, status=None, role=None,
                     sort="created_at", order="desc", limit=20, offset=0,
                     organization_id: uuid.UUID | None = None,
                     include_children: bool = True) -> tuple[list[User], int]
```

### 7.3 `_subtree_member_count`
```python
async def _subtree_member_count(session, org_id: uuid.UUID) -> int
```

### 7.4 `OrganizationRead`（增字段）
```python
subtree_member_count: int  # 当前+所有下级 distinct 成员数
```

### 7.5 前端 `UserListParams` / `OrganizationRead`（增字段）
同 7.1 / 7.4。

## 8. 数据模型

**无表结构变更**。仅 OrganizationRead DTO 增字段（service 注入）。`user_organizations` / `organizations` 表不动。

## 9. 兼容策略（brownfield）

- `organization_id` 未传（默认 None）→ list_users 行为完全不变（全部用户），现有调用方零影响。
- `include_children` 默认 true，但 organization_id 为空时该参数短路无意义。
- `OrganizationRead` 新增 subtree_member_count，旧前端忽略该字段（后端响应多一个字段，前端不读不报错）。
- 现有 `/api/admin/users` 的 q/status/role/sort/order/limit/offset 全保留。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | exists 子查询 + IN 大量 org_id 时性能 | P2 | 组织树通常不深（_descendant_ids BFS 层数有限），数据量小未上线可接受 |
| R-02 | subtree_member_count 每次 list_organizations 对每个 org 算子树（N 次 BFS） | P2 | 组织数量小；未来量大改批量预计算（方案 C） |
| R-03 | disabled 下级组织成员计入父 subtree（UI 不显 disabled 但聚合含） | P2 | 设计明确（D-002）：subtree 按结构聚合，UI 仅显 active |
| R-04 | 前端 flat 组装正确性（多根/环） | P2 | parent_id 自引用无环（update_organization 有环检测）；组装时 visited set 防御 |

## 11. 决策追踪

| 决策 | 覆盖 | 状态 |
|---|---|---|
| D-001@v1 include_children 固定 true | Phase 2/3/6 | accepted |
| D-002@v1 树只显 active、subtree 含 disabled 下级 | Phase 5/6 | accepted |
| D-003@v1 subtree_member_count=distinct user_id | Phase 1/7 | accepted |
| D-004@v1 exists 子查询过滤 | Phase 2 | accepted |
| D-005@v1 实时算不缓存 | Phase 1 | accepted |

## 12. 自审

- **需求覆盖**：10 要求 + 6 验收全覆盖 ✅
- **Grill 覆盖**：D-001~D-005 全引用 ✅
- **约束一致性**：admin schema/service/router 风格一致（裸 Query、_descendant_ids 复用、exists 过滤符合 SQLAlchemy 2.0）；前端复用 layout 组件（CLAUDE.md 规则 15）✅
- **真实性**：表名/字段/类名/方法名来自调研（OrganizationRead schema.py:140-165 / UserQueryParams:247 / list_users users_service.py:85-124 / _descendant_ids organizations_service.py:51-76 / _to_read:100-114 / UserOrganization model.py:83-108 / Organization parent_id model.py:57-64）✅
- **YAGNI**：未加缓存/UI 开关/授权限制/N+1 优化（明确非目标）✅
- **验收标准**：6 条可测试（Phase 7 覆盖）✅
- **非目标清晰** ✅
- **兼容策略**：organization_id 默认 None 零影响 ✅
- **风险识别**：R-01~R-04 ✅
- **生命周期契约表**：不涉及 session/lease/agent_run/daemon/lifecycle 关键词，省略 ✅

自审通过。
