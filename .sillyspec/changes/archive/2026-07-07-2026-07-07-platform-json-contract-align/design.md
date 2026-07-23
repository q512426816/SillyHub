---
author: qinyi
created_at: 2026-07-07T23:11:55
change: 2026-07-07-platform-json-contract-align
stage: brainstorm
status: draft
---

# platform-json 契约对齐 Design

> 关联：`docs/sillyspec/platform-json-contract-mismatch.md`（问题核实记录）；
> 覆盖决策：workspace-config-flow `D-010`（spec_version 保鲜读取处）。

## 1. 背景

### 1.1 问题
`.sillyspec-platform.json` 这个文件名被两个系统**同名同位置双写**，字段契约互不兼容：

| 系统 | 写入字段 | 风格 | 必需字段 |
|---|---|---|---|
| sillyspec 工具（全局包 v3.22.5，**不可改**） | `{specRoot, runtimeRoot, workspaceId, scanRunId, savedAt}` | camelCase | `specRoot` + `savedAt` |
| sillyhub daemon（`spec-sync.ts`） | `{workspace_id, server_origin, strategy, spec_version, cache_root, synced_at}` | snake_case | （自己定义，无 specRoot） |

sillyspec 工具读这个文件时（`progress.js:68 resolvePlatformSpecDir`）**必须有 `specRoot`**，缺则抛 `PointerUnreachableError` fail-closed 拒跑；损坏判定（`constants.js:68 isPointerCorrupted`）：`!specRoot || !savedAt` 即坏。

→ daemon 写的版本 sillyspec **读不懂**。实际运行中 sillyspec 的 `run` 命令每次会用 5 字段覆盖整个文件，掩盖了这个 bug；但**新工作区 init 后、sillyspec 还没跑就被读**时，会触发 `PointerUnreachableError` 拒跑（提示 `sillyspec platform pointer --cleanup`）。

现场活例证：本次启动 brainstorm 时，项目根 `.sillyspec-platform.json` 末尾有一个脏字符 `A` 导致 JSON 解析失败，sillyspec 直接 fail-closed 拒跑——印证该文件任何格式瑕疵都会阻塞整个流程。

### 1.2 设计依据（核实发现）
对 daemon 侧的代码核实得出 4 个关键事实（详见 `docs/sillyspec/platform-json-contract-mismatch.md`）：

1. **`readPlatformConfig`（`spec-sync.ts:814`，读完整 6 字段）零调用方 = dead code**。
2. **`server_origin` / `strategy` / `cache_root` 写后从无人读**（daemon 实际从 `config.server_url`、`resolveSpecDir(wsId)` 拿这些值）—— 4 个字段中 3 个是 dead-write。
3. 真正被读的字段只有两个：
   - `spec_version`：保鲜比对（`daemon.ts:2816` + `task-runner.ts:427` 调 `readLocalSpecVersion`）
   - `synced_at`：回灌判断（`hasUnsyncedLocalChanges` `spec-sync.ts:236`）
4. sillyspec `run` 每次覆盖整个文件 → daemon 即使按 sillyspec 格式补字段，自己的额外字段也会被冲掉，"混合格式"不可行。

## 2. 设计目标

- **消除双写冲突**：daemon 退出 `.sillyspec-platform.json` 的写入，该文件交 sillyspec 工具独占。
- **状态独立**：daemon 唯一需要的 `spec_version` 保鲜状态迁到 sillyspec 不会覆盖的位置（daemon 自己的缓存目录）。
- **清理 dead code**：删除 `readPlatformConfig` + 4 个 dead-write 字段 + `writePlatformConfig` 整个函数链。

## 3. 非目标

