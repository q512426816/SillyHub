---
id: task-10
title: Frontend workspace components delete server-local branches
title_zh: 前端 workspace 组件群删 server-local（scan-dialog 删 radio+本地扫描 / access-guide 删下拉 / config-card 删 isServerLocal / path-fields / card / binding-dialog / binding-guard / daemon-switcher / switcher）
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P1
depends_on: []
blocks: [task-14]
requirement_ids: [FR-1]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/components/workspace-access-guide.tsx
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-path-fields.tsx
  - frontend/src/components/workspace-card.tsx
  - frontend/src/components/workspace-binding-dialog.tsx
  - frontend/src/components/workspace-binding-guard.tsx
  - frontend/src/components/workspace-daemon-switcher.tsx
  - frontend/src/components/workspace-switcher.tsx
---

## goal

清除 9 个 `components/workspace-*` 组件中的 server-local 残留分支、`path_source` 读取与 `daemon_runtime_id` legacy 注释。与 task-11（lib+pages）互补——本任务只动 `components/*`，task-11 动 `lib/*` + `app/*`。变更后前端组件**唯一**呈现 daemon-client 语义：扫描对话框无 radio 二选一 + 无本地路径输入区 + 无本地版 handleScan/handleGenerate/handleCreate、access-guide 无路径来源下拉、config-card 无 isServerLocal 分支 + 无 server-local-no-daemon testid、path-fields无非 daemon 提前返回。

覆盖：FR-1（前端 UI 统一 daemon-client）。`lib/workspace-path.ts` 的 `WorkspacePathSource`/`isDaemonClientWorkspace`/`workspacePathSourceLabel`/`workspaceRootPathLabel` 由 task-11 删除，本任务仅清除组件侧调用点；`api-types.ts` 类型字段由 task-12 同步。

## implementation

### workspace-scan-dialog.tsx（重灾）

1. **删 `PathSource` 类型(31)** + **删 `pathSource` state(51)** + **删 `handlePathSourceChange`(100-112)**：整个二选一切换器逻辑移除，创建永远走 daemon-client。
2. **删 `canUseServerLocal`(41)**：`hasAnyPermission(user, ["workspace:admin"])` 派生值移除。**保留** `workspace:admin` 权限枚举/菜单绑定（D-001 非目标不删运行时门禁之外的权限枚举），仅删此处的 UI 派生变量。
3. **删 pathSource 同步 effect(66-72)**：`if (!canUseServerLocal && pathSource === "server-local")` 整 effect 移除。
4. **改 instances 加载 effect(74-79)**：去 `if (pathSource !== "daemon-client") return` 前置守卫(75)，改为无条件加载 daemon 实例列表（创建对话框一打开即拉）。
5. **删 radio 二选一块(194-217)**：`canUseServerLocal ? (radio) : (灰字提示)` 整段 JSX 移除。可替换为一句 `text-[11px] text-muted-foreground` 静态说明「使用本机守护进程上的项目路径」（保留 daemon-client UI 样式参照 frontend-style-system）。
6. **删 server-local 本地路径输入区(219-245)**：`pathSource === "server-local" && canUseServerLocal &&` 整块（含 rootPath Input + 扫描按钮 + 说明文案）移除。
7. **删 `{pathSource === "daemon-client" &&` 包裹(247,372)**：外层三元收窄——daemon-client 块改为永远渲染，去外层 `pathSource ===` 守卫与闭合 `)}`。
8. **删本地版 `handleScan`(134-150)**：`scanWorkspace(normalizeClientPath(rootPath))` 本地扫描 handler 移除（不再有本地路径扫描入口）。
9. **删本地版 `handleGenerate`(152-163)** + **删本地版 `handleCreate`(165-179)**：基于 `scan` state 的本地创建/生成 handler 移除（这两个仅被 server-local 路径触发——scan state 在 daemon-client 路径下恒为 null 不触发，但代码是 dead branch 需清理）。
10. **删 `scan` state(45)** + **删 `scanProvider`/`scanModel` state(48-49)** + **删扫描结果展示 section(374-416)** + **删 provider/model 输入(418-435)** + **删本地创建按钮组(437-448)** + **删本地工作区名 Input(450-463)**：这些仅服务本地扫描流程，daemon-client 路径走 `handleCreateDaemonClient`(114-132) 自带名称/spec 策略/创建按钮，无需 scan state。
11. **删 `scanWorkspace` import(25)** + **`scanGenerate` import 若不再用也删(24)**：核对 `scanGenerate` 在 daemon-client 路径是否被调——当前 `handleCreateDaemonClient` 走 `createWorkspace` 不走 `scanGenerate`，故 `scanGenerate` import 可删。
12. **清 `rootPath` state(43)**：daemon-client 路径用 `daemonRootPath`(59)，`rootPath` 仅本地路径用，可删。
13. **`handleCreateDaemonClient`(114-132)**：去 `path_source: "daemon-client"`(123) 字段透传（task-11 `CreateWorkspaceInput` 删该字段后必删，否则 TS 报错）。`daemon_id`(124) + `spec_strategy`(125) 保留。
14. **清 import**：`useRouter`(4) 若 `handleGenerate` 删后无其他用则删；`hasAnyPermission`(21) 若 `canUseServerLocal` 删后无其他用则删；`useSession`(28) 同理；`Badge`(7) 若扫描结果 section 删后无引用则删。`normalizeClientPath` 保留（daemonRootPath 仍用）。

