---
author: qinyi
created_at: 2026-07-05T01:01:22
change: 2026-07-05-workspace-config-card
stage: brainstorm
---

# Design — 工作区配置卡（WorkspaceConfigCard）

## 1. 背景

工作区详情页现有「规范管理（Spec Workspace）」区块（`workspaces/[id]/page.tsx` 第 598-825 行）只读展示部分服务器侧 spec 信息（spec_root / sync_status / profile_version / last_synced_at），而当前用户在该工作区的接入信息（绑定守护进程、本地项目路径、初始化状态）藏在「编辑我的接入配置」按钮后的弹层里，普通用户打开详情页**看不到自己机器上文档到底存在哪、自己接的是哪个守护进程**，也无法一眼看清整体配置。

用户原话诉求：「工作区页面应该能看到 `.sillyspec-platform.json` 对应的配置信息，方便用户知道对应的文档存储位置；specRoot 和 runtimeRoot 支持修改；不同用户配置可能不同，但多个用户共用同一个工作区」。

经调研澄清（详见 §11 决策追踪）：
- 项目根那份 camelCase 字段的 `.sillyspec-platform.json` 是**历史遗留**，全项目源码无写入方、不被任何代码读取，**不作为数据源**。
- 当前真实生效的"工作区配置"在 backend DB 两张表：`workspace_member_runtimes`（per-member）+ `spec_workspaces`（工作区级共享），通过已有 API 暴露。
- daemon 写的新 schema `.sillyspec-platform.json`（snake_case 6 字段）是 daemon 自用的版本保鲜文件，前端不直接展示，信息已被 DB 字段覆盖。

## 2. 设计目标

- **G1 一处看清**：把当前用户在该工作区的接入信息 + 工作区共享文档存储信息整合到详情页一张「我的工作区配置」卡片内，按"我的接入（per-member 可编辑）"+"工作区文档存储（共享只读）"两组分组展示。
- **G2 强化 per-member 编辑**：把"编辑我的接入配置"入口做到卡片显眼位置（"我的接入"组右上角），点击就地展开编辑表单（复用现有 WorkspaceAccessGuide 编辑模式），保存后刷新+收起。
- **G3 共享字段只读**：服务器文档目录（spec_root）/ runtime 目录（runtime_root）/ 守护进程本地缓存（cache_root）/ 文档版本（spec_version）/ 同步状态等全工作区共享字段保持只读展示，不带编辑入口（改动影响所有成员，需做迁移，非本变更范围）。
- **G4 跨平台路径可读**：所有路径用等宽字体 + 截断 + tooltip；daemon 本地缓存路径含 `~` 配通俗解释（Windows/macOS/Linux 各自含义）。
- **G5 详情页减载**：把配置展示+编辑+操作按钮逻辑从已 800+ 行的 `page.tsx` 抽到自包含组件，详情页只渲染 `<WorkspaceConfigCard>`。

## 3. 非目标

- **N1 不让 spec_root/runtime_root 可编辑**：这俩是工作区共享、平台权威值，改它=整树文档迁移+影响所有成员，本变更不做（用户已通过 AskUserQuestion 确认放弃）。
- **N2 不读项目根过时的 `.sillyspec-platform.json`**：该文件已不被读，前端也不读本地文件系统。
- **N3 不碰 daemon 写的新 schema `.sillyspec-platform.json`**：那是 daemon 自用保鲜文件，前端不展示。
- **N4 不新增 backend API / 不改 schema**：所需数据 `GET /api/workspaces/{id}/my-binding`（MemberBindingView）+ `GET /api/workspaces/{id}/spec-workspace`（SpecWorkspaceRead）已存在；daemon 元数据复用详情页已加载的 daemon list（见 §7.R-03）。
- **N5 不改 daemon 端代码**：daemon 不在本次范围。
- **N6 不改策略运行时切换**：strategy 仍创建时定死，只读展示。

## 4. 拆分判断

