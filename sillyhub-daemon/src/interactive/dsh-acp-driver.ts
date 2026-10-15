/**
 * dsh-acp-driver.ts —— DeepSeek Harness（dsh）ACP v1 交互式驱动。
 *
 * 2026-10-15-dsh-engine-acp task-03（D-003 方案 A：自研驱动，零新 npm 依赖）。
 * spawn `dsh --profile acp`（stdio NDJSON JSON-RPC，Zed 同款 Agent Client Protocol
 * v1），协议形状事实源 = dsh 仓库 packages/acp/acp/src（index.ts initialize/
 * requestPermission / session.ts prompt 收敛 / updates.ts 通知族）。
 *
 * 与 codex interactive driver 同构（结构先例 codex-app-server-driver.ts）：
 * 自带最小 NDJSON JSON-RPC 客户端（adapters/json-rpc.ts 是批量层 codex/hermes/
 * kimi/kiro 专用协议适配器，非交互驱动可复用的通用分帧件——codex 交互驱动同样
 * 协议层自持，此处照同款先例）。Windows .cmd shim 复用 resolveWindowsCmdShim
 * （ql-20260624-002 R-exe 先例）。
 *
 * 能力边界（caps 如实申报，见 providers.ts dsh 条目）：
 * - steering=false：ACP 每会话一次一个 in-flight prompt，无忙轮注入通道；
 * - compact 不实现：ACP 无对应方法（dsh 内部自管上下文）；
 * - 审批代答：session/request_permission 桥 sessionPermission.requestPermission
 *   （manual_approval 语义；!manualApproval || askUserOnly 自动 allow——对齐 codex
 *   _handleApproval；deny/无注入 fail-closed reject）；
 * - thinking 三档本地映射（off→不携带；minimal/low→low；medium→medium；
 *   high/xhigh/max→high）——ACP reasoning_effort 为模型条件性三档
 *   （"when the exact model declares one"），不进共享 ENGINE_LEVEL_MATRIX
 *   （thinking-levels.ts 非本任务允许面；矩阵先行例是共享七档引擎）。
 *
 * 生命周期：start() = spawn + 握手（initialize → session/new | resume →
 * set_config_option[ model / reasoning_effort ]）；consume() = 逐 turn
 * session/prompt，session/update 通知经 dsh-acp-events.normalizeAcpUpdate 归一化
 * 产出事件批次，prompt 响应（stopReason）收敛 turn_result；interrupt() =
 * session/cancel；握手/协议失败 → 结构化 error（D-002 兜底：不重试不降级）。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { LfLineFramer } from './pi-rpc-driver.js';
import type {
  AgentEvent,
} from '../types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  InteractiveDriverResult,
  InteractiveProvider,
  ThinkingLevelResult,
  ThinkingLevels,
  TurnMessageEnvelope,
  UserTurnInput,
} from './driver.js';
import { normalizeAcpUpdate, type AcpSessionUpdate } from './dsh-acp-events.js';

/** ACP 协议版本（dsh 服务端单版本，见 index.ts initialize 实现）。 */
const ACP_PROTOCOL_VERSION = 1;
/** 握手/方法请求超时（ms）——握手失败按 D-002 显式报错，不重试。 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * driver 拿到的审批入口（鸭子类型，对齐 codex CodexSessionPermissionHooks 先例：
 * 只依赖 behavior 字段，便于测试 mock；生产由 driver-factory 从 SessionManager
 * 闭包注入）。内部已含 askUserOnly allow-through / fail-closed deny 语义。
 */
export interface DshAcpPermissionHooks {
  requestPermission(input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId?: string;
    isUserInputKind?: boolean;
  }): Promise<{ behavior: 'allow' | 'deny' }>;
}

/** dsh 驱动启动选项（extends provider-neutral 公共字段）。 */
export interface DshAcpStartOptions extends InteractiveDriverStartOptions {
  /** dsh 可执行路径（agent-detector _agentPaths 注入；缺省 start 抛错）。 */
  pathToAgentExecutable: string;
  /** 审批入口（未注入时 full-review fail-closed reject，照 codex 先例）。 */
  sessionPermission?: DshAcpPermissionHooks;
  /** 诊断日志用 sessionId。 */
  sessionId?: string;
}

/** ACP prompt 收敛响应（session.ts：settlement 后回 { stopReason }）。 */
interface AcpPromptResponse {
  stopReason?: string;
}