### workspace-access-guide.tsx

1. **删 `pathSource` state(80-82)**：`useState<"server-local" | "daemon-client">` 移除。
2. **删路径来源下拉块(194-213)**：`<div className="space-y-1">` 含 `<label>路径来源</label>` + `<select>` + 两 `<option>` 整个 div 移除。网格 `grid sm:grid-cols-3`(149) 收为 `sm:grid-cols-2`（daemon + rootPath 两列）。
3. **删 `workspacePathSourceLabel` import(14)**：task-11 删该导出后必删 import。
4. **`AccessGuideInitial` 接口(24-28)**：删 `path_source: string`(27) 字段。同步改 `MemberBindingUpsertRequest` payload 构造(113-117)：删 `path_source: pathSource`(116) 字段。
5. **保留** `daemon_id` + `root_path` 字段（daemon-entity-binding 稳定绑定键）。

### workspace-config-card.tsx

1. **删 `isServerLocal`(139)**：`const isServerLocal = workspace.path_source === "server-local"` 派生值移除。
2. **删 `daemonClient`(138)**：`isDaemonClientWorkspace(workspace)` 派生值移除——所有工作区都是 daemon-client，扫描按钮永远渲染（去 `{daemonClient &&` 包裹(404)）。
3. **`renderBoundDaemonDd`(466-506)**：删 `if (isServerLocal)` 分支(467-475) 含 `data-testid="server-local-no-daemon"` + 「服务器本地工作区，无需守护进程」文案。函数直接从 `if (!boundDaemon)`(477) 开始。
4. **`renderStorageGroup`(593-649)**：删 `!isServerLocal &&` 守卫(617)，「守护进程本地缓存」行(618-629) 永远渲染（所有工作区都有 daemon 本地缓存）。
5. **「路径来源」徽标(545-550)**：`workspacePathSourceLabel(pathSource)` 调用移除——该行整 `<dt>路径来源</dt>` + `<dd><Badge>` 删除（单一 daemon-client 后路径来源无信息量），或改为固定徽标「本机守护进程」。execute 时择一（建议删整行减少噪音）。同步删 `const pathSource = myBinding.path_source as WorkspacePathSource`(522)。
6. **`handleScan`(304-312)**：去 `scanGenerate` 第 4 实参 `"daemon-client"`(308)——task-11 收敛签名后该参数已删，调用改为 `scanGenerate(workspace.root_path, workspace.default_agent ?? null, workspace.default_model ?? null, null, specWs?.strategy, daemonId)`（去 pathSource 位）。
7. **删 import**：`isDaemonClientWorkspace`(27) + `workspacePathSourceLabel`(28) + `WorkspacePathSource`(29)（task-11 删这三导出后必删 import）；`workspace-path` import 若 `formatDaemonRuntimeSummary` 不在本文件用则整行删（核对——本文件未用 `formatDaemonRuntimeSummary`，故整 `workspace-path` import 块(26-30) 可删）。

### workspace-path-fields.tsx（重灾）

