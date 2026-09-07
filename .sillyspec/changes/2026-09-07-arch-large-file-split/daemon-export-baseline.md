---
author: qinyi
created_at: 2026-09-07 09:09:58
---

# daemon 导出面与引用方基线（facade 保底对账）

> task-01 产出（FR-02、D-004@v1）。对象：`sillyhub-daemon/src/interactive/session-manager.ts`（5438 行）与 `sillyhub-daemon/src/task-runner.ts`（3426 行）。
> 所有行号与计数均在 worktree `2026-09-07-arch-large-file-split` 上 grep 实测（2026-09-07）；与 design.md §5 簇区间不一致时，以本文实测为准。
> 复现方式：在 `sillyhub-daemon/` 目录下执行各节附注的 grep 命令即可逐条复现。
> 全仓（worktree 根、排除 node_modules）范围已确认：**sillyhub-daemon 之外无任何文件 import 这两个模块**（frontend/backend/scripts 均零引用），引用面完全收敛在 sillyhub-daemon 的 src 与 tests 内。

## 1. session-manager.ts 导出面（6 条）

命令：`grep -n "^export" src/interactive/session-manager.ts`（实测 6 行）

| 行号 | 符号 | 种类 | 备注 |
|---|---|---|---|
| 143 | `RESUME_DAMAGE_PATTERNS` | const（RegExp） | 单个正则 `/session not found\|no conversation found\|unable to resume/i`，非数组 |
| 150 | `PermissionWsSender` | interface | wsClient.send 注入鸭子接口（task-08） |
| 161 | `SessionManagerOptions` | interface | 构造选项 |
| 339 | `MainAgentMcpContext` | interface | 主 agent MCP 上下文（worker_depth 等） |
| 402 | `OnTurnQueuedCallback` | type 别名 | 回调签名 |
| 526 | `SessionManager` | class | 主类 |

无 `export default`、无 `export * from` / re-export 块。

## 2. task-runner.ts 导出面（27 条）

命令：`grep -n "^export" src/task-runner.ts`（实测 27 行）

| 行号 | 符号 | 种类 | 备注 |
|---|---|---|---|
| 128 | `TaskStatus` | type 别名 | 状态联合 |
| 154 | `RunnerHubClient` | interface | TaskRunner 构造依赖（hub 鸭子接口） |
| 211 | `RunnerWorkspaceManager` | interface | 构造依赖（workspace 鸭子接口） |
| 239 | `RunnerCredentialManager` | interface | 构造依赖（凭证鸭子接口） |
| 251 | `SILLYSPEC_VALID_TOOLS` | const `ReadonlySet<string>` | 白名单工具集 |
| 267 | `mapDetectedToSillyspecTools` | function | detected → sillyspec 工具映射 |
| 277 | `FILE_MCP_TMP_PREFIX` | const string | `'sillyhub-file-mcp-'` |
| 284 | `FILE_MCP_TMP_MAX_AGE_MS` | const number | `60 * 60 * 1000` |
| 290 | `fileMcpTmpPathFor` | function | runId → 临时配置路径 |
| 309 | `cleanupStaleFileMcpConfigs` | async function | 清理过期 file-mcp 临时配置 |
| 344 | `TaskRunner` | class | 主类 |
| 2696 | `ChangeWriteFile` | interface | change 写盘三件套之一 |
| 2712 | `ChangeWriteCtx` | interface | change 写盘三件套之一 |
| 2733 | `ChangeWriteResult` | interface | change 写盘三件套之一 |
| 2757 | `validateChangeWritePath` | function | 写盘路径校验 |
| 2792 | `TaskRunnerResult` | interface | `extends TaskResult`（TaskResult 来自 types） |
| 2962 | `resolveTimeout` | function | 超时解析 |
| 2984 | `resolveMaxRetries` | function | 重试次数解析 |
| 3007 | `isSpawnLevelFailure` | function | spawn 级失败判定 |
| 3036 | `buildSkillPrompt` | function | 技能 prompt 组装 |
| 3070 | `detectSkillInvoked` | function | 技能命中检测 |
| 3118 | `mergeAdapterUsage` | function | usage 合并 |
| 3190 | `attachBatchModelStats` | function | batch 模型统计挂载 |
| 3218 | `extractBudgetUsageTokens` | function | 预算 usage 提取 |
| 3293 | `renderAgentEvent` | function | 事件渲染 |
| 3347 | `renderTaskBoundary` | function | 任务边界渲染 |
| 3369 | `echoTaskBoundary` | function | 任务边界回显 |

无 `export default`、无 re-export 块。

## 3. 引用方符号矩阵

### 3.1 src 侧真实 import（每模块 2 个文件）

