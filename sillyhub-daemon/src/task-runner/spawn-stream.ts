/**
 * task-runner/spawn-stream.ts —— spawn + stdout 流式解析 + stdin 控制簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 TaskRunner 的
 * _spawnAndStream（约 435 行）与 _handleLine（约 220 行）方法体原样下沉为本
 * 模块函数（仅 ``this`` → ``runner`` 显式传参，行为零变化）；facade 类内保留
 * 同名私有方法一行委托。``runner`` 即 runner-types.ts 的 TaskRunnerCore
 * 类型桥（对齐 task-02 SessionManagerCore 先例）。
 *
 * @module task-runner/spawn-stream
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import {
  createTerminalObserver,
  NOOP_TERMINAL_OBSERVER,
  type TerminalObserver,
} from '../terminal-observer.js';
import type { ProtocolAdapter } from '../adapters/protocol-adapter.js';
import type { Envelope } from '../resilience/service.js';
import { dedupKeyFor, toCauseInfo } from '../resilience/error-classify.js';
import type { AgentEvent, LeaseCtx } from '../types.js';
import type {
  SpawnOpts,
  TaskRunnerCore,
} from './runner-types.js';
import { KILL_GRACE_MS, MAX_ERROR, MAX_STDERR_FORWARD } from './runner-types.js';
import {
  attachBatchModelStats,
  mergeAdapterUsage,
  resolveTimeout,
  type SpawnAttemptResult,
} from './skill-prompt.js';
import {
  _extractSessionId,
  _looksLikeControlRequest,
  _looksLikeResult,
  _looksLikeTurnCompleted,
  echoTaskBoundary,
  renderAgentEvent,
  renderTaskBoundary,
} from './render.js';

// ── 步骤 6-7：spawn + 流式 stdout 解析 + stdin 控制 ───────────────────────

/** task-03：原 _spawnAndStream 私有方法的 params 对象类型（搬移零改写）。 */
export interface SpawnStreamParams {
  cmdPath: string;
  args: string[];
  opts: SpawnOpts;
  adapter: ProtocolAdapter;
  prompt: string;
  ctx: LeaseCtx;
  signal: AbortSignal;
  outputParts: string[];
  onSessionId: (sid: string) => void;
  leaseId: string;
  claimToken: string;
  /**
   * task-08（D-006 / D-009）：stats 观察回调（每条 complete 事件 metadata.stats 触发，
   * 同步调用，**不**阻塞 readline）。runLease 用于 budget 累计 + 软切断检查点。
   * undefined / 未传 → 无外部观察（lastStats 仍内部更新，零回归）。
   */
  onStats?: (stats: Record<string, unknown>) => void;
}

/**
 * spawn 子进程，逐行读 stdout，写 prompt 到 stdin，处理 control_request。
 *
 * 对齐 Python `StreamJsonBackend.execute`（backends/stream_json.py:34-172）+
 * `_consume_stdout`（174-204）+ `_handle_control_request`（206-246）。
 *
 * R-03（stdin 控制）：
 *   - 写完 prompt 后 stdin 不立即 end；
 *   - stdout 行命中 control_request → adapter.onControl(line, stdin) 写回应答；
 *   - result 行（或 exit）后才 stdin.end。
 *
 * R-04（背压）：readline.createInterface + for await...of 自带背压。
 *
 * 超时（B-19-07）：setTimeout → SIGTERM → 2s 后 SIGKILL。
 *
 * 取消（B-19-06）：AbortSignal.aborted → SIGTERM → 同样优雅升级。
 */