本次为单一功能模块（工作区详情页配置卡片整合 + 编辑入口强化），不满足拆分条件（<3 独立模块、<3 角色视图、无跨页面状态流转、模块内聚不可独立分），任务数预估 5-7 个，远低于批量模式门槛。走标准 brainstorm→plan→execute→verify。详见 step 5 评估。

## 5. 总体方案

### 5.1 组件结构（方案 A · 新建独立配置卡组件）

新建 `<WorkspaceConfigCard {...props} />`，**操作逻辑自包含、共享数据走 props**（避免与 page.tsx `load()` 重复请求）：

- **Props 接收的共享数据**（page.tsx 已加载，多区块共用，不重复请求）：
  - `workspace: Workspace`（path_source / root_path / daemon_runtime_id 等）
  - `specWs: SpecWorkspace | null`（工作区文档存储组 + handlers 内部门禁用）
  - `myBinding: MemberBindingView | null`（我的接入组 + init 状态）
  - `boundDaemon: DaemonInstanceRead | null`（绑定 daemon 元数据 hostname/alias/provider，page.tsx 第 234 行 useEffect 已 find）
  - `isOwner: boolean`（扫描门禁）
  - `onRefresh: () => void`（操作完成后通知 page.tsx reload 共享数据，如 scan 后 componentCount 变）
- **卡片内部自管理**（配置展示特有，page.tsx 不再持有）：
  - 编辑表单展开/收起状态
  - 操作按钮相关 state：`initing` / `initSyncedAt` / `syncStatus` / `syncError` / `scanning` / `activeScanRunId` / `scanStatus` / `scanError` / `importing` / `importPhase`
  - handlers：`handleInit` / `handleScan` / `handleSyncManual` / `handleImport` / `handleGenerateProjects`（从 page.tsx 264-441 行等价迁入，含 initPollRef / syncPollRef 轮询 + visibilitychange 暂停 + 5min 上限 + 409 重扫确认 + 卸载清理）
- **派生值**（前端拼，无需后端）：
  - `runtime_root = specWs.spec_root + "/runtime"`
  - `cache_root = "~/.sillyhub/daemon/specs/" + workspace.id`（仅 daemon-client 工作区展示）
- **UI**：复用现有 SectionCard 外壳，内分两组：
  - **「我的接入」组**（per-member，来自 `MemberBindingView`）：绑定守护进程 / 本地项目路径 / 路径来源 / 接入初始化状态 / 上次接入同步；右上角「编辑我的接入」按钮（就地展开 WorkspaceAccessGuide 编辑模式）。
  - **「工作区文档存储」组**（共享只读，来自 `SpecWorkspaceRead`）：服务器文档目录 / runtime 目录 / 守护进程本地缓存（带 tooltip）/ 文档版本 / 同步状态 / 上次文档同步 / spec 策略。
- **操作按钮**：现有详情页"规范管理"区的「初始化 / 扫描 / 同步到服务器 / 导入」按钮（page.tsx 600-674 行）迁移到卡片头部 `head-actions`，按 `isOwner` + 数据状态条件渲染；事件处理（handleInit / handleScan / handleSyncManual / handleImport）的逻辑从 page.tsx 迁入卡片内部。

### 5.2 详情页改造

`workspaces/[id]/page.tsx`：
- 删除第 598-825 行「规范管理（Spec Workspace）」SectionCard 整段 JSX（含散落的 spec_root/sync_status/profile_version/last_synced_at 只读展示 + 操作按钮 + 三态引导逻辑）。
- 替换为 `<WorkspaceConfigCard workspaceId={workspace.id} isOwner={isOwner} />`。
- page.tsx 不再需要保留 `specWs` / `binding` / `init` / `sync` 等配置相关 state（迁入卡片），但保留 PageHeader / 基本信息 SectionCard / 默认智能体 SectionCard / Overview 四宫格 / Quick nav 等其他区块。

### 5.3 状态分支

