---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-05：admin.ts 清理旧分组数据

## 修改文件

- [ ] 修改 `frontend/src/lib/admin.ts`
- [ ] 修改 `frontend/src/lib/__tests__/admin.test.ts`（同步删除已失效的旧分组断言）

## 必读依据

- 设计文档 §5.6 admin.ts 清理：`F:\WorkNew\SillyHub\.sillyspec\changes\2026-06-18-menu-driven-permissions\design.md`
- 需求 FR-11（grep 全仓无匹配）：`requirements.md`
- plan.md 全局验收 grep 规则：`plan.md`

## 引用扫描结果（执行前 grep）

`Grep "PERMISSION_GROUPS|PermissionGroup|PermissionWithGroup|ALL_PERMISSIONS|GROUP_LABEL" frontend/src/` 命中：

1. `frontend/src/lib/admin.ts`
   - L13 `export type PermissionGroup = ...`
   - L21 `export interface PermissionWithGroup { ... group: PermissionGroup; ... }`
   - L28 `export const PERMISSION_GROUPS: { group: PermissionGroup; permissions: PermissionWithGroup[]; }[]`
   - L525-527 `export async function listPermissions(): Promise<PermissionWithGroup[]>` 内部 `PERMISSION_GROUPS.flatMap(...)`
2. `frontend/src/components/admin-role-permission-picker.tsx`
   - L6-7 import `PERMISSION_GROUPS`, `type PermissionGroup`
   - L17 本地 `const GROUP_LABEL: Record<PermissionGroup, string>`
   - L32-33 `expanded: Set<PermissionGroup>`，`new Set(PERMISSION_GROUPS.map(...))`
   - L36 `toggleGroupExpanded(g: PermissionGroup)`
   - L54 `toggleGroupAll(group: PermissionGroup, ...)`
   - L67 `PERMISSION_GROUPS.map(...)`
   - L96 `GROUP_LABEL[g.group]`
3. `frontend/src/lib/__tests__/admin.test.ts`
   - L5 import `PERMISSION_GROUPS`
   - L564-572 "PERMISSION_GROUPS covers all 6 groups"
   - L574-585 "PERMISSION_GROUPS ADMIN group contains ..."
   - L587-593 "listPermissions returns flat PermissionWithGroup[] ..."

`ALL_PERMISSIONS` / `GROUP_LABEL` 在 `admin.ts` 内不存在（`GROUP_LABEL` 是 picker 本地常量，归属 task-06）。

## 实现要求

**删除清单（admin.ts）**：

- [ ] 删除 L13-19 `export type PermissionGroup = "PLATFORM" | "ADMIN" | ...`
- [ ] 删除 L21-26 `export interface PermissionWithGroup { key; name; group; description? }`
- [ ] 删除 L28-108 `export const PERMISSION_GROUPS: { group; permissions }[]`（含 6 大组数据块）
- [ ] 删除 L525-527 `export async function listPermissions(): Promise<PermissionWithGroup[]>` 整个函数（其返回类型与函数体都依赖已删常量；新数据源已在 task-01 提供 `MENU_PERMISSION_GROUPS`，picker 在 task-06 不再调用本函数）
- [ ] 删除 L11 的 `// ── Permissions ─────────` 分隔注释（仅服务于已删块）

**保留清单（admin.ts 内的 exports，全部不动）**：

- 类型/接口：`OrganizationBrief`、`RoleBrief`、`UserRead`、`UserListResponse`、`UserCreateRequest`、`UserUpdateRequest`、`UserListParams`、`UserSessionRead`、`AuditLogRead`、`UserWorkspaceRead`、`ResetPasswordRequest`、`ResetPasswordResponse`、`RevokeAllResponse`、`OrganizationStatus`、`OrganizationRead`、`OrganizationDetail`、`OrganizationCreateRequest`、`OrganizationUpdateRequest`、`OrganizationListParams`、`Permission`（= string 别名）、`RoleRead`、`RoleListResponse`、`RoleCreateRequest`、`RoleUpdateRequest`、`RoleListParams`、`RoleUserBindingType`、`RoleUserRead`、`RoleUserListResponse`
- API client 函数（共 22 个，函数体不动）：
  - Users：`listUsers` / `getUser` / `createUser` / `updateUser` / `deleteUser` / `listUserSessions` / `revokeUserSession` / `revokeAllUserSessions` / `listUserAudit` / `listUserWorkspaces` / `resetUserPassword` / `disableUserLogin` / `enableUserLogin`
  - Organizations：`listOrganizations` / `getOrganization` / `createOrganization` / `updateOrganization` / `disableOrganization` / `enableOrganization` / `deleteOrganization`
  - Roles：`listRoles` / `getRole` / `createRole` / `updateRole` / `disableRole` / `enableRole` / `deleteRole` / `listRoleUsers`
- `import { apiFetch } from "@/lib/api"` 保留

**测试同步（admin.test.ts）**：