export async function spawnAndStream(
  runner: TaskRunnerCore,
  params: SpawnStreamParams,
): Promise<SpawnAttemptResult> {
  const {
    cmdPath, args, opts, adapter, prompt, ctx, signal,
    outputParts, onSessionId, leaseId, claimToken,
  } = params;
  // task-08：把外部 stats 观察回调解构出来（runLease 用于 budget 软切断检查点）。
  const externalOnStats = params.onStats;

  // ql-20260616-003：创建终端观察日志（写文件 + 可选弹独立终端）。
  // 关键设计：observer 创建是异步的（mkdir + writeFile），但**绝不**在 spawn 之前
  // 阻塞 —— 否则会让旧测试的「spawn 后单 setImmediate 等 listener 注册」断言失效
  // （实际生产无影响，仅是测试时序脆弱性）。改为 fire-and-forget：
  //   1. spawn 同步发生（spawn 必须先返回才能注册 listener）
  //   2. observer promise 在后台创建，就绪后用 .then 替换 NOOP
  //   3. 中间几条早期 stdout/stderr 可能丢（observer 仍是 NOOP 时 writeRaw 是 no-op）
  //      —— 这是可接受的权衡：观察日志是辅助功能，绝不能改变 spawn 时序
  let observer: TerminalObserver = NOOP_TERMINAL_OBSERVER;
  createTerminalObserver({
    leaseId,
    cwd: opts.cwd,
    cmdPath,
    args,
    config: runner.config,
  })
    .then((obs) => {
      observer = obs;
    })
    .catch((e) => {
      console.warn('task_runner: observer_create_failed', e);
    });

  // 本地终端 echo + observer：开始边界，让用户看到 spawn 命令
  // observer 此时可能还是 NOOP（promise 未 resolve）—— start 行可能错过 observer 日志，
  // 但 echo 一定写到 stdout（用户本地能看到）。
  const startLine = renderTaskBoundary(leaseId, 'start', { cmdPath, args });
  observer.writeParsed(startLine);
  echoTaskBoundary(leaseId, 'start', { cmdPath, args });

  // 封装结束路径：echo + observer + return 一次性完成，避免漏写 close。
  // 任务终态时 observer promise 通常已 resolve（spawn + readline + exit 流程比 mkdir 长）。
  const finishAttempt = (result: SpawnAttemptResult): SpawnAttemptResult => {
    const endLine = renderTaskBoundary(leaseId, 'end', {
      status: result.status,
      exitCode: result.exitCode,
      error: result.error,
    });
    observer.writeParsed(endLine);
    observer.close(endLine);
    echoTaskBoundary(leaseId, 'end', {
      status: result.status,
      exitCode: result.exitCode,
      error: result.error,
    });
    return result;
  };

  // spawn（stdio 全管道：stdin / stdout / stderr 都需要）
  // ql-20260616-001：Windows .cmd/.bat/.ps1 npm wrapper 之前依赖 shell:true，
  // 但实测在不同 shell 父进程下不稳定（git-bash → ENOENT，PowerShell → 可能吞 stdout）。
  // ql-20260618-007：改用 resolveWindowsCmdShim 解析 .cmd 提取真实命令（node + codex.js
  // 或 claude.exe），用 spawn(exe, [target, ...args]) 直接调，绕过 cmd.exe 包装层。
  // 解析失败时回退 shell:true（兼容旧 .ps1 / 自定义 wrapper）。
  const isWindowsWrapper =
    process.platform === 'win32' &&
    /\.(cmd|bat|ps1)$/i.test(cmdPath);
  const isWindowsBareSh =
    process.platform === 'win32' &&
    !/\.[a-z0-9]+$/i.test(cmdPath);

  let spawnCmdPath = cmdPath;
  let spawnArgs = args;
  let useShell = false;
  if (process.platform === 'win32' && /\.cmd$/i.test(cmdPath)) {
    const resolved = resolveWindowsCmdShim(cmdPath);
    if (resolved) {
      spawnCmdPath = resolved.exe;
      spawnArgs = [...resolved.prependArgs, ...args];
    } else {
      // .cmd 解析失败，回退 shell:true（极少见，保留兜底）
      useShell = true;
    }
  } else if (isWindowsWrapper || isWindowsBareSh) {
    // .bat / .ps1 / 无扩展名 sh wrapper 仍走 shell（cmd-shim 解析仅覆盖 .cmd）
    useShell = true;
  }
  // DA-1（2026-08-20 审计 P0）：shell:true 下 Node 不转义任何参数，直接拼接命令行。
  // cursor provider 把用户完整 prompt、backend 下发的 model 作位置参数传入——
  // 含 & | < > ^ % " 或空白的参数在 cmd.exe 下即命令注入/参数错切。shell 路径
  // 只保留给「干净参数」的兜底，命中危险字符一律硬失败并给出修复指引，把
  // 静默注入变成响亮的配置错误。
  if (useShell) {
    const RISKY = /[&|<>^%"\s]/;
    const riskyArg = spawnArgs.find((a) => typeof a === 'string' && RISKY.test(a));
    if (riskyArg !== undefined) {
      throw new Error(
        `拒绝以 shell 模式运行「${cmdPath}」：参数含 shell 元字符（注入/错切风险，DA-1）。` +
          `请把 agent 包装器换成可被 cmd-shim 解析的 .cmd，或直接指向 .exe；` +
          `问题参数前 40 字符: ${String(riskyArg).slice(0, 40)}`,
      );
    }
  }

  const child = spawn(spawnCmdPath, spawnArgs, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // ql-20260907-004：daemon 无自有控制台（IDE / VBS 隐藏自启形态）时，Windows
    // 会给控制台子进程（node 跑 agent CLI）新开可见黑框。windowsHide=
    // CREATE_NO_WINDOW，对齐仓内其余 spawn 点先例；stdio 管道不受影响。
    windowsHide: true,
    ...(useShell ? { shell: true } : {}),
  }) as ChildProcess;

  let exitCode = 0;
  let exited = false;
  // 用对象容器存 spawn 错误：TS 控制流分析对「在异步闭包内赋值的 let 变量」
  // 会保守假定其类型恒为初始值（即 null），导致后续读取被收窄到 never。
  // 对象属性（可变）不受此 narrowing 影响，TS 对属性读取保守保留联合类型。
  const spawnErrorRef: { current: Error | null } = { current: null };
  let timedOut = false;
  let cancelled = false;
  let stderrBuf = '';
  // ql-20260706-009：已 forward 到 backend 的 stderr 行数（防风暴）。
  let stderrForwarded = 0;
  // ql-20260706-010：收集 fire-and-forget forward promise，claude exit 后 await，
  // 防尾部消息（429 attempt/API Error/最后 tool_result）在 daemon 收尾时丢失。
  const pendingForwards: Promise<unknown>[] = [];
  // task-06：收集 complete 事件 metadata.stats（claude result 消息的 usage/cost）。
  // complete 事件通常仅一个，覆盖式赋值；失败路径保持 undefined。
  let lastStats: Record<string, unknown> | undefined;
  // task-07（2026-08-29-usage-by-provider-model / FR-01-4 / FR-02-2）：终态 stats
  // 组装单点 = task-16 mergeAdapterUsage（ndjson getUsage 兜底）+ attachBatchModelStats
  // 增补 model / api_requests（仅 stream-json adapter 暴露 messageStartCount）。
  // cancelled / timeout / failed / completed 五个 finishAttempt 出口共用。
  const finalStats = (): Record<string, unknown> | undefined =>
    attachBatchModelStats(mergeAdapterUsage(adapter, lastStats), ctx, adapter);

  // stderr 累积（用于失败诊断）+ observer raw 写入 + ql-20260706-009 实时 forward
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    stderrBuf += text;
    // ql-20260616-003：把 stderr 实时投给 observer（mode=raw/both 时落日志）
    // 按行切分写入，避免大块 chunk 一次性塞进去难读
    const lines = text.split(/\r?\n/);
    for (const ln of lines) {
      if (ln.length === 0) continue;
      observer.writeRawStderr(ln);
      // ql-20260706-009：stderr 关键行实时 forward 到 backend agent_run_logs
      // （channel='stderr'），让前端"错误警告"筛可见——修 claude 529/API Error
      // 等只吐 stderr 不进 stdout stream-json 致前端只看 init 没下文的可见性 bug。
      // fire-and-forget（同 stdout submitMessages 策略）；MAX_STDERR_FORWARD 防风暴。
      if (claimToken && ctx.agentRunId && stderrForwarded < MAX_STDERR_FORWARD) {
        stderrForwarded += 1;
        pendingForwards.push(
          runner.client
            .submitMessages(leaseId, claimToken, ctx.agentRunId, [
              { event_type: 'stderr', content: ln.slice(0, 5000), channel: 'stderr' },
            ])
            .catch((e) => {
              console.warn('task_runner: stderr_forward_failed', leaseId, e);
            }),
        );
      }
    }
    // stderr 也算 error 文本上限保护（避免无限累积）
    if (stderrBuf.length > MAX_ERROR * 4) {
      stderrBuf = stderrBuf.slice(0, MAX_ERROR * 4);
    }
  });

  // 'error' 事件：spawn ENOENT 等（B-19-05）
  child.once('error', (err: Error) => {
    spawnErrorRef.current = err;
    if (!exited) {
      exited = true;
      exitCode = 127;
    }
  });

  // 'exit' 事件
  child.once('exit', (code: number | null, sig: string | null) => {
    exitCode = code ?? (sig ? -1 : 0);
    exited = true;
  });

  // ql-20260616-003：observer 创建是 fire-and-forget，但需要让一个 microtask
  // 跑完让 promise 链启动（否则 observer promise 在本函数返回前都不会 resolve）。
  // 这里的 await 是为了 .then 回调有机会被调度（实际不阻塞 spawn —— spawn 已同步执行）。
  await Promise.resolve();

  // 步骤 6b：写 prompt 到 stdin（不立即 end）
  // ql-20260617-008：JSON-RPC 协议（adapter 实现 buildHandshake）的 prompt 走
  // turn/start 的 instructions 字段（步骤 6c 握手 + handleLine 触发的 buildTurnStart），
  // 这里跳过 buildInput，避免 codex stdin 收到非法 JSON 文本导致 -32600。
  if (!adapter.buildHandshake) {
    try {
      const inputData = adapter.buildInput
        ? adapter.buildInput(prompt)
        : `${prompt}\n`;
      const buf = typeof inputData === 'string' ? Buffer.from(inputData, 'utf-8') : inputData;
      if (buf.length > 0 && child.stdin && !child.stdin.destroyed) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = (): void => { if (!done) { done = true; resolve(); } };
          const ok = child.stdin!.write(buf, (err?: Error | null) => {
            if (err) console.warn('task_runner: stdin_write_failed', err);
            finish();
          });
          if (!ok) {
            child.stdin!.once('drain', finish);
          } else {
            // ok=true 时 callback 已同步触发或将在 flush 后触发；为保证不悬挂，
            // 用 setImmediate 兜底 resolve（write 返回 true 表示已接受，无需等 drain）。
            setImmediate(finish);
          }
        });
      }
    } catch (e) {
      console.warn('task_runner: stdin_write_exception', e);
    }
  }

  // 步骤 6c：json_rpc 协议握手序列（ql-20260617-008）
  // codex app-server 是被动 server，必须主动发 initialize/initialized/thread.start
  // 才会开始处理。turn/start 在 spawn-stream handleLine 检测到 thread/start response
  //（id=2）后用真实 threadId 触发（adapter.buildTurnStart）。
  if (adapter.buildHandshake && child.stdin && !child.stdin.destroyed) {
    try {
      const handshake = adapter.buildHandshake({
        cwd: opts.cwd,
        prompt,
        model: ctx.model,
      });
      for (const line of handshake) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = (): void => { if (!done) { done = true; resolve(); } };
          const ok = child.stdin!.write(line + '\n', (err?: Error | null) => {
            if (err) console.warn('task_runner: handshake_write_failed', err);
            finish();
          });
          if (!ok) {
            child.stdin!.once('drain', finish);
          } else {
            setImmediate(finish);
          }
        });
        // ql-20260618-002：每条 handshake 之间加 300ms，让 codex.cmd 包装层稳定启动 + codex
        // 主进程处理完上一条再发下一条。实测 100ms 间隔会导致 thread/start 后 codex.cmd
        // exit 0（cmd.exe 包装层把 stdin 数据弄丢），300ms 是 probe 测试通过的稳定值。
        await new Promise<void>((r) => setTimeout(r, 300));
      }
    } catch (e) {
      console.warn('task_runner: handshake_write_exception', e);
    }
  }

  // 超时看门狗（task-10 B2：resolveTimeout 优先级链
  // ctx.timeoutSeconds > ctx.timeout > config.default_timeout_seconds > 1800；
  // 返回 0 = 不限，不启动看门狗）
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const timeoutSec = resolveTimeout(ctx, runner.config);
  if (timeoutSec > 0) {
    watchdog = setTimeout(() => {
      timedOut = true;
      runner._killChild(child);
      // SIGTERM 后 2s 仍存活 → SIGKILL（优雅升级）
      killTimer = setTimeout(() => {
        runner._killChild(child, 'SIGKILL');
      }, KILL_GRACE_MS);
    }, timeoutSec * 1000);
  }

  // 取消监听（AbortSignal）
  const onAbort = (): void => {
    if (signal.aborted && !exited) {
      cancelled = true;
      runner._killChild(child);
      killTimer = setTimeout(() => {
        runner._killChild(child, 'SIGKILL');
      }, KILL_GRACE_MS);
    }
  };
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  // 步骤 7：readline 逐行读 stdout，parse + submitMessages + control_request
  try {
    if (child.stdout) {
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      // 子进程退出（或已被 kill）→ 主动关闭 readline，让 for-await 跳出。
      // 否则在 FakeChild / 某些真实 agent 不主动 close stdout 时会无限等待。
      const exitCloser = (): void => {
        try { rl.close(); } catch { /* 已关闭 */ }
      };
      child.once('exit', exitCloser);
      // for await...of 天然具备背压（R-04）。
      // 退出条件：readline 自然结束（stdout push(null)）或 exitCloser 触发 rl.close()。
      // 不用 exited 标志 break —— exit listener 同步触发时 exited=true 但 rl 还能正常
      // 吐完缓冲行（实现单测同步 emit 场景下，行已在 stdout 缓冲）。
      for await (const line of rl) {
        if (cancelled || timedOut) {
          break;
        }
        // ql-20260616-003：原始 stdout 行投给 observer（mode=raw/both 时落日志）
        observer.writeRawStdout(line);
        await handleLine(runner, line, adapter, child, {
          outputParts,
          onSessionId,
          leaseId,
          claimToken,
          agentRunId: ctx.agentRunId ?? '',
          // task-17：approval 决策需 runtimeId 隔离 PolicyEngine.canWrite（D-002）。
          runtimeId: ctx.runtimeId,
          observer,
          onStats: (stats: Record<string, unknown>) => {
            lastStats = stats;
            // task-08：叠加外部 budget 观察回调（不阻塞 readline，同步调用）。
            try {
              externalOnStats?.(stats);
            } catch (e) {
              console.warn('task_runner: budget_onstats_error', leaseId, e);
            }
          },
          prompt,
          model: ctx.model,
          pendingForwards,
        });
      }
      child.off('exit', exitCloser);
      rl.close();
    }
  } catch (e) {
    // parse / control 异常已在 handleLine 内 try/catch；此处兜底
    console.warn('task_runner: stdout_consume_error', e);
  }

  // 等子进程 exit（spawn 'error' 已设 exited=true；正常情况 exit 已触发）
  // Node 的 exit 事件可能在 stdout close 之前或之后，用 once 兜底等它。
  if (!exited) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        child.off('exit', done);
        child.off('error', done);
        resolve();
      };
      child.once('exit', done);
      child.once('error', done);
    });
  }

  // ql-20260706-010：await 所有 pending forward，确保 claude exit 前瞬间产生的
  // 尾部消息（429 attempt / API Error / 最后 tool_result）发完再返回，防
  // fire-and-forget 在 daemon 收尾时丢失（c76562cd 实证 10 条 429 attempt 全丢）。
  if (pendingForwards.length > 0) {
    await Promise.allSettled(pendingForwards);
  }

  // 清理定时器
  if (watchdog) clearTimeout(watchdog);
  if (killTimer) clearTimeout(killTimer);
  signal.removeEventListener('abort', onAbort);

  // 关闭 stdin（result 已收到或子进程退出）
  try {
    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.end();
    }
  } catch {
    /* stdin 已关闭 */
  }

  // 计算最终状态
  if (cancelled) {
    return finishAttempt({ status: 'cancelled', exitCode: exitCode || 1, error: 'task cancelled', stats: finalStats() });
  }
  if (timedOut) {
    return finishAttempt({ status: 'timeout', exitCode: exitCode || 1, error: `task timed out after ${timeoutSec}s`, stats: finalStats() });
  }
  // spawnErrorRef.current：spawn 错误（'error' 事件异步赋值）。用对象容器
  // 避免 TS 对闭包内赋值的 let 变量做错误 narrowing（详见声明处注释）。
  if (spawnErrorRef.current) {
    return finishAttempt({ status: 'failed', exitCode: exitCode || 127, error: spawnErrorRef.current.message, stats: finalStats() });
  }
  if (exitCode !== 0) {
    const errDetail = stderrBuf.trim();
    // task-10 B3：判定是否业务错误（claude result is_error=true）。
    // 鸭子类型调用 adapter.getLastResultInfo()（claude adapter 解析 result 消息时记录）。
    // businessError=true → isSpawnLevelFailure 返回 false，不重试（R-10 side-effect 优先）。
    const lastInfo = (adapter as {
      getLastResultInfo?: () => { isError?: boolean } | undefined;
    }).getLastResultInfo?.();
    const businessError = lastInfo?.isError === true;
    const errMsg = errDetail
      ? `agent process exited with exit code ${exitCode}: ${errDetail}`
      : `agent process exited with exit code ${exitCode}`;
    return finishAttempt({
      status: 'failed',
      exitCode: 1, // 统一映射非零退出为 1（对齐 Python 把非零 exit 视为 failed）
      error: errMsg,
      stats: finalStats(),
      businessError,
    });
  }
  return finishAttempt({ status: 'completed', exitCode: 0, stats: finalStats() });
}

