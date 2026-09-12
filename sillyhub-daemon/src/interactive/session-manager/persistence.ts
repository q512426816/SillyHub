/**
 * interactive/session-manager/persistence.ts —— 快照/崩溃恢复/落盘簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * snapshotPersistable / restoreAndReconnect / markReconnected / flush /
 * _scheduleFlush / _flushNow 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式
 * 传参，行为零变化；_flushScheduled 去抖字段本体仍留在 facade 类里）。
 *
 * @module interactive/session-manager/persistence
 */

import type {
  PersistedSessionRecord,
  SessionState,
} from '../types.js';
import { SessionBusyError, SessionNotFoundError } from '../types.js';
import { InputQueue } from '../input-queue.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  UserTurnInput,
} from '../driver.js';
// ql-20260822-009：resume / reload 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定
// （隔离目录命中 → 隔离，保 ql-20260807-002 停供应商语义；仅宿主机 ~/.claude 命中 →
// 不隔离，修复未配供应商会话重开被 fail 打回 ended）。
// ql-20260822-001（移植）：home 会话切供应商前把 jsonl 迁移（复制）到隔离目录——
// 仅回 home resume 会把 claude 暴露给用户 ~/.claude/settings.json，其 env 块
//（cc-switch）优先于进程注入的供应商 env，流量串本机网关（E2E 实锤 400[1214]）。
import {
  applyTranscriptConfigDir,
  migrateClaudeTranscriptToIsolated,
} from '../claude-transcript-dir.js';
// task-08（FR-05 / D-004@v1）：reloadWithProvider 用 buildSpawnEnv 构造新 env
// （provider_config 第 0 层；null 时跳过 + 不隔离 CLAUDE_CONFIG_DIR
// → 回退本机凭证，spawn-env.ts:140-164 已支持）。SpawnCredentialManager 鸭子类型，
// daemon 生产路径注入 daemon._credentialManager，测试 / 未注入时用 noopCredential fallback。
import { buildSpawnEnv } from '../../spawn-env.js';
import type { SpawnCredentialManager } from '../../spawn-env.js';
// task-04（2026-09-11-session-provider-switch-codex-pi / FR-01 FR-02 / D-001@v1）：
// restore 自愈——恢复路径 codex/pi 注文件层 env（ForReload 写盘 + codex null
// 目录探测后镜像，helper 在 provider-file-settings.ts / codex-settings.ts）。
// stat / join / daemonStateDir 用于探测确定性 per-session 目录
// `<daemonStateDir()>/codex/<sessionId>/`（与 spawn/reload 同口径派生路径）。
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../../atomic-write.js';
import { daemonStateDir } from '../../config.js';
import { mirrorCodexHostAuth } from '../../codex-settings.js';
import {
  applyProviderFileSettingsForReload,
  MANAGED_MARKER_FILENAME,
} from '../../provider-file-settings.js';
// 2026-09-11-provider-adapter-registry task-03（FR-03）：restore 门控与 codex 探测
// 目录类型判定改读聚合表元数据（INTERACTIVE_PROVIDERS 的 fileSettings writer /
// perSessionDir；详见下方 restoreAndReconnect 内注释）。
import { INTERACTIVE_PROVIDERS } from '../providers.js';
import type { ProviderAdapter } from '../providers.js';
import type { SessionManagerCore } from './types.js';

/**
 * task-10（§4.3）：快照可恢复记录（active|running 且 agentSessionId 非空）。
 *
 * 供 flush 持久化用。ended/failed/reconnecting 不落盘；agentSessionId 空
 *（首 turn system/init 未到）也不落盘（不可恢复，D-003）。currentRunId 仅在
 * running 时携带（active 时为 undefined），重启对账用。
 */
