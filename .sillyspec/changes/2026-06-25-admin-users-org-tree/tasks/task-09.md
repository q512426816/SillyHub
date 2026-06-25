---
id: task-09
title: 前端 admin/users page — 组织树筛选（selectedOrgId + 左树右表 + 新建带入）
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
depends_on:
  - task-06
  - task-07
  - task-08
blocks:
  - task-10
requirement_ids:
  - FR-04
  - FR-05
decision_ids:
  - D-001@v1
  - D-002@v1
allowed_paths:
  - frontend/src/app/(dashboard)/admin/users/page.tsx
---

## 1. 目标

给 `/admin/users` 主体加**左侧组织树筛选 + 右侧用户表格**的双栏布局，点击组织节点按「当前组织 + 所有下级」过滤用户列表，新建用户时把选中组织预填进 drawer：

- 新增 `selectedOrgId: string | null`（null = 全部组织）。
- `include_children` **前端固定 true**，由 `load` 直接传 `include_children: true`（D-001）。
- `load` 调 `listUsers({ ..., organization_id: selectedOrgId ?? undefined, include_children: true })`。
- 点树节点：`setSelectedOrgId(id) + setPage(1)` → `load` 依赖变更触发。
- 主体改「左树 + 右表」双栏：左 `<aside className="w-56 shrink-0">` 装 `AdminOrgTree`，右 `<div className="min-w-0 flex-1">` 装现有「查询 SectionCard + DataTable」。
- 右侧顶部显当前筛选：`null` → 「全部组织」；否则「组织名（含下级组织）」。
- 新建用户：`AdminUserDrawer` 传 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}`（依赖 task-08 的 prop）。

本 task **只改 users page.tsx 一个文件**，`AdminOrgTree`（task-07）、`AdminUserDrawer` 的 `defaultOrganizationIds` prop（task-08）、`lib/admin.ts` 类型（task-06）由前置 task 提供。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 6 | +selectedOrgId(null=全部)；include_children 固定 true；load 传 organization_id/include_children；点节点 setSelectedOrgId+setPage(1)；布局 flex 左 aside w-56 右 flex-1；右侧顶部显当前筛选（全部/组织名(含下级组织)）；新建传 defaultOrganizationIds={selectedOrgId?[selectedOrgId]:undefined} |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §11 决策 D-001/D-002 | include_children 固定 true；树只显 active、subtree 含 disabled 下级 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 3 task-09 | dep task-06/07/08；覆盖 FR-04/FR-05 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | 全局验收 AC-01~AC-07 | 点全部/叶子/父组织筛选；树显 subtree_member_count；搜索+状态+组织叠加；新建带入 |
| 现状代码 | `frontend/src/app/(dashboard)/admin/users/page.tsx:88-135` | organizations 已加载（listOrganizations + listRoles），仅用于 drawer；load 现 q/status/limit/offset |
| 现状代码 | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:587-604` | 左树右表布局参考：`<div className="flex gap-4"><aside className="w-56 shrink-0"><SectionCard title=...><Tree .../></SectionCard></aside><div className="min-w-0 flex-1">` |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `frontend/src/app/(dashboard)/admin/users/page.tsx` | +selectedOrgId state；load 增 organization_id/include_children；布局改左树右表双栏；右侧顶部显当前筛选；AdminOrgTree + AdminUserDrawer defaultOrganizationIds 接线 | ✅ |
| `frontend/src/components/admin-org-tree.tsx` | **不改**（task-07 新增） | ❌ |
| `frontend/src/components/admin-user-drawer.tsx` | **不改**（task-08 加 defaultOrganizationIds prop） | ❌ |
| `frontend/src/lib/admin.ts` | **不改**（task-06 增 UserListParams.organization_id/include_children、OrganizationRead.subtree_member_count） | ❌ |

## 4. 实现要求

