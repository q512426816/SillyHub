---
id: task-04
title: 前端 API 客户端 + 操作列简化
priority: P0
estimated_hours: 1
depends_on: [task-01, task-02, task-03]
blocks: [task-05]
author: WhaleFall
created_at: "2026-06-10T11:45:44"
allowed_paths:
  - frontend/src/lib/settings.ts
  - frontend/src/app/(dashboard)/settings/page.tsx
---

# task-04: 前端 API 客户端 + 操作列简化

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `frontend/src/lib/settings.ts` | 新增 3 个 API 函数 + 1 个接口 + 扩展 resetUserPassword 签名 |
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` | 操作列从 3 个按钮简化为 1 个"详情"链接；删除 handleToggleAdmin / handleToggleStatus / handleDelete 及其引用 |

## 实现要求

### R-01: settings.ts — 新增 UserWorkspaceRead 接口

在文件 `UserSessionRead` 接口之后新增：

```typescript
export interface UserWorkspaceRead {
  workspace_name: string;
  workspace_slug: string;
  role_name: string;
}
```

### R-02: settings.ts — 新增 revokeSession 函数

```typescript
export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await apiFetch(`/api/users/${userId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}
```

### R-03: settings.ts — 新增 revokeAllSessions 函数

```typescript
export interface RevokeAllResponse {
  revoked_count: number;
}

export async function revokeAllSessions(
  userId: string,
): Promise<RevokeAllResponse> {
  return apiFetch<RevokeAllResponse>(
    `/api/users/${userId}/sessions/revoke-all`,
    { method: "POST" },
  );
}
```

### R-04: settings.ts — 新增 listUserWorkspaces 函数

```typescript
export async function listUserWorkspaces(
  userId: string,
): Promise<UserWorkspaceRead[]> {
  return apiFetch<UserWorkspaceRead[]>(`/api/users/${userId}/workspaces`);
}
```

### R-05: settings.ts — 扩展 resetUserPassword 签名

将现有 `resetUserPassword` 函数签名从：

```typescript
export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void>
```

改为：

```typescript
export async function resetUserPassword(
  userId: string,
  newPassword: string,
  forceChangeOnNextLogin: boolean = false,
): Promise<void> {
  await apiFetch(`/api/users/${userId}/reset-password`, {
    method: "POST",
    json: {
      new_password: newPassword,
      force_change_on_next_login: forceChangeOnNextLogin,
    },
  });
}
```

注意：第三个参数带默认值 `false`，所有现有调用点无需修改。

### R-06: page.tsx — 操作列简化

**删除以下 3 个 handler 函数**（约在原文件 line 206-233）：

- `handleToggleAdmin` — 整个函数删除
- `handleToggleStatus` — 整个函数删除
- `handleDelete` — 整个函数删除

**修改 `<tbody>` 内操作列的 `<td>` 内容**。

将：

```tsx
<td className="text-right">
  <div className="flex items-center justify-end gap-2">
    <button
      className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      onClick={() => void handleToggleAdmin(u)}
    >
      {u.is_platform_admin ? "取消管理员" : "设为管理员"}
    </button>
    <button
      className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      onClick={() => void handleToggleStatus(u)}
    >
      {u.status === "active" ? "禁用" : "启用"}
    </button>
    <button
      className="text-[11px] text-destructive hover:underline"
      onClick={() => void handleDelete(u)}
    >
      删除
    </button>
  </div>
</td>
```

替换为：

```tsx
<td className="text-right">
  <button
    className="text-[11px] text-primary hover:underline"
    onClick={(e) => {
      e.stopPropagation();
      setSelectedUser(u);
    }}
  >
    详情
  </button>
</td>
```

**注意**：整行 `<tr>` 原有的 `onClick={() => setSelectedUser(u)}` 保持不变（点击行也能打开 Drawer）。操作列的"详情"按钮使用 `e.stopPropagation()` 避免与行点击重复触发。

### R-07: page.tsx — 清理未使用的 import

删除 handler 后，以下 import 可能变为未使用，需要从 import 语句中移除：

- `deleteUser` — 不再使用（从 import 中移除，但 `updateUser` 仍保留给后续 task-05 的 Drawer 内操作使用）

检查 `listUsers` 等是否仍在使用，保留所有仍被引用的 import。

同时删除 `updateUser` 的 import 吗？**不删除**。`updateUser` 在 page.tsx 中暂时没有直接使用，但 task-05 将在 Drawer 中使用它。为避免 task-05 需要修改 import，**保留 `updateUser` import**。

实际确认：当前 `updateUser` 在 `handleToggleAdmin` 和 `handleToggleStatus` 中使用。删除这两个 handler 后，`updateUser` 在 page.tsx 中不再被使用。但考虑到 task-05 会立即重新使用它，这里有两个选择：
- 选择 A：保留 import，tsc 可能有 unused 警告
- 选择 B：移除 import，task-05 再加回来

**采用选择 B**：移除当前未使用的 `updateUser` import。保持代码干净，task-05 会重新添加。同理，`deleteUser` 也移除。

最终 import 行应只保留实际被引用的符号：

```typescript
import {
  createUser,
  listSettings,
  listUserAudit,
  listUserSessions,
  listUsers,
  resetUserPassword,
  updateSettings,
  type AuditLogRead,
  type UserRead,
  type UserListResponse,
  type UserSessionRead,
} from "@/lib/settings";
```

注意：`UserListResponse` 实际也未在 page.tsx 中直接使用（`listUsers` 返回类型已内联推断），但原始代码已有此 import，保持不变。

## 接口定义（代码类任务必填）

### TypeScript 接口

```typescript
// settings.ts 新增
export interface UserWorkspaceRead {
  workspace_name: string;
  workspace_slug: string;
  role_name: string;
}

export interface RevokeAllResponse {
  revoked_count: number;
}
```

### 函数签名

```typescript
// 新增
export async function revokeSession(userId: string, sessionId: string): Promise<void>
export async function revokeAllSessions(userId: string): Promise<RevokeAllResponse>
export async function listUserWorkspaces(userId: string): Promise<UserWorkspaceRead[]>

// 修改（新增第三个参数，带默认值）
export async function resetUserPassword(
  userId: string,
  newPassword: string,
  forceChangeOnNextLogin: boolean = false,
): Promise<void>
```

### 后端端点对照

| 前端函数 | HTTP 方法 | 后端端点 | 返回类型 |
|----------|-----------|----------|----------|
| `revokeSession` | DELETE | `/api/users/{user_id}/sessions/{session_id}` | 204 → void |
| `revokeAllSessions` | POST | `/api/users/{user_id}/sessions/revoke-all` | `{ revoked_count: int }` |
| `listUserWorkspaces` | GET | `/api/users/{user_id}/workspaces` | `[{ workspace_name, workspace_slug, role_name }]` |
| `resetUserPassword` | POST | `/api/users/{user_id}/reset-password` | 200 → void |

## 边界处理（必填）

1. **null/空值行为**：`UserWorkspaceRead` 的三个字段均为 `string`，后端保证非空。若用户不属于任何 Workspace，`listUserWorkspaces` 返回空数组 `[]`，前端直接渲染空列表即可，无需特殊处理。

2. **兼容旧行为**：`resetUserPassword` 新增 `forceChangeOnNextLogin` 参数带默认值 `false`，现有所有调用点（page.tsx 中的 Drawer 密码重置）无需修改即可保持原有行为。后端 `force_change_on_next_login` 字段也是可选（默认 False），前后端双向兼容。

3. **异常不静默吞掉**：所有新增 API 函数（`revokeSession`、`revokeAllSessions`、`listUserWorkspaces`）直接委托给 `apiFetch`，后者在网络错误或非 2xx 响应时抛出 `ApiError`。新增函数不做 try/catch，由调用方处理异常。page.tsx 中的调用方（task-05 Drawer）负责 catch 并展示错误。

4. **不修改传入参数**：所有新增函数只读取 `userId`、`sessionId` 等字符串参数，不做任何修改。`resetUserPassword` 构造新的 JSON 对象传给 `apiFetch`，不修改传入的 `newPassword` 字符串。

5. **操作列无权限可见性判断**：当前简化方案中，"详情"按钮对所有用户行统一展示，不做前端权限隐藏。权限控制在后端 API 层面保障（非 admin 调用会被 403）。后续如需根据当前登录用户角色决定是否显示操作列，属于独立需求。

6. **userId/sessionId 为空字符串**：若传入空字符串，URL 变为 `/api/users//sessions/`，后端返回 404，`apiFetch` 抛出 `ApiError(404, ...)`。前端不做额外校验，由后端兜底。

7. **revokeAllSessions 返回 revoked_count = 0**：当目标用户没有活跃会话时，后端返回 `{ revoked_count: 0 }`，前端正常渲染数字 0，不需要特殊提示。

## 非目标（本任务不做的事）

- **不修改 Drawer 内部逻辑**：Drawer 内的"所属 Workspace" Tab、会话撤销按钮、密码 `force_change` 复选框属于 task-05
- **不新增 Drawer Tab**：`DrawerTab` 类型保持 `"info" | "sessions" | "audit"`，task-05 会扩展为加入 `"workspace"`
- **不修改后端**：后端端点由 task-01/02/03 实现
- **不修改 apiFetch**：底层数据获取层不变
- **不处理 `revokeSession` / `revokeAllSessions` / `listUserWorkspaces` 的调用方逻辑**：这些函数在本任务中只定义和导出，task-05 在 Drawer 中使用

## 参考

- 现有 `listUserSessions` / `deleteUser` 函数的 `apiFetch` 调用模式，直接照搬
- 操作列简化参考 design.md 决策 5："用户列表操作列：只保留'详情'链接，点击打开 Drawer"

## TDD 步骤

1. **写测试**（settings.ts 相关）：
   - 由于 `settings.ts` 的函数是对 `apiFetch` 的薄封装，且 `apiFetch` 依赖浏览器/网络环境，本任务不做单元测试 mock。通过手动验证 API 调用确认正确性。
   - 如果项目有 API client 测试惯例，可添加 `revokeSession` / `revokeAllSessions` / `listUserWorkspaces` 的 mock 测试。

2. **确认失败**：运行 `npx tsc --noEmit`，确认新增接口和函数未实现前会导致类型错误。

3. **写代码**：按 R-01 ~ R-07 逐一实现。

4. **确认通过**：运行 `npx tsc --noEmit`，零类型错误。运行 `npx next lint`（如已配置），零 lint 错误。

5. **回归**：确认现有用户列表页面正常加载，点击用户行打开 Drawer，Drawer 内 Tab 切换正常，密码重置功能正常（`forceChangeOnNextLogin` 默认 `false` 不影响现有行为）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | 运行 `npx tsc --noEmit` | 零类型错误 |
| AC-02 | 打开设置页 → 用户管理 Tab | 用户列表正常加载，每行只有邮箱、显示名、角色、状态、最后登录、操作列 |
| AC-03 | 查看操作列 | 每行操作列只显示"详情"链接，不显示"取消管理员/设为管理员"、"禁用/启用"、"删除"按钮 |
| AC-04 | 点击用户行任意位置（非操作列） | Drawer 正常打开 |
| AC-05 | 点击"详情"链接 | Drawer 正常打开，不触发两次 |
| AC-06 | 检查 settings.ts 导出 | `revokeSession`、`revokeAllSessions`、`listUserWorkspaces` 三个函数存在且签名正确 |
| AC-07 | 检查 settings.ts 导出 | `UserWorkspaceRead`、`RevokeAllResponse` 两个接口存在且字段匹配设计文档 |
| AC-08 | 检查 resetUserPassword 签名 | 第三个参数 `forceChangeOnNextLogin: boolean = false`，默认值 `false` |
| AC-09 | 打开 Drawer → 密码重置功能正常 | 输入新密码 → 重置成功，行为与修改前一致（`force_change_on_next_login` 默认不勾选） |
| AC-10 | 确认代码中无 `handleToggleAdmin` / `handleToggleStatus` / `handleDelete` 函数 | 这三个函数已被删除 |
| AC-11 | 确认 `deleteUser` 不在 page.tsx import 中 | import 清理完毕 |
