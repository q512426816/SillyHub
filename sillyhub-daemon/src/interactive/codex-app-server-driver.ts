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
 * D-004 flat message 契约（task-04 起演进为 AgentEvent v2 双层形态）：
 *   onTurnMessage 上报对象 = AgentEvent v2（一等字段 type/content/subtype/session_id/
 *   usage/tool_name/call_id + metadata 开放长尾，见 types.ts AgentEvent）**叠加** legacy
 *   flat 兼容键（event_type 别名 + metadata 原样保留）。保留 legacy 键的原因：本变更
 *   （2026-09-03-agent-provider-abstraction）按 Wave 分阶段迁移——session-manager
 *   （thread_started 提取读 metadata.subtype + session_id）、daemon（interactive_codex_
 *   thread_started 日志读 event_type）、backend submit_messages（flat 分类读顶层
 *   event_type/content）要到 task-08/09 才切 AgentEvent；纯改名会让 codex 消息在
 *   中间态被 backend 静默丢弃（design §9「新 daemon + 旧 backend」窗口）。task-08/09
 *   迁移完成后可移除 event_type 别名。全部上报事件经 safeParseAgentEvent 校验通过
 *   （z.object 默认剥离未知键，event_type 别名不影响校验）。
 *   映射表见 toAgentEvent（含逐形状实读依据）。turn/completed 收敛的 complete 事件
 *   映射为 turn_result 后仅由 turn 收敛消费，不经 onMessage 上报（turn 边界信号由
 *   onTurnResult 承载，保持 D-004 原语义）。
 *
 * known-issue（AgentRunLog 无 metadata 列）：driver 仍按 D-004 上报带 metadata 的 flat
 * message（契约要求），metadata 落盘丢失是 backend/daemon 层 task-06 的事，本任务不管。
 *
 * @module interactive/codex-app-server-driver
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';
import { resolveWindowsCmdShim } from '../cmd-shim.js';
import { JsonRpcAdapter, type PendingServerRequest } from '../adapters/json-rpc.js';
import { daemonStateDir } from '../config.js';
import type { AgentEvent, AgentEventUsage } from '../types.js';
import type { CanUseToolDecision } from './types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  TurnMessageEnvelope,
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

/**
 * codex 交互 stdout 日志目录：`<daemonStateDir()>/runs/codex-interactive`。
 *
 * quick 风险审查修（2026-09-01）：SILLYHUB_DAEMON_DIR 隔离收口漏项——原直拼
 * homedir()，隔离实例的交互日志会写进真实主目录与主实例共享。导出纯函数供
 * daemon-state-dir-isolation 测试断言。
 */
export function codexInteractiveLogDir(): string {
  return join(daemonStateDir(), 'runs', 'codex-interactive');
}

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
  /**
   * ql-20260624-007：backend AgentSession id，仅用于 codex 子进程 stdout 原始行落盘
   * （~/.sillyhub/daemon/runs/codex-interactive/<sessionId>.log），下次 turn 卡死时秒级
   * 定位是「codex 没发 turn/completed」还是「被 parse 吞」。driver 不参与 turn 收敛逻辑，
   * 缺省（未注入）→ 不落盘，行为不变。由 SessionManager._buildDriverOptions 注入。
   */
  sessionId?: string;
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

// ── task-04（2026-09-03-agent-provider-abstraction）：flat message → AgentEvent v2 映射 ──
//（FR-02 / D-004；任务卡 task-04.md「event_type→type 映射表 + session_id/usage 提取」）。
// 单一映射点：consume 循环 / stderr 上报 / task-05 server request 日志全部经 toAgentEvent
// 构造上报事件，禁止旁路手拼 flat record（防止映射表外漂移）。

/**
 * toAgentEvent 的宽松输入形状（信任边界类型）。
 *
 * adapter.parse() 的静态类型虽是 AgentEvent（8 型联合），但输出未经 schema 校验，
 * 运行时可能因 codex 版本漂移出现未知 type——输入侧按 {type: string} 宽收，
 * 未知值走 toAgentEvent 内的 fail-safe 降级分支（不丢弃不抛错）。
 */
