---
author: qinyi
created_at: 2026-06-28T04:12:00
---

# Design — daemon-client workspace spec 同步策略可选

## 1. 背景

daemon-client workspace（源码在客户端机器、backend 不可直读）当前创建时被强制设为 `spec_workspaces.strategy='platform-managed'`（`workspace/service.py:1100 _ensure_empty_spec_workspace` + `:1116` 硬编码）。此策略下 daemon 用独立缓存 `~/.sillyhub/daemon/specs/{ws}` 跑 sillyspec（`--spec-root` 指向它，见 `daemon.ts:2279`），源项目自带的 `rootPath/.sillyspec`（用户原本用 SillySpec 管理的项目内容）被**完全旁路**——daemon 在空缓存里从零 scan，源项目已有的 docs/changes/runtime 不会进入 daemon 缓存，也就不会经 `postSpecSync` 回灌到平台 specRoot。

结果：当用户把一个已有 `.sillyspec` 的项目作为 daemon-client workspace 接入平台时，平台上的 scan-docs/knowledge/runtime/changes 初始全空，源项目已有内容缺失。

`spec_workspaces.strategy` 字段（`model.py:21`）已预留三值 `platform-managed` / `repo-mirrored` / `repo-native`，但 daemon-client 路径只实现了 platform-managed，另两个值的语义从未落地。

## 2. 设计目标

- **G1**：daemon-client workspace 创建时，用户可选 spec 同步 strategy（三值），决定源项目已有 `.sillyspec` 如何进入平台。
- **G2**：`repo-mirrored`（单次导入）——初始化时把源项目 `.sillyspec` 单次复制到 daemon 缓存，源项目已有内容立即可用，不污染源项目。
- **G3**：`repo-native`（源项目即真理）——daemon 建 junction 让缓存指向源项目 `.sillyspec`，scan 直接操作源项目，实时双向。
- **G4**：strategy 经 scan lease payload 从 backend 透传到 daemon，daemon 在 pull 阶段自治分支（落实 D-001）。
- **G5**：platform-managed 默认值零回归，现有 daemon-client workspace 行为不变。

## 3. 非目标

- **不做 server-local workspace 的 strategy 选项**（D-003）：server-local 的 repo-native 软链接落 backend Docker 容器内（container_path_prefix 路径），机制不同于 daemon-client 客户端 junction，后续单独变更。
- **不做 strategy 运行时切换**：v1 创建时定死，不支持事后改 strategy（YAGNI）。
- **不做 repo-mirrored 持续双向同步**：D-002 明确仅初始化单次快照，源项目后续变更不自动反映。
- **不改 sillyspec CLI 的 `--spec-root` 语义**、不改 daemon 本地缓存路径 `~/.sillyhub/daemon/specs/{ws}`。
- **不改 tar transport 通路本身**（build_bundle/apply_sync/postSpecSync 整树覆写语义不变），strategy 只影响 daemon 侧 pull 阶段的缓存初始化方式。
- **不做 server-local 的 .runtime 补全**（当前 copytree 排除 .runtime，属另一独立改进）。

## 4. 拆分判断

三个 strategy 选项 + 透传链路是同一条 daemon-client spec 初始化数据流的不同环节，紧耦合：strategy 字段须经 backend 创建落库 → lease 透传 → daemon pull 分支三处一致传递，拆开会制造中间态（如只加字段不透传，daemon 收不到）。任务数预估 < 12，无批量重复模式，作为单变更 4 Phase 推进，不走批量模式。

## 5. 总体方案

### 5.0 canonical 契约（贯穿）

`spec_workspaces.strategy` 决定 daemon-client 的 spec 缓存初始化方式：

| strategy | daemon 缓存初始化 | 源项目 | 实时性 |
|---|---|---|---|
| `platform-managed`（默认） | pull bundle（404→空目录），从零 scan | 不碰 | 否 |
| `repo-mirrored` | pull 404/空时从 `rootPath/.sillyspec` 单次 `fs.cp` | 不写入 | 仅初始化一次 |
| `repo-native` | 建 junction 缓存→`rootPath/.sillyspec`，跳过 pull 覆盖 | scan 直接写 | 是 |