export function snapshotPersistable(
  mgr: SessionManagerCore,
): PersistedSessionRecord[] {
  const out: PersistedSessionRecord[] = [];
  for (const state of mgr._store.values()) {
    if (state.status !== 'active' && state.status !== 'running') continue;
    if (!state.agentSessionId) continue;
    const rec: PersistedSessionRecord = {
      sessionId: state.sessionId,
      leaseId: state.leaseId,
      agentSessionId: state.agentSessionId,
      cwd: state.cwd,
      provider: state.provider,
      turnCount: mgr._pendingInjectCount.has(state.sessionId)
        ? mgr._pendingInjectCount.get(state.sessionId)!
        : 0,
      lastActiveAt: state.lastActiveAt,
    };
    if (state.currentRunId) {
      rec.currentRunId = state.currentRunId;
    }
    // task-02 R8（D-002）：按 provider 落盘 executable path。claude 继续写
    // pathToClaudeCodeExecutable（向后兼容旧 sessions.json + Claude resume）；
    // codex 写 pathToAgentExecutable（恢复时 codex driver 读此字段）。
    if (state.provider === 'codex') {
      if (state.pathToAgentExecutable) {
        rec.pathToAgentExecutable = state.pathToAgentExecutable;
      }
    } else if (state.pathToClaudeCodeExecutable) {
      rec.pathToClaudeCodeExecutable = state.pathToClaudeCodeExecutable;
    }
    // scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B/D）：
    // manualApproval=true 时把审批标志 + askUserOnly 落盘，让 restoreAndReconnect
    // 跨 daemon 重启恢复审批能力。askUserOnly 即便 false 也写（否则恢复 fallback
    // 到 true 会把 chat 误当 scan）；manualApproval=false 不写（默认行为）。
    if (state.manualApproval === true) {
      rec.manualApproval = true;
      rec.askUserOnly = state.askUserOnly === true;
    }
    // task-06（D-007@v2）：主 agent stage 持久化（恢复后重新注入 MCP tool）。
    // 仅 stage 非空时写（普通 scan/stage/chat session 不写，恢复后不注入 MCP）。
    if (state.stage) {
      rec.stage = state.stage;
    }
    // task-04（design §5.C / Grill M3）：分身深度保档——非 undefined 才写
    //（0 合法）；缺键（旧 lease / 主控 / 普通会话）不落盘，恢复后 undefined
    // 穿透不伪造默认值（防重启后非叶分身静默降级叶档）。
    if (state.worker_depth !== undefined) {
      rec.worker_depth = state.worker_depth;
    }
    // task-10（C-12）：profile 字段持久化（恢复后重新过滤 MCP / 写守卫继续收紧）。
    // 仅对应字段非 undefined 时写（profile=None 的 session 不写，FR-15）。
    if (state.mcpRefs !== undefined) {
      rec.mcpRefs = state.mcpRefs;
    }
    if (state.skillRefs !== undefined) {
      rec.skillRefs = state.skillRefs;
    }
    if (state.effectiveAllowedRoots !== undefined) {
      rec.effectiveAllowedRoots = state.effectiveAllowedRoots;
    }
    // task-08（2026-08-14-sessions-portal / design §5 Wave2）：会话级配置快照落盘，
    // daemon 重启 resume 不丢配置。systemPrompt 补齐 task-05 预留的 record 字段
    // （restoreAndReconnect 早已读 record.systemPrompt，此处补写闭合链路）；
    // providerConfig 非 null 才写（null=本机默认=缺省语义等价，design §9 容错）。
    if (state.systemPrompt !== undefined) {
      rec.systemPrompt = state.systemPrompt;
    }
    if (state.providerConfig != null) {
      rec.providerConfig = state.providerConfig;
    }
    out.push(rec);
  }
  return out;
}

