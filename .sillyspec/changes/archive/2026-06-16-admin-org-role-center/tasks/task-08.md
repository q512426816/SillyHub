---
id: task-08
title: 前端 admin API 客户端 lib/admin.ts + 单元测试
priority: P0
estimated_hours: 4
depends_on: [task-06]
blocks: [task-09, task-10, task-11]
allowed_paths:
  - frontend/src/lib/admin.ts
  - frontend/src/lib/__tests__/admin.test.ts
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-08: 前端 admin API 客户端 lib/admin.ts + 单元测试

封装 `lib/admin.ts`，对 task-04/05/06 已注册的 `/api/admin/{users,organizations,roles}` 端点提供类型化客户端，并写 Vitest 单元测试。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `frontend/src/lib/admin.ts` | 新增 | 完整 admin API 客户端：TypeScript 类型 + 28 个函数（users 13 / organizations 7 / roles 7 / permissions 1） |
| 2 | `frontend/src/lib/__tests__/admin.test.ts` | 新增 | Vitest 单元测试，覆盖每个函数的成功路径 + 错误路径（401/403/404/409/422）+ fetch mock |

## 实现要求

### R-01: 类型定义（lib/admin.ts 顶部）

```typescript
// ============ Permissions ============
export type Permission =
  | "platform:admin" | "user:read" | "user:write" | "user:login_manage"
  | "organization:read" | "organization:write"
  | "role:read" | "role:write"
  | "workspace:read" | "workspace:write" | "workspace:create"
  // ... 其余 25 项（与 backend Permission 枚举一一对应）
  ;

export type PermissionGroup = "PLATFORM" | "ADMIN" | "WORKSPACE" | "AGENT" | "CHANGE" | "AUDIT";

export interface PermissionWithGroup {
  key: Permission;
  name: string;
  group: PermissionGroup;
  description?: string;
}

// ============ Users ============
export interface OrganizationBrief { id: string; name: string; code: string; }
export interface RoleBrief { id: string; key: string; name: string; }

export interface UserRead {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  is_platform_admin: boolean;
  login_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  organizations: OrganizationBrief[];
  roles: RoleBrief[];
}

export interface UserListResponse {
  items: UserRead[];
  total: number;
}

export interface UserCreateRequest {
  email: string;
  password: string;
  display_name?: string;
  is_platform_admin?: boolean;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}

export interface UserUpdateRequest {
  display_name?: string;
  is_platform_admin?: boolean;
  status?: string;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}

export interface UserSessionRead {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface AuditLogRead {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface UserWorkspaceRead {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  role: string;
}

export interface ResetPasswordRequest { new_password?: string; }
export interface ResetPasswordResponse { password: string; message: string; }
export interface RevokeAllResponse { revoked_count: number; }

// ============ Organizations ============
export type OrganizationStatus = "active" | "disabled";

export interface OrganizationRead {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_id: string | null;
  status: OrganizationStatus;
  sort_order: number;
  member_count: number;
  children_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationDetail extends OrganizationRead {
  children: OrganizationRead[];
}

export interface OrganizationCreateRequest {
  name: string;
  code: string;
  description?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface OrganizationUpdateRequest {
  name?: string;
  code?: string;
  description?: string;
  parent_id?: string | null;
  sort_order?: number;
}

// ============ Roles ============
export interface RoleRead {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoleListResponse {
  items: RoleRead[];
  total: number;
}

export interface RoleCreateRequest {
  key: string;
  name: string;
  description?: string;
  permission_keys: Permission[];
}

export interface RoleUpdateRequest {
  name?: string;
  description?: string;
  permission_keys?: Permission[];
}
```

### R-02: 复用现有 fetch 封装

- 顶部 import：`import { apiFetch, getApiBase } from "@/lib/api";` 或现有 settings.ts 的 fetch 模式（与 `lib/settings.ts` 完全一致）
- 每个 admin 函数内部：
  - 拼 URL：`${baseUrl}/api/admin/users`、`${baseUrl}/api/admin/organizations`、`${baseUrl}/api/admin/roles`
  - GET 用 URLSearchParams 编码 query
  - POST/PATCH/DELETE 显式设置 `Content-Type: application/json` + `Authorization: Bearer ${token}`
  - token 从 `useSession` store 获取或作为函数参数传入（**推荐参数传入**，与 settings.ts 模式一致，避免客户端 API 直接耦合 store）