1. **删非 daemon 提前返回(43-55)**：`const pathSource = workspace.path_source ?? "server-local"`(43) + `const daemonClient = isDaemonClientWorkspace(...)`(44) + `if (!daemonClient)` 整块返回(46-55) 移除——所有工作区都是 daemon-client，无 server-local 分支。
2. **改 `WorkspacePathFieldsProps.workspace` 类型(24)**：`Pick<Workspace, "root_path" | "path_source" | "daemon_runtime_id">` 收为 `Pick<Workspace, "root_path">`（task-01 删两列后类型断链）。
3. **`daemon` 实体分支(58-110)**：去 `workspacePathSourceLabel(pathSource)` 调用(68)，「路径来源」徽标整 `<dt>/<dd>` 对(65-70) 可删或改固定文案；`workspaceRootPathLabel(pathSource)`(104) 改固定「客户端路径」或「root_path」。
4. **runtime 旧路径分支(112-155)**：去 `daemonClient` 判定(121)，去 `workspace.daemon_runtime_id` 读取(125,129,134)——该分支渲染 `formatDaemonRuntimeSummary(runtime)`，daemon-entity-binding 后 runtime 恒 null 此分支实为兜底空态。execute 时评估是否整分支删（若调用方都传 `daemon` prop 则 runtime 分支 dead code 可删）；保留则去 path_source/daemon_runtime_id 读取。
5. **删 import**：`isDaemonClientWorkspace`(16) + `workspacePathSourceLabel`(17) + `workspaceRootPathLabel`(18) + `WorkspacePathSource`(19)（task-11 删导出后必删）；`formatDaemonRuntimeSummary`(15) + `daemonRuntimeStatusVariant`(14) 若 runtime 分支保留则留 import。

### workspace-card.tsx（轻改）

1. **清 `daemon_runtime_id` 注释(39-44)**：`boundDaemon` prop docstring 中「新工作区 `workspace.daemon_runtime_id` 为 NULL」legacy 描述(41) 改写为 daemon-entity-binding 语义（绑定存 member binding 行，卡片按 daemon 实体展示），删 `daemon_runtime_id` 字样。
2. **无功能代码改动**：本文件不直接读 `path_source`/`daemon_runtime_id`（grep 核实零匹配），仅透传 `workspace` 给 `WorkspacePathFields`。path_source 耦合在 path-fields.tsx 处理（本任务上一节）。

### workspace-binding-dialog.tsx（仅注释）

1. **清 docstring(9)**：注释中「不重写 daemon 下拉 / root_path / **path_source** 表单」删 `path_source` 字样（表单已无 path_source 字段）。无功能代码改动（grep 核实仅注释命中）。

### workspace-binding-guard.tsx

1. **`initial` 构造(57-61)**：删 `path_source: binding.path_source`(60) 字段（`AccessGuideInitial` 已删该字段）。daemon_id(58) + root_path(59) 保留。
2. **清 docstring(24)**：注释「回填当前 runtime_id / root_path / **path_source**」删 `path_source` 字样，改「回填当前 daemon_id / root_path」。

### workspace-daemon-switcher.tsx

1. **`handleSwitch` payload(95-99)**：删 `path_source: currentBinding?.path_source ?? null`(98) 字段透传（task-11 `MemberBindingUpsertRequest` 删该字段后必删，否则 TS 报错）。`daemon_id`(96) + `root_path`(97) 保留。
2. **清 `daemon_runtime_id` 注释(39-44)**：`boundDaemon` 相关 docstring 无（本文件无该注释）；核对——本文件第 4-11 行文件头注释、第 29 行 currentBinding docstring 无 path_source 字样。execute 时复核。
3. **`as any` cast(99)**：payload 去 path_source 后评估 `as any` 是否仍需（若 `MemberBindingUpsertRequest` 类型收敛干净可去 cast）。

### workspace-switcher.tsx（无功能改）

1. **无功能代码改动**：grep 核实零 `path_source`/`daemon_runtime_id`/`server-local`/`isDaemonClient` 匹配。本组件通过 `MemberBindingView`（lib 类型，task-12 域）+ `statusMap` 间接消费，无直接 path_source 读取。execute 时仅复核 grep 确认。

## 验收标准

- `workspace-scan-dialog.tsx` 无 `PathSource`/`pathSource`/`canUseServerLocal`/`handlePathSourceChange`/`handleScan`(本地)/`handleGenerate`(本地)/`handleCreate`(本地)/`scan` state/`scanWorkspace` import/`scanGenerate` import(若不再用)/radio 二选一/本地路径输入区；`handleCreateDaemonClient` 的 `createWorkspace` payload 无 `path_source` 字段；`workspace:admin` 权限枚举保留（D-001）。
- `workspace-access-guide.tsx` 无 `pathSource` state/路径来源下拉/`workspacePathSourceLabel` import；`AccessGuideInitial` 无 `path_source` 字段；`MemberBindingUpsertRequest` payload 无 `path_source`。
- `workspace-config-card.tsx` 无 `isServerLocal`/`daemonClient`/`server-local-no-daemon` testid/`workspacePathSourceLabel`/`isDaemonClientWorkspace`/`WorkspacePathSource`；`scanGenerate` 调用无 `"daemon-client"` 实参；「守护进程本地缓存」永远渲染。
- `workspace-path-fields.tsx` 无非 daemon 提前返回/`path_source`/`daemon_runtime_id` 读取；`WorkspacePathFieldsProps.workspace` 类型仅 `Pick<Workspace, "root_path">`。
- `workspace-card.tsx` docstring 无 `daemon_runtime_id` legacy 字样。
- `workspace-binding-dialog.tsx` docstring 无 `path_source` 字样。
- `workspace-binding-guard.tsx` `initial` 无 `path_source` 字段；docstring 无 `path_source`。
- `workspace-daemon-switcher.tsx` `handleSwitch` payload 无 `path_source` 透传。
- `workspace-switcher.tsx` grep 零匹配（无改动确认）。
- grep 9 文件无 `path_source` / `daemon_runtime_id` / `server-local` / `isDaemonClient` / `canUseServerLocal` 字样（注释遗留除外，但建议注释也清）。