/**
 * task-10（§6 + spike D3）：用持久化 agentSessionId 调 driver.start({resume})
 * 在固定 cwd 重启 driver，重建跨进程上下文。
 *
 * 流程：
 *   0. ql-20260823-006：store 已有同 id 残留条目（backend 未通知 SESSION_END
 *      的活僵尸 / end() 留下的终态条目）→ 先静默驱逐（_terminateSession 全套
 *      清理，notifyBackend=false），不再抛 SessionAlreadyExistsError。
 *   1. 构造 fresh InputQueue（新对象，不恢复旧队列）。
 *   2. state = { reconnecting, currentRunId=undefined, agentSessionId=record.agentSessionId,
 *      cwd=record.cwd } 写入 _store。
 *   3. driver.start(inputQueue, { cwd: record.cwd, resume: record.agentSessionId, ... }).
 *      start 抛错 → fail → onSessionEnd(failed) + 从 store 移除。
 *   4. fire driver.consume 后台协程（不阻塞返回）。
 *
 * **不 push 任何 SDKUserMessage**（resume query 不带 prompt，spike D3：resume
 * 不带 prompt 时 SDK 空闲，等下一次 inject 才跑新 turn）。
 * 调用方在 backend recover 成功后调 markReconnected 切 active。
 */
export async function restoreAndReconnect(
  mgr: SessionManagerCore,
  record: PersistedSessionRecord,
): Promise<void> {
  // task-02（D-007）：agentSessionId 是恢复必需的 provider 会话 id（Claude SDK
  // session_id / Codex thread id）。空则不伪造恢复——抛错，不写 store、不调 driver.start。
  // daemon._routeSessionResume 已在进入前校验，这里是第二道守卫。
  if (!record.agentSessionId) {
    throw new Error(
      `restoreAndReconnect: missing agentSessionId (thread id) for session ${record.sessionId}`,
    );
  }
  // task-02（D-001/FR-06）：按 provider 取 driver（未注册 → UnsupportedProviderError）。
  // 删除原 `if (record.provider !== 'claude') throw` 硬编码，codex 不再被拦截。
  const driver = mgr._getDriver(record.provider);
  // ql-20260823-006：内存残留条目不再拒绝恢复。旧行为（_store.has() 即抛
  // SessionAlreadyExistsError）让两类残留把 reopen 打成死循环：① backend 翻
  // 终态但未通知 SESSION_END 的活僵尸（2026-08-23 会话 bdec91a4 事故，4 次
  // reopen 全撞死）；② end()/fail() 收口留下的终态条目（_terminateSession 不
  // 删 store）。backend 下发 SESSION_RESUME 本身就断言 daemon 侧副本已死，
  // 这里先静默驱逐（terminate 清理链全套但不回发 onSessionEnd——backend 正
  // 推进 reconnecting→active，回发终态会与之竞态误翻 failed），再走正常恢复。
  const stale = mgr._store.get(record.sessionId);
  if (stale) {
    // ql-20260831-001-6dde：活会话守卫——本地仍在跑 turn（status=running）或
    // 有待处理输入（附件下载中，pendingInjectCount>0）时拒绝驱逐重建：驱逐
    // 会 terminate 在途 driver，正在执行的 agent 工作被静默杀掉。恢复链
    // 触发瞬间的忙检只覆盖当时；恢复在途期间新起的 turn 只能靠本守卫兜底
    //（调用方按 SESSION_BUSY 重试/跳过）。终态/空闲条目不受影响，维持
    // ql-20260823-006 的静默驱逐语义。检查与 terminate 调用之间无 await，
    // 单线程事件循环下无 TOCTOU。
    // ql-20260831-008：守卫只护「同 lease」的在途工作——SESSION_RESUME /
    // reopen 记录带的必是 backend rotate 后的新 lease（backend reopen_session
    // 恒建新 lease 并以新 lease_id 下发；claim_token 亦重置，防旧 claim 重放），
    // 与本地条目 lease 不一致即旧 lease 已被 backend 判死的僵尸（ql-20260823-006
    // 事故形态：内存仍 running 但其 turn 结果永远不再被收），在途工作属孤儿，
    // 维持静默驱逐；lease 一致才可能是恢复在途期间新起的真 turn（inject 随新
    // lease 下发），抛 SessionBusyError 交调用方重试/跳过。
    const sameLease = stale.leaseId === record.leaseId;
    if (
      sameLease &&
      (stale.status === 'running' ||
        (mgr._pendingInjectCount.get(stale.sessionId) ?? 0) > 0)
    ) {
      throw new SessionBusyError(stale.sessionId, stale.status);
    }
    await mgr._terminateSession(stale, 'driver_error', { notifyBackend: false });
    mgr._store.delete(record.sessionId);
  }

  // task-02（D-009）：恢复路径同样用 provider-neutral UserTurnInput 队列。
  const inputQueue = new InputQueue<UserTurnInput>();
  // scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B/D）：
  // record 持久化字段优先，fallback 到实例级 _manualApproval / true（scan 主用场景）。
  // 旧 sessions.json（无 manualApproval/askUserOnly 字段）→ fallback 兼容。
  const restoreManualApproval =
    record.manualApproval ?? mgr._manualApproval;
  const restoreAskUserOnly = record.askUserOnly ?? true;
  // task-02（D-002/R8）：provider-neutral executable path。codex 用 pathToAgentExecutable
  //（落盘时写的 codex path）；claude 继续用 pathToClaudeCodeExecutable。
  const exe =
    record.pathToAgentExecutable ?? record.pathToClaudeCodeExecutable ?? '';
  const state: SessionState = {
    sessionId: record.sessionId,
    leaseId: record.leaseId,
    // gap-2：恢复路径的 claimToken 留空——崩溃恢复时 lease.claim_token 已被
    // backend rotate（recover_session_after_daemon_restart step 7），旧 token 失效。
    // 恢复后的 inject 由 backend SESSION_INJECT 重新下发新 claim_token；但本任务
    // 范围（task-01/02/03）不改恢复链路（task-05/10 owns），故占位空串不破坏类型。
    // 后续 task（恢复路径 token 协商）若需要会经 SESSION_INJECT payload 刷新。
    claimToken: '',
    agentSessionId: record.agentSessionId,
    inputQueue,
    status: 'reconnecting',
    currentRunId: undefined, // 崩溃 currentRun 由 backend 收敛，daemon 不持有。
    lastActiveAt: record.lastActiveAt,
    cwd: record.cwd,
    provider: record.provider,
    pathToClaudeCodeExecutable: record.pathToClaudeCodeExecutable ?? '',
    pathToAgentExecutable: exe,
    manualApproval: restoreManualApproval,
    askUserOnly: restoreAskUserOnly,
    driver, // D-001：写入归属 driver。
    // task-08：同 create——depth 已下沉归一化器，恒空 Map 仅满足形状。
    subagentDepth: new Map(),
    // task-06：恢复主 agent stage（重新注入 MCP tool 用）。
    stage: record.stage,
    // task-04：恢复分身深度（snapshot 保档链，M3——非叶不静默降级叶档）。
    // 旧 sessions.json 无此字段 → undefined 穿透（档位判定归 task-05）。
    worker_depth: record.worker_depth,
    // task-10（C-12）：恢复 profile 字段（mcpRefs 重新过滤主 agent MCP；skillRefs
    // 承载；effectiveAllowedRoots 写守卫继续收紧）。undefined → 不写键（FR-15）。
    ...(record.mcpRefs !== undefined ? { mcpRefs: record.mcpRefs } : {}),
    ...(record.skillRefs !== undefined ? { skillRefs: record.skillRefs } : {}),
    ...(record.effectiveAllowedRoots !== undefined
      ? { effectiveAllowedRoots: record.effectiveAllowedRoots }
      : {}),
    // task-05：恢复 profile.system_prompt（resume 时重新注入 systemPrompt preset+append）。
    ...(record.systemPrompt !== undefined ? { systemPrompt: record.systemPrompt } : {}),
    // task-08（2026-08-14-sessions-portal）：恢复会话级供应商配置（design §5 Wave2
    // 重启不丢配置）。旧 sessions.json 无此字段 → 缺省容错（undefined，恢复走本机
    // 凭证链，design §9 零回归）。
    ...(record.providerConfig !== undefined
      ? { providerConfig: record.providerConfig }
      : {}),
  };
  mgr._store.set(state.sessionId, state);
  // ql-20260825-f3#1：重建条目取消上方驱逐可能遗留的终态延迟清理 timer（驱逐
  // 的 _terminateSession 会 schedule，若不取消，timer 到点时新条目虽因状态守卫
  // 不被删，但守卫前提是状态非终态——显式取消消除对时序的依赖）。
  mgr._cancelTerminalCleanup(state.sessionId);

  try {
    // task-02（R7）：复用 _buildDriverOptions（含 canUseTool/onUserDialog 注入，
    // 与 create 对齐，FR-10 行为不变）。resume = agentSessionId（Codex thread id / Claude session_id）。
    // task-06（D-007@v2）：主 agent session 恢复后仍需重新注入 MCP tool（让主 agent
    // discover daemon MCP server 5 tool）。从 record 归一化 ctx 调同一 _resolveMainAgentMcp，
    // 与 create 路径单一来源；普通会话返回 undefined 不注入（零回归）。
    const mainAgentMcp = mgr._resolveMainAgentMcp({
      sessionId: record.sessionId,
      leaseId: record.leaseId,
      provider: record.provider,
      cwd: record.cwd,
      model: record.model,
      stage: record.stage,
      // task-04：恢复时分身深度随 ctx 传入（保档，谓词/provider 分档判定归 task-05）。
      worker_depth: record.worker_depth,
      // task-10（C-12）：恢复时重新按 profile.mcpRefs 过滤主 agent MCP 注入。
      mcpRefs: record.mcpRefs,
      skillRefs: record.skillRefs,
      effectiveAllowedRoots: record.effectiveAllowedRoots,
    });
    // ql-20260822-009：resume 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定
    // （claude-transcript-dir 单一来源）。历史两轮修复的语义都保留：
    //   - 隔离目录有 jsonl（create 带供应商 / ql-20260807-002 停供应商场景）
    //     → 仍强制隔离，防「重启 daemon 后 active session 变 ended」回归；
    //   - 仅宿主机 ~/.claude 有 jsonl（create 未配供应商，ql-20260729-002 不隔离）
    //     → 删除 env 让 claude 回 ~/.claude 找——原先无条件强制隔离导致 resume
    //     找不到 jsonl → claude 报错退出 → fail → 会话被打回 ended（重开失效）。
    // 恢复路径 provider_config：task-08（sessions-portal）起 sessions.json 落盘会话级
    // 供应商配置快照——重启 resume 不丢配置（design §5 Wave2）。旧 sessions.json 无
    // 该字段（undefined）→ 第 0 层自然跳过（本机凭证链，零回归）；凭证靠 process.env
    // （与 create 同源）+ credentials.json（层 2，若有）。
    const restoreCredential: SpawnCredentialManager = mgr._credentialManager ?? {
      get: () => undefined,
      buildEnv: () => ({}),
    };
    const restoreEnv = buildSpawnEnv(
      {
        provider_config: state.providerConfig ?? undefined,
        // task-02（2026-08-23-agent-activity-sessions / D-008）：restore 从零重建
        // env（不回放 state.env，Grill P1-4）→ 平台会话身份须重注入。
        // state.sessionId 是平台 agent_sessions.id（注意区别于 agent 侧 resume
        // key state.agentSessionId——后者是 SDK jsonl 恢复键，非平台身份）。
        agentSessionId: state.sessionId,
      },
      { credential: restoreCredential },
    );
    // ql-20260822-001：home 会话带供应商 → 先迁移 jsonl 到隔离目录，让下方
    // applyTranscriptConfigDir 命中 isolated 回隔离 env（daemon 重启自愈：
    // 迁移前的存量 home 会话在此补迁移）。仅回 home 会把 claude 暴露给用户
    // ~/.claude/settings.json，其 env 块优先于进程注入的供应商 env → 流量串
    // 本机网关。无供应商（本机凭证链）不迁移；迁移失败降级 home（R-01）。
    if (
      state.providerConfig != null &&
      state.provider === 'claude' &&
      state.agentSessionId
    ) {
      // ql-20260825-f3#5：迁移已异步化（同步 copyFileSync 阻塞事件循环）。
      await migrateClaudeTranscriptToIsolated(state.agentSessionId, mgr._resumeDirs);
    }
    await applyTranscriptConfigDir(
      restoreEnv,
      state.agentSessionId,
      mgr._resumeDirs,
    );

    // ── task-04（2026-09-11-session-provider-switch-codex-pi / design Wave 2 步骤 4，
    //    Grill 附带发现收编）：restore 自愈——恢复路径 codex/pi 注文件层 env ──
    // 不修则「切换供应商后 daemon 重启 → 恢复会话丢 CODEX_HOME / PI_CODING_AGENT_DIR
    // → 静默回宿主凭证」，直接击穿 FR-01 的生效承诺。claude 跳过（settings.json
    // 链路仍归 daemon.ts spawn 侧 applyClaudeSettings + 上方既有 env 逻辑，零漂移，
    // design Wave 2 步骤 5）。插入位置对齐 task-03 在 _reloadSessionNow 的合并块
    //（applyTranscriptConfigDir 之后、driver.start 之前——文件层键最后合并盖过下层）。
    //
    // 2026-09-11-provider-adapter-registry task-03（FR-03）：外层门控改读聚合表
    // INTERACTIVE_PROVIDERS 元数据（原 provider === 'codex' || 'pi' 硬编码）——
    // adapter 存在且 fileSettings 为 writer（'write' in 判定，非 { kind:'none' }）
    // 才注文件层 env；claude / cursor（显式 none）与未知 provider（表无条目，
    // 索引得 undefined）零动作，与原判断逐类等价（task-03 constraints）。
    const providerAdapter = (INTERACTIVE_PROVIDERS as Record<
      string,
      ProviderAdapter | undefined
    >)[state.provider];
    if (
      providerAdapter !== undefined &&
      'write' in providerAdapter.fileSettings
    ) {
      const fileWriter = providerAdapter.fileSettings;
      // providerConfig 非 null（持久化供应商快照恢复）：经 ForReload 重写
      // per-session 目录 + 注文件层 env（与 _reloadSessionNow task-03 同模式，
      // 失败兜底内聚在返回值矩阵 R-05）。priorEnv 传 undefined = 恢复时无旧 env
      //（restore 从零重建 env、不回放 state.env，D-008）——失败兜底取不到 prior
      // 键 → 返 {} 降级（按宿主现状运行，error 可归因，Grill 复审 P2-2）。
      // ForReload 绝不抛，本块不进下方 driver.start 的既有 catch（恢复主路径
      // 不因文件层降级而 fail）。
      if (state.providerConfig != null) {
        const fileEnv = await applyProviderFileSettingsForReload({
          sessionKey: state.sessionId,
          provider: state.providerConfig,
          daemonApiKey: mgr.deps.daemonApiKey ?? null,
          priorEnv: undefined,
        });
        Object.assign(restoreEnv, fileEnv);
      } else if (providerAdapter.perSessionDir === 'codex') {
        // codex null 目录探测（Grill 复审 P2-3）= 切换后重启不丢 thread：
        // persistence 仅落盘非 null providerConfig（snapshotPersistable task-08），
        // null 切换（切回本机）会话的恢复记录天然无该字段——若按无供应商处理会
        // 回宿主 CODEX_HOME → thread 在 per-session 目录找不到 → resume 必断。
        // 修法：stat 探测确定性 per-session 目录，存在 = 此前在平台供应商上 →
        // 按 null 切换语义处理（宿主凭证幂等重镜像 + 注 CODEX_HOME，镜像失败 =
        // 目录留旧供应商产物 = 等同未切、env 仍保住）；不存在 → 零动作（行为与
        // 现状逐字一致）。pi 不适用（null = 回宿主即语义本身，pi 历史在 daemon
        // 自管 --session-dir 不丢）。
        // 2026-09-11-provider-adapter-registry task-03：目录类型判定改读
        // perSessionDir === 'codex'（原 provider === 'codex'，保持仅 codex 探测
        // 语义——pi 无目录历史）；探测路径由 writer.dirName 派生（现值 'codex'，
        // 与原 join(daemonStateDir(), 'codex', ...) 逐字等价），stat /
        // mirrorCodexHostAuth / CODEX_HOME 注入探测体不动。
        const codexHome = join(daemonStateDir(), fileWriter.dirName, state.sessionId);
        try {
          // 2026-09-12-provider-file-tx D-004@v2：探测三态化——
          //   标记在 = 切换曾真实生效 → managed；
          //   无标记但 auth.json/config.toml 在 = legacy 兼容（修复前存量已切换
          //     会话，行为与旧「目录存在」判定逐字一致）→ managed；
          //   皆无 = 零动作（宿主语义；迁移钩子只建目录+sessions/ 恒落此态，
          //     F3「目录存在即 managed」假阳性从根消除）。
          const markerPath = join(codexHome, MANAGED_MARKER_FILENAME);
          const markerExists = await stat(markerPath).then(
            () => true,
            () => false,
          );
          const legacyHit = markerExists
            ? false
            : await Promise.all([
                stat(join(codexHome, 'auth.json')).then(
                  () => true,
                  () => false,
                ),
                stat(join(codexHome, 'config.toml')).then(
                  () => true,
                  () => false,
                ),
              ]).then(([authHit, configHit]) => authHit || configHit);
          if (markerExists || legacyHit) {
            if (legacyHit) {
              // eslint-disable-next-line no-console
              console.info('codex_restore_legacy_marker_missing', { codexHome });
            }
            // 标记先行不变量（D-004@v2）：legacy 无标记 → 删除类镜像动作前先补落
            // 标记（失败跳过镜像，env 注入保持——目录旧产物=等同未切，与 ForReload
            // 分支四同序）。
            let markerOk = true;
            if (!markerExists) {
              try {
                await mkdir(codexHome, { recursive: true });
                await writeFileAtomic(
                  markerPath,
                  JSON.stringify({
                    envKey: 'CODEX_HOME',
                    switchedAt: new Date().toISOString(),
                  }),
                );
              } catch {
                markerOk = false;
              }
            }
            if (markerOk) {
              // mirrorCodexHostAuth 自身绝不抛；防御 catch 兜底（镜像成败不影响
              // 下方 env 注入）。
              try {
                await mirrorCodexHostAuth(codexHome);
              } catch {
                // 防御性兜底：零动作，不阻断恢复。
              }
            }
            Object.assign(restoreEnv, { CODEX_HOME: codexHome });
          }
        } catch {
          // stat / mkdir IO 异常 → 零动作（宿主语义）。
        }
      }
    }

    const driverOpts = mgr._buildDriverOptions(state, {
      exePath: exe,
      model: record.model,
      env: restoreEnv,
      enableApproval: restoreManualApproval,
      effectiveAskUserOnly: restoreAskUserOnly,
      resume: record.agentSessionId, // spike D3 跨进程 resume。
      mcpServers: mainAgentMcp,
      systemPrompt: state.systemPrompt, // task-05：resume 重注入 systemPrompt preset+append
    });
    // task-02（D-001）：用归属 driver，按 provider 写句柄。
    const handleOrQuery = (await driver.start(
      inputQueue,
      driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
    )) as unknown;
    if (record.provider === 'claude') {
      state.query = handleOrQuery as SessionState['query'];
    } else {
      state.driverHandle = handleOrQuery as InteractiveDriverHandle;
    }
    // fire consume 后台协程（同 create，长生命周期）。
    void mgr._runConsume(state);
  } catch {
    // driver.start 抛错（cwd 不一致 / executable 缺失 / SDK jsonl 缺失）：
    // 同步收敛 → onSessionEnd(failed) + 从 store 移除（不复活）。
    // 不重新抛错：调用方（daemon 启动编排）通过检查 get(sessionId)===undefined
    // 判断恢复失败（记录已不在内存 store），再调 HubClient.markRecoveryFailed
    // + persistence 删记录。原始错误在 driver.consume onError 内已被记 _lastError。
    mgr._store.delete(state.sessionId);
    mgr._abortPermissionResolver(state.sessionId, 'restore_failed');
    mgr._scheduleFlush();
    try {
      await mgr.deps.onSessionEnd(state.sessionId, 'failed');
    } catch {
      // onSessionEnd 不应阻塞 restore 收敛；吞错但不丢主路径。
    }
  }
}

