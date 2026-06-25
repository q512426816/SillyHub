---
id: task-08
title: 前端 admin-user-drawer.tsx — +defaultOrganizationIds prop，create 模式预填 organizationIds
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 0.5
depends_on: []
blocks:
  - task-09
  - task-10
requirement_ids:
  - FR-05
decision_ids: []
allowed_paths:
  - frontend/src/components/admin-user-drawer.tsx
---

## 1. 目标

给 `AdminUserDrawer` 增加 `defaultOrganizationIds?: string[]` prop，使 `/admin/users` 页在选中某个组织节点后新建用户时，drawer 默认带入该组织（design §5 Phase 6 / Design Grill X-001 发现的现状缺陷）：

- 现状：drawer create 模式 `organizationIds` 硬编码 `setOrganizationIds([])`（`admin-user-drawer.tsx:75`），无法从父组件注入默认值。
- 改造：create 模式 useEffect 改为 `setOrganizationIds(defaultOrganizationIds ?? [])`；edit 模式仍用 `user.organizations`（不变）。
- 父组件（task-09）传 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}`，未选组织时不传（保持空）。

本 task **只改 drawer 组件**（props 接口 + create 分支 useEffect），不动 page（task-09）/ lib（task-06）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 6 | AdminUserDrawer 加 `defaultOrganizationIds?: string[]` prop；create 模式 useEffect 预填 `setOrganizationIds(defaultOrganizationIds ?? [])`；edit 模式仍用 user 现有 orgs；users page 传 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §6 文件变更清单 | `admin-user-drawer.tsx` +defaultOrganizationIds prop，create 模式预填（Design Grill X-001） |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 1 task-08 | 覆盖 FR-05, Design Grill X-001；dep — |
| 现状代码 | `frontend/src/components/admin-user-drawer.tsx:14-27` | `AdminUserDrawerProps` 现有字段（open/mode/user/onClose/onSubmit/organizations/roles/canWrite/canLoginManage/currentUserId），无 defaultOrganizationIds |
| 现状代码 | `frontend/src/components/admin-user-drawer.tsx:52` | `const [organizationIds, setOrganizationIds] = useState<string[]>([]);` |
| 现状代码 | `frontend/src/components/admin-user-drawer.tsx:57-78` | useEffect：edit 分支 `setOrganizationIds(user.organizations.map(o => o.id))`（:67）；else（create）分支 `setOrganizationIds([])`（:75），dep `[open, mode, user]` |
| 现状代码 | `frontend/src/components/admin-user-drawer.tsx:34-45` | 组件解构 props，需补 defaultOrganizationIds |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `frontend/src/components/admin-user-drawer.tsx` | `AdminUserDrawerProps` +`defaultOrganizationIds?: string[]`；组件解构补该 prop；useEffect create 分支（else :75）改 `setOrganizationIds(defaultOrganizationIds ?? [])`；useEffect dep 数组补 `defaultOrganizationIds` | ✅ |

## 4. 实现要求

1. 仅改 props 接口 + 组件解构 + useEffect create 分支一行 + useEffect dep 数组，不动其他逻辑（edit 分支、handleSubmit、表单渲染全不变）。
2. `defaultOrganizationIds` 为 Optional：未传 / `undefined` → create 模式 `setOrganizationIds([])`（与现状行为一致，零回归）。父组件 task-09 仅在 `selectedOrgId` 非空时传 `[selectedOrgId]`。
3. useEffect 现有 dep `[open, mode, user]` 必须补 `defaultOrganizationIds`，否则父组件切换选中组织后重开 drawer 不会刷新默认值（React hooks exhaustive-deps 规则）。
4. **edit 模式完全不变**：edit 分支仍 `setOrganizationIds(user.organizations.map(o => o.id))`（:67），`defaultOrganizationIds` 仅对 create 模式生效（语义：新建时带入当前筛选组织；编辑时显示用户真实归属，不受筛选影响）。
5. 不改 `handleSubmit` create 分支对 `organization_ids` 的处理（:113 `if (organizationIds.length) body.organization_ids = organizationIds;`）——预填值会作为初始选中项，用户可在此基础上增删，提交时按当前 `organizationIds` state 走原有逻辑。
6. 不引入新 import（`string[]` 类型已有，无需新依赖）。
7. `defaultOrganizationIds` 与 `organizations`（可选组织全集）是两个不同 prop：前者是默认选中项 id 数组，后者是可选组织清单（用于渲染多选 checkbox）。两者独立，本 task 不动 `organizations`。

## 5. 接口定义（精确到 props + useEffect 改动）

### 5.1 `AdminUserDrawerProps`（增一可选字段）

```ts
export interface AdminUserDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  user?: UserRead;
  onClose: () => void;
  onSubmit: (_body: UserCreateRequest | UserUpdateRequest) => Promise<void>;
  organizations: OrganizationRead[];
  roles: RoleRead[];
  canWrite: boolean;
  canLoginManage: boolean;
  currentUserId: string;
  /** create 模式默认选中的组织 id（来自父组件当前组织树筛选）。
   *  undefined / 未传 → create 模式默认空选中（与现状一致）。
   *  edit 模式忽略此 prop（始终用 user.organizations）。 */
  defaultOrganizationIds?: string[];  // ← 新增
}
```

### 5.2 组件解构（补 prop）

```tsx
export function AdminUserDrawer({
  open,
  mode,
  user,
  onClose,
  onSubmit,
  organizations,
  roles,
  canWrite,
  canLoginManage,
  currentUserId,
  defaultOrganizationIds,  // ← 新增
}: AdminUserDrawerProps) {
```

### 5.3 useEffect create 分支改动（:69-77 else 分支）

```tsx
useEffect(() => {
  if (!open) return;
  setError(null);
  setPassword("");
  if (mode === "edit" && user) {
    setUsername(user.username ?? "");
    setEmail(user.email ?? "");
    setDisplayName(user.display_name ?? "");
    setIsPlatformAdmin(user.is_platform_admin);
    setLoginEnabled(user.login_enabled);
    setOrganizationIds(user.organizations.map((o) => o.id));   // edit 不变
    setRoleIds(user.roles.map((r) => r.id));
  } else {
    setUsername("");
    setEmail("");
    setDisplayName("");
    setIsPlatformAdmin(false);
    setLoginEnabled(true);
    setOrganizationIds(defaultOrganizationIds ?? []);  // ← 由 [] 改为 defaultOrganizationIds ?? []
    setRoleIds([]);
  }
}, [open, mode, user, defaultOrganizationIds]);  // ← dep 补 defaultOrganizationIds
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | create 模式，`defaultOrganizationIds` 未传 | `setOrganizationIds([])`（与现状一致，零回归） | drawer（本 task） |
| B-02 | create 模式，`defaultOrganizationIds=["orgA"]` | `setOrganizationIds(["orgA"])`，drawer 打开时 orgA checkbox 预选中 | drawer（本 task） |
| B-03 | create 模式，`defaultOrganizationIds=["orgA","orgB"]` 多个 | 全部预选中（支持多选带入） | drawer（本 task） |
| B-04 | edit 模式（`mode==="edit" && user`） | `setOrganizationIds(user.organizations.map(o=>o.id))`，**忽略 defaultOrganizationIds**（显示用户真实归属） | drawer（本 task，不变） |
| B-05 | `defaultOrganizationIds` 含一个不在 `organizations` 清单中的 id | 该 id 进入 organizationIds state 但 checkbox 不渲染（找不到对应 org），提交时仍会作为 `organization_ids` 提交（后端校验） | drawer（本 task）；后端校验 |
| B-06 | drawer 打开期间父组件 `defaultOrganizationIds` 变化 | useEffect dep 含 defaultOrganizationIds，会重新触发 reset（含 setPassword("") 等）——但 drawer 打开时父组件通常不变筛选，可接受 | drawer（本 task） |
| B-07 | 父组件传 `defaultOrganizationIds=[]`（显式空数组） | `?? []` 命中空数组，`setOrganizationIds([])`（与 undefined 等效） | drawer（本 task） |

## 7. 非目标

- 不改 edit 模式行为（始终用 user.organizations，不受筛选影响）。
- 不改 `handleSubmit` 对 `organization_ids` 的提交逻辑（:113）。
- 不改 `organizations` prop（可选组织全集，task-09 不动）。
- 不在 drawer 内做组织树展示（仍是扁平 checkbox 多选列表）。
- 不强制 `defaultOrganizationIds` 必须是 `organizations` 子集（B-05 防御在后端）。
- 不改 users page 调用方（task-09 负责 `defaultOrganizationIds={selectedOrgId ? [selectedOrgId] : undefined}`）。

## 8. 参考

- `frontend/src/components/admin-user-drawer.tsx:14-27`（现状：AdminUserDrawerProps）
- `frontend/src/components/admin-user-drawer.tsx:34-45`（现状：组件解构）
- `frontend/src/components/admin-user-drawer.tsx:52`（现状：organizationIds state）
- `frontend/src/components/admin-user-drawer.tsx:57-78`（现状：useEffect，create 分支 :75 硬编码 []）
- `frontend/src/components/admin-user-drawer.tsx:113`（现状：handleSubmit create 分支 organization_ids 处理）
- `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` §5 Phase 6 / §6 文件变更清单（Design Grill X-001）

## 9. TDD 步骤

> 聚焦「create 模式预填 / edit 模式不受影响 / undefined 零回归」。

1. **先写测试**（`frontend/src/components/__tests__/admin-user-drawer.test.tsx` 新增或复用既有测试）：
   - `test_create_mode_prefills_default_org_ids`：渲染 `mode="create"` + `defaultOrganizationIds=["orgA"]` + `open=true`，断言 orgA 对应 checkbox `checked`（或 organizationIds state 含 orgA）。
   - `test_create_mode_undefined_defaults_empty`：渲染 `mode="create"` 不传 `defaultOrganizationIds`，断言无 checkbox 选中（零回归）。
   - `test_create_mode_empty_array_defaults_empty`：渲染 `mode="create"` + `defaultOrganizationIds=[]`，断言无选中。
   - `test_edit_mode_ignores_default_org_ids`：渲染 `mode="edit"` + `user`（organizations=[orgX]）+ `defaultOrganizationIds=["orgA"]`，断言仅 orgX 选中、orgA 不选中（edit 用 user 真实归属）。
   - `test_default_org_ids_change_resets`：先渲染 `defaultOrganizationIds=["orgA"]`，rerender 改为 `["orgB"]`（open=true），断言选中更新为 orgB（dep 生效）。
2. **跑测试**确认全红（prop 未加 / create 分支未改）。
3. **改 drawer**（按 §5 加 prop + 解构 + create 分支 + dep）。
4. **跑测试**确认全绿。
5. `tsc --noEmit` + `eslint` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | create 模式传 `defaultOrganizationIds=["orgA"]` 打开 drawer | orgA checkbox 预选中 |
| AC-02 | create 模式不传 `defaultOrganizationIds` 打开 drawer | 无 checkbox 选中（与改造前一致，零回归） |
| AC-03 | edit 模式传 `defaultOrganizationIds=["orgA"]` + user.organizations=[orgX] | 仅 orgX 选中，orgA 不选中（edit 忽略 defaultOrganizationIds） |
| AC-04 | create 模式预选中后用户取消勾选 orgA 再提交 | 提交 body 不含 organization_ids（或空），走 :113 原逻辑 |
| AC-05 | `defaultOrganizationIds` 变化时 drawer 已打开 | useEffect 重触发，选中项更新（dep 生效） |
| AC-06 | `tsc --noEmit` | 无类型错误 |
| AC-07 | `eslint frontend/src/components/admin-user-drawer.tsx`（含 react-hooks/exhaustive-deps） | 无告警 |
| AC-08 | `git diff --stat` 仅含 `frontend/src/components/admin-user-drawer.tsx` | true |

## 11. 完成定义

- [ ] §5.1 AdminUserDrawerProps 新增 `defaultOrganizationIds?: string[]`
- [ ] §5.2 组件解构补 `defaultOrganizationIds`
- [ ] §5.3 useEffect create 分支改为 `setOrganizationIds(defaultOrganizationIds ?? [])` + dep 补 `defaultOrganizationIds`
- [ ] §9 TDD 测试用例全绿
- [ ] §10 AC-01~AC-08 全部通过
- [ ] `git diff` 仅含 `frontend/src/components/admin-user-drawer.tsx`
