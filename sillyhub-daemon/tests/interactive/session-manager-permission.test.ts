// tests/interactive/session-manager-permission.test.ts
// scan 真阻塞（generic-wibbling-whisper.md 改造点 C+D daemon 侧）：
//   - per-session manualApproval：create input.manualApproval 决定是否注入 canUseTool
//     （实例级 manualApproval=true 仅表示"能力就绪"，chat session input.manualApproval=false 不注入，
//      避免 chat 的 AskUserQuestion 被 backend drop → 5min 超时 deny）
//   - canUseTool 分流：AskUserQuestion → register（发 PERMISSION_REQUEST，真阻塞）；
//     其他工具（Bash/Read/...）→ 立即 allow（scan 自动跑）
//
// 依据文档：C:\Users\qinyi\.claude\plans\generic-wibbling-whisper.md 改造点 C/D

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ───────────────────────────────────────────────────────────────────

/** mock driver：捕获 start 的 options（验证 canUseTool 是否注入）；提供 consume 手柄。 */
function makeDriverCapturingOpts() {
  let capturedOpts: StartOptions | null = null;
  let capturedCb: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedOpts = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCb = cb;
    }),
    interrupt: vi.fn(async (): Promise<boolean> => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    getOpts: (): StartOptions | null => capturedOpts,
    emitResult: (r: SDKResultMessage) => capturedCb?.onResult(r),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 构造一个 success result（用于 emitResult 把 status 从 running 切到 active）。 */
function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

const noopDeps = {
  onTurnResult: vi.fn(
    async (_s: string, _r: string, _res: SDKResultMessage) => {},
  ),
  onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
  onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
};

/** 检测 promise 是否在 tick 内仍 pending（未 settle）。 */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const settled = await Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  return !settled;
}

// ── per-session manualApproval ────────────────────────────────────────────────

describe('per-session manualApproval（scan 真阻塞）', () => {
  it('实例级能力就绪 + create input.manualApproval=true → 注入 canUseTool', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create({ ...BASE_INPUT, manualApproval: true });

    expect(getOpts()?.canUseTool).toBeTypeOf('function');
  });

  it('实例级能力就绪 + create input.manualApproval=false → 不注入 canUseTool', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create({ ...BASE_INPUT, manualApproval: false });

    expect(getOpts()?.canUseTool).toBeUndefined();
  });

  it('create input 不带 manualApproval → 回退实例级 true（兼容现有调用 / cli.ts 能力就绪）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create(BASE_INPUT); // 无 manualApproval 字段 → 回退实例级 true

    expect(getOpts()?.canUseTool).toBeTypeOf('function');
  });

  it('实例级 manualApproval=false（能力未启用）+ input 不带 → 不注入（安全 fail-closed）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    // 不传 opts：实例级 manualApproval 默认 false（cli.ts 未接通时的旧行为）。
    const sm = new SessionManager({ driver, ...noopDeps });
    await sm.create(BASE_INPUT);

    expect(getOpts()?.canUseTool).toBeUndefined();
  });
});

// ── canUseTool AskUserQuestion 分流 ───────────────────────────────────────────