- 不改 sillyspec 工具（全局第三方包，单向对齐）。
- 不迁移现有 `.sillyspec-platform.json` 文件（daemon 删除读取路径后，旧文件自然失效；sillyspec 格式文件由 sillyspec 继续管）。
- 不改 spec 同步传输层（tar bundle pull/post、`pullSpecBundle` / `postSpecSync` / `syncSpecTreeIfNeeded` 逻辑不变）。
- 不改 workspace-config-flow 其它决策（D-002 init lease 编排骨架不变，仅替换第 1 步"配置写入"的目标文件）。
- 不改 backend（init lease payload 不变，daemon 侧自行消化）。

## 4. 拆分判断

单一契约修复，**不拆分、不走批量**（Step 5 评估）：聚焦 `spec-sync.ts` 一个模块 + 2 个调用点；非 3+ 独立功能模块；无多角色权限；无跨页面状态流转；任务数 <10、非模板×数据。

## 5. 总体方案

**D-001@v1**：daemon 退出 `.sillyspec-platform.json` 写入，`spec_version` 状态独立到 daemon 缓存目录。

> 决策依据：核实确认 daemon 6 字段中 4 个为 dead-write、`readPlatformConfig` 零调用、sillyspec 覆盖整文件——保留 daemon 字段既不可行也无意义。方案 1（停写 + 状态独立 + 清理 dead code）在三方案对比中胜出（详见 decisions.md）。

### Phase 1 — 数据层：新状态文件 `spec-version.json`

- **位置**：`~/.sillyhub/daemon/specs/<wsId>/.runtime/spec-version.json`（daemon 本地缓存目录的 `.runtime/` 下，sillyspec 工具不触碰，不污染源码项目）。
- **schema**：
  ```json
  {
    "spec_version": 0,
    "synced_at": "2026-07-07T14:09:47.787Z"
  }
  ```
- **生命周期**：init lease 创建（替代原 `writePlatformConfig` 的角色），随缓存目录清理消失。
- **归属**：daemon 独占读写，与 sillyspec 的 `.sillyspec-platform.json` 完全解耦。

### Phase 2 — `spec-sync.ts` 函数迁移

| 操作 | 符号 | 说明 |
|---|---|---|
| 删除 | `writePlatformConfig`（`:866`） | init lease 不再写 `.sillyspec-platform.json` |
| 删除 | `readPlatformConfig`（`:814`） | dead code（零调用方） |
| 删除 | `PlatformConfig` 接口（`:794`） | 6 字段接口随函数删除 |
| 删除 | `PLATFORM_CONFIG_FILENAME` 常量（`:668`） | 改名 |
| 新增 | `DAEMON_STATE_FILENAME = '.runtime/spec-version.json'` | 新状态文件相对路径常量 |
| 新增 | `DaemonState` 接口 | `{spec_version: number, synced_at: string}` |
| 新增 | `writeDaemonState(specCacheRoot, state)` | init lease 首写状态文件（替代 writePlatformConfig） |
| 改写 | `readLocalSpecVersion`（`:683`） | 入参 `rootPath`→`specCacheRoot`；读 `{specCacheRoot}/.runtime/spec-version.json` |
| 改写 | `bumpLocalSpecVersion`（`:742`） | 入参同上；patch 同一文件的 `spec_version` + `synced_at`；保留"文件不存在则跳过"语义 |
| 改写 | `hasUnsyncedLocalChanges`（`:236`） | `synced_at` 改从 `{specDir}/.runtime/spec-version.json` 读（`specDir` 即缓存根，省去 `opts.rootPath`）。调用方仅 `pullSpecBundle:148` 默认 checker，`opts` 变可选后调用方式 `checker(specDir)` 不变 |
| 不变 | `shouldRefreshSpec`（`:719`） | 纯函数，无 IO |
| 不变 | `pullSpecBundle`（`:148` 默认 checker） | checker 调用方式不变，pullSpecBundle 本身不改 |
| 改写 | `handleInitLease`（`:927`）编排 | 第 1 步 `writePlatformConfig` → `writeDaemonState`；pull/post 步骤不变；生命周期标记 `config_written` 语义改为"daemon 状态文件已写" |