- 错误处理：解析 `{code, message, request_id, details}` 信封 → 抛 `ApiError`（复用 `lib/api.ts` 现有类）
- 401 错误：抛 `ApiError(401)`，由调用方（React Query 拦截器或 layout）触发重定向 login

### R-03: 28 个函数签名

**Users（13 个，端点对齐 task-06 的 13 端点）**：

```typescript
export async function listUsers(token: string, params?: { q?: string; status?: string; page?: number; size?: number }): Promise<UserListResponse>;
export async function getUser(token: string, userId: string): Promise<UserRead>;
export async function createUser(token: string, body: UserCreateRequest): Promise<UserRead>;
export async function updateUser(token: string, userId: string, body: UserUpdateRequest): Promise<UserRead>;
export async function deleteUser(token: string, userId: string): Promise<void>;
export async function listUserSessions(token: string, userId: string): Promise<UserSessionRead[]>;
export async function revokeUserSession(token: string, userId: string, sessionId: string): Promise<void>;
export async function revokeAllUserSessions(token: string, userId: string): Promise<RevokeAllResponse>;
export async function listUserAudit(token: string, userId: string, params?: { limit?: number }): Promise<AuditLogRead[]>;
export async function listUserWorkspaces(token: string, userId: string): Promise<UserWorkspaceRead[]>;
export async function resetUserPassword(token: string, userId: string, body?: ResetPasswordRequest): Promise<ResetPasswordResponse>;
export async function disableUserLogin(token: string, userId: string): Promise<UserRead>;
export async function enableUserLogin(token: string, userId: string): Promise<UserRead>;
```

**Organizations（7 个）**：

```typescript
export async function listOrganizations(token: string, params?: { parent_id?: string; is_active?: boolean }): Promise<OrganizationRead[]>;
export async function getOrganization(token: string, orgId: string): Promise<OrganizationDetail>;
export async function createOrganization(token: string, body: OrganizationCreateRequest): Promise<OrganizationRead>;
export async function updateOrganization(token: string, orgId: string, body: OrganizationUpdateRequest): Promise<OrganizationRead>;
export async function disableOrganization(token: string, orgId: string): Promise<OrganizationRead>;
export async function enableOrganization(token: string, orgId: string): Promise<OrganizationRead>;
export async function deleteOrganization(token: string, orgId: string): Promise<void>;
```

**Roles（7 个）**：

```typescript
export async function listRoles(token: string, params?: { search?: string; is_active?: boolean; page?: number; size?: number }): Promise<RoleListResponse>;
export async function getRole(token: string, roleId: string): Promise<RoleRead>;
export async function createRole(token: string, body: RoleCreateRequest): Promise<RoleRead>;
export async function updateRole(token: string, roleId: string, body: RoleUpdateRequest): Promise<RoleRead>;
export async function disableRole(token: string, roleId: string): Promise<RoleRead>;
export async function enableRole(token: string, roleId: string): Promise<RoleRead>;
export async function deleteRole(token: string, roleId: string): Promise<void>;
```

**Permissions（1 个）**：

```typescript
export async function listPermissions(token: string): Promise<PermissionWithGroup[]>;
// GET /api/admin/permissions — 后端如未实现，可降级为前端常量表（参考下方 R-04）
```

### R-04: Permission 常量表（兜底方案）

后端 `GET /api/admin/permissions` 端点本期可能未实现（task-04/05/06 未明确包含）。提供本地兜底：