| 状态 | 触发条件 | 展示 |
|---|---|---|
| loading | 数据未到 | 两组骨架占位（skeleton dl 网格） |
| error | 任一 API 失败 | 错误提示 + 重试按钮（重新调失败的那个 API） |
| 未绑定 | `binding == null` | 「我的接入」组渲染 WorkspaceAccessGuide **首次模式**（引导表单：daemon_id + root_path + path_source）；「工作区文档存储」组仍展示（共享只读，不依赖 binding） |
| 已绑定·未初始化 | `binding != null && binding.init_synced_at == null` | 两组完整展示；「我的接入」组挂"未初始化" amber 徽标 + 「初始化」按钮（调 initDispatch，复用现有轮询）|
| 已绑定·已初始化 | `binding != null && binding.init_synced_at != null` | 两组完整展示；「我的接入」组挂"已初始化" emerald 徽标 |
| server-local | `binding.path_source === 'server-local'` | 隐藏「绑定守护进程」「守护进程本地缓存」字段（无 daemon 概念）；「绑定守护进程」位显示"服务器本地工作区，无需守护进程"说明 |

### 5.4 编辑入口

- 「我的接入」组右上角「编辑我的接入」按钮（`data-testid="config-edit-entry"`），点击就地展开 WorkspaceAccessGuide 编辑模式（回填当前 binding），保存（`upsertMyBinding`）后调 `onRefresh` + 收起。
- 「工作区文档存储」组**无编辑入口**（共享只读）。
- **与现有 `WorkspaceDaemonSwitcher` 的关系**（核实代码后澄清）：详情页"基本信息"SectionCard（page.tsx 第 504-512 行）现有 `WorkspaceDaemonSwitcher` 是**快速改绑 daemon** 的便捷入口（仅 daemon-client，调 `upsertMyBinding` 改 daemon_id）；新卡片"编辑我的接入"是**完整编辑**入口（daemon_id + root_path + path_source 三字段）。两者职责不同、可共存——switcher 是"一键切换 daemon"的轻量操作，卡片编辑入口是"完整接入配置"。Design Grill 核实：page.tsx **未** import `WorkspaceBindingGuard`，原 R-05"与 BindingGuard 重复入口"判断不成立，已删除。

### 5.5 跨平台路径展示