describe('canUseTool AskUserQuestion 分流（scan 歧义阻塞）', () => {
  /**
   * 构造一个 manualApproval=true 的 session，返回注入的 canUseTool 回调 +
   * wsClient.send mock（验证 PERMISSION_REQUEST 是否发出）。
   */
  async function makeApprovalSession() {
    const { driver, getOpts, emitResult } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: sendMock },
    });
    // scan 真阻塞：manualApproval=true 注入 canUseTool + askUserOnly=true 让
    // 只有 AskUserQuestion 走人审（其他工具 allow-through）。
    await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: true });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sendMock, emitResult, sm };
  }

  it('AskUserQuestion → register 发 PERMISSION_REQUEST，promise pending（真阻塞）', async () => {
    const { canUseTool, sendMock } = await makeApprovalSession();

    const p = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: '发现 3 个子项目，请选择扫描策略',
            header: '扫描策略',
            options: [
              { label: 'A', description: '逐个独立扫描' },
              { label: 'B', description: '合并为单仓库扫描' },
            ],
          },
        ],
      },
      { signal: undefined },
    );

    // 真阻塞：没有 PERMISSION_RESPONSE 时，promise 保持 pending。
    expect(await isPending(p)).toBe(true);
    // PERMISSION_REQUEST 已发出（backend 据此 publish 审批卡 SSE）。
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(sentMsg.type).toBe('daemon:permission_request');
    expect(sentMsg.payload.tool_name).toBe('AskUserQuestion');
    // AskUserQuestion 的 input（questions）原样透传到前端渲染。
    expect(sentMsg.payload.input).toMatchObject({
      questions: expect.any(Array),
    });
  });

  it('其他工具（Bash/Read）→ 立即 allow，不发 PERMISSION_REQUEST', async () => {
    const { canUseTool, sendMock } = await makeApprovalSession();

    const decision = await canUseTool('Bash', { command: 'ls -la' }, { signal: undefined });

    expect(decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls -la' } });
    // scan 自动跑：Read/Bash/sillyspec 等不阻塞、不发审批请求。
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('PERMISSION_RESPONSE(allow + dialog_result) → canUseTool deny 回传用户答案（headless 兼容）', async () => {
    // AskUserQuestion 在 headless SDK 无法 TUI 渲染：canUseTool 拦截 → register
    // 发 PERMISSION_REQUEST，前端用户答案经 dialog_result 回传 → deny.message
    // 携带答案回喂 Claude（canUseTool 唯一回传自定义内容给 Claude 的方式）。
    const { canUseTool, sendMock, sm } = await makeApprovalSession();

    const p = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'q', options: [{ label: 'A' }, { label: 'B' }] }] },
      { signal: undefined },
    );
    expect(await isPending(p)).toBe(true);

    // 从发出的 PERMISSION_REQUEST 拿到 request_id，模拟 backend 回 allow + dialog_result（答案）。
    const sentMsg = sendMock.mock.calls[0]![0] as { payload: { request_id: string; session_id: string } };
    const resolver = sm.getPermissionResolver(BASE_INPUT.sessionId);
    expect(resolver).toBeDefined();
    const answers = { answers: [{ question: 0, answer: 'B' }] };
    resolver!.resolve(
      {
        session_id: sentMsg.payload.session_id,
        request_id: sentMsg.payload.request_id,
        decision: 'allow',
        dialog_result: answers,
      },
      BASE_INPUT.sessionId,
    );

    const decision = (await p) as { behavior: string; message?: string };
    // deny 行为：canUseTool 唯一把用户答案回传给 Claude 的方式（allow 会让 SDK 执行失败）。
    expect(decision.behavior).toBe('deny');
    // message 携带用户答案，Claude 把它当 tool_result 看到「B」继续工作。
    expect(decision.message).toContain('User answered:');
    expect(decision.message).toContain('B');
    expect(decision.message).toContain(JSON.stringify(answers));
  });

  it('AskUserQuestion PERMISSION_RESPONSE(allow 无 dialog_result) → deny 回传 fallback 答案', async () => {
    // 兼容旧 backend 不识别 dialog_result：allow 但无 dialog_result → 仍 deny，
    // message 携带 fallback「no answer payload」，让 Claude 至少看到用户已回应。
    const { canUseTool, sendMock, sm } = await makeApprovalSession();
    const p = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'q' }] },
      { signal: undefined },
    );
    expect(await isPending(p)).toBe(true);
    const sentMsg = sendMock.mock.calls[0]![0] as { payload: { request_id: string; session_id: string } };
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.resolve(
      {
        session_id: sentMsg.payload.session_id,
        request_id: sentMsg.payload.request_id,
        decision: 'allow',
      },
      BASE_INPUT.sessionId,
    );
    const decision = (await p) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('User answered:');
    expect(decision.message).toContain('no answer payload');
  });

  it('AskUserQuestion PERMISSION_RESPONSE(deny) → deny 默认 message（用户未作答，Claude 按推荐项继续）', async () => {
    // 用户在前端拒绝回答 → Claude 拿到「未作答」语义，按推荐项继续，不卡死 scan。
    const { canUseTool, sendMock, sm } = await makeApprovalSession();
    const p = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'q' }] },
      { signal: undefined },
    );
    expect(await isPending(p)).toBe(true);
    const sentMsg = sendMock.mock.calls[0]![0] as { payload: { request_id: string; session_id: string } };
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.resolve(
      {
        session_id: sentMsg.payload.session_id,
        request_id: sentMsg.payload.request_id,
        decision: 'deny',
        message: 'user cancelled',
      },
      BASE_INPUT.sessionId,
    );
    const decision = (await p) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    // message 含「未作答」语义 + 让 Claude 按推荐项继续的提示。
    expect(decision.message).toContain('did not answer');
    expect(decision.message).toContain('recommended option');
  });

  it('AskUserQuestion 5min 超时（resolver 兜底 deny）→ deny 默认 message（让 Claude 按推荐项继续）', async () => {
    // 用户长时间未响应（5min 兜底）→ 同 deny 收敛路径，Claude 按推荐项继续。
    const { canUseTool, sendMock, sm } = await makeApprovalSession();
    const p = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'q' }] },
      { signal: undefined },
    );
    expect(await isPending(p)).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    // abortAll 模拟 5min 兜底 deny（resolver 内部 reason「permission request timeout」）。
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.abortAll(
      'permission request timeout (5min fallback)',
    );
    const decision = (await p) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('did not answer');
    expect(decision.message).toContain('timeout');
  });

  it('AskUserQuestion resolver.register 抛异常 → catch 后 deny（带原因），不向上抛', async () => {
    // wrapper 自身异常防御：不让 SDK 把 wrapper 异常当 query 失败。
    const { driver, getOpts } = makeDriverCapturingOpts();
    const badResolver = {
      register: vi.fn(() => {
        throw new Error('resolver internal boom');
      }),
    } as unknown as import('../../src/interactive/permission-resolver.js').PermissionResolver;
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionResolver: badResolver,
        permissionWsClient: { send: vi.fn(() => true) },
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: true });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    const decision = (await canUseTool!(
      'AskUserQuestion',
      { questions: [{ question: 'q' }] },
      { signal: undefined },
    )) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(typeof decision.message).toBe('string');
    expect(decision.message!.length).toBeGreaterThan(0);
    expect(decision.message).toContain('boom');
  });
});