/**
 * task-10：reconnecting → active；flush（清 currentRunId）。
 *
 * 只能从 reconnecting 转入（restoreAndReconnect 之后调）。
 * daemon 启动编排在 driver.resume 成功后调此方法，再向 backend confirm。
 *
 * ql-20260831-003-3c87：不刷新 lastActiveAt——恢复（重启恢复 / SESSION_RESUME）
 * 是系统动作非用户活动；刷成 now 会击穿 create 闸「30 分钟窗口」真活跃口径
 * （2026-08-26 P0 语义），daemon 重启后 30 分钟内满额必拒新会话（实机 21
 * active >= 20 max 实证）。活跃时间由真实用户活动路径维护（inject/_onResult/
 * interrupt/reload）。
 *
 * @throws {SessionNotFoundError} session 不存在
 * @throws {Error} session 非 reconnecting 状态（不能从 active 等转入）
 */
export async function markReconnected(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<void> {
  const state = mgr._store.get(sessionId);
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }
  if (state.status !== 'reconnecting') {
    throw new Error(
      `markReconnected: session ${sessionId} not reconnecting (status=${state.status})`,
    );
  }
  state.status = 'active';
  state.currentRunId = undefined;
  mgr._scheduleFlush();
}

/**
 * task-10：强制把当前内存 store 落盘（snapshotPersistable → persistence.save）。
 *
 * daemon stop / 测试显式 flush 用。未注入 persistence → no-op（向后兼容 task-04）。
 */