### Phase 3 — 调用点 + 编排

- **`task-runner.ts:427 / :448`**（batch 路径，`_runInitLease` 外的 9 步编排）：
  - `readLocalSpecVersion(ctx.rootPath)` → `readLocalSpecVersion(resolveSpecDir(wsId))`
  - `bumpLocalSpecVersion(ctx.rootPath, ...)` → `bumpLocalSpecVersion(resolveSpecDir(wsId), ...)`
  - `wsId` 已在作用域内（`:420`），无需新增变量。
- **`daemon.ts:2816 / :2849`**（interactive 路径）：
  - `readLocalSpecVersion(specRootPath)` → `readLocalSpecVersion(resolveSpecDir(workspaceId))`
  - `bumpLocalSpecVersion(specRootPath, ...)` → `bumpLocalSpecVersion(resolveSpecDir(workspaceId), ...)`
  - `workspaceId` 已在作用域内（`:2800`）。
  - ⚠️ **`daemon.ts:2844` `pullSpecBundle({...rootPath: specRootPath})` 的 `rootPath` 参数保持不变**——那是 pull 的路径解析参数（mirror/路径翻译用），不是状态读取，不在本次改动范围。
- **`_runInitLease`（`task-runner.ts:391`）→ `handleInitLease`**：init lease 编排在 `handleInitLease` 内，第 1 步替换已在 Phase 2 处理；`_runInitLease` 调用签名不变。

### Phase 4 — 测试更新

- **`tests/test_init_lease.test.ts`**：断言从"写 `{rootPath}/.sillyspec-platform.json` 6 字段"改为"写 `{cacheRoot}/.runtime/spec-version.json` 2 字段" + "不再写 `.sillyspec-platform.json`"。
- **`tests/test_spec_version_refresh.test.ts`**：路径常量 `PLATFORM_CONFIG_FILENAME` → `DAEMON_STATE_FILENAME`；测试 fixture 改为在 `.runtime/spec-version.json` 准备 `spec_version`。
- **`tests/test_spec_sync.*`**（如 `hasUnsyncedLocalChanges` 相关）：`synced_at` fixture 路径迁移。
- 跑 `sillyhub-daemon` 全量 vitest 确保零回归。

## 文件变更清单

> 运行时产物 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json`（daemon 状态文件，init lease 时生成）非源码改动，不列入下表，覆盖对账时忽略。

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/spec-sync.ts` | 删 `write/readPlatformConfig`+`PlatformConfig`+`PLATFORM_CONFIG_FILENAME`；新增 `writeDaemonState`+`DaemonState`+`DAEMON_STATE_FILENAME`；改 `read/bumpLocalSpecVersion`+`hasUnsyncedLocalChanges` 路径；`handleInitLease` 第1步替换 |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | `:427/:448` 调用 `read/bumpLocalSpecVersion` 入参改 `resolveSpecDir(wsId)` |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `:2816/:2849` 调用入参改 `resolveSpecDir(workspaceId)`；`:2844` pullSpecBundle 的 rootPath **不动** |
| 修改 | `sillyhub-daemon/tests/test_init_lease.test.ts` | 断言改 spec-version.json + 不写 platform.json |
| 修改 | `sillyhub-daemon/tests/test_spec_version_refresh.test.ts` | 路径常量 + fixture 迁移 |
| 修改 | `sillyhub-daemon/tests/`（hasUnsynced 相关） | synced_at fixture 路径迁移 |
| 文档 | `docs/multi-agent-platform/modules/sillyhub-daemon.md` | MANUAL_NOTES 加变更索引条目（archive 阶段同步） |

## 7. 接口定义

