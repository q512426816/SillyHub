/**
 * TaskRunner —— 任务编排核心（task-19）。
 *
 * 把 Python `sillyhub_daemon/task_runner.py`（311 行 execute_task 7 步编排）
 * + `backends/__init__.py`（AgentBackend.execute 的 spawn 逻辑）
 * + `backends/stream_json.py`（spawn 模板 / stdin control_request / 看门狗）
 * 三个职责收敛到本类（方案B：子进程执行下沉到 TaskRunner 单点，adapter 仅解析）。
 *
 * 9 步编排链：
 *   1. workspace.prepareWorkspace(name, repoUrl, branch) → workDir
 *   2. claudeMd 非空 → 写 ${workDir}/.claude/CLAUDE.md
 *   3. credential.buildEnv(toolConfig) → env
 *   4. getBackend(provider) → adapter
 *   5. client.startLease(leaseId, claimToken)
 *   6. spawn(cmdPath, adapter.buildArgs(), { cwd: workDir, env })
 *   7. readline 逐行读 stdout：adapter.parse(line) → AgentEvent[] → _eventToMessage → client.submitMessages
 *   8. exit 后 workspace.collectDiff(workDir) → patch/files_changed/insertions/deletions
 *   9. 汇总 TaskResult，置终态
 *
 * 承载的两个 P1 风险（蓝图 R-03 / R-04）：
 *   - R-03 stdin 控制不挂起：子进程发 control_request 时调 adapter.onControl(line, stdin)
 *     写回应答；result 行后才 stdin.end，绝不在中途关闭。
 *   - R-04 stdout 背压/编码：readline.createInterface + for await...of 自带背压（上游
 *     push 被消费前不继续）；逐行 parse 避免整 buffer 撑爆内存；UTF-8 强制解码。
 *
 * 状态机：pending → running → completed | failed | cancelled | timeout
 *
 * Python 1:1 对齐点：
 *   - track/untrack + cancel_task（asyncio.Task.cancel → AbortController）
 *   - execute_task 的 try/catch 映射到 failed
 *   - _event_to_message：event_type + 条件字段（content/tool_name/.../session_id）
 *   - _truncate（_MAX_OUTPUT=10000, _MAX_ERROR=5000）
 *   - startLease / submitMessages 失败不中断（Python 同策略，仅 log warning）
 *
 * 仅用 Node 原生依赖：node:child_process, node:readline, node:fs/promises,
 * node:path, node:timers, node:crypto。
 *
 * @module task-runner
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { getBackend } from './adapters/index.js';
import type { ProtocolAdapter } from './adapters/protocol-adapter.js';
import type {
  AgentEvent,
  LeaseCtx,
  TaskResult,
} from './types.js';

// ── 常量（对齐 Python task_runner.py）────────────────────────────────────────

/** 累积输出最大字符数（对齐 Python _MAX_OUTPUT = 10000）。 */
const MAX_OUTPUT = 10_000;
/** 错误信息最大字符数（对齐 Python _MAX_ERROR = 5000）。 */
const MAX_ERROR = 5_000;
/** 超时 kill 优雅升级：SIGTERM 后 2 秒仍存活则 SIGKILL（对齐 Python stream_json.py:115）。 */
const KILL_GRACE_MS = 2_000;

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/**
 * 任务运行时状态（6 种，对齐蓝图 task-19.md §状态机）。
 * 比 BackendTaskResult 多 pending/running/cancelled 三个运行态。
 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * 子进程 spawn 选项透传（仅 TaskRunner 用到的子集）。
 * 与 node:child_process.SpawnOptions 字段一致，但显式列出避免误传。
 */
interface SpawnOpts {
  cwd: string;
  // env 对齐 Node child_process.SpawnOptions.env 的类型（NodeJS.ProcessEnv，
  // 即 Record<string, string | undefined>）：process.env 的值天然含 undefined，
  // spawn 也接受。用 Record<string,string> 会让 { ...process.env } 合并报错。
  env: NodeJS.ProcessEnv;
}

// ── 依赖契约（构造注入）──────────────────────────────────────────────────────

/**
 * TaskRunner 需要的 HubClient 接口子集（鸭子类型，避免硬耦合 HubClient 类）。
 * 字段对齐 src/hub-client.ts 的方法签名。
 */
export interface RunnerHubClient {
  startLease(leaseId: string, claimToken: string): Promise<unknown>;
  submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<unknown>;
  leaseHeartbeat?(leaseId: string, claimToken: string): Promise<unknown>;
}