export interface CodexFlatEventInput {
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * 映射产物：AgentEvent v2 一等字段 + D-004 legacy flat 兼容键（event_type 别名）。
 *
 * 同态映射类型（保可选修饰符）而非直接 `AgentEvent & {...}`：接口交叉无隐式索引
 * 签名，不能赋给 `Record<string, unknown>`（onTurnMessage 回调入参类型）；映射类型
 * 可以（tsc scratch 实测）。task-08/09 消费面迁移后可移除别名收紧回 AgentEvent。
 */
export type CodexAgentEventMessage = { [K in keyof AgentEvent]: AgentEvent[K] } & {
  /** legacy flat 兼容键 = 输入事件的原始 type（见文件头 D-004 说明）。 */
  event_type: string;
};

/**
 * 从 metadata.usage 尽力提取 token 用量（AgentEventUsage 四字段短名）。
 *
 * 实读依据（不主动猜测字段名，对齐本文件 _outcomeFromComplete 既有守卫语义）：
 *   - metadata.usage 的来源字段名已由 adapter 归一：turn/completed 的
 *     turn.usage ?? turn.token_usage ?? turn.tokens（json-rpc.ts:788-795）与
 *     response 的 result.usage ?? result.token_usage ?? result.tokens
 *     （json-rpc.ts:412-414）都收敛进 metadata.usage；
 *   - 字段名 input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens 与
 *     本文件 _outcomeFromComplete 既有提取一致（原 :929-944，typeof 守卫）；
 *   - codex/OpenAI 系多无 cache：非 number → 不设置（后端 NULL，不伪造 0）。
 *     若 codex 未来吐 OpenAI 新字段（cached_tokens / prompt_tokens_details.cached_tokens），
 *     需在此补字段名映射（本 task 不猜，与 _outcomeFromComplete 注释同一约定）。
 */
function extractEventUsage(raw: unknown): AgentEventUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const out: AgentEventUsage = {};
  if (typeof u.input_tokens === 'number') out.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === 'number') out.output_tokens = u.output_tokens;
  if (typeof u.cache_read_tokens === 'number') out.cache_read_tokens = u.cache_read_tokens;
  if (typeof u.cache_creation_tokens === 'number') {
    out.cache_creation_tokens = u.cache_creation_tokens;
  }
  // 四字段全缺/全非法 → 不带 usage（比「全 undefined 的空壳对象」更干净，
  // 下游 isPresent 判定与既有 undefined 语义一致）
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * task-04：flat message（adapter 事件，负载在 metadata）→ AgentEvent v2 映射表。
 *
 * 输入 = adapter.parse() 产出事件 + driver 内部构造事件（stderr / task-05 审批日志）；
 * 输出 = 一等字段提升后的 AgentEvent v2 + legacy flat 键（event_type 别名，metadata
 * 原样保留——types.ts:93-95「合并提升；metadata 仍为开放长尾容器」的既定语义）。
 *
 * 映射表（逐形状实读依据；行号 = 本 worktree 当前版本）：
 * | # | 输入形状 | v2 映射 | 一等字段提升 | 实读依据 |
 * |---|---|---|---|---|
 * | 1 | text + metadata.subtype='thread_started'（thread/start·resume response 收敛） | status + subtype='session_started'（content 原样，''） | session_id ← metadata.session_id（缺省回退 threadId） | json-rpc.ts:396-409；本文件 consume thread_started 分支 |
 * | 2 | text + metadata.thinking=true（reasoning item/started 收敛） | thinking | —（call_id 留 metadata：契约 call_id 仅 tool_use/tool_result 配对，types.ts:110-112） | json-rpc.ts:626-651 |
 * | 3 | text + metadata.usage（response usage_update 收敛） | text | usage ← metadata.usage（extractEventUsage 四字段守卫） | json-rpc.ts:411-426 |
 * | 4 | text（其余：agentMessage completed / agentMessage delta flush / turn/started 收敛 text+status:'running'） | text | — | json-rpc.ts:561、579-596、737-755 |
 * | 5 | tool_use（item/started 收敛 + task-05 审批/权限/elicitation 日志） | tool_use | tool_name ← metadata.tool_name；call_id ← metadata.call_id | json-rpc.ts:489-524、652-669；本文件 _handleApproval/_handlePermissionsApproval 日志 |
 * | 6 | tool_result（item/completed 收敛） | tool_result | tool_name ← metadata.tool_name；call_id ← metadata.call_id（与 #5 同 id 配对） | json-rpc.ts:598-615 |
 * | 7 | error（rpc error response / unhandled server request / turn failed / stderr / task-05 fail-closed 日志） | error | — | json-rpc.ts:367-385、526-533、774-785；本文件 stderr 上报与 server request 日志 |
 * | 8 | complete（turn/completed 收敛，turn 终态） | turn_result | usage ← metadata.usage | json-rpc.ts:757-806；**不经 onMessage 上报**（D-004：turn 边界信号由 onTurnResult 承载，consume complete 分支仅作 turn 收敛输入） |
 * | 9 | 未知 type（防御：adapter 输出运行时漂移） | status + subtype='task_notification' 降级桶 | content='<原 type>'；metadata={original_event_type, ...原 metadata} | fail-safe，见下方降级桶说明 |
 *
 * 降级桶说明（#9）：任务卡规定的降级形态 {type:'status', content, metadata:{original_
 * event_type, ...}} 不带 subtype，但 agent-event-schema.ts 的 superRefine 强制
 * type='status' 必须携带闭合枚举 subtype（六值），否则 safeParseAgentEvent 失败、违反
 * 「全部产出事件过 schema 校验」验收。六枚举中 task_notification 语义最接近「无法归类的
 * 透传通知」，且按 design §7.5 该 subtype 走 onSessionEvent 瞬时通道（不落 AgentRunLog、
 * 不污染持久化）——选作降级桶；原值经 content + metadata.original_event_type + legacy
 * event_type 别名三处完整保留，不丢弃不抛错。已列入交付报告未决问题（建议后续变更补
 * unknown/passthrough subtype 或放宽 superRefine）。
 */
