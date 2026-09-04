/**
 * interactive/pi-rpc-driver.ts —— PI rpc driver（`pi --mode rpc` JSONL 长驻子进程）。
 *（2026-09-04-provider-pi-onboarding task-02（通道+握手）+ task-03（高级语义）/
 * design §5.1 §7 / FR-01 / D-001@v1。）
 *
 * 职责汇总（task-02 通道骨架 + task-03 高级语义）：
 *   1. spawn `pi --mode rpc --session-dir <daemon 隔离目录>`（exe 路径经
 *      resolveWindowsCmdShim 解 pi.cmd shim，codex driver 同款 R-exe 先例；
 *      凭证 env 走既有 spawn-env 链——opts.env ?? process.env，不新造注入）。
 *      resume = spawn 旗标 `--session <path|id>`（CreateSessionInput.resume →
 *      spec.resume → driverOpts.resume 既有链，session-manager.ts:1708-1709）。
 *   2. LF 严格分帧（自实现 LfLineFramer，禁 Node readline——readline 会把
 *      U+2028/U+2029 当行分隔，而它们在 JSON 字符串里合法，pi rpc.md 明示）。
 *   3. JSONL 命令收发：pending Map<id,{resolve,reject}> 关联 response；
 *      success:false → reject（上层转 error 事件）；事件型行交 PiEventNormalizer
 *      （task-01）→ envelope{events} 上报 onTurnMessage。
 *   4. get_state 握手：启动后发 get_state 取 data.sessionId → 合成
 *      status/session_started 事件（resume 指针载体，B-03：rpc 模式无 session
 *      首帧）；握手超时/失败 → error 事件上报，不挂死（会话继续可用）。
 *   5. inject 三模式（task-03）：非 streaming → `prompt`；streaming → `steer`
 *      （默认，UserTurnInput 无模式字段——steer 语义即「streaming 中注入」）；
 *      被拒时按 pi 错误文案单次降级重试（prompt↔steer / steer→follow_up，
 *      见 _sendInject）；重试仍拒 → error 事件上报不抛崩（含 command 名）。
 *   6. turn 收敛（task-03 细化）：以事件流 agent_settled 为准（B-05：turn 边界
 *      信号，含 steer/followUp 队列清空；turn_end 仅 usage 载体）；response 与
 *      agent_start 跨 chunk 的竞态用「事件计数 + get_state 复核一次」补强
 *      （waitAgentSettled）。turn 内 error 事件 → is_error result。子进程非正常
 *      退出 → onError 会话级 fail（codex 同款）。
 *   7. extension_ui_request（task-03）：dialog 类（select/confirm/input/editor，
 *      阻塞至应答）自动回 cancelled:true（permission_dialog=false 不死锁，
 *      B-05）；fire-and-forget 类 warn 降级不回话；同步分流不阻塞事件流。
 *   8. interrupt（task-03）：rpc abort 并等 response——成功 true / 失败或超时
 *      false；abort 后 pi 在 run 收尾发 agent_settled（agent-session.js:744-756
 *      _emitAgentSettled 在 finally 必发）→ waiter 自然释放、turn 正常收敛。
 *
 * 官方参照：pi 包 docs/rpc.md（分帧:30-37 / prompt:43-78 / steer:80-100 /
 * follow_up:102-122 / abort:124-135 / get_state:162-190 / extension UI 子协议
 * :1126-1335）与 dist/modes/rpc/rpc-client.js（id 关联 `req_${n}`、30s 请求超时、
 * waitForIdle=等 agent_settled 事件:356-370、exit 时 reject pending）+
 * dist/modes/rpc/rpc-mode.js（服务端命令分发/extension_ui_response 按 id 关联）
 * + dist/core/agent-session.js（isStreaming=_isAgentRunActive:745 /
 * _emitAgentSettled 在 _runAgentPrompt finally:744-756 / streaming 拒收文案:830）
 * + dist/modes/rpc/jsonl.js（StringDecoder + indexOf('\n') 分帧）。
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
 * extension_ui_request 的 dialog 类方法（rpc.md:1130-1133 / 1152-1217）：
 * emit 后**阻塞至客户端回 extension_ui_response**（按 id 关联，rpc-mode.js:596-608
 * pendingExtensionRequests）。
 *
 * permission_dialog=false（design §5.3 如实标记）下 driver 统一自动回
 * cancelled:true（rpc.md:1310-1315 取消应答形状）——不答会死锁 agent run
 * （dialog 类在 pi 侧是 await 的 Promise；仅带 timeout 字段的 dialog 有
 * agent 侧自动兜底，rpc.md:1135，不能依赖）。
 */
