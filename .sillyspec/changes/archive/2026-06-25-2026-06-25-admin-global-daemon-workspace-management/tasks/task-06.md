---
id: task-06
title: 更新前端 daemon/workspace API client 类型与方法
author: qinyi
created_at: 2026-06-25 17:48:59
priority: P0
estimated_hours: 3
depends_on: [task-04, task-05]
blocks: [task-07, task-08, task-10]
requirement_ids: [FR-03, FR-04, FR-06]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/daemon.test.ts
  - "frontend/src/lib/__tests__/**"
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-06.md
---

# task-06: 更新前端 daemon/workspace API client 类型与方法

## 修改文件（必填）

- `frontend/src/lib/daemon.ts`
- `frontend/src/lib/workspaces.ts`
- `frontend/src/lib/daemon.test.ts`
- `frontend/src/lib/__tests__/workspaces-client.test.ts`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-06.md`

## 覆盖来源

- Requirements: FR-03 两类资源支持独立 `display_alias`，前端类型必须能接收并传回别名。
- Requirements: FR-04 两类列表支持服务端筛选和分页参数：`q`、`type`、`status`、`user_id`、`limit`、`offset`。
- Requirements: FR-06 旧 `listDaemonRuntimes()` 仍请求旧数组端点；旧 `listWorkspaces()` 无参调用保持 `{ items, total }` 响应。
- Decisions: D-006@v1 `DaemonRuntimeRead` 与 `WorkspaceRead` 使用嵌套 `OwnerRead | None`；前端通过 `owner?.email` / `owner?.display_name` 读取人员信息。

## 实现要求

1. 先读取 `frontend/src/lib/daemon.ts` 当前 diff，再做增量合并；该文件当前可能已有他人未提交改动，禁止回滚或重排无关代码。
2. 在 `frontend/src/lib/daemon.ts` 中扩展 `DaemonRuntimeRead`，新增 `display_alias: string | null` 与 `owner: OwnerRead | null`，并导出 owner 类型。
3. 在 `frontend/src/lib/daemon.ts` 中新增分页查询类型与方法：`DaemonRuntimeListParams`、`DaemonRuntimeListResponse`、`listDaemonRuntimesPage(params?)`。
4. 在 `frontend/src/lib/daemon.ts` 中新增 `UpdateDaemonRuntimeInput` 与 `updateDaemonRuntime(runtimeId, input)`，PATCH `/api/daemon/runtimes/{runtime_id}`，仅负责传递 `display_alias`。
5. 保留 `listDaemonRuntimes()` 的方法名、参数和返回类型 `Promise<DaemonRuntimeRead[]>`；它必须继续请求 `/api/daemon/runtimes`，不得改为分页端点或 unwrap 分页响应。
6. 在 `frontend/src/lib/workspaces.ts` 中扩展 `Workspace`，新增 `display_alias: string | null` 与 `owner: OwnerRead | null`，并导出 owner 类型。
7. 在 `frontend/src/lib/workspaces.ts` 中新增 `WorkspaceListParams`，让 `listWorkspaces(params?)` 支持服务端筛选分页参数，同时无参调用仍等价旧实现。
8. 在 `frontend/src/lib/workspaces.ts` 的 `UpdateWorkspaceInput` 中加入 `display_alias?: string | null`；保持 `default_agent`、`daemon_runtime_id` 等既有字段语义不变。
9. 使用现有 `apiFetch` 的 `query` 与 `json` 选项，不直接 `fetch`，不新增 API base URL 拼接逻辑。
10. 补充 focused lib 层测试，覆盖 URL、query、PATCH body、旧调用兼容、`display_alias` 清空、owner 类型映射与 ApiError 透传。

## 接口定义（代码类任务必填）

### daemon client 类型与方法

```ts
export interface OwnerRead {
  user_id: string | null;
  email: string | null;
  display_name: string | null;
}

