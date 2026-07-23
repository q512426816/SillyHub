---
id: task-11
title: Frontend lib + pages delete server-local branches
title_zh: 前端 lib+pages 删 server-local（workspace-path/workspace-daemon-status/workspaces path_source 入参/spec-workspaces/列表筛选/[id]page/create-change 永远 proxy/changes 禁用/[id]agent）
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P1
depends_on: []
blocks: [task-14]
requirement_ids: [FR-1]
decision_ids: []
allowed_paths:
  - frontend/src/lib/workspace-path.ts
  - frontend/src/lib/workspace-daemon-status.ts
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
---

## goal

清除前端 lib 层与 4 个 page 中的 server-local 残留分支与 `path_source` 入参/读取。与 task-10（前端组件群）互补——task-10 改 `components/*`，本任务改 `lib/*` + `app/(dashboard)/workspaces/*` 页面。变更后前端**唯一**呈现 daemon-client 语义：列表筛选无「本机路径」option、详情页无 server-local 分支、create-change 永远走 `proxyCreateChange`、changes 页禁用逻辑简化、agent 页 dispatch 固定 daemon-client。

覆盖：FR-1（前端 UI + workspace service 统一 daemon-client）。api-types.ts 类型字段同步由 task-12 处理（本任务不动 api-types.ts，仅改调用方代码）。

## implementation

### lib/workspace-path.ts
1. **删 `WorkspacePathSource` 类型别名(4)**：`Workspace["path_source"]` 随 task-12 列删除会失类型，整行删。
2. **删 `isDaemonClientWorkspace`(6-8)**：二元映射函数，唯一调用方 `[id]/page.tsx:226` 本任务同步删除该调用。
3. **删 `workspacePathSourceLabel`(10-12)**：server-local/daemon-client 文案二元映射，删后调用方（task-10 组件群）已迁除。
4. **删 `workspaceRootPathLabel`(14-16)**：同上二元映射。
5. **保留** `formatDaemonRuntimeSummary`(18-33) + `daemonRuntimeStatusVariant`(35-42)：与 path_source 无关，daemon 实体展示仍用。同步清 import（`DaemonRuntimeRead` 保留，`Workspace` import 若仅被删掉的类型引用则一并清）。

### lib/workspace-daemon-status.ts
1. **注释更新(6)**：文件头注释第 6 行 `path_source` 字样删除（`MemberBindingView` 携带字段描述去掉 path_source，改为只列 `daemon_id / root_path`）。功能逻辑（`aggregateDaemonStatus` 纯函数 + `useDaemonStatusMap` hook）零改动。

### lib/workspaces.ts
1. **`scanGenerate`(47-70)**：删 `pathSource?: "server-local" | "daemon-client"`(51) 入参 + 删函数体 `...(pathSource ? { path_source: pathSource } : {})`(62) 透传；删 `daemonRuntimeId?: string | null`(52) 入参 + `...(daemonRuntimeId ? { daemon_runtime_id: daemonRuntimeId } : {})`(66) 透传（task-01 删列后 backend schema 拒收，保留必断链）。签名收敛为 `(rootPath, provider?, model?, specStrategy?, daemonId?)`。**注意**：`daemonId` 入参保留（daemon-entity-binding 稳定绑定键）。
2. **`CreateWorkspaceInput`(97-112)**：删 `path_source?: "server-local" | "daemon-client"`(103) 字段 + 注释(102)；删 `daemon_runtime_id?: string | null`(111) 字段 + `@deprecated` 注释(110)。保留 `daemon_id`(109)。
3. **`UpdateWorkspaceInput`(121-141)**：删 `daemon_runtime_id?: string | null`(140) 字段 + 上方 ql-20260619-006 注释块(135-139)（改绑 daemon 已由 member binding 管理，不再经 workspace update 传 daemon_runtime_id）。

### lib/spec-workspaces.ts
1. **`syncManual` docstring(195-202)**：删 server-local 立即返 `{"status": "done"}` 分支描述(199)，仅保留 daemon-client outbox 语义。函数体无 path_source 分支（纯 POST 透传），零改动。

### app/(dashboard)/workspaces/page.tsx（列表页）
1. **删列表筛选「本机路径」option(260)**：`<option value="server-local">本机路径</option>` 删除，仅留「全部类型」+「Daemon 客户端」。`typeFilter` state 保留（后端忽略未知值，R-06）。
2. **`WorkspaceCard` boundRuntime 透传(321-323)**：`w.daemon_runtime_id ? runtimesById.get(w.daemon_runtime_id) : null` 删除 `daemon_runtime_id` 读取——task-01 删列后该字段 undefined，boundRuntime 退化恒 null。改为 `boundRuntime={null}` 或整 prop 删除（task-10 组件群同步收敛 WorkspaceCard 签名）。

### app/(dashboard)/workspaces/[id]/page.tsx（详情页）
1. **删 server-local 分支(102-107)**：`if (ws.path_source === "daemon-client" && ws.daemon_runtime_id)` 分支收敛为单路径——`daemon_runtime_id` 已删（task-01），`boundRuntime` 恒 null。整段改为 `setBoundRuntime(null)` 或删除 boundRuntime state（由 task-10 判定 WorkspacePathFields 是否仍需该 prop）。
2. **删 `isDaemonClientWorkspace` 调用(226)**：`{isDaemonClientWorkspace(workspace) && (...)}` 改为永远渲染 `WorkspaceDaemonSwitcher`（所有工作区都是 daemon-client）。同步删顶部 import `isDaemonClientWorkspace`(15)。