export function toAgentEvent(
  ev: CodexFlatEventInput,
  threadId: string,
): CodexAgentEventMessage {
  const metadata: Record<string, unknown> = ev.metadata ?? {};

  // #9 未知 type → status 降级桶（fail-safe：不丢弃不抛错）
  const knownTypes: readonly string[] = [
    'text', 'thinking', 'tool_use', 'tool_result',
    'status', 'error', 'turn_result', 'complete',
  ];
  if (!knownTypes.includes(ev.type)) {
    return {
      type: 'status',
      subtype: 'task_notification',
      content: ev.type,
      session_id: threadId,
      metadata: { original_event_type: ev.type, ...metadata },
      event_type: ev.type,
    };
  }

  // #8 complete → turn_result（turn 终态；是否上报由调用方决定——consume 内仅作
  // turn 收敛输入，不经 onMessage）
  if (ev.type === 'complete') {
    const usage = extractEventUsage(metadata.usage);
    return {
      type: 'turn_result',
      content: ev.content,
      session_id: threadId,
      ...(usage ? { usage } : {}),
      metadata,
      event_type: ev.type,
    };
  }

  // #1 text + thread_started → status/session_started（session_id 一等，含 resume 指针）
  if (ev.type === 'text' && metadata.subtype === 'thread_started') {
    const sid =
      typeof metadata.session_id === 'string' && metadata.session_id
        ? metadata.session_id
        : threadId;
    return {
      type: 'status',
      subtype: 'session_started',
      content: ev.content,
      session_id: sid,
      metadata,
      event_type: ev.type,
    };
  }

  // #2 text + thinking:true → thinking（codex reasoning 与 claude thinking 同契约，FR-02）
  if (ev.type === 'text' && metadata.thinking === true) {
    const usage = extractEventUsage(metadata.usage);
    return {
      type: 'thinking',
      content: ev.content,
      session_id: threadId,
      ...(usage ? { usage } : {}),
      metadata,
      event_type: ev.type,
    };
  }

  // #3-#7 恒等映射（text/tool_use/tool_result/error/status/turn_result/thinking 直传）；
  // tool_use/tool_result 额外提升 tool_name/call_id（配对语义）
  const out: CodexAgentEventMessage = {
    type: ev.type as AgentEvent['type'],
    content: ev.content,
    session_id: threadId,
    metadata,
    event_type: ev.type,
  };
  const usage = extractEventUsage(metadata.usage);
  if (usage) out.usage = usage;
  if (ev.type === 'tool_use' || ev.type === 'tool_result') {
    if (typeof metadata.call_id === 'string' && metadata.call_id) {
      out.call_id = metadata.call_id;
    }
    if (typeof metadata.tool_name === 'string' && metadata.tool_name) {
      out.tool_name = metadata.tool_name;
    }
  }
  return out;
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
      // ql-20260624-007：透传 sessionId 供 consume 落盘 stdout 诊断日志。
      sessionId: opts.sessionId,
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
        sessionId?: string;
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
    // ql-20260624-007：codex stdout 原始行落盘流（ctx.sessionId 缺省时为 null，不落盘）。
    // fire-and-forget，诊断 turn/completed 是否到达 / 被 parse 吞，绝不影响主流程。
    let stdoutLogStream: WriteStream | null = null;

    /** 本轮 outcome（success / failed / cancelled / unknown）。 */
    type TurnOutcome = {
      kind: 'success' | 'failed' | 'cancelled' | 'unknown';
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        // task-02（D-001@v1）：尽力而为 cache 字段（短名，对齐后端契约）。
        // codex/OpenAI 系多无 cache，取不到即 undefined → 后端 NULL，不伪造 0。
        cache_read_tokens?: number;
        cache_creation_tokens?: number;
      };
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
      // ql-20260825-f3#6：fire-and-forget 上报补 .catch——回调 reject 若无人接会成
      // unhandled rejection（cli.ts 有全局兜底但会打 FATAL），记 error 日志即可。
      // Promise.resolve 包裹：回调签名允许同步 void，统一成 Promise 再挂 catch。
      Promise.resolve(onResult(r)).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[codex-app-server-driver] onTurnResult callback failed', err);
      });
    };

    /** consume 终态收敛（进程异常退出 / consume 抛错）：上报 error result 后停整个循环。 */
    const finalizeWithError = (
      r: Parameters<NonNullable<typeof onResult>>[0],
    ): void => {
      if (finalized) return;
      finalized = true;
      turnReported = true;
      h.currentTurnId = null;
      // ql-20260825-f3#6：同 reportResult，补 .catch 防 unhandled rejection。
      Promise.resolve(onResult(r)).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[codex-app-server-driver] onTurnResult callback failed', err);
      });
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
            // stderr 行 → error 事件（映射表 #7，经 toAgentEvent 单一映射点构造；
            // task-08 envelope 包装：单事件成批 events:[ev]，不动 task-04 映射）
            onMessage({
              events: [
                toAgentEvent(
                  { type: 'error', content: line, metadata: { level: 'stderr' } },
                  h.threadId,
                ),
              ],
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
    child.on('exit', (code, signal) => {
      if (h.closing) return; // 正常 close 触发的 exit
      // 第四批 code-quality：任何非 daemon 主动 close 的退出都视为异常收敛（对称于
      // 上方 'error' handler）。修前仅 code!==0 才 finalizeWithError → code=0 干净
      // 退出 / code=null 被信号杀（OOM / SIGKILL）时不置 finalized，consume 主循环
      // while(!h.closing && !finalized) 永不退出、currentTurnPromise 永不 resolve
      // → 交互式会话永久卡死（主 agent lease 永不过期，卡到 daemon 重启）。
      // finalizeWithError 幂等（上方 finalized 守卫），'error'+'exit' 双触发安全。
      const exitDesc =
        code === null
          ? `codex killed by signal ${signal ?? 'unknown'}`
          : `codex exited code=${code}`;
      finalizeWithError({
        subtype: 'error_during_execution',
        is_error: true,
        result: exitDesc,
      });
      finishTurn({ kind: 'failed' });
      // 2026-08-24 会话审查 P2b（daemon H2）：进程非正常退出还需会话级收敛——
      // 只 finalizeWithError（turn 级）时 session-manager 侧会话仍 active，consume
      // 退出后无任何消费者，后续 inject 全部入无人消费的队列、turn 永不结束
      // （前端永久转圈）。onError → session-manager fail()（幂等，正常 end 路径
      // 已终态直接 return）→ onSessionEnd 上报 backend 收敛。
      if (onError) onError(new Error(exitDesc));
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

      // ql-20260624-007：原始 stdout 行落盘（解析前记录 codex 实际发出的每行，
      // 下次 turn 卡死时对照看 turn/completed 是否到达 / payload 长啥样）。
      if (stdoutLogStream) {
        try {
          stdoutLogStream.write(line + '\n');
        } catch {
          // 静默：日志失败绝不影响主流程
        }
      }

      // 先处理 server request（task-05 异步分发到 handler + 登记），再 parse。
      // 注意：parse 也会登记到 adapter.pendingMap，我们用 handle 自己的队列。
      this._maybeRespondServerRequest(h, line, onMessage, {
        manualApproval: ctx.manualApproval,
        askUserOnly: ctx.askUserOnly,
        sessionPermission: ctx.sessionPermission,
      });

      // D2（健壮性修复，2026-07-24）：parse 包 try/catch——畸形行让 adapter.parse 抛
      // 异常时，readline 'line' 回调未捕获异常会被 cli.ts 全局处理器吞掉，但
      // currentTurnPromise 永不 resolve → 交互式会话永久卡死。对齐 task-runner.ts:1420：
      // 记 warn 后 return，让行循环存活、当前 turn 可正常收尾。
      let events: ReturnType<typeof h.adapter.parse> | null = null;
      try {
        events = h.adapter.parse(line);
      } catch (e) {
        console.warn('codex_driver: parse_error', line.slice(0, 100), e);
        return;
      }
      if (!events) return;

      for (const ev of events) {
        // thread_started 事件（thread/start|resume response 收敛）：提取 threadId
        if (
          ev.type === 'text' &&
          (ev.metadata as { subtype?: string })?.subtype === 'thread_started'
        ) {
          const tid = (ev.metadata as { session_id?: string }).session_id;
          if (tid && !h.threadId) {
            h.threadId = tid;
          }
          // 上报 status/session_started 事件（映射表 #1；让 backend 对齐 agent_session_id）
          if (onMessage && h.threadId) {
            // task-08：envelope 包装（单事件成批）。
            onMessage({ events: [toAgentEvent(ev, h.threadId)] });
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
            // task-08：envelope 包装（单事件成批）。
            onMessage({ events: [toAgentEvent(ev, h.threadId)] });
          }
          continue;
        }

        // turn/completed：complete → turn_result 映射（映射表 #8）后 resolve 本轮；
        // 不经 onMessage 上报（turn 边界信号由 onTurnResult 承载，D-004 原语义）
        if (ev.type === 'complete') {
          const outcome = this._outcomeFromComplete(toAgentEvent(ev, h.threadId ?? ''));
          finishTurn(outcome);
          continue; // turn_result 不作为上报消息
        }

        // error event：缓存（failed status 时作 result message）
        if (ev.type === 'error') {
          pendingTurnError = ev.content || null;
        }

        // 其余（text/thinking 提升后/tool_use/tool_result/error）→ AgentEvent 上报
        if (onMessage && h.threadId) {
          // task-08：envelope 包装（单事件成批）。
          onMessage({ events: [toAgentEvent(ev, h.threadId)] });
        }
      }
    };

    rl.on('line', handleLine);

    try {
      // ql-20260624-007：sessionId 存在时建 codex stdout 落盘流（fire-and-forget）。
      // 落盘到 <daemonStateDir()>/runs/codex-interactive/<sessionId>.log（默认
      // ~/.sillyhub/daemon 下；quick 风险审查修——原直拼 homedir() 是
      // SILLYHUB_DAEMON_DIR 隔离收口漏项，隔离实例交互日志会写进真实主目录）。
      if (ctx.sessionId) {
        try {
          const logDir = codexInteractiveLogDir();
          await mkdir(logDir, { recursive: true });
          const stream = createWriteStream(join(logDir, `${ctx.sessionId}.log`), {
            flags: 'a',
          });
          stream.on('error', () => {
            // 静默：日志流错误绝不影响主流程
          });
          stdoutLogStream = stream;
        } catch {
          stdoutLogStream = null;
        }
      }

      // ── A. 握手（每条 300ms 间隔）─────────────────────────────────────────
      await this._handshake(h, ctx);

      // ── B/C/D. 多轮串行 ────────────────────────────────────────────────────
      // 模型：每轮 beginTurn → writeTurnStart → await currentTurnPromise →
      //      reportOutcome → 取下一条。禁止并发 turn（FR-02）。
      // resume 路径：首轮不主动 turn/start，直接进「取下一条」（即用户首次 inject）。
      const isResume = !!ctx.resume;

      // 跳过首轮 turn/start 的标志（resume 路径首轮）
      let skipFirstTurnStart = isResume;

      // 输入队列单订阅：整个 consume 生命周期只 [Symbol.asyncIterator]() 一次
      //（InputQueue 第二次订阅抛 SessionQueueDoubleSubscribeError）。迭代器在
      // 循环外创建，循环内只 next()——此前每轮重订阅，第二轮输入必抛错致会话失败。
      const inputIt = ctx.input[Symbol.asyncIterator]();

      while (!h.closing && !finalized) {
        // 取下一条用户输入（阻塞直到有 / queue 关闭）
        const turn = await this._takeNextTurn(inputIt);
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
        stdoutLogStream?.end();
      } catch {
        // 防御性：日志流关闭失败不影响主流程
      }
      try {
        rl.close();
      } catch {
        // 已关闭 / 防御性
      }
      await h.close();
    }
  }

  /**
   * 从 turn_result 事件（complete 经 toAgentEvent 映射，映射表 #8）提取 outcome。
   *
   * task-04 改造：usage 已由 toAgentEvent → extractEventUsage 从 metadata.usage 提升
   * 为一等字段（四字段 number 守卫，语义与原实现逐字段一致——非 number 不设置、
   * 不伪造 0，缺 cache → undefined 后端按 NULL 处理）；turn_status 仍在 metadata
   * （开放长尾，非一等字段）。
   */
  private _outcomeFromComplete(ev: AgentEvent): {
    kind: 'success' | 'failed' | 'cancelled' | 'unknown';
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
    };
  } {
    const status = (ev.metadata as { turn_status?: string })?.turn_status ?? '';
    let kind: 'success' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
    if (status === 'completed') kind = 'success';
    else if (status === 'failed') kind = 'failed';
    else if (status === 'cancelled') kind = 'cancelled';
    const out: {
      kind: typeof kind;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        cache_creation_tokens?: number;
      };
    } = { kind };
    if (ev.usage) {
      out.usage = { ...ev.usage };
    }
    return out;
  }

  /** 把 outcome 映射成 onTurnResult 调用。 */
  private _reportOutcome(
    outcome: {
      kind: 'success' | 'failed' | 'cancelled' | 'unknown';
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        cache_creation_tokens?: number;
      };
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

  /** 从 input 迭代器取下一条（阻塞直到有或 done）。
   *
   * 迭代器由调用方在多轮循环外创建一次后传入（InputQueue 单订阅语义，
   * 第二次 [Symbol.asyncIterator]() 抛 SessionQueueDoubleSubscribeError）。 */
  private async _takeNextTurn(
    input: AsyncIterator<UserTurnInput>,
  ): Promise<UserTurnInput | null> {
    const res = await input.next();
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
    onMessage:
      | ((envelope: TurnMessageEnvelope) => void | Promise<void>)
      | undefined,
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

    // task-04：审批/错误日志统一经 toAgentEvent 映射后上报（单一映射点，session_id
    // 由映射函数注入，不再手拼 flat record）
    const log = (ev: CodexFlatEventInput): void => {
      if (onMessage && h.threadId) {
        // task-08：envelope 包装（单事件成批）。
        onMessage({ events: [toAgentEvent(ev, h.threadId)] });
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
          type: 'error',
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
   * ql-20260825-f3#4：server request 应答后的统一收口清理。
   *
   * 原 `_maybeRespondServerRequest` 只往 `h.pendingServerRequests` push，应答路径
   * （respond 闭包 / fail-closed / 未知 method）只删 `adapter.pendingMap` → handle
   * 数组只增不减，长会话（每次 approval/elicitation 各一条）内存泄漏。所有写完
   * JSON-RPC response 的出口都必须经本方法：adapter.pendingMap 删（TaskRunner
   * 消费接口语义不变）+ handle 数组按 id 摘除（pending 语义 = 已登记未应答）。
   */
  private _markServerRequestResponded(
    h: CodexHandle,
    id: number | string,
  ): void {
    h.adapter.markResponded(id);
    const idx = h.pendingServerRequests.findIndex((p) => p.id === id);
    if (idx >= 0) {
      h.pendingServerRequests.splice(idx, 1);
    }
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
    _log: (ev: CodexFlatEventInput) => void,
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
    // ql-20260825-f3#4：应答后同步摘除 handle.pendingServerRequests 条目。
    this._markServerRequestResponded(h, id);
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
    log: (ev: CodexFlatEventInput) => void,
  ): Promise<void> {
    const respond = async (result: unknown): Promise<void> => {
      const response: CodexJsonRpcResponse = {
        jsonrpc: '2.0',
        id: req.id,
        result,
      };
      await this._writeLine(h, JSON.stringify(response));
      // ql-20260825-f3#4：应答后同步摘除 handle.pendingServerRequests 条目。
      this._markServerRequestResponded(h, req.id);
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
        // ql-20260825-f3#4：应答后同步摘除 handle.pendingServerRequests 条目。
        this._markServerRequestResponded(h, req.id);
        log({
          type: 'error',
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
    log: (ev: CodexFlatEventInput) => void,
    respond: (result: unknown) => Promise<void>,
    spec: { kind: 'command' | 'file'; toolName: string },
  ): Promise<void> {
    // allow-through：manualApproval=false 或 askUserOnly=true（普通 approval 不弹卡）。
    if (!ctx.manualApproval || ctx.askUserOnly) {
      await respond({ decision: 'accept' });
      log({
        type: 'tool_use',
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
        type: 'tool_use',
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
    log: (ev: CodexFlatEventInput) => void,
    respond: (result: unknown) => Promise<void>,
  ): Promise<void> {
    const requestedProfile = req.params.permissions;

    // allow-through：不扩权，返回空 profile。
    if (!ctx.manualApproval || ctx.askUserOnly) {
      await respond(emptyPermissionProfile());
      log({
        type: 'tool_use',
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
        type: 'tool_use',
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
    _log: (ev: CodexFlatEventInput) => void,
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
    log: (ev: CodexFlatEventInput) => void,
    respond: (result: unknown) => Promise<void>,
  ): Promise<void> {
    const normalized = normalizeMcpElicitation(req.params);
    if (!normalized.supported) {
      // 不支持归一化：fail-closed decline + error log（D-010 normalized_requirement）。
      await respond({ action: 'decline', content: null });
      log({
        type: 'error',
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
