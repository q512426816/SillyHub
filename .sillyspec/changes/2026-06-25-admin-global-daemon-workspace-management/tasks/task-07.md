---
id: task-07
title: 改造 /runtimes 页面筛选、人员搜索、分页、别名编辑和卡片样式
priority: P0
estimated_hours: 6
depends_on: [task-04, task-06]
blocks: [task-10]
requirement_ids: [FR-01, FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - "frontend/src/app/(dashboard)/runtimes/**/*.test.tsx"
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-07.md
author: qinyi
created_at: "2026-06-25 18:10:00"
---

# task-07: 改造 /runtimes 页面筛选、人员搜索、分页、别名编辑和卡片样式

> 本 task 依赖 task-04（后端 `/api/daemon/runtimes/page`、PATCH 别名、跨 owner 管理）和 task-06（前端 `listDaemonRuntimesPage`、`updateDaemonRuntime`、`DaemonRuntimeRead.display_alias/owner` 类型）。执行时只改 `frontend/src/app/(dashboard)/runtimes/page.tsx` 及其同级测试。

## 现状基线（必读）

`runtimes/page.tsx` 当前是重度页面（约 1183 行），已经包含多个历史变更的产物，**禁止破坏以下既有能力**：

- `listDaemonRuntimes()` 拉数组 + 15s 轮询 reload。
- `listAgentSessions({limit:100})` → `sessionStatsByRuntime` 聚合（卡片会话数）。
- `getRuntimesUsage(window)` → `usageByRuntime` 聚合 + 时间窗切换器（当日/7天/30天）。
- `RuntimeSessionDialog` 单例弹窗 + URL `?session=` 恢复点（`urlRestoreDoneRef`、`clearSessionParam`、`handleCloseDialog`）。
- `handleDeleteRuntime` 走 antd `modal.confirm` + `notify`。
- `handleToggleRuntime`（enable/disable）、`CopyDaemonCommand`、`InstallDaemonBlock`、`SummaryCard` 摘要。

本 task 在此基础上**增量**替换列表数据源并新增筛选/分页/别名/owner UI，不动 usage、session 弹窗、URL 恢复、删除/启停逻辑。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 列表数据源改 `listDaemonRuntimesPage`；新增筛选条、分页器、平台管理员人员搜索、runtime 卡片别名编辑与 owner/别名展示。保留 usage/session/URL 恢复逻辑。 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/**/*.test.tsx` | 把 task-02 的 page checkpoint 从 `it.todo` 转为可执行测试或同步修正既有测试；mock 新依赖 `listDaemonRuntimesPage`/`updateDaemonRuntime`/`listUsers`。 |

## 覆盖来源

| 来源 | 本 task 落点 |
|---|---|
| FR-01 | 平台管理员经 `listDaemonRuntimesPage` 看到全部 owner runtime，卡片显示 owner。 |
| FR-03 | 卡片标题优先 `display_alias`，空值回退 `name/provider`；提供别名编辑入口调 `updateDaemonRuntime`。 |
| FR-04 | 筛选条 `q/type/status` + 服务端 `limit/offset` 分页器；筛选变化重置 offset=0。 |
| FR-05 | 筛选条、摘要、卡片网格、分页器样式对齐既有 `PageContainer`/`Button`/`Badge` 风格。 |
| D-003@v1 | 人员搜索仅当 `useSession().user.is_platform_admin` 为 true 展示并传 `user_id`；普通账号不展示、不调 `listUsers`、不传 `user_id`。 |
| D-004@v1 | 服务端 `limit/offset` 分页（非前端切片）；卡片样式沿用系统 token。 |
| D-006@v1 | owner 嵌套读取 `runtime.owner?.display_name ?? runtime.owner?.email`。 |
| design §5 Phase 4/5、§9 | 列表改分页 client；卡片标题 `display_alias ?? name ?? provider`；人员搜索复用 `lib-admin.listUsers`。 |

## 实现要求

### 1. 列表数据源：`listDaemonRuntimes` → `listDaemonRuntimesPage`

1. 新增页面级筛选/分页状态：
   ```ts
   const PAGE_SIZE = 12;
   const [query, setQuery] = useState("");        // q 输入框值（受控）
   const [typeFilter, setTypeFilter] = useState<string>("");   // provider
   const [statusFilter, setStatusFilter] = useState<string>("");
   const [ownerUserId, setOwnerUserId] = useState<string | null>(null); // 仅平台管理员
   const [page, setPage] = useState(0);           // 从 0 开始的页码
   const [total, setTotal] = useState(0);
   ```
   `offset = page * PAGE_SIZE`；`limit = PAGE_SIZE`。
2. `reload` 改为调用 `listDaemonRuntimesPage`，把 `items` 改为分页响应的 `items`，并把 `total` 写入 state：
   ```ts
   const resp = await listDaemonRuntimesPage({
     q: query.trim() || undefined,
     type: typeFilter || undefined,
     status: statusFilter || undefined,
     user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
     limit: PAGE_SIZE,
     offset: page * PAGE_SIZE,
   });
   setItems(resp.items);
   setTotal(resp.total);
   ```
   `listAgentSessions({limit:100})` 并发拉取逻辑保留；`getRuntimesUsage` 逻辑完全不动（design R-06：usage 保持全量聚合，不随分页筛选收敛）。
3. 平台管理员判断：`const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);`。普通账号 `user_id` 永远不传入 client。
4. `reload` 的依赖数组要包含筛选/分页状态，使筛选或翻页后自动重拉。用 `useEffect(() => { void reload(); }, [reload, query, typeFilter, statusFilter, ownerUserId, page])`。15s 轮询 `useEffect` 保留，但轮询时不要把 `page` 重置。
5. **筛选变化必须重置 `page=0`**：`setQuery`/`setTypeFilter`/`setStatusFilter`/`setOwnerUserId` 的 change handler 里同时 `setPage(0)`。建议封装一个 `updateFilter(mutator)` helper 统一处理。
6. `displayItems` 的前端排序逻辑（statusRank + heartbeat + provider localeCompare）保留——分页返回的当前页内仍按现有规则排序，不影响后端 `created_at DESC`。

### 2. 筛选条 UI

1. 在「运行时列表」标题行与卡片网格之间新增筛选条，复用既有 `Button`/`Badge` 风格，使用中文可访问名（task-02 约定）：
   - 搜索输入：`<input aria-label="搜索资源" placeholder="搜索别名/名称/提供方" />`，受控 `value={query}`，`onChange` 走 `updateFilter(setQuery)`。可选 debounce（300ms），但必须保证 `offset` 重置。
   - 提供方筛选：`<select aria-label="筛选类型">`，选项来自 `PROVIDER_META`（claude/codex/copilot/openclaw/hermes/gemini/cursor/kimi/kiro/antigravity/opencode/pi），加「全部」。
   - 状态筛选：`<select aria-label="筛选状态">`，选项 online/maintenance/offline/disabled +「全部」。
   - 仅平台管理员：人员筛选控件（见下）。
2. 普通账号（`isPlatformAdmin === false`）**不渲染**人员筛选控件，且不调用 `listUsers`。

### 3. 平台管理员人员搜索（仅 is_platform_admin）

1. 渲染人员筛选控件：`aria-label="筛选人员"`。实现可选：
   - 方案 A（推荐）：`<select>` +「全部人员」+ 远程加载的 user 列表。
   - 方案 B：`<input>` + debounce 调 `listUsers({ q, limit: 20 })` + 下拉候选。
2. 用 `useEffect` 在 `isPlatformAdmin` 首次为 true 时调用 `listUsers({ limit: 50 })` 拉初始人员选项；`listUsers` 失败时降级为「隐藏人员选项 + 保留其他筛选」（design §9），不得让整页失败。
3. 选择某个用户后 `setOwnerUserId(user.id)` + `setPage(0)`；选择「全部人员」`setOwnerUserId(null)` + `setPage(0)`。
4. 人员选项显示 `display_name ?? email ?? username`，保留 `user_id` 作为值。

### 4. 分页器 UI

1. 在卡片网格下方新增分页器，显示：`共 {total} 条 · 第 {page+1} 页`，以及「上一页」「下一页」按钮（中文 accessible name）。
2. 上一页：`disabled={page === 0}`，点击 `setPage(p => Math.max(0, p - 1))`。
3. 下一页：`disabled={(page + 1) * PAGE_SIZE >= total}`，点击 `setPage(p => p + 1)`。
4. 翻页不重置筛选条件；筛选变化已由第 1 节重置 `page=0`。
5. 分页器必须基于服务端 `total`，不得用 `items.length`。

### 5. 卡片别名展示与编辑

1. `RuntimeCard` 标题改为优先别名：
   ```tsx
   <h3 className="mt-2 truncate font-mono text-sm font-semibold">
     {runtime.display_alias ?? runtime.name ?? "未命名运行时"}
   </h3>
   ```
   当 `runtime.display_alias` 非空且与 `runtime.name` 不同时，在副标题（`shortId(runtime.id) · 注册 ...` 同行或下一行）追加显示原始 `runtime.name`，避免别名覆盖真实标识（D-002@v1、风险 R-04）。
2. owner 展示：在 header 或 meta 区新增一行「负责人」，值为 `runtime.owner?.display_name ?? runtime.owner?.email ?? "未记录"`；`owner` 为 `null` 时显示「未记录」，不得读取空对象（边界处理 §D-006）。
3. 别名编辑入口：在卡片操作区（「会话/启用/移除」同一行）新增「别名」按钮，点击后进入编辑态。编辑态实现建议（任选其一，**不新建独立组件文件**，在 `page.tsx` 内实现）：
   - inline：按钮点击切换为 `<input>` + 「保存」「取消」。
   - antd：用 `modal`/`App.useApp()` 弹一个含 `Input` 的轻量对话框。
   编辑值经 `updateDaemonRuntime(runtime.id, { display_alias: value })` 提交：
   - 空字符串/全空白 → 传 `display_alias: ""`（后端 task-04 strip 后存 NULL）或 `null`；建议传 `value.trim() || null`。
   - 成功后用返回的 runtime 更新 `items` 中对应项（`setItems(prev => prev.map(...))`），并 `notify.success("别名已更新")`。
   - 失败走 `notify.error(err, "更新别名失败")`，不抛到页面顶部 inline error（与删除流程一致，design §5 操作类 toast）。
4. 别名编辑进行中用局部 `aliasEditingId`/`aliasSavingId` state 控制，不影响 `runtimeActionId`（启停/删除状态）。

### 6. import 调整

1. 从 `@/lib/daemon` 新增 import：`listDaemonRuntimesPage`、`updateDaemonRuntime`、`type DaemonRuntimeListResponse`。
2. **保留** `listDaemonRuntimes` 的 import 仅当仍有使用（如 `RuntimeSessionDialog` 的 `runtimes` prop 或 `CopyDaemonCommand` 不依赖它则可移除）；不得删除仍被引用的 import。
3. 从 `@/lib/admin` import `listUsers`、`type UserRead`（仅人员搜索用）。
4. 从 `@/stores/session` 的 `useSession` 读取 `user.is_platform_admin`（现有已 import `useSession`，补充 selector）。

## 接口定义

### 新增/调整的 page state（控制流伪代码）

```ts
const PAGE_SIZE = 12;
const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);

