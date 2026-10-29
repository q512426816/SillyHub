/**
 * zcode-app-server-driver.ts —— ZCode 引擎驱动（InteractiveDriver 实现）。
 *
 * 2026-10-15-zcode-engine-appserver task-04（D-005/D-007）。
 *
 * 进程模型（D-007 方案 A）：每平台会话 spawn 一个 `node <zcode.cjs> app-server
 * --cwd <dir>` 子进程（.exe/.cmd 形态回退直调/shim 解析，为未来官方独立 CLI
 * 留通道）；ZCODE_DATA_BASE_DIR 由 spawn env 注入（per-session 配置面隔离，
 * D-002——providers.ts fileSettings 层产出目录，驱动只透传 env）。
 *
 * 启动序列（2026-10-15 实测钉板）：
 *   1. spawn → startup/storageState 通知（phase=ready 就绪门，~1.5s 含 DB 检查）；
 *   2. session/create {workspace:{workspacePath, workspaceKey}}——期间服务端发
 *      session/requestRuntimePreferences（必须 15s 内应答，否则 create 失败）；
 *   3. session/subscribe {sessionId, deliveryKind:'desktop-continuous'}——
 *      **内容流前提**：session/event 通知（model.streaming delta / turn 边界）
 *      只在订阅后推送；
 *   4. 按配置 session/setModel / session/setThoughtLevel；
 *   5. 每轮 session/send {sessionId, content}，turn_result 事件收敛。
 *
 * 服务端主动请求分发（信封层分发器注册）：
 *   - session/requestRuntimePreferences → 固定偏好（实测兼容回退默认值）；
 *   - interaction/requestOfficialMcpAuthHeaders → 空（无官方 MCP 凭据面）；
 *   - interaction/requestUserInput → {cancelled:true}（阶段 1，R-06 已知限制）；
 *   - interaction/requestPermission → 审批代答桥（见 _handlePermissionBridge）。
 *
 * 审批代答回程形状（执行期工程决策）：请求 params 自带 options[]（每项含
 * optionId/kind/decision——引擎包 y9() 构造逻辑实证）；应答从请求内选项中
 * 选 optionId（allow→首个 allow 类选项；deny/超时/fail-closed→首个 deny 类
 * 选项，无 deny 选项回 {outcome:{outcome:'cancelled'}}）。不硬编码 optionId
 * 字面量（选项 id 随版本可变），e2e 冒烟（task-08）对真引擎验证。
 *
 * 对照先例：codex-app-server-driver.ts（清理阶梯/审批策略三态/turn 收敛
 * reportResult 幂等/consume finalized 防双触发——本驱动同款语义，行数收敛）。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { ZcodeEnvelope, ZcodeProtocolError } from '../adapters/zcode-envelope.js';
import { PROVIDER_ID as ZCODE_PROVIDER_ID } from '../zcode-settings.js';
import {
  normalizeZcodeNotification,
  type ZcodeModelCatalogEntry,
  type ZcodeStateSnapshot,
  type ZcodeHeartbeatDelta,
} from './zcode-events.js';
import { mapPlatformLevelToEngine } from './thinking-levels.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  InteractiveDriverCallbacks,
  InteractiveDriverStartOptions,
  UserTurnInput,
  CompactResult,
  ThinkingLevels,
  ThinkingLevelResult,
} from './driver.js';

/** spawn 后等 startup/storageState phase=ready 上限（实测 ~1.5s，余量 30s）。 */
const DEFAULT_READY_TIMEOUT_MS = 30_000;
/** session/create / subscribe / setModel 等控制面 response 超时。 */
const DEFAULT_CONTROL_TIMEOUT_MS = 30_000;
/** compact / setThoughtLevel response 超时。 */
const DEFAULT_COMPACT_TIMEOUT_MS = 30_000;
/** close 时 stdin.end 后 SIGTERM 升级宽限（对齐 codex KILL_GRACE_MS=2000）。 */
const KILL_GRACE_MS = 2_000;

/**
 * env 诊断日志脱敏（2026-10-18-audit-log-redact-yaml-quote）：
 * - 键名含 KEY/TOKEN → 整值 `<redacted>`（密钥类无诊断定位价值）；
 * - 其余值 URL userinfo 段打码 `scheme://***@host`（代理 host/port 是诊断定位
 *   信息只抹凭据段；userinfo 正则取 `://` 后不含 /、@、空白的首段，覆盖
 *   user 与 user:pass——用户名 URL 编码 %40 形态不匹配，残余面已在 design 风险节声明）。
 * 导出仅供单测（先例：spec-sync applyResurrectSuppress）。
 */
export function redactEnvValueForLog(key: string, value: unknown): string {
  if (/KEY|TOKEN/i.test(key)) return '<redacted>';
  return String(value)
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***@')
    .slice(0, 60);
}