/** task-03：原 _handleLine 私有方法的 env 对象类型（搬移零改写）。 */
export interface HandleLineEnv {
  outputParts: string[];
  onSessionId: (sid: string) => void;
  leaseId: string;
  claimToken: string;
  agentRunId: string;
  /** task-17：approval 决策按 runtime_id 隔离 PolicyEngine.canWrite（D-002）。 */
  runtimeId: string;
  observer: TerminalObserver;
  onStats?: (stats: Record<string, unknown>) => void;
  prompt?: string;
  model?: string;
  /** ql-20260706-010：收集本行 forward promise，runLease exit 后统一 await。 */
  pendingForwards: Promise<unknown>[];
}

/**
 * 处理 stdout 一行：parse → submitMessages + control_request 应答 + result 检测。
 *
 * 对齐 Python `_consume_stdout` 主循环 + `_handle_control_request`。
 * 内部全部 try/catch，避免单行异常中断整体（B-19-04）。
 */
export async function handleLine(
  runner: TaskRunnerCore,
  line: string,
  adapter: ProtocolAdapter,
  child: ChildProcess,
  env: HandleLineEnv,
): Promise<void> {
  // R-03：control_request 行优先交给 adapter.onControl 应答
  if (adapter.onControl && _looksLikeControlRequest(line)) {
    try {
      await adapter.onControl(line, child.stdin as NodeJS.WritableStream);
    } catch (e) {
      console.warn('task_runner: control_response_failed', e);
    }
    // control_request 行本身不产 submitMessages 事件，但仍允许 parse（多数 adapter 对该行返回 null）
  }

  // ql-20260617-008：json_rpc thread/start response 监听
  // codex app-server 收到 thread/start（id=2）后回复含 result.thread.id 的 response。
  // 检测到此 response 后，用真实 threadId 调 adapter.buildTurnStart 构造
  // turn/start request 写 stdin，codex 才会开始处理用户 prompt。
  if (adapter.buildTurnStart && child.stdin && !child.stdin.destroyed) {
    try {
      const trimmed = line.trim();
      if (trimmed.startsWith('{')) {
        const msg = JSON.parse(trimmed) as {
          id?: unknown;
          result?: { thread?: { id?: unknown } };
        };
        if (msg.id === 2 && msg.result?.thread?.id) {
          const threadId = String(msg.result.thread.id);
          const turnStartLine = adapter.buildTurnStart({
            threadId,
            prompt: env.prompt ?? '',
            model: env.model,
          });
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => { if (!done) { done = true; resolve(); } };
            const ok = child.stdin!.write(turnStartLine + '\n', (err?: Error | null) => {
              if (err) console.warn('task_runner: turn_start_write_failed', err);
              finish();
            });
            if (!ok) {
              child.stdin!.once('drain', finish);
            } else {
              setImmediate(finish);
            }
          });
        }
      }
    } catch (e) {
      // 非 JSON 行忽略（codex 推送的 notification 也走此路径，正常）
      if (!(e instanceof SyntaxError)) {
        console.warn('task_runner: turn_start_trigger_exception', e);
      }
    }
  }

  // result / system 行：尝试提取 session_id（B-19-09：仅在显式标记 result 时关闭 stdin）
  if (_looksLikeResult(line)) {
    const sid = _extractSessionId(line);
    if (sid) env.onSessionId(sid);
    // result 行收到 → 安全关闭 stdin（避免子进程继续等待输入，R-03 关键点）
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    } catch {
      /* 已关闭 */
    }
  }

  // ql-20260618-003：codex/json-rpc 的 turn/completed → 安全关闭 stdin。
  // codex 是被动 server，单 turn 完成后不主动退出；daemon 检测到 turn/completed
  // notification 即关闭 stdin，让 codex 优雅退出，readline 收尾，task 完成。
  // 与 claude 的 _looksLikeResult 等价的"单次 lease 收尾点"。
  if (_looksLikeTurnCompleted(line)) {
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    } catch {
      /* 已关闭 */
    }
  }

  // parse
  let events: AgentEvent[] | null = null;
  try {
    events = adapter.parse(line);
  } catch (e) {
    // 单行 parse 异常不中断整体（B-19-04）
    console.warn('task_runner: parse_error', line.slice(0, 100), e);
    return;
  }
  if (!events || events.length === 0) {
    return;
  }

  // task-17 / R-06：Codex batch 带内审批决策。
  // 扫描本轮 events 是否含 approval tool_use（json-rpc adapter parseServerRequest 产出）。
  // 命中则对每个写路径调 policyEngine.canWrite 决策，写 accept/decline response 到 stdin。
  // 必须在 _eventToMessages 之前处理：approval 是 server request 需 daemon 应答，
  // 不应答会卡死 turn（codex 等 response 才继续）。仅 json-rpc adapter 的 batch 路径生效，
  // stream-json / ndjson 无 server request 概念（无 PendingServerRequest）。
  const approvalEv = events.find(
    (e) => e.type === 'tool_use' && e.metadata?.kind === 'approval',
  );
  if (approvalEv) {
    await runner._handleApprovalDecision(adapter, child, env, approvalEv);
  }

  // 累积 output + 提交 submitMessages
  const messages: Record<string, unknown>[] = [];
  for (const ev of events) {
    // 本地终端 echo + 观察日志：用同一份 render 渲染保证字节一致。
    // echo 写 daemon 本地 stdout；observer.writeParsed 按配置 mode 决定是否落日志。
    const rendered = renderAgentEvent(env.leaseId, ev);
    env.observer.writeParsed(rendered);
    try {
      process.stdout.write(rendered + '\n');
    } catch {
      // stdout 关闭：忽略
    }
    // 提取 sessionId（complete / status 事件可能在 metadata.session_id 带）
    const sid = ev.metadata?.session_id;
    if (typeof sid === 'string' && sid) {
      env.onSessionId(sid);
    }
    // task-06：complete 事件收集 metadata.stats（cost/tokens/turns）
    if (ev.type === 'complete' && ev.metadata?.stats && env.onStats) {
      const stats = ev.metadata.stats;
      if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
        env.onStats(stats as Record<string, unknown>);
      }
    }
    // output 累积：仅 text / error 事件进 output 缓冲
    if (ev.type === 'text' || ev.type === 'error') {
      if (ev.content) {
        env.outputParts.push(ev.content);
      }
    }
    // 转 submitMessages 负载
    const msgs = runner._eventToMessages(ev);
    if (msgs && msgs.length > 0) {
      messages.push(...msgs);
    }
  }

  if (messages.length === 0) {
    return;
  }

  // submitMessages：fire-and-forget，不阻塞 stdout readline（每条 await HTTP
  // 会让 cursor/codex 执行慢一个数量级；失败仅 warn，对齐容错策略）。
  // ql-004：空 agentRunId 不发 submitMessages，防空 agent_run_id 422 风暴。
  // task-11（FR-10 / D-005@v1）：注入 resilience 时走 submitWithRetry（带退避重试 +
  // dedup_key），保持非阻塞（void + catch）；未注入回退原 client.submitMessages。
  if (env.claimToken && env.agentRunId) {
    if (runner.resilience) {
      const envelopes: Envelope[] = messages.map((m, idx) => ({
        message: m,
        dedup_key: dedupKeyFor(m, env.agentRunId, 0, idx),
      }));
      env.pendingForwards.push(
        runner.resilience
          .submitWithRetry(env.leaseId, env.claimToken, env.agentRunId, envelopes)
          .catch((e) => {
            console.warn(
              'task_runner: event_forward_failed',
              env.leaseId,
              toCauseInfo(e),
            );
          }),
      );
    } else {
      env.pendingForwards.push(
        runner.client
          .submitMessages(env.leaseId, env.claimToken, env.agentRunId, messages)
          .catch((e) => {
            console.warn('task_runner: event_forward_failed', env.leaseId, e);
          }),
      );
    }
  }
}
