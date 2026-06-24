/**
 * interactive/codex-app-server-driver.ts —— Codex app-server JSON-RPC 长驻 driver
 *（task-04 / design §5.3 八点职责 / D-001@V1 D-002@V1 D-004@V1）。
 *
 * 职责（design §5.3 第 1/2/3/4/6/7/8 点；第 5 点审批整体留 task-05，本任务 fail-closed 占位）：
 *   1. spawn `codex app-server --listen stdio://`（exec/env/cwd 来自 options）。
 *   2. 握手 initialize→notifications/initialized→thread/start(新建) / thread/resume(恢复)；
 *      每条间隔 300ms（对齐 task-runner.ts:835 实测稳定值）。
 *   3. 多轮串行：for-await input queue，每条 UserTurnInput → turn/start，收到
 *      turn/completed 才取下一条；禁止并发 turn（FR-02）。
 *   4. interrupt：turn/started 存 currentTurnId；interrupt 发 turn/interrupt 返回 true；
 *      无 turn 返回 false（FR-03）。
 *   6. flat message 映射（D-004）：{event_type, content, metadata, session_id=threadId}。
 *   7. turn result：turn/completed 正常 success / failed·cancelled → error。
 *   8. close：关 stdin + kill child，idempotent；stderr 作 error flat message 上报。
 *
 * 复用策略（D-002，不重发明协议）：
 *   - JsonRpcAdapter('codex') 的 parse/buildHandshake/buildArgs 全部复用。adapter 内部
 *     已实现 agentMessage/delta 流式节流、turn/started 收敛为 text+metadata.status、
 *     turn/completed 收敛为 complete event。
 *   - 但 adapter 的 buildTurnStart 把 id 硬编码为 3（batch 单 turn 语义），interactive
 *     多轮需递增 id → driver 内自建 turn/start request（用 adapter 的 params 结构）。
 *   - adapter 无 buildHandshake 的 resume 变体、无 buildTurnInterrupt → driver 自建。
 *
 * 关键 Reverse Sync（task-04 发现，已对照 design §5.3.5 / §10 风险表确认）：
 *   - json-rpc.ts 的 APPROVAL_RESPONSES 默认 `{decision:'accept'}`（auto_accept:true）
 *     是 batch TaskRunner 行为。design §5.3.5 / §10「自动接受权限破坏 Claude parity」
 *     明确要求 interactive driver 走 PermissionResolver，异常/超时 fail-closed。
 *     task-04 不改 json-rpc.ts 源码（保 batch 不回归，AC-04-9），在 driver 内部
 *     拦截 server request，自己写 fail-closed response（decline / cancel），绝不透传
 *     adapter 的 accept 模板。task-05 接入真实 PermissionResolver 后移除此 fail-closed 占位。
 *
 * D-004 flat message 契约（精确）：
 *   { event_type:'text'|'tool_use'|'tool_result'|'error', content:string,
 *     metadata:Record<string,unknown>, session_id:threadId }
 *   所有 flat message 都带 session_id = threadId。event_type='complete' 不上报（turn 边界
 *   信号，由 turn result 处理）。
 *
 * known-issue（AgentRunLog 无 metadata 列）：driver 仍按 D-004 上报带 metadata 的 flat
 * message（契约要求），metadata 落盘丢失是 backend/daemon 层 task-06 的事，本任务不管。
 *
 * @module interactive/codex-app-server-driver
 */

import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { JsonRpcAdapter, type PendingServerRequest } from '../adapters/json-rpc.js';
import type { AgentEvent } from '../types.js';
import type { CanUseToolDecision } from './types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  UserTurnInput,
} from './driver.js';

/** close 时 SIGTERM→SIGKILL 升级宽限（对齐 task-runner.ts KILL_GRACE_MS=2000）。 */
const KILL_GRACE_MS = 2_000;

/** stderr 累积上限（对齐 task-runner.ts MAX_ERROR*4，防内存膨胀）。 */
const STDERR_MAX_BYTES = 20_000;

/**
 * 握手每条之间的间隔（对齐 task-runner.ts:835 实测稳定值 300ms；codex.cmd 包装层
 * 100ms 间隔会丢 stdin）。测试可经构造函数注入 0 加速。
 */
const DEFAULT_HANDSHAKE_INTERVAL_MS = 300;

/** executable 缺失/解析失败抛出。code 字段供 daemon / 测试识别（task-06 记指标用）。 */
export class CodexExecutableNotFoundError extends Error {
  readonly code = 'CODEX_EXECUTABLE_NOT_FOUND' as const;
  constructor(reason: string) {
    super(`codex executable not found: ${reason} (CODEX_EXECUTABLE_NOT_FOUND)`);
    this.name = 'CodexExecutableNotFoundError';
  }
}

// ── task-05：approval / request_user_input / MCP elicitation 映射 ────────────
//（FR-08 / FR-09，D-006 / D-008 / D-010，design §5.3 第 5 点）。
//
// 以下纯函数 + handler 把 task-04 的 fail-closed 占位替换为真实策略映射。
// SessionManager（task-02）已提供 provider-neutral public 入口：
//   - requestPermission(sessionId, { toolName, toolInput, signal, isUserInputKind })
//   - requestUserDialog(sessionId, { dialogKind, dialogPayload, signal })
// driver 经 CodexStartOptions.sessionPermission 注入这两个方法的引用（task-06
// daemon 接线时从 SessionManager 实例传入）。未注入时（task-04 既有测试 / 生产
// 未接线前）→ fail-closed decline / 空 profile / cancel（保留 task-04 占位语义，
// 绝不 accept，AC-04 测试不回归）。

/**
 * task-05：driver 拿到的 SessionManager 审批/dialog 入口（鸭子类型，便于测试 mock）。
 *
 * 两个方法签名与 SessionManager.requestPermission / requestUserDialog public 入口
 * 逐字对齐（task-02 已实现 ask_user_only allow-through + fail-closed）。driver 只
 * 调这两个方法，不直接持有 SessionManager 实例（避免循环依赖 + 缩小耦合面）。
 *
 * 生产路径（task-06 daemon.ts 接线）：
 *   new CodexAppServerDriver() ... start(opts) {
 *     sessionPermission: {
 *       requestPermission: (i) => sessionManager.requestPermission(sessionId, i),
 *       requestUserDialog: (i) => sessionManager.requestUserDialog(sessionId, i),
 *     }
 *   }
 */
