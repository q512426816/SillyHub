/**
 * interactive/pi-rpc-driver.ts —— PI rpc driver（`pi --mode rpc` JSONL 长驻子进程）。
 *（2026-09-04-provider-pi-onboarding task-02 / design §5.1 §7 / FR-01 / D-001@v1；
 * 替换 task-04 留下的编译占位。）
 *
 * 职责（task-02 范围 = 通道 + 握手；高级语义归 task-03）：
 *   1. spawn `pi --mode rpc --session-dir <daemon 隔离目录>`（exe 路径经
 *      resolveWindowsCmdShim 解 pi.cmd shim，codex driver 同款 R-exe 先例；
 *      凭证 env 走既有 spawn-env 链——opts.env ?? process.env，不新造注入）。
 *   2. LF 严格分帧（自实现 LfLineFramer，禁 Node readline——readline 会把
 *      U+2028/U+2029 当行分隔，而它们在 JSON 字符串里合法，pi rpc.md 明示）。
 *   3. JSONL 命令收发：pending Map<id,{resolve,reject}> 关联 response；
 *      success:false → reject（上层转 error 事件）；事件型行交 PiEventNormalizer
 *      （task-01）→ envelope{events} 上报 onTurnMessage。
 *   4. get_state 握手：启动后发 get_state 取 data.sessionId → 合成
 *      status/session_started 事件（resume 指针载体，B-03：rpc 模式无 session
 *      首帧）；握手超时/失败 → error 事件上报，不挂死（会话继续可用）。
 *   5. isStreaming 骨架：按事件流 agent_start/agent_settled 维护布尔 +
 *      get_state 初始值同步；streaming 态 prompt 带 streamingBehavior:'steer'
 *      （三模式深化归 task-03）。
 *   6. turn 收敛（基础版）：prompt 响应成功后等 agent_settled（B-05：turn 边界
 *      信号；turn_end 仅 usage 载体）→ onTurnResult；turn 内 error 事件 →
 *      is_error result。子进程非正常退出 → onError 会话级 fail（codex 同款）。
 *
 * task-03 预留接口（本文件已留缝，不改公共契约即可深化）：
 *   - inject 三模式：_buildPromptCommand（当前 = prompt + streaming 态 steer 兜底）；
 *   - interrupt 深化 / ui_request 自动取消 / resume（switch_session/fork）/
 *     agent_settled 收敛细化（usage 聚合口径等）：见 _sendCommand /
 *     _handleLineClosure 的注释锚点。
 *
 * 官方参照：pi 包 docs/rpc.md（分帧:30-37 / get_state:162-190 / 命令面）与
 * dist/modes/rpc/rpc-client.js（id 关联 `req_${n}`、30s 请求超时、exit 时
 * reject pending）+ dist/modes/rpc/jsonl.js（StringDecoder + indexOf('\n') 分帧）。
 *
 * @module interactive/pi-rpc-driver
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { daemonStateDir } from '../config.js';
import type { AgentEvent, AgentEventUsage } from '../types.js';
import { PiEventNormalizer } from './pi-events.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  UserTurnInput,
} from './driver.js';

/** close 时 SIGTERM→SIGKILL 升级宽限（对齐 codex driver KILL_GRACE_MS=2000）。 */
const KILL_GRACE_MS = 2_000;

/** stderr 累积上限（对齐 codex driver STDERR_MAX_BYTES，防内存膨胀）。 */
const STDERR_MAX_BYTES = 20_000;

/**
 * 单条 rpc 命令响应超时（对齐 pi 官方 rpc-client.js send() 的 30000ms——
 * codex driver 无握手超时先例可抄，取官方客户端请求超时值）。
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * get_state 握手超时（同上取官方客户端 30000ms 请求超时；测试经构造函数注入
 * 小值加速）。超时走 error 事件 + 继续（不挂死，见 _handshake）。
 */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * pi 交互会话隔离目录：`<daemonStateDir()>/runs/pi-sessions`。
 *
 * 参照 codex driver 的目录管理先例（codexInteractiveLogDir =
 * `<daemonStateDir()>/runs/codex-interactive`）：daemon 状态目录天然隔离于
 * 宿主用户的 `~/.pi/agent/sessions/`（SILLYHUB_DAEMON_DIR 覆盖时整体重定向），
 * pi 的会话 jsonl 全部落本目录，resume（`--session <id>`）也在本目录内查找。
 * 导出纯函数供测试断言（daemon-state-dir 隔离收口同款锚点）。
 */