/**
 * TaskRunner 需要的 WorkspaceManager 接口子集。
 * 字段对齐 src/workspace.ts。
 */
export interface RunnerWorkspaceManager {
  prepareWorkspace(name: string, repoUrl?: string | null, branch?: string): Promise<string>;
  collectDiff(workspaceDir: string): Promise<{
    patch: string;
    files_changed: number;
    insertions: number;
    deletions: number;
    stats: string;
  }>;
}

/**
 * TaskRunner 需要的 CredentialManager 接口子集。
 * 字段对齐 src/credential.ts。
 *
 * buildEnv 签名与 CredentialManager.buildEnv 逐字一致（必传 config，
 * Record<string, unknown>），使 CredentialManager 实例可直接注入而无需
 * adapter 包装（G-04 类型安全）。调用点负责兜底 undefined（ctx.toolConfig ?? {}）。
 */
export interface RunnerCredentialManager {
  buildEnv(config: Record<string, unknown>): Record<string, string>;
}

// ── TaskRunner ───────────────────────────────────────────────────────────────

/**
 * 任务编排器：执行一个 lease，把 agent 输出流式 submit 到 server，
 * 收集 git diff，产出 TaskResult。
 *
 * 依赖通过构造器注入（client / workspace / credential），便于测试 mock；
 * getBackend 是模块级导入（每次调用返回新 adapter 实例，对齐 Python）。
 */
export class TaskRunner {
  /** 当前在跑的 lease → AbortController（cancel 用）。 */
  private readonly _controllers = new Map<string, AbortController>();
  /** lease → 终态（completed/failed/cancelled/timeout）。 */
  private readonly _states = new Map<string, TaskStatus>();
  /** lease → claimToken（submitMessages / completeLease 用）。 */
  private readonly _claimTokens = new Map<string, string>();

  /**
   * @param client     HubClient 实例（REST 调用）
   * @param workspace  WorkspaceManager 实例（git 镜像 + diff）
   * @param credential CredentialManager 实例（env 渲染）
   */
  constructor(
    private readonly client: RunnerHubClient,
    private readonly workspace: RunnerWorkspaceManager,
    private readonly credential: RunnerCredentialManager,
  ) {}

  // ── 追踪与取消 ────────────────────────────────────────────────────────────

  /**
   * 当前在跑的任务数。对齐 Python `running_tasks` 集合大小。
   */
  get activeTaskCount(): number {
    return this._controllers.size;
  }

  /**
   * 把 leaseId 加入追踪集，返回关联的 AbortController（供 cancel 触发）。
   * 对齐 Python `running_tasks[task_id] = asyncio.create_task(...)`。
   */
  track(leaseId: string): AbortController {
    if (this._controllers.has(leaseId)) {
      // 已在跑：返回现有 controller（幂等，对齐 Python 不重复创建 Task）
      return this._controllers.get(leaseId)!;
    }
    const ac = new AbortController();
    this._controllers.set(leaseId, ac);
    this._states.set(leaseId, 'running');
    return ac;
  }

  /**
   * 从追踪集移除（任务终态后由 runLease 自动调）。
   * 对齐 Python `running_tasks.pop(task_id, None)`。
   */
  untrack(leaseId: string): void {
    this._controllers.delete(leaseId);
  }

  /**
   * 取消一个在跑的 lease。对齐 Python `cancel_task` → `task.cancel()`。
   * 触发 AbortSignal + kill 子进程（SIGTERM → 2s 后 SIGKILL）由 runLease 自己监听处理。
   *
   * @returns true 表示找到并取消；false 表示该 lease 不在追踪集
   */
  async cancel(leaseId: string): Promise<boolean> {
    const ac = this._controllers.get(leaseId);
    if (!ac) {
      return false;
    }
    ac.abort();
    this._states.set(leaseId, 'cancelled');
    return true;
  }

  /**
   * 查询某个 lease 的状态。对齐蓝图 getState API（task-19 AC-08）。
   * 任务未运行过返回 undefined。
   */
  getState(leaseId: string): TaskStatus | undefined {
    return this._states.get(leaseId);
  }

  // ── 主入口：runLease（9 步编排链）─────────────────────────────────────────