命令：`grep -rlE "from ['\"].*session-manager" src --include=*.ts` / 同理 task-runner。
（注意：`src/interactive/providers.ts:292` 会被宽松正则误命中——该行是注释，同一行里 `from './driver.js'` 与 `session-manager.ts` 两个词隔空拼出了假匹配；providers.ts 无任何指向 session-manager 的 import。）

| 引用文件 | 导入语句（原文） | 符号 |
|---|---|---|
| `src/cli.ts:60` | `import { TaskRunner, mapDetectedToSillyspecTools } from './task-runner.js'` | TaskRunner(值), mapDetectedToSillyspecTools(值) |
| `src/cli.ts:75` | `import { SessionManager } from './interactive/session-manager.js'` | SessionManager(值) |
| `src/daemon.ts:139-145` | `import type { TaskRunnerResult, ChangeWriteCtx, ChangeWriteFile, ChangeWriteResult } from './task-runner.js'`（多行） | TaskRunnerResult, ChangeWriteCtx, ChangeWriteFile, ChangeWriteResult（均 type） |
| `src/daemon.ts:150` | `import type { SessionManager } from './interactive/session-manager.js'` | SessionManager(type) |

任务书重点关注的其余 src 文件（hub-client.ts、types.ts、mcp-server.ts、mcp-config.ts、interactive/types.ts、interactive/input-queue.ts、claude-events.ts、pi-events.ts、claude-sdk-driver.ts、codex-app-server-driver.ts、pi-rpc-driver.ts、providers.ts）经逐一定位：**全部为注释/文档字符串提及，无一处 import**。即 interactive/ 内部互引为零——SessionManager 在 src 内只有 cli.ts 与 daemon.ts 两个消费方，drivers 与 events 模块均不反向依赖它。

### 3.2 两文件互引 = 0（拆分解耦利好）

- `session-manager.ts` 提及 "task-runner" 共 3 处（L423/L1627/L2815），全部是注释，**无 import**。
- `task-runner.ts` 对 "session-manager" 零提及。
- 结论：两文件无任何 import 级耦合，可独立拆包。

### 3.3 tests 侧——session-manager（61 个静态 import 文件 + 1 处动态 import）

命令：`grep -rlE "from ['\"].*session-manager" tests --include=*.ts | wc -l` → 61。

A. `import type { SessionManager }`（21 个，仅类型引用）：
daemon-agent-event-report、daemon-borrow-sandbox、daemon-budget-wiring、daemon-inject-drop-report、daemon-interactive-bridge、daemon-interactive-codex、daemon-kind-dispatch、daemon-provider-config-changed-handler、daemon-resume-input、daemon-selfupdate-orchestrator、daemon-session-lifecycle-wiring、daemon-session-resume-confirm、daemon-session-resume-route、daemon-session-switch-config、daemon-stop-suspend、ws-client-permission-route（以上 tests/ 根目录 16 个）；integration/resilience-scenarios、integration/selfupdate-scenarios、interactive/daemon-notify-session-ready、interactive/daemon-recovery-boot、spec-transport-tar-sync/daemon-interactive-spec-sync（子目录 5 个）。

B. `import { SessionManager }` 值导入（合计 40 个，其中 38 个单符号、2 个多符号归入 C 组；值导入真实类，依赖注入 mock hub/driver 后实例化）：
- integration/ 1 个：worker-resume
- interactive/ 34 个：claude-sdk-driver-canuse、claude-sdk-driver-mcp-kill-cleanup、claude-sdk-driver-permission、provider-registry、session-concurrent-inject、session-idle-scanner、session-interrupt、session-manager-allowed-roots、session-manager-askuser-dialog、session-manager-borrow-sandbox、session-manager-budget、session-manager-config-switch、session-manager-driver-registry、session-manager-idle-disabled、session-manager-inject-attachment、session-manager-main-agent-mcp、session-manager-pending-cleanup、session-manager-pending-switch、session-manager-permission、session-manager-profile、session-manager-provider-routing、session-manager-reload-provider、session-manager-reload-serial、session-manager-resume-config-dir、session-manager-terminal-cleanup、session-manager-terminal-notify-order、session-manager-terminate-close、session-manager-worker-restricted-mcp、session-manager-write-guard、session-manager.test、session-recovery、task-ack-fallback、task-lifecycle、worker-tiered-toolset
- tests/ 根目录 3 个：plan-response-delivery、session-manager-busy-check、session-plan-bash-events
（1 + 34 + 3 = 38，加 C 组 2 个 = 40 ✓）

C. 多符号导入（除 SessionManager 外还导入了别的符号，共 2 个文件）：
- `tests/interactive/session-manager-resume-fallback.test.ts:17-19`：`import { RESUME_DAMAGE_PATTERNS, SessionManager } from '../../src/interactive/session-manager.js'`
- `tests/interactive/session-manager-worker-depth.test.ts:19-20`：`import { SessionManager }` + `import type { MainAgentMcpContext }`，另 L338 动态 `await import("../../src/interactive/session-manager.js")` 取 SessionManager（**双引号 + 动态**，用于重置模块级状态）。

