/**
 * interactive/session-manager.ts —— 交互式会话生命周期管理（task-04 §4.3 + task-07 增强）。
 *
 * 职责（design §7.2 / §7.6）：
 *   - 内存 SessionStore（Map<sessionId, SessionState>），Wave1/2 内存态（D-003，daemon
 *     重启丢失，task-10 持久化）。
 *   - create：建 InputQueue + push 首 SDKUserMessage → driver.start → fire consume。
 *   - inject：push 追问（spike S1：turn 级串行，SDK 在当前 turn result 后消费）。
 *     task-07 增量：status=running 时 pendingInjectCount++ + onTurnQueued 回调（排队检测，
 *     非拒绝，可观察）。
 *   - interrupt：driver.interrupt（spike D1：turn 级，session 仍 active）。
 *     task-07 增量：interrupt 后更新 lastActiveAt；终态由 _onResult 按 SDK 实际 result 收尾。
 *   - end：InputQueue.close → query 自然结束 → status=ended → onSessionEnd（统一收口）。
 *   - fail：driver onError → status=failed → onSessionEnd。
 *   - task-07 增量：start()/stop() 启停空闲扫描定时器（FR-06 / D-004@v1）；
 *     _scanIdle → _onIdleExpire → end（running 先 interrupt 再 end 兜底）。
 *
 * state.query / state.inputQueue 是 SDK 长生命周期句柄；driver.consume 作为 session
 * 协程一次启动，跨多 turn 持续直到 InputQueue.close 或 query 自然结束。
 *
 * 来源：design.md §7.2 / §7.6 / §8.5；spike-02 §3.7 H2（同进程多轮）/ D1（interrupt 续轮）/
 * D4（result 边界）/ S1（turn 级串行）；task-07 FR-04 / FR-06 / D-004@v1。
 *
 * task-02（2026-09-07-arch-large-file-split / D-004@v1 / D-005@v3）：本文件由原
 * 5438 行瘦身为 facade——类型/常量与各方法簇拆至 ``./session-manager/`` 包 13
 * 子模块（types / notify-chain / permission / write-guard / driver-factory /
 * usage / turn-control / lifecycle / persistence / events / background-tasks /
 * helpers / index），原导出面 6 符号经 ``export * from './session-manager/index.js'``
 * 原样转发（零变化）；类内保留核心编排（构造 + create/_createInternal +
 * _runConsume + reload 簇），其余方法一行委托到子模块函数——``this`` 经
 * ``_core()`` 类型桥（SessionManagerCore）显式传参，行为零变化。
 *
 * @module interactive/session-manager
 */

// task-02（2026-09-07-arch-large-file-split / D-006@v1）：原路径兼容层——61 个
// 测试文件与 cli.ts / daemon.ts 的 import 语句零改动（原 6 符号导出面不变）。
export * from './session-manager/index.js';

// task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：本文件
// @anthropic-ai/claude-agent-sdk 类型 import 清零——SessionManager 只消费中性
// AgentEvent / TurnMessageEnvelope（driver 归一化后的事件轨），不再解析 raw SDK
// 消息形状。Claude SDK 专属回调类型改经 ClaudeStartOptions 结构性推导（落位
// ./session-manager/types.js），不直接 import SDK 包。
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  InteractiveProvider,
  McpServerConfigForDriver,
  TurnMessageEnvelope,
  UserTurnInput,
} from './driver.js';
import { InputQueue } from './input-queue.js';
import { PermissionResolver } from './permission-resolver.js';
import type {
  CanUseToolDecision,
  CreateSessionInput,
  InjectResult,
  PersistedSessionRecord,
  SessionEventForBackend,
  SessionManagerDeps,
  SessionState,
  SessionSwitchConfigPayload,
} from './types.js';
import {
  SessionAlreadyExistsError,
  SessionLimitReached,
  SessionNotFoundError,
  SessionNotActiveError,
} from './types.js';
// task-07（provider-switch-live-session / D-002@v1）：markPendingSwitch /
// reloadWithProvider 签名引用中性 ProviderConfig（backend set/unset_default 经 WS
// 下发；null 表示停止→回退本机凭证）。type-only，与 spawn-env / claim payload 同源。
import type { AgentEvent, ProviderConfig } from '../types.js';
// task-08（provider-switch-live-session / FR-05 / D-004@v1）：reloadWithProvider 用
// buildSpawnEnv 构造新 env（provider_config 第 0 层；null 时跳过 + 不隔离 CLAUDE_CONFIG_DIR
// → 回退本机凭证，spawn-env.ts:140-164 已支持）。SpawnCredentialManager 鸭子类型，
// daemon 生产路径注入 daemon._credentialManager，测试 / 未注入时用 noopCredential fallback。
import { buildSpawnEnv, type SpawnCredentialManager } from '../spawn-env.js';
// task-03（2026-09-11-session-provider-switch-codex-pi / FR-01 / FR-04 / D-003@v1）：
// reload 内核接入 codex/pi 文件层配置——ForReload 写盘 + env 合并（失败兜底内聚在
// 返回值矩阵，R-05）与 codex thread 迁移钩子（FR-05，helper 在 codex-settings.ts）。
// join / daemonStateDir 派生确定性 per-session 路径 `<daemonStateDir()>/codex/<sessionId>`
//（与 task-runner.ts spawn 侧同口径）。
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { daemonStateDir } from '../config.js';

/**
 * 2026-09-12-provider-file-tx D-005@v2：reload 引擎白名单（provider 维度门）。
 * 仅 provider 切换载荷（opts.providerConfig !== undefined）判门；config-only 路径
 * （人格/配置切换）不受限——cursor 的 reloadWithConfig 行为保持。口径与前端
 * frontend/src/lib/provider-caps.ts PROVIDER_SWITCH_ENGINES 对齐（改任一侧须同步）。
 */
const PROVIDER_RELOAD_ENGINES: ReadonlySet<string> = new Set(['claude', 'codex', 'pi']);
import { migrateCodexThreadFromHost } from '../codex-settings.js';
import {
  applyProviderFileSettingsForReload,
  MANAGED_MARKER_FILENAME,
} from '../provider-file-settings.js';
// 2026-09-11-provider-adapter-registry task-03（FR-03）：reload 合并块门控改读
// 聚合表元数据（INTERACTIVE_PROVIDERS——fileSettings 是否 writer；详见下方
// hasProviderFileWriter 与 _reloadSessionNow 合并块内注释）。
import { INTERACTIVE_PROVIDERS } from './providers.js';
import type { ProviderAdapter } from './providers.js';
// ql-20260822-009：resume / reload 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定
// （隔离目录命中 → 隔离，保 ql-20260807-002 停供应商语义；仅宿主机 ~/.claude 命中 →
// 不隔离，修复未配供应商会话重开被 fail 打回 ended）。
// ql-20260822-001（移植）：home 会话切供应商前把 jsonl 迁移（复制）到隔离目录——
// 仅回 home resume 会把 claude 暴露给用户 ~/.claude/settings.json，其 env 块
//（cc-switch）优先于进程注入的供应商 env，流量串本机网关（E2E 实锤 400[1214]）。
import {
  applyTranscriptConfigDir,
  defaultTranscriptDirs,
  migrateClaudeTranscriptToHost,
  migrateClaudeTranscriptToIsolated,
  type TranscriptDirs,
} from './claude-transcript-dir.js';
import type { PolicyEngine } from '../policy/filesystem-policy.js';
import type { SessionInjectAttachment } from '../protocol.js';
import {
  CLEAR_PERSONA_PROMPT,
  DEFAULT_IDLE_SCAN_SEC,
  DEFAULT_IDLE_TIMEOUT_SEC,
  DEFAULT_MAX_ACTIVE_SESSIONS,
  RESUME_DAMAGE_PATTERNS,
} from './session-manager/types.js';
import type {
  BackgroundTaskInfo,
  CanUseToolFn,
  DriverOptionsSpec,
  MainAgentMcpContext,
  OnUserDialogFn,
  PermissionWsSender,
  SessionManagerCore,
  SessionManagerOptions,
  SessionUsageTotals,
} from './session-manager/types.js';
import { runNotifyChain } from './session-manager/notify-chain.js';
import {
  buildCanUseToolCallback,
  buildOnUserDialogCallback,
  getPermissionResolver,
  requestPermission,
  requestUserDialog,
  withinStaleFlipGrace,
  writeChannelGuardDeny,
} from './session-manager/permission.js';
import {
  buildWriteOnlyCanUseToolCallback,
  clearBorrowSandbox,
  extractWritePathsForTool,
  getBorrowSandboxRoot,
  judgeWriteViaPolicyEngine,
  registerBorrowSandbox,
  sessionOverlayRoots,
  shellKindOfTool,
  wrapWithWriteGuard,
} from './session-manager/write-guard.js';
import {
  buildDriverOptions,
  getDriver,
  resolveMainAgentMcp,
} from './session-manager/driver-factory.js';
import {
  aggregateSessionUsage,
  checkBudgetCutoff,
  destroyUsageLedger,
  foldTurnUsage,
  isOverBudget,
  liftSessionUsage,
  setBudgetTokens,
  setBudgetTokensInternal,
} from './session-manager/usage.js';
import {
  downloadAttachmentWithTimeout,
  getPendingInjectCount,
  inject,
  interrupt,
  interruptInternal,
  refreshClaimToken,
  resolvePlanResponse,
  writeAttachmentFile,
} from './session-manager/turn-control.js';
import {
  abortPermissionResolver,
  cancelTerminalCleanup,
  end,
  fail,
  get,
  getIdleTimeoutSec,
  hasRunningTurn,
  scanIdle,
  scanOnce,
  scheduleTerminalCleanup,
  start,
  stop,
  terminateSession,
} from './session-manager/lifecycle.js';
import {
  flush,
  markReconnected,
  restoreAndReconnect,
  scheduleFlush,
  snapshotPersistable,
} from './session-manager/persistence.js';
import {
  dispatchStatusEvent,
  emitSessionEvent,
  eventToReportDict,
  maybeRegisterAsyncReceipt,
  nextEventSeq,
  onMessage,
  onResult,
  registerAgentToolUseMeta,
} from './session-manager/events.js';
import {
  clearBackgroundTasks,
  getOrCreateTaskMap,
  handleAgentTaskStatusEvent,
  handleTaskNotificationEvent,
  registerAsyncReceiptTask,
  scheduleTaskWakeup,
  writeTaskLine,
} from './session-manager/background-tasks.js';

// ── 2026-09-11-provider-adapter-registry task-03（FR-03 / design Wave 2 六处收口）──
//
// reload 合并块门控的聚合表元数据小助手：数据源 INTERACTIVE_PROVIDERS（task-01
// 聚合契约）——provider 的 adapter 存在且 fileSettings 为写盘器（codex/pi）才
// 走文件层写盘 + env 合并；claude / cursor（fileSettings 显式 none）与未知
// provider（表无条目，as Record 索引得 undefined）零动作，与原
// `provider === 'codex' || 'pi'` 硬编码逐类等价（task-03 constraints）。

/** provider 的 adapter 存在且 fileSettings 为写盘器（非 { kind: 'none' }）。 */
function hasProviderFileWriter(provider: string): boolean {
  const adapter = (INTERACTIVE_PROVIDERS as Record<
    string,
    ProviderAdapter | undefined
  >)[provider];
  return adapter !== undefined && 'write' in adapter.fileSettings;
}

export class SessionManager {
  /** 内存 SessionStore。Wave1/2 内存态，daemon 重启丢失（D-003）。 */
  private readonly _store = new Map<string, SessionState>();

  /**
   * ql-20260825-f3#1：终态延迟清理定时器（sessionId → setTimeout 句柄）。
   *
   * `_terminateSession` 收尾链原本不删 `_store` 条目（全文件 `_store.delete` 仅
   * create 失败 / restore 驱逐 / restore 失败三处）→ end/fail 后含凭证 env、
   * subagentDepth Map、inputQueue buffer 的 SessionState 永久滞留，内存只增不减。
   * 「结束后短期内可查」是有意行为（终态对账 / 立即 get 查询窗口，现有测试断言
   * end 后 `get(id).status==='ended'`），故改为延迟 TERMINAL_CLEANUP_DELAY_MS 后
   * 删除 `_store` 与关联 `_pendingInjectCount` 条目，兼顾短期可查与最终回收。
   *
   * 防误删：到点时条目若已被 restoreAndReconnect / create 重建（状态非终态）则
   * 跳过（重建路径同时 `_cancelTerminalCleanup` 主动取消）；stop()（daemon
   * shutdown）clearTimeout 全部。
   */
  private readonly _terminalCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * ql-20260825-f3#2：per-session reload 串行链（sessionId → 上一轮 reload 的
   * settled promise）。
   *
   * `_reloadSession` 原无 per-session 串行化，空闲路径（markPendingSwitch /
   * markPendingConfigSwitch）fire-and-forget 触发两次快速切换时 A/B 并发快照同一
   * oldHandle：后完成者覆盖 `state.query`，先完成者的新句柄永不 close（每轮只
   * close 各自快照的 oldHandle），其 consume `isAuthoritative()` 恒 false，背后
   * 子进程无人 kill → 僵尸 claude 进程沉默烧 token。
   *
   * chain 模式保证 last-wins **顺序**执行而非交错：每轮进入核心段前 await 上一
   * 轮同会话 reload 完成，oldHandle 快照取到上一轮完成后的最新句柄，逐轮 close
   * 无孤儿。Map 存「永不 reject 的链尾」防后续链 await 已 reject 的 promise 重复
   * 触发 unhandled rejection（失败已由各轮调用方 .catch 记日志）。
   */
  private readonly _reloadChains = new Map<string, Promise<void>>();