  /**
   * 执行一个 lease 的完整生命周期。
   *
   * 对齐 Python `execute_task(payload)`（task_runner.py:77-245）：
   * 1. workspace.prepareWorkspace
   * 2. 写 CLAUDE.md
   * 3. credential.buildEnv
   * 4. getBackend(provider)
   * 5. client.startLease
   * 6. spawn + stdin 写 prompt
   * 7. readline 逐行 parse + submitMessages
   * 8. exit → collectDiff
   * 9. 汇总 TaskResult
   *
   * 容错策略（对齐 Python）：
   *   - startLease 失败 → 仅 warn，不中断（lease 仍执行）
   *   - submitMessages 失败 → 仅 warn，不中断
   *   - collectDiff 失败 → 仅 warn，patch 留空
   *   - workspace.prepareWorkspace / getBackend 失败 → 直接 failed
   *
   * 返回的 TaskResult 同时写入 _states 终态，并 untrack。
   */
  async runLease(ctx: LeaseCtx): Promise<TaskRunnerResult> {
    const leaseId = ctx.leaseId;
    const ac = this.track(leaseId);
    const startTime = Date.now();
    // claimToken 在 WS 流程外部已注入；poll 流程内嵌。这里允许 undefined，
    // submitMessages / startLease 容忍空 token（对齐 Python 用 .get 默认空串）。
    const claimToken = ctx.claimToken ?? this._claimTokens.get(leaseId) ?? '';

    // 输出缓冲 + 会话 ID 收集
    const outputParts: string[] = [];
    let sessionId = '';

    try {
      // 步骤 1：workspace.prepareWorkspace（失败直接抛 → finally 映射 failed）
      const wsName = ctx.workspaceName ?? 'default';
      const repoUrl = ctx.repoUrl ?? undefined;
      const branch = ctx.branch ?? 'main';
      const workDir = await this.workspace.prepareWorkspace(wsName, repoUrl, branch);

      // 步骤 2：claudeMd 非空 → 写 .claude/CLAUDE.md
      if (ctx.claudeMd && ctx.claudeMd.length > 0) {
        try {
          const claudeDir = join(workDir, '.claude');
          await mkdir(claudeDir, { recursive: true });
          await writeFile(join(claudeDir, 'CLAUDE.md'), ctx.claudeMd, 'utf-8');
        } catch (e) {
          // 写 CLAUDE.md 失败不致命，仅 warn（对齐 Python 仅 log 不 raise）
          console.warn('task_runner: claude_md_write_failed', e);
        }
      }

      // 步骤 3：credential.buildEnv
      // ctx.toolConfig 是可选字段（Record<string,string>|undefined）；
      // CredentialManager.buildEnv 必传，undefined 时兜底 {}（renderConfig 返回空 → 空 env）。
      const extraEnv = this.credential.buildEnv(ctx.toolConfig ?? {});

      // 步骤 4：getBackend(provider)（默认 claude，对齐 Python DEFAULT_PROVIDER）
      const provider = ctx.provider ?? 'claude';
      let adapter: ProtocolAdapter;
      try {
        adapter = getBackend(provider);
      } catch (e) {
        // 不支持的 provider（对齐 Python KeyError → failed）
        const msg = e instanceof Error ? e.message : String(e);
        const errMsg = `unsupported provider: ${provider} (${msg})`;
        return this._finish(leaseId, startTime, false, 1, 'failed', '', this._truncate(errMsg, MAX_ERROR), sessionId, {
          diff: EMPTY_DIFF,
          exitCode: 1,
          spawnStatus: 'failed',
        });
      }

      // 步骤 5：startLease（失败仅 warn，不中断）
      try {
        await this.client.startLease(leaseId, claimToken);
      } catch (e) {
        console.warn('task_runner: start_lease_failed', leaseId, e);
      }

      // 步骤 6：spawn 子进程 + 流式采集
      const cmdPath = ctx.cmdPath ?? ctx.cmd ?? '';
      if (!cmdPath) {
        // cmdPath 空字符串 → 不能 spawn（B-19-13）
        const errMsg = 'cmd_path is empty, cannot spawn agent process';
        return this._finish(leaseId, startTime, false, 1, 'failed', '', errMsg, sessionId, {
          diff: EMPTY_DIFF,
          exitCode: 1,
          spawnStatus: 'failed',
        });
      }

      const spawnEnv = { ...process.env, ...extraEnv };
      const args = adapter.buildArgs
        ? adapter.buildArgs({
            model: ctx.model,
            sessionId: ctx.sessionId,
            resumeSessionId: ctx.resumeSessionId,
          })
        : [];

      const result = await this._spawnAndStream({
        cmdPath,
        args,
        opts: { cwd: workDir, env: spawnEnv },
        adapter,
        prompt: ctx.prompt ?? '',
        ctx,
        signal: ac.signal,
        outputParts,
        onSessionId: (sid: string) => {
          if (sid) sessionId = sid;
        },
        leaseId,
        claimToken,
      });

      // 步骤 7-8 已在 _spawnAndStream 内完成（parse + submit + exit 等待）。
      // 此处 result.exitCode / result.status / sessionId 已就绪。

      // 步骤 8b：collectDiff（失败仅 warn，patch 留空）
      // 显式可变类型 + 展开拷贝：EMPTY_DIFF 是 as const 字面量（readonly 字面量类型），
      // 直接 let diff = EMPTY_DIFF 会让后续 diff = d 因字面量不兼容报错。
      let diff: { patch: string; files_changed: number; insertions: number; deletions: number; stats: string } = { ...EMPTY_DIFF };
      try {
        const d = await this.workspace.collectDiff(workDir);
        diff = d;
      } catch (e) {
        console.warn('task_runner: diff_collect_failed', leaseId, e);
      }

      // 步骤 9：汇总 TaskResult
      const success = result.status === 'completed' && result.exitCode === 0;
      const finalStatus: TaskStatus = success ? 'completed' : result.status;
      const output = this._truncate(outputParts.join(''), MAX_OUTPUT);
      const errorOut = this._truncate(result.error ?? '', MAX_ERROR);

      return this._finish(leaseId, startTime, success, result.exitCode, finalStatus, output, errorOut, sessionId, {
        diff,
        exitCode: result.exitCode,
        spawnStatus: result.status,
      });
    } catch (e) {
      // 顶层 try/catch：workspace / 其它未预期异常 → failed（对齐 Python except Exception）
      const msg = e instanceof Error ? e.message : String(e);
      const output = this._truncate(outputParts.join(''), MAX_OUTPUT);
      return this._finish(leaseId, startTime, false, 1, 'failed', output, this._truncate(msg, MAX_ERROR), sessionId, {
        diff: EMPTY_DIFF,
        exitCode: 1,
        spawnStatus: 'failed',
      });
    }
  }