/** zcode 驱动专用启动选项（InteractiveDriverStartOptions 的 zcode 视图）。 */
export interface ZcodeStartOptions extends InteractiveDriverStartOptions {
  /** zcode 可执行文件路径（_agentPaths.get('zcode')，.cjs/.exe/.cmd 均可）。 */
  pathToAgentExecutable: string;
  /** 会话级审批 hook（SessionManager 注入；缺省走 fail-closed）。 */
  sessionPermission?: ZcodeSessionPermissionHooks;
  /** 平台会话 ID（诊断日志用）。 */
  sessionId?: string;
}

/** 审批 hook（对齐 codex CodexSessionPermissionHooks 形状）。 */
export interface ZcodeSessionPermissionHooks {
  requestPermission(input: {
    toolName: string;
    toolInput: unknown;
  }): Promise<{ behavior: 'allow' | 'deny' | string }>;
}

/** zcode 会话句柄（驱动内部视图，公共面即 InteractiveDriverHandle）。 */
export interface ZcodeHandle extends InteractiveDriverHandle {
  readonly provider: 'zcode';
  readonly child: ChildProcess;
  readonly envelope: ZcodeEnvelope;
  /** 引擎侧会话 ID（session/create 回填；null = 尚未创建）。 */
  zcodeSessionId: string | null;
  /** close 已发起（幂等守卫）。 */
  closing: boolean;
  /** state.updated 缓存快照（模型目录/当前模型/reasoning levels）。 */
  stateSnapshot: ZcodeStateSnapshot | undefined;
  /** 当前是否有 in-flight 轮（interrupt 路由用）。 */
  turnInFlight: boolean;
  close(): Promise<void>;
}

/** 引擎可执行缺失（对齐 CodexExecutableNotFoundError 语义）。 */
export class ZcodeExecutableNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZcodeExecutableNotFoundError';
  }
}

export class ZcodeAppServerDriver implements InteractiveDriver {
  readonly provider = 'zcode' as const;

  private readonly readyTimeoutMs: number;
  private readonly controlTimeoutMs: number;
  private readonly compactTimeoutMs: number;
  /** 模型目录等待窗（_applyModel；生产 ~30–45s 到达，默认 60s 余量；测试注入小值）。 */
  private readonly catalogWaitTimeoutMs: number;

  constructor(
    opts: {
      readyTimeoutMs?: number;
      controlTimeoutMs?: number;
      compactTimeoutMs?: number;
      catalogWaitTimeoutMs?: number;
    } = {},
  ) {
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.controlTimeoutMs = opts.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    this.compactTimeoutMs = opts.compactTimeoutMs ?? DEFAULT_COMPACT_TIMEOUT_MS;
    this.catalogWaitTimeoutMs = opts.catalogWaitTimeoutMs ?? 60_000;
  }