- 所有路径用 `font-mono + truncate`（详情页现有约定，见 prototype token `.mono-path`）。
- daemon 本地缓存展示约定模板 `~/.sillyhub/daemon/specs/<workspaceId>`，配 tooltip：「守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: `C:\Users\<你>`；macOS/Linux: `/home/<你>`）」。
- 服务器路径（spec_root）按 API 返回原样展示（容器内/服务器绝对路径，如 `/data/sillyspec-data/<ws>`）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/workspace-config-card.tsx` | 主组件：状态分支 + 两组布局 + 编辑入口 + 操作按钮 handlers/state（从 page.tsx 等价迁入）；接收 `workspace/specWs/myBinding/boundDaemon/isOwner/onRefresh` props |
| 新增 | `frontend/src/components/workspace-config-card.test.tsx` | 组件测试：覆盖 §5.3 全部状态分支 + 编辑流程 + server-local 隐藏 + 路径展示 + 各操作按钮（init/scan/sync/import）行为含轮询+卸载清理 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 删除第 598-825 行「规范管理」SectionCard + 配置相关 state/handlers（initing/syncStatus/scanStatus/activeScanRunId/importing/importPhase/initSyncedAt + handleInit/handleScan/handleSyncManual/handleImport/handleGenerateProjects + initPollRef/syncPollRef），替换为 `<WorkspaceConfigCard workspace={workspace} specWs={specWs} myBinding={myBinding} boundDaemon={boundDaemon} isOwner={isOwner} onRefresh={load} />`。**保留** workspace/specWs/myBinding/boundDaemon/boundDaemonProviders/boundRuntime/componentCount/... 等共享 state（"基本信息"/"默认智能体"/Overview 等区块共用） |

不涉及 backend / daemon / migration 文件，不改 `workspace-binding-guard.tsx`（详情页未引用）。

## 7. 接口定义

### 7.1 组件 Props

```tsx
interface WorkspaceConfigCardProps {
  workspace: Workspace;                      // 工作区基础信息（path_source/root_path/daemon_runtime_id/owner 等）
  specWs: SpecWorkspace | null;              // 工作区文档存储（共享只读组展示 + handlers 门禁）
  myBinding: MemberBindingView | null;       // 我的接入（per-member 组展示 + init 状态徽标）
  boundDaemon: DaemonInstanceRead | null;    // 绑定 daemon 元数据（hostname/alias/provider，page.tsx 已加载）
  isOwner: boolean;                          // 当前用户是否 owner（控制扫描按钮 disabled）
  onRefresh: () => void;                     // 操作完成后回调 page.tsx reload（如 scan/import/sync 后刷新共享数据）
}
```

**说明**：page.tsx `load()` 已加载 workspace/specWs/myBinding/boundDaemon 等共享数据（且 `boundDaemon` 在第 214-247 行 useEffect 按 `myBinding.daemon_id` 从 `listDaemonInstances` find），这些数据被"基本信息"/"默认智能体"/Overview 等多区块共用，**卡片走 props 接收不重复请求**。卡片内部仅自管理配置展示特有的 state（编辑表单展开 + 操作按钮 state）+ handlers。

### 7.2 数据来源（已有 API，不改）

| 数据 | API | 类型 | 关键字段 |
|---|---|---|---|
| 我的接入 | `GET /api/workspaces/{id}/my-binding` | `MemberBindingView \| null` | daemon_id, runtime_id, root_path, path_source, synced_at, last_scan_at, init_synced_at, init_synced_spec_version |
| 工作区文档存储 | `GET /api/workspaces/{id}/spec-workspace` | `SpecWorkspaceRead` | spec_root, strategy, profile_version, spec_version, sync_status, last_synced_at, repo_sillyspec_path |
| daemon 元数据（hostname/display_alias/provider/online） | `GET /api/daemon-instances` 或详情页已加载数据 | `DaemonInstance[]` | 按 binding.daemon_id 过滤；R-03 二选一 |

### 7.3 派生值（前端计算）

```ts
const runtimeRoot = specWs?.spec_root ? `${specWs.spec_root}/runtime` : null;
const cacheRoot = `~/.sillyhub/daemon/specs/${workspaceId}`;  // 仅 daemon-client 展示
```

### 7.4 字段映射表

**「我的接入」组**（`MemberBindingView` → 展示）

| 展示字段 | API 字段 | 可编辑 | 备注 |
|---|---|---|---|
| 绑定守护进程 | `binding.daemon_id` → daemon 元数据 | ✅ | daemon-chip：hostname + alias + provider 徽标 + online dot |
| 我的本地项目路径 | `binding.root_path` | ✅ | mono-path + truncate + tooltip 全路径 |
| 路径来源 | `binding.path_source` | ✅ | badge：daemon-client (blue) / server-local (slate) |
| 接入初始化状态 | `binding.init_synced_at` | 只读 | emerald"已初始化" / amber"未初始化" 徽标 + 时间 + 文档版本 |
| 上次接入同步 | `binding.synced_at` | 只读 | 本地化时间 |

**「工作区文档存储」组**（`SpecWorkspaceRead` + 派生 → 展示）

| 展示字段 | 来源 | 可编辑 | 备注 |
|---|---|---|---|
| 服务器文档目录 | `specWs.spec_root` | 只读 | mono-path + truncate |
| runtime 目录 | 派生 `runtimeRoot` | 只读 | mono-path + truncate |
| 守护进程本地缓存 | 派生 `cacheRoot` | 只读 | 仅 daemon-client；mono-path + tooltip 通俗解释 `~` |
| 同步状态 | `specWs.sync_status` | 只读 | badge：synced (emerald) / pending (amber) / failed (red) |
| 上次文档同步 | `specWs.last_synced_at` | 只读 | 本地化时间 |
| spec 策略 | `specWs.strategy` | 只读 | platform-managed / repo-mirrored / repo-native + 中文释义 |

> **字段陷阱（Design Grill step 12 后补查 frontend 类型发现）**：design 初稿曾列「文档版本 spec_version」字段，但核实 `frontend/src/lib/spec-workspaces.ts:11-22` 的 `SpecWorkspace` 类型 + `api-types.ts:11236` 的 `SpecWorkspaceRead` + `backend/app/modules/spec_workspace/schema.py:32-44` 的 `SpecWorkspaceRead` Pydantic schema **均无 `spec_version` 字段**（只有 `profile_version`，语义是 scan profile 格式版本非文档递增版本）。这是 `2026-07-02-workspace-config-flow` task-09 给 model 加了 `spec_version` DB 列但未暴露到 Read schema 的遗漏。本变更**不展示工作区级文档版本**（避免扩大范围碰 backend schema），仅「我的接入」组展示 `myBinding.init_synced_spec_version`（前端已有，表示成员本地初始化时的版本快照）。详见 R-07。

### 7.5 生命周期契约表

**判定**：本变更关键词扫描命中"daemon"（守护进程），但**仅消费已有 API 返回的 daemon 元数据做只读展示**，不引入、不修改任何 daemon / lease / session / agent_run / heartbeat 生命周期事件。现有 lease 流程（claim / session / submit / turn result / session end）、init lease 流程、spec-sync outbox 流程**全部不变**。

| 事件 | 是否涉及 | 说明 |
|---|---|---|
| claim lease / create session / submit message / turn result / session end | ❌ 不涉及 | 仅展示，不触发 |
| init lease（initDispatch） | ⚠️ 复用不修改 | 卡片"初始化"按钮调现有 `initDispatch(workspaceId)`，逻辑等价搬迁自 page.tsx handleInit |
| spec-sync outbox（syncManual） | ⚠️ 复用不修改 | 卡片"同步到服务器"按钮调现有 `syncManual(workspaceId)`，逻辑等价搬迁自 page.tsx handleSyncManual |
| heartbeat / lease polling | ❌ 不涉及 | 现有轮询机制不变 |

结论：本变更无新增生命周期事件，无需新增生命周期契约行；搬迁的 initDispatch/syncManual 调用保持与 page.tsx 原逻辑等价（含 initPollRef / syncPollRef 轮询 + 卸载清理），由测试覆盖。

## 8. 数据模型

不涉及。本次为前端展示整合，不新增/不改任何 DB 表结构、不新增 Alembic migration。所有数据来自已有 API。

## 9. 兼容策略（brownfield）

- **未配置新功能时行为不变**：替换前后，详情页"规范管理"区展示的信息字段是原字段的**超集**（新增 cache_root / runtime_root / daemon 元数据 / init 状态徽标 / 上次接入同步等），原有 spec_root / sync_status / profile_version / last_synced_at / repo_sillyspec_path 继续展示。
- **操作按钮逻辑等价搬迁**：初始化 / 扫描 / 同步到服务器 / 导入按钮的事件处理（含 409 重扫确认、init 轮询、sync 状态机轮询、卸载/visibilitychange 暂停）从 page.tsx 等价迁入卡片内部，行为对等。
- **API 不变**：`GET /my-binding`、`GET /spec-workspace`、`initDispatch`、`syncManual`、`scanWorkspace` 等所有调用方签名与返回结构零改动。
- **不改变的表结构**：`workspace_member_runtimes` / `spec_workspaces` / `daemon_instances` 全部不变。
- **回退路径**：若新卡片有问题，git revert 本次 frontend 改动即可恢复原 page.tsx 第 598-825 行 SectionCard（无 DB / API 依赖，纯前端回退）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 操作按钮 handlers（handleInit/handleScan/handleSyncManual/handleImport/handleGenerateProjects）从 page.tsx 等价迁入卡片，含状态机（initPollRef/syncPollRef 轮询、visibilitychange 暂停、5min 上限、409 重扫确认、SSE onProgress、卸载清理）；这些 handler 原依赖 page.tsx 多个共享 state（specWs/componentCount/workspace），搬迁易遗漏导致回归 | P0 | TDD：先写组件测试覆盖每个按钮现有行为（含轮询+卸载清理+visibilitychange），再搬迁；搬迁后跑详情页现有测试（page.test.tsx）+ 新组件测试全绿；共享数据通过 props + onRefresh 回调传递，handler 内部用 props.specWs/workspace 等 |
| R-02 | server-local 工作区字段差异（无 daemon/cache_root）条件渲染遗漏，导致 server-local 工作区显示空字段或错误 daemon 信息 | P2 | 测试覆盖 server-local 状态分支；path_source==='server-local' 时显式隐藏 daemon/cache_root 字段并展示说明文案 |
| R-03 | ~~daemon 元数据来源未定~~ **已解决**：page.tsx 第 214-247 行 useEffect 已按 `myBinding.daemon_id` 从 `listDaemonInstances` find 出 `boundDaemon`（供基本信息区 WorkspacePathFields 用），卡片走 props 接收 `boundDaemon` 即可，无重复请求 | P2（已降级） | 实现时直接用 props.boundDaemon；如未来基本信息区不再需要 boundDaemon，可考虑迁入卡片独立加载 |
| R-04 | daemon 本地缓存路径含 `~`，前端无法知道用户实际 home 目录，展示约定模板可能让用户困惑 | P2 | tooltip 通俗解释 `~` 三平台含义；文案"守护进程在你电脑上的缓存副本"；约定模板对齐 daemon 端 `~/.sillyhub/daemon/specs/<ws>` 真实路径 |
| R-05 | ~~与现有 WorkspaceBindingGuard 编辑入口重复~~ **已排除**：Design Grill 核实 page.tsx 未 import `WorkspaceBindingGuard`，详情页无该组件渲染；唯一改 binding 入口是基本信息区 `WorkspaceDaemonSwitcher`（仅改 daemon_id 的轻量入口），与新卡片"完整编辑接入"（daemon+path+source）职责不同，共存不冲突 | P2（已排除） | 无需处理；保留 switcher 在基本信息区不动 |
| R-06 | 删除 page.tsx 第 598-825 行"规范管理"区后，specWs 的依赖断链：specWs 被 handleScan/handleSyncManual/handleImport 内部用（门禁/参数）；这些 handler 迁入卡片后需用 props.specWs | P2 | handlers 迁入卡片时把内部对 specWs 的引用改读 props.specWs；page.tsx 顶层 specWs state 保留（卡片 props 来源），其他区块不再读 specWs（已确认只有"规范管理"区读） |
| R-07 | design 初稿假设前端能展示工作区级 `spec_version`（文档递增版本），但核实 frontend `SpecWorkspace` 类型（spec-workspaces.ts:11-22）+ `SpecWorkspaceRead`（api-types.ts:11236）+ backend `SpecWorkspaceRead` schema（schema.py:32-44）**均无此字段**，只有 `profile_version`（语义是 scan profile 格式版本非文档递增版本）—— `2026-07-02-workspace-config-flow` task-09 给 model 加了 spec_version DB 列但未暴露到 Read schema 的遗漏 | P2 | 本变更**不展示**工作区级文档版本（避免扩大范围碰 backend schema，违反 N4 非目标）；「我的接入」组仍展示 `myBinding.init_synced_spec_version`（前端已有，per-member 初始化版本快照，对用户更有意义）；workspace-config-flow 后续补 spec_version 到 SpecWorkspaceRead schema + 重新 gen:types 后，本卡片可低成本加回该字段 |

## 11. 决策追踪

| 决策 ID | 问题 | 答案 | 覆盖章节 / FR |
|---|---|---|---|
| D-001@V1 | 配置信息数据源用哪个？项目根 `.sillyspec-platform.json`（过时）还是 backend DB？ | backend DB（my-binding + spec-workspace），不读项目根过时文件 | §1 背景 / §3 N2 / FR-001 |
| D-002@V1 | specRoot/runtimeRoot 是否支持修改？ | 保持只读（共享权威值）；可编辑范围=per-member root_path/daemon/path_source | §3 N1 / §5.1 / FR-002 |
| D-003@V1 | 卡片放在详情页哪里？与现有「规范管理」区关系？ | 升级现有「规范管理」区为「我的工作区配置」卡，不新增独立区块 | §5.2 / FR-003 |
| D-004@V1 | 是否展示 daemon 本地缓存路径（cache_root）？ | 展示约定模板 + 通俗 tooltip 解释 `~` | §5.5 / FR-004 |
| D-005@V1 | 卡片组件怎么组织？ | 新建独立 WorkspaceConfigCard 单组件，复用现有 WorkspaceAccessGuide + WorkspaceBindingGuard 子组件不重写 | §5.1 / §6 / FR-005 |

详见 `decisions.md`。

## 12. 自审

| 检查项 | 结果 | 说明 |
|---|---|---|
| design.md 12 章节齐全 | ✅ | 背景/目标/非目标/拆分/方案/文件清单/接口/生命周期/数据模型/兼容/风险/决策/自审 |
| 生命周期契约表判定 | ✅ | 命中"daemon"关键词但仅展示元数据不触发生命周期事件，§7.5 显式说明每个事件不涉及/复用不修改 |
| 文件变更清单具体 | ✅ | 3 文件（2 新增 + 1 修改），无 backend / daemon / migration，不改 binding-guard（详情页未引用） |
| 字段映射完整 | ✅ | §7.4 两组字段各列展示字段/来源/可编辑/备注 |
| 状态分支完整 | ✅ | §5.3 六态：loading/error/未绑定/已绑定未初始化/已绑定已初始化/server-local |
| 跨平台路径 | ✅ | §5.5 mono+truncate+tooltip，cache_root 含 `~` 三平台解释 |
| 兼容策略 | ✅ | §9 字段超集（行为对等）+ 按钮逻辑等价搬迁 + 纯前端回退 |
| 决策 ID 格式 | ✅ | 大写 `@V1`（按 sillyspec 校验器要求） |
| 风险等级合理 | ✅ | 1 P0（R-01 操作按钮 handlers 搬迁含轮询/状态机）+ 3 P2 active（R-02/R-04/R-06）+ 2 P2 留痕（R-03 已解决 / R-05 已排除） |
| YAGNI | ✅ | 不做 spec_root 编辑、不做策略切换、不读旧文件、不加不必要后端 API、不拆两子组件 |
| 复用现有组件 | ✅ | WorkspaceAccessGuide（首次+编辑模式）不重写；卡片自管理未绑定/已绑定分支（不强制用 BindingGuard） |
| Design Grill 交叉审查 | ✅ | 已审 + 子代理 TaskCard 写作时补查类型，共修正 5 处偏差：① R-05 删除（BindingGuard 未在详情页渲染，page.tsx imports 核实）② R-03 降级（boundDaemon 在 page.tsx 第 234 行 useEffect 已加载，走 props 不重复请求）③ R-01 升 P0（handlers 搬迁含 initPollRef/syncPollRef 状态机，依赖共享 state 通过 props 传递）④ §6 移除 binding-guard 改动 ⑤ R-07（spec_version 字段陷阱：frontend SpecWorkspace 类型 + SpecWorkspaceRead + backend schema 均无此字段，本变更移除工作区级版本展示，仅保留 myBinding.init_synced_spec_version）。修正见 §5.1/§5.4/§6/§7.1/§7.4/§10 |

**自审结论**：design.md 自洽 + Design Grill 修正完成，可进入 step 13 用户确认。
