---
id: task-11
title: 前端 /admin/users 页面 + 用户编辑 Drawer 组件
priority: P1
estimated_hours: 6
depends_on: [task-07, task-08]
blocks: [task-12]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/users/page.tsx
  - frontend/src/components/admin-user-drawer.tsx
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-11: 前端 /admin/users 页面 + 用户编辑 Drawer 组件

实现用户管理页面：列表 + 搜索 + 筛选 + 编辑 Drawer（含组织/角色多选 + 登录权限开关 + is_platform_admin 开关）。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `frontend/src/app/(dashboard)/admin/users/page.tsx` | 新增 | 完整页面：list + 搜索 + status 筛选 + 创建/编辑 Drawer + 删除 + 重置密码 + 禁用/启用登录 + sessions/audit 子视图 |
| 2 | `frontend/src/components/admin-user-drawer.tsx` | 新增 | 用户编辑 Drawer：基础信息 + 组织多选 + 角色多选 + 登录权限开关 + is_platform_admin 开关 |

## 实现要求

### R-01: users/page.tsx 页面结构

- `"use client"` 顶级指令
- import：`useEffect` / `useState` / `useSession` / `lib/admin` 的全部 user 函数 + `AdminUserDrawer` + shadcn/ui 组件
- 主要状态：
  - `users: UserRead[]` + `total: number` + `page: number` + `size: number` + `q: string` + `statusFilter: string`
  - `drawerState: { open: boolean; mode: "create" | "edit"; user?: UserRead }`
  - `auditUserId: string | null` — 当前打开 audit 抽屉的用户 id
  - `sessionsUserId: string | null` — 当前打开 sessions 抽屉的用户 id
- 顶部工具栏：
  - 搜索框（按 email/display_name 模糊匹配，debounce 500ms）
  - status 筛选 select（all / active / disabled）
  - 「新建用户」按钮（持 `user:write` 可见）
- 列表表格列：
  - `email`（点击行进入详情编辑）
  - `display_name`
  - `is_platform_admin` 徽标（金色「超管」）
  - `organizations`（前 2 个 + 「+N」）
  - `roles`（前 2 个 + 「+N」）
  - `login_enabled` 徽标（绿色「可登录」/ 红色「已禁用」）
  - `last_login_at`（相对时间）
  - 操作下拉：编辑 / 重置密码 / 禁用登录 / 启用登录 / 查看 sessions / 查看审计 / 删除
- 分页：底部 Pagination（page + size 选项）
- 删除 confirm：「确定删除用户 {email}？该操作会撤销所有 sessions，不可恢复。」
- 重置密码 confirm：「确定重置 {email} 的密码？系统会生成新密码并显示一次。」→ 成功后弹 Dialog 显示新生成的明文密码 + 复制按钮
- 禁用登录 confirm：「确定禁用 {email} 的登录权限？该操作会立即撤销该用户所有活跃 sessions。」

### R-02: admin-user-drawer.tsx 组件

- 接收 props：
  ```typescript
  interface AdminUserDrawerProps {
    open: boolean;
    mode: "create" | "edit";
    user?: UserRead;                          // edit 模式传入
    onClose: () => void;
    onSubmit: (body: UserCreateRequest | UserUpdateRequest) => Promise<void>;
    organizations: OrganizationRead[];        // 可选组织列表
    roles: RoleRead[];                        // 可选角色列表
    canWrite: boolean;
    canLoginManage: boolean;
    currentUserId: string;                    // 用于自保护提示
  }
  ```
- 表单字段：
  - email（必填，edit 模式只读）
  - password（create 必填 min 8；edit 模式不显示，密码管理走 reset-password）
  - display_name（可选 max 100）
  - is_platform_admin 开关（Switch）
  - login_enabled 开关（Switch）
  - organizations 多选（Checkbox 列表或 MultiSelect；显示 name + code，选中态高亮）
  - roles 多选（同上；显示 key + name）
- 提交校验：
  - create：email + password 必填且格式合法
  - edit：仅传变更字段（react-hook-form + dirtyFields 优化）