export async function flush(mgr: SessionManagerCore): Promise<void> {
  await flushNow(mgr);
}

/**
 * task-10：排队一次 flush（去抖合并到 microtask）。
 *
 * 多次状态变更（create + onResult + end 在同一 tick）只产生一次 save，
 * 避免高频率落盘。queue 已在途则复用，不叠加。
 */
export function scheduleFlush(mgr: SessionManagerCore): void {
  if (!mgr.deps.persistence) return;
  if (mgr._flushScheduled) return;
  mgr._flushScheduled = (async () => {
    // 让出当前 microtask，让同一 tick 内的多次状态变更合并。
    await Promise.resolve();
    mgr._flushScheduled = null;
    await flushNow(mgr);
  })().catch((err) => {
    mgr._flushScheduled = null;
    // flush 失败不崩 session 运行（落盘是恢复索引，不是运行依赖）；
    // 记日志后继续（不吞错到调用方，但不在状态变更路径上抛）。
    // eslint-disable-next-line no-console
    console.error('[session-manager] flush failed', err);
  });
}

/** 立即落盘当前快照（无去抖）。 */
async function flushNow(mgr: SessionManagerCore): Promise<void> {
  if (!mgr.deps.persistence) return;
  const records = snapshotPersistable(mgr);
  await mgr.deps.persistence.save(records);
}