```ts
// ── 新增常量 / 类型 ──
/** daemon 状态文件相对路径（相对于 spec 缓存根）。 */
export const DAEMON_STATE_FILENAME = '.runtime/spec-version.json';

/** daemon 本地状态 schema（取代旧 PlatformConfig 6 字段）。 */
export interface DaemonState {
  spec_version: number;   // 本地缓存对应的 spec bundle 版本（保鲜比对值）
  synced_at: string;      // 上次成功 pull 时间（ISO 8601 UTC）
}

// ── 新增：init lease 首写状态文件 ──
/**
 * 写 {specCacheRoot}/.runtime/spec-version.json（init lease 完整首写）。
 * 取代旧 writePlatformConfig——不再触碰 .sillyspec-platform.json（交 sillyspec 独占）。
 *
 * 内部 mkdir {specCacheRoot}/.runtime（recursive，容忍已存在）——init lease 第 1 步在
 * pullSpecBundle 之前执行，.runtime 可能尚未创建（原 writePlatformConfig 也 mkdir rootPath）。
 *
 * @param specCacheRoot daemon spec 缓存根（resolveSpecDir(wsId)）
 * @param state spec_version 必填；synced_at 可省略，缺省取当前时间
 */
export async function writeDaemonState(
  specCacheRoot: string,
  state: Omit<DaemonState, 'synced_at'> & { synced_at?: string },
): Promise<DaemonState>;

// ── 改写：入参 rootPath → specCacheRoot，文件路径改 .runtime/spec-version.json ──
export async function readLocalSpecVersion(
  specCacheRoot: string | undefined,
): Promise<number | null>;

export async function bumpLocalSpecVersion(
  specCacheRoot: string | undefined,
  newVersion: number,
): Promise<void>;

// hasUnsyncedLocalChanges：synced_at 改从 {specDir}/.runtime/spec-version.json 读
export async function hasUnsyncedLocalChanges(
  specDir: string,
  opts?: { syncedAtPath?: string },  // 测试可注入；默认 join(specDir, DAEMON_STATE_FILENAME)
): Promise<boolean>;
```

## 7.5 生命周期契约表

本变更涉及 `daemon` / `lease`（init lease）/ `lifecycle` / `state transition` 关键词，必填。

init lease 生命周期（workspace-config-flow §9，本次仅改 `config_written` 步骤的写入目标）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| init lease 下发 | backend (`start_init_dispatch`) | daemon | `workspaceId`, `rootPath`, `serverOrigin`, `latestSpecVersion`, `mode=init` | lease `pending → claimed` |
| writeDaemonState | daemon | 文件系统 | `specCacheRoot`, `spec_version` | `config_written`（目标从 `.sillyspec-platform.json` 改为 `.runtime/spec-version.json`） |
| pullSpecBundle | daemon | backend | `workspaceId` | `bundle_pulled` |
| postSpecSync | daemon | backend | `workspaceId`, `specDir` | `local_pushed` |
| lease complete | daemon | backend | `leaseId`, `status=completed` | `claimed → completed` |

> 日常保鲜路径（非 init lease）：agent/scan 任务执行前 `readLocalSpecVersion(resolveSpecDir(wsId))` 比对 lease `latestSpecVersion`，落后则 pull，成功后 `bumpLocalSpecVersion` 回写 `.runtime/spec-version.json`。读取处从 `.sillyspec-platform.json` 迁移到 `spec-version.json`（覆盖 workspace-config-flow D-010）。

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| `bumpLocalSpecVersion` 原依赖 `.sillyspec-platform.json` 已被 init 写入；改后依赖 `spec-version.json` 被 `writeDaemonState` 写入。若 init 失败导致状态文件缺失，bump 静默跳过（保留原"文件不存在则跳过"语义），下次任务因版本旧再 pull 自愈。 | 语义保留，自愈机制不变。 |
| 旧版本 daemon 写过的 `.sillyspec-platform.json`（snake_case 6 字段）残留 | daemon 删除 `readPlatformConfig` 后无读取路径，残留文件无害（已被 sillyspec 覆盖或将被覆盖）；不主动清理（避免误删 sillyspec 的 pointer）。 |
| `pullSpecBundle` 的 `rootPath` 参数被误改 | design 明确标注 `daemon.ts:2844` 不动；verify 阶段对照检查。 |
| 测试 fixture 路径漏改 | 全量 vitest 跑通 + grep 残留 `PLATFORM_CONFIG_FILENAME` / `.sillyspec-platform.json` 引用（仅注释/外部 sillyspec 工具除外）。 |

