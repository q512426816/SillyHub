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
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { ZcodeEnvelope, ZcodeProtocolError } from '../adapters/zcode-envelope.js';
import {
  normalizeZcodeNotification,
  type ZcodeModelCatalogEntry,
  type ZcodeStateSnapshot,
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

  constructor(
    opts: {
      readyTimeoutMs?: number;
      controlTimeoutMs?: number;
      compactTimeoutMs?: number;
    } = {},
  ) {
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.controlTimeoutMs = opts.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    this.compactTimeoutMs = opts.compactTimeoutMs ?? DEFAULT_COMPACT_TIMEOUT_MS;
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

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

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
      const stateCarrier: { snapshot?: ZcodeStateSnapshot } = {};
      const events = normalizeZcodeNotification(n, stateCarrier);
      if (stateCarrier.snapshot) h.stateSnapshot = stateCarrier.snapshot;
      if (events.length === 0) return;
      for (const ev of events) {
        if (ev.type === 'error') {
          pendingTurnError = ev.content || pendingTurnError;
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
    child.stdout.on('data', (chunk: Buffer) => {
      h.envelope.feed(chunk.toString('utf8'), sink);
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
      await withTimeout(readyPromise, this.readyTimeoutMs, 'startup ready 超时');
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
      // 3. 订阅内容流（desktop-continuous——session/event 推送前提，实测钉板）
      await h.envelope.request(
        'session/subscribe',
        { sessionId: createdSessionId, deliveryKind: 'desktop-continuous' },
        sink.write,
        { timeoutMs: this.controlTimeoutMs },
      );
      // 4. 初始模型/思考档位
      if (ctx.opts.model) {
        await this._applyModel(h, ctx.opts.model);
      }
      if (ctx.opts.thinkingLevel) {
        await this.setThinkingLevel(h, ctx.opts.thinkingLevel);
      }

      // 5. 轮循环：逐输入 → send → 等收敛
      for await (const item of ctx.input) {
        if (h.closing || finalized) break;
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
      finalized = true;
      h.envelope.dispose();
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

  /** 初始/热切换模型（providers.ts provider_config_changed 路径复用）。 */
  private async _applyModel(h: ZcodeHandle, model: string): Promise<void> {
    await h.envelope.request(
      'session/setModel',
      { sessionId: h.zcodeSessionId, model },
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
      const killTimer = setTimeout(() => {
        if (h.child.exitCode === null && !h.child.killed) {
          h.child.kill('SIGTERM');
          setTimeout(() => {
            if (h.child.exitCode === null && !h.child.killed) {
              h.child.kill('SIGKILL');
            }
          }, KILL_GRACE_MS).unref?.();
        }
      }, KILL_GRACE_MS).unref?.();
      void killTimer;
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
