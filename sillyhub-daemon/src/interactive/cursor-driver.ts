/**
 * interactive/cursor-driver.ts —— CursorDriver（每轮 respawn cursor-agent + `--resume chatId`）。
 * 2026-09-08-cursor-interactive-session task-04 / design.md L85-97 / L146 / L184 /
 * FR-02 / D-001@v1 / D-003@v2。
 *
 * 生命周期（design.md L85-97）：
 *   start() 只建 handle，不 spawn（每轮 respawn 在 consume 内）。
 *   consume 对 input 单订阅（E4）→ 空文本跳过（E1）→ spawn headless →
 *   stdout LF 分帧（禁 Node readline，pi-rpc-driver LfLineFramer 同款）→
 *   JSON.parse → normalizeCursorFrame（task-03）→ envelope-only onTurnMessage →
 *   result 帧 + 进程退出双确认 → onTurnResult。
 *   后续轮自动追加 `--resume <chatId>`。
 *
 * 启动参数（D-003@v2 定版 + task-01 Free 计划实测）：
 *   `-p --output-format stream-json --trust --force [--resume chatId] --model <model|auto> <prompt>`
 *   prompt 为位置参数，stdin 留空（批量 adapters/stream-json.ts L320-346 同款）。
 *   不加 `--workspace`（CLI 缺省=cwd）；cwd = options.cwd；env = options.env ?? process.env。
 *
 * 忽略的 StartOptions（无对应 CLI 通道，docblock 声明）：
 *   - manualApproval / askUserOnly（permission_dialog=false，D-003@v2）
 *   - mcpServers（CLI 无 per-session --mcp-config，D-008@v1）
 *   - blocks 附件（multimodal=false）
 *
 * E7：handle 含子进程资源，不可序列化、禁止落盘。
 *
 * @module interactive/cursor-driver
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import type { AgentEvent, AgentEventUsage } from '../types.js';
import {
  normalizeCursorFrame,
  type CursorNormalizeCtx,
} from './cursor-events.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  InteractiveDriverStartOptions,
  TurnMessageEnvelope,
  UserTurnInput,
} from './driver.js';

/** close 时 SIGTERM→SIGKILL 升级宽限（pi-rpc-driver.ts L67 / codex 同款）。 */
const KILL_GRACE_MS = 2_000;

/** stderr 累积上限（pi-rpc-driver.ts L70，防内存膨胀；exit 诊断附尾部，不进事件流）。 */
const STDERR_MAX_BYTES = 20_000;

/**
 * model 字符集白名单（批量 stream-json.ts L335 DA-1 同款口径）：
 * 来自 backend 下发的模型标识符，字符集外按配置错误拒绝，防命令行注入。
 */
const MODEL_SAFE_RE = /^[A-Za-z0-9._:\/-]+$/;

/**
 * DA-1 shell 元字符（对齐批量层 task-runner/spawn-stream.ts:180 审计口径）：
 * shell:true 下 Node 不转义任何参数直接拼接命令行，含任一字符即注入/错切面。
 */
