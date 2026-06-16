---
id: task-09
title: 前端 /admin/roles 页面 + 权限选择器组件
priority: P1
estimated_hours: 5
depends_on: [task-07, task-08]
blocks: [task-12]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/roles/page.tsx
  - frontend/src/components/admin-role-permission-picker.tsx
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-09: 前端 /admin/roles 页面 + 权限选择器组件

实现角色管理页面：列表 + 创建/编辑 Drawer + 删除 confirm，以及独立的权限选择器组件（按 PermissionGroup 折叠分组多选）。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `frontend/src/app/(dashboard)/admin/roles/page.tsx` | 新增 | 完整页面：list + create/edit Drawer + delete confirm dialog + 系统角色保护 UI |
| 2 | `frontend/src/components/admin-role-permission-picker.tsx` | 新增 | 按 PermissionGroup 折叠分组的多选 checkbox 组件 |

## 实现要求

### R-01: roles/page.tsx 页面结构

- `"use client"` 顶级指令
- import：`useEffect` / `useState` / `useSession` / `lib/admin` 的 `listRoles` `createRole` `updateRole` `deleteRole` `disableRole` `enableRole` + types + `AdminRolePermissionPicker` 组件 + shadcn/ui Table/Drawer/Dialog/Button/Badge/Input/Toast
- 三大状态：
  - `roles: RoleRead[]` — 列表数据
  - `loading: boolean` — 拉取状态
  - `drawerState: { open: boolean; mode: "create" | "edit"; role?: RoleRead }` — 编辑抽屉
- 顶部工具栏：搜索框（输入 debounce 500ms 重新拉 list）+ 「新建角色」按钮（仅持 `role:write` 可见/可点）
- 列表表格列：`key`（等宽字体）/ `name` / `is_system` 徽标（系统角色显示灰色「系统」徽标）/ `is_active` 状态徽标 / `user_count`（数字 + 「用户」后缀）/ `permissions` 数量（缩略显示前 3 个 + 「+N more」）/ 操作（编辑 / 禁用/启用 / 删除）
- 操作按钮可见性：
  - 编辑：所有角色可见，但点击系统角色时进入只读模式（仅 description 可改）
  - 禁用/启用：系统角色禁用按钮 + tooltip「系统角色不可禁用」
  - 删除：系统角色禁用按钮 + tooltip「系统角色不可删除」；非系统但 user_count > 0 也禁用 + tooltip「该角色已分配给 N 个用户」
- Drawer 内容（编辑模式）：
  - key 输入框（创建时可编辑，编辑时只读 — 系统角色整体只读除 description）
  - name 输入框（必填，max 50）
  - description 文本域（可选，max 500）
  - 权限选择器 `<AdminRolePermissionPicker permissions={form.permissions} onChange={...} disabled={isSystem} />`
  - 底部「保存」+「取消」（系统角色编辑时仅 description 可改，权限选择器整体禁用）
- 删除 confirm：弹 Dialog 「确定删除角色 {name}？该操作不可恢复。」+ 「确认删除」红色按钮；调用 deleteRole 失败时（409 ROLE_IN_USE）toast 显示「该角色已分配给 {user_count} 个用户，无法删除」

### R-02: admin-role-permission-picker.tsx 组件

- 接收 props：
  ```typescript
  interface AdminRolePermissionPickerProps {
    permissions: Permission[];              // 当前选中
    onChange: (next: Permission[]) => void; // 重写式回调
    disabled?: boolean;                     // 系统角色整体禁用
  }
  ```
- 内部从 `lib/admin` 的 `PERMISSION_GROUPS` 常量获取分组数据（不调用 API，纯前端常量）
- UI 结构：
  - 按 PermissionGroup 渲染折叠面板（Collapsible），每组含一个「全选/全不选」复选框
  - 展开后是该组所有 Permission 的 checkbox 列表
  - 选中状态高亮（背景色变化）
- 交互：
  - 单个 permission checkbox 切换：`onChange(nextPermissions)` 重写式
  - 组级「全选」：组内所有 permission 全选/全不选
  - 父子联动：组内所有 permission 全选时组级 checkbox 显示勾选态

### R-03: 数据流