- 自保护提示：如 `user.id === currentUserId`，显示警告 banner「您正在编辑自己，部分操作受限」+ 「禁用登录」「关闭 is_platform_admin」按钮 disabled + tooltip 提示

### R-03: 数据流

- 页面 mount → `listUsers(accessToken, {page, size, q, status})` → setUsers + setTotal
- 搜索 debounce 500ms → setPage(1) + 重新 list
- status 筛选变化 → setPage(1) + 重新 list
- 分页变化 → 重新 list
- 「新建用户」→ `setDrawerState({open:true, mode:"create"})`
- Drawer 提交：
  - create → `createUser(accessToken, body)` → toast「用户已创建」+ 关闭 + 重新 list
  - edit → `updateUser(accessToken, user.id, body)` → toast「用户已更新」+ 关闭 + 重新 list
- 删除：confirm → `deleteUser(accessToken, id)` → 成功 toast「用户已删除」+ 重新 list；失败（403 USER_SELF_DELETE_FORBIDDEN）→ toast「不能删除自己」
- 重置密码：confirm → `resetUserPassword(accessToken, id)` → 成功后弹密码 Dialog 显示 `response.password`
- 禁用/启用登录：confirm → `disableUserLogin(accessToken, id)` / `enableUserLogin(accessToken, id)` → 成功 toast + 重新 list；失败（403 USER_SELF_DISABLE_LOGIN_FORBIDDEN / USER_LAST_ADMIN_PROTECTED）→ toast 显示具体原因
- 查看 sessions：行操作点击 → setSessionsUserId(id) → Drawer 显示该用户的 sessions 列表（调 listUserSessions）+ 每行可「撤销」（revokeUserSession）+ 顶部「全部撤销」（revokeAllUserSessions）
- 查看审计：行操作点击 → setAuditUserId(id) → Drawer 显示该用户的审计日志（调 listUserAudit）

### R-04: 权限检查

- `canWrite = user.permissions?.includes("user:write") || user.is_platform_admin`
- `canLoginManage = user.permissions?.includes("user:login_manage") || user.is_platform_admin`
- 「新建用户」「编辑」「删除」「重置密码」 → disabled={!canWrite}
- 「禁用/启用登录」 → disabled={!canLoginManage}
- 「查看 sessions」「查看审计」 → 持 user:read 即可（默认持 user:read 才能进页面）

## 接口定义

### 页面组件签名

```typescript
export default function AdminUsersPage(): JSX.Element;
```

### AdminUserDrawer 组件签名

```typescript
interface AdminUserDrawerProps { /* 见 R-02 */ }
export function AdminUserDrawer(props: AdminUserDrawerProps): JSX.Element;
```

### 调用的 lib/admin 函数

| 函数 | 触发时机 |
|---|---|
| `listUsers(accessToken, {q, status, page, size})` | 页面 mount + 搜索/筛选/分页变化 + 增删改后刷新 |
| `getUser(accessToken, id)` | 行点击进入详情编辑前预拉（如 list 已含完整字段则可省） |
| `createUser(accessToken, body)` | Drawer create 提交 |
| `updateUser(accessToken, id, body)` | Drawer edit 提交 |
| `deleteUser(accessToken, id)` | 删除 confirm |
| `resetUserPassword(accessToken, id)` | 重置密码 confirm |
| `disableUserLogin(accessToken, id)` / `enableUserLogin(accessToken, id)` | 行操作 |
| `listUserSessions(accessToken, id)` | sessions Drawer 打开 |
| `revokeUserSession(accessToken, uid, sid)` | sessions Drawer 单条撤销 |
| `revokeAllUserSessions(accessToken, uid)` | sessions Drawer 全部撤销 |
| `listUserAudit(accessToken, id)` | audit Drawer 打开 |
| `listUserWorkspaces(accessToken, id)` | audit Drawer 内显示用户工作区归属（可选） |
| `listOrganizations(accessToken)` | 页面 mount 预拉（给 Drawer 的 organizations 选项） |
| `listRoles(accessToken)` | 页面 mount 预拉（给 Drawer 的 roles 选项） |

## 边界处理