const EXTENSION_UI_DIALOG_METHODS: ReadonlySet<string> = new Set([
  'select',
  'confirm',
  'input',
  'editor',
]);

/**
 * extension_ui_request 的 fire-and-forget 类方法（rpc.md:1133 / 1219-1292）：
 * emit 后不等待应答（pi 侧不进 pendingExtensionRequests），客户端可展示可忽略。
 * driver 无 TUI 渲染面 → warn 降级，不回话（回话也会被 pi 按 id 无主丢弃，
 * 但按协议本就无应答更干净）。
 */
const EXTENSION_UI_FIRE_AND_FORGET_METHODS: ReadonlySet<string> = new Set([
  'notify',
  'setStatus',
  'setWidget',
  'setTitle',
  'set_editor_text',
]);

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

/** pi rpc 注入载荷：message（文本 + document 降级注记）+ images（ImageContent）。 */
interface PiInjectPayload {
  message: string;
  images: Array<{ type: 'image'; data: string; mimeType: string }>;
}

/**
 * UserTurnInput → pi rpc 注入载荷（prompt/steer/follow_up 三命令共用形状，
 * rpc.md:47-53 / 86-93 / 108-115 的 message+images 字段面完全一致）。
 *
 * - image 块 → images[{type:'image', data, mimeType}]（pi ImageContent，
 *   design §5.1 multimodal 原生通道）；
 * - document 块（application/pdf）→ pi rpc 无 document 通道 → **文本降级注明**
 *   （design §5.1：无通道则降级；任务卡 implementation 同款）。注：块投递的
 *   document 不走 SessionManager 的落盘清单链（session-manager.ts:2924-2961
 *   仅 deliver='disk' 附件往 text 追加路径，deliver='block' 的 PDF 只进 blocks），
 *   若此处静默跳过则内容彻底丢失——必须留注记让模型/用户知晓未投递。
 */