push（`postSpecSync`/`packSpecDir`/`apply_sync`）三策略都走，平台 specRoot 经 tar 回灌落地为镜像。

### 5.1 Phase 1 — backend：strategy 贯穿创建 + lease 透传

- **前端**（`workspace-scan-dialog.tsx`）：daemon-client 创建表单加 strategy segmented control（默认 platform-managed），三选项附语义说明（repo-native 标注"会写入源项目"，落实 D-005）。
- **schema**（`workspace/schema.py`）：`WorkspaceCreate` 加 `spec_strategy` 字段（默认 `platform-managed`，Literal 三值）。
- **workspace/service.py**：strategy 在 **workspace 创建时落 spec_workspaces**——`_ensure_empty_spec_workspace`（`:1100`）接收 strategy 参数写入 `spec_workspaces.strategy`（替换 `:1116` 硬编码）；`create` 的 daemon-client 分支（`:146-182`，前端 `workspace-scan-dialog.tsx handleCreateDaemonClient:84` 走此入口）与 `scan_generate_daemon_client` 创建 pending workspace 分支（`:1039-1063`，处理 scan-generate 首次创建路径）都把用户选择的 strategy 传给 `_ensure_empty_spec_workspace`。**后续 scan（含 scan_generate_daemon_client 的 dispatch 调用、rescan）从 spec_workspaces 表读 strategy，不需 strategy 作 scan 入参**——`scan_generate_daemon_client:1022` 签名无需加 strategy（它调 `start_scan_dispatch` 时后者自己读 `spec_ws.strategy`）。
- **agent/service.py**：`start_scan_dispatch` 读 `spec_ws.strategy`（`:1374` AgentRun.spec_strategy 改读真实值，去硬编码）；`prepare_scan_interactive_dispatch`（`:1392-1407`）加 strategy 参数。
- **daemon/lease/context.py**：`build_claim_payload` interactive 分支（task-03 改 transport 透传的同处，约 `:89-117`）加 strategy 透传，与 transport/workspaceId 并列。
- **spec_workspace/model.py**：更新 `repo-mirrored` 注释为"初始化单次同步快照"（D-002）。

### 5.2 Phase 2 — daemon：strategy 接收 + pullSpecBundle 三分支

- **types.ts**：`LeaseCtx`（execPayload）加 `specStrategy?: string` 字段（`:293` workspaceId 后），注释 `ql-20260628`。
- **daemon.ts**：`_startInteractiveSession` 读 `execPayload.specStrategy`（camelCase + snake_case 兜底，与 `:2284-2290` transport/workspaceId 风格一致），传入 `pullSpecBundle`。
- **spec-sync.ts `pullSpecBundle`**：签名扩展为 `pullSpecBundle(client, wsId, { strategy, rootPath, existingSpecRoot })`，按 strategy 分支：
  - `platform-managed`（缺省）：现状（`getSpecBundle`，404→`mkdir` 空目录）。
  - `repo-mirrored`：`getSpecBundle` 404 或本地缓存为空时，`fs.cp(rootPath/.sillyspec → specDir)` 单次复制；非 404 正常拉 bundle。
  - `repo-native`：检测 `rootPath/.sillyspec` 存在 → 建 junction（Win `fs.symlink(target, path, 'junction')` 无需提权 / Linux·macOS 普通 symlink）`specDir → rootPath/.sillyspec`，**跳过** `getSpecBundle` 覆盖；源项目 `.sillyspec` 不存在 → 降级为 repo-mirrored 单次复制 + warn。

### 5.3 Phase 3 — daemon：junction 生命周期 + push 适配 + rm 防误删