1. **loading 态**：list 拉取时表格显示骨架屏；Drawer 提交时按钮 loading + 禁用关闭
2. **error 态**：list 失败显示「重新加载」按钮；Drawer 提交失败 toast 错误码 + 中文 message
3. **空列表**：users 长度 0 显示空状态「暂无用户，点击右上角新建」
4. **自保护 - 删除自己**：deleteUser 抛 403 USER_SELF_DELETE_FORBIDDEN → toast「不能删除自己」
5. **自保护 - 禁用自己登录**：disableUserLogin 抛 403 USER_SELF_DISABLE_LOGIN_FORBIDDEN → toast「不能禁用自己的登录权限」
6. **最后管理员保护**：updateUser 抛 403 USER_LAST_ADMIN_PROTECTED → toast「系统至少需要保留一个平台管理员」
7. **组织/角色多选 None vs []**：
   - Drawer 编辑模式：organizations/roles 字段不勾选（dirty=false） → updateUser body 不含该字段（保持不变）
   - Drawer 编辑模式：字段全清空（dirty=true + 空数组） → updateUser body 含 `organization_ids: []`（清空）
   - Drawer 编辑模式：选 [a, b] → 含 `organization_ids: [a, b]`（替换）
8. **重置密码成功后明文密码只显示一次**：Dialog 显示新生成密码 + 「复制」按钮 + 关闭后不再可访问
9. **禁用登录后 sessions 立即失效**：disableUserLogin 返回后，sessions Drawer 重新打开应显示空列表（如已是同会话）
10. **当前用户编辑自己时的受限提示**：Drawer 内 banner + 「禁用登录」「关闭 is_platform_admin」按钮 disabled
11. **email 重复**：createUser 抛 422 → toast `email "${values.email}" 已存在` + email 字段标红
12. **password 强度不足**：createUser 表单 password < 8 字符 → 表单校验失败 + 提示「密码至少 8 位」
13. **分页边界**：page 超过 total/size 时自动回退到最后一页
14. **筛选 status=all**：传给后端的 status 参数为 undefined（不传），不是字符串 "all"
15. **organizations/roles 预拉失败**：Drawer 内多选组件显示「加载失败」+ 空选项；不阻塞主流程
16. **session 撤销后实时刷新**：revokeUserSession 成功后立刻重新 listUserSessions

## 非目标

- 不实现后端 API（task-06 范围）
- 不实现 lib/admin.ts 客户端（task-08 范围）
- 不实现 admin/layout.tsx 鉴权（task-07 范围）
- 不实现邀请用户邮件流程（仅管理员手动创建）
- 不实现批量操作（批量禁用/批量删除/批量分配角色）
- 不实现 CSV 导入 / 导出
- 不实现 MFA / OAuth / SSO 配置 UI
- 不实现用户头像上传

## 参考

- `prototype-admin-center.html` 用户页原型
- `design.md` §7.3 用户管理接口
- `requirements.md` FR-10 / FR-11 / FR-12 用户管理完整 CRUD + 自保护 + 登录权限
- 现有 `(dashboard)/settings/page.tsx` 的 UsersTab + UserDetailDrawer（task-07 会删除，但可作为 UI 模式参考，本任务升级）
- `lib/admin.ts` task-08 产出的类型 + 函数
- shadcn/ui Table / Drawer / Dialog / Switch / MultiSelect / Pagination / Form 现有组件
- react-hook-form + zod 表单校验（项目现有惯例）

## TDD 步骤

1. **写 Drawer 组件单测**：`admin-user-drawer.test.tsx` 覆盖：
   - create 模式渲染 email + password 字段
   - edit 模式 password 字段隐藏
   - 组织多选 + 角色多选交互
   - is_platform_admin / login_enabled Switch 切换
   - 自保护场景（user.id === currentUserId）：禁用登录 / 关闭 is_platform_admin 按钮 disabled
   - 表单校验：email 空 / password < 8 → 提交按钮 disabled
2. **写页面集成测试**：`admin/users/__tests__/page.test.tsx` 覆盖：
   - mock listUsers 返回 5 用户 → 渲染列表
   - 搜索 debounce → listUsers 含 q 参数
   - 点击「新建用户」→ Drawer 打开
   - 提交 createUser → 成功后 toast + 重新 list
   - 删除自己 → mock 返回 403 → toast「不能删除自己」
   - 禁用自己登录 → mock 返回 403 → toast「不能禁用自己」
   - 重置密码 → mock 返回 {password:"abc"} → Dialog 显示明文密码
   - 分页边界：page 超过 total/size 自动回退