export interface CodexSessionPermissionHooks {
  /**
   * 普通审批（command/file/permissions requestApproval）。返回 allow/deny。
   * 内部已处理：ask_user_only=true 且非用户输入类 → allow-through；session 非
   * running → deny；send 失败/超时/abort → deny（fail-closed）。
   */
  requestPermission(input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  }): Promise<CanUseToolDecision>;
  /**
   * 用户对话（request_user_input / 可归一化 MCP elicitation）。返回 completed
   *（携带 dialogResult）或 cancelled（deny/超时/abort）。
   */
  requestUserDialog(input: {
    dialogKind: string;
    dialogPayload: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
  }): Promise<
    { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }
  >;
}

/** task-05 §公共类型：app-server server request（method + params + id）。 */
export interface CodexServerRequest {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

/** task-05 §公共类型：JSON-RPC response（handler 按各自 Codex schema 填 result）。 */
export interface CodexJsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

/**
 * task-05 §1 normalizeCodexRequestUserInput（D-010 双向归一化）。
 *
 * 把 Codex `{ questions: [{ id, header, question, options, isSecret, isOther }] }`
 * 归一化为前端 AskUserDialogCard 现有 schema（questions/options 结构，与 Claude
 * AskUserQuestion 对齐）。保留 question id 到 questionIds 数组供 denormalize 还原。
 *
 * 宽松校验（Codex schema 可能跨版本漂移，design §10 风险表）：
 *   - questions 非数组 / 缺字段 → supported:false；
 *   - 单个 question 缺 id → supported:false；
 *   - 空 questions 数组 → supported:true（空 questions）。
 */
export function normalizeCodexRequestUserInput(
  params: Record<string, unknown>,
):
  | {
      supported: true;
      dialogPayload: {
        questions: Array<{
          id: string;
          question: string;
          header?: string;
          options?: Array<{ label: string; description?: string }>;
          isSecret?: boolean;
        }>;
      };
      questionIds: string[];
    }
  | { supported: false; reason: string } {
  const rawQuestions = params.questions;
  if (!Array.isArray(rawQuestions)) {
    return { supported: false, reason: 'questions is not an array' };
  }
  const questionIds: string[] = [];
  const normalized: Array<{
    id: string;
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    isSecret?: boolean;
  }> = [];
  for (const rq of rawQuestions) {
    if (!rq || typeof rq !== 'object') {
      return { supported: false, reason: 'question entry is not an object' };
    }
    const q = rq as {
      id?: unknown;
      header?: unknown;
      question?: unknown;
      options?: unknown;
      isSecret?: unknown;
    };
    if (typeof q.id !== 'string' || q.id.length === 0) {
      return { supported: false, reason: 'question missing string id' };
    }
    const out: {
      id: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      isSecret?: boolean;
    } = {
      id: q.id,
      question: typeof q.question === 'string' ? q.question : '',
    };
    if (typeof q.header === 'string') out.header = q.header;
    if (typeof q.isSecret === 'boolean') out.isSecret = q.isSecret;
    if (Array.isArray(q.options)) {
      const opts: Array<{ label: string; description?: string }> = [];
      for (const ro of q.options) {
        if (!ro || typeof ro !== 'object') continue;
        const o = ro as { label?: unknown; description?: unknown };
        if (typeof o.label === 'string') {
          const opt: { label: string; description?: string } = { label: o.label };
          if (typeof o.description === 'string') opt.description = o.description;
          opts.push(opt);
        }
      }
      if (opts.length > 0) out.options = opts;
    }
    normalized.push(out);
    questionIds.push(q.id);
  }
  return { supported: true, dialogPayload: { questions: normalized }, questionIds };
}

/**
 * task-05 §1 denormalizeCodexRequestUserInputAnswers（D-010 双向归一化）。
 *
 * 把前端用户答案（PERMISSION_RESPONSE.dialog_result，形态 `{ [id]: string|string[] }`）
 * 还原为 Codex `{ answers: { [id]: { answers: string[] } } }`。
 *
 * - string 值包装成 `[value]`；
 * - 缺字段的 question 填 `{ answers: [] }`；
 * - dialogResult 非对象（null/undefined/原始值）→ 空 `{ answers: {} }`。
 */
export function denormalizeCodexRequestUserInputAnswers(
  questionIds: string[],
  dialogResult: unknown,
): { answers: Record<string, { answers: string[] }> } {
  const answers: Record<string, { answers: string[] }> = {};
  if (!dialogResult || typeof dialogResult !== 'object') {
    return { answers };
  }
  const map = dialogResult as Record<string, unknown>;
  for (const id of questionIds) {
    const v = map[id];
    if (typeof v === 'string') {
      answers[id] = { answers: [v] };
    } else if (Array.isArray(v)) {
      answers[id] = {
        answers: v.filter((x): x is string => typeof x === 'string'),
      };
    } else {
      answers[id] = { answers: [] };
    }
  }
  return { answers };
}

/**
 * task-05 §5 normalizeMcpElicitation（D-010 fail-closed）。
 *
 * 只支持两种可归一化形态：
 *   - mode:"url" → 透传 `{ url, message }` 作单问题 dialog（恒 supported）；
 *   - mode:"form" 且 requestedSchema.properties 仅含 string/boolean/enum(string[])
 *     → 映射为 questions。
 *
 * 复杂 schema（nested object / array / oneOf / anyOf / 未知 type / 缺 schema）
 * → supported:false，handler 据此 fail-closed decline + error log。
 */
export function normalizeMcpElicitation(
  params: Record<string, unknown>,
):
  | { supported: true; mode: 'url'; dialogPayload: { url: string; message: string } }
  | {
      supported: true;
      mode: 'form';
      dialogPayload: { questions: Array<{ id: string; question: string; options?: Array<{ label: string }> }> };
    }
  | { supported: false; reason: string } {
  const mode = params.mode;
  const message = typeof params.message === 'string' ? params.message : '';

  if (mode === 'url') {
    const url = typeof params.url === 'string' ? params.url : '';
    return { supported: true, mode: 'url', dialogPayload: { url, message } };
  }

  if (mode === 'form') {
    const schema = params.requestedSchema as
      | { type?: unknown; properties?: unknown }
      | undefined;
    if (!schema || typeof schema !== 'object' || !schema.properties) {
      return { supported: false, reason: 'form mode missing requestedSchema.properties' };
    }
    const props = schema.properties as Record<string, unknown> | undefined;
    if (!props || typeof props !== 'object') {
      return { supported: false, reason: 'requestedSchema.properties is not an object' };
    }
    const questions: Array<{
      id: string;
      question: string;
      options?: Array<{ label: string }>;
    }> = [];
    for (const [field, def] of Object.entries(props)) {
      if (!def || typeof def !== 'object') {
        return {
          supported: false,
          reason: `unsupported field type in requestedSchema: ${field}`,
        };
      }
      const d = def as { type?: unknown; enum?: unknown; description?: unknown };
      // 仅允许 string / boolean / enum(string[])
      if (d.type === 'string') {
        const q: { id: string; question: string; options?: Array<{ label: string }> } = {
          id: field,
          question:
            typeof d.description === 'string' ? d.description : field,
        };
        if (Array.isArray(d.enum)) {
          const opts = d.enum
            .filter((x): x is string => typeof x === 'string')
            .map((label) => ({ label }));
          if (opts.length > 0) q.options = opts;
        }
        questions.push(q);
      } else if (d.type === 'boolean') {
        questions.push({
          id: field,
          question: typeof d.description === 'string' ? d.description : field,
          options: [{ label: 'true' }, { label: 'false' }],
        });
      } else {
        return {
          supported: false,
          reason: `unsupported field type in requestedSchema: ${field}`,
        };
      }
    }
    return { supported: true, mode: 'form', dialogPayload: { questions } };
  }

  return { supported: false, reason: `unsupported elicitation mode: ${String(mode)}` };
}

/**
 * Codex 专属启动选项（design §5.1）。extends driver.ts 的 provider-neutral
 * `InteractiveDriverStartOptions`，补 Codex app-server 专属字段。
 */
export interface CodexStartOptions extends InteractiveDriverStartOptions {
  /**
   * D-002@V1：codex 可执行路径（必需，由 daemon `_startInteractiveSession` 从
   * `this._agentPaths.get('codex')` 注入，task-06 接线）。缺失/空串 → start 抛
   * CodexExecutableNotFoundError。
   */
  pathToAgentExecutable: string;
  /**
   * task-05（D-008@V1）：SessionManager 审批/dialog 入口注入。manualApproval=true
   * 时由 task-06 daemon 接线从 SessionManager 实例传入（requestPermission /
   * requestUserDialog 两个方法引用）。未注入时 driver 走 fail-closed 占位
   *（decline / 空 profile / cancel，绝不 accept）——保留 task-04 既有测试语义。
   *
   * manualApproval=false / askUserOnly=true 时 driver 不读此字段（普通 approval
   * 走 allow-through，不发 PERMISSION_REQUEST）；仅 user_input / 可归一化
   * elicitation 永远阻塞（需此字段，未注入则 fail-closed）。
   */
  sessionPermission?: CodexSessionPermissionHooks;
}

/**
 * Codex app-server driver 句柄。extends provider-neutral `InteractiveDriverHandle`，
 * 携带底层 child + adapter + threadId/turnId（consume/interrupt/close 用）。
 *
 * E7：本句柄含子进程资源，不可序列化、禁止落盘。
 */
export interface CodexHandle extends InteractiveDriverHandle {
  readonly provider: 'codex';
  /** 底层 spawn 句柄（close/interrupt 操作 stdin）。 */
  readonly child: ChildProcess;
  /** 复用解析（json-rpc.ts，D-002）。 */
  readonly adapter: JsonRpcAdapter;
  /** thread/start / thread/resume 后填充；所有 flat message 的 session_id。 */
  threadId: string | null;
  /** turn/started 后填充，interrupt 用；turn/completed 后清空。 */
  currentTurnId: string | null;
  /** turn/start / turn/interrupt 递增 id（≥3，避免与握手 1/2 碰撞）。 */
  nextRpcId: number;
  /** close 后置 true，拒绝新 turn/start 写入。 */
  closing: boolean;
  /** task-05 消费的待审批 server request 队列；task-04 仅登记 + fail-closed 应答。 */
  pendingServerRequests: PendingServerRequest[];
  /** 释放底层资源（关 stdin + kill child）。幂等。 */
  close(): Promise<void>;
}

/** 把 AgentEvent 转 D-004 flat message（注入 session_id=threadId）。 */
function toFlatMessage(
  ev: AgentEvent,
  threadId: string,
): Record<string, unknown> {
  return {
    event_type: ev.type,
    content: ev.content,
    metadata: ev.metadata ?? {},
    session_id: threadId,
  };
}

/**
 * task-05：permissions request 的空 profile（不扩权）。
 *
 * 任何 fail-closed / ask-only 路径都返回此 profile（fileSystem/network 均 null），
 * 禁止回授 requested profile（D-006 安全一致，design §10 风险表「自动接受权限
 * 破坏 Claude parity」）。scope 固定 'turn'（不持久化到 session）。
 */
function emptyPermissionProfile(): {
  permissions: { fileSystem: null; network: null };
  scope: 'turn';
} {
  return { permissions: { fileSystem: null, network: null }, scope: 'turn' };
}

/**
 * CodexAppServerDriver：封装 codex app-server spawn / 握手 / 多轮串行 / interrupt
 * / close（task-04，implements provider-neutral `InteractiveDriver`，D-001@V1）。
 *
 * 无状态（不持有 child；句柄以 CodexHandle 形式由 SessionManager 持有）。
 */
export class CodexAppServerDriver implements InteractiveDriver {
  /** D-001@V1：provider 标识（task-02 interrupt 路由校验用）。 */
  readonly provider = 'codex' as const;