  /**
   * ql-20260825-f6#4：per-session 终态通知串行链（sessionId → 上一轮通知的
   * settled promise），实现模式对齐 `_reloadChains`。
   *
   * `_onResult` 原先同步段先置 active/清 runId 后才 `await onTurnResult`；该 await
   * 窗口内 end()/fail() 触发 `_terminateSession` → onSessionEnd——backend 收到
   * session end 与 run result 的顺序不保证（end 先到会把刚要上报的 run 误翻终态 /
   * 对账错乱）。本链把**同会话**的 onTurnResult 与 onSessionEnd 排进同一 FIFO：
   * end 的通知必然 await 在飞 turn result 之后（backend 侧恒 result → end）。
   *
   * 范围控制：只串「终态通知对」（onTurnResult / onSessionEnd）；inject /
   * onTurnMessage / reload 等常规路径不进链（inject 与 turn result 本就无顺序承诺，
   * 串入会放大无关延迟）。同会话 turn result 天然顺序到达（consume 逐条 await），
   * 链只新增与 end 通知的相对顺序。超时保护不加：onTurnResult 回调内部已有
   * try/catch 异常隔离（上轮补），reject 语义与改造前一致向上抛。
   * Map 存「永不 reject 的链尾」+ 自愈摘除，同 `_reloadChains` 注释。
   */
  private readonly _notifyChains = new Map<string, Promise<void>>();

  /** 方法体已下沉 notify-chain.ts（task-02 拆包），见该文件头注释。 */
  private _runNotifyChain<T>(
    sessionId: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return runNotifyChain(this._core(), sessionId, fn);
  }

  /**
   * task-07（R-conv 可观察性）：sessionId → 排队中的 inject 计数。
   *
   * 不写入 SessionState（types.ts 是 task-04 范围，本任务只补增量可观察字段，且
   * pendingInjectCount 是纯可观察计数不参与 SDK 行为控制），故维护独立的内部 Map。
   * _onResult 收尾时递减（min 0）。
   */
  private readonly _pendingInjectCount = new Map<string, number>();

  /**
   * ql-20260825-002：sessionId → 挂起中的首句（deferred first prompt）。
   *
   * 根因（长期既有 bug）：create 时把 lease metadata 的 firstPrompt 直接入队提交，
   * 随后 backend 的首条 SESSION_INJECT 又提交同句 → agent 收到两次首句、
   * user_input 双日志（纯文本时两条相同未被发现，带附件后 marker 版 + 裸文本版
   * 视觉差异明显才暴露）。
   *
   * 修复：create 不再直接 push firstPrompt——挂起到本 Map，等首条 SESSION_INJECT
   * 到达时由 inject() 消费（inject 的 prompt/attachments 版本才是权威首句）；
   * PENDING_FIRST_FALLBACK_MS 超时未达（SESSION_INJECT 丢失 / 旧 backend）则
   * fallback 提交 metadata prompt（原设计意图：metadata prompt 是控制消息失败
   * 时的兜底）。同 _pendingInjectCount 范式：独立内部 Map，不写入 SessionState
   * （不持久化——现状 create 的 queue 也不 flush，崩溃丢首句语义与旧版一致）。
   */
  private readonly _pendingFirstPrompt = new Map<
    string,
    { prompt: string; timer: ReturnType<typeof setTimeout> }
  >();

  /**
   * task-08（D-006 / D-009 / FR-05 / FR-07）：interactive budget 软切断状态。
   *
   * 不写入 SessionState（interactive/types.ts 不在本任务 allowed_paths；且 budget
   * 是 lease 级运行期检查点配置，非 SDK 行为参数）—— 同 `_pendingInjectCount`
   * 范式维护独立内部 Map / Set。
   *
   *   - ``_sessionBudgetTokens``：sessionId → 本次 lease 的 token budget 上限（来自
   *     ``LeaseCtx.budget_tokens``，由 daemon ``_startInteractiveSession`` 经
   *     ``create({...,budget_tokens})`` 或 ``setBudgetTokens`` 透传）。无条目 = 未配置
   *     → 检查点短路（FR-07 零回归）。
   *   - ``_overBudgetSessions``：累计 input+output ≥ budget 后置位，幂等防重入；
   *     置位后 ``inject`` 拒绝新 turn（软切断 D-006：当前 turn 自然跑完，**不**调
   *     close/kill），并经现有 ``onTurnMessage`` 回传 ``reason='budget_exceeded'``。
   *
   * 口径 D-009：``input_tokens + output_tokens``（**不含** cache_*）—— task-08 起
   * 数据源改 usage 台账（``_sessionUsageBase`` + ``_turnUsageByParent`` 跨
   * parentKey 求和，含子代理；旧 PartialFlushBuffer.sessionInput/OutputTokens
   * 计数已随 partial 链下沉归一化器而移除）。
   */
  private readonly _sessionBudgetTokens = new Map<string, number>();
  private readonly _overBudgetSessions = new Set<string>();

  /**
   * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：会话级
   * usage 台账（budget 聚合数据源，取代旧 ``_partialBuffers`` 的
   * sessionInput/OutputTokens 计数）。
   *
   *   - ``_sessionUsageBase``：sessionId → 历史轮折算累计（``_foldTurnUsage``
   *     turn 收尾时把本轮各 parent 值合入）；
   *   - ``_turnUsageByParent``：sessionId → （parentKey → 本轮最新轮级 usage）。
   *     事件轨 partial flush 携带轮级累计（replace 更新），``_aggregateSessionUsage``
   *     = base + Σ 本轮各 parent 最新值（跨 parent 求和含子代理，口径不变）。
   *
   * 数据源守卫（对齐旧语义）：仅 ``is_partial`` 事件与 usage-only 空事件（type=
   * text 且 content=''）喂台账——完整消息 stamp 的 usage 是**单次调用**终值
   *（display 用，daemon lift → backend 实时聚合），混入会把轮级累计覆盖回单次
   * 值造成预算漏计；codex 事件（非 partial、content 非空）天然不喂台账，对齐
   * 旧链路 codex 无 partial 桶 → budget 恒 0/0 的行为。
   */
  private readonly _sessionUsageBase = new Map<string, SessionUsageTotals>();
  private readonly _turnUsageByParent = new Map<
    string,
    Map<string, SessionUsageTotals>
  >();

  /**
   * task-08：turn 内事件 seq 补号计数器（design §7 ``seq?: number``——turn 内
   * 单调递增，SessionManager 补号）。key=sessionId，value=下一号；``_onResult``
   * turn 边界重置为 0（新 turn 的 segment/事件序号空间独立）。
   */
  private readonly _turnEventSeq = new Map<string, number>();

  /**
   * task-09 / D-007@v2（候选 B 主路径）：借用 session 沙箱根目录注册表。
   *
   * key=sessionId，value=该借用 session 的独立沙箱目录绝对路径（daemon
   * ``_startInteractiveSession`` 经 ``prepareWorkspace(slug)`` 创建）。
   * daemon 在 ``sessionManager.create`` 成功后调 ``registerBorrowSandbox`` 登记；
   * ``end``/``fail``/consume 退出时清除。
   *
   * **按 lease 隔离只读 policy 的核心**（R-02）：``_judgeWriteViaPolicyEngine`` 命中
   * 本表时**不走 PolicyEngine 的 runtime 缓存**（缓存键是 lender 的 runtime_id，
   * allowed_roots 是 lender 代码区——借用 agent 命中即继承 lender 写权限，污染开发代码）。
   * 借用 session 改为只校验写路径是否落在 ``[sandboxRoot]`` 下（沙箱外一律 deny），
   * 与 lender 的 allowed_roots 完全解耦。
   *
   * 不写入 SessionState / PersistedSessionRecord（types.ts 不在 task-09 allowed_paths，
   * 且借用标记本就来自 lease metadata，daemon 重启恢复时可由 ``_startInteractiveSession``
   * 重检 marker 重新登记——当前 daemon 恢复路径未接此重检，属 R-09 可选优化，重启后
   * 借用 session 退化为普通 runtime policy，仅影响重启窗口内极少数 in-flight 借用）。
   */
  private readonly _borrowSandboxRoots = new Map<string, string>();

  /**
   * task-08（FR-02 / D-002@v1）：运行中 Bash 命令追踪**下沉归一化器**——
   * ClaudeEventNormalizer.runningBash（tool_use Bash 注册 + tool_result 终态配对
   * + elapsed_ms 计算），SessionManager 只消费 status/bash_chunk、status/
   * bash_status 事件转发 onSessionEvent。旧 ``_runningBashCommands`` 内存索引
   * 及 ``_clearRunningBashCommands`` 随 raw 消息解析一并移除（Claude 轨死代码）。
   */

  /**
   * task-03（design §5 P1.1）：会话级后台任务注册表（BackgroundTaskRegistry）。
   *
   * key = sessionId，value = 该会话的 Map<task_id, BackgroundTaskInfo>。仅内存态
   * 不持久化（后台任务随 SDK 进程消亡，不进 snapshotPersistable——见
   * BackgroundTaskInfo 注释）。会话 end/fail 终态时经 `_clearBackgroundTasks`
   * 清理；interrupt **不**清——后台任务与当轮 turn 解耦，interrupt 终止的是当轮
   * 对话，已派发任务的 task_notification 仍会到达，注册表须存活。
   */
  private readonly _backgroundTasks = new Map<
    string,
    Map<string, BackgroundTaskInfo>
  >();

  /**
   * ql-20260827-007：后台任务终态唤醒的 debounce 合并队列。同 session 短窗口
   * （2s）内多条 task_notification 合并为一次 inject——并行后台任务（如 A/B
   * 同时完成）只唤醒一个 turn，避免连环 turn。fire 后整 entry 移除。
   */
  private readonly _taskWakeupPending = new Map<
    string,
    { timer: NodeJS.Timeout; lines: string[] }
  >();

  /**
   * task-03（design §5 P1.2）：主 agent Task/Agent tool_use 元数据登记。
   *
   * key = tool_use_id，value = { sessionId, taskName, subagentType? }。assistant
   * tool_use 到达时写入，供异步回执兜底把提取的 agentId 关联回该 tool_use 的
   * description / subagent_type（回执文本自身不带任务名）。仅内存态；会话终态
   * 时与任务表同点位清理。
   */
  private readonly _agentToolUseMeta = new Map<
    string,
    { sessionId: string; taskName: string; subagentType?: string }
  >();

  /**
   * task-07（FR-06 / D-004@v1）：空闲扫描定时器。start() 启动、stop() 清理。
   * unref 不阻止 node 退出；daemon.shutdown 显式 stop。
   */
  private _idleTimer: ReturnType<typeof setInterval> | null = null;

  /** D-004@v1：空闲阈值秒。env / opts / 默认 1800 三者优先级 opts > env > 默认。 */
  private readonly _idleTimeoutSec: number;
  /** 扫描周期秒。默认 60；测试可注入短周期。 */
  private readonly _idleScanSec: number;

  /**
   * task-04（design §5.D / FR-06）：存活会话总数闸上限（create 前置计数用）。
   * 构造时从 ``process.env.SILLYHUB_MAX_ACTIVE_SESSIONS`` 读（读法对齐
   * SESSION_IDLE_TIMEOUT_SEC 先例）；未配 / 非法（NaN / 负数）→ 默认 20，
   * 0 = 不限。**闸只限 create**——restoreAndReconnect / 重连不读本字段（design
   * §7 风险表「会话闸误伤 restore」）。
   */
  private readonly _maxActiveSessions: number;

  /**
   * ql-20260822-001：resume transcript 目录对（探测 + home→隔离迁移共用）。
   * 缺省 { isolated: CLAUDE_CONFIG_DIR, home: ~/.claude }；测试注入 tmp 对。
   */
  private readonly _resumeDirs: TranscriptDirs;