1. **state 新增**：`const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);`（null = 全部组织，默认全部）。
2. **load 透传组织维度**：`listUsers` 调用增 `organization_id: selectedOrgId ?? undefined`、`include_children: true`；`organization_id` 为 undefined 时后端 organization_id=None 行为不变（AC-09 兼容）。`include_children` **写死 true**，不接 state、不做 UI 开关（D-001）。
3. **load 依赖数组**增 `selectedOrgId`，使点节点后 `useEffect` 自动触发刷新（setSelectedOrgId 改变 → load 重建 → useEffect 重跑）。
4. **点树节点回调**：`const handleOrgSelect = (id: string | null) => { setSelectedOrgId(id); setPage(1); };`（重置到第 1 页，对齐 handleStatusFilterChange 语义）。注意：selectedOrgId 由依赖驱动 load，无需手动 `void load()`。
5. **布局重构**：把现有 `{error ? (...) : (<>查询 SectionCard + DataTable</>)}` 包进 `<div className="flex gap-4">` 的右栏 `<div className="min-w-0 flex-1">`；左栏 `<aside className="w-56 shrink-0">` 装 `<SectionCard title="组织"><AdminOrgTree organizations={organizations} selectedOrgId={selectedOrgId} onSelect={handleOrgSelect} /></SectionCard>`。**左树右表布局只在 error 为 false 的主区生效**；PageHeader / toast / error 时单列保留。`toast` 与 `AdminUserDrawer` 等抽屉仍在最外层 PageContainer 内（双栏之外）。
6. **右侧顶部当前筛选条**：在右栏最上方（查询 SectionCard 之上）加一行小字，`null` → `<span>当前筛选：全部组织</span>`；否则 `<span>当前筛选：{orgName}（含下级组织）</span>`，orgName 从 `organizations` 里按 `selectedOrgId` 查 `name`（查不到回退 id，防极端脏数据）。
7. **新建用户带入**：`AdminUserDrawer` 增 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}`（仅 create 模式生效，edit 模式仍用 user.organizations，由 task-08 prop 内部判定）。其余 drawer props 不变。
8. **import 增**：`AdminOrgTree` from `@/components/admin-org-tree`（task-07 导出）。`OrganizationRead` 类型已 import（现状 line 30）。
9. **不动**现有搜索/状态/分页/编辑/删除/会话/审计/重置密码逻辑（AC-06），仅在外层包双栏 + 新增 state + 接线。
10. **不动** `listOrganizations` / `listRoles` 加载逻辑（organizations 已现成可用，直接喂给 AdminOrgTree）。

## 5. 接口定义

### 5.1 page state（新增 / 改动）

```tsx
const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null); // null = 全部组织

const load = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const params: Parameters<typeof listUsers>[0] = {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      include_children: true, // 固定 true（D-001）
    };
    if (search) params.q = search;
    if (statusFilter !== "all") params.status = statusFilter;
    if (selectedOrgId) params.organization_id = selectedOrgId; // null/undefined → 不传（后端 None 行为不变）
    const resp = await listUsers(params);
    setUsers(resp.items);
    setTotal(resp.total);
  } catch (err) {
    setError(err instanceof ApiError ? err.message : "加载失败");
  } finally {
    setLoading(false);
  }
}, [search, statusFilter, page, pageSize, selectedOrgId]); // 增 selectedOrgId 依赖

const handleOrgSelect = (id: string | null) => {
  setSelectedOrgId(id);
  setPage(1);
};

// 右侧顶部当前筛选文案
const selectedOrgName = selectedOrgId
  ? organizations.find((o) => o.id === selectedOrgId)?.name ?? selectedOrgId
  : null;
const filterLabel = selectedOrgName
  ? `${selectedOrgName}（含下级组织）`
  : "全部组织";
```

### 5.2 布局 JSX 结构（主体区，参考 project-plans:587-604）

```tsx
{error ? (
  <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
    {error}
    <Button size="sm" variant="outline" className="ml-3" onClick={() => void load()}>
      重新加载
    </Button>
  </div>
) : (
  <div className="flex gap-4">
    {/* 左：组织树 */}
    <aside className="w-56 shrink-0">
      <SectionCard title="组织" bodyPadding="p-2">
        <AdminOrgTree
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelect={handleOrgSelect}
        />
      </SectionCard>
    </aside>

    {/* 右：当前筛选 + 查询表单 + 表格 */}
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-xs text-muted-foreground">
        当前筛选：{filterLabel}
      </div>
      <SectionCard bodyPadding="p-2">
        {/* 顶部操作按钮行 + 查询表单 grid-cols-4（现状 line 397-440 原样保留） */}
      </SectionCard>
      <DataTable<UserRead>
        {/* 现状 line 442-463 原样保留 */}
      />
    </div>
  </div>
)}
```

### 5.3 AdminUserDrawer 接线（新增 defaultOrganizationIds prop）

```tsx
<AdminUserDrawer
  open={drawer.open}
  mode={drawer.mode}
  user={drawer.user}
  onClose={() => setDrawer({ open: false, mode: "create" })}
  onSubmit={handleSubmit}
  organizations={organizations}
  roles={roles}
  canWrite={canWrite}
  canLoginManage={canLoginManage}
  currentUserId={currentUserId}
  defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}