  // ── 步骤 6-7：spawn + 流式 stdout 解析 + stdin 控制 ───────────────────────

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
  private async _spawnAndStream(params: {
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
  }): Promise<{ status: 'completed' | 'failed' | 'timeout' | 'cancelled'; exitCode: number; error?: string }> {
    const {
      cmdPath, args, opts, adapter, prompt, ctx, signal,
      outputParts, onSessionId, leaseId, claimToken,
    } = params;

    // spawn（stdio 全管道：stdin / stdout / stderr 都需要）
    const child = spawn(cmdPath, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcess;

    let exitCode = 0;
    let exitSignal: string | null = null;
    let exited = false;
    // 用对象容器存 spawn 错误：TS 控制流分析对「在异步闭包内赋值的 let 变量」
    // 会保守假定其类型恒为初始值（即 null），导致后续读取被收窄到 never。
    // 对象属性（可变）不受此 narrowing 影响，TS 对属性读取保守保留联合类型。
    const spawnErrorRef: { current: Error | null } = { current: null };
    let timedOut = false;
    let cancelled = false;
    let stderrBuf = '';

    // stderr 累积（用于失败诊断）
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
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
      exitSignal = sig;
      exited = true;
    });

    // 步骤 6b：写 prompt 到 stdin（不立即 end）
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

    // 超时看门狗（ctx.timeout 秒，0 = 不限）
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutSec = ctx.timeout ?? 0;
    if (timeoutSec > 0) {
      watchdog = setTimeout(() => {
        timedOut = true;
        this._killChild(child);
        // SIGTERM 后 2s 仍存活 → SIGKILL（优雅升级）
        killTimer = setTimeout(() => {
          this._killChild(child, 'SIGKILL');
        }, KILL_GRACE_MS);
      }, timeoutSec * 1000);
    }