export function piRpcSessionDir(): string {
  return join(daemonStateDir(), 'runs', 'pi-sessions');
}

/** executable 缺失/解析失败抛出。code 字段供 daemon / 测试识别。 */
export class PiExecutableNotFoundError extends Error {
  readonly code = 'PI_EXECUTABLE_NOT_FOUND' as const;
  constructor(reason: string) {
    super(`pi executable not found: ${reason} (PI_EXECUTABLE_NOT_FOUND)`);
    this.name = 'PiExecutableNotFoundError';
  }
}

/** rpc 命令收到 success:false 响应（command + error 原文保留）。 */
export class PiCommandError extends Error {
  /** 被拒命令的 type（prompt/steer/get_state/...）。 */
  readonly command: string;
  constructor(command: string, message: string) {
    super(`pi rpc command "${command}" failed: ${message}`);
    this.name = 'PiCommandError';
    this.command = command;
  }
}

// ── LF 严格分帧器（design §5.1：禁 readline，U+2028/29 不切分） ──────────────

/**
 * LF-only JSONL 分帧器（对照官方 dist/modes/rpc/jsonl.js attachJsonlLineReader）。
 *
 * 协议依据（rpc.md:30-37）：记录只按 `\n` 切分；容忍行尾 `\r`（剥掉）；**禁止**
 * 用会按 U+2028/U+2029 切行的通用行读取器（Node readline 不合规——这两个字符在
 * JSON 字符串里合法）。
 *
 * 实现要点：
 *   - StringDecoder 处理跨 chunk 的多字节 UTF-8 边界（半个中文字符不烂）；
 *   - 缓冲区 indexOf('\n') 循环切分（\n 在 UTF-8 中不可能出现在多字节序列内部，
 *     字符串层查找与逐字节扫描等价且更快）；
 *   - end() 冲刷 decoder 尾字节 + 无换行的残行（对齐官方 onEnd 行为）。
 */
export class LfLineFramer {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  /** 喂入一个 chunk（Buffer 或 string）；完整行同步回调 onLine。 */
  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.drain();
  }

  /** 流结束：冲刷多字节尾字节与无换行残行（非空才回调）。 */
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

// ── StartOptions / Handle 契约 ──────────────────────────────────────────────

/**
 * pi 专属启动选项。extends provider-neutral `InteractiveDriverStartOptions`。
 *
 * 与 codex 同源：daemon `_buildDriverOptions` 对所有 provider 填
 * `pathToAgentExecutable: spec.exePath`（session-manager.ts:1692），凭证走
 * `env`（spawn-env 既有链），model/resume 为公共字段。
 */
export interface PiStartOptions extends InteractiveDriverStartOptions {
  /** pi 可执行路径（必需；Windows 下通常为 pi.cmd npm shim）。 */
  pathToAgentExecutable: string;
}

/** pending 命令条目（response 关联用）。 */
export interface PiPendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * pi rpc driver 句柄。extends `InteractiveDriverHandle`。
 *
 * E7：本句柄含子进程资源，不可序列化、禁止落盘。
 */