const [query, setQuery] = useState("");
const [typeFilter, setTypeFilter] = useState("");
const [statusFilter, setStatusFilter] useState("");
const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
const [page, setPage] = useState(0);
const [total, setTotal] = useState(0);
const [userOptions, setUserOptions] = useState<UserRead[]>([]);

// 统一封装：改筛选条件时重置 page=0
function updateFilter<T>(setter: (v: T) => void) {
  return (v: T) => { setter(v); setPage(0); };
}

// reload
const resp = await listDaemonRuntimesPage({
  q: query.trim() || undefined,
  type: typeFilter || undefined,
  status: statusFilter || undefined,
  user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
  limit: PAGE_SIZE,
  offset: page * PAGE_SIZE,
});
setItems(resp.items);
setTotal(resp.total);
```

### 别名提交（控制流伪代码）

```ts
async function handleSaveAlias(runtime: DaemonRuntimeRead, input: string) {
  setAliasSavingId(runtime.id);
  try {
    const updated = await updateDaemonRuntime(runtime.id, {
      display_alias: input.trim() || null,
    });
    setItems((prev) => prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev);
    notify.success("别名已更新");
  } catch (err) {
    notify.error(err, "更新别名失败");
  } finally {
    setAliasSavingId(null);
  }
}
```

## 边界处理

1. **usage/session 不随分页收敛**：分页只影响 runtime 列表；`getRuntimesUsage`、`listAgentSessions` 保持现有全量聚合行为，卡片按 `runtime.id` 在 map 中取值（design R-06）。不要为了让 usage 跟随分页而改 `getRuntimesUsage` 调用。
2. **普通账号不传 `user_id`**：即使 `ownerUserId` state 有值（理论上不可达，因为控件不渲染），client 调用也必须以 `isPlatformAdmin` 短路；`listUsers` 在普通账号下不被调用。
3. **人员搜索失败降级**：`listUsers` 失败时 `setUserOptions([])` 并保留其他筛选可用；不在顶部 inline error 抛出（可选用 amber 提示，参考 `usageError` 文案风格）。
4. **筛选变化重置 offset**：任何筛选条件（q/type/status/user_id）变化必须 `setPage(0)`，否则筛选后停在第二页会空页。
5. **分页 total 来源**：分页器「下一页」禁用判断用服务端 `total`，不用 `items.length`；`total=0` 时只显示空态。
6. **空别名回退**：`display_alias` 为 `null`/`undefined`/trim 空时，标题回退 `name ?? "未命名运行时"`，不显示空标题。
7. **owner 为空**：`runtime.owner` 为 `null` 时「负责人」显示「未记录」；`owner` 存在但 `email/display_name` 都为 null 时也显示「未记录」，不得崩。
8. **别名编辑取消**：取消编辑不发起请求，恢复原值；编辑中「移除/启用/禁用」按钮可禁用以避免并发，但别名的取消始终可用。
9. **15s 轮询保留**：轮询 reload 不重置 `page`/筛选；用户停在第 2 页时轮询仍刷新第 2 页内容。
10. **URL `?session=` 恢复**：分页后恢复点逻辑需考虑 runtime 可能在其他页。若恢复的 session 对应 runtime 不在当前页 items，按现状降级 `clearSessionParam()`（R-03 兜底）；不要为了恢复 session 强行翻页。
11. **`apiFetch` query 序列化**：`offset=0` 不能被吞（task-06 已保证）；本 task 传入 `offset: page * PAGE_SIZE`，`page=0` 时为 0，由 client 保留。
12. **参数不可变**：`updateFilter` 等 helper 不修改入参对象；所有 state 更新走 setter。

## 非目标

- 不修改 `frontend/src/lib/daemon.ts`、`frontend/src/lib/workspaces.ts`、`frontend/src/lib/admin.ts`（由 task-06 / 已有实现提供）。
- 不修改 `RuntimeSessionDialog`、`RuntimeUsageLineChart`、`runtime-session-helpers`、`CopyDaemonCommand`、`InstallDaemonBlock` 等既有组件实现。
- 不修改后端、migration、schema、router、service。
- 不改 daemon usage 统计、session 生命周期、URL 恢复编排。
- 不改造 `/workspaces` 页面或 `WorkspaceCard`（task-08 负责）。
- 不把别名编辑逻辑抽到新的独立组件文件；如确需抽取，必须先回到 plan 修正 allowed_paths。
- 不引入 React Query/SWR；沿用现有手写 loading/error state + `apiFetch`。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md` §5 Phase 4/5、§7.1/7.2、§9 兼容策略、§10 R-04/R-06。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md` FR-01/FR-03/FR-04/FR-05。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md` D-003@v1、D-004@v1、D-006@v1。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-02.md`（页面 checkpoint 名称约定）。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-04.md`（后端 runtime 分页/别名契约）。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-06.md`（前端 client 类型与方法）。
- `frontend/src/app/(dashboard)/runtimes/page.tsx`：现状 1183 行基线。
- `frontend/src/app/(dashboard)/runtimes/page.test.tsx`、`__tests__/page-usage.test.tsx`：现有 mock 与断言风格。
- `frontend/src/lib/admin.ts`：`listUsers(params)` 契约。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`、`modules/app-pages.md`、`modules/lib-daemon.md`、`modules/stores-session.md`。
- 原型：`.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/prototype-admin-global-daemon-workspace-management.html`。
- 样式参考：`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`。