D. 特殊路径形态：`tests/session-plan-bash-events.test.ts:14` 用**无 .js 扩展名**路径 `'../src/interactive/session-manager'`。facade 保持原路径存在即可同时满足。

E. 仅注释提及（不 import）：tests/interactive/claude-driver-close-contract、claude-events、codex-app-server-driver、pi-rpc-driver，tests/mcp-config、spawn-env（均已抽查确认是注释，无 import）。

### 3.4 tests 侧——task-runner（19 个静态 import 文件 + 1 个仅动态 import 文件）

命令：`grep -rlE "from ['\"].*task-runner" tests --include=*.ts | wc -l` → 19。

| 测试文件 | 导入符号 |
|---|---|
| cache-passthrough.test.ts | TaskRunner, mergeAdapterUsage |
| daemon-parity.test.ts | TaskRunner |
| execution-context.test.ts | TaskRunner；`import type { TaskRunnerResult }` |
| stats-passthrough.test.ts | TaskRunner |
| task-09-spec-pull-push.test.ts | TaskRunner |
| task-11-change-write.test.ts | TaskRunner, `type ChangeWriteCtx`；另 L259/265/281 动态 `await import('../src/task-runner.js')` 解构 `validateChangeWritePath` |
| task-13-spec-sync.test.ts | TaskRunner, `type ChangeWriteCtx` |
| task-runner-approval-decision.test.ts | TaskRunner |
| task-runner-budget.test.ts | TaskRunner, extractBudgetUsageTokens |
| task-runner-busy-check.test.ts | TaskRunner |
| task-runner-file-mcp.test.ts | TaskRunner, fileMcpTmpPathFor, FILE_MCP_TMP_PREFIX, cleanupStaleFileMcpConfigs, FILE_MCP_TMP_MAX_AGE_MS；另 L443 动态 import 取 fresh TaskRunner |
| task-runner-lease-cancel-idempotent.test.ts | TaskRunner |
| task-runner-policy-cache.test.ts | TaskRunner |
| task-runner-provider-dispatch.test.ts | TaskRunner |
| task-runner-retry-timeout.test.ts | TaskRunner, resolveTimeout, resolveMaxRetries, isSpawnLevelFailure |
| task-runner-skill-detect.test.ts | detectSkillInvoked, buildSkillPrompt（**不导入 TaskRunner**） |
| task-runner.test.ts | TaskRunner |
| test_init_lease.test.ts | TaskRunner |
| spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts | TaskRunner |

仅动态 import（无静态）：`tests/task-runner-terminal-observer.test.ts` — L57 `typeof import('../src/task-runner.js').TaskRunner`（类型位）、L210/L382 `await import` 取 TaskRunner（fresh module）。

仅注释提及（不 import）：cmd-shim、stream-json、helpers/fake-child、adapters/json-rpc、adapters/pi-json、daemon-lease-cancel-handler、task-runner-terminal-observer（动态归上条）、cli-session-manager-injection（vi.mock，见 3.5）。

### 3.5 vi.mock 形状（唯一 1 个文件，mock 两个路径）

`tests/cli-session-manager-injection.test.ts`：

1. `vi.mock('../src/interactive/session-manager.js', () => {...})`（L81）— 工厂返回 **仅 `{ SessionManager: SessionManagerMock }`**；SessionManagerMock 为 class：constructor(deps, opts) 捕获实例到 `captured.sessionManagerInstances`，方法桩 `create() / inject()→{runId:''} / interrupt()→false / end() / fail() / get()→undefined / start() / stop()`。
2. `vi.mock('../src/task-runner.js', () => ({ TaskRunner: vi.fn().mockImplementation(() => ({ runLease: vi.fn() })) }))`（L126）— 工厂返回**仅 `{ TaskRunner }`**，stub 只有 runLease。

**拆分风险提示（task-02/03 必读）**：两个 mock 工厂都只提供单一键。拆分后若 cli.ts 从原路径额外 import 任何新符号（或 facade 语义变化导致 cli.ts 改从子模块导入而绕过 mock 路径），该测试会拿到 `undefined`。方案二选一：cli.ts 的导入面保持"只从 facade 导入 SessionManager/TaskRunner + mapDetectedToSillyspecTools 等既有符号"，或同步补 mock 工厂键。

### 3.6 动态 import 汇总（facade 路径必须可动态解析）