- **junction 复用**：pull 时 specDir 已是 junction → `fs.readlink` 校验目标一致则复用；是普通目录（历史残留）→ 不自动删（防误删数据），warn + 降级 platform-managed 行为。
- **rm 防误删**：现有 `pullSpecBundle` 的 `rm(specDir, {recursive})`（`spec-sync.ts:96`）在 `repo-native` 模式必须跳过（junction 不能 rm，否则顺链删源项目）——strategy 分支前置守卫，仅 platform-managed/repo-mirrored 走 rm。
- **push 适配**：`packSpecDir` 用 `readFile` 天然穿过 junction 打包源项目真实内容，无需改；核实 `walkDir` 的 `fs.stat` 默认跟随符号链接（Node `fs.stat` 跟随，`fs.lstat` 不跟随——当前用 `stat`，正确）。`postSpecSync` 三策略都走。

### 5.4 Phase 4 — 测试 + 文档

- **backend**：dispatch 透传 strategy 测（lease payload 含 specStrategy）；daemon-client 创建带 strategy 落库测；AgentRun.spec_strategy 读真实值测。
- **daemon**：`pullSpecBundle` 三分支测（platform-managed 现状回归 / repo-mirrored 404+空缓存复制 / repo-native 建 junction+跳过覆盖）；junction 复用（目标一致/普通目录残留降级）；rm 防误删（repo-native 不调 rm）；源项目不存在降级；`packSpecDir` 穿 junction 打包测。
- **跨平台**：Win junction（`fs.symlink 'junction'`）/ Linux·macOS symlink 分支单测（mock `process.platform`）。
- **文档**：spec_workspace 模块文档更新 strategy 三值语义；daemon spec-sync 模块文档补 strategy 分支 + junction 生命周期。

### 5.5 daemon-client 首次 scan 触发入口（task-14 补全）

**问题**：daemon-client workspace 经 `create` 入口（`WorkspaceService.create` daemon-client 分支 `service.py:195-218`）创建后只建空 spec_workspaces 占位记录（`_ensure_empty_spec_workspace`），**不派 scan lease**——不像 server-local 创建走 `scanGenerate`（创建+scan 一体，`workspace-scan-dialog.tsx:126`）。导致 daemon-client 创建后无首次 scan 触发机制，repo-native/repo-mirrored 策略下源项目 `.sillyspec` 数据无法回灌平台 specRoot，scan-docs/changes 初始全空（§5.0 契约表与 proposal 成功标准假设的「首次 scan」从未发生）。实证：workspace `5c22aa2e`（strategy=repo-native 已落库）创建后 daemon 从未 scan，平台 specRoot `/data/spec-workspaces/5c22aa2e-...` 空目录，源项目 `.sillyspec` 数据齐全。

**方案**：工作区详情页给 daemon-client workspace 加「扫描」按钮，复用既有 scan-generate 通路（`POST /api/workspaces/scan-generate`）。`scan_generate_daemon_client`（`service.py:1058`）对**已存在** workspace 安全复用（`_find_active_by_root_path :1076` 找到即跳过创建），并从 `spec_ws.strategy` 读真实策略派 scan lease（task-03 已实现 `start_scan_dispatch` 读 `spec_ws.strategy`）。

**UX 设计（D-006@v1）**：
- 「扫描」按钮在 daemon-client workspace 三策略（platform-managed/repo-mirrored/repo-native）全显示（`isDaemonClientWorkspace(workspace)`，`page.tsx:347` 已有同判定）。
- platform-managed 现有「初始化」bootstrap 按钮保留共存——语义不同：「初始化」=`spec-bootstrap`（sillyspec init 空结构），「扫描」=`scan-generate`（让 daemon 跑 sillyspec scan 回灌文档）。
- `scan_generate_daemon_client` 幂等（`_find_active_scan_run` 去重），首次扫描与重新扫描统一为「扫描」一个按钮。
- scan 进度复用 `AgentRunPanel`（参考 bootstrap 模式 `page.tsx:497-518`），**独立 scan 状态机**（`activeScanRunId`/`scanStatus`/`scanError`，参考 `:123-126` bootstrap 状态）与 bootstrap **互斥**（跑一个时另一个 disabled，同时只一个 spec run）。
- scan 完成 `onDone` → `load()` reload（componentCount/activeChanges/archivedChanges/specWs）。
- 错误走 `pageError`。