## TDD 步骤

1. 读取 `local.yaml` 确认前端测试命令（`cd frontend && pnpm exec vitest run ...`）。
2. 把 task-02 在 `runtimes/**/*.test.tsx` 留下的 `it.todo` checkpoint 转为可执行测试骨架，mock `listDaemonRuntimesPage`/`updateDaemonRuntime`/`listUsers`，断言筛选/分页/人员/别名交互。
3. 运行这些测试，确认在 page.tsx 改造前失败（红）。
4. 按「实现要求」改造 `page.tsx`：先换数据源 + 分页 state，再加筛选条，再加人员搜索，再加别名编辑与 owner 展示。
5. 每加一块能力，重跑 focused 测试确认转绿；同步修正因结构变化失败的既有 `page.test.tsx`/`page-usage.test.tsx`（如 mock 从 `listDaemonRuntimes` 迁移到 `listDaemonRuntimesPage`）。
6. 手工自检：平台管理员账号看到人员搜索并能按 owner 过滤；普通账号不看到人员搜索；筛选变化 offset 归零；下一页按 `PAGE_SIZE` 推进；别名编辑保存/清空后标题正确回退；usage 统计与 session 弹窗不受影响。
7. 把剩余全量验证交 task-10（`pnpm test` + `pnpm lint` + 类型检查）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `git diff --name-only` | 只改 `frontend/src/app/(dashboard)/runtimes/page.tsx` 及其同级测试文件 + 本 task 文件。 |
| AC-02 | 页面加载调用 `listDaemonRuntimesPage({ limit:12, offset:0 })` | 返回分页对象；`items` 渲染为卡片；`total` 进入分页器。 |
| AC-03 | 修改搜索/类型/状态筛选 | 触发 `listDaemonRuntimesPage` 重拉，且 `offset=0`；url/session 恢复逻辑不报错。 |
| AC-04 | 平台管理员页面渲染人员控件并选择某用户 | `listDaemonRuntimesPage` query 带该 `user_id`；`listUsers` 被调用。 |
| AC-05 | 普通账号页面 | 人员控件不渲染；`listUsers` 不被调用；client 请求不带 `user_id`。 |
| AC-06 | 点击下一页/上一页 | 以 `PAGE_SIZE` 步进 `offset`；末页「下一页」禁用；首页「上一页」禁用。 |
| AC-07 | 卡片标题优先别名 | `display_alias` 非空时显示别名，副标题显示原 `name`；空别名回退 `name ?? "未命名运行时"`。 |
| AC-08 | 卡片「负责人」 | 显示 `owner.display_name ?? owner.email ?? "未记录"`；`owner=null` 显示「未记录」不崩。 |
| AC-09 | 编辑别名保存/清空 | `updateDaemonRuntime` 被调用；成功后卡片标题更新 + success toast；失败 error toast；不污染顶部 inline error。 |
| AC-10 | usage/session/URL 恢复回归 | 时间窗切换、session 弹窗、`?session=` 恢复、删除二次确认行为与改造前一致。 |
| AC-11 | focused vitest | `runtimes/**/*.test.tsx` 通过；task-02 的 checkpoint 不再停留在 `it.todo`。 |
| AC-12 | 既有页面测试迁移 | `page.test.tsx`/`page-usage.test.tsx` 的 mock 同步到新 client，无回归失败。 |