  /** 握手每条间隔（默认 300ms 对齐 task-runner.ts；测试注入 0 加速）。 */
  private readonly handshakeIntervalMs: number;

  constructor(opts: { handshakeIntervalMs?: number } = {}) {
    this.handshakeIntervalMs =
      opts.handshakeIntervalMs ?? DEFAULT_HANDSHAKE_INTERVAL_MS;
  }

  /**
   * spawn codex app-server（不在此做握手，握手在 consume 内做：interactive 需要把
   * threadId 通过 onTurnMessage(thread_started) 回传，batch TaskRunner 是同进程轮询，
   * 两者握手时机不同）。
   *
   * @throws {CodexExecutableNotFoundError} executable 缺失
   */
  async start(
    input: AsyncIterable<UserTurnInput>,
    opts: CodexStartOptions,
  ): Promise<CodexHandle> {
    // 边界 1：executable 缺失 → 不 spawn。
    if (!opts.pathToAgentExecutable || opts.pathToAgentExecutable.trim() === '') {
      throw new CodexExecutableNotFoundError('empty pathToAgentExecutable');
    }

    const adapter = new JsonRpcAdapter('codex');
    const args = adapter.buildArgs();
    const env = (opts.env ?? { ...process.env }) as NodeJS.ProcessEnv;

    // ql-20260624-002 R-exe（修复 Windows spawn EINVAL）：agent-detector 在 Windows 给的
    // 是 codex.cmd（npm cmd-shim），直接 spawn .cmd 无 shell → CreateProcess EINVAL
    //（claude driver task-01 R-exe 同类问题，design §10 / interactive.md:38）。复用
    // cmd-shim.ts 的 resolveWindowsCmdShim（batch task-runner.ts:705-713 早在用，已支持
    // codex.cmd 模式1 = {exe:node.exe, prependArgs:[codex.js]}）解析为 node + codex.js，
    // spawn 等价原生 codex.cmd → codex.js(stdio:inherit) → 真 codex.exe；解析失败回退
    // shell:true（兜底，与 task-runner 一致）。非 .cmd（.exe / POSIX）行为不变。
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

    // 用闭包把 start options 存进 handle（consume 读），避免再定义 handle 字段污染契约。
    const ctx = {
      input,
      cwd: opts.cwd,
      model: opts.model,
      resume: opts.resume,
      // task-05（D-006/D-008）：审批策略 + SessionManager hook 注入。
      manualApproval: opts.manualApproval === true,
      askUserOnly: opts.askUserOnly === true,
      sessionPermission: opts.sessionPermission,
    };

    const handle: CodexHandle = {
      provider: 'codex',
      processId: child.pid,
      child,
      adapter,
      threadId: null,
      currentTurnId: null,
      nextRpcId: 3,
      closing: false,
      pendingServerRequests: [],
      close: (): Promise<void> => this._close(handle),
      // 扩展槽（非 CodexHandle 公共字段，consume 内部用）
      ...({ _ctx: ctx } as object),
    };

    return handle;
  }