- [ ] 删除 L5 import 中 `PERMISSION_GROUPS,` 行
- [ ] 删除 L564-572 "PERMISSION_GROUPS covers all 6 groups" 测试用例
- [ ] 删除 L574-585 "PERMISSION_GROUPS ADMIN group contains ..." 测试用例
- [ ] 删除 L587-593 "listPermissions returns flat PermissionWithGroup[]" 测试用例
- [ ] 如有 `listPermissions` import 同步移除

## 接口定义

| 变更 | 对外影响 |
|---|---|
| 删除 `PermissionGroup` (type) | picker (task-06) 已切换，不再 import |
| 删除 `PermissionWithGroup` (interface) | 同上 |
| 删除 `PERMISSION_GROUPS` (const) | 同上 |
| 删除 `listPermissions()` | 新数据源在 `menu-permissions.ts`，无外部消费方 |
| 其余 export | 不变，对外 API 无变化 |

## 边界处理

1. **调用方未切换的兜底**：本任务执行时 picker (`admin-role-permission-picker.tsx`) 仍引用旧 export，删除后会触发 typecheck 错误 —— 这是预期行为，本任务不修 picker（task-06 负责）。仅本任务单独完成时 `pnpm typecheck` 会失败，等 task-06 完成后才会通过。
2. **picker 的本地 GROUP_LABEL**：picker 内 `const GROUP_LABEL: Record<PermissionGroup, string>` 是 picker 自有的本地常量，不在 admin.ts 中，本任务不处理，归 task-06。
3. **遗漏引用**：如在 grep 中发现未列出的引用点（如 e2e 文件、其他组件），停下来报告而不擅自修改其他 task 的范围。
4. **ALL_PERMISSIONS / GROUP_LABEL 在 admin.ts 中不存在**：按设计 §5.6 列出的清单是上限，本任务只删实际存在的 3 个 export + 1 个 listPermissions 函数；不创造不存在的删除项。
5. **测试文件孤立删除**：admin.test.ts 中除上述 3 个 PERMISSION_GROUPS 相关用例外，其他 API client 测试（listUsers/createUser 等 mock 用例）全部保留。
6. **注释中的引用**：删除文件头 `// ── Permissions ──` 分隔块注释；其余注释（文件顶部 docstring、API client 注释）保留不动。

## 非目标

- 不修改 `admin-role-permission-picker.tsx`（task-06）
- 不修改 `app-shell.tsx`（task-08）
- 不删除 `hasAdminPermission`（保留 @deprecated，归 task-02）
- 不动 API client 函数体
- 不重命名 DTO interface 字段
- 不动 `Permission = string` 别名（角色权限 key 仍走 string）
- 不补 menu-permissions.ts 内容（task-01）

## TDD 步骤

1. **Grep 确认引用**：`Grep "PERMISSION_GROUPS|PermissionGroup|PermissionWithGroup" frontend/src/`，记录所有命中（已列于上方"引用扫描结果"）。
2. **修改 admin.ts**：删除 3 个 export + `listPermissions` 函数 + 分隔注释。
3. **同步 admin.test.ts**：删除对应 3 个测试用例与相关 import。
4. **跑 typecheck**：在 `frontend/` 下执行 `pnpm typecheck`。预期：若 task-06 未并行完成，将出现 `admin-role-permission-picker.tsx` 的 import / 类型错误（预期失败，不阻断本任务交付）。
5. **跑 test**：在 `frontend/` 下执行 `pnpm test --filter admin.test`，确认 admin.test.ts 剩余用例通过。
6. **联合验收**：等 task-06 切换 picker 数据源后，重跑 typecheck 应全绿。
7. **最终 grep**：`grep -rE "PERMISSION_GROUPS|PermissionGroup|PermissionWithGroup" frontend/src/`，应仅在 `@deprecated` 注释或历史 git log 中残留，源代码内无匹配。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 3 个 export 删除 | `grep -nE "PermissionGroup|PermissionWithGroup|PERMISSION_GROUPS" frontend/src/lib/admin.ts` 无匹配 |
| listPermissions 删除 | `grep -n "listPermissions" frontend/src/lib/admin.ts` 无匹配 |
| API client 保留 | `grep -nE "export (async )?function (listUsers|createUser|listRoles|createRole|listOrganizations)" frontend/src/lib/admin.ts` 5 个函数全部命中 |
| DTO interface 保留 | `grep -nE "export interface (UserRead|RoleRead|OrganizationRead)" frontend/src/lib/admin.ts` 3 个接口全部命中 |
| 测试清理 | `grep -nE "PERMISSION_GROUPS|PermissionGroup|PermissionWithGroup|listPermissions" frontend/src/lib/__tests__/admin.test.ts` 无匹配 |
| 全仓 grep | 除 `@deprecated` 注释外，`grep -rE "PERMISSION_GROUPS\|PermissionGroup\|PermissionWithGroup" frontend/src/` 无匹配（task-06 完成后此条满足） |
| 注释残留 | picker / app-shell 内若仍出现旧名称引用，应同步在 task-06 / task-08 清理；本任务不负责 |