/>
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | selectedOrgId=null（默认 / 点「全部组织」） | params 不传 organization_id，listUsers 行为不变（AC-01/AC-09） | page（本 task） |
| B-02 | 点组织节点 | setSelectedOrgId(id) + setPage(1)，依赖驱动 load 重跑 | page（本 task） |
| B-03 | organizations 加载失败（listOrganizations rejected） | 现状已 console.error 不阻塞，AdminOrgTree 收到 `[]` 显示「全部组织」单节点，不影响表格 | page（现状）；AdminOrgTree（task-07） |
| B-04 | selectedOrgId 指向已不存在的组织（脏数据） | `organizations.find` 查不到 name，filterLabel 回退显示 id | page（本 task） |
| B-05 | 切换组织时 page 未重置 | handleOrgSelect 内强制 setPage(1)，避免停留在越页码 | page（本 task） |
| B-06 | search / statusFilter / selectedOrgId 同时变更 | load 依赖数组三者全含，任一变更触发统一刷新 | page（本 task） |
| B-07 | 新建用户时 selectedOrgId=null | defaultOrganizationIds=undefined，drawer create 模式不预填（task-08 默认 `[]`，保持现状） | page（本 task）；drawer（task-08） |
| B-08 | 新建用户时 selectedOrgId 非空 | defaultOrganizationIds=[id]，drawer create 模式预填该组织勾选（AC-07） | page（本 task）；drawer（task-08） |
| B-09 | 编辑用户时 | drawer edit 模式忽略 defaultOrganizationIds，仍用 user.organizations（task-08 prop 内部判定 mode） | drawer（task-08） |
| B-10 | include_children 固定 true | 即使后端默认 true，前端仍显式传，契约清晰（D-001） | page（本 task） |

## 7. 非目标

- 不实现 `include_children` 的 UI 开关（固定 true，D-001）。
- 不做「只看自己组织」的授权限制（保持 `USER_READ` 全可见，design §3 非目标）。
- 不改 `AdminOrgTree` 组件实现（task-07）。
- 不改 `AdminUserDrawer` 实现 / 不动 create 模式 organizationIds 硬编码 `[]` 的预填逻辑（task-08 加 prop）。
- 不改 `lib/admin.ts` 类型 / listUsers 透传（task-06）。
- 不动后端（task-01~05）。
- 不动搜索 / 状态 / 分页 / 编辑 / 删除 / 会话 / 审计 / 重置密码既有逻辑（AC-06）。
- 不做组织树展开态持久化（AdminOrgTree 默认全展开，task-07 内部处理）。

## 8. 参考源码

- `frontend/src/app/(dashboard)/admin/users/page.tsx:88-135`（organizations/roles 加载；现 load 结构）
- `frontend/src/app/(dashboard)/admin/users/page.tsx:94-112`（现 load useCallback + 依赖数组）
- `frontend/src/app/(dashboard)/admin/users/page.tsx:368-465`（现 PageContainer → PageHeader → error/主区 → SectionCard+DataTable 主区结构）
- `frontend/src/app/(dashboard)/admin/users/page.tsx:467-478`（现 AdminUserDrawer 接线，加 defaultOrganizationIds）
- `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:587-604`（左树右表布局参考：`flex gap-4` + `aside w-56 shrink-0` + `min-w-0 flex-1`）
- `frontend/src/lib/admin.ts:66-74`（UserListParams 现状，task-06 增 organization_id/include_children）
- `frontend/src/lib/admin.ts:116-122`（listUsers 现状，task-06 透传）
- `frontend/src/lib/admin.ts:219-231`（OrganizationRead 现状，task-06 增 subtree_member_count）