```typescript
export const PERMISSION_GROUPS: { group: PermissionGroup; permissions: PermissionWithGroup[] }[] = [
  {
    group: "ADMIN",
    permissions: [
      { key: "user:read", name: "用户查看", group: "ADMIN" },
      { key: "user:write", name: "用户编辑", group: "ADMIN" },
      { key: "user:login_manage", name: "登录权限管理", group: "ADMIN" },
      { key: "organization:read", name: "组织查看", group: "ADMIN" },
      { key: "organization:write", name: "组织编辑", group: "ADMIN" },
      { key: "role:read", name: "角色查看", group: "ADMIN" },
      { key: "role:write", name: "角色编辑", group: "ADMIN" },
    ],
  },
  // WORKSPACE / AGENT / CHANGE / AUDIT / PLATFORM 各组同样定义
];
```

如后端 listPermissions 端点存在则调用 API，否则使用 PERMISSION_GROUPS 常量（前端自包含，无需网络请求）。

### R-05: 单元测试覆盖

`admin.test.ts` 用 Vitest + `vi.mock("globalThis.fetch")` mock fetch，覆盖：

- 每个函数的成功路径（200/201/204 + 响应字段正确反序列化）
- 错误路径：401（未认证）、403（无权限）、404（不存在）、409（冲突，ROLE_IN_USE/ORGANIZATION_HAS_CHILDREN/USER_SELF_DELETE_FORBIDDEN 等）、422（参数非法）
- DELETE 返回 204 时函数返回 undefined / void
- query 参数正确拼接到 URL（`?q=alice&page=1&size=20`）
- 请求体 JSON 序列化（POST/PATCH 含 Content-Type 头）
- Authorization 头正确（`Bearer ${token}`）

## 接口定义

### ApiError 错误信封（复用 lib/api.ts）

```typescript
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public requestId?: string,
  ) { super(message); }
}
```

### fetch 封装（参考 lib/settings.ts 模式）

```typescript
async function adminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit & { params?: Record<string, string | number | boolean | undefined> },
): Promise<T> {
  const url = new URL(`${getApiBase()}${path}`);
  if (init?.params) {
    for (const [k, v] of Object.entries(init.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? "UNKNOWN", body?.message ?? res.statusText, body?.details, body?.request_id);
  }
  return body as T;
}
```

## 边界处理

1. **401 自动重定向**：fetch 收到 401 时直接抛 `ApiError(401)`，由 React Query 全局拦截器或 layout `useEffect` 捕获后 `router.replace("/login")`，本客户端不做重定向
2. **403 错误信封**：后端返回 `{code: "PERMISSION_DENIED", message: ..., details: {required: "user:write"}}`，ApiError 保留 code，前端 toast 显示「无权限」
3. **404 错误**：detail 端点（getUser/getOrganization/getRole）目标不存在时后端返回 404，前端 catch 后显示空状态或 toast
4. **409 错误细节**：删除占用错误（ROLE_IN_USE/ORGANIZATION_HAS_CHILDREN/ORGANIZATION_IN_USE）含 `details.user_count` / `details.children_count` / `details.member_count`，前端 toast 显示具体数字
5. **422 错误**：参数校验失败（如非法 permission_keys、非法 organization_ids），ApiError.details.missing_ids 含失败 id 列表
6. **网络错误**：fetch 抛 TypeError（无网络），adminFetch 包装成 `ApiError(0, "NETWORK_ERROR", ...)`，前端显示「网络异常，请稍后重试」
7. **token 缺失**：函数被调用时 token 为空字符串，adminFetch 拼 Authorization 头为 `Bearer `，后端返回 401，由调用方负责检查 token 非空再调用
8. **deleteRole/deleteOrganization/deleteUser 返回 void**：res.status === 204 时函数返回 undefined，调用方不能 await 后读 .id（已删除）
9. **null 与空数组**：UserRead.organizations / UserRead.roles 默认空数组（后端 Field default_factory=list），不出现 null
10. **日期字符串**：所有 created_at / updated_at / last_login_at 是 ISO 字符串，前端用 `new Date(str)` 解析，不在客户端做时区转换（由组件层 format）

## 非目标