**前端改动**：
- `page.tsx`：extra 区 daemon-client 显示「扫描」按钮；新增 scan 状态 + `handleScan`（调 `scanGenerate`）+ AgentRunPanel 实例；scan/bootstrap 按钮 disabled 联动互斥。
- `lib/workspaces.ts`：`scanGenerate`（`:123-140`）加 `specStrategy` 参数 + 请求体 `spec_strategy` 透传（保 scan-generate 创建路径完整；daemon-client 虽走 createWorkspace 创建不经此，但透传为完整性 + 未来复用）。

**后端**：无改动。`scan_generate_daemon_client` 已支持已存在 workspace（`:1076`）；`start_scan_dispatch` 从 `spec_ws.strategy` 读真实值（task-03）；`build_claim_payload` 透传 specStrategy（task-04）；daemon 三分支 + 终态回灌（task-07/08/09 + `daemon.ts:1259-1268`）全已实现。task-14 只补前端触发入口。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/schema.py` | `WorkspaceCreate` 加 `spec_strategy` 字段（默认 platform-managed，Literal 三值） |
| 修改 | `backend/app/modules/workspace/service.py` | `_ensure_empty_spec_workspace`（:1100）接收 strategy 写库去硬编码；`create` daemon-client 分支（:146）+ `scan_generate_daemon_client` 创建 pending 分支（:1039）传 strategy 落库；后续 scan 从 spec_workspaces 表读不需入参 |
| 修改 | `backend/app/modules/agent/service.py` | `start_scan_dispatch` 读 spec_ws.strategy；AgentRun.spec_strategy（:1374）去硬编码；`prepare_scan_interactive_dispatch`（:1392）加 strategy 参数 |
| 修改 | `backend/app/modules/daemon/lease/context.py` | `build_claim_payload` interactive 分支（:89-117 task-03 同处）加 strategy 透传 |
| 修改 | `backend/app/modules/spec_workspace/model.py` | repo-mirrored 注释更新为"初始化单次同步快照"（D-002） |
| 修改 | `sillyhub-daemon/src/types.ts` | `LeaseCtx` 加 `specStrategy?: string`（:293 后） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_startInteractiveSession` 读 execPayload.specStrategy（:2284 附近）传 pullSpecBundle |
| 修改 | `sillyhub-daemon/src/spec-sync.ts` | `pullSpecBundle` 加 strategy+rootPath 参数 + 三分支；junction 生命周期 helper（建立/复用/降级）；repo-native 跳过 rm |
| 修改 | `frontend/src/components/workspace-scan-dialog.tsx` | daemon-client 创建表单加 strategy segmented control（:87 附近，默认 platform-managed，repo-native 标注写入源项目） |
| 新增 | `sillyhub-daemon/tests/spec-strategy/pull-strategy.test.ts`（暂定名） | pullSpecBundle 三分支 + junction 生命周期 + rm 防误删 + 跨平台 junction 单测 |
| 新增 | `backend/tests/modules/agent/test_dispatch_spec_strategy.py`（暂定名） | dispatch 透传 strategy + AgentRun.spec_strategy 读真实值测 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | daemon-client 详情页加「扫描」按钮（三策略全显示）+ 独立 scan 状态机 + AgentRunPanel 实例 + 与 bootstrap 互斥（task-14） |
| 修改 | `frontend/src/lib/workspaces.ts` | `scanGenerate` 加 specStrategy 参数 + 请求体 spec_strategy 透传（task-14） |
| 新增 | `frontend/src/lib/__tests__/workspaces.test.ts`（或 page.test.tsx） | scanGenerate spec_strategy 透传测 + daemon-client 三策略显示扫描按钮/点击调用/与 bootstrap 互斥测（task-14） |

## 7. 接口定义