## 9. TDD 步骤

> page 是 Next Client Component，测试聚焦交互行为（点树筛选 / 新建带入），由 task-10 的 vitest 覆盖。本 task 先让结构正确、tsc/lint 通过，再交 task-10 补测试。

1. **先确认前置依赖可用**：task-06 已让 `UserListParams` 支持 `organization_id/include_children`、`OrganizationRead` 支持 `subtree_member_count`；task-07 已导出 `AdminOrgTree`；task-08 已给 `AdminUserDrawer` 加 `defaultOrganizationIds?: string[]` prop。若任一缺失，本 task 无法编译——按 plan Wave 顺序执行。
2. **改 page.tsx**：按 §5 加 selectedOrgId state、load 透传、handleOrgSelect、双栏布局、filterLabel、drawer 接线。
3. **跑 tsc**：`cd frontend && pnpm exec tsc --noEmit` 确认类型无误（AdminOrgTree props / UserListParams 新字段 / defaultOrganizationIds prop 都能对上）。
4. **跑 lint**：`cd frontend && pnpm lint` 确认无 eslint 告警（unused import、hook 依赖等）。
5. **手测（task-11 浏览器验收）**：点「全部组织」显全部；点叶子组织只显该组织用户；点父组织显含下级；搜索+状态+组织叠加；新建用户选中组织时 drawer 预填该组织。
6. **交 task-10**：写 vitest 用例覆盖点树筛选 / 新建带入（见 task-10 §5）。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | selectedOrgId=null（默认 / 点「全部组织」） | listUsers 不传 organization_id，表格显全部用户（行为与改造前一致） |
| AC-02 | 点叶子组织节点 | setSelectedOrgId(叶子id)+setPage(1)，listUsers 传 organization_id=叶子id&include_children=true，表格只显该组织用户 |
| AC-03 | 点父组织节点（include_children=true） | listUsers 传 organization_id=父id&include_children=true，表格显父+所有下级用户 |
| AC-04 | 树节点显 subtree_member_count（fallback member_count） | AdminOrgTree 节点 title 含人数（由 task-07 渲染，page 仅传 organizations） |
| AC-05 | 同时设 search + statusFilter + selectedOrgId | 三者全进 load 依赖，叠加过滤，listUsers 同时带 q/status/organization_id/include_children |
| AC-06 | 切换组织时 page 不重置 / 重置密码 / 编辑 / 删除 / 会话 / 审计 | handleOrgSelect 强制 setPage(1)；其余功能不受影响（原逻辑保留） |
| AC-07 | selectedOrgId 非空时点「+ 新建用户」 | drawer create 模式 organizationIds 预填 [selectedOrgId]（依赖 task-08），对应组织勾选默认勾上 |
| AC-08 | selectedOrgId=null 时点「+ 新建用户」 | defaultOrganizationIds=undefined，drawer create 模式 organizationIds 默认 `[]`（现状不变） |
| AC-09 | 右侧顶部当前筛选文案 | null→「当前筛选：全部组织」；选中→「当前筛选：组织名（含下级组织）」 |
| AC-10 | `cd frontend && pnpm exec tsc --noEmit` | 无类型错误 |
| AC-11 | `cd frontend && pnpm lint` | 无 eslint 告警 |
| AC-12 | 仅改 `frontend/src/app/(dashboard)/admin/users/page.tsx`，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] selectedOrgId state 新增（null 默认）
- [ ] load 增 organization_id（selectedOrgId ?? undefined）+ include_children 固定 true，依赖数组含 selectedOrgId
- [ ] handleOrgSelect（setSelectedOrgId + setPage(1)）
- [ ] 主体改左树（aside w-56 + SectionCard + AdminOrgTree）右表（flex-1）双栏布局
- [ ] 右栏顶部「当前筛选：全部组织 / 组织名（含下级组织）」
- [ ] AdminUserDrawer 传 defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}
- [ ] §10 AC-01~AC-12 全部通过（AC-01~09 由 task-11 浏览器验收 / task-10 单测覆盖）
- [ ] tsc --noEmit + lint 全绿
- [ ] git diff 仅含一个 allowed_paths 文件