  async start(
    input: AsyncIterable<UserTurnInput>,
    opts: ZcodeStartOptions,
  ): Promise<ZcodeHandle> {
    if (!opts.pathToAgentExecutable || opts.pathToAgentExecutable.trim() === '') {
      throw new ZcodeExecutableNotFoundError('empty pathToAgentExecutable');
    }

    const env = (opts.env ?? { ...process.env }) as NodeJS.ProcessEnv;

    // spawn 形态三分（D-001）：.cjs/.js 内嵌引擎 → node 直调；Windows .cmd →
    // shim 解析（为未来独立 CLI 留通道）；其余（.exe/POSIX bin）直调。
    const exe = opts.pathToAgentExecutable;
    const args = ['app-server', '--cwd', opts.cwd];
    let spawnCmd: string;
    let spawnArgs: string[];
    if (/\.(c|m)?js$/i.test(exe)) {
      spawnCmd = process.execPath;
      spawnArgs = [exe, ...args];
    } else if (process.platform === 'win32' && /\.cmd$/i.test(exe)) {
      const resolved = resolveWindowsCmdShim(exe);
      if (resolved) {
        spawnCmd = resolved.exe;
        spawnArgs = [...resolved.prependArgs, ...args];
      } else {
        spawnCmd = exe;
        spawnArgs = args;
      }
    } else {
      spawnCmd = exe;
      spawnArgs = args;
    }

    // spawn env 键诊断日志（值经 redactEnvValueForLog 脱敏；2026-10-20 移除相邻的
    // spawn 参数明文日志——cmd/args/cwd 未脱敏，用户路径不应落 daemon 日志）。
    // eslint-disable-next-line no-console
    console.log('[zcode-driver] spawn env keys:', Object.keys(env).filter(k => /ANTHROPIC|CLAUDE|ZCODE|PROXY|NODE_OPTIONS|SILLYHUB/i.test(k)).map(k => k + '=' + redactEnvValueForLog(k, env[k])).join(' | '));
    // ZCode 桌面端设置用户级 env 把个人 Provider 配置硬指回宿主文件（真机实证：
    // ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=C:Usersqinyi.zcode2provider_config.json）——
    // 不改指则 per-session 注入被完全无视，setModel/模型路由全部失效（Provider
    // Registry 中不存在 Model）。改指 per-session 注入文件，平台供应商路由生效。
    if (env.ZCODE_DATA_BASE_DIR) {
      env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(env.ZCODE_DATA_BASE_DIR, '.zcode', 'v2', 'provider_config.json');
    }

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // 引擎退出后 stdin 被 Node 自动 destroy，迟到写入（审批桥应答/close 竞态）
    // 会触发无监听的 'error' → uncaughtException（cli 全局兜底会吞但打 FATAL 栈，
    // 写入静默失败）；常驻空监听兜底（对齐 dsh start 的 stdin error 监听先例）。
    child.stdin?.on('error', () => {});

    const handle: ZcodeHandle = {
      provider: 'zcode',
      processId: child.pid,
      child,
      envelope: new ZcodeEnvelope(),
      zcodeSessionId: null,
      closing: false,
      stateSnapshot: undefined,
      turnInFlight: false,
      close: (): Promise<void> => this._close(handle),
    };
    (handle as unknown as { _ctx: unknown })._ctx = {
      input,
      opts,
    };
    return handle;
  }

  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const h = handle as ZcodeHandle;
    const ctx = (h as unknown as {
      _ctx: { input: AsyncIterable<UserTurnInput>; opts: ZcodeStartOptions };
    })._ctx;
    const child = h.child;
    const onMessage = callbacks.onTurnMessage;
    const onResult = callbacks.onTurnResult;
    const onError = callbacks.onTurnError;

    let finalized = false;
    let turnReported = false;
    let pendingTurnError: string | null = null;
    let currentTurnResolve: ((outcome: TurnOutcome) => void) | null = null;

    // 2026-10-29-engine-live-perception（FR-01）：轮内心跳状态——tool_input_delta
    // 字符累计 + 节流 1s（首条立即发）；beginTurn 清零（consume 会话级跨多 turn，
    // 轮边界重置）。心跳经 callbacks.onHeartbeat 上行（SessionManager 统一转
    // turn_heartbeat_report 鸭子消息，不进事件流）。
    const onHeartbeat = callbacks.onHeartbeat;
    let toolArgsChars = 0;
    let lastHeartbeatAt: number | null = null;
    const HEARTBEAT_THROTTLE_MS = 1_000;
    const emitHeartbeat = (): void => {
      if (!onHeartbeat) return;
      try {
        onHeartbeat({
          kind: 'generating',
          est_chars: toolArgsChars,
          est_tokens: Math.round(toolArgsChars / 3.5),
          precision: 'estimated',
          source: 'zcode_telemetry',
        });
      } catch {
        // fail-soft：心跳异常不崩通知分发（FR-01）。
      }
    };

    type TurnOutcome = {
      kind: 'success' | 'failed' | 'cancelled';
      usage?: InteractiveDriverResult['usage'];
      response?: string;
    };

    let currentTurnPromise: Promise<TurnOutcome> | null = null;
    const beginTurn = (): void => {
      pendingTurnError = null;
      turnReported = false;
      h.turnInFlight = true;
      // 2026-10-29-engine-live-perception（FR-01）：轮边界重置心跳计数 +
      // 发等待首包单次信号（session/send 已发出、首帧未到——prefill 期前端切
      // 「正在等待模型响应」态；内容流到达后自然接管，前端 5s 自清回落）。
      toolArgsChars = 0;
      lastHeartbeatAt = null;
      if (onHeartbeat) {
        try {
          onHeartbeat({
            kind: 'awaiting_first_token',
            precision: 'estimated',
            source: 'zcode_telemetry',
          });
        } catch {
          // fail-soft：单次信号失败静默。
        }
      }
      // resolver 先于 session/send 注册：turn_result 早到（send 响应前）也不丢轮
      currentTurnPromise = new Promise<TurnOutcome>((resolve) => {
        currentTurnResolve = resolve;
      });
    };

    const finishTurn = (outcome: TurnOutcome): void => {
      if (!currentTurnResolve) return;
      const r = currentTurnResolve;
      currentTurnResolve = null;
      h.turnInFlight = false;
      r(outcome);
    };