```python
# backend/app/modules/workspace/schema.py
class WorkspaceCreate(BaseModel):
    # ...existing fields...
    spec_strategy: Literal["platform-managed", "repo-mirrored", "repo-native"] = "platform-managed"

# backend/app/modules/agent/service.py
async def start_scan_dispatch(self, ..., spec_strategy: str | None = None) -> AgentRun:
    # spec_strategy 优先用入参，回退 spec_ws.strategy，再回退 "platform-managed"
```

```typescript
// sillyhub-daemon/src/types.ts (LeaseCtx)
/**
 * ql-20260628：spec 同步策略（platform-managed/repo-mirrored/repo-native）。
 * daemon-client workspace → daemon pullSpecBundle 按此分支初始化缓存。
 */
specStrategy?: string;

// sillyhub-daemon/src/spec-sync.ts
export interface PullSpecBundleOptions {
  existingSpecRoot?: string | null;
  strategy?: string;   // 缺省 platform-managed
  rootPath?: string;   // repo-mirrored/repo-native 从源项目 .sillyspec 读
}

export async function pullSpecBundle(
  client: HubClient,
  wsId: string | undefined,
  opts: PullSpecBundleOptions = {},
): Promise<string | null>;
```

```typescript
// frontend/src/lib/workspaces.ts（task-14 补全）
export async function scanGenerate(
  rootPath: string,
  provider?: string | null,
  model?: string | null,
  pathSource?: "server-local" | "daemon-client",
  daemonRuntimeId?: string | null,
  specStrategy?: "platform-managed" | "repo-mirrored" | "repo-native",
): Promise<ScanGenerateResponse>;
// 请求体加 spec_strategy 透传（保 scan-generate 创建路径完整；daemon-client 走 createWorkspace 创建不经此，但完整性 + 未来复用）
```

## 7.5 生命周期契约表

涉及 session/lease/daemon/lifecycle 关键词，必填：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 创建 daemon-client workspace | 前端 | backend | root_path, daemon_runtime_id, **spec_strategy** | workspace active；spec_workspaces.strategy 落库 |
| scan lease claim payload 构造 | backend | daemon | workspaceId, transport, rootPath, **specStrategy** | lease pending→running（既有，新增 specStrategy 字段） |
| daemon pull 缓存初始化 | daemon | 本地 fs | specStrategy, rootPath, wsId | 缓存初始化（platform-managed 拉bundle / repo-mirrored 复制 / repo-native 建junction） |
| scan run 终态 sync | daemon | backend | workspaceId, tar(spec tree) | spec_workspaces.last_synced_at ← now（既有，三策略都走） |
| create session（既有） | backend | daemon | sessionId, leaseId, claimToken | session active（不变） |
| daemon-client 首次 scan 触发（task-14） | 前端详情页 | backend | root_path, path_source=daemon-client, daemon_runtime_id（, spec_strategy） | scan lease 派绑定 daemon（既有 scan_generate_daemon_client，新增前端入口） |

每个事件映射到 task：workspace 创建落 strategy→Phase1 task；lease payload 加 specStrategy→Phase1 context.py task；daemon pull 三分支→Phase2 task；scan 终态 sync 既有不改。`specStrategy` 字段出现在 LeaseCtx（§7）+ build_claim_payload 透传 + daemon.ts 读取。

## 8. 数据模型

**无表结构变更**。`spec_workspaces.strategy` 字段已存在（`model.py:62`，String(30)），三值已可用。本次只改：
- 写入时机：daemon-client 创建时读用户选择（当前硬编码 platform-managed）。
- 注释：repo-mirrored 语义更新（D-002）。
- DTO：`WorkspaceCreate` 加 `spec_strategy`（请求体字段，非表）。
- `AgentRun.spec_strategy`（`agent/model.py:109`）写入真实值（当前硬编码）。

## 9. 兼容策略（brownfield）