3. **跑测试失败**：`pnpm test -- admin-user-drawer admin/users` 全红
4. **实现 Drawer 组件**：按 R-02
5. **实现页面**：按 R-01 / R-03 / R-04
6. **跑测试通过**：所有测试绿
7. **手动验证**：`pnpm dev`，platform_admin 登录：
   - 创建新用户 alice（绑定组织 + 角色）
   - 编辑 alice（改 display_name + 调整角色）
   - 重置 alice 密码 → 复制新密码 → 用新密码登录 alice
   - 禁用 alice 登录 → alice 当前 sessions 全部失效
   - 用 alice 旧 token 调 /api/auth/me → 401
   - 启用 alice 登录 → alice 可重新登录
   - 删除自己 → 失败
   - 关闭自己的 is_platform_admin（最后一个 admin）→ 失败

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 访问 `/admin/users` | 显示用户列表 + 分页 + 搜索框 + status 筛选 + 「新建用户」按钮 |
| AC-02 | 点击「新建用户」 | Drawer 打开，含 email/password/display_name/is_platform_admin/login_enabled/organizations/roles 字段 |
| AC-03 | 提交合法 body（含 organizations/roles） | createUser 成功，列表新行出现，toast「用户已创建」 |
| AC-04 | 搜索框输入「alice」+ debounce 500ms | listUsers 含 `q=alice`，列表过滤 |
| AC-05 | status 筛选切换到「已禁用」 | listUsers 含 `status=disabled`，仅显示禁用用户 |
| AC-06 | 点击行进入编辑 Drawer | 显示该用户当前组织/角色/登录权限状态 |
| AC-07 | 编辑时清空所有组织 + 提交 | updateUser body 含 `organization_ids: []`，响应 organizations 为空 |
| AC-08 | 编辑时新增一个角色 | updateUser body 含 `role_ids: [roleId]`，响应 roles 含该项 |
| AC-09 | 点击自己行的「删除」+ confirm | 失败 403 + toast「不能删除自己」 |
| AC-10 | 点击自己行的「禁用登录」+ confirm | 失败 403 + toast「不能禁用自己」 |
| AC-11 | 编辑自己时关闭 is_platform_admin（自己是最后一个 admin） | 失败 403 + toast「系统至少需要保留一个平台管理员」 |
| AC-12 | 点击 alice 行的「重置密码」+ confirm | 弹 Dialog 显示新明文密码 + 复制按钮 + 关闭后不可再访问 |
| AC-13 | 点击 alice 行的「禁用登录」+ confirm | 成功 + alice 的 sessions 全部失效（再调 /api/auth/me 返回 401） |
| AC-14 | 点击 alice 行的「查看 sessions」 | Drawer 打开显示 sessions 列表（按当前 DB 状态） |
| AC-15 | 在 sessions Drawer 内点击单条「撤销」 | revokeUserSession 调用，列表实时刷新 |
| AC-16 | 在 sessions Drawer 内点击「全部撤销」 | revokeAllUserSessions 调用，列表清空 |
| AC-17 | 点击「查看审计」 | Drawer 打开显示该用户相关的 audit_logs |
| AC-18 | 无 user:write 的用户访问 | 列表可见，写按钮全部 disabled |
| AC-19 | 无 user:login_manage 的用户访问 | 「禁用/启用登录」按钮 disabled |
| AC-20 | 分页 page 超过 total/size | 自动回退到最后一页 |
| AC-21 | createUser 返回 422（email 重复） | toast `email "xxx" 已存在` + email 字段标红 |
| AC-22 | password 输入 < 8 字符 | 表单校验失败，提交按钮 disabled + 提示「密码至少 8 位」 |
| AC-23 | `pnpm test -- admin-user-drawer admin/users` | 全部测试绿 |
| AC-24 | `pnpm typecheck` + `pnpm build` | 0 错误 |
