---
id: task-08
title: 改造 /workspaces 页面与 WorkspaceCard 筛选、人员搜索、分页、别名编辑和卡片样式
priority: P0
estimated_hours: 5
depends_on: [task-05, task-06]
blocks: [task-10]
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - "frontend/src/app/(dashboard)/workspaces/**/*.test.tsx"
  - frontend/src/components/workspace-card.tsx
  - "frontend/src/components/__tests__/workspace-card*.test.tsx"
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-08.md
author: qinyi
created_at: "2026-06-25 18:10:00"
---

# task-08: 改造 /workspaces 页面与 WorkspaceCard 筛选、人员搜索、分页、别名编辑和卡片样式

> 本 task 依赖 task-05（后端 `GET /api/workspaces` 支持 `q/type/status/user_id/limit/offset`、`WorkspaceRead.display_alias/owner`、`WorkspaceUpdate.display_alias`）和 task-06（前端 `Workspace.display_alias/owner`、`WorkspaceListParams`、`UpdateWorkspaceInput.display_alias`）。执行时改 `workspaces/page.tsx`、`workspace-card.tsx` 及其测试。

## 现状基线

- `workspaces/page.tsx`（约 96 行）：`reload` 并发 `listWorkspaces()`（返回 `{items,total}`）+ `listDaemonRuntimes().catch(()=>[])` 构建 `runtimesById`；`WorkspaceCard` 渲染网格；`WorkspaceScanDialog` 新建工作区。
- `workspace-card.tsx`（约 138 行）：标题用 `workspace.name`，副标题 `workspace.slug`；操作区「详情/关系/重新扫描/删除」；删除走 `window.confirm`。

本 task 把列表改服务端筛选分页、卡片加别名/owner/别名编辑，保留 scan dialog、runtimesById 绑定、删除/重扫逻辑。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/page.tsx` | 列表加 `q/type/status/limit/offset` 状态与服务端重拉；平台管理员人员搜索；摘要 total；分页器。 |
| 修改 | `frontend/src/components/workspace-card.tsx` | 标题优先 `display_alias` + 原 `name` 副标题；新增 owner 文案；新增别名编辑入口（inline 或轻量对话框）。 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/**/*.test.tsx`、`components/__tests__/workspace-card*.test.tsx` | task-02 checkpoint 转可执行；mock `listWorkspaces(params)`/`updateWorkspace`/`listUsers`。 |

## 覆盖来源

| 来源 | 本 task 落点 |
|---|---|
| FR-02 | 普通账号人员控件不渲染、不传 `user_id`；可见性完全由后端 `allowed_workspace_ids` 决定，前端只做展示。 |
| FR-03 | WorkspaceCard 标题优先 `display_alias`，空值回退 `name ?? slug`；别名编辑调 `updateWorkspace(id,{display_alias})`。 |
| FR-04 | `listWorkspaces({q,type,status,limit,offset})` 服务端分页；筛选变化重置 offset=0。 |
| FR-05 | 筛选条 + 摘要 + 卡片网格 + 分页器，样式沿用 `PageContainer`/`Button`/`Badge`；移动端一列、桌面两列。 |
| D-002@v1 | 别名独立于 `name/slug`，副标题保留原 `name/slug`。 |
| D-003@v1 | 人员搜索仅平台管理员；普通账号忽略 `user_id`。 |
| D-004@v1 | 服务端 `limit/offset`，不前端切片。 |
| D-006@v1 | `workspace.owner?.display_name ?? workspace.owner?.email` 嵌套读取。 |
| design §5 Phase 4/5、§7.3/7.4、§9 | workspace 列表 query 参数与 PATCH 别名。 |

## 实现要求

### 1. workspaces/page.tsx 列表筛选分页

1. 新增页面状态：
   ```ts
   const PAGE_SIZE = 12;
   const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
   const [query, setQuery] = useState("");
   const [typeFilter, setTypeFilter] = useState("");
   const [statusFilter, setStatusFilter] = useState("");
   const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
   const [page, setPage] = useState(0);
   const [total, setTotal] = useState(0);
   ```
2. `reload` 改为：
   ```ts
   const [wsResp, runtimes] = await Promise.all([
     listWorkspaces({
       q: query.trim() || undefined,
       type: typeFilter || undefined,
       status: statusFilter || undefined,
       user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
       limit: PAGE_SIZE,
       offset: page * PAGE_SIZE,
     }),
     listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
   ]);
   setItems(wsResp.items);
   setTotal(wsResp.total);
   setRuntimesById(new Map(runtimes.map((r) => [r.id, r])));
   ```
   响应结构保持 `{items,total}`（task-05/06 保证），本 task 不新增顶层 `limit/offset` 字段消费。
3. 筛选/分页变化触发 `reload`（`useEffect` 依赖 `query/typeFilter/statusFilter/ownerUserId/page`）；筛选变化重置 `page=0`，建议封装 `updateFilter` helper（同 task-07）。
4. `WorkspaceScanDialog` 的 `handleCreated` 仍调 `reload()`，行为不变。