    // 对齐 codex（ql-20260906-004 审计 #9 同型）：把「close 释放轮次」挂到
    // handle——turn 在途时 _close 杀进程不会再有 turn_result 帧、exit handler
    // 又因 closing 早退，若无人 finishTurn 则 consume 永挂在
    // await currentTurnPromise（协程+闭包泄漏，finally 清理全被跳过）。
    (h as { _finishTurnOnClose?: () => void })._finishTurnOnClose = (): void => {
      finishTurn({ kind: 'cancelled' });
    };

    const reportResult = (r: InteractiveDriverResult): void => {
      // 幂等守卫 = turnReported；finalize 路径（finalizeWithError）也要能上报终态
      // （首个 result 即收敛），故不把 finalized 计入——它只守 consume 主循环。
      if (turnReported) return;
      turnReported = true;
      Promise.resolve(onResult(r)).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[zcode-driver] onTurnResult callback failed', err);
      });
    };

    const finalizeWithError = (message: string): void => {
      if (finalized) return;
      finalized = true;
      finishTurn({ kind: 'cancelled' });
      reportResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: message,
        session_id: h.zcodeSessionId ?? undefined,
      });
      onError?.(new ZcodeProtocolError(message));
    };

    // ── 通知分发：ready 门 + 事件归一化 + turn 收敛 ──────────────────────────
    let readyResolve: (() => void) | null = null;
    const readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    let readySettled = false;

    h.envelope.onNotification((n) => {
      if (finalized) return;
      if (n.method === 'startup/storageState') {
        const phase = (n.params as { phase?: string } | undefined)?.phase;
        if (phase === 'ready' && !readySettled) {
          readySettled = true;
          readyResolve?.();
        }
        return;
      }
      const stateCarrier: {
        snapshot?: ZcodeStateSnapshot;
        heartbeatDelta?: ZcodeHeartbeatDelta;
      } = {};
      const events = normalizeZcodeNotification(n, stateCarrier);
      if (stateCarrier.snapshot) h.stateSnapshot = stateCarrier.snapshot;
      // 2026-10-29-engine-live-perception（FR-01）：tool_input_delta 心跳增量——
      // 累计 + 节流 1s（首条立即发）；无增量（其他 kind/字段缺失）零动作。
      if (stateCarrier.heartbeatDelta) {
        toolArgsChars += stateCarrier.heartbeatDelta.chars;
        const nowMs = Date.now();
        if (
          lastHeartbeatAt === null ||
          nowMs - lastHeartbeatAt >= HEARTBEAT_THROTTLE_MS
        ) {
          lastHeartbeatAt = nowMs;
          emitHeartbeat();
        }
      }
      if (events.length === 0) return;
      for (const ev of events) {
        if (ev.type === 'error') {
          pendingTurnError = ev.content || pendingTurnError;
          // 轮级错误本地留痕（真机诊断：backend 只存 run failed，错误内容仅此一处）
          // eslint-disable-next-line no-console
          console.error('[zcode-driver] turn error:', (ev.content || '').slice(0, 300));
        }
        if (ev.type === 'turn_result') {
          const outcome: TurnOutcome = {
            kind:
              ev.metadata?.turn_status === 'failed'
                ? 'failed'
                : 'success',
            usage: ev.usage,
            response:
              typeof ev.metadata?.response === 'string'
                ? ev.metadata.response
                : undefined,
          };
          finishTurn(outcome);
        }
      }
      Promise.resolve(onMessage?.({ events })).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[zcode-driver] onTurnMessage callback failed', err);
      });
    });

    h.envelope.onProtocolError((err) => {
      // 协议帧级错误：记日志不终止（fail-soft——单帧非法不杀会话；
      // 结构化失败由控制面 request reject 路径承载）。
      // eslint-disable-next-line no-console
      console.warn('[zcode-driver] protocol frame error:', err.message);
    });

    // ── 服务端主动请求分发（信封层） ────────────────────────────────────────
    const sink = { write: (line: string) => child.stdin?.write(line) };
    h.envelope.registerServerRequestHandler(
      'session/requestRuntimePreferences',
      (_params, reply) => {
        reply({
          askUserQuestionAutoResolutionEnabled: true,
          memoryEnabled: false,
          modelContextBudgetStrategy: 'preflight-v1',
          nativeSearchEnhancementsEnabled: true,
        });
      },
    );
    h.envelope.registerServerRequestHandler(
      'interaction/requestOfficialMcpAuthHeaders',
      (_params, reply) => reply({}),
    );
    h.envelope.registerServerRequestHandler(
      'interaction/requestUserInput',
      (_params, reply) => reply({ cancelled: true }),
    );
    h.envelope.registerServerRequestHandler(
      'interaction/requestPermission',
      (params, reply) => {
        void this._handlePermissionBridge(h, ctx.opts, params, reply, (ev) => {
          Promise.resolve(onMessage?.({ events: [ev] })).catch(() => {});
        });
      },
    );

    if (!child.stdout) {
      throw new ZcodeProtocolError('zcode 子进程缺 stdout 管道（spawn 配置异常）');
    }
    // 跨 chunk 多字节 UTF-8 有状态解码（pi-rpc-driver LfLineFramer ql-20260915-005
    // 同型先例）：逐 chunk toString 会把跨 chunk 边界切开的多字节序列（中文等）
    // 变成 U+FFFD，且 JSON.parse 不报错——纯静默内容损坏。
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', (chunk: Buffer) => {
      h.envelope.feed(decoder.write(chunk), sink);
    });
    child.stdout.on('end', () => {
      // 进程正常退出时冲刷残尾字节；closing 后信封已/即将 dispose，跳过
      const tail = decoder.end();
      if (tail && !h.closing) h.envelope.feed(tail, sink);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // stderr 诊断噪声不进事件流（引擎日志面）
      const text = chunk.toString('utf8').trim();
      if (text) {
        // eslint-disable-next-line no-console
        console.warn('[zcode-driver] stderr:', text.slice(0, 300));
      }
    });
    child.on('error', (err) => finalizeWithError(`zcode 进程启动失败：${err.message}`));
    child.on('exit', (code, signal) => {
      if (h.closing || finalized) return;
      finalizeWithError(
        `zcode 进程异常退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`,
      );
    });

    try {
      // 1. 就绪门
      console.log('[zcode-driver] step: waiting ready');
      await withTimeout(readyPromise, this.readyTimeoutMs, 'startup ready 超时');
      console.log('[zcode-driver] step: ready ok');
      // 2. 建会话
      const created = (await h.envelope.request(
        'session/create',
        { workspace: { workspacePath: ctx.opts.cwd, workspaceKey: ctx.opts.cwd } },
        sink.write,
        { timeoutMs: this.controlTimeoutMs },
      )) as { sessionId?: string; session?: { sessionId?: string } };
      // 实测回包形状：sessionId 在 result.session.sessionId（2026-10-15 探测钉板）；
      // 兼容顶层直挂形态（变体）双读。
      const createdSessionId = created?.sessionId ?? created?.session?.sessionId;
      if (typeof createdSessionId !== 'string' || createdSessionId === '') {
        throw new ZcodeProtocolError('session/create 未返回 sessionId');
      }
      h.zcodeSessionId = createdSessionId;
      // 会话指针上报（resume 消费面；对齐 codex thread_started 口径）
      Promise.resolve(
        onMessage?.({
          events: [
            {
              type: 'status',
              subtype: 'session_started',
              content: '',
              session_id: createdSessionId,
            },
          ],
        }),
      ).catch(() => {});
      console.log('[zcode-driver] step: create ok');
      // 3. 订阅内容流（desktop-continuous——session/event 推送前提，实测钉板）
      await h.envelope.request(
        'session/subscribe',
        { sessionId: createdSessionId, deliveryKind: 'desktop-continuous' },
        sink.write,
        { timeoutMs: this.controlTimeoutMs },
      );
      // 4. 初始模型/思考档位
      if (ctx.opts.model) {
        // setModel 失败非致命（真机实证：ZCode registry 对未预置的 provider/model
        // 组合抛 Provider Registry 中不存在 Model——会话仍可用默认模型跑通轮次，
        // 杀掉会话反而误伤。降级为 warn 继续会话创建）。
        await this._applyModel(h, ctx.opts.model).catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[zcode-driver] setModel 失败（非致命，保留引擎默认模型）:', e instanceof Error ? e.message : String(e));
        });
      }
      if (ctx.opts.thinkingLevel) {
        await this.setThinkingLevel(h, ctx.opts.thinkingLevel).catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[zcode-driver] setThinkingLevel 失败（非致命）:', e instanceof Error ? e.message : String(e));
        });
      }

      console.log('[zcode-driver] step: setup complete, entering input loop');
      // 5. 轮循环：逐输入 → send → 等收敛。
      // while + 手动拉取（对齐 codex 主循环形态）：terminateSession 顺序是
      // driver.close() 先于 queue.close()，for-await 会在 next() 上多挂一段窗口；
      // 轮内两个 await 点（send / turn 收敛）任一被 close 释放都经 closing 守卫
      // 静默收敛（终态归 close 链，不报幽灵 result、不回队列拉新输入）。
      const inputIt = ctx.input[Symbol.asyncIterator]();
      while (!h.closing && !finalized) {
        console.log('[zcode-driver] pulling input');
        const res = await inputIt.next();
        console.log('[zcode-driver] input pulled, done:', res.done);
        if (h.closing || finalized || res.done) break;
        const item = res.value;
        if (item.type !== 'user' || item.text.trim() === '') continue;
        beginTurn();
        try {
          await h.envelope.request(
            'session/send',
            { sessionId: h.zcodeSessionId, content: item.text },
            sink.write,
            { timeoutMs: 0 }, // 轮内不设请求超时——收敛以 turn_result 为准
          );
        } catch (err) {
          // close 引发的 send 拒绝（dispose reject 全量 pending）：静默收敛，
          // 终态归 close 链（对齐 codex closing 守卫语义）
          if (h.closing || finalized) break;
          // send 失败 = 结构化失败（D-004：不重试不降级）
          const message =
            err instanceof ZcodeProtocolError
              ? err.message
              : `session/send 失败：${String(err)}`;
          reportResult({
            subtype: 'error_during_execution',
            is_error: true,
            result: message,
            session_id: h.zcodeSessionId ?? undefined,
          });
          continue;
        }
        // beginTurn 已在 session/send 前赋值（resolver 先于 send 注册），此处非 null
        const outcome = await currentTurnPromise!;
        // close 期间被 _finishTurnOnClose 释放的 cancelled 不上报（对齐 codex
        // 主循环 closing 守卫），否则 close 后又报一轮幽灵 result
        if (h.closing || finalized) break;
        reportResult({
          subtype:
            outcome.kind === 'success'
              ? 'success'
              : outcome.kind === 'failed'
                ? 'error_during_execution'
                : 'cancelled_by_user',
          is_error: outcome.kind === 'failed',
          result: outcome.response ?? (outcome.kind === 'failed' ? pendingTurnError : ''),
          usage: outcome.usage,
          session_id: h.zcodeSessionId ?? undefined,
        });
      }
    } catch (err) {
      finalizeWithError(
        err instanceof Error ? err.message : `zcode consume 失败：${String(err)}`,
      );
    } finally {
      // 对齐 codex consume finally（codex-app-server-driver.ts 同位）：清 close 槽位
      //（闭包含 onResult/onMessage 回调与 currentTurnPromise，不清则滞留到 handle GC）
      // 并兜底 close 子进程——现网 close 链由 terminateSession/reload 发起时 h.closing
      // 幂等守卫直接返回；未来任何「consume 自然退出」新路径也不泄漏子进程
      //（2026-10-17-audit-risk-followup，评审 P3 清偿）。
      delete (h as { _finishTurnOnClose?: () => void })._finishTurnOnClose;
      finalized = true;
      h.envelope.dispose();
      await h.close();
    }
  }

  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (!handle) return false;
    const h = handle as ZcodeHandle;
    if (h.closing || !h.zcodeSessionId || !h.turnInFlight) return false;
    try {
      await h.envelope.request(
        'session/stop',
        { sessionId: h.zcodeSessionId },
        (line) => h.child.stdin?.write(line),
        { timeoutMs: this.compactTimeoutMs },
      );
      return true;
    } catch {
      // E3：打断 no-op 不冒泡
      return false;
    }
  }

  async compact(handle: InteractiveDriverHandle): Promise<CompactResult> {
    const h = handle as ZcodeHandle;
    if (!h.zcodeSessionId) return { ok: false, error: '会话未创建' };
    try {
      await h.envelope.request(
        'session/compact',
        { sessionId: h.zcodeSessionId },
        (line) => h.child.stdin?.write(line),
        { timeoutMs: this.compactTimeoutMs },
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getThinkingLevels(
    handle: InteractiveDriverHandle,
    _model?: string,
  ): Promise<ThinkingLevels> {
    const h = handle as ZcodeHandle;
    const catalog: readonly ZcodeModelCatalogEntry[] =
      h.stateSnapshot?.modelCatalog ?? [];
    const levels = new Set<string>();
    for (const entry of catalog) {
      for (const l of entry.reasoningLevels ?? []) levels.add(l);
    }
    // 快照缺 levels 时回退常见三档（低配默认，不抛错）
    return { levels: levels.size > 0 ? [...levels] : ['low', 'medium', 'high'] };
  }

  async setThinkingLevel(
    handle: InteractiveDriverHandle,
    level: string,
  ): Promise<ThinkingLevelResult> {
    const h = handle as ZcodeHandle;
    if (!h.zcodeSessionId) return { ok: false, error: '会话未创建' };
    const engineLevel = mapPlatformLevelToEngine('zcode', level);
    if (engineLevel === undefined) {
      return { ok: false, error: `不支持的思考档位：${level}` };
    }
    try {
      await h.envelope.request(
        'session/setThoughtLevel',
        { sessionId: h.zcodeSessionId, level: engineLevel },
        (line) => h.child.stdin?.write(line),
        { timeoutMs: this.compactTimeoutMs },
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 实测形状（ZCode zod Pu schema）：model 必须是 { providerId, modelId } 对象——字符串直接传报 Invalid params（腾讯云真机实证）。providerId = zcode-settings 注入的个人 Provider 键。
  /** 初始/热切换模型（providers.ts provider_config_changed 路径复用）。
   *
   * 等待 app-server 模型目录就绪（state.updated 携带 model catalog）后再下发
   * session/setModel——个人 Provider 异步加载，spawn 后立刻 setModel 会因
   * registry 未就绪报「Provider Registry 中不存在 Model」（真机实证，会话
   * 34d3858f/dd2e4895），轮次随之挂死（无模型可选）。
   *
   * 2026-10-17 探针钉板（app.setModel 双路径）：JSON-RPC 面只收对象 → 引擎走
   * 严格校验路径（Vie），options.reasoningLevel 缺失即报「Reasoning level is
   * required」（目录条目 levels=[low,high,max] defaultLevel=max——个人模型恒非
   * 空 levels，真机实证）。故目录命中时必带 options.reasoningLevel（引擎自报
   * defaultLevel ?? 末档）；目录 60s 仍未到达时兜底裸发（保持非致命语义）。
   * levels 推导统一在等待循环之后做——精确命中与大小写命中两条退出路径都要
   * 附带（评审 P2：推导内联在大小写分支会让精确命中裸发被引擎拒）。
   */
  private async _applyModel(h: ZcodeHandle, model: string | { modelId?: unknown; providerId?: unknown }): Promise<void> {
    let resolvedProviderId = ZCODE_PROVIDER_ID;
    // 归一后的字符串 modelId 作为兜底初值：精确命中退出/目录等待超时两条路径
    // 不再发送 modelId:undefined（真机实证：undefined 直发 = setModel 必败
    // 「Provider Registry 中不存在 Model」→ 引擎无模型 → 每轮 turn.failed
    // 「Select a model before continuing」，会话 368a0ed6）。
    let resolvedModelId: string =
      typeof model === 'string' ? model
      : model && typeof model === 'object' && typeof (model as { modelId?: unknown }).modelId === 'string'
        ? (model as { modelId: string }).modelId
        : String(model);
    let reasoningLevel: string | undefined;
    const modelId = resolvedModelId;
    // 精确 → 大小写不敏感两级匹配（平台 glm-5.3 vs registry GLM-5.3）。
    const findEntry = () =>
      h.stateSnapshot?.modelCatalog?.find((e) => e.modelId === modelId)
      ?? h.stateSnapshot?.modelCatalog?.find(
        (e) => e.modelId.toLowerCase() === modelId.toLowerCase());
    // 等模型目录出现目标 model（最多 catalogWaitTimeoutMs，默认 60s）：个人
    // provider 注册 + 目录推送实测 ~30–45s（spawn 起算，真机漂移），窗口留余量。
    const catalogDeadline = Date.now() + this.catalogWaitTimeoutMs;
    let found = findEntry();
    while (!found) {
      if (Date.now() > catalogDeadline) {
        // 目录始终未含目标模型：大多为注入 provider 配置未注册（形状/时序）。
        // 留目录快照诊断（不抛——setModel 失败由调用方降级 warn）。
        const catalog = h.stateSnapshot?.modelCatalog?.map((e) => e.modelId) ?? [];
        console.warn(
          `[zcode-driver] model catalog 未含 '${modelId}'（${this.catalogWaitTimeoutMs}ms 等待超时），目录=${JSON.stringify(catalog).slice(0, 400)}`,
        );
        break;
      }
      if (h.closing) return;
      await new Promise<void>((r) => setTimeout(r, 300));
      found = findEntry();
    }
    if (found) {
      resolvedProviderId = found.providerId;
      resolvedModelId = found.modelId;
      // 严格路径要求 reasoningLevel（引擎自报默认档，末档兜底——引擎约定
      // values.at(-1)=defaultLevel，探针实证 [low,high,max] default=max）。
      reasoningLevel = found.reasoningDefaultLevel
        ?? (found.reasoningLevels && found.reasoningLevels.length > 0
          ? found.reasoningLevels[found.reasoningLevels.length - 1]
          : undefined);
    }
    await h.envelope.request(
      'session/setModel',
      {
        sessionId: h.zcodeSessionId,
        model: {
          providerId: resolvedProviderId,
          modelId: resolvedModelId,
          ...(reasoningLevel !== undefined ? { options: { reasoningLevel } } : {}),
        },
      },
      (line) => h.child.stdin?.write(line),
      { timeoutMs: this.controlTimeoutMs },
    );
  }

  /**
   * 审批代答桥（三态，对齐 codex _handleApproval 语义）：
   *   - allow-through：!manualApproval || askUserOnly → 首个 allow 类选项；
   *   - full-review：manualApproval 且注入 sessionPermission → 用户决定；
   *   - fail-closed：deny / 无注入 / 异常 → 首个 deny 类选项，无则 cancelled。
   */
  private async _handlePermissionBridge(
    h: ZcodeHandle,
    opts: ZcodeStartOptions,
    params: unknown,
    reply: (result: unknown) => void,
    log: (ev: { type: 'tool_use'; content: string; metadata: Record<string, unknown> }) => void,
  ): Promise<void> {
    const options = extractPermissionOptions(params);
    const pick = (wantAllow: boolean): unknown => {
      const hit = options.find((o) =>
        wantAllow ? o.isAllow : o.isDeny,
      );
      if (hit) return { outcome: { outcome: 'selected', optionId: hit.optionId } };
      return { outcome: { outcome: 'cancelled' } };
    };

    if (!opts.manualApproval || opts.askUserOnly) {
      reply(pick(true));
      log({
        type: 'tool_use',
        content: '',
        metadata: { kind: 'approval', auto_accept: true, provider: 'zcode' },
      });
      return;
    }
    if (!opts.sessionPermission) {
      reply(pick(false));
      log({
        type: 'tool_use',
        content: '',
        metadata: {
          kind: 'approval',
          auto_accept: false,
          fail_closed: true,
          provider: 'zcode',
          reason: 'no sessionPermission injected',
        },
      });
      return;
    }
    try {
      const decision = await opts.sessionPermission.requestPermission({
        toolName: 'zcode_permission',
        toolInput: params,
      });
      reply(decision.behavior === 'allow' ? pick(true) : pick(false));
    } catch {
      reply(pick(false));
    }
    void h; // 句柄仅存续性引用（未来挂 approvalInteractionId 用）
  }

  /** close 三级阶梯（对齐 codex：stdin.end 优雅 → SIGTERM → SIGKILL）。 */
  private async _close(handle: ZcodeHandle): Promise<void> {
    const h = handle;
    if (h.closing) return;
    h.closing = true;
    // 释放 consume 的当前轮等待者（先于杀进程）：进程被杀后不会再有 turn_result
    // 帧、exit handler 因 closing 早退；不释放则 consume 永挂 await
    // currentTurnPromise（对齐 codex _close 的 _finishTurnOnClose 调用）。
    (h as { _finishTurnOnClose?: () => void })._finishTurnOnClose?.();
    try {
      if (h.zcodeSessionId && h.child.stdin) {
        await h.envelope
          .request(
            'session/close',
            { sessionId: h.zcodeSessionId },
            (line) => h.child.stdin?.write(line),
            { timeoutMs: 3_000 },
          )
          .catch(() => {});
      }
    } finally {
      h.child.stdin?.end();
      // SIGTERM → 到期无条件升级 SIGKILL（仅以 exitCode 判活）：Node 的 killed
      // 在信号成功发出后即为 true、不代表进程已终止——旧写法 `!h.child.killed`
      // 使 SIGKILL 分支永不可达，目标捕获/忽略 SIGTERM 时子进程永久泄漏（对齐
      // codex _close 无条件升级先例）。
      const termTimer = setTimeout(() => {
        if (h.child.exitCode === null) {
          try {
            h.child.kill('SIGTERM');
          } catch {
            // 已退出
          }
        }
      }, KILL_GRACE_MS);
      termTimer.unref?.();
      const killTimer = setTimeout(() => {
        if (h.child.exitCode === null) {
          try {
            h.child.kill('SIGKILL');
          } catch {
            // 已退出
          }
        }
      }, KILL_GRACE_MS * 2);
      killTimer.unref?.();
      h.envelope.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ZcodeProtocolError(`${label}（${ms}ms）`, undefined, undefined, true)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** 从请求 params 提取选项表（optionId/kind 形态宽松判定 allow/deny 类）。 */
function extractPermissionOptions(
  params: unknown,
): Array<{ optionId: string; isAllow: boolean; isDeny: boolean }> {
  if (typeof params !== 'object' || params === null) return [];
  const raw = (params as Record<string, unknown>)['options'];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ optionId: string; isAllow: boolean; isDeny: boolean }> = [];
  for (const o of raw) {
    if (typeof o !== 'object' || o === null) continue;
    const rec = o as Record<string, unknown>;
    const optionId = typeof rec.optionId === 'string' ? rec.optionId : '';
    if (!optionId) continue;
    const kind = String(rec.kind ?? '');
    const response = rec.response as Record<string, unknown> | undefined;
    const decision =
      typeof response?.decision === 'string' ? response.decision : '';
    out.push({
      optionId,
      isAllow: /allow/i.test(kind) || decision === 'allow',
      isDeny: /deny/i.test(kind) || decision === 'deny',
    });
  }
  return out;
}