/** dsh 会话句柄（不可序列化，禁止落盘——driver.ts E7）。 */
export interface DshAcpHandle extends InteractiveDriverHandle {
  readonly provider: 'dsh';
  /** ACP 会话 ID（resume 指针 / prompt·cancel 参数）。 */
  readonly acpSessionId?: string;
}

/**
 * dsh ACP 交互驱动。实现 InteractiveDriver 契约（start/consume/interrupt 必选 +
 * getThinkingLevels/setThinkingLevel 可选；compact 不实现）。
 */
export class DshAcpDriver implements InteractiveDriver {
  readonly provider: InteractiveProvider = 'dsh';

  async start(
    input: AsyncIterable<UserTurnInput>,
    opts: DshAcpStartOptions,
  ): Promise<DshAcpHandle> {
    if (!opts.pathToAgentExecutable) {
      throw new DshExecutableNotFoundError('dsh executable path is empty (agent-detector 未注册或探测不到 dsh)');
    }

    const args = ['--profile', 'acp'];
    let spawnCmdPath = opts.pathToAgentExecutable;
    let spawnArgs = args;
    let useShell = false;
    if (process.platform === 'win32' && /\.cmd$/i.test(opts.pathToAgentExecutable)) {
      const resolved = resolveWindowsCmdShim(opts.pathToAgentExecutable);
      if (resolved) {
        spawnCmdPath = resolved.exe;
        spawnArgs = [...resolved.prependArgs, ...args];
      } else {
        useShell = true;
      }
    }

    const child = spawn(spawnCmdPath, spawnArgs, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: useShell,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    const conn = new AcpJsonRpcConnection(child);
    const ctx = {
      conn,
      child,
      input,
      opts,
      acpSessionId: undefined as string | undefined,
      activePrompt: false,
      closed: false,
    };
    (child.stdin as { once: (ev: string, fn: () => void) => void }).once('error', () => {
      /* stdin EOF 关闭竞态：close 路径统一处理 */
    });

    const handle: DshAcpHandle = {
      provider: 'dsh',
      processId: child.pid,
      get acpSessionId() {
        return ctx.acpSessionId;
      },
      close: () => {
        if (ctx.closed) return;
        ctx.closed = true;
        conn.dispose();
        // 清理阶梯：stdin EOF 优雅退出（ACP profile 语义）→ 不退则强杀。
        if (!child.killed) {
          child.stdin.end();
          const killer = setTimeout(() => child.kill('SIGKILL'), 5_000);
          child.once('exit', () => clearTimeout(killer));
        }
      },
    };
    // @ts-expect-error 内部 ctx 挂载位（consume/interrupt 读；不进公共契约）。
    handle.__dsh = ctx;
    return handle;
  }

  async consume(
    handle: DshAcpHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const ctx = internalCtx(handle);
    const { conn, child, opts } = ctx;
    const permission = opts.sessionPermission;

    // 服务端请求：session/request_permission 代答桥（对齐 codex _handleApproval 语义）。
    conn.onServerRequest(async (method, params, respond) => {
      if (method !== 'session/request_permission') {
        // 未知服务端请求 fail-closed 拒绝（不让 dsh 悬空等待）。
        await respond({ error: { code: -32601, message: `unsupported server request: ${method}` } });
        return;
      }
      const p = params as {
        sessionId?: string;
        toolCall?: { toolCallId?: string };
        options?: Array<{ optionId: string; kind: string }>;
      };
      const allowOption = p.options?.find((o) => o.kind === 'allow_once');
      const reject = () => respond({ outcome: { outcome: 'cancelled' } });
      const allow = () =>
        respond({
          outcome: {
            outcome: 'selected',
            optionId: allowOption?.optionId ?? 'allow-once',
          },
        });
      // allow-through：manualApproval=false 或 askUserOnly=true（普通审批不弹卡）。
      if (!opts.manualApproval || opts.askUserOnly) {
        await allow();
        return;
      }
      if (!permission) {
        // fail-closed：未注入审批入口（codex 同款，绝不 accept）。
        await reject();
        return;
      }
      try {
        const decision = await permission.requestPermission({
          toolName: 'acp_permission',
          toolInput: params as Record<string, unknown>,
          toolUseId: p.toolCall?.toolCallId,
        });
        if (decision.behavior === 'allow') await allow();
        else await reject();
      } catch {
        await reject();
      }
    });

    try {
      // ── 握手（失败 → 结构化 error，D-002 兜底：不重试不降级）──
      await conn.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const newOrResume: Record<string, unknown> = { cwd: opts.cwd };
      if (opts.resume) newOrResume.sessionId = opts.resume;
      const sessionResp = (await conn.request(
        opts.resume ? 'session/resume' : 'session/new',
        newOrResume,
      )) as { sessionId?: string };
      ctx.acpSessionId = sessionResp.sessionId;
      // 模型/思考档位（provider_config 路由的 model + 平台档位本地三档映射）。
      if (opts.model) {
        await conn.request('session/set_config_option', {
          sessionId: ctx.acpSessionId,
          option: { optionId: 'model', value: opts.model },
        });
      }
      const effort = mapThinkingLevel(opts.thinkingLevel);
      if (effort !== undefined) {
        await conn.request('session/set_config_option', {
          sessionId: ctx.acpSessionId,
          option: { optionId: 'reasoning_effort', value: effort },
        });
      }

      // ── 逐 turn 循环 ──
      for await (const turn of ctx.input) {
        if (ctx.closed) break;
        if (turn.text.length === 0) continue; // 空文本入队允许，driver 跳过（E1 语义）
        ctx.activePrompt = true;
        let turnError: string | undefined;
        const unregister = conn.onNotification((params) => {
          const events = normalizeAcpUpdate(params as AcpSessionUpdate);
          if (events.length > 0) {
            void callbacks.onTurnMessage?.(envelope(events));
          }
        });
        try {
          const resp = (await conn.request('session/prompt', {
            sessionId: ctx.acpSessionId,
            prompt: [{ type: 'text', text: turn.text }],
          })) as AcpPromptResponse;
          const stopReason = resp.stopReason ?? 'end_turn';
          const isError = stopReason !== 'end_turn';
          callbacks.onTurnResult({
            subtype: isError ? `acp_${stopReason}` : 'success',
            is_error: isError,
            result: isError ? `stopReason=${stopReason}` : undefined,
            session_id: ctx.acpSessionId,
          });
        } catch (err) {
          turnError = err instanceof Error ? err.message : String(err);
        } finally {
          unregister();
          ctx.activePrompt = false;
        }
        if (turnError !== undefined) throw new Error(turnError);
      }
    } catch (err) {
      callbacks.onTurnError?.(err);
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: err instanceof Error ? err.message : String(err),
        session_id: ctx.acpSessionId,
      });
      return;
    }