export interface PiRpcHandle extends InteractiveDriverHandle {
  readonly provider: 'pi';
  /** 底层 spawn 句柄（close/interrupt 操作 stdin）。 */
  readonly child: ChildProcess;
  /** 隔离会话目录（spawn --session-dir 实参）。 */
  readonly sessionDir: string;
  /** get_state 握手后填充（pi session id，resume 指针）；握手失败为 null。 */
  sessionId: string | null;
  /** agent_start/agent_settled 维护的 streaming 态（+ get_state 初始值）。 */
  isStreaming: boolean;
  /** rpc 请求 id 递增序号（`pi_<n>`，对齐官方 `req_<n>` 手法）。 */
  nextRequestId: number;
  /** close 后置 true，拒绝新命令写入。 */
  closing: boolean;
  /** 已发出未应答的命令（response 按 id 关联；exit/close 时全量 reject）。 */
  pending: Map<string, PiPendingRequest>;
  /** 释放底层资源（关 stdin + kill child）。幂等。 */
  close(): Promise<void>;
}

/** UserTurnInput.blocks 的 image 块 → pi rpc ImageContent。 */
function piImagesFromBlocks(
  blocks: UserTurnInput['blocks'],
): Array<{ type: 'image'; data: string; mimeType: string }> {
  if (!blocks || blocks.length === 0) return [];
  const out: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  for (const b of blocks) {
    if (b.type === 'image') {
      out.push({ type: 'image', data: b.base64, mimeType: b.mediaType });
    }
    // document（application/pdf）无 rpc 通道：SessionManager 已把附件路径追加进
    // text（filesToFetch 既有链，即 design §5.1 的文本降级），此处跳过。
  }
  return out;
}

/** 类型守卫：非 null 非数组 plain object。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── PiRpcDriver ─────────────────────────────────────────────────────────────

/**
 * PiRpcDriver：封装 pi rpc 子进程 spawn / LF 分帧 / 命令收发 / get_state 握手
 * / 多轮串行 turn / interrupt / close（implements provider-neutral
 * `InteractiveDriver`，D-001@v1）。
 *
 * 无状态（不持有 child；句柄以 PiRpcHandle 形式由 SessionManager 持有）。
 * 零参可构造（registry createDriver / cli.ts 装配依赖）；测试经构造函数注入
 * 超时/目录加速。
 */
export class PiRpcDriver implements InteractiveDriver {
  /** E5：driver 归属标识（与注册表键 / detector key 一致）。 */
  readonly provider = 'pi' as const;

  private readonly requestTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly sessionDirOverride: string | undefined;