  /**
   * 消费 codex app-server 输出流。握手 → 多轮串行 turn → close。
   */
  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const h = handle as CodexHandle;
    const ctx = (h as unknown as {
      _ctx: {
        input: AsyncIterable<UserTurnInput>;
        cwd: string;
        model?: string;
        resume?: string;
        manualApproval: boolean;
        askUserOnly: boolean;
        sessionPermission?: CodexSessionPermissionHooks;
      };
    })._ctx;
    const child = h.child;
    const onMessage = callbacks.onTurnMessage;
    const onResult = callbacks.onTurnResult;
    const onError = callbacks.onTurnError;

    // turn 协调：当前轮的 promise + resolver。发 turn/start 时创建，
    // turn/completed / 进程退出时 resolve。串行循环 await 它来阻塞下一轮。
    let currentTurnResolve: ((o: TurnOutcome) => void) | null = null;
    let currentTurnPromise: Promise<TurnOutcome> | null = null;
    // 最近一轮的 error event 缓存（failed status 时用其 message 作 result）
    let pendingTurnError: string | null = null;
    // consume 是否已最终收敛（防 exit 与 turn/completed 双触发）
    let finalized = false;

    /** 本轮 outcome（success / failed / cancelled / unknown）。 */
    type TurnOutcome = {
      kind: 'success' | 'failed' | 'cancelled' | 'unknown';
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    /** 开始一轮新 turn：重置 promise/resolver + 清 error/上报缓存。 */
    const beginTurn = (): void => {
      pendingTurnError = null;
      turnReported = false;
      currentTurnPromise = new Promise<TurnOutcome>((resolve) => {
        currentTurnResolve = resolve;
      });
    };

    /** resolve 当前轮（若存在），传 outcome。 */
    const finishTurn = (o: TurnOutcome): void => {
      if (currentTurnResolve) {
        const r = currentTurnResolve;
        currentTurnResolve = null;
        r(o);
      }
    };

    /** 本轮 turn 是否已上报 result（防同轮 turn/completed 与进程退出双触发重复）。 */
    let turnReported = false;

    /**
     * 上报单轮 turn result（幂等：每轮重置 turnReported）。
     * finalized 表示整个 consume 终态（进程异常退出 / consume 抛错），与单轮 result 分离。
     */
    const reportResult = (
      r: Parameters<NonNullable<typeof onResult>>[0],
    ): void => {
      if (finalized || turnReported) return;
      turnReported = true;
      h.currentTurnId = null;
      void onResult(r);
    };

    /** consume 终态收敛（进程异常退出 / consume 抛错）：上报 error result 后停整个循环。 */
    const finalizeWithError = (
      r: Parameters<NonNullable<typeof onResult>>[0],
    ): void => {
      if (finalized) return;
      finalized = true;
      turnReported = true;
      h.currentTurnId = null;
      void onResult(r);
    };

    // ── stderr 累积上报（边界 9，限流）──────────────────────────────────────
    let stderrBuf = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        if (h.closing) return;
        stderrBuf += chunk.toString('utf8');
        let idx: number;
        while ((idx = stderrBuf.indexOf('\n')) >= 0) {
          const line = stderrBuf.slice(0, idx);
          stderrBuf = stderrBuf.slice(idx + 1);
          if (line.trim() && onMessage && h.threadId) {
            onMessage({
              event_type: 'error',
              content: line,
              metadata: { level: 'stderr' },
              session_id: h.threadId,
            });
          }
        }
        if (stderrBuf.length > STDERR_MAX_BYTES) {
          stderrBuf = stderrBuf.slice(-STDERR_MAX_BYTES);
        }
      });
    }

    // ── 进程异常退出（边界 2/6）──────────────────────────────────────────────
    child.on('error', (err) => {
      if (onError) onError(err);
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: `codex app-server failed to start: ${(err as Error).message}`,
      });
      finishTurn({ kind: 'failed' });
    });
    child.on('exit', (code) => {
      if (h.closing) return; // 正常 close 触发的 exit
      if (code !== null && code !== 0) {
        finalizeWithError({
          subtype: 'error_during_execution',
          is_error: true,
          result: `codex exited code=${code}`,
        });
      }
      finishTurn({ kind: 'failed' });
    });

    // ── readline 行处理 ────────────────────────────────────────────────────
    if (!child.stdout) {
      // stdout 缺失（spawn 异常）→ 终态收敛。
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: 'codex app-server stdout missing',
      });
      await h.close();
      return;
    }
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const handleLine = (line: string): void => {
      if (h.closing) return;

      // 先处理 server request（task-05 异步分发到 handler + 登记），再 parse。
      // 注意：parse 也会登记到 adapter.pendingMap，我们用 handle 自己的队列。
      this._maybeRespondServerRequest(h, line, onMessage, {
        manualApproval: ctx.manualApproval,
        askUserOnly: ctx.askUserOnly,
        sessionPermission: ctx.sessionPermission,
      });

      const events = h.adapter.parse(line);
      if (!events) return;

      for (const ev of events) {
        // thread_started flat message（thread/start|resume response）：提取 threadId
        if (
          ev.type === 'text' &&
          (ev.metadata as { subtype?: string })?.subtype === 'thread_started'
        ) {
          const tid = (ev.metadata as { session_id?: string }).session_id;
          if (tid && !h.threadId) {
            h.threadId = tid;
          }
          // 上报 thread_started flat message（让 backend 对齐 agent_session_id）
          if (onMessage && h.threadId) {
            onMessage(toFlatMessage(ev, h.threadId));
          }
          continue;
        }

        // turn/started：收敛为 text+status:'running'，从原始 line 提取 turnId
        if (
          ev.type === 'text' &&
          (ev.metadata as { status?: string })?.status === 'running' &&
          (ev.metadata as { source?: string })?.source === 'turn_started'
        ) {
          this._extractTurnId(h, line);
          if (onMessage && h.threadId) {
            onMessage(toFlatMessage(ev, h.threadId));
          }
          continue;
        }

        // turn/completed：收敛为 complete event → resolve 本轮 + 不上报
        if (ev.type === 'complete') {
          const outcome = this._outcomeFromComplete(ev);
          finishTurn(outcome);
          continue; // complete 不作为 flat message
        }

        // error event：缓存（failed status 时作 result message）
        if (ev.type === 'error') {
          pendingTurnError = ev.content || null;
        }

        // 其余（text/tool_use/tool_result/error）→ flat message
        if (onMessage && h.threadId) {
          onMessage(toFlatMessage(ev, h.threadId));
        }
      }
    };

    rl.on('line', handleLine);

    try {
      // ── A. 握手（每条 300ms 间隔）─────────────────────────────────────────
      await this._handshake(h, ctx);

      // ── B/C/D. 多轮串行 ────────────────────────────────────────────────────
      // 模型：每轮 beginTurn → writeTurnStart → await currentTurnPromise →
      //      reportOutcome → 取下一条。禁止并发 turn（FR-02）。
      // resume 路径：首轮不主动 turn/start，直接进「取下一条」（即用户首次 inject）。
      const isResume = !!ctx.resume;

      // 跳过首轮 turn/start 的标志（resume 路径首轮）
      let skipFirstTurnStart = isResume;

      while (!h.closing && !finalized) {
        // 取下一条用户输入（阻塞直到有 / queue 关闭）
        const turn = await this._takeNextTurn(ctx.input);
        if (!turn) break; // input queue 结束 → 收敛
        if (h.closing || finalized) break;

        if (skipFirstTurnStart) {
          // resume 首轮：不 turn/start，但这条 inject 仍作为下一轮的输入
          skipFirstTurnStart = false;
          // resume 后第一条 inject 正常 turn/start（跳过仅针对「自动首轮」）
        }

        // 开始一轮 turn（设置 promise/resolver）
        beginTurn();
        await this._writeTurnStart(h, ctx, turn.text);
        // 等本轮 turn/completed（或进程退出 / error）
        const outcome = await currentTurnPromise!;
        // 上报本轮 result
        this._reportOutcome(outcome, pendingTurnError, reportResult);
        pendingTurnError = null;
        if (finalized) break;
      }

      // input queue 自然结束 / closing → 主循环退出，finally 内 close 释放 child。
      // 不死等 readline close（fake child 不 exit 会卡；真实场景 child exit 自然 close）。
      // 让出一拍让已入队但未处理的 stdout 行有机会跑完 handleLine。
      await new Promise<void>((r) => setImmediate(r));
    } catch (err) {
      if (onError) onError(err);
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: `codex consume error: ${(err as Error).message}`,
      });
    } finally {
      try {
        rl.close();
      } catch {
        // 已关闭 / 防御性
      }
      await h.close();
    }
  }

  /** 从 complete event 提取 outcome（含 status / usage）。 */
  private _outcomeFromComplete(ev: AgentEvent): {
    kind: 'success' | 'failed' | 'cancelled' | 'unknown';
    usage?: { input_tokens?: number; output_tokens?: number };
  } {
    const status = (ev.metadata as { turn_status?: string })?.turn_status ?? '';
    const usage = (ev.metadata as { usage?: Record<string, unknown> })?.usage;
    let kind: 'success' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
    if (status === 'completed') kind = 'success';
    else if (status === 'failed') kind = 'failed';
    else if (status === 'cancelled') kind = 'cancelled';
    const out: { kind: typeof kind; usage?: { input_tokens?: number; output_tokens?: number } } = {
      kind,
    };
    if (usage && typeof usage === 'object') {
      out.usage = {
        input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
        output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      };
    }
    return out;
  }

  /** 把 outcome 映射成 onTurnResult 调用。 */
  private _reportOutcome(
    outcome: {
      kind: 'success' | 'failed' | 'cancelled' | 'unknown';
      usage?: { input_tokens?: number; output_tokens?: number };
    },
    pendingErrorMsg: string | null,
    report: (r: Parameters<NonNullable<InteractiveDriverCallbacks['onTurnResult']>>[0]) => void,
  ): void {
    if (outcome.kind === 'success') {
      const r: Parameters<NonNullable<InteractiveDriverCallbacks['onTurnResult']>>[0] = {
        subtype: 'success',
        is_error: false,
      };
      if (outcome.usage) r.usage = outcome.usage;
      report(r);
    } else if (outcome.kind === 'failed') {
      report({
        subtype: 'error_during_execution',
        is_error: true,
        result: pendingErrorMsg ?? 'turn failed',
      });
    } else if (outcome.kind === 'cancelled') {
      report({
        subtype: 'error_during_execution',
        is_error: true,
        result: 'interrupted',
      });
    } else {
      // 边界 3：未知 status → 按 failed 降级（design §7.3）
      report({
        subtype: 'error_during_execution',
        is_error: true,
        result: `turn ended with unknown status`,
      });
    }
  }

  /**
   * 握手：initialize(1) → notifications/initialized → thread/start(2) | thread/resume(2)。
   * 每条间隔 300ms。
   */
  private async _handshake(
    h: CodexHandle,
    ctx: { cwd: string; resume?: string },
  ): Promise<void> {
    const baseHandshake = h.adapter.buildHandshake({ cwd: ctx.cwd, prompt: '' });
    const lines: string[] = [baseHandshake[0]!, baseHandshake[1]!];
    if (ctx.resume) {
      lines.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'thread/resume',
          params: { threadId: ctx.resume },
        }),
      );
    } else {
      lines.push(baseHandshake[2]!);
    }
    for (const line of lines) {
      if (h.closing) return;
      await this._writeLine(h, line);
      await new Promise<void>((r) => setTimeout(r, this.handshakeIntervalMs));
    }
  }

  /** 从原始 turn/started notification 提取 turnId（adapter 未保留）。 */
  private _extractTurnId(h: CodexHandle, line: string): void {
    try {
      const msg = JSON.parse(line) as { params?: { turnId?: unknown } };
      const tid = msg.params?.turnId;
      if (typeof tid === 'string' && tid) {
        h.currentTurnId = tid;
      }
    } catch {
      // 非 JSON 行忽略（防御性）
    }
  }

  /** 从 input queue 取下一条（阻塞直到有或 done）。 */
  private async _takeNextTurn(
    input: AsyncIterable<UserTurnInput>,
  ): Promise<UserTurnInput | null> {
    const it = input[Symbol.asyncIterator]();
    const res = await it.next();
    if (res.done) return null;
    return res.value;
  }

  /** 写 turn/start request（递增 id）。 */
  private async _writeTurnStart(
    h: CodexHandle,
    ctx: { model?: string },
    text: string,
  ): Promise<void> {
    if (h.closing || !h.threadId) return;
    const id = h.nextRpcId++;
    const params: Record<string, unknown> = {
      threadId: h.threadId,
      input: [{ type: 'text', text }],
    };
    if (ctx.model) params.model = ctx.model;
    const line = JSON.stringify({ jsonrpc: '2.0', id, method: 'turn/start', params });
    await this._writeLine(h, line);
  }

  /**
   * task-05：server request 解析 + 异步分发（替换 task-04 fail-closed 占位）。
   *
   * 解析出行是 server request（has id + method）时：登记 pendingServerRequests，
   * fire-and-forget 分发到对应 handler（不阻塞 readline 主循环——handler 内部
   * await SessionManager hook 可能挂起等用户响应）。handler 完成/失败后写 JSON-RPC
   * response + 上报 flat 日志。
   *
   * 未识别 method（非 5 类 approval/user_input/elicitation）→ JSON-RPC error
   *（-32601 method not found）+ flat error 日志，不卡 turn（design §7 第 3 点）。
   */
  private _maybeRespondServerRequest(
    h: CodexHandle,
    line: string,
    onMessage: ((m: Record<string, unknown>) => void | Promise<void>) | undefined,
    ctx: {
      manualApproval: boolean;
      askUserOnly: boolean;
      sessionPermission?: CodexSessionPermissionHooks;
    },
  ): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
    const hasMethod = Object.prototype.hasOwnProperty.call(msg, 'method');
    if (!(hasId && hasMethod)) return;

    const id = msg.id as number | string;
    const method = typeof msg.method === 'string' ? msg.method : '';
    const params = (msg.params ?? {}) as Record<string, unknown>;

    h.pendingServerRequests.push({ id, method, params, responseTemplate: null });

    const log = (m: Record<string, unknown>): void => {
      if (onMessage && h.threadId) {
        onMessage({ ...m, session_id: h.threadId });
      }
    };

    void this._dispatchServerRequest(h, { id, method, params }, ctx, log).catch(
      (err) => {
        // 边界：handler 异常（如 requestPermission hook 抛错）→ fail-closed 兜底
        // 写一条 decline/cancel/空 profile response，避免 app-server 收不到 response
        // 卡死 turn（既非 fail-closed 也非 accept）。按 method 写对应拒绝 response。
        // 不向上抛（readline 行处理不能因 server request 异常崩）。
        void this._writeFailClosedResponse(h, id, method, log).catch(() => {
          /* 连写 response 都失败：仅记 flat 日志，不抛 */
        });
        log({
          event_type: 'error',
          content: `codex server request handler error: ${method}`,
          metadata: {
            rpc_id: id,
            rpc_method: method,
            kind: 'server_request_handler_error',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      },
    );
  }

  /**
   * task-05 §dispatch fail-closed 兜底：handler 抛异常（未被内层 try 包住）时，
   * 按 method 写对应拒绝 response，避免 app-server 收不到 response 卡死 turn。
   *   - commandExecution/fileChange → { decision: 'decline' }；
   *   - permissions → 空 profile（不扩权）；
   *   - requestUserInput → { answers: {} }；
   *   - mcpElicitation → { action: 'cancel', content: null }；
   *   - 未知 method → JSON-RPC error -32603（internal error）。
   * 写完调 markResponded 释放 pending 队列条目。
   */
  private async _writeFailClosedResponse(
    h: CodexHandle,
    id: number | string,
    method: string,
    _log: (m: Record<string, unknown>) => void,
  ): Promise<void> {
    let result: unknown;
    let isError = false;
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        result = { decision: 'decline' };
        break;
      case 'item/permissions/requestApproval':
        result = emptyPermissionProfile();
        break;
      case 'item/tool/requestUserInput':
        result = { answers: {} };
        break;
      case 'mcpServer/elicitation/request':
        result = { action: 'cancel', content: null };
        break;
      default:
        isError = true;
        break;
    }
    if (isError) {
      const errorResp = {
        jsonrpc: '2.0' as const,
        id,
        error: { code: -32603, message: `internal error: ${method}` },
      };
      await this._writeLine(h, JSON.stringify(errorResp));
    } else {
      const response: CodexJsonRpcResponse = { jsonrpc: '2.0', id, result };
      await this._writeLine(h, JSON.stringify(response));
    }
    h.adapter.markResponded(id);
  }

  /**
   * task-05 §dispatch 总入口：按 method 路由到对应 handler。
   *
   * 未知 method → JSON-RPC error（-32601）+ flat error 日志，不卡 turn。
   * handler 内部负责写 JSON-RPC response + 上报 flat 日志 + markResponded。
   */
  private async _dispatchServerRequest(
    h: CodexHandle,
    req: CodexServerRequest,
    ctx: {
      manualApproval: boolean;
      askUserOnly: boolean;
      sessionPermission?: CodexSessionPermissionHooks;
    },
    log: (m: Record<string, unknown>) => void,
  ): Promise<void> {
    const respond = async (result: unknown): Promise<void> => {
      const response: CodexJsonRpcResponse = {
        jsonrpc: '2.0',
        id: req.id,
        result,
      };
      await this._writeLine(h, JSON.stringify(response));
      h.adapter.markResponded(req.id);
    };

    switch (req.method) {
      case 'item/commandExecution/requestApproval':
        await this._handleApproval(h, req, ctx, log, respond, {
          kind: 'command',
          toolName: 'codex_command_approval',
        });
        return;
      case 'item/fileChange/requestApproval':
        await this._handleApproval(h, req, ctx, log, respond, {
          kind: 'file',
          toolName: 'codex_file_change_approval',
        });
        return;
      case 'item/permissions/requestApproval':
        await this._handlePermissionsApproval(h, req, ctx, log, respond);
        return;
      case 'item/tool/requestUserInput':
        await this._handleRequestUserInput(h, req, ctx, log, respond);
        return;
      case 'mcpServer/elicitation/request':
        await this._handleMcpElicitation(h, req, ctx, log, respond);
        return;
      default: {
        // 未知 method：JSON-RPC error -32601 + flat error 日志，不卡 turn。
        const errorResp = {
          jsonrpc: '2.0' as const,
          id: req.id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
        await this._writeLine(h, JSON.stringify(errorResp));
        h.adapter.markResponded(req.id);
        log({
          event_type: 'error',
          content: `unhandled codex server request: ${req.method}`,
          metadata: {
            rpc_id: req.id,
            rpc_method: req.method,
            kind: 'unhandled_server_request',
          },
        });
      }
    }
  }

  /**
   * task-05 §2/§3：commandExecution / fileChange approval 映射。
   *
   * 策略（D-006）：
   *   - allow-through（manualApproval=false 或 askUserOnly=true）→ accept + auto_accept 日志；
   *   - full-review（manualApproval=true, askUserOnly=false）→ 调 requestPermission，
   *     allow → accept，deny/超时/fail-closed → decline。
   *   - full-review 但未注入 sessionPermission → fail-closed decline（task-04 占位兼容）。
   */
  private async _handleApproval(
    _h: CodexHandle,
    req: CodexServerRequest,
    ctx: {
      manualApproval: boolean;
      askUserOnly: boolean;
      sessionPermission?: CodexSessionPermissionHooks;
    },
    log: (m: Record<string, unknown>) => void,
    respond: (result: unknown) => Promise<void>,
    spec: { kind: 'command' | 'file'; toolName: string },
  ): Promise<void> {
    // allow-through：manualApproval=false 或 askUserOnly=true（普通 approval 不弹卡）。
    if (!ctx.manualApproval || ctx.askUserOnly) {
      await respond({ decision: 'accept' });
      log({
        event_type: 'tool_use',
        content: '',
        metadata: {
          kind: 'approval',
          auto_accept: true,
          rpc_method: req.method,
          approval_kind: spec.kind,
        },
      });
      return;
    }

    // full-review：需 sessionPermission；未注入 → fail-closed decline。
    if (!ctx.sessionPermission) {
      await respond({ decision: 'decline' });
      log({
        event_type: 'tool_use',
        content: '',
        metadata: {
          kind: 'approval',
          auto_accept: false,
          fail_closed: true,
          rpc_method: req.method,
          approval_kind: spec.kind,
          reason: 'no sessionPermission injected',
        },
      });
      return;
    }

    const decision = await ctx.sessionPermission.requestPermission({
      toolName: spec.toolName,
      toolInput: req.params,
      // 普通 approval 非用户输入类（requestPermission 内部 askUserOnly 分支已处理，
      // 但 askUserOnly=false 路径不会走 allow-through，此处 isUserInputKind 留空）。
    });
    if (decision.behavior === 'allow') {
      await respond({ decision: 'accept' });
    } else {
      await respond({ decision: 'decline' });
    }
  }

  /**
   * task-05 §4：permissions approval 映射（扩权，最敏感）。
   *
   * response 是 `permissions`（GrantedPermissionProfile）字段，**非** `decision`
   *（蓝图标红易错点）。策略：
   *   - allow-through / deny / 超时 / fail-closed → 空 profile（不扩权）；
   *   - 仅 full-review + 用户显式 allow → 回授 requested profile（scope=turn）。
   *
   * **禁止**回授 requested profile（design §10「自动接受权限破坏 Claude parity」）。
   */
  private async _handlePermissionsApproval(
    _h: CodexHandle,
    req: CodexServerRequest,
    ctx: {
      manualApproval: boolean;
      askUserOnly: boolean;
      sessionPermission?: CodexSessionPermissionHooks;
    },
    log: (m: Record<string, unknown>) => void,
    respond: (result: unknown) => Promise<void>,
  ): Promise<void> {
    const requestedProfile = req.params.permissions;

    // allow-through：不扩权，返回空 profile。
    if (!ctx.manualApproval || ctx.askUserOnly) {
      await respond(emptyPermissionProfile());
      log({
        event_type: 'tool_use',
        content: '',
        metadata: {
          kind: 'permission_request',
          auto_accept: true,
          granted: 'none',
          rpc_method: req.method,
        },
      });
      return;
    }

    // full-review 未注入 hook → 空 profile（不扩权）。
    if (!ctx.sessionPermission) {
      await respond(emptyPermissionProfile());
      log({
        event_type: 'tool_use',
        content: '',
        metadata: {
          kind: 'permission_request',
          fail_closed: true,
          granted: 'none',
          rpc_method: req.method,
          reason: 'no sessionPermission injected',
        },
      });
      return;
    }

    const decision = await ctx.sessionPermission.requestPermission({
      toolName: 'codex_permissions_approval',
      toolInput: req.params,
    });
    if (decision.behavior === 'allow') {
      // 用户显式同意才扩权，scope 限 turn（不持久化）。
      await respond({ permissions: requestedProfile, scope: 'turn' });
    } else {
      // deny / 超时 / fail → 不扩权，agent 在原 sandbox 内继续。
      await respond(emptyPermissionProfile());
    }
  }

  /**
   * task-05 §1/§5：requestUserInput 映射（D-010 双向归一化）。
   *
   * 永远阻塞（即使 ask-only，纯用户提问）。归一化 → requestUserDialog
   *（dialog_kind=codex_request_user_input）→ denormalize 还原 answers schema。
   * deny/超时/fail → 空 answers。
   */
  private async _handleRequestUserInput(
    _h: CodexHandle,
    req: CodexServerRequest,
    ctx: { sessionPermission?: CodexSessionPermissionHooks },
    _log: (m: Record<string, unknown>) => void,
    respond: (result: unknown) => Promise<void>,
  ): Promise<void> {
    const normalized = normalizeCodexRequestUserInput(req.params);
    if (!normalized.supported) {
      // 归一化失败（schema 漂移）→ fail-closed 空 answers，让 turn 继续。
      await respond({ answers: {} });
      return;
    }

    if (!ctx.sessionPermission) {
      // 未注入 hook → fail-closed 空 answers。
      await respond({ answers: {} });
      return;
    }

    const dialogResult = await ctx.sessionPermission.requestUserDialog({
      dialogKind: 'codex_request_user_input',
      dialogPayload: normalized.dialogPayload as unknown as Record<string, unknown>,
    });
    if (dialogResult.behavior !== 'completed') {
      await respond({ answers: {} });
      return;
    }
    const answers = denormalizeCodexRequestUserInputAnswers(
      normalized.questionIds,
      dialogResult.result,
    );
    await respond(answers);
  }

  /**
   * task-05 §6：MCP elicitation 映射（D-010 fail-closed）。
   *
   * 永远阻塞。normalizeMcpElicitation 判断可归一化：
   *   - 可归一化（url / 简单 form）→ requestUserDialog（dialog_kind=mcp_elicitation）
   *     → accept/decline/cancel；
   *   - 不支持 → 立即 decline + flat error 日志（不静默 accept）。
   */
  private async _handleMcpElicitation(
    _h: CodexHandle,
    req: CodexServerRequest,
    ctx: { sessionPermission?: CodexSessionPermissionHooks },
    log: (m: Record<string, unknown>) => void,
    respond: (result: unknown) => Promise<void>,
  ): Promise<void> {
    const normalized = normalizeMcpElicitation(req.params);
    if (!normalized.supported) {
      // 不支持归一化：fail-closed decline + error log（D-010 normalized_requirement）。
      await respond({ action: 'decline', content: null });
      log({
        event_type: 'error',
        content: `unsupported MCP elicitation schema: ${normalized.reason}`,
        metadata: {
          rpc_method: 'mcpServer/elicitation/request',
          kind: 'unsupported_elicitation',
          rpc_id: req.id,
        },
      });
      return;
    }

    if (!ctx.sessionPermission) {
      // 可归一化但未注入 hook → fail-closed cancel。
      await respond({ action: 'cancel', content: null });
      return;
    }

    const dialogResult = await ctx.sessionPermission.requestUserDialog({
      dialogKind: 'mcp_elicitation',
      dialogPayload: normalized.dialogPayload as unknown as Record<string, unknown>,
    });
    if (dialogResult.behavior !== 'completed') {
      // 用户 decline / 超时 / abort → cancel。
      await respond({ action: 'cancel', content: null });
      return;
    }
    // 用户 accept → 回传其输入（dialog_result）。
    await respond({ action: 'accept', content: dialogResult.result, _meta: null });
  }

  /** 安全写一行到 stdin（带 backpressure + 错误降级，边界 8）。 */
  private _writeLine(h: CodexHandle, line: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const stdin = h.child.stdin;
      if (!stdin || stdin.destroyed || h.closing) {
        resolve();
        return;
      }
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const ok = stdin.write(line + '\n', (err?: Error | null) => {
        if (err) {
          // 边界 8：写入失败 warn 不抛，由 turn 超时 / exit 检测收敛
        }
        finish();
      });
      if (!ok) {
        stdin.once('drain', finish);
      } else {
        setImmediate(finish);
      }
    });
  }

  /**
   * interrupt（FR-03）：有 currentTurnId 时发 turn/interrupt 返回 true；否则 false。
   * 不等 turn/completed，由 consume 的 turn 收敛自然结束本轮。
   */
  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (handle === null || handle === undefined) return false;
    const h = handle as CodexHandle;
    if (h.currentTurnId == null || !h.threadId || h.closing) return false;
    const id = h.nextRpcId++;
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'turn/interrupt',
      params: { threadId: h.threadId, turnId: h.currentTurnId },
    });
    try {
      await this._writeLine(h, line);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * close（FR-05 / 边界 6 idempotent）：
   *   1. closing=true 拒绝后续写入。
   *   2. stdin.end() 让 codex 优雅退出。
   *   3. SIGTERM kill + 2s 后 SIGKILL 升级。
   */
  private _close(h: CodexHandle): Promise<void> {
    if (h.closing) return Promise.resolve();
    h.closing = true;

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