### 2. 筛选条 + 人员搜索 + 分页器

1. 筛选条放在 `PageHeader` 与卡片网格之间，中文 `aria-label`（task-02 约定）：搜索「搜索资源」、类型「筛选类型」、状态「筛选状态」、人员「筛选人员」。
2. 类型选项：`server-local`/`daemon-client`（对应 `path_source`）+「全部」；后端 task-05 已兼容 `type` 同时匹配 `Workspace.type` 与 `path_source`。状态选项沿用 `STATUS_LABELS`。
3. 人员搜索仅 `isPlatformAdmin`：首次 true 时 `listUsers({ limit: 50 })` 拉选项；失败降级隐藏人员控件，其他筛选保留。选择用户 `setOwnerUserId(id)+setPage(0)`，「全部人员」`setOwnerUserId(null)+setPage(0)`。
4. 分页器在卡片网格下方：`共 {total} 条 · 第 {page+1} 页` + 「上一页」「下一页」（中文 accessible name），禁用规则同 task-07（`page===0` / `(page+1)*PAGE_SIZE>=total`）。

### 3. WorkspaceCard 别名/owner/编辑

1. 标题优先别名：
   ```tsx
   <h3 className="truncate text-sm font-medium">
     {workspace.display_alias ?? workspace.name}
   </h3>
   <p className="truncate font-mono text-[11px] text-muted-foreground">
     {workspace.slug}
   </p>
   {workspace.display_alias && workspace.display_alias !== workspace.name && (
     <p className="truncate text-[10px] text-muted-foreground">原名：{workspace.name}</p>
   )}
   ```
2. owner 文案：在卡片信息区（`<dl>`）新增「负责人」字段，值 `workspace.owner?.display_name ?? workspace.owner?.email ?? "未记录"`；`owner=null` 显示「未记录」。
3. 别名编辑入口：操作区（footer）新增「别名」按钮，点击进入 inline 编辑态（`<input>` + 保存/取消）或 antd `App.useApp().modal` 轻量对话框；提交：
   ```ts
   const updated = await updateWorkspace(workspace.id, { display_alias: input.trim() || null });
   onChanged(); // 或局部更新
   ```
   - 成功后调 `onChanged()` 触发页面 reload，或由父组件传入局部更新回调；本 task 建议沿用 `onChanged`，与 rescan/delete 一致。
   - 失败在卡片内 `setError`（沿用现有卡片 error 文案区），不抛页面级。
4. 删除二次确认：现状是 `window.confirm`。本 task 不强制改 antd modal（非本变更目标），但若顺手改为 `App.useApp().modal.confirm` 须确保 `<AntApp>` 已在上层提供（参考 runtimes page）；不引入新依赖。保持现状也可接受。
5. `boundRuntime`、`WorkspacePathFields`、rescan/delete 逻辑保留不变。

### 4. import 调整

1. `workspaces/page.tsx`：从 `@/lib/workspaces` 的 `listWorkspaces` 仍可用（task-06 已支持 params）；新增 import `type WorkspaceListParams`（按需）。从 `@/lib/admin` import `listUsers`/`UserRead`；从 `@/stores/session` import `useSession`。
2. `workspace-card.tsx`：从 `@/lib/workspaces` 新增 import `updateWorkspace`；如用 antd modal，import `App` from "antd" 并 `const { modal } = App.useApp();`（确认上层 `<AntApp>` 存在）。

## 接口定义

### page 控制流伪代码

```ts
const PAGE_SIZE = 12;
const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);

function updateFilter<T>(setter: (v: T) => void) {
  return (v: T) => { setter(v); setPage(0); };
}

// reload
const wsResp = await listWorkspaces({
  q: query.trim() || undefined,
  type: typeFilter || undefined,
  status: statusFilter || undefined,
  user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
  limit: PAGE_SIZE,
  offset: page * PAGE_SIZE,
});
setItems(wsResp.items);
setTotal(wsResp.total);
```

### WorkspaceCard 别名提交伪代码

```ts
async function handleSaveAlias(input: string) {
  setBusy("alias");
  setError(null);
  try {
    await updateWorkspace(workspace.id, { display_alias: input.trim() || null });
    onChanged();
  } catch (err) {
    setError(err instanceof ApiError ? err.message : "更新别名失败");
  } finally {
    setBusy(null);
  }
}
```

`busy` 联合类型扩展为 `"rescan" | "delete" | "alias" | null`。

## 边界处理