  constructor(
    opts: {
      /** 单条命令响应超时（默认 30s，对齐官方 rpc-client）。 */
      requestTimeoutMs?: number;
      /** get_state 握手超时（默认 30s）。 */
      handshakeTimeoutMs?: number;
      /** session-dir 覆盖（测试注入 tmp 目录，避免写真 daemon 状态目录）。 */
      sessionDir?: string;
    } = {},
  ) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.handshakeTimeoutMs =
      opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.sessionDirOverride = opts.sessionDir;
  }

  /**
   * spawn pi --mode rpc（握手在 consume 内做：需经 onTurnMessage 上报合成的
   * session_started 事件，时机与 codex thread_started 同理）。
   *
   * @throws {PiExecutableNotFoundError} executable 缺失
   */
  async start(
    input: AsyncIterable<UserTurnInput>,
    opts: PiStartOptions,
  ): Promise<PiRpcHandle> {
    // 边界 1：executable 缺失 → 不 spawn。
    if (!opts.pathToAgentExecutable || opts.pathToAgentExecutable.trim() === '') {
      throw new PiExecutableNotFoundError('empty pathToAgentExecutable');
    }

    const sessionDir = this.sessionDirOverride ?? piRpcSessionDir();
    // 目录不存在则建（pi 也会自建，但父目录缺失时 --session-dir 可能静默失效；
    // 建目录失败不阻断 spawn——真不可用时留给 spawn/exit 错误路径收敛）。
    try {
      await mkdir(sessionDir, { recursive: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[pi-rpc-driver] session-dir mkdir failed（继续 spawn，由 pi 自行处理）',
        (e as Error).message,
      );
    }

    // 参数面（rpc.md:7-19 / sessions.md:14）：--mode rpc + --session-dir 隔离；
    // --model 透传（支持 provider/id 模式）；resume 用 --session <path|id>
    // （pi 的 --session-id 是「指定新会话 id」不是 resume——design §5.1 写的
    // "--session-id" 以实读 CLI args.js:64-67 为准修正为 --session）。
    const args: string[] = ['--mode', 'rpc', '--session-dir', sessionDir];
    if (opts.model) args.push('--model', opts.model);
    if (opts.resume) args.push('--session', opts.resume);

    const env = (opts.env ?? { ...process.env }) as NodeJS.ProcessEnv;

    // R-exe（design §10 R-05）：Windows 下 detector 给的是 pi.cmd（npm cmd-shim），
    // 直接 spawn .cmd 无 shell → CreateProcess EINVAL。复用 codex driver 同款
    // resolveWindowsCmdShim（batch task-runner 先例）解析为 node + pi.js；解析
    // 失败回退 shell:true 兜底。非 .cmd（.exe / POSIX）行为不变。
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
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: useShell,
    });

    // 闭包存 start options 供 consume 读（codex 同款，不污染公共契约）。
    const ctx = {
      input,
      model: opts.model,
      resume: opts.resume,
    };

    const handle: PiRpcHandle = {
      provider: 'pi',
      processId: child.pid,
      child,
      sessionDir,
      sessionId: null,
      isStreaming: false,
      nextRequestId: 1,
      closing: false,
      pending: new Map<string, PiPendingRequest>(),
      close: (): Promise<void> => this._close(handle),
      ...({ _ctx: ctx } as object),
    };

    return handle;
  }

  /**
   * 消费 pi rpc 输出流：LF 分帧 → response/事件分流 → get_state 握手 →
   * 多轮串行 turn（prompt → agent_settled → onTurnResult）→ close。
   */
  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const h = handle as PiRpcHandle;
    const ctx = (h as unknown as {
      _ctx: { input: AsyncIterable<UserTurnInput>; model?: string; resume?: string };
    })._ctx;
    const child = h.child;
    const onMessage = callbacks.onTurnMessage;
    const onResult = callbacks.onTurnResult;
    const onError = callbacks.onTurnError;

    const normalizer = new PiEventNormalizer();

    // ── consume 内部状态 ────────────────────────────────────────────────────
    // streaming 态（isStreaming 骨架，task-03 深化）：agent_start/agent_settled
    // 事件维护 + settledWaiters 让 consume 循环阻塞到 turn 收敛。
    // sawAgentEvent：握手期间是否已见过 agent 事件（resume 恢复时 pi 可能正
    // streaming——get_state 的 isStreaming 初始值仅在事件流尚未发言时采信，
    // 防止「握手期间 agent_settled 已到、却被初始值强制拉回 streaming」卡死）。
    let isStreaming = false;
    let sawAgentEvent = false;
    let settledWaiters: Array<() => void> = [];
    const markStreaming = (): void => {
      sawAgentEvent = true;
      isStreaming = true;
      h.isStreaming = true;
    };
    const markSettled = (): void => {
      sawAgentEvent = true;
      isStreaming = false;
      h.isStreaming = false;
      const ws = settledWaiters;
      settledWaiters = [];
      for (const w of ws) w();
    };
    const releaseSettledWaiters = (): void => {
      const ws = settledWaiters;
      settledWaiters = [];
      for (const w of ws) w();
    };
    /**
     * 等 turn 收敛（agent_settled）。已停稳时仍让出一拍再查一次：response 与
     * agent_start 分属两个 stdout chunk 时，等一拍可覆盖绝大多数竞态
     * （基础版启发式；task-03 以 get_state 轮询/事件细化）。
     */
    const waitAgentSettled = async (): Promise<void> => {
      if (isStreaming) {
        await new Promise<void>((r) => settledWaiters.push(r));
        return;
      }
      await new Promise<void>((r) => setImmediate(r));
      if (isStreaming) {
        await new Promise<void>((r) => settledWaiters.push(r));
      }
    };

    // 本轮 turn 的 error/usage 缓存（error 事件 → is_error result；
    // turn_end usage 事件（轮级累计 replace 语义）→ result.usage）。
    let pendingTurnError: string | null = null;
    let turnUsage: AgentEventUsage | undefined;
    // 本轮 turn 是否已上报 result（防 agent_settled 与进程退出双触发重复）。
    let turnReported = false;
    // consume 是否已最终收敛（进程异常退出 / consume 抛错）。
    let finalized = false;
    // stderr 有界累积（诊断载体：exit/握手超时消息附尾部；不作为事件上报——
    // pi 协议面在 stdout，stderr 直发事件会噪声淹没真实 error）。
    let stderrBuf = '';

    const reportTurnResult = (
      r: Parameters<NonNullable<typeof onResult>>[0],
    ): void => {
      if (finalized || turnReported) return;
      turnReported = true;
      Promise.resolve(onResult(r)).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[pi-rpc-driver] onTurnResult callback failed', err);
      });
    };

    /** consume 终态收敛（进程异常退出 / consume 抛错）：error result + 停循环。 */
    const finalizeWithError = (
      r: Parameters<NonNullable<typeof onResult>>[0],
    ): void => {
      if (finalized) return;
      finalized = true;
      turnReported = true;
      Promise.resolve(onResult(r)).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[pi-rpc-driver] onTurnResult callback failed', err);
      });
      releaseSettledWaiters();
      this._rejectAllPending(
        h,
        new Error(r.result !== undefined ? String(r.result) : 'pi rpc consume finalized'),
      );
    };

    /** 上报单条 error AgentEvent（握手失败/命令被拒等 driver 层错误）。 */
    const emitErrorEvent = (
      content: string,
      metadata?: Record<string, unknown>,
    ): void => {
      const ev: AgentEvent = { type: 'error', content };
      if (metadata) ev.metadata = metadata;
      Promise.resolve(onMessage?.({ events: [ev] })).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[pi-rpc-driver] onTurnMessage callback failed', err);
      });
    };

    // ── stderr 累积（有界） ────────────────────────────────────────────────
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        if (h.closing) return;
        stderrBuf += chunk.toString('utf8');
        if (stderrBuf.length > STDERR_MAX_BYTES) {
          stderrBuf = stderrBuf.slice(-STDERR_MAX_BYTES);
        }
      });
    }

    // ── 进程异常退出（codex 同款：turn 级 + 会话级双收敛） ─────────────────
    child.on('error', (err) => {
      if (onError) onError(err);
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: `pi rpc process failed to start: ${(err as Error).message}`,
      });
    });
    child.on('exit', (code, signal) => {
      if (h.closing) return; // 正常 close 触发的 exit
      // 任何非 daemon 主动 close 的退出都视为异常收敛（code=0 干净退出 / 信号杀
      // 同理——consume 主循环无人再喂，等价挂死）。'error'+'exit' 双触发由
      // finalized 守卫幂等吸收。
      const exitDesc =
        code === null
          ? `pi killed by signal ${signal ?? 'unknown'}`
          : `pi exited code=${code}`;
      const stderrTail = stderrBuf.trim().slice(-500);
      const desc = stderrTail
        ? `${exitDesc} (stderr tail: ${stderrTail})`
        : exitDesc;
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: desc,
      });
      // 会话级收敛（daemon H2 同款）：onError → SessionManager fail()，防后续
      // inject 入无人消费的队列、turn 永不结束。
      if (onError) onError(new Error(desc));
    });

    // ── stdout LF 分帧 + 行处理 ────────────────────────────────────────────
    if (!child.stdout) {
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: 'pi rpc stdout missing',
      });
      await h.close();
      return;
    }

    /**
     * 单行处理：response（id 关联 pending）优先；事件型交归一化器；
     * agent_start/agent_settled 在 driver 侧维护 streaming 态（归一化器对
     * 这两类零产出，任务卡明示）。
     *
     * task-03 缝：extension_ui_request（dialog 类）在此分流自动回
     * cancelled:true；resume（switch_session/fork）与 inject 三模式同样在此
     * 扩展，不动分帧/关联骨架。
     */
    const handleLine = (line: string): void => {
      if (h.closing) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // 畸形行不抛（E3 精神：不让行循环崩、turn 可正常收尾；codex D2 同款）
        // eslint-disable-next-line no-console
        console.warn('pi_driver: parse_error', line.slice(0, 100));
        return;
      }
      if (!isRecord(msg) || typeof msg.type !== 'string') return;

      // response：按 id 关联 pending（rpc.md:23-26——事件不带 id，仅 response 带）
      if (msg.type === 'response') {
        const id = msg.id;
        if (typeof id === 'string' && h.pending.has(id)) {
          const pending = h.pending.get(id)!;
          h.pending.delete(id);
          clearTimeout(pending.timer);
          if (msg.success === true) {
            pending.resolve(msg.data);
          } else {
            const errText =
              typeof msg.error === 'string' ? msg.error : 'unknown pi rpc error';
            pending.reject(new PiCommandError(String(msg.command ?? 'unknown'), errText));
          }
        } else {
          // 无 id / 迟到 response（超时后应答等）：warn 丢弃，不进事件流
          // eslint-disable-next-line no-console
          console.warn(
            'pi_driver: unmatched response dropped',
            line.slice(0, 120),
          );
        }
        return;
      }

      // streaming 态维护（driver 侧；归一化器对两类均零产出）
      if (msg.type === 'agent_start') {
        markStreaming();
        return;
      }
      if (msg.type === 'agent_settled') {
        markSettled();
        return;
      }

      // 其余事件 → PiEventNormalizer（含未知事件降级桶，fail-safe 不丢不抛）
      const events = normalizer.normalizeRpcLine(line);
      for (const ev of events) {
        if (ev.type === 'error' && ev.content) {
          pendingTurnError = ev.content;
        }
        if (ev.usage) {
          turnUsage = ev.usage; // 轮级累计 replace 语义（pi-events.ts 口径）
        }
        Promise.resolve(onMessage?.({ events: [ev] })).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[pi-rpc-driver] onTurnMessage callback failed', err);
        });
      }
    };

    const framer = new LfLineFramer(handleLine);
    const onStdoutData = (chunk: Buffer | string): void => {
      framer.push(chunk);
    };
    const onStdoutEnd = (): void => {
      framer.end();
    };
    child.stdout.on('data', onStdoutData);
    child.stdout.on('end', onStdoutEnd);

    try {
      // ── A. get_state 握手（B-03：rpc 无 session 首帧，driver 合成） ──────
      const hs = await this._handshake(h, {
        onTurnMessage: (envelope) => {
          Promise.resolve(onMessage?.(envelope)).catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[pi-rpc-driver] onTurnMessage callback failed', err);
          });
        },
      });
      // isStreaming 初始值同步（事件流未发言时才采信，见 sawAgentEvent 注释）
      if (hs.isStreaming && !sawAgentEvent) {
        isStreaming = true;
        h.isStreaming = true;
      }

      // ── B. 多轮串行（InputQueue 单订阅：迭代器循环外建一次） ─────────────
      const inputIt = ctx.input[Symbol.asyncIterator]();

      while (!h.closing && !finalized) {
        const res = await inputIt.next();
        if (res.done) break;
        const turn = res.value;
        if (h.closing || finalized) break;

        // E1：空文本且无多模态块 → 跳过（队列不校验语义，driver 自行决定）
        if (turn.text === '' && piImagesFromBlocks(turn.blocks).length === 0) {
          continue;
        }

        // 本轮状态重置
        pendingTurnError = null;
        turnUsage = undefined;
        turnReported = false;

        // 基础版注入通道（task-03 深化三模式：steer/follow_up 按
        // UserTurnInput 场景分流；当前 = 非 streaming 直发 prompt，
        // streaming 态兜底 streamingBehavior:'steer' 防被 pi 拒收）
        const cmd: Record<string, unknown> = { type: 'prompt', message: turn.text };
        const images = piImagesFromBlocks(turn.blocks);
        if (images.length > 0) cmd.images = images;
        if (isStreaming) cmd.streamingBehavior = 'steer';

        try {
          await this._sendCommand(h, cmd, this.requestTimeoutMs);
        } catch (err) {
          // 错误响应（success:false / 超时 / 进程亡）→ error 事件 + turn error
          // 收敛（不挂死；rpc.md:76 失败语义只到 response 为止）
          const errMsg = err instanceof Error ? err.message : String(err);
          emitErrorEvent(`pi prompt failed: ${errMsg}`, {
            kind: 'pi_prompt_rejected',
          });
          reportTurnResult({
            subtype: 'error_during_execution',
            is_error: true,
            result: errMsg,
          });
          if (finalized) break;
          continue;
        }

        // turn 收敛：agent_settled（B-05；turn_end 仅 usage 载体）
        await waitAgentSettled();
        if (finalized || h.closing) break;

        if (pendingTurnError !== null) {
          reportTurnResult({
            subtype: 'error_during_execution',
            is_error: true,
            result: pendingTurnError,
            ...(h.sessionId ? { session_id: h.sessionId } : {}),
          });
        } else {
          reportTurnResult({
            subtype: 'success',
            is_error: false,
            ...(h.sessionId ? { session_id: h.sessionId } : {}),
            ...(turnUsage ? { usage: turnUsage } : {}),
          });
        }
      }

      // 让出一拍让已入队但未处理的 stdout 行跑完 handleLine（codex 同款）
      await new Promise<void>((r) => setImmediate(r));
    } catch (err) {
      if (onError) onError(err);
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: `pi consume error: ${(err as Error).message}`,
      });
    } finally {
      releaseSettledWaiters();
      this._rejectAllPending(h, new Error('pi rpc consume ended'));
      try {
        child.stdout.off('data', onStdoutData);
        child.stdout.off('end', onStdoutEnd);
      } catch {
        // 已关闭 / 防御性
      }
      await h.close();
    }
  }

  /**
   * interrupt（FR-03 基础版）：streaming 态发 rpc abort 返回 true；否则 false
   * （无 active turn，契约 no-op 不冒泡 E3）。不等 agent_settled——turn 收敛
   * 由 consume 的 waitAgentSettled 自然结束（task-03 深化取消语义）。
   */
  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (handle === null || handle === undefined) return false;
    const h = handle as PiRpcHandle;
    if (h.closing) return false;
    if (!h.isStreaming) return false;
    const stdin = h.child.stdin;
    if (!stdin || stdin.destroyed) return false;
    // fire-and-forget：abort 应答（success response）由 pending 关联消费掉，
    // 超时/失败由 agent_settled / exit 收敛兜底，不影响 interrupt 返回语义。
    void this._sendCommand(h, { type: 'abort' }, this.requestTimeoutMs).catch(
      () => {
        /* no-op（E3） */
      },
    );
    return true;
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * get_state 握手：取 data.sessionId → handle.sessionId + 合成
   * status/session_started 事件（resume 指针载体）+ isStreaming 初始值回传。
   *
   * 失败/超时语义（任务卡：error 事件不挂死）：上报 error 事件后返回全空
   * 初始态继续——会话仍可跑 prompt，只是缺 resume 指针（resume 深化归
   * task-03）；进程真坏时由 exit handler 收敛。
   */
  private async _handshake(
    h: PiRpcHandle,
    hooks: {
      onTurnMessage: (envelope: { events: AgentEvent[] }) => void | Promise<void>;
    },
  ): Promise<{ sessionId: string | null; isStreaming: boolean }> {
    try {
      const data = await this._sendCommand(
        h,
        { type: 'get_state' },
        this.handshakeTimeoutMs,
      );
      if (!isRecord(data)) {
        throw new Error('get_state response data is not an object');
      }
      const sessionId =
        typeof data.sessionId === 'string' && data.sessionId ? data.sessionId : null;
      if (sessionId) {
        h.sessionId = sessionId;
      }
      const ev: AgentEvent = {
        type: 'status',
        subtype: 'session_started',
        content: '',
        ...(sessionId ? { session_id: sessionId } : {}),
        metadata: { source: 'pi_get_state' },
      };
      await hooks.onTurnMessage({ events: [ev] });
      return { sessionId, isStreaming: data.isStreaming === true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[pi-rpc-driver] get_state handshake failed:', errMsg);
      const ev: AgentEvent = {
        type: 'error',
        content: `pi get_state handshake failed: ${errMsg}`,
        metadata: { kind: 'pi_handshake_failed' },
      };
      await hooks.onTurnMessage({ events: [ev] });
      return { sessionId: null, isStreaming: false };
    }
  }

  /**
   * 发一条 rpc 命令并等 response（id 关联）。
   *
   * @param timeoutMs 本条响应超时（握手用 handshakeTimeoutMs，其余 requestTimeoutMs）
   * @returns response.data（success:true）
   * @throws PiCommandError（success:false）/ 超时 / stdin 不可写
   */
  private _sendCommand(
    h: PiRpcHandle,
    cmd: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const stdin = h.child.stdin;
    if (h.closing || !stdin || stdin.destroyed) {
      return Promise.reject(new Error('pi rpc: stdin unavailable (process closing)'));
    }
    const id = `pi_${h.nextRequestId++}`;
    const cmdType = typeof cmd.type === 'string' ? cmd.type : 'unknown';
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        h.pending.delete(id);
        reject(new Error(`pi rpc "${cmdType}" response timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      timer.unref?.();
      h.pending.set(id, {
        timer,
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this._writeLine(h, JSON.stringify({ ...cmd, id })).then((written) => {
        if (!written) {
          const pending = h.pending.get(id);
          h.pending.delete(id);
          clearTimeout(timer);
          pending?.reject(new Error(`pi rpc "${cmdType}" write failed`));
        }
      });
    });
  }

  /**
   * 安全写一行到 stdin（LF 结尾；带 backpressure + 错误降级）。
   * @returns true=已写入；false=stdin 不可用/写入失败/正在关闭
   */
  private _writeLine(h: PiRpcHandle, line: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const stdin = h.child.stdin;
      if (!stdin || stdin.destroyed || h.closing) {
        resolve(false);
        return;
      }
      let done = false;
      const finish = (ok: boolean): void => {
        if (!done) {
          done = true;
          resolve(ok);
        }
      };
      const ok = stdin.write(line + '\n', (err?: Error | null) => {
        if (err) {
          // 写入失败降级：由命令超时 / exit 检测收敛
          finish(false);
          return;
        }
        finish(true);
      });
      if (!ok) {
        stdin.once('drain', () => finish(true));
      }
    });
  }

  /** 全量 reject pending（close / exit / consume 结束；官方 rpc-client 同款）。 */
  private _rejectAllPending(h: PiRpcHandle, err: Error): void {
    for (const [, pending] of h.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    h.pending.clear();
  }

  /**
   * close（幂等）：closing=true 拒后续写入 → reject pending → stdin.end() →
   * SIGTERM + 2s 后 SIGKILL 升级（codex 同款）。
   */
  private _close(h: PiRpcHandle): Promise<void> {
    if (h.closing) return Promise.resolve();
    h.closing = true;

    this._rejectAllPending(h, new Error('pi rpc handle closed'));

    try {
      const stdin = h.child.stdin;
      if (stdin && !stdin.destroyed) {
        stdin.end();
      }
    } catch {
      // 已关闭
    }

    try {
      h.child.kill('SIGTERM');
    } catch {
      // 已退出
    }

    const killTimer = setTimeout(() => {
      try {
        h.child.kill('SIGKILL');
      } catch {
        // 已退出
      }
    }, KILL_GRACE_MS);
    killTimer.unref?.();

    return Promise.resolve();
  }
}