- 页面 mount → `useEffect` 调 `listRoles(session.accessToken)` → `setRoles(items)`
- 搜索框 onChange debounce 500ms → 重新调 `listRoles(accessToken, {search})`
- 「新建角色」点击 → `setDrawerState({open:true, mode:"create"})`
- Drawer 提交：
  - create 模式 → `createRole(accessToken, body)` 成功后 toast「角色已创建」+ 关闭 Drawer + 重新 list
  - edit 模式 → `updateRole(accessToken, role.id, body)` 成功后 toast「角色已更新」+ 关闭 Drawer + 重新 list
- 删除：confirm dialog 「确认」→ `deleteRole(accessToken, id)` 成功后 toast「角色已删除」+ 重新 list
- 错误处理：catch ApiError → toast.error(`错误：${err.code}` + 中文 message)

### R-04: 权限检查（按钮可见性）

- 写权限检查：`canWrite = user.permissions?.includes("role:write") || user.is_platform_admin`
- 「新建角色」按钮 `disabled={!canWrite}`
- 编辑 Drawer 的「保存」按钮 `disabled={!canWrite}`
- 删除/禁用按钮 `disabled={!canWrite || role.is_system || role.user_count > 0}`

## 接口定义

### 页面组件签名

```typescript
export default function AdminRolesPage(): JSX.Element;
// 内部使用 useSession 获取 accessToken + permissions
// 顶层 export 一个 Next.js page 客户端组件
```

### AdminRolePermissionPicker 组件签名

```typescript
interface AdminRolePermissionPickerProps {
  permissions: Permission[];
  onChange: (next: Permission[]) => void;
  disabled?: boolean;
  className?: string;
}
export function AdminRolePermissionPicker(props: AdminRolePermissionPickerProps): JSX.Element;
```

### 调用的 lib/admin 函数

| 函数 | 触发时机 |
|---|---|
| `listRoles(accessToken, {search, is_active})` | 页面 mount + 搜索 debounce + 增删改后刷新 |
| `createRole(accessToken, body)` | Drawer create 模式提交 |
| `updateRole(accessToken, id, body)` | Drawer edit 模式提交 |
| `deleteRole(accessToken, id)` | confirm dialog 确认 |
| `disableRole(accessToken, id)` / `enableRole(accessToken, id)` | 列表行操作 |

## 边界处理

1. **loading 态**：拉 list 时表格上方显示 spinner + 骨架屏；2 秒内不显示「加载失败」
2. **error 态**：list 拉取失败显示空状态 + 「重新加载」按钮；不展示半截数据
3. **空列表**：roles 长度 0 显示「暂无角色，点击右上角新建」+ 空状态插画
4. **系统角色保护**：is_system=true 角色的「删除/禁用」按钮 disabled + tooltip；编辑 Drawer 仅 description 可改
5. **删除占用拒绝**：deleteRole 抛 409 ROLE_IN_USE → toast `该角色已分配给 ${details.user_count} 个用户，无法删除`；UI 不进入 loading 死循环
6. **权限不足按钮禁用**：无 `role:write` 时所有写按钮 disabled，hover 显示 tooltip「无 role:write 权限」
7. **token 缺失**：useSession().accessToken 为空 → useEffect 跳过拉取（layout 已重定向 login，但兜底防御）
8. **表单校验**：key 必填且 `^[a-z][a-z0-9_]*$` 格式；name 必填 max 50；permission_keys 至少 1 项（避免创建空角色）
9. **Drawer 关闭时表单重置**：open=false 时清空 form state，避免下次打开残留旧数据
10. **搜索 debounce**：输入 500ms 后才触发 listRoles，避免每次按键请求；输入框加载状态独立于表格 loading
11. **permission_keys 数量过多 UX**：列表表格只显示前 3 个 + 「+N more」；Drawer 内 picker 全展开
12. **禁用后再启用**：disableRole 成功后 toast「角色已禁用」；列表 is_active 徽标变灰；enableRole 反之

## 非目标

- 不实现后端 API（task-04 范围）
- 不实现 lib/admin.ts 客户端（task-08 范围）
- 不实现 admin/layout.tsx 鉴权（task-07 范围）
- 不实现角色成员管理页面（仅显示 user_count 数字，不展开成员列表）
- 不实现权限的中文翻译映射表（前端 PERMISSION_GROUPS 已含 name 中文名）
- 不实现审计日志查询 UI（/admin/audit 留待后续变更）
- 不实现角色复制 / 角色导出 / 角色排序

## 参考

