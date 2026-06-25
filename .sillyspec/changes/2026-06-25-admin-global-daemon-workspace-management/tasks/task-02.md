---
id: task-02
title: 增加前端 API client 类型契约与页面交互测试或可验证检查点
priority: P1
estimated_hours: 4
depends_on: []
blocks: [task-06, task-07, task-08, task-10]
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - "frontend/src/lib/daemon.test.ts"
  - "frontend/src/lib/__tests__/**"
  - "frontend/src/app/(dashboard)/runtimes/**/*.test.tsx"
  - "frontend/src/app/(dashboard)/workspaces/**/*.test.tsx"
  - "frontend/src/components/__tests__/**"
  - ".sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-02.md"
author: qinyi
created_at: "2026-06-25 17:48:59"
---

# task-02: 增加前端 API client 类型契约与页面交互测试或可验证检查点

本任务是 Wave 1 前端测试蓝图，先为 task-06、task-07、task-08 写出 API client 契约和页面交互守卫。实现任务完成前，允许这些用例处于红测状态；若页面 DOM 尚未落地导致选择器不稳定，可先用 `it.todo` / 明确命名的 checkpoint 保留验收点，但 task-10 必须把相关检查转为可执行并跑绿。

依据文档：

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md` FR-03、FR-04、FR-05、FR-06
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md` §5 Phase 4、§5 Phase 5、§7.1、§7.3、§9
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md` D-004@v1、D-006@v1
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/plan.md` Wave 1 task-02、Wave 3 task-06/07/08、Wave 4 task-10

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/daemon.test.ts` | 增加 daemon runtime 新分页 client、别名更新、owner 嵌套类型与旧数组接口兼容契约测试；复用现有 fetch harness。 |
| 新增/修改 | `frontend/src/lib/__tests__/workspaces.test.ts` 或同目录等价测试文件 | 增加 workspace 列表筛选分页参数、`display_alias`、嵌套 `owner`、`updateWorkspace({ display_alias })` 契约测试。 |
| 新增/修改 | `frontend/src/app/(dashboard)/runtimes/**/page*.test.tsx` | 增加 `/runtimes` 页面筛选条、分页器、平台管理员人员搜索、别名显示回退 checkpoint 或可执行交互测试。 |
| 新增/修改 | `frontend/src/app/(dashboard)/workspaces/**/page*.test.tsx` | 增加 `/workspaces` 页面筛选条、分页器、平台管理员人员搜索、WorkspaceCard 别名/owner 显示 checkpoint 或可执行交互测试。 |
| 新增/修改 | `frontend/src/components/__tests__/**` | 若 task-08 把别名展示/编辑落在 `WorkspaceCard` 或共享卡片组件中，在组件测试中补别名回退、owner 文案、操作回调断言。 |

> 本任务只允许新增/修改测试或 checkpoint 文件，不修改 `frontend/src/lib/daemon.ts`、`frontend/src/lib/workspaces.ts`、页面实现或组件实现。实现由 task-06、task-07、task-08 完成。

## 覆盖来源

| 来源 | 本任务覆盖点 |
|---|---|
| FR-03 | runtime / workspace 卡片标题优先显示 `display_alias`，为空时回退原始字段；别名更新 client 契约存在。 |
| FR-04 | daemon 与 workspace client 均支持 `q/type/status/user_id/limit/offset` 查询参数；分页器和筛选条能触发服务端重拉。 |
| FR-05 | `/runtimes`、`/workspaces` 页面具备筛选条、摘要/卡片、分页器；平台管理员才展示人员搜索。 |
| FR-06 | 旧 `listDaemonRuntimes()` 保持 `DaemonRuntimeRead[]` 数组响应；`GET /api/workspaces` 保持 `{ items, total }` 响应结构。 |
| D-004@v1 | 使用服务端 `limit/offset` 分页；卡片和操作区可被测试稳定定位，分页/筛选不依赖前端拉全量过滤。 |
| D-006@v1 | owner 展示字段为嵌套 `owner: { user_id, email, display_name } \| null`，前端读取 `owner?.email/display_name`。 |

## 实现要求

### 1. API client 契约测试必须先行

- `frontend/src/lib/daemon.test.ts` 复用现有 `mockFetch` / `lastUrl` / `lastInit` harness，新增 `describe("listDaemonRuntimesPage")`、`describe("updateDaemonRuntime")`。
- `listDaemonRuntimesPage({ q, type, status, user_id, limit, offset })` 必须断言 URL 为 `/api/daemon/runtimes/page`，并正确序列化全部非空查询参数，尤其 `offset: 0` 不能被误省略。
- `listDaemonRuntimesPage()` 返回分页对象 `{ items, total, limit, offset }`，`items[0].owner.email`、`items[0].owner.display_name`、`items[0].display_alias` 能按类型读取。
- `updateDaemonRuntime("rt a/b", { display_alias: "主机 A" })` 必须断言路径编码为 `/api/daemon/runtimes/rt%20a%2Fb`，方法 `PATCH`，JSON body 只包含 `display_alias`。
- 旧 `listDaemonRuntimes()` 必须保留数组响应测试：请求仍是 `/api/daemon/runtimes`，返回值仍可 `Array.isArray(result) === true`，不得被分页对象替代。
- `listOnlineRuntimes()` 若保留基于旧 `listDaemonRuntimes()` 的实现，需确认不会调用新分页端点。

### 2. workspace client 契约测试必须覆盖默认兼容与新增参数

- 在 `frontend/src/lib/__tests__/workspaces.test.ts` 或同目录等价文件中新增测试，mock `fetch` 模式可参考 `frontend/src/lib/__tests__/admin.test.ts`。
- `listWorkspaces()` 无参数时仍请求 `/api/workspaces`，返回 `{ items, total }`。
- `listWorkspaces({ q, type, status, user_id, limit, offset })` 必须把参数放入 query，`offset: 0` 与 `limit` 均保留。
- `Workspace` 类型样例必须包含 `display_alias: string | null` 与 `owner: OwnerRead | null`，并能读取 `owner?.display_name ?? owner?.email`。
- `updateWorkspace(id, { display_alias: null })` 必须断言 `PATCH /api/workspaces/{id}`，body 中存在 `display_alias: null`，用于清空别名；字段省略仍代表不变。

### 3. 页面交互测试或 checkpoint 必须覆盖两页共同能力

- `/runtimes` 页面测试应 mock `listDaemonRuntimesPage`、`updateDaemonRuntime`、`listUsers`、`listAgentSessions`、`getRuntimesUsage` 等现有依赖；保留 `runtimes/page.test.tsx` 的 `vi.hoisted` + `vi.importActual` + `next/navigation` + `<AntApp>` 模式。
- `/workspaces` 页面测试应 mock `listWorkspaces`、`listDaemonRuntimes`、`updateWorkspace`、`listUsers`；若页面改造仍使用 `WorkspaceCard`，组件测试可承担别名/owner 展示断言，页面测试承担筛选/分页重拉断言。
- 平台管理员场景：`useSession.setState({ user: { is_platform_admin: true } })` 后展示人员搜索控件；输入关键字调用 `listUsers({ q, limit, offset })`；选择人员后列表 client 以 `user_id` 重拉。
- 普通账号场景：`is_platform_admin: false` 或缺省时不展示人员搜索控件，`listUsers` 不被调用，列表重拉参数不得包含 `user_id`。
- 筛选条基本交互：输入搜索词、选择类型、选择状态后触发列表重拉；筛选变化必须把 `offset` 重置为 `0`。
- 分页器基本交互：默认 `limit` 使用页面约定值（建议 12），点击下一页后以 `offset + limit` 重拉；总数不足一页时下一页不可用或不触发重拉。
- 别名显示回退：卡片标题优先 `display_alias`；当别名为空字符串、`null` 或缺失时，runtime 回退 `name ?? provider`，workspace 回退 `name ?? slug`；原始名称/slug/provider 仍作为副标题或辅助文本可见。
- owner 展示：`owner.display_name` 优先，其次 `owner.email`；`owner: null` 时页面不崩溃，可显示“未记录人员”或省略 owner 文案，但测试需固定最终实现的可见行为。

### 4. 可访问性和选择器约束

- 测试优先使用 `getByRole`、`getByLabelText`、`findByRole`、`within(card)`，避免依赖 Tailwind class。
- 若 task-07/task-08 实现时缺少稳定 accessible name，应补 `aria-label` 或明确按钮文本，而不是在测试里使用脆弱的 DOM 层级选择。
- 对分页按钮建议使用中文可访问名：`上一页`、`下一页`；对筛选控件建议使用 `搜索资源`、`筛选类型`、`筛选状态`、`筛选人员`。

## 接口定义

### daemon client 期望契约

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
  status: string | null;
  owner: OwnerRead | null;
  // 其余既有字段保持不变
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

export interface DaemonRuntimeUpdateInput {
  display_alias?: string | null;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]>;
export async function listDaemonRuntimesPage(
  params?: DaemonRuntimeListParams,
): Promise<DaemonRuntimeListResponse>;
export async function updateDaemonRuntime(
  runtimeId: string,
  input: DaemonRuntimeUpdateInput,
): Promise<DaemonRuntimeRead>;
```

### workspace client 期望契约

```ts
export interface WorkspaceListParams {
  q?: string;
  type?: string;
  status?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

export interface Workspace {
  id: string;
  display_alias: string | null;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  owner: OwnerRead | null;
  // 其余既有字段保持不变
}

export interface WorkspaceListResponse {
  items: Workspace[];
  total: number;
}

export interface UpdateWorkspaceInput {
  display_alias?: string | null;
  // 其余既有字段保持不变
}

export async function listWorkspaces(
  params?: WorkspaceListParams,
): Promise<WorkspaceListResponse>;
export async function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace>;
```

### 页面 checkpoint 名称建议

```ts
describe("RuntimesPage 全局筛选分页", () => {
  it("平台管理员看到人员搜索，选择人员后以 user_id 重拉 runtime page");
  it("普通账号不显示人员搜索，也不调用 listUsers");
  it("搜索词/类型/状态变化重置 offset=0 并调用 listDaemonRuntimesPage");
  it("下一页按钮按 limit 推进 offset 并刷新卡片");
  it("runtime 卡片优先显示 display_alias，空别名回退 name/provider，并展示 owner");
});

describe("WorkspacesPage 全局筛选分页", () => {
  it("平台管理员看到人员搜索，选择人员后以 user_id 重拉 workspace list");
  it("普通账号不显示人员搜索，也不调用 listUsers");
  it("搜索词/类型/状态变化重置 offset=0 并调用 listWorkspaces");
  it("下一页按钮按 limit 推进 offset 并刷新卡片");
  it("workspace 卡片优先显示 display_alias，空别名回退 name/slug，并展示 owner");
});
```

## 边界处理

1. **旧 daemon 数组接口兼容**：`listDaemonRuntimes()` 永远走 `/api/daemon/runtimes` 并返回 `DaemonRuntimeRead[]`，不得因为新增分页接口而改成 `{ items, total }`。
2. **`offset: 0` 不被丢弃**：query 构造不能用 truthy 判断过滤数值，`limit=12&offset=0` 必须出现在初始分页请求中。
3. **空查询参数省略**：`q: ""`、`type: ""`、`status: ""`、`user_id: undefined` 不应序列化为无意义过滤；清空筛选后重拉默认第一页。
4. **别名为空回退**：`display_alias` 为 `null`、`undefined` 或 trim 后空字符串时，runtime 标题回退 `name ?? provider ?? id`，workspace 标题回退 `name ?? slug ?? id`。
5. **owner 为空不崩溃**：`owner: null` 或 `owner.email/display_name` 为空时，卡片仍渲染；人员文案显示统一 fallback 或省略，但不得读取空对象导致异常。
6. **owner 嵌套字段优先级**：有 `owner.display_name` 时展示显示名；无显示名但有 `owner.email` 时展示邮箱；测试不得依赖旧扁平 `owner_email` 字段。
7. **普通账号人员搜索隐藏**：非平台管理员不展示人员搜索，不调用 `listUsers`，筛选参数不携带 `user_id`，即使测试手动触发筛选也不能扩大前端请求范围。
8. **人员搜索失败降级**：平台管理员调用 `listUsers` 失败时页面不能整体失败；人员选项可显示空态或错误提示，其他筛选和分页仍可用。
9. **分页边界**：`total <= limit` 或当前页已到末页时，下一页按钮禁用或点击不发请求；上一页不能产生负 offset。
10. **筛选变化重置分页**：当前在第二页时修改 `q/type/status/user_id`，下一次列表请求必须 `offset=0`，避免筛选后空页。
11. **URL 编码**：`q`、`user_id`、runtime/workspace id 含空格、斜杠或中文时通过 `apiFetch({ query })` / `encodeURIComponent` 正确编码。
12. **workspace 默认响应兼容**：`listWorkspaces()` 不传参数时仍接收 `{ items, total }`，既有调用无需感知新增筛选参数。

## 非目标

- 不实现 `listDaemonRuntimesPage`、`updateDaemonRuntime`、`listWorkspaces(params)` 或页面 UI；这些属于 task-06、task-07、task-08。
- 不新增后端接口、迁移或后端测试；后端权限、路由顺序、筛选分页由 task-01、task-04、task-05 覆盖。
- 不验证平台管理员后端权限安全；本任务只验证前端是否显示人员搜索、是否传递/不传递 `user_id`。
- 不做截图、Playwright 或真实浏览器联调；本任务使用 Vitest + jsdom + RTL。
- 不重构现有 `/runtimes` 用量统计、session dialog、workspace scan dialog 的既有测试。
- 不更改 UI 组件实现文件，也不新增测试辅助库到 allowed_paths 外。
- 不要求所有 Wave 1 红测在本任务结束时绿；task-10 负责在实现任务完成后统一跑绿。

## 参考

- `frontend/src/lib/daemon.test.ts`：现有 fetch harness、`ApiError` 断言、路径编码测试模式。
- `frontend/src/lib/__tests__/admin.test.ts`：`listUsers({ q, status, limit, offset })` query string 测试模式。
- `frontend/src/lib/__tests__/api.test.ts`：`apiFetch` 错误与 request id 基础测试。
- `frontend/src/app/(dashboard)/runtimes/page.test.tsx`：`RuntimesPage` 的 `vi.hoisted` daemon mock、`next/navigation` mock、`EventSource` stub、`<AntApp>` wrapper。
- `frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx`：页面级额外 daemon mock、卡片内 `within(article)` 定位、时间窗按钮交互断言。
- `frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx`：组件级 mock `listDaemonRuntimes` + `updateWorkspace` 的交互测试模式。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`：前端数据层使用 `apiFetch` + 手写 loading/error 状态，无 React Query；测试使用 vitest/jsdom/RTL。
- `.sillyspec/docs/frontend/modules/lib-daemon.md`、`lib-workspaces.md`、`lib-admin.md`、`app-pages.md`、`components-shared.md`、`components-ui.md`、`components-layout.md`、`stores-session.md`。

## TDD步骤

1. **写 client 契约红测**：先在 `daemon.test.ts` 与 `lib/__tests__/workspaces.test.ts` 写 URL/query/body/shape 测试；若新 export 尚不存在，优先用动态 import 或明确红测，让失败原因指向缺失 client 方法/类型。
2. **写页面 checkpoint 或红测**：为 `/runtimes`、`/workspaces` 写筛选条、人员搜索、分页器、别名/owner 展示场景。DOM 尚未实现时使用 `it.todo`，名称必须与上文 checkpoint 对齐。
3. **运行目标测试记录红因**：执行 `cd frontend && pnpm exec vitest run src/lib/daemon.test.ts src/lib/__tests__/workspaces.test.ts`；页面 checkpoint 若已可执行，再追加对应 page/component 测试路径。
4. **交接 task-06/07/08**：红测失败应分别指向 client 方法缺失、页面筛选分页未接入、卡片别名/owner 未展示；不得在 task-02 中修改实现。
5. **task-10 收口**：实现任务完成后，把所有 `it.todo` 转为可执行测试，运行 `cd frontend && pnpm test`，并确认本任务新增用例全部绿。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 检查 diff | 仅命中本任务 `allowed_paths` 内的测试/checkpoint 文件；无 `frontend/src/lib/*.ts`、页面实现或组件实现改动。 |
| 2 | `frontend/src/lib/daemon.test.ts` 契约检查 | 覆盖 `listDaemonRuntimesPage` query、`updateDaemonRuntime` PATCH、嵌套 owner、`display_alias`、旧 `listDaemonRuntimes()` 数组兼容。 |
| 3 | workspace client 契约检查 | 覆盖 `listWorkspaces(params)` query、默认 `{ items, total }` 兼容、`updateWorkspace({ display_alias })`、嵌套 owner。 |
| 4 | `/runtimes` 页面 checkpoint | 覆盖平台管理员人员搜索可见、普通账号隐藏、筛选条重拉、分页器 offset、别名回退、owner 展示。 |
| 5 | `/workspaces` 页面或 `WorkspaceCard` checkpoint | 覆盖平台管理员人员搜索可见、普通账号隐藏、筛选条重拉、分页器 offset、别名回退、owner 展示。 |
| 6 | 目标 vitest | Wave 1 允许红测，但失败原因必须是预期实现缺失或 `it.todo` checkpoint；不得出现语法错误、mock 初始化错误、路径越界或无关旧用例回归。 |
| 7 | task-10 回归 | task-06/07/08 完成后，`cd frontend && pnpm test` 全绿；本任务新增 checkpoint 不得继续停留在 `it.todo`，除非在最终报告中说明未实现范围与风险。 |