- `'../../src/interactive/session-manager.js'`：session-manager-worker-depth.test.ts:338（双引号）
- `'../src/task-runner.js'`：task-11-change-write.test.ts:259/265/281（validateChangeWritePath）、task-runner-terminal-observer.test.ts:210/382、task-runner-file-mcp.test.ts:443

## 4. facade 保底结论（task-02 / task-03 核对清单）

拆分后原路径 `src/interactive/session-manager.ts`、`src/task-runner.ts` 转为 facade 时，必须继续导出以下全集（= 导出面 ∪ 被引用符号 = 原导出面本身；"硬引用"= 丢失立即导致 src/tests 编译失败，"保底"= 当前无外部代码引用仍须保留，防未来引用断裂）。

### 4.1 session-manager 原路径必须 re-export（6/6 全量）

| 符号 | 引用级别 | 引用方 |
|---|---|---|
| `SessionManager` | 硬引用（值+type，src 2 + tests 61） | cli.ts、daemon.ts、全部 3.3 节测试 |
| `RESUME_DAMAGE_PATTERNS` | 硬引用（值） | session-manager-resume-fallback.test.ts |
| `MainAgentMcpContext` | 硬引用（type） | session-manager-worker-depth.test.ts |
| `PermissionWsSender` | 保底 | 仅文件内部使用，无外部引用 |
| `SessionManagerOptions` | 保底 | 仅文件内部使用，无外部引用 |
| `OnTurnQueuedCallback` | 保底 | 仅文件内部使用，无外部引用 |

### 4.2 task-runner 原路径必须 re-export（27/27 全量）

硬引用 18 个（丢失立即编译失败）：`TaskRunner`、`mapDetectedToSillyspecTools`、`TaskRunnerResult`、`ChangeWriteCtx`、`ChangeWriteFile`、`ChangeWriteResult`、`mergeAdapterUsage`、`extractBudgetUsageTokens`、`fileMcpTmpPathFor`、`FILE_MCP_TMP_PREFIX`、`FILE_MCP_TMP_MAX_AGE_MS`、`cleanupStaleFileMcpConfigs`、`resolveTimeout`、`resolveMaxRetries`、`isSpawnLevelFailure`、`buildSkillPrompt`、`detectSkillInvoked`、`validateChangeWritePath`（动态 import 引用）。

保底 9 个（当前无外部代码引用，仍须全量保留）：`TaskStatus`、`RunnerHubClient`、`RunnerWorkspaceManager`、`RunnerCredentialManager`、`SILLYSPEC_VALID_TOOLS`、`attachBatchModelStats`、`renderAgentEvent`、`renderTaskBoundary`、`echoTaskBoundary`。其中 `RunnerHubClient`/`RunnerCredentialManager`/`attachBatchModelStats`/`renderAgentEvent`/`renderTaskBoundary`/`echoTaskBoundary` 在 daemon-parity/cli.ts/spawn-env/config/terminal-observer/stats-passthrough 等处有**注释级**提及（见 3.1/3.4），删除导出会让这些注释失真——CLAUDE.md 规则 18（注释与实现不一致是万恶之源）。

### 4.3 facade 落地约束

1. 原路径文件必须真实存在且可被静态 import（`.js` 后缀与无扩展名两种 specifier）、动态 `import()` 解析（见 3.6）。
2. 值符号与 type 符号都要 re-export（注意 `isolatedModules` 场景下 type 重导出用 `export type { ... }`）。
3. vi.mock 键约束见 3.5。
4. `TaskRunnerResult` 的 `extends TaskResult` 依赖 `./types.js`，拆分时类型依赖随包走。

## 5. 数字汇总

| 指标 | session-manager.ts | task-runner.ts |
|---|---|---|
| 文件行数 | 5438 | 3426 |
| 导出符号总数（grep "^export"） | 6 | 27 |
| src 引用文件数（真实 import） | 2（cli.ts、daemon.ts） | 2（cli.ts、daemon.ts） |
| src 仅注释提及文件数 | 12 | 20 |
| tests 静态 import 文件数 | 61 | 19 |
| tests 仅动态 import 文件数 | 0（动态均在静态文件内） | 1（task-runner-terminal-observer） |
| 被外部硬引用符号数 | 3 | 18 |
| 无外部引用仍须保底符号数 | 3 | 9 |
| vi.mock 该路径的测试数 | 1（cli-session-manager-injection.test.ts） | 1（同文件） |

verify 自验（task-01 verify 三条）：
- 基线文档存在且非空：本文即产出（写入主仓 changeDir，未写 worktree）。
- `grep -n "^export" src/interactive/session-manager.ts | wc -l` → **6**（已实测）。
- `grep -n "^export" src/task-runner.ts | wc -l` → **27**（已实测）。

本文档所有 grep 结论均在生成时实际执行过（worktree sillyhub-daemon 目录，2026-09-07），可按各节附注命令复现。