- **默认 platform-managed 零回归**：`WorkspaceCreate.spec_strategy` 默认 platform-managed；前端默认选中；未显式传 strategy 时 daemon-client 创建与 scan 行为与现状完全一致（D-004）。
- **现有 workspace 不受影响**：已存在的 spec_workspaces 行 strategy 不变；strategy 透传只在新建 scan lease 时生效。
- **daemon 缺字段兜底**：daemon 读不到 `specStrategy`（旧 backend/旧 lease）→ 按 platform-managed 处理（与现状一致），向后兼容。
- **回退**：repo-native junction 若出问题（误删风险/链接失效），用户重建 workspace 选 platform-managed 即可回退（数据可清，本项目未上线不要求历史兼容，CLAUDE.md 规则 10）。
- **API 不变**：既有 scan-generate/dispatch 端点签名不变，`spec_strategy` 为 additive 可选字段。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | repo-native 下 `rm(specDir)` 顺 junction 误删源项目 .sillyspec | P0 | strategy 分支前置守卫：repo-native 跳过 rm（spec-sync.ts:96 仅 platform-managed/repo-mirrored 走）；junction 复用校验目标一致；单测覆盖 |
| R-02 | Windows junction 创建失败（权限/跨卷/路径不可达） | P1 | try/catch 降级为 repo-mirrored 单次复制 + warn；UI 文案提示 repo-native 需客户端可访问源项目 |
| R-03 | repo-native scan 写入源项目污染 git 工作区 | P1 | UI 选项明示（D-005）；属用户主动选择的可接受副作用，不做拦截 |
| R-04 | `walkDir`/`packSpecDir` 遍历 junction 行为不符预期 | P2 | 核实 fs.stat 默认跟随链接（已确认 stat 跟随/lstat 不跟随，当前用 stat 正确）；packSpecDir 穿 junction 单测 |
| R-05 | strategy 透传链路漏字段（backend context.py 或 daemon.ts 漏读） | P1 | dispatch 透传集成测（lease payload 含 specStrategy）+ daemon 读取测；对齐 task-03 transport 透传的契约完整性验收模式 |
| R-06 | repo-mirrored 单次复制后源项目变更不反映（用户预期偏差） | P2 | UI 文案明确"仅初始化导入一次，之后平台托管"；rescan 可重新触发（既有机制） |
| R-07 | scan/bootstrap 按钮未互斥致双 spec run 并发 | P2 | scan 按钮 disabled 当 activeBootstrapRunId 存在、bootstrap 按钮 disabled 当 activeScanRunId 存在（task-14 前端联动） |
| R-08 | 用户误多次点扫描触发重复 scan lease | P3 | scan_generate_daemon_client 幂等（_find_active_scan_run 去重）兜底；scan 运行中按钮 disabled |

## 11. 决策追踪

| 决策 | 状态 | 覆盖于 |
|---|---|---|
| D-001@v1（strategy 透传链路） | accepted | §5.1 Phase1（schema/dispatch/context.py/types.ts/daemon.ts）；FR 透传；task 见文件清单 |
| D-002@v1（repo-mirrored 单次同步语义） | accepted | §5.0 契约表 + §5.2 repo-mirrored 分支 + model.py 注释 |
| D-003@v1（范围只 daemon-client） | accepted | §3 非目标 + 全变更范围约束 |
| D-004@v1（默认 platform-managed） | accepted | §5.1 前端默认 + schema 默认 + §9 兼容策略 |
| D-005@v1（repo-native 接受写入源项目） | accepted | §5.1 前端文案 + §5.2/5.3 repo-native 分支 + R-03 |
| D-006@v1（daemon-client 详情页扫描入口，三策略全显示 + 与初始化共存 + 独立状态机互斥） | accepted | §5.5 + R-07/R-08 + task-14 |

无未解决的 D-xxx。剩余风险 R-01~R-08 见上表。

## 12. 自审

