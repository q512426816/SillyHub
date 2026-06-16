---
id: task-06
title: "frontend/src/lib/workspace-members.ts API client 6 个函数，与 backend 端点 1:1"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-07, task-09]
allowed_paths:
  - frontend/src/lib/workspace-members.ts
  - frontend/src/types/workspace-members.ts
---

# Task-06 — frontend workspace-members API client

## 0. 依据文档

- `design.md` §5.2 前端 API client：6 个函数清单 + 类型要求
- `design.md` §5.1 Pydantic schema：字段名与字面量值（task-01 已落地到 `backend/app/modules/workspace/schema.py`）
- `design.md` §6 文件清单：新增 `frontend/src/lib/workspace-members.ts`
- `plan.md` Wave 3 task-06：API client 6 函数 + 透传 401/403/404/400
- 参考：`frontend/src/lib/workspaces.ts`、`frontend/src/lib/api-keys.ts`、`frontend/src/lib/audit.ts`（既有 `apiFetch` 调用模式）

## 1. 修改文件

**新建** `frontend/src/lib/workspace-members.ts` —— 单文件，内含 6 个 export async function + 5 个 export interface。

> **关于 `allowed_paths` 中的 `frontend/src/types/workspace-members.ts`**：本仓库目前**不存在** `frontend/src/types/` 目录（已 `ls` 验证），既有 lib 文件（`workspaces.ts`、`api-keys.ts`、`audit.ts`）一律把 `export interface ...` 内联在 `lib/*.ts` 中。遵循该约定，本任务**不创建** `frontend/src/types/workspace-members.ts`，全部 interface 与 function 集中在 `lib/workspace-members.ts` 一个文件内。保留该 allowed_path 作为防御性占位，若实施过程中发现需要拆分再启用。

## 2. 实现要求

1. **导出 6 个 async function**（命名与 design §5.2 一致）：
   - `listMembers(workspaceId: string): Promise<WorkspaceMemberView[]>`
   - `searchUsersForInvite(workspaceId: string, q: string, limit?: number): Promise<UserSearchHit[]>`
   - `addMember(workspaceId: string, payload: WorkspaceMemberAddRequest): Promise<WorkspaceMemberView>`
   - `updateMemberRole(workspaceId: string, userId: string, payload: WorkspaceMemberUpdateRequest): Promise<WorkspaceMemberView>`
   - `removeMember(workspaceId: string, userId: string): Promise<void>`
   - `transferOwnership(workspaceId: string, userId: string): Promise<void>`
2. **统一 import `apiFetch`**：`import { apiFetch } from "@/lib/api";`（与 `workspaces.ts` / `api-keys.ts` 完全一致的 import 形式，不要从 `./api` 相对导入——参考 `api-keys.ts:8` 与 `audit.ts:1` 的差别，本仓库两种写法都有，但 `workspaces.ts` / `api-keys.ts` 用 `@/lib/api` 别名，本任务跟随两者）。
3. **每个函数都 `try { ... } catch (err) { throw err; }` 透传 `ApiError`**：`apiFetch` 自身在非 2xx 时已 `throw new ApiError(status, payload)`（见 `api.ts:196`），本任务**不要**吞错（不要 `catch (err) { return null; }`）。try/catch 的作用有二：
   - 让函数签名清晰可读（IDE hover 能看到这是 async throw 而非 return null）
   - 预留位置，未来如需加 telemetry hook 直接在 catch 块追加，不必改签名
4. **401 / 403 / 404 / 400 全部依赖 `apiFetch` 默认行为透传**（**禁止**在客户端额外处理）：
   - **401**：`apiFetch` 内部已实现 "refresh token 重试一次 → 失败则 `useSession.clear()` + `window.location.href='/login'`"（`api.ts:144-194`），客户端**不要**重复跳登录逻辑
   - **403**：透传 `ApiError{code:"HTTP_403_PERMISSION_DENIED"}`，由调用方（task-07 Members 页面）决定是否显示"无权限"提示
   - **404**：透传 `ApiError{code:"workspace_not_found"|"user_not_found"}`，调用方按业务提示
   - **400**：透传 `ApiError{code:"invalid_role_key"|"cannot_remove_last_owner"}`，调用方按业务提示