1. **普通账号不传 `user_id`**：人员控件不渲染；即使误传也以 `isPlatformAdmin` 短路；可见性完全靠后端 `allowed_workspace_ids`。
2. **普通账号空集**：后端返回 `items=[]/total=0` 时显示现有空态文案，不报错。
3. **owner 为空**：`owner=null` 或 `email/display_name` 都 null 时显示「未记录」，不崩。
4. **筛选变化重置 offset**：`q/type/status/user_id` 任一变化 `setPage(0)`。
5. **分页 total 来源**：用服务端 `total`，不用 `items.length`。
6. **别名空值**：`display_alias` null/空时标题回退 `name`，不显示空标题；编辑提交空串/空白 → `display_alias: null`（后端清空）。
7. **别名不覆盖 slug/name**：副标题始终显示 `slug`；有别名时补显原 `name`。
8. **runtimesById 兼容**：`listDaemonRuntimes()` 继续用于 `boundRuntime`，不受 workspace 分页影响。
9. **listUsers 失败降级**：隐藏人员控件，其他筛选保留；不抛页面级错误。
10. **type=server-local/daemon-client**：后端已兼容 `path_source`；前端选项值用这两个固定串。
11. **status=deleted**：后端默认排除软删；前端不主动传 `include_deleted`，保持默认。
12. **参数不可变**：`updateFilter` 不改入参；state 更新走 setter。

## 非目标

- 不修改 `frontend/src/lib/workspaces.ts`、`frontend/src/lib/daemon.ts`、`frontend/src/lib/admin.ts`（task-06 / 已有实现提供）。
- 不修改 `WorkspaceScanDialog`、`WorkspacePathFields`、`workspace-path.ts`、`status-labels.ts`。
- 不修改后端、migration、schema、router、service。
- 不改造 `/runtimes` 页面（task-07 负责）。
- 不新增独立的别名编辑组件文件；如确需抽取先回 plan 修正 allowed_paths。
- 不引入 React Query/SWR；沿用现有 `apiFetch` + 手写 state。
- 不强制把 `window.confirm` 改 antd modal（非本变更目标）。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md` §5 Phase 4/5、§7.3/7.4、§9、§10 R-04/R-05。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md` FR-02/FR-03/FR-04/FR-05。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md` D-002@v1、D-003@v1、D-004@v1、D-006@v1。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-02.md`、`task-05.md`、`task-06.md`。
- `frontend/src/app/(dashboard)/workspaces/page.tsx`、`frontend/src/components/workspace-card.tsx`：现状基线。
- `frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx`：组件级 mock `listDaemonRuntimes`/`updateWorkspace` 风格。
- `frontend/src/lib/admin.ts`：`listUsers(params)`。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`、`modules/app-pages.md`、`modules/lib-workspaces.md`、`modules/components-shared.md`、`modules/stores-session.md`。
- 原型与样式参考同 task-07。

## TDD 步骤

1. 读 `local.yaml` 确认前端测试命令。
2. task-02 在 `workspaces/**/*.test.tsx`、`components/__tests__/workspace-card*.test.tsx` 的 `it.todo` checkpoint 转可执行骨架，mock `listWorkspaces(params)`/`updateWorkspace`/`listUsers`。
3. 运行确认红测。
4. 改 `workspace-card.tsx`：标题别名/owner/别名编辑。
5. 改 `workspaces/page.tsx`：筛选/分页/人员 state + reload + UI。
6. 每步重跑 focused 测试转绿；修正既有测试受影响项。
7. 手工自检：平台管理员人员搜索生效；普通账号不渲染；筛选重置 offset；分页推进；别名保存/清空回退；scan dialog/runtimesById 不受影响。
8. 全量验证交 task-10。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `git diff --name-only` | 只改 `workspaces/page.tsx`、`workspace-card.tsx` 及其测试 + 本 task 文件。 |
| AC-02 | 页面加载 `listWorkspaces({limit:12,offset:0})` | 返回 `{items,total}`；卡片渲染；`total` 进分页器。 |
| AC-03 | 改 q/type/status 筛选 | 触发重拉且 `offset=0`。 |
| AC-04 | 平台管理员人员搜索 | 控件渲染，选择用户后 query 带 `user_id`，`listUsers` 被调。 |
| AC-05 | 普通账号 | 人员控件不渲染，`listUsers` 不调，请求不带 `user_id`。 |
| AC-06 | 分页器 | 上下页按 `PAGE_SIZE` 步进；首/末页按钮禁用。 |
| AC-07 | WorkspaceCard 标题 | 优先 `display_alias`，副标题 `slug`，有别名补显原 `name`；空别名回退 `name`。 |
| AC-08 | WorkspaceCard 负责人 | `owner.display_name ?? owner.email ?? "未记录"`；null 不崩。 |
| AC-09 | 别名编辑 | `updateWorkspace(id,{display_alias})` 调用；成功 reload + 卡片标题更新；失败卡片内 error。 |
| AC-10 | 既有能力回归 | scan dialog 新建、runtimesById 绑定、重新扫描、删除行为不变。 |
| AC-11 | focused vitest | workspaces 与 workspace-card 测试通过；task-02 checkpoint 不再 `it.todo`。 |
| AC-12 | 类型检查 | 新增 `display_alias`/`owner`/params 类型与 task-06 契约一致，无 TS 报错（交 task-10 全量复核）。 |