- `prototype-admin-center.html` 角色页原型（左侧导航 / 列表 / 编辑 Drawer / 权限分组选择器视觉参考）
- `design.md` §7.1 角色管理接口
- `requirements.md` FR-03 / FR-04 / FR-05 / FR-06 角色管理完整 CRUD + 边界
- `lib/admin.ts` task-08 产出的类型 + 函数
- `(dashboard)/settings/page.tsx` 现有 UsersTab 作为列表 + Drawer 模式参考（结构对称）
- shadcn/ui 现有组件：Table / Drawer / Dialog / Button / Badge / Checkbox / Collapsible / Toast

## TDD 步骤

1. **写组件单测**：`admin-role-permission-picker.test.tsx` 覆盖：
   - 渲染 6 个 group 折叠面板
   - 单个 permission 点击 → onChange 触发，permissions 含新项
   - 组级「全选」点击 → 该组所有 permission 进入/移除 onChange
   - disabled=true 时所有 checkbox disabled
2. **写页面集成测试**：`admin/roles/__tests__/page.test.tsx` 覆盖：
   - mock `lib/admin` 函数 → 渲染页面 → 断言 list 显示
   - 点击「新建」→ Drawer 打开
   - 提交表单 → createRole 被调用 + Drawer 关闭 + listRoles 重新调用
   - 系统角色行「删除」按钮 disabled
   - listRoles 抛 ApiError(403) → 页面显示「重新加载」
3. **跑测试失败**：`pnpm test -- admin-role-picker admin/roles` 全红（组件未实现）
4. **实现 picker 组件**：按 R-02 实现
5. **实现页面**：按 R-01 / R-03 / R-04 实现
6. **跑测试通过**：单测 + 集成测试全绿
7. **手动验证**：本地 `pnpm dev`，用 platform_admin 登录访问 `/admin/roles`：
   - 看到 platform_admin（系统徽标 + 删除禁用）
   - 新建自定义角色（绑定 user:read + organization:read）
   - 编辑该角色改 name + 加 role:read
   - 删除该角色（成功）
   - 删除 platform_admin（按钮 disabled）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 平台管理员访问 `/admin/roles` | 显示角色列表含 platform_admin（系统徽标）+ 任何自定义角色 |
| AC-02 | 点击「新建角色」 | Drawer 打开，含 key/name/description 输入 + 权限选择器（6 个折叠组） |
| AC-03 | 提交合法 body | createRole 调用成功，Drawer 关闭，列表新行出现，toast「角色已创建」 |
| AC-04 | key 输入非法（如 `Role_Key` 或 `1role`） | 表单校验失败，提交按钮 disabled，提示「key 必须以小写字母开头，仅含小写字母/数字/下划线」 |
| AC-05 | 点击系统角色行的「编辑」 | Drawer 打开，key/name/permissions 整体只读，仅 description 可改 |
| AC-06 | 点击系统角色行的「删除」按钮 | 按钮 disabled，hover 显示 tooltip「系统角色不可删除」 |
| AC-07 | 点击系统角色行的「禁用」按钮 | 按钮 disabled，tooltip「系统角色不可禁用」 |
| AC-08 | 点击自定义角色行的「编辑」，改 name + permission_keys | updateRole 调用成功，列表更新，toast「角色已更新」 |
| AC-09 | 点击自定义角色（user_count=0）行的「删除」+ confirm | deleteRole 成功（204），列表行消失，toast「角色已删除」 |
| AC-10 | 点击自定义角色（user_count=2）行的「删除」+ confirm | deleteRole 失败（409 ROLE_IN_USE），toast「该角色已分配给 2 个用户，无法删除」 |
| AC-11 | 权限选择器「全选 ADMIN 组」 | ADMIN 组所有 permission 进入 form.permissions，组级 checkbox 勾选 |
| AC-12 | 权限选择器再次点击「全选 ADMIN 组」 | ADMIN 组所有 permission 从 form.permissions 移除 |
| AC-13 | 无 role:write 权限的用户访问页面 | 列表可见（持 role:read），「新建/编辑/删除/禁用」按钮全部 disabled |
| AC-14 | 搜索框输入「admin」+ debounce 500ms | listRoles 调用含 `search=admin`，列表过滤 |
| AC-15 | 列表 listRoles 失败（如网络中断） | 显示「加载失败，点击重试」+ 「重新加载」按钮，点击后重试 |
| AC-16 | `pnpm test -- admin-role-picker admin/roles` | 全部测试绿 |
| AC-17 | `pnpm typecheck` + `pnpm build` | 0 错误 |
| AC-18 | 空列表场景（无任何角色） | 显示空状态插画 + 「点击右上角新建角色」文案 |