5. **TS 类型与 backend schema 字段名 1:1**：参考 `workspaces.ts:27-52` 的 `Workspace` interface 模式，字段名**严格保持 snake_case**（`user_id` / `display_name` / `role_key` / `granted_at` / `is_current_user`），不要 camelCase 转换。后端 JSON 直接是 snake_case（Pydantic 默认），前端不引入额外的 transform 层。
6. **literal type 用 union 而非 enum**：`WorkspaceMemberRoleKey = "workspace_owner" | "developer" | "viewer"`（与 backend `Literal[...]` 一致，design §5.1 业务规则表白名单）；**严禁**包含 `"platform_admin"` / `"reviewer"` / `"qa"` / `"component_lead"`（即使它们在 RBAC seed 中存在，本 API 客户端不可写入）。
7. **`return resp.items` 模式**：`listMembers` / `searchUsersForInvite` 拿到 `WorkspaceMemberListResponse` / `UserSearchResponse` 后**剥掉 `items` 包装**，直接返回数组（参考 `api-keys.ts:35-37` 的 `listApiKeys` 模式：`const resp = await apiFetch<...>(); return resp.items;`）。调用方拿到的就是干净数组，无需再 `.items`。
8. **URL 路径必须 `encodeURIComponent`**：`workspaceId` 与 `userId` 都是外部传入字符串，理论上 UUID 不需要 encode，但**防御性**处理（避免传入 `"../abc"` 等恶意路径片段）：参考 `api-keys.ts:49` 的 `` `/api/auth/api-keys/${encodeURIComponent(id)}` `` 写法。
9. **search 的 query string**：用 `apiFetch` 的 `query` 选项（`api.ts:96-101`），**不要**手拼 `URLSearchParams`（`audit.ts:18-25` 那种手拼是早期代码，本任务跟随 `apiFetch` 内置 `query` 形参，更简洁）。
10. **POST/PATCH 的 json body**：用 `apiFetch` 的 `json` 选项（`api.ts:114-117`），不要手 `JSON.stringify`。

## 3. 接口定义

### 3.1 类型定义（导出在文件顶部，函数定义之前）

```ts
import { apiFetch } from "@/lib/api";

// ── Literal union (与 backend Literal["workspace_owner","developer","viewer"] 1:1) ──

export type WorkspaceMemberRoleKey =
  | "workspace_owner"
  | "developer"
  | "viewer";

// ── Response DTOs (与 backend schema.py WorkspaceMemberView 等字段名 1:1) ──

export interface WorkspaceMemberView {
  user_id: string;        // backend: uuid.UUID → 前端 string
  email: string;
  display_name: string | null;
  role_key: string;       // 响应里用 str（不用 Literal），允许 service 回显 platform_admin 等用于显示
  role_name: string;      // 例如 "Workspace Owner"
  granted_at: string;     // backend: datetime → 前端 ISO 字符串
  is_current_user: boolean; // 后端按 session user_id 比对填充
}

export interface WorkspaceMemberListResponse {
  items: WorkspaceMemberView[];
}

export interface UserSearchHit {
  user_id: string;
  email: string;
  display_name: string | null;
  is_member: boolean;     // 通常 false（搜索时已排除已是成员的）
}

export interface UserSearchResponse {
  items: UserSearchHit[];
}

// ── Request DTOs ──

export interface WorkspaceMemberAddRequest {
  user_id: string;
  role_key: WorkspaceMemberRoleKey;
}

export interface WorkspaceMemberUpdateRequest {
  role_key: WorkspaceMemberRoleKey;
}
```

### 3.2 函数签名（6 个 export async function）