function buildPiInjectPayload(turn: UserTurnInput): PiInjectPayload {
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  const docNotes: string[] = [];
  for (const b of turn.blocks ?? []) {
    if (b.type === 'image') {
      images.push({ type: 'image', data: b.base64, mimeType: b.mediaType });
    } else {
      docNotes.push(
        `（已收到 ${b.mediaType} document 附件，但 pi rpc 通道不支持 document 内容投递，原文未送达模型）`,
      );
    }
  }
  const note = docNotes.length > 0 ? docNotes.join('\n') : '';
  const message =
    turn.text === '' ? note : note === '' ? turn.text : `${turn.text}\n${note}`;
  return { message, images };
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
    // "--session-id" 以实读 CLI args.js:64-67 为准修正为 --session，
    // args.js:235 帮助文案「Use specific session file or partial UUID」确认
    // 语义；id 在 --session-dir 隔离目录内查找）。
    //
    // resume 链路（task-03 实读验证，契约完整无需改消费侧）：
    //   CreateSessionInput.resume（daemon.ts 从 execPayload 归一化）→
    //   _buildDriverOptions spec.resume → driverOpts.resume
    //   （session-manager.ts:1509-1516）→ 本处 spawn 旗标；
    //   daemon 重启恢复路径 record.agentSessionId → 同链
    //   （session-manager.ts:3783）。agentSessionId 存 pi get_state 的
    //   sessionId（_handshake 回填 handle.sessionId → SessionManager 既有
    //   session_started 事件消费链落库）。
    //   对照：codex 无 spawn 旗标 resume，spawn 后发 thread/resume
    //   （codex-app-server-driver.ts:1174-1180）；pi 有旗标则一步到位。
    //   switch_session/fork（rpc 运行时会话切换命令，rpc.md:595-639）本变更
    //   不接——平台的会话级 resume 用 spawn 旗标已覆盖，无「运行中换会话」
    //   需求场景（SessionManager 的 resume 走 create-with-resume 重建进程）。
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
    // streaming 态（isStreaming 双镜像——闭包 + handle.isStreaming 供 interrupt
    // 路由读）：agent_start/agent_settled 事件维护 + settledWaiters 让 consume
    // 循环阻塞到 turn 收敛。sawAgentEvent：握手期间是否已见过 agent 事件（resume
    // 恢复时 pi 可能正 streaming——get_state 的 isStreaming 初始值仅在事件流尚未
    // 发言时采信，防止「握手期间 agent_settled 已到、却被初始值强制拉回
    // streaming」卡死）。
    let isStreaming = false;
    let sawAgentEvent = false;
    // agent_start/agent_settled 事件计数（task-03「事件计数法」）：waitAgentSettled
    // 的 get_state 复核期间事件流是否发言的判定依据（见 waitAgentSettled）。
    let agentEventSeq = 0;
    // 本轮 turn 是否已见过 agent 运行事件（start/settled 任一）：区分
    // 「run 已完整观察完」（无需复核）与「run 尚未开始」（需 get_state 复核）。
    let turnSawRun = false;
    let settledWaiters: Array<() => void> = [];
    const markStreaming = (): void => {
      sawAgentEvent = true;
      turnSawRun = true;
      agentEventSeq++;
      isStreaming = true;
      h.isStreaming = true;
    };
    const markSettled = (): void => {
      sawAgentEvent = true;
      turnSawRun = true;
      agentEventSeq++;
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
    const settleWaiter = (): Promise<void> =>
      new Promise<void>((r) => settledWaiters.push(r));
    /**
     * 等 turn 收敛（agent_settled，B-05 turn 边界；对照官方 rpc-client.js
     * waitForIdle:356-370——官方在发 prompt **前**订阅事件流规避竞态，我们的
     * consume 循环在 response 后才等，需自行补窗）。
     *
     * 三级收敛（task-03 细化，覆盖 response 与 agent_start 跨 stdout chunk 的
     * 竞态——服务端时序：prompt response 经 preflightResult 回调先写
     * （rpc-mode.js:301-318），_runAgentPrompt 随后置 _isAgentRunActive=true
     * （agent-session.js:744-745，与 response 写出之间无 await），agent_start
     * 事件再晚若干 chunk 落地）：
     *   1. isStreaming 已 true（agent_start 已见）→ 等 settled waiter；
     *   2. 让一拍 setImmediate（同 chunk / 近邻 chunk 的 agent_start 覆盖）；
     *   3. 本轮已见过 run 事件且已 settled（turnSawRun）→ run 完整观察过，
     *      直接收敛（extension command 等无 run 场景也走复核分支区分）；
     *   4. 复核一次 get_state：data.isStreaming 是服务端真值
     *      （rpc-mode.js:347 直读 session.isStreaming）。事件计数守卫：复核
     *      往返期间事件流若发言（agentEventSeq 变化）则只信事件流——防
     *      「get_state 应答 isStreaming=true 之后、应答行落盘前 run 恰好
     *      settled」的过期数据把 waiter 挂死（该场景 settled 行随后必到，
     *      本地 isStreaming 已回落，直接收敛即可）。
     *
     * 复核失败（超时/进程亡）→ 退化为直接收敛：挂死风险由 exit handler /
     * pending reject / interrupt 兜底；_emitAgentSettled 在 _runAgentPrompt
     * 的 finally 必发（agent-session.js:744-756），等 waiter 的路径有界。
     */
    const waitAgentSettled = async (): Promise<void> => {
      if (isStreaming) {
        await settleWaiter();
        return;
      }
      await new Promise<void>((r) => setImmediate(r));
      if (isStreaming) {
        await settleWaiter();
        return;
      }
      if (turnSawRun) {
        // 本轮 run 已被事件流完整观察（start+settled 均已处理）——不再复核。
        return;
      }
      try {
        const seqBefore = agentEventSeq;
        const data = await this._sendCommand(
          h,
          { type: 'get_state' },
          this.requestTimeoutMs,
        );
        if (agentEventSeq !== seqBefore) {
          // 复核往返期间事件流已发言：data 可能过期，只信事件流本地态。
          if (isStreaming) await settleWaiter();
          return;
        }
        if (isRecord(data) && data.isStreaming === true) {
          // 服务端真值：run 已开跑但 agent_start 事件未达——按 streaming 收敛。
          markStreaming();
          await settleWaiter();
        }
      } catch {
        /* 复核失败退化为直接收敛（见上） */
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
     * 单行处理：response（id 关联 pending）优先；extension_ui_request 分流
     * （task-03，rpc.md:1126-1335 子协议）；事件型交归一化器；
     * agent_start/agent_settled 在 driver 侧维护 streaming 态（归一化器对
     * 这两类零产出，任务卡明示）。
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

      // extension_ui_request 分流（task-03，B-05）：pi extension 的 UI 子协议，
      // **不是** AgentSessionEvent（不带 run 语义，不进归一化器——归一化器会
      // 落未知事件降级桶污染事件流）。同步分流 + 异步写应答，不阻塞事件流。
      if (msg.type === 'extension_ui_request') {
        const method = typeof msg.method === 'string' ? msg.method : '';
        const uiId = typeof msg.id === 'string' ? msg.id : '';
        if (EXTENSION_UI_FIRE_AND_FORGET_METHODS.has(method)) {
          // notify/setStatus/setWidget/setTitle/set_editor_text：无应答期望，
          // warn 降级（driver 无 TUI 渲染面）。
          // eslint-disable-next-line no-console
          console.warn(
            `pi_driver: extension_ui_request(${method}) degraded (fire-and-forget UI)`,
            line.slice(0, 120),
          );
        } else if (uiId !== '') {
          // dialog 类（select/confirm/input/editor）+ 未知 method 防御性同路：
          // 回 cancelled:true（rpc.md:1310-1315）。已知 dialog warn 记录自动取消
          // （可见性）；未知 method 若实为 fire-and-forget，pi 侧按 id 无主应答
          // 静默丢弃（rpc-mode.js:601-607）无副作用；若实为 dialog 则避免死锁。
          if (!EXTENSION_UI_DIALOG_METHODS.has(method)) {
            // eslint-disable-next-line no-console
            console.warn(
              `pi_driver: unknown extension_ui_request method "${method}" treated as dialog (auto-cancelled)`,
            );
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              `pi_driver: extension_ui_request dialog "${method}" auto-cancelled (permission_dialog=false)`,
            );
          }
          void this._writeLine(
            h,
            JSON.stringify({
              type: 'extension_ui_response',
              id: uiId,
              cancelled: true,
            }),
          );
        } else {
          // 无 id 的畸形请求无法应答：warn（pi 侧 dialog 自带 timeout 的有
          // agent 端兜底，rpc.md:1135）。
          // eslint-disable-next-line no-console
          console.warn(
            'pi_driver: extension_ui_request without id dropped',
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

        // E1：空载荷（无文本、无 image、无 document 注记）→ 跳过（队列不校验
        // 语义，driver 自行决定）
        const payload = buildPiInjectPayload(turn);
        if (payload.message === '' && payload.images.length === 0) {
          continue;
        }

        // 本轮状态重置
        pendingTurnError = null;
        turnUsage = undefined;
        turnReported = false;
        turnSawRun = false;

        // inject 三模式（task-03）：非 streaming → prompt；streaming → steer
        //（默认——UserTurnInput 无模式字段，steer 语义即「streaming 中注入」；
        // 被拒按 pi 错误文案单次降级，见 _sendInject）
        try {
          await this._sendInject(h, payload, isStreaming);
        } catch (err) {
          // 命令被拒（PiCommandError success:false / 超时 / 进程亡）→ error 事件
          // 上报 + turn error 收敛（不挂死不抛崩；含被拒命令名，rpc.md:76 失败
          // 语义只到 response 为止）
          const errMsg = err instanceof Error ? err.message : String(err);
          emitErrorEvent(`pi inject failed: ${errMsg}`, {
            kind: 'pi_command_rejected',
            ...(err instanceof PiCommandError ? { command: err.command } : {}),
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
   * interrupt（task-03 深化）：streaming 态发 rpc abort 并**等 response**——
   * success:true → true（abort 命令被 pi 接受，rpc.md:124-135）；被拒/超时/
   * 进程亡 → false。非 streaming / 已 closing → false（无 active turn，契约
   * no-op 不冒泡 E3）。
   *
   * abort 后的 turn 收敛：pi 在 run 收尾必发 agent_settled（agent-session.js
   * :744-756 _emitAgentSettled 在 _runAgentPrompt finally）→ consume 的
   * settledWaiters 自然释放、onTurnResult 正常上报（abort 语义的流层表现是
   * message_update ame.error reason='aborted' → 归一化器产 error 事件）。
   */
  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (handle === null || handle === undefined) return false;
    const h = handle as PiRpcHandle;
    if (h.closing) return false;
    if (!h.isStreaming) return false;
    const stdin = h.child.stdin;
    if (!stdin || stdin.destroyed) return false;
    try {
      await this._sendCommand(h, { type: 'abort' }, this.requestTimeoutMs);
      return true;
    } catch {
      // abort 应答失败/超时：不重试不打断调用方——turn 收敛由 settled 事件 /
      // exit handler 兜底（若 abort 实际生效，settled 仍会到达）。
      return false;
    }
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
   * inject 三模式主通道（task-03，design §5.1）：
   *   - 非 streaming → `prompt`（rpc.md:43-78，不带 streamingBehavior）；
   *   - streaming → `steer`（默认，rpc.md:80-100——UserTurnInput 无模式字段，
   *     「streaming 中注入」即 steer 语义：当前 assistant turn 工具批完成后、
   *     下一次 LLM 调用前投递）。
   *   （`follow_up` 不作首选：等 agent 完全停稳才投递，交互体验劣于 steer；
   *     仅作 pi 拒 steer 且提示 followUp 时的单次降级。）
   *
   * 降级重试（各至多一次，锚定 pi 实测错误文案）：
   *   - prompt 被拒且文案含「already processing / streamingBehavior」→ 重试
   *     steer：isStreaming 镜像滞后的竞态（agent-session.js:829-831 的拒收
   *     文案原文「Agent is already processing. Specify streamingBehavior
   *     ('steer' or 'followUp') to queue the message.」）；
   *   - steer 被拒且文案含「followUp」→ 重试 follow_up（防御未来 pi 版本
   *     拒 steer 的提示语义）；
   *   - steer 被拒且文案含「cannot be queued / Use prompt()」→ 重试 prompt：
   *     extension command（`/cmd` 文本）不可排队（agent-session.js
   *     _throwIfExtensionCommand），但 prompt 对 extension command 即使
   *     streaming 中也立即执行（rpc.md:67），重试必达。
   *
   * @throws 最后一次尝试的 PiCommandError / 超时 / 进程亡（上层转 error 事件）
   */
  private async _sendInject(
    h: PiRpcHandle,
    payload: PiInjectPayload,
    streaming: boolean,
  ): Promise<void> {
    const first: Record<string, unknown> = streaming
      ? { type: 'steer', message: payload.message }
      : { type: 'prompt', message: payload.message };
    if (payload.images.length > 0) first.images = payload.images;
    try {
      await this._sendCommand(h, first, this.requestTimeoutMs);
      return;
    } catch (err) {
      if (!(err instanceof PiCommandError)) throw err;
      const fallback = this._fallbackCommandFor(streaming, err.message, payload);
      if (!fallback) throw err;
      await this._sendCommand(h, fallback, this.requestTimeoutMs);
    }
  }

  /**
   * 被拒命令的降级选择（_sendInject 注释锚定的三条文案规则）。
   * @returns 降级命令（无降级路径返回 null）
   */
  private _fallbackCommandFor(
    streaming: boolean,
    errMessage: string,
    payload: PiInjectPayload,
  ): Record<string, unknown> | null {
    const base = (type: string): Record<string, unknown> => {
      const cmd: Record<string, unknown> = { type, message: payload.message };
      if (payload.images.length > 0) cmd.images = payload.images;
      return cmd;
    };
    if (!streaming && /already processing|streamingbehavior/i.test(errMessage)) {
      return base('steer');
    }
    if (streaming) {
      if (/follow\s*up/i.test(errMessage)) return base('follow_up');
      if (/cannot be queued|use prompt\(\)/i.test(errMessage)) {
        // extension command：prompt 通道立即执行（rpc.md:67），不带
        // streamingBehavior（该字段仅对普通文本排队有意义，带上反成噪声）。
        return base('prompt');
      }
    }
    return null;
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