export interface DaemonRuntimeRead {
  id: string;
  display_alias: string | null;
  name: string | null;
  provider: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  status: string | null;
  last_heartbeat_at: string | null;
  capabilities: Record<string, any> | null;
  owner: OwnerRead | null;
  created_at: string;
  updated_at: string;
}

export interface DaemonRuntimeListParams {
  q?: string;
  type?: string;
  status?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

export interface DaemonRuntimeListResponse {
  items: DaemonRuntimeRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateDaemonRuntimeInput {
  display_alias?: string | null;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes");
}

export async function listDaemonRuntimesPage(
  params?: DaemonRuntimeListParams,
): Promise<DaemonRuntimeListResponse> {
  return apiFetch<DaemonRuntimeListResponse>("/api/daemon/runtimes/page", {
    query: params as Record<string, string | number | undefined>,
  });
}

export async function updateDaemonRuntime(
  runtimeId: string,
  input: UpdateDaemonRuntimeInput,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}`,
    { method: "PATCH", json: input },
  );
}
```

控制流伪代码：

```ts
// listDaemonRuntimesPage
query = shallow copy of params, or undefined
return apiFetch("/api/daemon/runtimes/page", { query })

// updateDaemonRuntime
path = "/api/daemon/runtimes/" + encodeURIComponent(runtimeId)
return apiFetch(path, { method: "PATCH", json: input })
```

### workspace client 类型与方法

```ts
export interface OwnerRead {
  user_id: string | null;
  email: string | null;
  display_name: string | null;
}

export interface Workspace {
  id: string;
  display_alias: string | null;
  name: string;
  slug: string;
  root_path: string;
  path_source: "server-local" | "daemon-client";
  daemon_runtime_id: string | null;
  status: WorkspaceStatus;
  component_key: string | null;
  type: string | null;
  role: string | null;
  repo_url: string | null;
  default_branch: string | null;
  default_agent: string | null;
  default_model: string | null;
  tech_stack: string[];
  build_command: string | null;
  test_command: string | null;
  source_yaml_path: string | null;
  created_by: string | null;
  owner: OwnerRead | null;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
  deleted_at: string | null;
}

export interface WorkspaceListParams {
  q?: string;
  type?: string;
  status?: WorkspaceStatus | string;
  user_id?: string;
  limit?: number;
  offset?: number;
  include_deleted?: boolean;
}

export async function listWorkspaces(
  params?: WorkspaceListParams,
): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces", {
    query: params as Record<string, string | number | boolean | undefined>,
  });
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  display_alias?: string | null;
  repo_url?: string | null;
  default_branch?: string | null;
  default_agent?: string | null;
  default_model?: string | null;
  tech_stack?: string[];
  build_command?: string | null;
  test_command?: string | null;
  status?: WorkspaceStatus;
  daemon_runtime_id?: string | null;
}
```

控制流伪代码：

```ts
// listWorkspaces
query = params omitted ? undefined : params
return apiFetch("/api/workspaces", { query })

// updateWorkspace
return apiFetch(`/api/workspaces/${id}`, { method: "PATCH", json: input })
```

## 边界处理（必填）

- `display_alias: null` 表示显式清空别名；`display_alias` 字段省略表示本次 PATCH 不改变别名。
- `owner` 可为 `null`，`owner.user_id`、`owner.email`、`owner.display_name` 也可为 `null`；类型必须强制调用方使用 optional chaining 或显式 fallback。
- `listDaemonRuntimes()` 旧方法不得接受 params、不得请求 `/page`、不得返回 `{ items, total }`，否则会破坏 `AgentProviderSelect`、`WorkspaceDaemonSwitcher`、workspace 详情和现有 runtimes 页面测试。
- `listWorkspaces()` 无参调用必须继续请求 `/api/workspaces` 并返回 `WorkspaceListResponse`；新增 params 只能进入 query string，不能改变返回 shape。
- `apiFetch` 会跳过 `undefined`、`null` 和空字符串 query 值，但必须保留 `offset=0`；`limit` 按调用方传入的正数原样传递。
- `runtimeId` 在新增 `updateDaemonRuntime` 中必须 `encodeURIComponent`，避免包含空格、斜杠等字符时路径错位；不要顺手改动无关旧方法。
- `params` 与 `input` 不得被函数内部修改；需要派生对象时创建浅拷贝。
- 前端 client 不做权限判断、不吞 403/404/409/422；所有非 2xx 继续由 `apiFetch` 抛 `ApiError` 给页面任务处理。
- 前端 client 不 trim、不截断 `display_alias`，长度和空白规则由 task-04/task-05 后端校验负责；测试只验证 body 原样发送。
- `WorkspaceListParams.include_deleted` 仅为兼容现有 workspace list 参数；本任务不改变它的权限语义，也不为普通账号扩大可见范围。

## 非目标（本任务不做的事）

- 不修改 `frontend/src/app/(dashboard)/runtimes/page.tsx`、`frontend/src/app/(dashboard)/workspaces/page.tsx` 或 `frontend/src/components/workspace-card.tsx`；页面筛选、分页 UI 和卡片展示由 task-07/task-08 完成。
- 不修改 `frontend/src/lib/admin.ts`；人员搜索直接复用既有 `listUsers(params)`，本任务只确认类型契约不新增用户 API。
- 不修改 backend、migration、schema、router 或 service；后端契约由 task-04/task-05 提供。
- 不把 `OwnerRead` 抽到新共享文件；允许在 daemon/workspace client 中各自定义同构类型，避免扩大 allowed paths。
- 不新增运行时别名展示 helper、不实现标题 fallback；页面任务负责 `display_alias ?? name ?? slug/provider`。
- 不重构 `daemon.ts` 的 SSE、session、usage stats 代码；只在 runtime 管理区附近增量添加类型和函数。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md` Phase 4、接口定义 7.1-7.4、兼容策略。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md` FR-03、FR-04、FR-06。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md` D-006@v1。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/plan.md` Wave 3 task-06、调用点搜索记录。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md` 数据访问、TypeScript strict、测试约定。
- `.sillyspec/docs/frontend/scan/ARCHITECTURE.md` `lib/api.ts` 与 App Router 通信模型。
- `.sillyspec/docs/frontend/modules/lib-daemon.md` daemon client 契约。
- `.sillyspec/docs/frontend/modules/lib-workspaces.md` workspace client 契约与 `updateWorkspace` PATCH 语义。
- `.sillyspec/docs/frontend/modules/lib-admin.md` `listUsers(params)` 现有人员搜索 API。
- `.sillyspec/docs/frontend/modules/app-pages.md` `/runtimes`、`/workspaces` 对旧 client 的依赖。
- `frontend/src/lib/api.ts` 的 `apiFetch` `query` 序列化规则。
- `frontend/src/lib/daemon.test.ts` 与 `frontend/src/lib/__tests__/daemon-usage.test.ts` 的 fetch harness 风格。

## TDD 步骤

1. 读取 `local.yaml`，确认 frontend 测试命令；未配置时使用现有 vitest 命令。
2. 在 `frontend/src/lib/daemon.test.ts` 先添加失败测试：
   - `listDaemonRuntimes()` 请求 `/api/daemon/runtimes` 且返回数组。
   - `listDaemonRuntimesPage({ q, type, status, user_id, limit, offset })` 请求 `/api/daemon/runtimes/page` 并序列化全部 query。
   - `listDaemonRuntimesPage()` 不附加空 query，返回 `{ items, total, limit, offset }`。
   - `updateDaemonRuntime("rt a/b", { display_alias: null })` PATCH 编码路径并发送 JSON body。
   - 非 2xx 响应继续 reject `ApiError`。
3. 在 `frontend/src/lib/__tests__/` 下新增或复用 workspace client 测试，先添加失败测试：
   - `listWorkspaces()` 无参请求 `/api/workspaces` 且返回 `{ items, total }`。
   - `listWorkspaces({ q, type, status, user_id, limit, offset, include_deleted })` query 序列化正确。
   - `Workspace` 响应中的 `display_alias` 与嵌套 `owner` 字段能被类型和运行时 payload 映射。
   - `updateWorkspace(id, { display_alias: "别名" })` 保留 PATCH 语义并只发送调用方传入字段。
   - `updateWorkspace(id, { display_alias: null })` 发送 `null`，用于清空别名。
4. 运行 focused 测试，确认新增断言失败且失败原因是缺少类型/方法/字段。
5. 实现 `frontend/src/lib/daemon.ts` 的类型、`listDaemonRuntimesPage` 与 `updateDaemonRuntime`。
6. 实现 `frontend/src/lib/workspaces.ts` 的 `OwnerRead`、`display_alias`、`owner`、`WorkspaceListParams`、`listWorkspaces(params?)` 与 `UpdateWorkspaceInput.display_alias`。
7. 重新运行 focused 测试，确认通过。
8. 运行 frontend 类型检查或 task-10 约定的最小类型命令；若当前阶段不运行全量检查，必须在任务结果中记录交给 task-10 验证。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 静态检查 `frontend/src/lib/daemon.ts` 的 `DaemonRuntimeRead` | 类型包含 `display_alias: string \| null` 与 `owner: OwnerRead \| null`，`OwnerRead` 含 `user_id/email/display_name` 三个 nullable 字段 |
| AC-02 | 调用/测试 `listDaemonRuntimes()` | 请求路径仍为 `/api/daemon/runtimes`，返回类型仍为 `Promise<DaemonRuntimeRead[]>`，未使用分页响应包装 |
| AC-03 | 调用/测试 `listDaemonRuntimesPage({ q: "rt", type: "claude", status: "online", user_id: "u1", limit: 12, offset: 0 })` | 请求路径为 `/api/daemon/runtimes/page`，query 包含 `q/type/status/user_id/limit/offset` 且 `offset=0` 未丢失，返回 `items/total/limit/offset` |
| AC-04 | 调用/测试 `updateDaemonRuntime("rt a/b", { display_alias: null })` | 请求为 `PATCH /api/daemon/runtimes/rt%20a%2Fb`，body 为 `{"display_alias":null}`，非 2xx 由 `ApiError` 透传 |
| AC-05 | 静态检查 `frontend/src/lib/workspaces.ts` 的 `Workspace` | 类型包含 `display_alias: string \| null` 与 `owner: OwnerRead \| null`，且保留 `created_by`、`path_source`、`daemon_runtime_id` 等既有字段 |
| AC-06 | 调用/测试 `listWorkspaces()` 与 `listWorkspaces(params)` | 无参调用仍请求 `/api/workspaces` 并返回 `{ items, total }`；有参调用通过 `apiFetch` query 发送 `q/type/status/user_id/limit/offset/include_deleted` |
| AC-07 | 调用/测试 `updateWorkspace(id, { display_alias: "Ops 名称" })` 和 `{ display_alias: null }` | PATCH body 原样包含字符串或 `null`；既有 `default_agent: null`、`daemon_runtime_id` 等字段语义不变 |
| AC-08 | 运行 focused lib 测试 | `frontend/src/lib/daemon.test.ts` 与新增/复用的 `frontend/src/lib/__tests__/*workspaces*.test.ts` 通过 |
| AC-09 | 运行 frontend 类型检查或记录交接 | 新增导出不产生 TypeScript strict 错误；如本任务未跑全量类型检查，交由 task-10 并在执行结果说明 |
| AC-10 | 检查 git diff | 除 allowed_paths 外无文件变更；未回滚他人对 `frontend/src/lib/daemon.ts` 的既有改动 |