```ts
/** 列出 workspace 的所有成员（含 user 信息 + role）。权限：WORKSPACE_READ（任何成员可见）。 */
export async function listMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]>;

/** 模糊搜索 users（display_name / email ILIKE），排除已是该 ws 成员的。权限：WORKSPACE_MEMBER_MANAGE。 */
export async function searchUsersForInvite(
  workspaceId: string,
  q: string,
  limit?: number,
): Promise<UserSearchHit[]>;

/** 添加成员（已成员则改 role，幂等）。权限：WORKSPACE_MEMBER_MANAGE。 */
export async function addMember(
  workspaceId: string,
  payload: WorkspaceMemberAddRequest,
): Promise<WorkspaceMemberView>;

/** 修改成员角色。权限：WORKSPACE_MEMBER_MANAGE。 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  payload: WorkspaceMemberUpdateRequest,
): Promise<WorkspaceMemberView>;

/** 移除成员（拒绝移除最后一个 owner）。权限：WORKSPACE_MEMBER_MANAGE。 */
export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void>;

/** 把目标升 owner，当前用户降 developer（单事务）。权限：WORKSPACE_MEMBER_MANAGE。 */
export async function transferOwnership(
  workspaceId: string,
  userId: string,
): Promise<void>;
```

### 3.3 错误时 throw 而非返回 null（硬性约定）

- **所有 6 个函数错误时 throw `ApiError`**（由 `apiFetch` 抛出，本任务**不**额外包装为 `Error`）
- **禁止**返回 `null` / `undefined` / 空 try-catch 吞错
- 调用方（task-07 Members 页面、task-09 AddDialog 组件）必须用 `try { ... } catch (e) { if (e instanceof ApiError) { ... } }` 模式处理
- 函数返回类型**不含** `null` 联合（不要 `Promise<WorkspaceMemberView | null>`）——这是与 `api-keys.ts` 一致的约定

### 3.4 完整实现示例（验收时对照）

```ts
import { apiFetch } from "@/lib/api";

export type WorkspaceMemberRoleKey =
  | "workspace_owner"
  | "developer"
  | "viewer";

export interface WorkspaceMemberView {
  user_id: string;
  email: string;
  display_name: string | null;
  role_key: string;
  role_name: string;
  granted_at: string;
  is_current_user: boolean;
}

export interface WorkspaceMemberListResponse {
  items: WorkspaceMemberView[];
}

export interface UserSearchHit {
  user_id: string;
  email: string;
  display_name: string | null;
  is_member: boolean;
}

export interface UserSearchResponse {
  items: UserSearchHit[];
}

export interface WorkspaceMemberAddRequest {
  user_id: string;
  role_key: WorkspaceMemberRoleKey;
}

export interface WorkspaceMemberUpdateRequest {
  role_key: WorkspaceMemberRoleKey;
}

function membersBase(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/members`;
}

export async function listMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]> {
  try {
    const resp = await apiFetch<WorkspaceMemberListResponse>(membersBase(workspaceId));
    return resp.items;
  } catch (err) {
    throw err;
  }
}

export async function searchUsersForInvite(
  workspaceId: string,
  q: string,
  limit?: number,
): Promise<UserSearchHit[]> {
  try {
    const resp = await apiFetch<UserSearchResponse>(
      `${membersBase(workspaceId)}/search`,
      { query: { q, limit } },
    );
    return resp.items;
  } catch (err) {
    throw err;
  }
}

export async function addMember(
  workspaceId: string,
  payload: WorkspaceMemberAddRequest,
): Promise<WorkspaceMemberView> {
  try {
    return await apiFetch<WorkspaceMemberView>(membersBase(workspaceId), {
      method: "POST",
      json: payload,
    });
  } catch (err) {
    throw err;
  }
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  payload: WorkspaceMemberUpdateRequest,
): Promise<WorkspaceMemberView> {
  try {
    return await apiFetch<WorkspaceMemberView>(
      `${membersBase(workspaceId)}/${encodeURIComponent(userId)}`,
      { method: "PATCH", json: payload },
    );
  } catch (err) {
    throw err;
  }
}