    // 取消监听（AbortSignal）
    const onAbort = (): void => {
      if (signal.aborted && !exited) {
        cancelled = true;
        this._killChild(child);
        killTimer = setTimeout(() => {
          this._killChild(child, 'SIGKILL');
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
          await this._handleLine(line, adapter, child, {
            outputParts,
            onSessionId,
            leaseId,
            claimToken,
            agentRunId: ctx.agentRunId ?? '',
          });
        }
        child.off('exit', exitCloser);
        rl.close();
      }
    } catch (e) {
      // parse / control 异常已在 _handleLine 内 try/catch；此处兜底
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
      return { status: 'cancelled', exitCode: exitCode || 1, error: 'task cancelled' };
    }
    if (timedOut) {
      return { status: 'timeout', exitCode: exitCode || 1, error: `task timed out after ${timeoutSec}s` };
    }
    // spawnErrorRef.current：spawn 错误（'error' 事件异步赋值）。用对象容器
    // 避免 TS 对闭包内赋值的 let 变量做错误 narrowing（详见声明处注释）。
    if (spawnErrorRef.current) {
      return { status: 'failed', exitCode: exitCode || 127, error: spawnErrorRef.current.message };
    }
    if (exitCode !== 0) {
      const errDetail = stderrBuf.trim();
      return {
        status: 'failed',
        exitCode: 1, // 统一映射非零退出为 1（对齐 Python 把非零 exit 视为 failed）
        error: errDetail
          ? `agent process exited with exit code ${exitCode}: ${errDetail}`
          : `agent process exited with exit code ${exitCode}`,
      };
    }
    return { status: 'completed', exitCode: 0 };
  }

  /**
   * 处理 stdout 一行：parse → submitMessages + control_request 应答 + result 检测。
   *
   * 对齐 Python `_consume_stdout` 主循环 + `_handle_control_request`。
   * 内部全部 try/catch，避免单行异常中断整体（B-19-04）。
   */
  private async _handleLine(
    line: string,
    adapter: ProtocolAdapter,
    child: ChildProcess,
    env: {
      outputParts: string[];
      onSessionId: (sid: string) => void;
      leaseId: string;
      claimToken: string;
      agentRunId: string;
    },
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

    // 累积 output + 提交 submitMessages
    const messages: Record<string, unknown>[] = [];
    for (const ev of events) {
      // 提取 sessionId（complete / status 事件可能在 metadata.session_id 带）
      const sid = ev.metadata?.session_id;
      if (typeof sid === 'string' && sid) {
        env.onSessionId(sid);
      }
      // output 累积：仅 text / error 事件进 output 缓冲
      if (ev.type === 'text' || ev.type === 'error') {
        if (ev.content) {
          env.outputParts.push(ev.content);
        }
      }
      // 转 submitMessages 负载
      const msg = this._eventToMessage(ev);
      if (msg) {
        messages.push(msg);
      }
    }

    if (messages.length === 0) {
      return;
    }

    // submitMessages（失败仅 warn，不中断 — 对齐 Python test_submit_messages_failure_does_not_crash）
    if (env.claimToken) {
      try {
        await this.client.submitMessages(env.leaseId, env.claimToken, env.agentRunId, messages);
      } catch (e) {
        console.warn('task_runner: event_forward_failed', env.leaseId, e);
      }
    }
  }

  // ── AgentEvent → submitMessages payload（对齐 Python _event_to_message）────

  /**
   * 把 AgentEvent IR 映射为 server submit_messages 的单条 message dict。
   *
   * 对照 Python `task_runner.py:285-311`：
   *   event_type = ev.event_type  → eventType: ev.type
   *   if ev.content:              → content 仅非空时写
   *   if ev.tool_name:            → toolName（来自 metadata.tool_name）
   *   if ev.call_id:              → callId（来自 metadata.call_id）
   *   if ev.status:               → status（来自 metadata.status）
   *   if ev.level:                → level（来自 metadata.level）
   *   if ev.session_id:           → sessionId（来自 metadata.session_id）
   *
   * Python 的 event_type 字符串直接保留（如 "assistant"/"tool_use"/"result"）。
   * Node IR 已收敛为 5 元组（text/tool_use/tool_result/error/complete），
   * 此处直接用 type 字段值（未做反向还原）。
   *
   * 全部字段为空（content 空 + 无 metadata）→ 返回 null（丢弃，对齐 Python 仅 event_type 也提交）。
   * 这里放宽：即使只有 event_type 也提交（与 Python 一致）。
   */
  private _eventToMessage(ev: AgentEvent): Record<string, unknown> | null {
    const msg: Record<string, unknown> = {
      event_type: ev.type,
    };
    if (ev.content) {
      msg.content = ev.content;
    }
    const md = ev.metadata ?? {};
    if (typeof md.tool_name === 'string' && md.tool_name) {
      msg.tool_name = md.tool_name;
    }
    if (typeof md.call_id === 'string' && md.call_id) {
      msg.call_id = md.call_id;
    }
    if (typeof md.status === 'string' && md.status) {
      msg.status = md.status;
    }
    if (typeof md.level === 'string' && md.level) {
      msg.level = md.level;
    }
    if (typeof md.session_id === 'string' && md.session_id) {
      msg.session_id = md.session_id;
    }
    // 丢弃：空 content + 无任何 metadata 业务字段（避免空 message 污染 server）
    if (!ev.content && Object.keys(msg).length <= 1) {
      return null;
    }
    return msg;
  }