### app/(dashboard)/workspaces/[id]/create-change/page.tsx
1. **删 `isDaemonClient`(58)**：`const isDaemonClient = workspace?.path_source === "daemon-client"` 删除。
2. **永远走 proxyCreateChange(80-86)**：删三元 `isDaemonClient ? proxyCreateChange(...) : createChange(...)`，改为无条件 `await proxyCreateChange(workspaceId, {...})`。`createChange` import(12) + `CreateChangeInput`(13) 若不再被引用则清 import（注意保留 `input` 变量构造的 title/description/affected_components——proxyCreateChange 的 payload 现为 `{title, description, change_type}`，`affected_components` 不传）。

### app/(dashboard)/workspaces/[id]/changes/page.tsx
1. **简化禁用逻辑(128-138)**：删 `daemonRuntimeId`(128) + `boundRuntime`(129-132) + `isDaemonClient`(133) + `newChangeDisabledReason`(134-138) 四段派生。`listDaemonRuntimes` import(17) + `runtimes` state(126) + load 中 `listDaemonRuntimes().catch(...)`(153) 一并删（页面不再需要 runtime 在线判定——runtime 由后端从 binding 现算，前端创建变更时不校验 daemon 在线）。
2. **按钮禁用(357)**：`disabled={loading || newChangeDisabledReason !== null}` + `title={newChangeDisabledReason ?? undefined}`(358) 改为 `disabled={loading}`，删 title prop。

### app/(dashboard)/workspaces/[id]/agent/page.tsx
1. **`scanGenerate` 调用(336-344)**：去 `pathSource` 实参 `"daemon-client"`(340) + 去 `daemonRuntimeId` 实参 `null`(341)（签名收敛后这两参数已删）。调用收敛为 `scanGenerate(workspaceData.root_path, selectedProvider, selectedModel || null, undefined, daemonId)`。
2. **删 server-local 分支(597)**：`!myBinding?.daemon_id && workspaceData?.path_source === "daemon-client"` 简化为 `!myBinding?.daemon_id`（所有工作区都是 daemon-client，path_source 判定冗余）。

## 验收标准

- `workspace-path.ts` 无 `WorkspacePathSource` / `isDaemonClientWorkspace` / `workspacePathSourceLabel` / `workspaceRootPathLabel` 导出；`formatDaemonRuntimeSummary` / `daemonRuntimeStatusVariant` 保留可用。
- `workspace-daemon-status.ts` 文件头注释无 `path_source` 字样；功能逻辑零改动。
- `workspaces.ts` 的 `scanGenerate` 签名无 `pathSource` / `daemonRuntimeId` 入参、函数体无 `path_source` / `daemon_runtime_id` 透传；`CreateWorkspaceInput` / `UpdateWorkspaceInput` 无两字段。
- `spec-workspaces.ts` 的 `syncManual` docstring 无 server-local 分支描述。
- `workspaces/page.tsx` 筛选下拉无 `<option value="server-local">`；`WorkspaceCard` boundRuntime 不读 `w.daemon_runtime_id`。
- `[id]/page.tsx` 无 `ws.path_source` / `ws.daemon_runtime_id` 读取、无 `isDaemonClientWorkspace` 调用/import。
- `create-change/page.tsx` 无 `isDaemonClient` 变量、无 `createChange` 非 proxy 分支、无 `path_source` 读取。
- `changes/page.tsx` 无 `isDaemonClient` / `daemonRuntimeId` / `boundRuntime` / `newChangeDisabledReason` / `listDaemonRuntimes` 派生；「+ 新建变更」按钮仅 `disabled={loading}`。
- `[id]/agent/page.tsx` 的 `scanGenerate` 调用无 `"daemon-client"` / `null` 实参；提示分支无 `path_source` 判定。
- grep 9 文件无 `path_source` / `daemon_runtime_id` / `server-local` / `isDaemonClient` 字样。

## verify

```bash
cd frontend && pnpm typecheck
```

预期：typecheck 全绿。task-01 删 backend `WorkspaceRead.path_source` / `daemon_runtime_id` + task-12 同步 `api-types.ts` 后，本任务清除的读取点是类型断链的根因；若 typecheck 报 `Property 'path_source' does not exist on type 'WorkspaceRead'` / `daemon_runtime_id` 即本任务遗漏点，须补清。vitest 组件测试由 task-14 统一精简。

## constraints

- **不动 api-types.ts**：`Workspace["path_source"]` / `Workspace["daemon_runtime_id"]` 的类型来源（`Schemas["WorkspaceRead"]`）由 task-12 手动同步删除。本任务仅删调用方代码，不碰 api-types.ts（allowed_paths 未含）。execute 时若 task-12 未同步，typecheck 会报类型仍存在但运行时 undefined——属预期，同 Wave 内 task-12 收敛。
- **无 depends_on**：与 task-01~09 后端可并行（前端类型层断链由 task-12 兜底）；但 typecheck 全绿需 task-01+task-12 先行。execute 排在 Wave 4，与 task-10（前端组件群）+ task-12（api-types）同 Wave 协调。
- **阻塞 task-14**（前端测试精简）：本任务删 `isDaemonClientWorkspace` / `path_source` 分支后，对应组件/page 测试 case 由 task-14 清理。
- **跨任务签名耦合**：`scanGenerate` 签名收敛后，调用方仅 `[id]/agent/page.tsx` + workspace-scan-dialog.tsx（task-10）两处，execute 时核对两处同步。
- **保留 daemon_id**：`scanGenerate` / `CreateWorkspaceInput` 的 `daemon_id` 入参是 daemon-entity-binding 稳定绑定键，**不删**；仅删 `path_source` / `daemon_runtime_id`。
- **boundRuntime 处理**：`[id]/page.tsx` + `workspaces/page.tsx` 的 `boundRuntime` 若 task-10 判定 WorkspaceCard/WorkspacePathFields 不再需要该 prop，则整 state 删除；否则保留 state 但赋 null。execute 时与 task-10 协调。