**回退**：单 commit 改动，若线上出问题 git revert 该 commit 即可恢复 daemon 写 `.sillyspec-platform.json` 旧行为（sillyspec 工具不受影响）。

## 9. 影响模块

- **sillyhub-daemon**（主）：`spec-sync.ts` + `task-runner.ts` + `daemon.ts` + 测试。
- **sillyspec**（无）：全局工具不改，仅作为契约参照方。
- **backend**（无）：init lease payload 不变。
- **frontend**（无）：无 UI。
- **deploy**（无）。

## 10. 验收标准（verify 阶段对照）

- [ ] `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` 零命中（注释解释除外）。
- [ ] daemon 不再写 `.sillyspec-platform.json`（test_init_lease 断言）。
- [ ] `spec-version.json` 在 init lease 后产生于 `.runtime/` 下（2 字段）。
- [ ] sillyhub-daemon 全量 vitest 零回归。
- [ ] 手动验证：新工作区 init lease 后，`.sillyspec-platform.json`（若 sillyspec 已跑）为 sillyspec 格式，daemon 状态在 `spec-version.json`，两者互不干扰。

## 11. 自审

### 11.1 必含章节完整性
- ✅ 背景（§1）/ 设计目标（§2）/ 非目标（§3）/ 拆分判断（§4）/ 总体方案（§5）/ 文件变更清单（§6）/ 接口定义（§7）/ 生命周期契约表（§7.5）/ 风险与回退（§8）/ 影响模块（§9）/ 验收标准（§10）

### 11.2 一致性检查（Design Grill passed）
- **调用点完整**：`read/bumpLocalSpecVersion` 4 处调用（task-runner:427/448 + daemon:2816/2849）全覆盖。
- **dead code 确认**：`readPlatformConfig` 全仓库零调用，删安全。
- **writePlatformConfig 唯一调用点**：`handleInitLease:967`，替换无遗漏。
- **hasUnsyncedLocalChanges 调用方**：仅 `pullSpecBundle:148` 默认 checker；`opts` 变可选后调用方式 `checker(specDir)` 不变。
- **specDir 一致性**：`pullSpecBundle` 返回值 = `resolveSpecDir(wsId)`，`.runtime/spec-version.json` 路径可达。
- **接口与调用点匹配**：`writeDaemonState(specCacheRoot)` ← `handleInitLease` 内 `resolveSpecDir(params.workspaceId)`；`read/bump(specCacheRoot)` ← 调用点传 `resolveSpecDir(wsId/workspaceId)`。
- **关键字段无歧义**：`spec_version` / `synced_at` 语义随状态文件迁移，保留原保鲜 + 回灌判断语义。

### 11.3 实现澄清（Grill 补充）
- `writeDaemonState` 内部需 `mkdir {specCacheRoot}/.runtime`（recursive）—— init lease 第 1 步在 `pullSpecBundle` 之前，`.runtime` 可能尚未创建。
- `pullSpecBundle` 不改（`hasUnsyncedLocalChanges` 作为 checker，`opts` 变可选，调用方式不变）。
- `daemon.ts:2844` `pullSpecBundle({rootPath: specRootPath})` 的 `rootPath` 是 pull 路径解析参数，**不动**（仅改同函数附近的 read/bump 调用）。

### 11.4 风险覆盖
- `bump` 依赖状态文件存在 / `pullSpecBundle` rootPath 误改 / 残留旧 `.sillyspec-platform.json` / 测试 fixture 漏改 → 均有缓解措施（§8）。回退方案：单 commit git revert。