    // 输入流自然结束（session end 路径）：等子进程退出由 close 负责，此处收敛。
    child.once('exit', () => {
      conn.dispose();
    });
  }

  async interrupt(handle: DshAcpHandle | null): Promise<boolean> {
    if (!handle) return false;
    const ctx = internalCtx(handle);
    if (!ctx.activePrompt || !ctx.acpSessionId || ctx.closed) return false;
    try {
      await ctx.conn.request('session/cancel', { sessionId: ctx.acpSessionId });
      return true;
    } catch {
      return false; // no-op 不冒泡（E3）
    }
  }

  async getThinkingLevels(_handle: DshAcpHandle): Promise<ThinkingLevels> {
    // ACP reasoning_effort 为模型条件性三档，静态档表（运行时真值以模型为准）。
    return { levels: ['low', 'medium', 'high'] };
  }

  async setThinkingLevel(
    handle: DshAcpHandle,
    level: string,
  ): Promise<ThinkingLevelResult> {
    const ctx = internalCtx(handle);
    const effort = mapThinkingLevel(level);
    if (effort === undefined) return { ok: false, error: `未知平台档位: ${level}` };
    try {
      await ctx.conn.request('session/set_config_option', {
        sessionId: ctx.acpSessionId,
        option: { optionId: 'reasoning_effort', value: effort },
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** dsh 可执行缺失（agent-detector 未注册/探测不到）。 */
export class DshExecutableNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DshExecutableNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// 内部：NDJSON JSON-RPC 连接（最小实现；id 关联 + 超时 + 通知/服务端请求分发）
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

type ServerResponder = (result: unknown) => Promise<void>;

class AcpJsonRpcConnection {
  private _nextId = 1;
  private readonly _pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private _notifyHandler:
    | ((params: unknown) => void)
    | undefined;
  private _serverRequestHandler:
    | ((
        method: string,
        params: unknown,
        respond: ServerResponder,
      ) => Promise<void>)
    | undefined;
  private _disposed = false;
  /**
   * 早到响应暂存（id → 原始 result/error）：同一 data chunk 内多行被同步解析时，
   * 后一行的响应可能先于对应 request 的微任务发出（2026-10-15 task-03 实测）；
   * 暂存并在 request() 建立后核对，防丢。上限 32 防垃圾 id 无界增长。
   */
  private readonly _early = new Map<number, JsonRpcMessage>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    // LF 严格分帧：复用 pi 驱动 LfLineFramer（仓内先例禁 Node readline 做 JSON
    // 行分帧——U+2028/U+2029 在 JSON 字符串合法而 readline 会当行分隔切行）。
    const framer = new LfLineFramer((line) => this._onLine(line));
    child.stdout.on('data', (chunk: Buffer) => framer.push(chunk));
    child.stdout.on('end', () => framer.end());
    child.stderr.setEncoding('utf8');
  }

  onNotification(fn: (params: unknown) => void): () => void {
    this._notifyHandler = fn;
    return () => {
      if (this._notifyHandler === fn) this._notifyHandler = undefined;
    };
  }

  onServerRequest(
    fn: (method: string, params: unknown, respond: ServerResponder) => Promise<void>,
  ): void {
    this._serverRequestHandler = fn;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this._disposed) return Promise.reject(new Error('dsh acp connection disposed'));
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`dsh acp request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
      const early = this._early.get(id);
      if (early !== undefined) {
        this._early.delete(id);
        clearTimeout(timer);
        this._pending.delete(id);
        if (early.error !== undefined) {
          reject(new Error(early.error.message ?? `dsh acp error ${early.error.code ?? ''}`));
        } else {
          resolve(early.result);
        }
      }
    });
  }

  /** 服务端请求应答（result 形态直接透传；错误用 JSON-RPC error 对象）。 */
  private async _respond(id: number | string, result: unknown): Promise<void> {
    this._send({ jsonrpc: '2.0', id, result });
  }

  private _send(msg: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private _onLine(line: string): void {
    if (this._disposed || line.trim().length === 0) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return; // 坏 JSON 不崩（诊断靠 stderr 通道）
    }
    if (msg.id !== undefined && msg.id !== null && msg.method !== undefined) {
      // 服务端请求
      const respond = (result: unknown) => this._respond(msg.id as number, result);
      void this._serverRequestHandler?.(msg.method, msg.params, respond);
      return;
    }
    if (msg.id !== undefined && msg.id !== null) {
      // 响应（关联 id）
      const pending = this._pending.get(msg.id as number);
      if (!pending) {
        if (this._early.size < 32) this._early.set(msg.id as number, msg);
        return;
      }
      clearTimeout(pending.timer);
      this._pending.delete(msg.id as number);
      if (msg.error !== undefined) {
        pending.reject(new Error(msg.error.message ?? `dsh acp error ${msg.error.code ?? ''}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    // 通知
    this._notifyHandler?.(msg.params);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error('dsh acp connection disposed'));
    }
    this._pending.clear();
    this._early.clear();
  }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 句柄 → 内部 ctx（start 时挂载）。 */
function internalCtx(handle: DshAcpHandle): {
  conn: AcpJsonRpcConnection;
  child: ChildProcessWithoutNullStreams;
  input: AsyncIterable<UserTurnInput>;
  opts: DshAcpStartOptions;
  acpSessionId?: string;
  activePrompt: boolean;
  closed: boolean;
} {
  const ctx = (handle as { __dsh?: unknown }).__dsh;
  if (ctx === undefined) throw new Error('invalid dsh handle');
  return ctx as ReturnType<typeof internalCtx>;
}

/** envelope 组装（raw 仅调试开关携带，D-002@v1）。 */
function envelope(events: AgentEvent[]): TurnMessageEnvelope {
  const raw =
    process.env.SILLYHUB_DEBUG_RAW_EVENTS === '1' ? { source: 'dsh-acp' } : undefined;
  return raw === undefined ? { events } : { events, raw };
}

/**
 * 平台思考档位 → ACP reasoning_effort 三档本地映射。
 * off → undefined（不携带=引擎默认，claude 矩阵同语义）；ACP 无 minimal/xhigh/max。
 */
export function mapThinkingLevel(platformLevel: string | undefined): string | undefined {
  switch (platformLevel) {
    case undefined:
    case 'off':
      return undefined;
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default:
      return undefined;
  }
}