// ── onUserDialog 路由（AskUserQuestion 走对话回调而非 canUseTool）──────────────

describe('onUserDialog 路由（AskUserQuestion → PERMISSION_REQUEST 带 dialog_* → 前端答案回喂）', () => {
  /**
   * 构造一个 manualApproval=true + supportedDialogKinds（默认 AskUserQuestion）的
   * session，返回捕获到的 driver options + wsClient.send mock + resolver 句柄。
   */
  async function makeDialogSession(opts?: {
    supportedDialogKinds?: string[];
  }) {
    const { driver, getOpts, emitResult } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionWsClient: { send: sendMock },
        ...(opts?.supportedDialogKinds !== undefined
          ? { supportedDialogKinds: opts.supportedDialogKinds }
          : {}),
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: true });
    return { getOpts, sendMock, emitResult, sm };
  }

  it('manualApproval=true 默认注入 onUserDialog + supportedDialogKinds=["AskUserQuestion"]', async () => {
    const { getOpts } = await makeDialogSession();
    const opts = getOpts()!;
    expect(typeof opts.onUserDialog).toBe('function');
    expect(opts.supportedDialogKinds).toEqual(['AskUserQuestion']);
  });

  it('opts.supportedDialogKinds 显式传 → 原样注入（如多种 dialog kind）', async () => {
    const { getOpts } = await makeDialogSession({
      supportedDialogKinds: ['AskUserQuestion', 'OtherKind'],
    });
    expect(getOpts()!.supportedDialogKinds).toEqual([
      'AskUserQuestion',
      'OtherKind',
    ]);
  });

  it('opts.supportedDialogKinds=[]（空）→ 不注入 onUserDialog（显式禁用对话路由）', async () => {
    const { getOpts } = await makeDialogSession({
      supportedDialogKinds: [],
    });
    const opts = getOpts()!;
    expect(opts.onUserDialog).toBeUndefined();
    expect(opts.supportedDialogKinds).toBeUndefined();
  });

  it('onUserDialog 触发 → 发 PERMISSION_REQUEST 带 dialog_kind/dialog_payload，promise pending', async () => {
    const { getOpts, sendMock } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    const questions = [
      {
        question: '选 A 还是 B',
        header: '选择',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ];
    const p = onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: { questions } },
      { signal: undefined },
    );
    // 真阻塞：无 PERMISSION_RESPONSE 时 promise pending。
    expect(await isPending(p)).toBe(true);
    // PERMISSION_REQUEST 已发，payload 带对话字段。
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(sent.type).toBe('daemon:permission_request');
    expect(sent.payload.dialog_kind).toBe('AskUserQuestion');
    expect(sent.payload.dialog_payload).toEqual({ questions });
    // tool_name 仍标 AskUserQuestion（backend 可按工具名分发）。
    expect(sent.payload.tool_name).toBe('AskUserQuestion');
    expect(sent.payload.input).toEqual({ questions });
  });

  it('PERMISSION_RESPONSE(allow + dialog_result) → onUserDialog 回 {behavior:"completed", result: 答案}', async () => {
    const { getOpts, sendMock, sm } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    const p = onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: { questions: [] } },
      { signal: undefined },
    );
    const sent = sendMock.mock.calls[0]![0] as {
      payload: { request_id: string; session_id: string };
    };
    const answers = { answers: [{ question: 0, answer: 'B' }] };
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.resolve(
      {
        session_id: sent.payload.session_id,
        request_id: sent.payload.request_id,
        decision: 'allow',
        dialog_result: answers,
      },
      BASE_INPUT.sessionId,
    );
    expect(await p).toEqual({ behavior: 'completed', result: answers });
  });

  it('PERMISSION_RESPONSE(allow 无 dialog_result) → onUserDialog 回 {behavior:"completed", result: null}', async () => {
    const { getOpts, sendMock, sm } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    const p = onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: { questions: [] } },
      { signal: undefined },
    );
    const sent = sendMock.mock.calls[0]![0] as {
      payload: { request_id: string; session_id: string };
    };
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.resolve(
      {
        session_id: sent.payload.session_id,
        request_id: sent.payload.request_id,
        decision: 'allow',
      },
      BASE_INPUT.sessionId,
    );
    expect(await p).toEqual({ behavior: 'completed', result: null });
  });

  it('PERMISSION_RESPONSE(deny) → onUserDialog 回 {behavior:"cancelled"}（fail-closed）', async () => {
    const { getOpts, sendMock, sm } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    const p = onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: { questions: [] } },
      { signal: undefined },
    );
    const sent = sendMock.mock.calls[0]![0] as {
      payload: { request_id: string; session_id: string };
    };
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.resolve(
      {
        session_id: sent.payload.session_id,
        request_id: sent.payload.request_id,
        decision: 'deny',
        message: 'user cancelled dialog',
      },
      BASE_INPUT.sessionId,
    );
    expect(await p).toEqual({ behavior: 'cancelled' });
  });

  it('5min 超时（resolver 兜底 deny）→ onUserDialog 回 {behavior:"cancelled"}', async () => {
    const { getOpts, sendMock, sm } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    const p = onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: { questions: [] } },
      { signal: undefined },
    );
    const sent = sendMock.mock.calls[0]![0] as {
      payload: { request_id: string };
    };
    // 模拟 resolver 5min 兜底 deny（abortAll 走同一 deny 路径）。
    sm.getPermissionResolver(BASE_INPUT.sessionId)!.abortAll(
      'permission request timeout (5min fallback)',
    );
    // request_id 仅用于断言已 register，abortAll 不需要 request_id。
    expect(sent.payload.request_id).toBeDefined();
    expect(await p).toEqual({ behavior: 'cancelled' });
  });

  it('turn 结束后 onUserDialog 被触发（state 非 running）→ 立即 {behavior:"cancelled"}', async () => {
    const { getOpts, emitResult } = await makeDialogSession();
    const onUserDialog = getOpts()!.onUserDialog!;
    // 收 result → status: running → active（turn 边界已落）。
    emitResult(resultSuccess());
    const r = await onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: {} },
      { signal: undefined },
    );
    expect(r).toEqual({ behavior: 'cancelled' });
  });

  it('resolver.register 抛异常 → onUserDialog catch 后回 {behavior:"cancelled"}（不向上抛）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const badResolver = {
      register: vi.fn(() => {
        throw new Error('resolver internal boom');
      }),
    } as unknown as import('../../src/interactive/permission-resolver.js').PermissionResolver;
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionResolver: badResolver,
        permissionWsClient: { send: vi.fn(() => true) },
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: true });
    const onUserDialog = getOpts()!.onUserDialog!;
    const r = await onUserDialog(
      { dialogKind: 'AskUserQuestion', payload: {} },
      { signal: undefined },
    );
    expect(r).toEqual({ behavior: 'cancelled' });
  });
});