- 不实现 React Query hook（页面层直接调用 admin 函数 + useEffect/useState 管理）
- 不实现 Zustand store（admin 数据不缓存，每次页面加载重新拉取）
- 不实现表单校验（页面层的 Drawer 表单用 react-hook-form + zod，与 lib/admin.ts 解耦）
- 不修改后端 API 端点（仅消费）
- 不实现 WebSocket / SSE 流（admin 数据全部走 REST）
- 不实现批量操作（listUsers 一次返回一页，无 batch fetch）
- 不实现客户端缓存（每次 list 调用都走网络，避免脏数据）

## 参考

- `lib/settings.ts` 现有 fetch 模式 + ApiError 错误处理
- `lib/api.ts` `getApiBase` / `ApiError` 类定义
- task-04 端点签名（roles 7 端点）
- task-05 端点签名（organizations 7 端点）
- task-06 端点签名（users 13 端点 + response schema）
- `requirements.md` FR-03 ~ FR-13 各模块字段定义
- `design.md` §7 接口定义章节

## TDD 步骤

1. **写测试 fixtures**：在 `admin.test.ts` 顶部定义 mock 数据（mockUser、mockOrganization、mockRole、mockPermission）
2. **写错误信封测试**：先验证 ApiError 在不同 status code 下正确构造
3. **写每个函数的成功路径测试**：fetch 返回 200/201 + mock JSON，断言函数返回值
4. **写每个函数的错误路径测试**：fetch 返回 4xx/5xx，断言 ApiError 抛出 + code/details 正确
5. **跑测试失败**：`pnpm test -- admin` 全红（lib/admin.ts 不存在）
6. **实现 admin.ts**：按 R-01 ~ R-04 顺序，类型 → fetch 封装 → 28 个函数 → PERMISSION_GROUPS 常量
7. **跑测试通过**：所有测试全绿
8. **lint/typecheck**：`pnpm lint && pnpm typecheck` 通过

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `pnpm typecheck` | 0 错误（admin.ts 所有类型可被页面层 import） |
| AC-02 | `pnpm test -- admin` | 全部测试绿（≥30 个用例） |
| AC-03 | `listUsers(token, {q:"alice",page:1,size:20})` mock fetch | fetch URL 含 `?q=alice&page=1&size=20`，返回 UserListResponse |
| AC-04 | `createUser(token, {...})` mock fetch 返回 201 | 函数返回 UserRead，请求体含 Content-Type: application/json |
| AC-05 | `deleteUser(token, id)` mock fetch 返回 204 | 函数返回 undefined，不抛 |
| AC-06 | `disableUserLogin(token, selfId)` mock fetch 返回 403 + `{code:"USER_SELF_DISABLE_LOGIN_FORBIDDEN"}` | 函数抛 ApiError(403, "USER_SELF_DISABLE_LOGIN_FORBIDDEN") |
| AC-07 | `deleteRole(token, id)` mock fetch 返回 409 + `{code:"ROLE_IN_USE", details:{user_count:2}}` | 函数抛 ApiError(409, "ROLE_IN_USE")，details.user_count=2 |
| AC-08 | `deleteOrganization(token, id)` mock fetch 返回 409 + ORGANIZATION_HAS_CHILDREN | 函数抛 ApiError(409) 含 details.children_count |
| AC-09 | `createRole(token, body)` body.permission_keys 含非法值后端返回 422 | 函数抛 ApiError(422) 含 details |
| AC-10 | `listPermissions(token)` mock fetch 返回 200 | 函数返回 PermissionWithGroup[]，按 group 字段聚合 |
| AC-11 | mock fetch 抛 TypeError（无网络） | adminFetch 抛 ApiError(0, "NETWORK_ERROR") |
| AC-12 | UserRead 类型 import 后访问 `.organizations` | TypeScript 不报错，organizations 默认 [] 不为 null |
| AC-13 | PERMISSION_GROUPS 常量至少含 6 个 group | PLATFORM/ADMIN/WORKSPACE/AGENT/CHANGE/AUDIT 全覆盖 |
| AC-14 | `pnpm build` | 0 错误（admin.ts 被 Next.js 构建可识别） |
| AC-15 | admin.ts 不直接 import `@/stores/session` | 通过参数传入 token，避免客户端 API 耦合 store |