const DA1_RISKY_RE = /[&|<>^%"\s]/;

/** create-chat 兜底子命令超时（task-01 验证 C：stdout 裸 UUID 文本）。 */
const DEFAULT_CREATE_CHAT_TIMEOUT_MS = 15_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** InteractiveProvider 尚未含 'cursor'（注册归 task-05）。运行时填 'cursor' 满足 E5。 */
const CURSOR_PROVIDER = 'cursor' as InteractiveDriverHandle['provider'];

const CURSOR_HANDLE_BRAND = Symbol('cursor-driver-handle');

/** executable 缺失/空串抛出。code 供 daemon / 测试识别（codex/pi 同款先例）。 */
export class CursorExecutableNotFoundError extends Error {
  readonly code = 'CURSOR_EXECUTABLE_NOT_FOUND' as const;
  constructor(reason: string) {
    super(`cursor executable not found: ${reason} (CURSOR_EXECUTABLE_NOT_FOUND)`);
    this.name = 'CursorExecutableNotFoundError';
  }
}

/**
 * cursor 专属启动选项（经 CreateSessionInput 传入，值来自 daemon `_agentPaths.get('cursor')`）。
 *
 * 忽略（无对应 CLI 通道，见文件头）：manualApproval / askUserOnly / mcpServers / blocks。
 */
export interface CursorDriverStartOptions extends InteractiveDriverStartOptions {
  /** cursor-agent 可执行入口（.cmd/.ps1/或直 exe；Windows 下经 resolveWindowsCmdShim 解析）。 */
  pathToAgentExecutable: string;
}

/** 单轮 result 帧缓存（等进程退出双确认后再 onTurnResult）。 */
interface TurnResultSnapshot {
  subtype?: string;
  is_error?: boolean;
  usage?: AgentEventUsage;
  session_id?: string;
  result?: unknown;
}

interface CursorHandle extends InteractiveDriverHandle {
  readonly provider: InteractiveDriverHandle['provider'];
  processId: number | undefined;
  close(): Promise<void>;
  readonly [CURSOR_HANDLE_BRAND]: true;
  /** E7：含子进程，禁止序列化/落盘。 */
  child: ChildProcess | null;
  closing: boolean;
  interruptPending: boolean;
  /** 唤醒当前轮 wait（interrupt 置位后立刻收敛，不等 result 帧）。 */
  interruptWait?: () => void;
  input: AsyncIterable<UserTurnInput>;
  options: CursorDriverStartOptions;
  chatId?: string;
  sawFirstTurn: boolean;
  thinkingCtx: CursorNormalizeCtx;
}

function isCursorHandle(handle: InteractiveDriverHandle | null): handle is CursorHandle {
  return handle != null && CURSOR_HANDLE_BRAND in handle;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * LF-only JSONL 分帧器（pi-rpc-driver.ts L231-263 同款；禁 Node readline——
 * readline 会把 U+2028/U+2029 当行分隔，而它们在 JSON 字符串里合法）。
 */
class LfLineFramer {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.drain();
  }

  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer.length > 0) {
      let line = this.buffer;
      this.buffer = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.onLine(line);
    }
  }

  private drain(): void {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) return;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.onLine(line);
    }
  }
}

interface ResolvedSpawn {
  command: string;
  args: string[];
  shell: boolean;
  detached: boolean;
}

/**
 * spawn 前解 Windows shim（ql-20260624-002 EINVAL 已知坑）。
 * - .cmd/.bat → resolveWindowsCmdShim；成功 shell=false + prependArgs 前置；失败回退 shell=true
 * - .ps1 直连：cmd.exe 跑不了 ps1，显式 powershell -NoProfile -ExecutionPolicy Bypass -File
 *   （cmd-shim.ts L74-79 先例，Grill CC-05）
 * - 非 Windows / 直 exe：行为不变；posix 起 detached 进程组供 interrupt 杀组
 */
function resolveSpawnInvocation(exePath: string, args: string[]): ResolvedSpawn {
  const posix = process.platform !== 'win32';
  if (posix) {
    return { command: exePath, args, shell: false, detached: true };
  }
  if (/\.ps1$/i.test(exePath)) {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    return {
      command: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', exePath, ...args],
      shell: false,
      detached: false,
    };
  }
  if (/\.(cmd|bat)$/i.test(exePath)) {
    const resolved = resolveWindowsCmdShim(exePath);
    if (resolved) {
      return {
        command: resolved.exe,
        args: [...resolved.prependArgs, ...args],
        shell: false,
        detached: false,
      };
    }
    // DA-1（ql-20260908-006，对齐批量层 spawn-stream.ts:174-189）：shim 解析失败回退
    // shell:true 时 Node 不转义任何参数——本驱动把用户完整 prompt 作位置参数拼入，
    // 含 shell 元字符即命令注入/参数错切。命中危险字符一律硬失败并给修复指引，
    // 把静默注入变成响亮的配置错误（与批量层同款守卫，勿单侧删除）。
    const risky = args.find((a) => DA1_RISKY_RE.test(a));
    if (risky !== undefined) {
      throw new Error(
        `拒绝以 shell 模式运行「${exePath}」：参数含 shell 元字符（注入/错切风险，DA-1）。` +
          `请把 cursor 包装器换成可被 cmd-shim 解析的 .cmd，或直接指向 .exe；` +
          `问题参数前 40 字符: ${risky.slice(0, 40)}`,
      );
    }
    return { command: exePath, args, shell: true, detached: false };
  }
  return { command: exePath, args, shell: false, detached: false };
}