  /**
   * task-08（D-007@v1 / FR-07）：canUseTool 远程人审三件套。
   *
   * 实例级配置——manualApproval=true 时必需 resolverFactory + wsClient；
   * manualApproval=false（默认）时均为 undefined，driver 不注入 canUseTool，
   * SDK 走内置默认策略（spike H1 行为不变，batch/无审批零变化）。
   *
   * **生命周期**：每个 session 一个 PermissionResolver 实例（按 sessionId 分桶，
   * Map<sessionId, PermissionResolver>），create 时实例化，end/fail 收尾时
   * abortAll + 从 map 移除。绝不让跨 session 的 pending 互相干扰。
   */
  private readonly _manualApproval: boolean;
  private readonly _permissionResolverFactory:
    | (() => PermissionResolver)
    | undefined;
  private readonly _permissionWsClient: PermissionWsSender | undefined;
  /** sessionId → 当前 session 的 resolver（manualApproval=true 时维护）。 */
  private readonly _resolversBySession = new Map<string, PermissionResolver>();
  /**
   * onUserDialog 支持的 dialog kind 列表（manualApproval=true 时注入到 driver
   * options.supportedDialogKinds，缺省 ['AskUserQuestion']）。manualApproval=false
   * 时不读（不注入 onUserDialog）。
   */
  private readonly _supportedDialogKinds: string[] | undefined;
  /**
   * 写工具白名单根目录提供者（interactive CC 写拦截，2026-06-29）。
   * 未注入 = 不启用写拦截。注入后所有 session 的 canUseTool 都前置写校验。
   * 见 SessionManagerOptions.allowedRootsProvider 文档。
   *
   * **task-14**：policyEngine 注入后此字段仅 fallback 用。
   */
  private readonly _allowedRootsProvider: (() => string[]) | undefined;
  /**
   * task-14（design §5.1.3 / §5.2）：PolicyEngine 引用。注入后写守卫改调 canWrite
   * （按 runtimeId 隔离 + 统一中文文案 + audit）。null/undefined = fallback 旧行为。
   */
  private readonly _policyEngine: PolicyEngine | null | undefined;
  /** task-14：按 sessionId 解析 runtimeId 的闭包（daemon 注入 _registeredRuntimes 查询）。 */
  private readonly _runtimeIdProvider:
    | ((sessionId: string) => string)
    | undefined;
  /**
   * task-06（D-007@v2 / R-01）：主 agent 会话判定谓词。未注入 = 永远 false（普通会话，
   * 不注入 daemon MCP server，向后兼容）。
   *
   * 签名用 ``MainAgentMcpContext``（create + restore 共用归一化上下文），与
   * ``SessionManagerOptions.isMainAgentSession`` 对齐。create 路径从
   * ``CreateSessionInput`` 归一化出 ctx 再调本谓词；restore 路径从
   * ``PersistedSessionRecord`` 归一化出 ctx。
   */
  private readonly _isMainAgentSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  /**
   * task-06：主 agent MCP server 配置构造器。仅主 agent session 调用，返回合并后的
   * MCP 配置表注入 driverOpts.mcpServers。未注入 = 不注入额外 MCP server。
   */
  private readonly _mainAgentMcpConfigProvider:
    | ((
        ctx: MainAgentMcpContext,
      ) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  /**
   * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1）：分身
   * （mission worker）会话判定谓词。未注入 = 永远 false（mission_worker 不注入
   * 任何 server，旧语义零回归）。与 ``SessionManagerOptions.isWorkerSession`` 对齐，
   * 签名同 ``MainAgentMcpContext``（create / restore / reload 三路共用归一化 ctx）。
   */
  private readonly _isWorkerSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  /**
   * task-06（design §5.C.1）：分身受限 MCP server 配置构造器（sillyhub-worker，
   * 仅 worker_done 单工具）。仅分身 session 调用；未注入 = 不注入受限 server。
   */
  private readonly _workerMcpConfigProvider:
    | ((
        ctx: MainAgentMcpContext,
      ) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  /**
   * task-08（FR-05 / D-004@v1）：本机凭证管理器（reloadWithProvider 构造新 env 用）。
   * 缺省 null：reload 用 noopCredential fallback（层 2 token 自然跳过，层 0 provider_config
   * 仍独立生效，对齐 daemon.ts:3050）。
   */
  private readonly _credentialManager: SpawnCredentialManager | null;

  /**
   * D-001@v1（task-02）：provider driver registry。`drivers.claude` / `drivers.codex`
   * 由调用方注入（task-06 cli.ts 构造时 `drivers: { claude, codex }`）。
   *
   * 兼容（D-009 向后兼容）：构造函数把旧单 driver 入参 `deps.driver`（ClaudeSdkDriver）
   * 映射到 `_drivers.claude`，让 cli.ts 现有 `new SessionManager({ driver, ... })` 零改动。
   * 优先级：`deps.drivers.claude`（显式 registry）> `deps.driver`（兼容入口）。
   */
  private readonly _drivers: Partial<Record<InteractiveProvider, InteractiveDriver>>;

  /**
   * task-02（2026-09-07-arch-large-file-split）：子模块函数的 ``this`` 上下文桥。
   * 私有成员在类型层不可结构比较，故经双重断言传入；运行时即本实例，行为零变化。
   */
  private _core(): SessionManagerCore {
    return this as unknown as SessionManagerCore;
  }

  constructor(
    private readonly deps: SessionManagerDeps,
    opts: SessionManagerOptions = {},
  ) {
    // env 读取（NaN / <=0 兜底 1800）。
    const envRaw = Number(process.env.SESSION_IDLE_TIMEOUT_SEC);
    const envTimeout =
      Number.isFinite(envRaw) && envRaw > 0 ? envRaw : DEFAULT_IDLE_TIMEOUT_SEC;
    // opts.idleTimeoutSec 优先于 env（测试显式覆盖）；若 opts 给非法值也兜底。
    const optsTimeout = opts.idleTimeoutSec;
    this._idleTimeoutSec =
      optsTimeout !== undefined && Number.isFinite(optsTimeout) && optsTimeout > 0
        ? optsTimeout
        : envTimeout;
    const optsScan = opts.idleScanSec;
    this._idleScanSec =
      optsScan !== undefined && Number.isFinite(optsScan) && optsScan > 0
        ? optsScan
        : DEFAULT_IDLE_SCAN_SEC;
    // task-04（design §5.D / FR-06）：会话总数闸 env 读法对齐 SESSION_IDLE_TIMEOUT_SEC
    // 先例。Number(env) 未配/非法 → NaN → 默认 20；显式 0 = 不限（design §5.D）；
    // 负数视为非法同落默认。计数口径 = _store 活会话（非终态），create 前置检查。
    // 审计修复 F1（2026-08-26）：Number('') === 0 —— Compose `${VAR:-}` 缺省展开
    // 为空串时曾被解析为「0=不限」，进程风暴闸静默失效。trim 后空串视为未配置
    // 回落默认；非法/负数同落默认；显式 0 仍为不限（design §5.D）。
    const gateEnv = (process.env.SILLYHUB_MAX_ACTIVE_SESSIONS ?? '').trim();
    const gateRaw = gateEnv === '' ? NaN : Number(gateEnv);
    this._maxActiveSessions =
      Number.isFinite(gateRaw) && gateRaw >= 0 ? gateRaw : DEFAULT_MAX_ACTIVE_SESSIONS;
    // ql-20260822-001：resume transcript 目录对（测试注入 tmp 对，生产取缺省）。
    this._resumeDirs = opts.resumeDirs ?? defaultTranscriptDirs();

    // task-02（D-001@v1）：构造 drivers registry。显式 registry 优先；兼容旧单 driver 入参。
    const explicitDrivers = deps.drivers ?? {};
    this._drivers = { ...explicitDrivers };
    if (deps.driver && !this._drivers.claude) {
      // 兼容：旧调用方传 deps.driver（ClaudeSdkDriver）→ 映射到 _drivers.claude。
      // task-03 让 ClaudeSdkDriver implements InteractiveDriver 后类型自然对齐；
      // 此处 unknown 断言渡过过渡期类型差异（运行时鸭子类型满足）。
      this._drivers.claude = deps.driver as unknown as InteractiveDriver;
    }

    // task-08：远程人审三件套。manualApproval=true 时 resolverFactory/wsClient 必需。
    this._manualApproval = opts.manualApproval === true;
    // resolver 直接作为工厂：用户传实例时工厂返回它（测试用单例）；生产路径
    // 传 () => new PermissionResolver() 每 session 一个。这样保持 API 简单又灵活。
    if (opts.permissionResolver !== undefined) {
      const r = opts.permissionResolver;
      this._permissionResolverFactory = () => r;
    } else if (this._manualApproval) {
      this._permissionResolverFactory = () => new PermissionResolver();
    } else {
      this._permissionResolverFactory = undefined;
    }
    this._permissionWsClient = opts.permissionWsClient;
    // onUserDialog 支持的 dialog kind：manualApproval=true 时缺省 ['AskUserQuestion']，
    // 调用方可显式覆盖（如 cli.ts 传不同列表或空数组禁用对话路由）。
    this._supportedDialogKinds =
      opts.supportedDialogKinds ??
      (this._manualApproval ? ['AskUserQuestion'] : undefined);
    if (this._manualApproval) {
      if (!this._permissionResolverFactory) {
        throw new Error(
          'SessionManager: manualApproval=true requires permissionResolver',
        );
      }
      if (!this._permissionWsClient) {
        throw new Error(
          'SessionManager: manualApproval=true requires permissionWsClient',
        );
      }
    }
    // interactive CC 写拦截（2026-06-29）：注入 provider 后所有 session 的 canUseTool
    // 前置写校验（含默认 chat / enableApproval=false）。未注入 = 不启用（向后兼容）。
    this._allowedRootsProvider = opts.allowedRootsProvider;
    // task-14（design §5.2）：PolicyEngine 注入后写守卫改调 canWrite（按 runtimeId
    // 隔离 + 统一中文 deny 文案 + audit）。null/undefined = fallback allowedRootsProvider。
    this._policyEngine = opts.policyEngine ?? null;
    this._runtimeIdProvider = opts.runtimeIdProvider;
    // task-06（D-007@v2 / R-01）：主 agent MCP tool 注入。未注入 = 普通会话零回归。
    this._isMainAgentSession = opts.isMainAgentSession;
    this._mainAgentMcpConfigProvider = opts.mainAgentMcpConfigProvider;
    // task-06（2026-08-25-team-subsession-governance / D-003@v1）：分身受限 MCP
    // 注入（design §5.C.1）。未注入 = mission_worker 不注入任何 server（零回归）。
    this._isWorkerSession = opts.isWorkerSession;
    this._workerMcpConfigProvider = opts.workerMcpConfigProvider;
    // task-08（FR-05 / D-004@v1）：reloadWithProvider 构造新 env 的凭证管理器。未注入
    // → null → reload 时 fallback noopCredential（对齐 daemon.ts:3050）。
    this._credentialManager = opts.credentialManager ?? null;
  }

  /** task-08：manual_approval 当前是否启用（测试 / daemon 透传用）。 */
  get manualApproval(): boolean {
    return this._manualApproval;
  }

  // ── 权限/用户对话框簇（方法体已下沉 permission.ts，task-02 拆包）─────────────

  getPermissionResolver(sessionId: string): PermissionResolver | undefined {
    return getPermissionResolver(this._core(), sessionId);
  }

  registerBorrowSandbox(sessionId: string, sandboxRoot: string): void {
    return registerBorrowSandbox(this._core(), sessionId, sandboxRoot);
  }

  getBorrowSandboxRoot(sessionId: string): string | undefined {
    return getBorrowSandboxRoot(this._core(), sessionId);
  }

  private _clearBorrowSandbox(sessionId: string): void {
    return clearBorrowSandbox(this._core(), sessionId);
  }

  async requestPermission(
    sessionId: string,
    input: {
      toolName: string;
      toolInput: Record<string, unknown>;
      signal?: AbortSignal;
      toolUseId?: string;
      isUserInputKind?: boolean;
    },
  ): Promise<CanUseToolDecision> {
    return requestPermission(this._core(), sessionId, input);
  }

  async requestUserDialog(
    sessionId: string,
    input: {
      dialogKind: string;
      dialogPayload: Record<string, unknown>;
      toolUseId?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
    return requestUserDialog(this._core(), sessionId, input);
  }

  private _withinStaleFlipGrace(state: SessionState): boolean {
    return withinStaleFlipGrace(this._core(), state);
  }

  private _writeChannelGuardDeny(
    state: SessionState | undefined,
    toolName: string,
  ): { behavior: 'deny'; message: string } | null {
    return writeChannelGuardDeny(this._core(), state, toolName);
  }

  private _buildCanUseToolCallback(sessionId: string, askUserOnly: boolean): CanUseToolFn {
    return buildCanUseToolCallback(this._core(), sessionId, askUserOnly);
  }

  private _buildOnUserDialogCallback(sessionId: string): OnUserDialogFn {
    return buildOnUserDialogCallback(this._core(), sessionId);
  }

  // ── 驱动获取 / driver options 构造（方法体已下沉 driver-factory.ts）───────────

  private _getDriver(provider: InteractiveProvider): InteractiveDriver {
    return getDriver(this._core(), provider);
  }

  private _resolveMainAgentMcp(ctx: MainAgentMcpContext):
    | Record<string, McpServerConfigForDriver>
    | undefined {
    return resolveMainAgentMcp(this._core(), ctx);
  }

  private _buildDriverOptions(
    state: SessionState,
    spec: DriverOptionsSpec,
  ): Record<string, unknown> {
    return buildDriverOptions(this._core(), state, spec);
  }

  // ── 写守卫簇（方法体已下沉 write-guard.ts）──────────────────────────────────

  private _wrapWithWriteGuard(
    sessionId: string,
    provider: InteractiveProvider,
    inner: CanUseToolFn,
  ): CanUseToolFn {
    return wrapWithWriteGuard(this._core(), sessionId, provider, inner);
  }

  private _sessionOverlayRoots(sessionId: string): string[] | null {
    return sessionOverlayRoots(this._core(), sessionId);
  }

  private _judgeWriteViaPolicyEngine(
    sessionId: string,
    provider: InteractiveProvider,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | null {
    return judgeWriteViaPolicyEngine(this._core(), sessionId, provider, toolName, toolInput);
  }

  private _extractWritePathsForTool(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string[] {
    return extractWritePathsForTool(this._core(), toolName, toolInput);
  }

  private _shellKindOfTool(toolName: string): ReturnType<typeof shellKindOfTool> {
    return shellKindOfTool(toolName);
  }

  private _buildWriteOnlyCanUseToolCallback(_sessionId: string): CanUseToolFn {
    return buildWriteOnlyCanUseToolCallback(this._core(), _sessionId);
  }

  // ── create / 消费协程（类内保留的核心编排）──────────────────────────────────

  /**
   * 创建 session 并启动 driver 协程（design §7.6）。
   *
   * task-02（D-001/FR-01）：不再硬编码 claude；按 `input.provider` 经 `_getDriver`
   * 路由到对应 driver。未注册 provider 抛 UnsupportedProviderError（在写 store 前，不留孤儿）。
   *
   * @throws {SessionAlreadyExistsError} 重复 sessionId
   * @throws {UnsupportedProviderError} provider driver 未注册
   * @throws {SessionLimitReached} 活会话数达 SILLYHUB_MAX_ACTIVE_SESSIONS 上限（task-04 会话闸）
   * @throws {ClaudeExecutableNotFoundError} executable 缺失（driver.start 内抛，透传）
   */
  async create(input: CreateSessionInput & {
    /**
     * task-08（D-006 / D-009）：本次 lease 的 token budget 上限（来自
     * ``LeaseCtx.budget_tokens``，daemon ``_startInteractiveSession`` 透传）。
     * undefined / ≤0 / 非有限数 → 检查点短路（FR-07 零回归）。
     */
    budget_tokens?: number;
  }): Promise<void> {
    // task-05（2026-08-29-batch-session-inherit / S4 / FR-04 / D-002@v1）：resume 损伤
    // 自动降级包装。首次走 _createInternal（含 input.resume → spec.resume →
    // driverOpts.resume 透传，续旧 SDK 会话）；启动错误命中 RESUME_DAMAGE_PATTERNS
    // 且本次带 resume → 清 resume 同参 fresh 重建一次（worker 重派链路不因旧会话
    // transcript 损伤死锁）。降级一次为限不循环。
    try {
      await this._createInternal(input);
      return;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (input.resume === undefined || !RESUME_DAMAGE_PATTERNS.test(message)) {
        // 非损伤模式（网络/权限/executable 缺失等）或本次未带 resume：不降级，
        // 原失败路径抛出（损伤判定只认集中正则命中，防误伤）。
        throw e;
      }
      // 披露（D-003 最小闭环：daemon 侧仅日志，不加新上报协议字段）——warn 日志
      // 含原 resume id，供排查 worker 重派链路的降级情况。
      console.warn('[session-manager] resume_downgraded', {
        sessionId: input.sessionId,
        resume: input.resume,
        error: message,
      });
      // 清首轮挂起 timer：首次 _createInternal 已设 pendingFirstPrompt 10s fallback，
      // 不清则旧 timer 到点会 push 首句 + 删掉重建新挂的条目 → 首句双提交
      //（ql-20260825-002 同款回归）；重建会重新挂一个全新 timer。
      const stalePending = this._pendingFirstPrompt.get(input.sessionId);
      if (stalePending) {
        clearTimeout(stalePending.timer);
        this._pendingFirstPrompt.delete(input.sessionId);
      }
      // 清 resume 后同参 fresh 重建（降级一次为限：再失败在本处直接抛出，走普通
      // create 失败路径 → daemon _startInteractiveSession catch → worker failed，
      // 不二次降级）。不 push prompt——首轮由 pendingFirstPrompt 10s fallback 驱动
      //（与首轮派发同构，S3 设计定论，不动该机制）。
      const { resume: _downgradedResume, ...freshInput } = input;
      await this._createInternal(freshInput);
    }
  }

  /**
   * create 的内部实现（原 create 主体；task-05 拆出供降级分支以清 resume 后的
   * 同参重放）。语义与拆出前逐行等价：driver 解析/会话闸/挂起首句/写 store/
   * driver.start/fire consume，失败时清理半建 state 后抛出。
   */
  private async _createInternal(input: CreateSessionInput & {
    budget_tokens?: number;
  }): Promise<void> {
    // D-001：先解析 driver（未注册即抛，在写 store 前，不留孤儿 state）。
    const driver = this._getDriver(input.provider);
    if (this._store.has(input.sessionId)) {
      throw new SessionAlreadyExistsError(input.sessionId);
    }

    // task-04（design §5.D / FR-06）：会话总数闸——create 前置计数内存 _store 活会话
    // （status 非终态 ended/failed；终态延迟清理条目不计，见 _terminalCleanupTimers）。
    // 活会话数 ≥ _maxActiveSessions（SILLYHUB_MAX_ACTIVE_SESSIONS，默认 20，0=不限）→
    // 抛 SessionLimitReached（daemon _startInteractiveSession 既有 P2b catch 回传 run
    // failed）。restoreAndReconnect 不走本闸（design §7「会话闸误伤 restore」）。
    if (this._maxActiveSessions > 0) {
      // P0 修复（2026-08-26，会话 2eac7c91 实证）：restoreAndReconnect 恢复的历史
      // 会话在 idle 回收默认关闭（_idleTimeoutSec=0）时永不释放，占满额度后新派
      // 分身一律 SESSION_LIMIT_REACHED——闸形同全局禁用团队派发。计数口径收窄为
      // **真活跃**：非终态 且（正在跑 turn 或 近期有活动，窗口 30 分钟）。长期
      // idle 的恢复会话不占额度（它们没有进程成本，只是内存态 + 可被 inject 唤醒；
      // 真正的进程风暴防护由"正在跑 turn"承担）。窗口常量与终态清理延迟同量级。
      const GATE_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
      const now = Date.now();
      let activeCount = 0;
      for (const s of this._store.values()) {
        if (s.status === 'ended' || s.status === 'failed') continue;
        const running = s.status === 'running' || this._pendingInjectCount.has(s.sessionId);
        const recent = s.lastActiveAt > 0 && now - s.lastActiveAt < GATE_ACTIVE_WINDOW_MS;
        if (running || recent) activeCount++;
      }
      if (activeCount >= this._maxActiveSessions) {
        throw new SessionLimitReached(activeCount, this._maxActiveSessions);
      }
    }

    // D-009（task-02）：InputQueue 改 provider-neutral UserTurnInput。SessionManager
    // 不再构造 SDKUserMessage；Claude driver 内部做形态转换（task-03）。
    // ql-20260825-002：firstPrompt 不再直接入队（防与首条 SESSION_INJECT 双提交），
    // 挂起等 inject 消费；超时 fallback 提交（见 _pendingFirstPrompt 注释）。
    const inputQueue = new InputQueue<UserTurnInput>();
    const PENDING_FIRST_FALLBACK_MS = 10_000;
    const pendingTimer = setTimeout(() => {
      this._pendingFirstPrompt.delete(input.sessionId);
      const st = this._store.get(input.sessionId);
      if (!st || st.status === 'ended' || st.status === 'failed') return;
      st.inputQueue.push({ type: 'user', text: input.firstPrompt });
    }, PENDING_FIRST_FALLBACK_MS);
    this._pendingFirstPrompt.set(input.sessionId, {
      prompt: input.firstPrompt,
      timer: pendingTimer,
    });

    // 2. 写 SessionState（status=running，首 turn 的 currentRunId=firstRunId）。
    // scan 真阻塞（generic-wibbling-whisper 改造点 C/B/D）：求值 effective
    // manualApproval / askUserOnly 并写入 state，供 snapshotPersistable 落盘 +
    // restoreAndReconnect 跨 daemon 重启恢复审批能力。
    const enableApproval = input.manualApproval ?? this._manualApproval;
    const effectiveAskUserOnly = input.askUserOnly === true;
    // D-002（task-02）：provider-neutral executable path。codex 用 input.pathToAgentExecutable
    //（daemon _agentPaths.get('codex')）；claude 继续用 pathToClaudeCodeExecutable。
    const exePath = input.pathToAgentExecutable ?? input.pathToClaudeCodeExecutable;
    const state: SessionState = {
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      claimToken: input.claimToken,
      inputQueue,
      status: 'running',
      currentRunId: input.firstRunId,
      lastActiveAt: Date.now(),
      cwd: input.cwd,
      provider: input.provider,
      pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
      pathToAgentExecutable: exePath,
      env: input.env,
      manualApproval: enableApproval,
      askUserOnly: effectiveAskUserOnly,
      driver, // D-001：写入归属 driver，供 interrupt/consume 路由。
      // task-08：depth 状态机已下沉 ClaudeEventNormalizer（事件一等字段 depth 直达），
      // 本字段仅保留满足 SessionState 形状（types.ts 不在本任务 allowed_paths），
      // 恒空 Map、无消费方；types.ts 收口时随字段一并移除。
      subagentDepth: new Map(),
      // task-06：lease stage 持久化（snapshotPersistable 输出，恢复用）。
      stage: input.stage,
      // task-04（2026-08-26-team-subsession-recursion）：分身会话深度承载（来自
      // CreateSessionInput.worker_depth，snapshotPersistable 输出 + restore 保档）。
      // undefined → 旧 lease / 主控 / 普通会话（键穿透，档位判定归 task-05）。
      worker_depth: input.worker_depth,
      // task-10（C-12）：profile 字段承载到 state（写守卫用 effectiveAllowedRoots；
      // mcpRefs/skillRefs 持久化恢复用）。undefined → 不写键（FR-15 行为同今天）。
      ...(input.mcpRefs !== undefined ? { mcpRefs: input.mcpRefs } : {}),
      ...(input.skillRefs !== undefined ? { skillRefs: input.skillRefs } : {}),
      ...(input.effectiveAllowedRoots !== undefined
        ? { effectiveAllowedRoots: input.effectiveAllowedRoots }
        : {}),
      // task-08（sessions-portal）：systemPrompt 写 state（task-05 只透传 driverOpts，
      // state 缺字段致 snapshotPersistable 无法落盘——create 起的档案配置重启会丢，
      // 本任务闭合 config 快照持久化链路）。
      ...(input.systemPrompt !== undefined
        ? { systemPrompt: input.systemPrompt }
        : {}),
      // ql-20260904-017：会话级供应商凭证同款闭合——claim 下发的 provider_config
      // 原本只进 spawn env（内存），daemon 重启后 sessions.json 无凭证、恢复出的
      // SDK 裸起 "Not logged in"（会话 2f08b5da 实证）。记入 state.providerConfig
      // → 既有 snapshotPersistable 落盘 + restore 读回链生效。null/undefined（本机
      // 默认）不写键，与切换供应商链的语义一致。
      ...(input.providerConfig != null
        ? { providerConfig: input.providerConfig }
        : {}),
    };
    this._store.set(input.sessionId, state);
    // ql-20260825-f3#1：同 id 重建（end 后短窗口内 recreate）取消遗留的终态延迟
    // 清理 timer，防到点误删新条目。
    this._cancelTerminalCleanup(input.sessionId);

    // task-08（D-006 / D-009）：登记 session 级 budget_tokens（来自 LeaseCtx）。
    // 复用 _setBudgetTokensInternal 的校验（finite / >0），非法值 → 不登记 = 短路。
    this._setBudgetTokensInternal(input.sessionId, input.budget_tokens);

    // 3. driver.start（若 executable 缺失，这里抛 ClaudeExecutableNotFoundError；
    //    state 已写入 store，但 driver 协程未启动——由 onError 路径不会触发，
    //    daemon 在 _startInteractiveSession 内 try/catch 把 session 收 failed）。
    try {
      // task-08（D-007@v1 / FR-07）：manual_approval=true 时为当前 session 建独立
      // resolver（每 session 一份，互不干扰）+ 构造远程人审 canUseTool 回调；
      // false（默认）时不传，SDK 走内置默认策略（spike H1 行为不变）。
      // _buildDriverOptions 内部按 enableApproval 注入 canUseTool/onUserDialog +
      // 建 resolver（scan 真阻塞，改造点 C/D）；create/restore 复用同一套注入逻辑。
      // task-06：主 agent session 注入 MCP tool（让主 agent discover daemon MCP
      // server 5 tool）。仅 isMainAgentSession 判定为主 agent 时调 provider 取配置；
      // provider 未注入 / 返回 undefined → 不注入（普通会话零回归）。
      //谓词/provider 签名用 MainAgentMcpContext（create + restore 共用），从 input 归一化。
      //task-10（C-12）：profile 字段（mcpRefs/skillRefs/effectiveAllowedRoots）随 ctx
      //传入 _resolveMainAgentMcp 供 mcpRefs 过滤；effectiveAllowedRoots 写 state 供写守卫。
      const mainAgentMcp = this._resolveMainAgentMcp({
        sessionId: input.sessionId,
        leaseId: input.leaseId,
        provider: input.provider,
        cwd: input.cwd,
        model: input.model,
        stage: input.stage,
        // task-04：分身深度随 ctx 传入（受限分支谓词 / provider 消费；本卡只承载，
        // 分档判定归 task-05——非叶 5 工具 / 叶仅 worker_done）。
        worker_depth: input.worker_depth,
        mcpRefs: input.mcpRefs,
        skillRefs: input.skillRefs,
        effectiveAllowedRoots: input.effectiveAllowedRoots,
        systemPrompt: input.systemPrompt,
      });
      const driverOpts = this._buildDriverOptions(state, {
        exePath,
        model: input.model,
        allowedTools: input.allowedTools,
        env: input.env,
        enableApproval,
        effectiveAskUserOnly,
        // task-05（2026-08-29-batch-session-inherit / D-001@v1）：resume 透传——
        // CreateSessionInput.resume（daemon.ts task-04 已从 execPayload.resumeSessionId
        // 归一化传入）→ spec.resume → driverOpts.resume 既有链（worker 重派续旧 SDK
        // 会话）。undefined（旧 backend 无该键）→ 键不写入，全新会话原路径（零回归）。
        resume: input.resume,
        mcpServers: mainAgentMcp,
        systemPrompt: input.systemPrompt,
      });
      // task-02（D-001）：用 session 归属 driver（不再全局 this.deps.driver）。
      // 过渡期 ClaudeSdkDriver.start 同步返回 Query、InteractiveDriver.start 返回
      // Promise<Handle>；统一 await（同步返回值经 await 等价直传）。按 provider 写句柄：
      // claude → state.query（SDK Query）；codex → state.driverHandle。
      const handleOrQuery = (await driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;
      if (input.provider === 'claude') {
        // task-08：经 SessionState['query'] 结构类型断言（SessionManager 内
        // @anthropic-ai/claude-agent-sdk 类型 import 清零；Query 类型由 types.ts 持有）。
        state.query = handleOrQuery as SessionState['query'];
      } else {
        state.driverHandle = handleOrQuery as InteractiveDriverHandle;
      }

      // 4. 异步 fire driver.consume（不阻塞 create 返回）。
      void this._runConsume(state);
      // task-10：create 成功排队 flush（agentSessionId 尚未写入，snapshotPersistable
      // 会过滤；真正的「带 agentSessionId 落盘」发生在 _onMessage system/init 后再 flush）。
      this._scheduleFlush();
    } catch (e) {
      // driver.start 抛错（executable 缺失等）：state 已在 store，标 failed。
      this._store.delete(input.sessionId);
      // ql-20260825-f3#7：对称清理 budget 软切断登记——_setBudgetTokensInternal 在
      // try 前已执行（上方第 2 步），失败路径不回收则 _sessionBudgetTokens 条目
      // 只增不减。task-08：_destroyUsageLedger 统一回收 budget/usage 台账，保持
      // 成功/失败清理对称。
      this._destroyUsageLedger(input.sessionId);
      // task-08：create 失败前若已注册 pending resolver（register 在 start 前，
      // 但 start 抛错发生在 register 之后极不可能），防御性 abortAll 清理。
      const r = this._resolversBySession.get(input.sessionId);
      if (r) {
        r.abortAll('session_create_failed');
        this._resolversBySession.delete(input.sessionId);
      }
      throw e;
    }
  }

  /** driver.consume 协程：一个 session 启动一次，跨多 turn。
   *
   * task-02（D-001）：用 `state.driver`（session 归属）+ 按 provider 选 target
   *（claude=state.query；codex=state.driverHandle）。过渡兼容：旧内存 state（task-02 前
   * 创建）无 driver 字段 → fallback `_drivers.claude`（FR-10 不回退）。
   *
   * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：回调
   * **envelope-only**——只提供 InteractiveDriverCallbacks 新键（onTurnResult/
   * onTurnMessage/onTurnError），ClaudeSdkDriver 的旧键兜底（onResult/onMessage/
   * onError，raw SDK 消息透传）已随本任务收口移除；onTurnMessage 收
   * TurnMessageEnvelope{events}，经 _onMessage 逐事件分发。 */
  private async _runConsume(state: SessionState): Promise<void> {
    const driver = state.driver ?? this._drivers.claude;
    if (!driver) return;
    // 按 provider 选 consume target：claude=Query，codex=InteractiveDriverHandle。
    const target = state.provider === 'claude' ? state.query : state.driverHandle;
    if (!target) return;
    // ql-20260807-001 根因修复（orphan consume 守卫）：
    // reloadWithProvider 替换 state.query 后，本协程持有的 target 变成 orphan。
    // oldQuery.close() 让 SDK 迭代器抛 abort 错（"Claude Code process aborted by user"，
    // sdk.mjs close→spawnAbort(Error) + process exit 设 exitError）→ driver consume
    // catch → onError。旧实现无条件 fail(sessionId)：reload 后 status=active，fail 守卫
    // 只挡 ended/failed → 放行 → _terminateSession 把刚 reload 的 session 打成 failed +
    // close 掉新 query（state.query 已替换为新引用）+ onSessionEnd（backend ended）。
    // 此谓词判定本 consume 是否仍是 session 当前活跃消费者；reload 换 query 后返回 false，
    // 终态回调（onError/catch/onResult/onMessage）静默丢弃，不误杀新会话。
    // 成立前提：reloadWithProvider 已保证先替换 state.query 再 close oldQuery（commit
    // c401319 / ql-20260806-002），故 oldQuery.close 触发旧 consume 回调时 state.query
    // 已指向新 query，谓词正确判 orphan。两次连续 reload 同理（中间那个 consume 变 orphan）。
    const isAuthoritative = (): boolean => {
      const current =
        state.provider === 'claude' ? state.query : state.driverHandle;
      return current === target;
    };

    const onResultCb = async (r: InteractiveDriverResult): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：reload 已换 query，旧 result 丢弃
      await this._onResult(state, r);
    };
    const onMessageCb = async (envelope: TurnMessageEnvelope): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：旧 query 残留事件丢弃
      await this._onMessage(state, envelope);
    };
    const onError = (_e: unknown): void => {
      // 边界 2：driver 异常 → fail。fail 内部幂等。
      // orphan（reload 后旧 query.close 触发的 abort 错）静默丢弃，不 fail 新会话。
      if (!isAuthoritative()) return;
      void this.fail(state.sessionId).then(() => undefined, () => undefined);
    };
    // task-08：envelope-only（旧键 onResult/onMessage/onError 兜底分支已删）。
    const callbacks: InteractiveDriverCallbacks = {
      onTurnResult: onResultCb,
      onTurnMessage: onMessageCb,
      onTurnError: onError,
    };
    try {
      await driver.consume(
        target as InteractiveDriverHandle,
        callbacks,
      );
    } catch {
      // consume 自身不应抛（driver.consume 内 try/catch），防御性标 failed。
      // orphan（reload 后旧 query.close 触发迭代器抛错）静默丢弃，不 fail 新会话。
      if (!isAuthoritative()) return;
      void this.fail(state.sessionId).then(
        () => undefined,
        () => undefined,
      );
    }
    // task-08（生命周期收敛）+ task-09 边界 12（防御性）：consume 退出（正常 result
    // 结束 / generator throw）时清空当前 session 的 pending resolver，绝不让回调悬空
    // 或跨 turn 命中。manualApproval=false 时该 session 无 resolver，?. 不调。
    // task-09：abortAll 调用包 try/catch（resolver 可能是 mock / 缺方法的测试替身，
    // 或 resolver 内部异常）—— 绝不让清理路径自身抛出导致 daemon 主循环崩 / zombie promise。
    const exitingResolver = this._resolversBySession.get(state.sessionId);
    if (exitingResolver && typeof exitingResolver.abortAll === 'function') {
      try {
        exitingResolver.abortAll('consume_exited');
      } catch {
        // 清理路径不抛（resolver 内部异常已被 settle 的 promise 吞，pending 不残留）。
      }
    }
  }

  // ── 附件/注入/计划响应/中断簇（方法体已下沉 turn-control.ts）────────────────

  private async _writeAttachmentFile(cwd: string, rawName: string, buf: Buffer): Promise<string> {
    return writeAttachmentFile(this._core(), cwd, rawName, buf);
  }

  async refreshClaimToken(sessionId: string, claimToken: string): Promise<void> {
    return refreshClaimToken(this._core(), sessionId, claimToken);
  }

  private _downloadAttachmentWithTimeout(
    sessionId: string,
    downloadAttachment: (id: string) => Promise<Buffer>,
    attachmentId: string,
  ): Promise<Buffer> {
    return downloadAttachmentWithTimeout(sessionId, downloadAttachment, attachmentId);
  }

  async inject(
    sessionId: string,
    prompt: string,
    runId: string,
    attachments?: SessionInjectAttachment[],
    downloadAttachment?: (id: string) => Promise<Buffer>,
  ): Promise<InjectResult> {
    return inject(this._core(), sessionId, prompt, runId, attachments, downloadAttachment);
  }

  async resolvePlanResponse(
    sessionId: string,
    runId: string,
    decision: 'confirm' | 'revise' | 'cancel',
    feedback?: string | null,
  ): Promise<boolean> {
    return resolvePlanResponse(this._core(), sessionId, runId, decision, feedback);
  }

  async interrupt(sessionId: string): Promise<boolean> {
    return interrupt(this._core(), sessionId);
  }

  private async _interruptInternal(state: SessionState): Promise<boolean> {
    return interruptInternal(this._core(), state);
  }

  getPendingInjectCount(sessionId: string): number {
    return getPendingInjectCount(this._core(), sessionId);
  }

  // ── task-08（D-006 / D-009）：interactive budget 软切断（方法体已下沉 usage.ts）──

  setBudgetTokens(sessionId: string, budgetTokens: number | undefined): void {
    return setBudgetTokens(this._core(), sessionId, budgetTokens);
  }

  private _setBudgetTokensInternal(
    sessionId: string,
    budgetTokens: number | undefined,
  ): void {
    return setBudgetTokensInternal(this._core(), sessionId, budgetTokens);
  }

  isOverBudget(sessionId: string): boolean {
    return isOverBudget(this._core(), sessionId);
  }

  private _aggregateSessionUsage(sessionId: string): SessionUsageTotals {
    return aggregateSessionUsage(this._core(), sessionId);
  }

  private _liftSessionUsage(state: SessionState, ev: AgentEvent): void {
    return liftSessionUsage(this._core(), state, ev);
  }

  private _foldTurnUsage(state: SessionState): void {
    return foldTurnUsage(this._core(), state);
  }

  private _checkBudgetCutoff(state: SessionState, runId: string): void {
    return checkBudgetCutoff(this._core(), state, runId);
  }

  // ── 空闲扫描/终止/清理/状态查询簇（方法体已下沉 lifecycle.ts）─────────────────

  getIdleTimeoutSec(): number {
    return getIdleTimeoutSec(this._core());
  }

  start(): void {
    return start(this._core());
  }

  stop(): void {
    return stop(this._core());
  }

  async scanOnce(): Promise<void> {
    return scanOnce(this._core());
  }

  private async _scanIdle(): Promise<void> {
    return scanIdle(this._core());
  }

  async end(sessionId: string): Promise<void> {
    return end(this._core(), sessionId);
  }

  async fail(sessionId: string): Promise<void> {
    return fail(this._core(), sessionId);
  }

  private async _terminateSession(
    state: SessionState,
    reason: 'manual' | 'driver_error',
    opts: { notifyBackend?: boolean } = {},
  ): Promise<void> {
    return terminateSession(this._core(), state, reason, opts);
  }

  private _scheduleTerminalCleanup(sessionId: string): void {
    return scheduleTerminalCleanup(this._core(), sessionId);
  }

  private _cancelTerminalCleanup(sessionId: string): void {
    return cancelTerminalCleanup(this._core(), sessionId);
  }

  private _abortPermissionResolver(sessionId: string, reason: string): void {
    return abortPermissionResolver(this._core(), sessionId, reason);
  }

  get(sessionId: string): Readonly<SessionState> | undefined {
    return get(this._core(), sessionId);
  }

  hasRunningTurn(): boolean {
    return hasRunningTurn(this._core());
  }

  // ── task-10：持久化 + 崩溃恢复（方法体已下沉 persistence.ts）─────────────────

  snapshotPersistable(): PersistedSessionRecord[] {
    return snapshotPersistable(this._core());
  }

  async restoreAndReconnect(record: PersistedSessionRecord): Promise<void> {
    return restoreAndReconnect(this._core(), record);
  }

  async markReconnected(sessionId: string): Promise<void> {
    return markReconnected(this._core(), sessionId);
  }

  async flush(): Promise<void> {
    return flush(this._core());
  }

  /** task-10：排队 flush 去抖在途标记（本体由 persistence.scheduleFlush 维护）。 */
  private _flushScheduled: Promise<void> | null = null;

  private _scheduleFlush(): void {
    return scheduleFlush(this._core());
  }

  // ── 内部：driver.consume 回调（方法体已下沉 events.ts）──────────────────────

  private async _onResult(state: SessionState, result: InteractiveDriverResult): Promise<void> {
    return onResult(this._core(), state, result);
  }

  private async _onMessage(
    state: SessionState,
    envelope: TurnMessageEnvelope,
  ): Promise<void> {
    return onMessage(this._core(), state, envelope);
  }

  private async _dispatchStatusEvent(
    state: SessionState,
    ev: AgentEvent,
    envelopeHasTaskToolUse: boolean,
  ): Promise<void> {
    return dispatchStatusEvent(this._core(), state, ev, envelopeHasTaskToolUse);
  }

  private _registerAgentToolUseMeta(
    state: SessionState,
    ev: AgentEvent,
  ): void {
    return registerAgentToolUseMeta(this._core(), state, ev);
  }

  private async _maybeRegisterAsyncReceipt(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    return maybeRegisterAsyncReceipt(this._core(), state, ev);
  }

  private _eventToReportDict(
    state: SessionState,
    ev: AgentEvent,
  ): Record<string, unknown> {
    return eventToReportDict(this._core(), state, ev);
  }

  private _nextEventSeq(sessionId: string): number {
    return nextEventSeq(this._core(), sessionId);
  }

  private _emitSessionEvent(
    sessionId: string,
    runId: string,
    event: SessionEventForBackend,
  ): void {
    return emitSessionEvent(this._core(), sessionId, runId, event);
  }

  // ── 后台任务生命周期消费簇（方法体已下沉 background-tasks.ts）────────────────

  private async _handleAgentTaskStatusEvent(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    return handleAgentTaskStatusEvent(this._core(), state, ev);
  }

  private async _handleTaskNotificationEvent(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    return handleTaskNotificationEvent(this._core(), state, ev);
  }

  private _scheduleTaskWakeup(
    sessionId: string,
    info: {
      taskId: string;
      taskName: string;
      status: string;
      elapsedMs?: number;
      summary?: string;
    },
  ): void {
    return scheduleTaskWakeup(this._core(), sessionId, info);
  }

  private async _registerAsyncReceiptTask(
    state: SessionState,
    runId: string | undefined,
    agentId: string,
    toolUseId: string,
  ): Promise<void> {
    return registerAsyncReceiptTask(this._core(), state, runId, agentId, toolUseId);
  }

  private async _writeTaskLine(
    sessionId: string,
    runId: string,
    prefix: '[TASK_STARTED]' | '[TASK_PROGRESS]' | '[TASK_NOTIFICATION]',
    payload: Record<string, unknown>,
    parentToolUseId?: string,
  ): Promise<void> {
    return writeTaskLine(this._core(), sessionId, runId, prefix, payload, parentToolUseId);
  }

  private _getOrCreateTaskMap(
    sessionId: string,
  ): Map<string, BackgroundTaskInfo> {
    return getOrCreateTaskMap(this._core(), sessionId);
  }

  private _clearBackgroundTasks(sessionId: string): void {
    return clearBackgroundTasks(this._core(), sessionId);
  }

  private _destroyUsageLedger(sessionId: string): void {
    return destroyUsageLedger(this._core(), sessionId);
  }

  // ── 供应商/配置热切换 reload 簇（类内保留编排）───────────────────────────────

  /**
   * task-07（provider-switch-live-session / D-002@v1）：标记待处理的供应商热切换。
   *
   * backend set/unset_default → WS PROVIDER_CONFIG_CHANGED → daemon 分发调本方法：
   *   - session 空闲（status=active 且无 currentRunId）→ 立即 fire-and-forget
   *     ``reloadWithProvider``，**不**写 pendingSwitch 标记（无需等 turn 边界）。
   *   - session 生成中（status=running，turn in-flight）/ reconnecting 等 → 仅覆盖写
   *     ``state.pendingSwitch``，**严格不中断**当前 turn；turn 收尾（``_onResult``）
   *     检测到标记后清标记并触发 reload（D-002@v1 等 turn 边界语义）。
   *
   * 幂等：WS 重放同一/不同切换均覆盖写 state.pendingSwitch，不累积（design R-02）。
   * 同步返回（void）：reload 走 fire-and-forget，不阻塞 WS 分发路径。
   *
   * @param sessionId 目标会话
   * @param providerConfig 新供应商配置；null 表示停止（回退本机凭证，D-004@v1）
   * @throws {SessionNotFoundError} session 不存在
   */
  markPendingSwitch(sessionId: string, providerConfig: ProviderConfig | null): void {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // 空闲：无在跑 turn（status=active 且 currentRunId 空）→ 立即 reload，不写标记。
    if (state.status === 'active' && !state.currentRunId) {
      void this.reloadWithProvider(sessionId, providerConfig).catch((err) => {
        // reload 失败保留旧 query 不破坏会话（design §5 Wave3 / R-01）。
        // ql-20260825-f3#2：静默吞错曾让「切换 toast 成功但实际没生效」无从排查
        //（config switch 路径 ql-20260818-002 同款教训）——必须留 error 日志。
        // eslint-disable-next-line no-console
        console.error(
          '[session-manager] idle provider switch reload failed',
          sessionId,
          err,
        );
      });
      return;
    }
    // 生成中 / reconnecting：仅覆盖写标记，不中断当前 turn（constraints）。
    // 覆盖写幂等（WS 重放安全，不累积）。
    state.pendingSwitch = { providerConfig };
  }

  /**
   * task-07（provider-switch-live-session / D-002@v1）：用新供应商凭证受控重启
   * driver 子进程并 resume 对话历史（保留完整上下文，design G1/G2）。
   * task-03（2026-09-11-session-provider-switch-codex-pi）：解锁 codex / pi——
   * 删除原「仅 claude」守卫，热切换对 codex/pi 走共享 reload 内核确定性生效
   * （FR-04，D-003@v1；codex/pi 的文件层配置写盘 + env 合并 + codex thread
   * 迁移钩子见 ``_reloadSessionNow`` 内 task-03 块）。
   *
   * 真实方法体由 **task-08 实现**（参考现有 ``restoreAndReconnect``：close 旧 query
   * → buildSpawnEnv(providerConfig) 构造新 env（null 时第 0 层跳过 → 本机凭证）→
   * driver.start({ resume: state.agentSessionId, env, ...原 opts }) 从 jsonl 重新
   * 加载对话历史 → 替换 state.query/state.env → 重启 consume 协程）。
   *
   * 步骤（design §5 Wave3 + constraints）：
   *   ① ``handle.close?.()`` 优雅终止旧子进程（走 SDK kill 链：close → stdin EOF →
   *      2s 宽限 → SIGTERM → 5s → SIGKILL），与 ``_terminateSession`` 同源 close 入口；
   *      **不**调 ``_terminateSession``（那是终态收口会 onSessionEnd + 改 status + close
   *      InputQueue），reload 仅重启子进程，session 仍 active 可续轮。**不 close
   *      InputQueue**（复用同一队列给新 driver.start，reload 短窗口内 inject 走排队语义）。
   *   ② ``buildSpawnEnv({ provider_config }, { credential })`` 构造新 env：
   *      provider_config 非 null → 第 0 层 injector 产 ANTHROPIC_* env 盖过下层 +
   *      隔离 CLAUDE_CONFIG_DIR；null → 第 0 层跳过 + 不隔离 CLAUDE_CONFIG_DIR（回退
   *      本机 ~/.claude/settings.json，D-004@v1 停止场景对称覆盖）。credential 缺失
   *      （未注入 / 测试）用 noopCredential（对齐 daemon.ts:3050 同款 fallback）。
   *   ③ 校验 ``state.agentSessionId`` 必需——它是 SDK jsonl 恢复 key（首 turn system/init
   *      写入），缺失说明首 turn 未完成 → 无可恢复 jsonl → 抛错（不启动新会话替换语义）。
   *   ④ ``_buildDriverOptions`` 透传 cwd / canUseTool / mcpServers / permissionMode +
   *      ``resume: state.agentSessionId`` + 新 env（原 opts 透传；model/allowedTools 不在
   *      SessionState 仅 CreateSessionInput/PersistedSessionRecord 持有，reload 不传 → SDK
   *      走 env 默认，reload 场景 env 已含 ANTHROPIC_DEFAULT_*_MODEL 等）。
   *   ⑤ ``await driver.start(state.inputQueue, driverOpts)`` —— SDK spawn 新 claude 子进程
   *      并从 ``~/.claude/projects/<encoded-cwd>/<sid>.jsonl`` 重载完整对话历史。复用
   *      ``state.inputQueue``（reload 不 close 队列，新 query 订阅同一队列吃后续 inject）。
   *   ⑥ 替换 ``state.query``（claude）/ ``state.driverHandle``（codex/pi 等非 claude
   *      provider）+ ``state.env``，重启 ``_runConsume`` 协程，清 ``state.pendingSwitch``（幂等兜底：
   *      markPendingSwitch 空闲路径不写标记 / _onResult 路径已清，此处防状态机遗漏）。
   *   ⑦ reload 失败（spawn 失败 / jsonl 缺失 / cwd 不一致）→ catch 回滚保留旧 query/env
   *      + ``console.error`` 上报 + **重新抛**（调用方 markPendingSwitch / _onResult 的
   *      ``.catch`` 兜底已吞错防 unhandled rejection）。**不破坏会话**（R-01 降级）：
   *      不改 status、不从 store 移除、不清 pendingSwitch（留待重试或人工介入）。
   *
   * **reload 与 inject 并发**（待细化点① 收口，不引入新锁）：reload 期间 status 保持
   * active（markPendingSwitch 空闲路径 + _onResult 收尾后触发都满足此条件），inject
   * 走 ``state.inputQueue.push`` 不拒绝（spike S1 turn 级串行）；新 query 启动后从队列
   * 消费后续 inject，不丢消息。若 inject 在 reload step⑤ await 期间到达，push 进队列
   * 后由新 query 启动后立即消费（自然排队，无需 _pendingInjectCount 计数——counter 仅
   * 在 status=running 时递增做可观察性，reload 期间 status=active 不递增但消息不丢）。
   *
   * @param sessionId 目标会话
   * @param providerConfig 新供应商配置；null 表示停止（回退本机凭证，第 0 层 env 跳过）
   * @throws {SessionNotFoundError} session 不存在
   * @throws {Error} agentSessionId 缺失 / spawn 失败 / jsonl 缺失 / cwd 不一致
   *         （catch 回滚保留旧 query 后重新抛；task-03 起对任意已注册 provider
   *         provider-generic，不再有「非 claude 不支持」分支）
   */
  async reloadWithProvider(
    sessionId: string,
    providerConfig: ProviderConfig | null,
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // 共享 reload 内核：行为与重构前内联实现逐字节等价（provider_config null/非 null
    // env 构造、agentSessionId 守卫、resetForResubscribe、close 后置、失败回滚）。
    // task-03（2026-09-11-session-provider-switch-codex-pi）：删除原 task-08 的
    // claude-only 守卫（provider !== 'claude' 抛 not yet supported）——内核已
    // provider-generic，codex/pi 同走（文件层配置接入见 _reloadSessionNow 内
    // task-03 块）；claude 路径零漂移。
    await this._reloadSession(sessionId, { providerConfig });
  }

  // ── task-08（2026-08-14-sessions-portal / FR-05 / D-012@v1）：会话级配置热切换 ──

  /**
   * task-08（design §7.3 / FR-05 / D-012@v1）：标记待处理的会话级配置切换。
   *
   * backend inject_session（带新配置 + prompt）→ WS SESSION_SWITCH_CONFIG
   *（daemon.ts 路由归 task-09）→ 本方法：
   *   - session 空闲（status=active 且无 currentRunId）→ 立即 fire-and-forget
   *     ``reloadWithConfig``，不写 pendingConfigSwitch 标记（无需等 turn 边界）。
   *   - session 生成中（status=running，turn in-flight）/ reconnecting 等 → 仅覆盖写
   *     ``state.pendingConfigSwitch``，严格不中断当前 turn；turn 收尾（``_onResult``）
   *     检测到标记后清标记并触发 reload（等 turn 边界语义，对齐 markPendingSwitch）。
   *
   * 幂等：WS 重放同一/不同切换均覆盖写，不累积。同步返回（void）：reload 走
   * fire-and-forget，不阻塞 WS 分发路径（task-09 daemon.ts 同款消费姿势）。
   *
   * @throws {SessionNotFoundError} session 不存在
   */
  markPendingConfigSwitch(
    sessionId: string,
    payload: SessionSwitchConfigPayload,
  ): void {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // 空闲：无在跑 turn → 立即 reload + 喂切换轮 prompt，不写标记。
    if (state.status === 'active' && !state.currentRunId) {
      void this.reloadWithConfig(sessionId, payload).catch((err) => {
        // reload 失败保留旧 query 不破坏会话（R-01）。
        // ql-20260818-002：静默吞错曾致「切换 toast 成功但实际没生效」无从排查
        // ——必须留 error 日志（真实 log 在 daemon 层，此处 console 兜底同款惯例）。
        console.error(
          '[session-manager] idle config switch reload failed',
          sessionId,
          err,
        );
      });
      return;
    }
    // 生成中 / reconnecting：仅覆盖写标记，不中断当前 turn。覆盖写幂等（WS 重放安全）。
    state.pendingConfigSwitch = { payload };
  }

  /**
   * task-08（design §7.3 / FR-05 / D-012@v1）：会话内配置热切换——关旧 query →
   * 按 payload 重建 driverOpts（新 systemPrompt / providerConfig）→ ``driver.start
   * ({resume})`` 从 jsonl 重载历史 → 喂入切换轮 prompt。
   *
   * payload 语义（design §7.2）：
   *   - ``profile`` 非 null → 切档案：state.systemPrompt/mcpRefs/skillRefs 更新为
   *     payload 值（systemPrompt 仅 claude 注入 preset+append；codex 只切配置不注
   *     人格，原 D-003 / NG-02）；null → 不切档案（保留现值）。
   *   - ``providerConfig`` 非 null → 切供应商；**null → 切回本机默认**（清掉
   *     state.providerConfig，第 0 层 env 跳过；ql-20260824-016 修正——原「null=
   *     不切」语义与后端契约冲突：service.py 切回本机时正是下发 null，?? 塌缩导致
   *     旧供应商 env 永远清不掉）；undefined（字段缺席）→ 不切（保持现值，
   *     reloadWithProvider(null) 的「停止」与显式 null 同为切本机）。
   *   - ``claimToken`` 非空 → 刷新 state.claimToken（切换轮新 token）。
   *   - ``prompt`` 非空 → reload 成功后 push 进 inputQueue + currentRunId=runId +
   *     status=running（对齐 inject 语义，onTurnMessage/onTurnResult 据此路由）。
   *
   * 失败不破坏会话（R-01）：内核回滚旧 query/env/config，session 维持原状（constraints：
   * 切换不改会话状态机——成功路径 status 由「喂 prompt」推进到 running，属正常 turn）。
   *
   * @throws {SessionNotFoundError} session 不存在
   * @throws {SessionNotActiveError} session 已 ended/failed（终态不可切）
   * @throws {Error} agentSessionId 缺失 / spawn 失败（回滚保留旧 query 后重新抛）
   */
  async reloadWithConfig(
    sessionId: string,
    payload: SessionSwitchConfigPayload,
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    if (state.status === 'ended' || state.status === 'failed') {
      throw new SessionNotActiveError(sessionId, state.status);
    }
    // 切换轮 claim_token 刷新（对齐 refreshClaimToken 语义；空串不覆盖）。
    if (payload.claimToken) {
      state.claimToken = payload.claimToken;
    }
    // 计算生效配置（null = 切到无人格（内核清空）；undefined = 不参与保持现状）。
    // ql-20260818-009：取消档案 → backend 发空串 systemPrompt——仅清 system prompt
    // 不够：fork 继承的对话历史里有此前人格的角色扮演轮，模型会从上下文延续角色
    // （实测「取消后仍自称设计师」）。归一为**中和指令**（append 压掉历史角色惯性），
    // 而非 null（preset-only）。
    const nextSystemPrompt =
      payload.profile !== null && payload.profile !== undefined
        ? ((payload.profile.systemPrompt ?? '').trim()
            ? payload.profile.systemPrompt
            : CLEAR_PERSONA_PROMPT)
        : (state.systemPrompt ?? null);
    // ql-20260824-016：显式区分 undefined 与 null——后端切回本机默认下发
    // providerConfig:null，字段缺席才是「不切该维度」。原 ?? 写法把 null 塌缩成
    // 沿用 state.providerConfig（旧供应商），「切回本机」永不生效（实测切回后
    // /model 仍显示 glm-5.1、流量仍走旧供应商）。daemon.ts 路由层已同步保留
    // undefined/null 区别（不再 ?? null 归一）。
    const nextProviderConfig =
      payload.providerConfig !== undefined
        ? payload.providerConfig
        : (state.providerConfig ?? null);

    // ql-20260818-002/004：切档案（含取消）的 reload 走 forkSession（resume 时
    // systemPrompt 选项被 CLI 忽略，fork 新会话才生效）——置位 forkedInitPending
    // 让新 session_id 能经 system/init 更新 state（否则持久化旧 id 下次 resume
    // 回旧会话）。provider-only 切换不 fork（人格已在 jsonl 固化，resume 自然保留）。
    const profileSwitched = payload.profile != null;
    if (profileSwitched) {
      state.forkedInitPending = true;
    }

    await this._reloadSession(sessionId, {
      systemPrompt: nextSystemPrompt,
      providerConfig: nextProviderConfig,
      forkSession: profileSwitched,
    });
    // reload 成功：同步 profile 承载字段（mcpRefs/skillRefs 透传；systemPrompt 已由
    // 内核写入 state）。profile=null 不动（保留现值）。
    if (payload.profile) {
      state.mcpRefs = payload.profile.mcpRefs;
      state.skillRefs = payload.profile.skillRefs;
    }

    // 喂入切换轮 prompt（内核已 resetForResubscribe + 新 query 订阅同一 inputQueue）。
    if (payload.prompt) {
      state.inputQueue.push({ type: 'user', text: payload.prompt });
      state.currentRunId = payload.runId;
      state.status = 'running';
    }
    state.lastActiveAt = Date.now();
    this._scheduleFlush();
  }

  /**
   * task-08（design §5 Wave2 / Grill C-07）：共享 reload 内核——受控重启 driver
   * 子进程并 resume 对话历史。``reloadWithProvider``（供应商热切换）与
   * ``reloadWithConfig``（会话级配置热切换）复用，保留三次实战修复语义：
   * CLAUDE_CONFIG_DIR 隔离（ql-20260807-002）/ close 后置（ql-20260806-002）/
   * resetForResubscribe（ql-20260807-001 orphan consume 守卫配套）。
   *
   * 步骤（沿用原 reloadWithProvider 内联实现，零语义漂移）：
   *   ① 快照旧句柄/env/config 供失败回滚（R-01）。claude 句柄=state.query；
   *      codex=state.driverHandle（reloadWithConfig 的 Codex 路径：只切 providerConfig，
   *      不注人格——systemPrompt 仅 claude 消费，原 D-003 / NG-02）。
   *   ② ``buildSpawnEnv`` 构造新 env：provider_config 非 null → 第 0 层 injector 产
   *      ANTHROPIC_* env + 隔离 CLAUDE_CONFIG_DIR；null → 第 0 层跳过（本机凭证）。
   *      随后 ``applyTranscriptConfigDir`` 按 transcript 实际位置覆盖（ql-20260822-009）：
   *      jsonl 在隔离目录 → 强制隔离（ql-20260807-002 停供应商语义）；仅在宿主机
   *      ~/.claude → 不隔离（create 未配供应商的会话）；都没有 → 维持隔离默认。
   *   ③ 校验 ``state.agentSessionId`` 必需（SDK jsonl 恢复 key；缺失=首 turn 未完成
   *      → 无可恢复 jsonl → 抛错，不启动全新会话替换语义）。
   *   ④ ``_buildDriverOptions`` 透传 cwd / canUseTool / mcpServers / permissionMode +
   *      ``resume: state.agentSessionId`` + 新 env；``opts.systemPrompt`` 提供且
   *      provider=claude 时注入 systemPrompt preset+append（codex 忽略）。
   *   ⑤ ``state.inputQueue.resetForResubscribe()``（InputQueue 单订阅；不 reset 则新
   *      query 二次订阅抛 SessionQueueDoubleSubscribeError → session ended）+
   *      ``await driver.start(state.inputQueue, driverOpts)``。
   *   ⑥ 替换 state.query（claude）/ state.driverHandle（codex）+ state.env +
   *      state.providerConfig +（opts.systemPrompt 提供时）state.systemPrompt →
   *      **close 旧句柄**（必须在替换之后，ql-20260806-002）→ 清 pendingSwitch /
   *      pendingConfigSwitch（幂等兜底）→ 重启 consume 协程 → 排队 flush。
   *   ⑦ 失败（spawn 失败 / jsonl 缺失 / cwd 不一致）→ catch 回滚旧句柄/env/config +
   *      ``console.error`` + 重新抛（调用方 .catch 兜底已吞错）。不破坏会话
   *      （R-01 降级：不改 status、不从 store 移除）。
   *
   * @param sessionId 目标会话
   * @param opts.providerConfig 新供应商配置。undefined → 沿用 state.providerConfig
   *        现值（缺省 null）；null → 本机凭证（第 0 层跳过）。
   * @param opts.systemPrompt 新人格提示词。undefined → 不参与（reloadWithProvider
   *        既有路径，零语义漂移：不注入、不动 state）；string 且 provider=claude →
   *        注入 preset+append 并写 state.systemPrompt；null → 显式清空（切到无人格，
   *        不注入 + state.systemPrompt=undefined）。codex 任何值都不注入不写（原 D-003）。
   * @throws {SessionNotFoundError} session 不存在
   * @throws {Error} agentSessionId 缺失 / spawn 失败 / jsonl 缺失 / cwd 不一致
   */
  private async _reloadSession(
    sessionId: string,
    opts: {
      systemPrompt?: string | null;
      providerConfig?: ProviderConfig | null;
      /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
      forkSession?: boolean;
    },
  ): Promise<void> {
    // ql-20260825-f3#2：per-session 串行化（chain 模式）。等上一轮同会话 reload 完成
    // 再开始本轮核心段——上一轮失败不阻塞本轮（错误已由其调用方 .catch 记日志，
    // 这里只保证顺序），本轮失败照常向上抛给本调用方。state 查询移入核心段
    //（_reloadSessionNow）：排队期间 session 可能已被删（终态清理 / restore 驱逐），
    // 排队前查询会拿到陈旧 state 造成孤儿句柄。
    const prev = this._reloadChains.get(sessionId);
    const run = (
      prev ? prev.catch(() => undefined) : Promise.resolve()
    ).then(() => this._reloadSessionNow(sessionId, opts));
    // 链尾永不 reject：存入 Map 供下一轮 await（下一轮 .catch(() => undefined) 兜底，
    // 但 settled-with-rejection 的 promise 若无人 await 会在 Node 报 unhandled——
    // 直接吞掉再存，安全且语义等价）。
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this._reloadChains.set(sessionId, tail);
    void tail.then(() => {
      // 自愈摘除：本轮回 finish 且没有更新一轮入链时，删掉链尾（有更新一轮则保留，
      // 由那一轮负责删除——比较引用防误删后轮的 entry）。
      if (this._reloadChains.get(sessionId) === tail) {
        this._reloadChains.delete(sessionId);
      }
    });
    await run;
  }

  /** `_reloadSession` 的串行化核心段（由 chain 包装器保证同会话顺序执行）。 */
  private async _reloadSessionNow(
    sessionId: string,
    opts: {
      systemPrompt?: string | null;
      providerConfig?: ProviderConfig | null;
      /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
      forkSession?: boolean;
    },
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }

    // 生效 provider_config：undefined=沿用会话当前配置（reloadWithConfig 不切供应商
    // 路径）；null=本机凭证（buildSpawnEnv 第 0 层跳过）。
    const providerConfig =
      opts.providerConfig !== undefined
        ? opts.providerConfig
        : (state.providerConfig ?? null);

    // D-005@v2 引擎门：provider 切换载荷 + 白名单外引擎 → 显式 fail-loud（恢复
    // 1e4bb818f 删除 claude-only 守卫前的拒绝语义，口径改白名单；cursor 曾被静默
    // 卷入未验证的 reload 路径——审查 F4）。
    // 载荷判据=「携带 providerConfig 且与当前值实际不同」（reloadWithConfig 带
    // 档案时也会传派生 providerConfig——与现值相同属 config-only，不判门）。
    const providerSwitchPayload =
      opts.providerConfig !== undefined &&
      JSON.stringify(opts.providerConfig ?? null) !==
        JSON.stringify(state.providerConfig ?? null);
    if (providerSwitchPayload && !PROVIDER_RELOAD_ENGINES.has(state.provider)) {
      throw new Error(
        `_reloadSession: provider 切换不支持引擎 ${state.provider}（session ${sessionId}；白名单 claude/codex/pi）`,
      );
    }

    // 进入时快照旧句柄/env/config 供失败回滚（R-01）。句柄是引用，旧对象本身会被
    // close，但保留引用让 catch 区分「reload 失败 → 用旧引用占位，不 nil」。
    const oldHandle =
      state.provider === 'claude' ? state.query : state.driverHandle;
    const oldEnv = state.env;
    const oldProviderConfig = state.providerConfig;
    const oldSystemPrompt = state.systemPrompt;
    // D-002@v2：文件层回滚标记——写盘块内置位，catch 侧据此以旧形态重跑 ForReload。
    let fileLayerTouched = false;

    try {
      // ── buildSpawnEnv 构造新 env（provider_config null 时第 0 层跳过 → 本机凭证）──
      // credential 缺失（测试 / daemon 未注入）用 noopCredential：layer 2 token 读取
      // 自然跳过（get→undefined），layer 1 tool_config 渲染返回 {} ；layer 0 provider_config
      // 仍独立生效（对齐 daemon.ts:3050 同款 fallback，避免未注入 credentialManager 时
      // reload 第 0 层失效）。provider_config null/undefined 均走 layer 0 跳过路径。
      const credential: SpawnCredentialManager = this._credentialManager ?? {
        get: () => undefined,
        buildEnv: () => ({}),
      };
      const newEnv = buildSpawnEnv(
        {
          provider_config: providerConfig ?? undefined,
          // task-02（2026-08-23-agent-activity-sessions / D-008）：reload 与 restore
          // 同理从零重建 env → SILLYHUB_SESSION_ID 用 state.sessionId（平台会话 id，
          // 非 agent 侧 resume key）重注入，切供应商/人格后 CLI 上报身份不丢。
          agentSessionId: state.sessionId,
        },
        { credential },
      );
      // ql-20260822-009：reload 的 CLAUDE_CONFIG_DIR 同样按 transcript 实际位置判定
      // （claude-transcript-dir 单一来源，与 restoreAndReconnect 对称）。ql-20260807-002
      // 语义保留：jsonl 在 daemon 隔离目录（create 带供应商 / 停止供应商前创建）→ 仍
      // 强制隔离，防新 claude resume 找不到 jsonl → onError → fail → session ended。
      // 新增：jsonl 仅在宿主机 ~/.claude（create 未配供应商）→ 不隔离，回 ~/.claude 找。
      // 凭证靠 env token（层 2 credentials.json）+ daemon settings.json。
      // ql-20260822-001：home 会话切供应商（provider_config 非空）→ 先迁移 jsonl
      // 到隔离目录，让 applyTranscriptConfigDir 命中 isolated 回隔离 env。仅回
      // home 会把 claude 暴露给用户 ~/.claude/settings.json，其 env 块
      //（cc-switch）优先于进程注入的供应商 env，切了供应商流量仍串本机网关
      //（E2E 实锤 BigModel 400[1214]）。迁移失败降级 home（会话可用，R-01）。
      // ql-20260824-016：对称补反向——切回本机默认（null）迁移 jsonl 回宿主机
      // ~/.claude。否则隔离目录命中 → 强制隔离 env → claude 读不到本机
      // settings.json（cc-switch / OpenCode Go），「本机默认」名不副实（原注释
      // 「不迁移」的假设只对 jsonl 本就在 home 的会话成立）。迁移失败降级
      // isolated resume（会话可用，R-01 同款）。
      if (
        providerConfig != null &&
        state.provider === 'claude' &&
        state.agentSessionId
      ) {
        // ql-20260825-f3#5：迁移已异步化（同步 copyFileSync 阻塞事件循环）。
        await migrateClaudeTranscriptToIsolated(state.agentSessionId, this._resumeDirs);
      } else if (
        providerConfig == null &&
        state.provider === 'claude' &&
        state.agentSessionId
      ) {
        await migrateClaudeTranscriptToHost(state.agentSessionId, this._resumeDirs);
      }
      await applyTranscriptConfigDir(
        newEnv,
        state.agentSessionId,
        this._resumeDirs,
      );

      // ── task-03（2026-09-11-session-provider-switch-codex-pi）：codex/pi 文件层配置 ──
      // 写盘 + env 合并。claude 跳过（settings.json 链路仍归 daemon.ts spawn 侧
      // applyClaudeSettings + 上方既有 env 逻辑，零漂移，design Wave 2 步骤 5）。
      // 2026-09-11-provider-adapter-registry task-03（FR-03）：门控改读聚合表元数据
      //（原 provider === 'codex' || 'pi' 硬编码）——fileSettings 为 writer 才走
      // 文件层写盘 + env 合并；claude / cursor / 未知 provider（表无条目）零动作，
      // 逐类等价（漏改则新引擎 reload 丢文件层 env——Grill 发现）。块内 codex 迁移
      // 钩子为 per-engine 差异，按 design 非目标保留 provider === 'codex' 原判定。
      // ── ③ 校验 resume key 必需（D-001@v1 守卫前移：先于文件层写盘——缺 key 时
      // 零文件写入直接抛，消除「先覆盖目录再发现不能 reload」路径，审查 F1 前半）──
      // agentSessionId 来自首 turn system/init（Claude）或 thread_started（Codex），
      // 是 SDK jsonl 恢复 key。缺失说明首 turn 未完成，无可恢复 jsonl → 拒绝 reload
      //（避免 SDK 拿空 resume 启动全新会话替换语义——那是 end + create 流程，不是 reload）。
      if (!state.agentSessionId) {
        throw new Error(
          `_reloadSession: missing agentSessionId (session ${sessionId} 首 turn system/init 未完成,无 jsonl 可 resume)`,
        );
      }

      if (hasProviderFileWriter(state.provider)) {
        // codex 迁移钩子（FR-05，仅 codex）：宿主凭证起步会话（oldEnv 无 CODEX_HOME）
        // 首次切平台供应商 → 迁移 thread rollout 历史到 per-session 目录，否则新
        // CODEX_HOME 下 resume 找不到 thread 必断（对齐 claude
        // migrateClaudeTranscriptToIsolated 语义）。三联条件缺一不触发；失败 warn
        // 不阻断 reload（helper 自身返 false 已收口，对齐 claude 迁移失败降级 R-01）。
        if (
          state.provider === 'codex' &&
          providerConfig != null &&
          !oldEnv?.['CODEX_HOME'] &&
          state.agentSessionId
        ) {
          await migrateCodexThreadFromHost(
            state.agentSessionId,
            join(daemonStateDir(), 'codex', state.sessionId),
          );
        }
        // 写盘 + env 合并：文件层键（CODEX_HOME / PI_CODING_AGENT_DIR）最后合并盖过
        // 下层，与 daemon.ts spawn 路径 Object.assign(interactiveEnv, providerFileEnv)
        // 同模式——per-session 隔离目录是平台更高意志，盖过下层同键残留。失败兜底
        // 已内聚在 ForReload 返回值（IO 失败/门槛缺返 priorEnv 对应键 = 等同未切，
        // R-05），本处只做 Object.assign、不包 try/catch 不重试。
        // priorEnv 断言：state.env 是 NodeJS.ProcessEnv（索引值 string | undefined），
        // 但 env 快照实际由 buildSpawnEnv 产出（值恒为 string）；ForReload 内部经
        // nonEmptyStr 逐键判空，undefined 值与缺键同义，断言仅对齐声明类型。
        fileLayerTouched = true;
        const fileEnv = await applyProviderFileSettingsForReload({
          sessionKey: state.sessionId,
          provider: providerConfig,
          daemonApiKey: this.deps.daemonApiKey ?? null,
          priorEnv: oldEnv as Record<string, string> | undefined,
        });
        Object.assign(newEnv, fileEnv);
      }


      // ── ④ _buildDriverOptions 构造 driverOpts（透传 cwd / canUseTool / mcpServers / resume / env）──
      const driver = state.driver ?? this._drivers.claude;
      if (!driver) {
        throw new Error(
          `_reloadSession: no driver available (session ${sessionId})`,
        );
      }
      const exePath =
        state.pathToAgentExecutable ?? state.pathToClaudeCodeExecutable ?? '';
      // 主 agent MCP 重新解析（create / restoreAndReconnect 同款路径，单一来源）。
      // MainAgentMcpContext 字段从 state 归一化提取（model 不在 state，省略 → ctx.model
      // undefined → 谓词/provider 自行 fallback）。
      const mainAgentMcp = this._resolveMainAgentMcp({
        sessionId: state.sessionId,
        leaseId: state.leaseId,
        provider: state.provider,
        cwd: state.cwd,
        ...(state.stage !== undefined ? { stage: state.stage } : {}),
        // task-04：reload（人格/供应商热切换重建 query）时分身深度随 ctx 补字段，
        // 保持 create / restore / reload 三路同一归一化口径（分档判定归 task-05）。
        ...(state.worker_depth !== undefined ? { worker_depth: state.worker_depth } : {}),
        ...(state.mcpRefs !== undefined ? { mcpRefs: state.mcpRefs } : {}),
        ...(state.skillRefs !== undefined ? { skillRefs: state.skillRefs } : {}),
        ...(state.effectiveAllowedRoots !== undefined
          ? { effectiveAllowedRoots: state.effectiveAllowedRoots }
          : {}),
        ...(state.systemPrompt !== undefined ? { systemPrompt: state.systemPrompt } : {}),
      });
      const driverOpts = this._buildDriverOptions(state, {
        exePath,
        env: newEnv,
        enableApproval: state.manualApproval ?? false,
        effectiveAskUserOnly: state.askUserOnly ?? false,
        resume: state.agentSessionId,
        mcpServers: mainAgentMcp,
        // task-08：会话级配置切换路径注入新人格（claude preset+append；codex 忽略——
        // provider!==claude 时不传，Codex 只切配置不注人格，原 D-003 / NG-02）。
        // undefined（reloadWithProvider 既有路径）→ 不传 → 与重构前行为逐字节一致。
        // ql-20260818-004：null（取消档案）也传——preset-only 即无人格。
        ...(state.provider === 'claude' && opts.systemPrompt !== undefined
          ? { systemPrompt: opts.systemPrompt }
          : {}),
        // ql-20260818-002/004：档案维度切换 → fork（resume 下人格仅对 fork 生效）。
        ...(opts.forkSession === true ? { forkSession: true } : {}),
      });

      // ── ⑤ driver.start(state.inputQueue, driverOpts) → 新句柄 ──
      // SDK spawn 新子进程并从 ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
      // 重载完整对话历史（非内存态；jsonl 由 SDK 自动持久化）。复用 state.inputQueue
      //（reload 不 close 队列；新 query 订阅同一队列吃后续 inject，不丢消息）。
      // ql-20260807-002：reload 复用 inputQueue，但 InputQueue 单订阅（create 时 SDK 已
      // 订阅 _subscribed=true）。不 reset 则新 query 第二次订阅抛 SessionQueueDoubleSubscribeError
      // → SDK query abort（onError "Operation aborted"）→ fail → session ended（实测 reload
      // 后 ended 的真正根因，非 close 旧 query）。resetForResubscribe 重置订阅标记 + 清旧
      // waiter，保留 buffer（pending inject 不丢），让新 query 合法订阅同一队列。
      state.inputQueue.resetForResubscribe();
      const handleOrQuery = (await driver.start(
        state.inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;

      // ── ⑥ 替换句柄（claude=query / codex=driverHandle）+ env + config 快照 ──
      if (state.provider === 'claude') {
        state.query =
          handleOrQuery as NonNullable<SessionState['query']>;
      } else {
        state.driverHandle = handleOrQuery as InteractiveDriverHandle;
      }
      state.env = newEnv;
      state.providerConfig = providerConfig;
      // 仅 claude 写 state.systemPrompt（codex 人格不注入，原 D-003 / NG-02——payload
      // 对 codex 本就不带人格，防御性不写避免持久化快照携带无效配置）。
      // string → 写新值；null → 显式清空（切到无人格）；undefined → 不参与（零漂移）。
      if (state.provider === 'claude') {
        if (typeof opts.systemPrompt === 'string') {
          state.systemPrompt = opts.systemPrompt;
        } else if (opts.systemPrompt === null) {
          state.systemPrompt = undefined;
        }
      }
      state.lastActiveAt = Date.now();

      // ── close 旧句柄（ql-20260806-002：必须在替换为新句柄之后）──
      // 新句柄已就位、即将由 _runConsume 订阅；此时 close 旧句柄，旧 consume
      // for-await 退出是「正常 query 结束」而非 session 收尾，不触发 session ended。
      // 旧实现 close 在 driver.start 之前 → 新 query 未就位时旧 consume 退出 → session
      // 收尾 ended（实测 45723d1d/9eed466e reload 后 ended）。
      try {
        (oldHandle as unknown as { close?: () => void } | undefined)?.close?.();
      } catch {
        /* R-01: close 异常不阻塞（SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。 */
      }
      // 清 pendingSwitch / pendingConfigSwitch（幂等兜底：markPendingSwitch /
      // markPendingConfigSwitch 空闲路径不写标记；_onResult 路径已清；此处防状态机
      // 遗漏的边界，多清一次无副作用）。
      state.pendingSwitch = undefined;
      state.pendingConfigSwitch = undefined;

      // 重启 consume 协程（void fire-and-forget；失败由 consume 内部 fail 路径收敛）。
      void this._runConsume(state);
      // 排队 flush（snapshotPersistable 落盘；env / providerConfig / systemPrompt 已替换）。
      this._scheduleFlush();
      // reload 成功通知（ql-20260911-003-355a：daemon 回收 modelUsage 差分基线——
      // pi/cursor 快照 per-handle 从 0 累计，句柄重建后残留基线会让恢复首轮少记）。
      try {
        await this.deps.onSessionReloaded?.(sessionId);
      } catch {
        /* 通知失败不影响 reload 结果（尽力语义）。 */
      }
    } catch (err) {
      // ── ⑦ reload 失败保留旧句柄 + 上报错误，不破坏会话（R-01 降级）──
      // ql-20260806-002：driver.start 失败时 oldHandle 尚未 close（close 已移到替换
      // 之后），catch 保留的 oldHandle 仍可用，会话可真正恢复（旧 consume 继续）。
      // session 不从 store 移除、status 不改（避免 active→failed 硬降级）。
      if (state.provider === 'claude') {
        state.query = oldHandle as SessionState['query'];
      } else {
        state.driverHandle = oldHandle as InteractiveDriverHandle | undefined;
      }
      state.env = oldEnv;
      state.providerConfig = oldProviderConfig;
      state.systemPrompt = oldSystemPrompt;
      // D-002@v2 文件层回滚：写盘已越过时以旧形态重跑 ForReload（绝不抛契约 →
      // 回滚动作自身安全；codex null+prior 键走宿主镜像分支恢复宿主态，pi null /
      // undefined 返 {}）。返回空对象（未建立任何文件层键）且目录可能存在时
      // best-effort 删生效标记——防 restore 把残留新供应商产物误判为切换曾生效。
      if (fileLayerTouched) {
        try {
          const rollbackEnv = await applyProviderFileSettingsForReload({
            sessionKey: sessionId,
            provider: oldProviderConfig,
            daemonApiKey: this.deps.daemonApiKey ?? null,
            priorEnv: oldEnv as Record<string, string> | undefined,
          });
          if (Object.keys(rollbackEnv).length === 0) {
            for (const engineDir of ['codex', 'pi']) {
              await rm(
                join(daemonStateDir(), engineDir, sessionId, MANAGED_MARKER_FILENAME),
                { force: true },
              ).catch(() => undefined);
            }
          }
        } catch (rollbackErr) {
          // eslint-disable-next-line no-console
          console.error(
            `[session-manager] _reloadSession file-layer rollback failed (session=${sessionId})`,
            rollbackErr,
          );
        }
      }
      // eslint-disable-next-line no-console
      console.error(
        `[session-manager] _reloadSession failed (session=${sessionId}), 保留旧句柄降级`,
        err,
      );
      // 重新抛：调用方（markPendingSwitch / markPendingConfigSwitch / _onResult）均
      // .catch 兜底吞错，不会 unhandled。
      throw err;
    }
  }

  // ── 以下为 task-08 移除的旧机制归因清单（R-02 对账）─────────────────────────────────────────
  // 随 partial 缓冲链下沉 ClaudeEventNormalizer（claude-events.ts，task-03 移植）
  // 而从本文件删除的死代码：
  //   - _parentKeyOf / _getOrCreateBuffer / _bufferPartial / _flushPartial /
  //     _resolveSegmentId / _extractCompletedSegments / _clearPartialBufferSync /
  //     _emitOverrideSignals / _usageEqual / _hasPendingTerminalUsage /
  //     _flushTerminalUsage / _shrinkSubagentBuffers / _destroyPartialBuffer
  //     （对应归一化器 _parentKeyOf / _getOrCreateBucket / _bufferPartial /
  //     _flushBucket / _resolveSegmentId / _extractCompletedSegments /
  //     _clearBucketSync / normalizeOverrideSignal / usageEqual / onTurnEnd /
  //     dispose，行为等价由 tests/interactive/claude-events.test.ts 锚定）；
  //   - _emitOverrideSignals（[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 文本信号发射）：
  //     事件化为单条 override:true + segment_id 事件（D-004@v1），由归一化器
  //     在完整消息展开时产出；旧双行（完整行 + 尾随信号行）合并为单事件；
  //   - subagentDepth 内联状态机：归一化器实例字段维护，事件以 depth 一等字段直达；
  //   - _runningBashCommands Bash 追踪索引：归一化器 runningBash 内置（含
  //     elapsed_ms 计算），事件以 status/bash_chunk + status/bash_status 直达。
}