export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    await apiFetch<void>(`${membersBase(workspaceId)}/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    throw err;
  }
}

export async function transferOwnership(
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    await apiFetch<void>(
      `${membersBase(workspaceId)}/${encodeURIComponent(userId)}/transfer-ownership`,
      { method: "POST" },
    );
  } catch (err) {
    throw err;
  }
}
```

## 4. 边界处理

1. **`workspaceId` 为空字符串 / undefined**：本任务**不做**运行时校验（让 `apiFetch` 用 `encodeURIComponent("")` 拼出 `/api/workspaces//members`，后端 422 或 404 自然返回）。理由：调用方（task-07 / task-09）应保证传入合法 UUID；客户端重复校验是噪音。**例外**：若 `workspaceId` 是 null/undefined（不是空字符串），`encodeURIComponent` 会抛 `TypeError`——本任务**不**额外保护，让调用方在调用前自查。
2. **`userId` 为空字符串**：同上，透传到后端 422/404。
3. **401 自动跳登录**：完全依赖 `apiFetch` 内部逻辑（`api.ts:144-194`：refresh 重试一次 → 仍 401 → `useSession.clear()` + `window.location.href="/login"`）。本任务**禁止**在 6 个函数里写 `if (e.status === 401) router.push("/login")` 之类的重复跳转。
4. **400 错误的 `message` 字段**：`apiFetch` 抛出的 `ApiError.message` 已是后端 `payload.message`（`api.ts:67`），调用方直接 `e.message` 显示给用户即可（如 "Cannot remove last owner"）。本任务**不要**做 message → i18n 映射（i18n 由调用方决定）。
5. **network 错误（fetch 直接 reject）**：`apiFetch` 已包装为 `ApiError(0, {code:"network_error", message:...})`（`api.ts:122-129`），调用方按 `e.code === "network_error"` 显示"网络错误，请检查后端是否启动"。
6. **search `q` 少于 2 字符**：本任务**不**做前端长度校验（让 backend `Query(min_length=2)` 返 422）。理由：debounce 控件（task-09 AddDialog）本身会保证至少打 2 字符才触发搜索；客户端双校验无意义。如未来需要在 UI 上"按钮置空"，那是组件职责，不是 API client 职责。
7. **`limit` 超出 [1,50]**：同上，让 backend 422 兜底。
8. **`role_key` 不在白名单**：本任务的 TS literal type 在**编译时**已挡住（`addMember` 接受 `WorkspaceMemberRoleKey` 而非 `string`），运行时不可能传非法值（除非用 `as any` 强转——代码评审拦截）。
9. **空 `items` 数组**：`listMembers` 返回 `[]`、`searchUsersForInvite` 返回 `[]` 是合法场景（新 workspace 还没加成员 / 搜索词无匹配），调用方需处理（不是错误）。

## 5. 非目标

- **不做** SWR / React Query / TanStack Query 封装——本任务只产出纯 `async function`，数据获取与缓存的 hook 由调用方决定（task-07 / task-09 可自行选择 useState + useEffect 或 SWR）
- **不做**缓存（无 cache、无 memoize、无 SWR `keepPreviousData`）
- **不做**乐观更新（调用方负责 UI 临时态 + 回滚）
- **不做** debounce（debounce 是 task-09 AddDialog 的组件职责）
- **不做**错误重试（重试由 `apiFetch` 内部 401 refresh 一次，业务错误不重试）
- **不做** i18n / 错误消息翻译（`ApiError.message` 透传后端原文，i18n 由调用方按 `e.code` 映射）
- **不做**参数运行时校验（`assertWorkspaceId` 之类的 helper）——靠 TS 静态类型 + backend 422 兜底
- **不做** vitest 单测（design §3 明确"前端不做 vitest，依赖手动 e2e 验收"）
- **不引入** `axios` / `ky` 等第三方 fetch 库——必须用本项目 `apiFetch`

## 6. 参考

既有 `apiFetch` 用法（已读源码验证）：

| 文件 | 模式 | 本任务借鉴点 |
|------|------|--------------|
| `frontend/src/lib/api.ts:89-200` | `apiFetch<T>(path, options)` | 错误处理、query/json options、401 retry |
| `frontend/src/lib/api-keys.ts:34-52` | `listApiKeys` / `revokeApiKey` | `return resp.items` 模式、`encodeURIComponent` 用法 |
| `frontend/src/lib/workspaces.ts:121-167` | `activateWorkspace` / `updateWorkspace` | path 参数拼接、PATCH json body |
| `frontend/src/lib/workspaces.ts:198-224` | `getWorkspaceRelations` / `createRelation` / `deleteRelation` | 子资源路径 `/${wsId}/relations` 套娃模式，本任务 `/members` 同构 |
| `frontend/src/lib/audit.ts:14-25` | `listAuditLogs` | query 参数手拼（**反例**——本任务用 `apiFetch` 内置 `query`，更简洁） |

类型定义惯例：

- `frontend/src/lib/workspaces.ts:6-95`：interface 内联在 lib 文件（不在 types/），snake_case 字段名，字段顺序与 backend Pydantic 一致
- `frontend/src/lib/api-keys.ts:10-31`：request / response / list 三套 interface 分离

错误类型：

- `frontend/src/lib/api.ts:53-74`：`ApiError` class（含 `code` / `status` / `requestId` / `details`），调用方按 `e instanceof ApiError` 判断

## 7. TDD 步骤

本任务**不写 vitest 单测**（design §3 明确依赖手动 e2e 验收，理由：本 API client 是 `apiFetch` 的薄包装，主要风险在调用层而非 client 本身）。

最小验证步骤：

1. **TypeScript 编译通过**：
   ```bash
   cd frontend && pnpm tsc --noEmit
   ```
   期望：无报错；如有报错优先检查 `WorkspaceMemberRoleKey` literal 是否漏写 / interface 字段是否拼错 / `apiFetch` 泛型是否漏传。

2. **esbuild bundle 能 tree-shake**（验证 export 都是 named export 而非 default）：
   ```bash
   cd frontend && pnpm next build
   ```
   期望：build 成功；新文件 `workspace-members.ts` 出现在 chunk 列表；未引用的函数（如调用方暂未用 `transferOwnership`）不会被打进首页 chunk。

3. **lint 通过**：
   ```bash
   cd frontend && pnpm lint -- --max-warnings=0 src/lib/workspace-members.ts
   ```
   期望：无 warning（特别是 `try { ... } catch (err) { throw err; }` 可能触发 `no-useless-catch` 规则——若触发，按 `eslint-disable-next-line no-useless-catch` 注释抑制，理由见 §2 第 3 点，不要直接删 try/catch）。

4. **手动冒烟（依赖 task-04 backend 已挂载 + task-05 测试已绿）**：
   - 启动 backend：`cd backend && uv run uvicorn app.main:app --port 8000`
   - 启动 frontend：`cd frontend && pnpm dev`
   - 浏览器登录 → 进入任意 workspace 详情页 → 打开 DevTools Console
   - 执行：
     ```js
     const { listMembers } = await import("@/lib/workspace-members");
     console.log(await listMembers("<workspace-id-from-url>"));
     ```
   - 期望：返回数组（至少 1 个 owner），字段名与 `WorkspaceMemberView` interface 完全一致。

## 8. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 文件存在且导出 6 个函数 | `frontend/src/lib/workspace-members.ts` 存在；`grep "^export async function" frontend/src/lib/workspace-members.ts` 输出恰好 6 行（listMembers / searchUsersForInvite / addMember / updateMemberRole / removeMember / transferOwnership） |
| AC-2 | 导出 5 个 interface + 1 个 type alias | `grep "^export interface\|^export type" frontend/src/lib/workspace-members.ts` 输出至少 6 行（WorkspaceMemberView / WorkspaceMemberListResponse / UserSearchHit / UserSearchResponse / WorkspaceMemberAddRequest / WorkspaceMemberUpdateRequest / WorkspaceMemberRoleKey） |
| AC-3 | TS 类型与 backend schema 字段名一致 | 对比 `backend/app/modules/workspace/schema.py` 的 `WorkspaceMemberView` / `UserSearchHit` Pydantic 类，前端 interface 的字段名逐字相同（`user_id` / `email` / `display_name` / `role_key` / `role_name` / `granted_at` / `is_current_user` / `is_member`），均为 snake_case，无 camelCase |
| AC-4 | TypeScript 编译无报错 | `cd frontend && pnpm tsc --noEmit` exit 0；无 `TS2322` / `TS2345` / `TS2554` 等错误 |
| AC-5 | 函数错误时 throw 而非 return null | `grep "return null" frontend/src/lib/workspace-members.ts` 输出 0 行；6 个函数的返回类型不含 `null` 联合 |
| AC-6 | 401 / 403 / 404 / 400 透传不本地处理 | `grep "router.push\|redirect\|navigate.*login\|status === 401\|status === 403" frontend/src/lib/workspace-members.ts` 输出 0 行（全部依赖 `apiFetch` 默认行为） |
| AC-7 | 用 `apiFetch` 而非第三方库 | `grep "axios\|import.*from \"ky\"\|fetch(" frontend/src/lib/workspace-members.ts` 输出 0 行（仅 `apiFetch` 调用） |
| AC-8 | esbuild tree-shake 友好 | 6 个函数全部 named export（无 `export default`），`grep "^export default" frontend/src/lib/workspace-members.ts` 输出 0 行 |
| AC-9 | WorkspaceMemberRoleKey literal 白名单正确 | `grep -A3 "WorkspaceMemberRoleKey" frontend/src/lib/workspace-members.ts` 显示恰好 3 个值：`"workspace_owner"` / `"developer"` / `"viewer"`，**不含** `"platform_admin"` 等 |
| AC-10 | esbuild build 成功 | `cd frontend && pnpm next build` exit 0；chunk 列表中含 `workspace-members` 相关条目 |

## 9. 风险与回滚

- **风险 R-1**：`eslint` 触发 `no-useless-catch`（try/catch 仅 throw 不消化）→ **应对**：在 catch 块上方加 `// eslint-disable-next-line no-useless-catch` 注释，并在注释旁说明保留 try/catch 的理由（§2 第 3 点：留 telemetry hook 位置）。
- **风险 R-2**：`WorkspaceMemberView.role_key` 用 `string` 而非 `WorkspaceMemberRoleKey` → 引发 reviewer 困惑 → **应对**：interface 上方加注释 `// 响应里用 str（不用 Literal），允许 service 回显 platform_admin 等用于显示`（与 backend task-01 第 85 行表格的注释一致）。
- **风险 R-3**：手动冒烟时 backend 还没启动 / 没登录 → 报 401 → 误以为是 client bug → **应对**：先单独 curl 验证 backend 端点（task-04 + task-05 已绿为前置），再跑前端冒烟。
- **风险 R-4**：`limit?: number` 通过 `query: { limit }` 传给 `apiFetch`，若 `limit === undefined` 时 `apiFetch` 会 skip 该参数（`api.ts:98-99`）——这是预期行为（后端默认 limit=10），不算 bug。
- **回滚**：`git rm frontend/src/lib/workspace-members.ts` 即可完全恢复（无类型扩散到其他文件——本任务的所有 interface 都在本文件内自包含）。

## 10. 依赖与下游

- **本任务依赖**：无（design §5.2 不要求 backend 实现就绪也能写 client；TS 类型来自 design §5.1 schema 文档，不依赖运行时）。但**手动冒烟**（§7 第 4 步）依赖 task-04（router 挂载）+ task-05（端点测试绿）。
- **本任务阻塞**：
  - **task-07**（Members 页面）：import 本任务的 `listMembers` / `updateMemberRole` / `removeMember` / `transferOwnership` + `WorkspaceMemberView` interface
  - **task-09**（AddMemberDialog 组件）：import 本任务的 `searchUsersForInvite` / `addMember` + `UserSearchHit` interface + `WorkspaceMemberRoleKey` type