/**
 * 拼 cursor-agent headless 参数（D-003@v2：恒带 --force --trust；
 * model 缺省追加 --model auto——task-01 实测 Free 计划不带模型报 Named models unavailable）。
 */
function buildTurnArgs(opts: {
  chatId?: string;
  model?: string;
  prompt: string;
}): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--trust', '--force'];
  if (opts.chatId) {
    args.push('--resume', opts.chatId);
  }
  const model = (opts.model ?? '').trim() || 'auto';
  if (!MODEL_SAFE_RE.test(model)) {
    throw new Error(`model 含非法字符，拒绝拼入命令行: ${model.slice(0, 40)}`);
  }
  args.push('--model', model);
  args.push(opts.prompt);
  return args;
}

function debugRawEnabled(): boolean {
  return process.env.SILLYHUB_DEBUG_RAW_EVENTS === '1';
}

/**
 * CursorDriver：implements InteractiveDriver（start / consume / interrupt）。
 *
 * 零参可构造（registry createDriver / cli 装配依赖，注册归 task-05/06）。
 * 无状态：child / chatId / 队列订阅挂在 handle 上（pi/codex 同款）。
 * 测试经构造函数注入 killGraceMs / createChatTimeoutMs。
 */
export class CursorDriver implements InteractiveDriver {
  readonly provider = CURSOR_PROVIDER;

  private readonly killGraceMs: number;
  private readonly createChatTimeoutMs: number;

  constructor(
    opts: {
      killGraceMs?: number;
      createChatTimeoutMs?: number;
    } = {},
  ) {
    this.killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;
    this.createChatTimeoutMs = opts.createChatTimeoutMs ?? DEFAULT_CREATE_CHAT_TIMEOUT_MS;
  }

  /**
   * 启动会话句柄。空 pathToAgentExecutable 抛 CursorExecutableNotFoundError。
   * **不 spawn**——每轮 respawn 在 consume 内（design.md L93 / 任务卡）。
   */
  async start(
    input: AsyncIterable<UserTurnInput>,
    options: CursorDriverStartOptions,
  ): Promise<InteractiveDriverHandle> {
    if (!options.pathToAgentExecutable || options.pathToAgentExecutable.trim() === '') {
      throw new CursorExecutableNotFoundError('empty pathToAgentExecutable');
    }

    const handle: CursorHandle = {
      provider: CURSOR_PROVIDER,
      processId: undefined,
      [CURSOR_HANDLE_BRAND]: true,
      child: null,
      closing: false,
      interruptPending: false,
      input,
      options,
      chatId: options.resume,
      sawFirstTurn: false,
      thinkingCtx: { thinkingSegment: 0 },
      close: (): Promise<void> => this._close(handle),
    };
    return handle;
  }

  /**
   * 消费 input 队列直到自然结束。单订阅（E4：只消费不 mutate/close）。
   * 回调由 SessionManager 提供，不缓存跨 session 复用。
   */
  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    if (!isCursorHandle(handle)) return;
    const iterator = handle.input[Symbol.asyncIterator]();