## verify

```bash
cd frontend && pnpm typecheck && pnpm test src/components
```

预期：typecheck 全绿 + 组件测试通过（或由 task-14 精简 server-local case 后通过）。task-01 删 backend `WorkspaceRead.path_source`/`daemon_runtime_id` + task-11 删 `workspace-path.ts` 四导出 + task-12 同步 `api-types.ts` 后，本任务清除的读取/导入点是类型断链根因；若 typecheck 报 `Property 'path_source' does not exist on type 'WorkspaceRead'` / `Module '"@/lib/workspace-path"' has no exported member 'isDaemonClientWorkspace'` 即本任务遗漏点，须补清。`pnpm test src/components` 跑全量组件测试，server-local 相关 case 失败由 task-14 统一精简（本任务 verify 容忍已知 server-local case 失败，但 daemon-client case 必须全绿）。

## constraints

- **保留 daemon-client UI 样式**：所有保留的 daemon-client 渲染（扫描对话框 daemon 选择 + 目录浏览、config-card 守护进程缓存行、path-fields daemon 实体徽标）样式不变，参照 `.sillyspec/changes/archive/2026-06-21-frontend-style-system/prototype-frontend-style-system.html` + `design.md`。本任务是删 server-local 分支，不是改 daemon-client 视觉。
- **`workspace:admin` 权限保留（D-001）**：仅删 scan-dialog 的 `canUseServerLocal` UI 派生变量 + radio 门禁；`workspace:admin` Permission 枚举（permissions.py:53）+ 菜单绑定（menu-permissions.ts:72）+ admin 角色赋权不在本任务范围（后端 task-03 域）。删 radio 后 `workspace:admin` 用户与普通用户创建流程一致（都走 daemon-client），权限差异仅体现在「工作区管理」菜单可见性。
- **不动 api-types.ts**：`Workspace["path_source"]`/`Workspace["daemon_runtime_id"]` 类型来源由 task-12 同步删除。本任务仅删组件侧调用方代码。execute 时若 task-12 未同步，typecheck 报类型仍存在但运行时 undefined——属预期，同 Wave 内 task-12 收敛。
- **不动 lib/**：`workspace-path.ts`/`workspaces.ts`/`workspace-binding.ts`（`MemberBindingUpsertRequest`/`MemberBindingView` 类型）由 task-11 处理。本任务组件侧删 import + 删字段透传，类型定义不动。
- **无 depends_on**：与 task-01~09 后端可并行（前端类型层断链由 task-11+task-12 兜底）；typecheck 全绿需 task-01+task-11+task-12 先行。execute 排在 Wave 4，与 task-11（lib+pages）+ task-12（api-types）同 Wave 协调。
- **阻塞 task-14**（前端测试精简）：本任务删 server-local 分支后，对应组件测试 case（scan-dialog radio 切换、access-guide 路径来源下拉、config-card server-local-no-daemon testid 断言）由 task-14 清理。
- **跨任务签名耦合**：`scanGenerate` 签名（task-11 收敛）影响 config-card.tsx 调用点(308)；`CreateWorkspaceInput`（task-11 删 path_source）影响 scan-dialog.tsx(123)；`MemberBindingUpsertRequest`（task-11 删 path_source）影响 access-guide.tsx(116) + daemon-switcher.tsx(98)；`AccessGuideInitial`（本任务改）影响 binding-guard.tsx(57-61)。execute 时核对同 Wave 内 task-11 同步。
- **workspace-card.tsx / workspace-switcher.tsx 近零改**：grep 核实两文件无功能代码命中 path_source/daemon_runtime_id（card 仅注释、switcher 零匹配）。execute 时勿过度改动——card 仅清注释、switcher 不动。design §6 标注的「workspace-card.tsx:98 读 path_source」实测有误（第 98 行是 `setError` 非 path_source 读取），path_source 耦合实通过 WorkspacePathFields 透传，由 path-fields.tsx 节处理。