  // ── 工具：截断（对齐 Python _truncate）─────────────────────────────────────

  /**
   * 把字符串截断到 maxLen。对齐 Python `_truncate(text: str, max_length: int) -> str`。
   * 语义：len(text) <= max → 原样；否则取 text[:max]。
   */
  private _truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max);
  }

  // ── 工具：kill 子进程（优雅升级）───────────────────────────────────────────

  /**
   * 给子进程发信号。对齐 Python `proc.terminate()`（SIGTERM）。
   * 调用方负责后续 SIGKILL 升级（_spawnAndStream 内的 killTimer）。
   */
  private _killChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
    try {
      if (!child.killed) {
        child.kill(signal);
      }
    } catch {
      /* 子进程已退出 */
    }
  }

  // ── 工具：终态收尾 ─────────────────────────────────────────────────────────

  /**
   * 把 TaskRunner 内部收集的碎片汇总为 TaskRunnerResult，并更新 _states + untrack。
   */
  private _finish(
    leaseId: string,
    startTime: number,
    success: boolean,
    exitCode: number,
    status: TaskStatus,
    output: string,
    error: string,
    sessionId: string,
    extra: {
      diff: { patch: string; files_changed: number; insertions: number; deletions: number; stats: string };
      error?: string;
      exitCode?: number;
      spawnStatus?: string;
    },
  ): TaskRunnerResult {
    this._states.set(leaseId, status);
    this.untrack(leaseId);
    return {
      success,
      exitCode,
      status,
      patch: extra.diff.patch,
      filesChanged: extra.diff.files_changed,
      insertions: extra.diff.insertions,
      deletions: extra.diff.deletions,
      output,
      error,
      durationMs: Date.now() - startTime,
      sessionId,
      // metadata：对齐 Python task_runner.py TaskResult.metadata（默认空 dict），
      // 此处把 session_id / runtime 诊断信息塞入，供 complete_lease 提取（types.ts LeaseCompleteResult.sessionId）。
      metadata: { session_id: sessionId },
    };
  }
}

// ── 公开类型 ──────────────────────────────────────────────────────────────────

/**
 * TaskRunner.runLease 的返回结构。
 * TaskResult 扩展加 status（终态）+ sessionId（直接平铺，便于调用方）。
 */
export interface TaskRunnerResult extends TaskResult {
  /** 任务终态。 */
  status: TaskStatus;
  /** agent 会话 ID（可能为空）。 */
  sessionId: string;
}

// ── 内部常量 & 辅助函数 ───────────────────────────────────────────────────────

const EMPTY_DIFF = {
  patch: '',
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  stats: '',
} as const;

/**
 * 粗判一行是否是 control_request（含 '"control_request"' 字样）。
 * 真正的解析在 adapter.onControl 内（不同协议 JSON 字段略有差异）。
 */
function _looksLikeControlRequest(line: string): boolean {
  return line.includes('"control_request"') || line.includes("'control_request'");
}

/**
 * 粗判一行是否是 result / 完成 行（含 '"result"' 或 '"type":"result"'）。
 * 用于触发 session_id 提取 + stdin.end。
 */
function _looksLikeResult(line: string): boolean {
  return (
    line.includes('"type":"result"') ||
    line.includes('"type": "result"') ||
    line.includes('"result"')
  );
}

/**
 * 从一行 JSON 文本里提取 session_id（若存在）。
 * 失败返回空串。
 */
function _extractSessionId(line: string): string {
  // 优先 JSON.parse
  try {
    const obj = JSON.parse(line) as { session_id?: unknown; sessionId?: unknown };
    if (typeof obj.session_id === 'string') return obj.session_id;
    if (typeof obj.sessionId === 'string') return obj.sessionId;
  } catch {
    // 非 JSON 行，正则兜底
    const m = /"session_id"\s*:\s*"([^"]+)"/.exec(line);
    if (m && m[1]) return m[1];
  }
  return '';
}