    try {
      while (!handle.closing) {
        const next = await iterator.next();
        if (next.done) break;
        if (handle.closing) break;
        const turn = next.value;
        if (!turn.text.trim()) continue; // E1：空文本跳过
        await this._runTurn(handle, turn, callbacks);
      }
    } catch (err) {
      try {
        await callbacks.onTurnError?.(err);
      } catch {
        // 上报回调失败不二次抛
      }
    }
  }

  /**
   * turn 级打断（Grill B-02）：有 running child → interruptPending + 杀进程树 →
   * 当前轮 `{subtype:'error_during_execution', is_error:true}` 收敛 → true。
   * 无 child / null / closing → false 不冒泡（E3）。
   */
  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (!isCursorHandle(handle)) return false;
    if (handle.closing) return false;
    if (!handle.child) return false;
    handle.interruptPending = true;
    this._killProcessTree(handle.child, 'force');
    handle.interruptWait?.();
    return true;
  }

  // ── 私有：单轮 spawn / 分帧 / 收敛 ────────────────────────────────────────

  private async _runTurn(
    handle: CursorHandle,
    turn: UserTurnInput,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    handle.interruptPending = false;
    // 对象属性不受 TS 对闭包赋值的 never 收窄（spawn-stream spawnErrorRef 同款）。
    const snapshotRef: { current: TurnResultSnapshot | undefined } = { current: undefined };

    if (handle.sawFirstTurn && !handle.chatId) {
      await this._tryCreateChat(handle);
    }

    let args: string[];
    let resolved: ResolvedSpawn;
    try {
      args = buildTurnArgs({
        chatId: handle.chatId,
        model: handle.options.model,
        prompt: turn.text,
      });
      // DA-1 守卫在此 try 内（shim 失败 + 元字符 → 抛），按轮次错误收敛不杀会话。
      resolved = resolveSpawnInvocation(handle.options.pathToAgentExecutable, args);
    } catch (err) {
      await this._reportError(callbacks, err);
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const env = (handle.options.env ?? process.env) as NodeJS.ProcessEnv;
    const spawnOpts: SpawnOptions = {
      cwd: handle.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: resolved.shell,
      windowsHide: true,
      ...(resolved.detached ? { detached: true } : {}),
    };

    let child: ChildProcess;
    try {
      child = spawn(resolved.command, resolved.args, spawnOpts);
    } catch (err) {
      await this._reportError(callbacks, err);
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    handle.child = child;
    handle.processId = child.pid;
    handle.sawFirstTurn = true;

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stderrBuf += text;
      if (stderrBuf.length > STDERR_MAX_BYTES) {
        stderrBuf = stderrBuf.slice(-STDERR_MAX_BYTES);
      }
    });

    const framer = new LfLineFramer((line) => {
      this._handleStdoutLine(handle, line, callbacks, snapshotRef);
    });
    child.stdout?.on('data', (chunk: Buffer | string) => {
      framer.push(chunk);
    });
    child.stdout?.on('end', () => {
      framer.end();
    });
    child.stdout?.on('error', () => {
      // 流错误走 child 'error' / exit 收敛，不在此抛
    });

    const exitP = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        if (child.exitCode !== null) {
          resolve({ code: child.exitCode, signal: null });
          return;
        }
        child.once('exit', (code, signal) => {
          resolve({ code, signal });
        });
      },
    );
    const errorP = new Promise<Error>((resolve) => {
      child.once('error', (err: Error) => resolve(err));
    });
    const interruptP = new Promise<'interrupt'>((resolve) => {
      handle.interruptWait = () => resolve('interrupt');
    });

    type Outcome =
      | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
      | { kind: 'error'; err: Error }
      | { kind: 'interrupt' };

    let outcome: Outcome;
    try {
      outcome = await Promise.race([
        exitP.then((e): Outcome => ({ kind: 'exit', ...e })),
        errorP.then((err): Outcome => ({ kind: 'error', err })),
        interruptP.then((): Outcome => ({ kind: 'interrupt' })),
      ]);
    } finally {
      handle.interruptWait = undefined;
    }

    if (outcome.kind === 'interrupt' || handle.interruptPending) {
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
      });
      await Promise.race([
        exitP,
        new Promise<void>((r) => setTimeout(r, this.killGraceMs)),
      ]);
      this._clearChild(handle);
      return;
    }

    if (outcome.kind === 'error') {
      await this._reportError(callbacks, outcome.err);
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: outcome.err.message,
      });
      this._clearChild(handle);
      return;
    }

    const snap = snapshotRef.current;
    const exitCode = outcome.code ?? 1;
    if (snap) {
      const isError = exitCode !== 0 || snap.is_error === true;
      callbacks.onTurnResult({
        subtype: isError ? (snap.subtype ?? 'error_during_execution') : (snap.subtype ?? 'success'),
        is_error: isError,
        usage: snap.usage,
        session_id: snap.session_id ?? handle.chatId,
        result: snap.result,
      });
    } else if (exitCode !== 0) {
      callbacks.onTurnResult({
        subtype: 'error_during_execution',
        is_error: true,
        result: stderrBuf ? stderrBuf.slice(-2000) : `cursor-agent exit ${exitCode}`,
      });
    } else {
      callbacks.onTurnResult({
        subtype: 'success',
        is_error: false,
        session_id: handle.chatId,
      });
    }

    this._clearChild(handle);
  }

  private _handleStdoutLine(
    handle: CursorHandle,
    line: string,
    callbacks: InteractiveDriverCallbacks,
    snapshotRef: { current: TurnResultSnapshot | undefined },
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[cursor-driver] drop malformed JSON line');
      return;
    }

    if (isRecord(parsed) && typeof parsed.session_id === 'string' && parsed.session_id) {
      handle.chatId = parsed.session_id;
    }

    const events: AgentEvent[] = normalizeCursorFrame(parsed, handle.thinkingCtx);
    if (isRecord(parsed) && parsed.type === 'result') {
      const turnResult = events.find((e) => e.type === 'turn_result');
      snapshotRef.current = {
        subtype: typeof parsed.subtype === 'string' ? parsed.subtype : undefined,
        is_error: typeof parsed.is_error === 'boolean' ? parsed.is_error : undefined,
        usage: turnResult?.usage,
        session_id:
          (typeof parsed.session_id === 'string' ? parsed.session_id : undefined)
          ?? turnResult?.session_id
          ?? handle.chatId,
        result: parsed.result,
      };
    }

    const rawOn = debugRawEnabled();
    if (callbacks.onTurnMessage && (events.length > 0 || rawOn)) {
      const envelope: TurnMessageEnvelope = rawOn
        ? { events, raw: parsed }
        : { events };
      try {
        const ret = callbacks.onTurnMessage(envelope);
        if (ret && typeof (ret as Promise<void>).then === 'function') {
          void (ret as Promise<void>).catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[cursor-driver] onTurnMessage callback failed', err);
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[cursor-driver] onTurnMessage callback failed', err);
      }
    }
  }

  /**
   * create-chat 兜底（task-01 验证 C）：stdout 为裸 UUID 文本非 JSON，按行 trim 解析。
   * 失败不阻断当轮（无 --resume 仍可跑，只是失去多轮记忆）。
   */
  private async _tryCreateChat(handle: CursorHandle): Promise<void> {
    const args = ['create-chat'];
    const resolved = resolveSpawnInvocation(handle.options.pathToAgentExecutable, args);
    const env = (handle.options.env ?? process.env) as NodeJS.ProcessEnv;
    let child: ChildProcess;
    try {
      child = spawn(resolved.command, resolved.args, {
        cwd: handle.options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: resolved.shell,
        windowsHide: true,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cursor-driver] create-chat spawn failed', err);
      return;
    }

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, this.createChatTimeoutMs).unref?.();
    });
    await Promise.race([exited, timeout]);
    if (child.exitCode === null && !child.killed) {
      this._killProcessTree(child, 'force');
    }

    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (UUID_RE.test(line)) {
        handle.chatId = line;
        return;
      }
    }
  }

  private async _reportError(
    callbacks: InteractiveDriverCallbacks,
    err: unknown,
  ): Promise<void> {
    try {
      await callbacks.onTurnError?.(err);
    } catch {
      // 上报失败不吞原始语义：已经试图通知
    }
  }

  private _clearChild(handle: CursorHandle): void {
    handle.child = null;
    handle.processId = undefined;
    handle.interruptPending = false;
  }

  /**
   * 杀进程树。Windows：`taskkill /PID <pid> /T /F`（D-004 只许 /PID 定点）。
   * posix：spawn 时 detached 进程组，`process.kill(-pid)` 杀组；失败回退 child.kill。
   */
  private _killProcessTree(child: ChildProcess, mode: 'force' | 'term'): void {
    const pid = child.pid;
    if (typeof pid !== 'number') {
      try {
        child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // 已退出
      }
      return;
    }
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => {});
      } else {
        try {
          process.kill(-pid, mode === 'force' ? 'SIGKILL' : 'SIGTERM');
        } catch {
          try {
            child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM');
          } catch {
            // 已退出
          }
        }
      }
    } catch {
      try {
        child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // 已退出
      }
    }
  }

  /**
   * close 幂等：kill child + 清理。不动 input 队列（E4）。
   * Windows 走 taskkill；posix SIGTERM → 宽限 → SIGKILL。
   */
  private _close(handle: CursorHandle): Promise<void> {
    if (handle.closing) return Promise.resolve();
    handle.closing = true;
    const child = handle.child;
    if (!child) return Promise.resolve();

    if (process.platform === 'win32') {
      this._killProcessTree(child, 'force');
    } else {
      this._killProcessTree(child, 'term');
      const killTimer = setTimeout(() => {
        this._killProcessTree(child, 'force');
      }, this.killGraceMs);
      killTimer.unref?.();
    }
    handle.interruptWait?.();
    this._clearChild(handle);
    return Promise.resolve();
  }
}