- **需求覆盖**：✅ 三 strategy 全做（G1）、repo-mirrored 单次导入（G2）、repo-native junction（G3）、lease 透传（G4）、默认零回归（G5）均覆盖。task-14 补 daemon-client 首次 scan 触发入口（§5.5）覆盖 D-006——修复 proposal 成功标准「首次 scan 后平台 specRoot 含源项目已有内容」的前置缺口（创建后无触发入口）。
- **Grill/决策覆盖**：✅ design.md 引用全部 D-001~D-005（§11 决策追踪逐条映射）。
- **约束一致性**：✅ 与 ARCHITECTURE.md 的 tar transport 通路一致（不改 build_bundle/apply_sync/postSpecSync 语义，只改 daemon pull 初始化）；strategy 透传对齐 task-03 transport 透传模式（context.py 同处）。
- **真实性**：✅ 文件路径/方法名（_ensure_empty_spec_workspace / start_scan_dispatch / prepare_scan_interactive_dispatch / build_claim_payload / pullSpecBundle / resolveSpecDir / LeaseCtx）、行号（service.py:1374/1392/1100/1116、spec-sync.ts:96、daemon.ts:2284、types.ts:293、context.py:89-117）均来自真实代码查证。
- **YAGNI**：✅ 非目标显式列出（server-local/运行时切换/持续双向/CLI 语义/.runtime 补全），不包含冗余功能。
- **验收标准**：✅ Phase4 测试具体可测（三分支/junction 生命周期/rm 防误删/跨平台/透传契约）。
- **非目标清晰**：✅ §3 明确 6 项不做。
- **兼容策略**：✅ §9 说明默认零回归 + daemon 缺字段兜底 + 回退路径。
- **风险识别**：✅ R-01（rm 误删，P0）~R-06 共 6 项含对策。
- **生命周期契约表**：✅ §7.5 覆盖 workspace 创建/lease claim/pull 初始化/scan 终态 sync/create session 五事件，每事件有必需字段（specStrategy 出现在 LeaseCtx §7 + context.py 透传 + daemon.ts 读取），映射到 task。
- ⚠️ 自审存疑：无。`prepare_scan_interactive_dispatch` 所属类（RunPlacementService）的精确文件位置未逐一打开核实（agent/service.py:1388 实例化 RunPlacementService），plan 阶段定位到具体类文件再细化 task。

### 12.1 Design Grill 复核（step 12 交叉审查）

cross-check matrix：

| ID | 层级 | 交叉点 | 结论 | 处理 |
|---|---|---|---|---|
| X-001 | 定义层 | repo-mirrored「404 或缓存空」触发条件 | 首次 scan backend 无 bundle=404 时复制；缓存空仅在首次成立，表述自洽 | 无矛盾，§5.2 表述已精确 |
| X-002 | 一致性层 | repo-mirrored rm 时机（rm 再复制 vs 复制前缓存状态） | 首次复制路径缓存本空不需 rm；非首次拉 bundle 路径走既有 rm；分支化处理 | plan 阶段细化分支，design §5.3 rm 守卫已覆盖 |
| X-003 | 一致性层 | strategy 在两个创建入口（create vs scan_generate_daemon_client）的落库一致性 | 已查证：前端 daemon-client 创建走 create 入口（workspace-scan-dialog.tsx:84），strategy 创建时落 spec_workspaces；后续 scan 从表读，scan_generate_daemon_client 无需 strategy 入参 | ✅ 已修正 §5.1 + 文件变更清单表述（原"透传"歧义已消除） |
| X-004 | 可行性层 | fs.symlink('junction') Windows 无提权 | Node.js fs.symlink 第三参数 type='junction' 在 Windows 创建目录联接无需管理员权限，target 须绝对路径（rootPath/.sillyspec 是绝对路径） | 可行，R-02 降级兜底 |
| X-005 | 可行性层 | walkDir/packSpecDir 遍历 junction | Node fs.stat 默认跟随符号链接（lstat 才不跟随），spec-sync.ts walkDir 用 stat，正确穿过 junction | 可行 |

结论：Design Grill passed，无 P0/P1 unresolved blocker。X-003 为文档表述缺陷（已修正），非结构性矛盾。剩余实现细节（X-002 分支化）留 plan 阶段。
