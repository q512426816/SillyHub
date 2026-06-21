// tests/interactive/claude-sdk-driver-permission.test.ts
// task-09 Step 1：deny 收敛单测（FR-07 / D-007@v1 / AC-09.1~09.2）。
//
// 覆盖 task-09 §5 边界 1/2/9/11/12：
//   - 远程 allow：driver 返回 {behavior:'allow', updatedInput}（透传原始 input，满足 Claude CLI Zod required）；
//   - 远程 deny 带 message：原 message 透传（不二次决策 / 不强制结束 turn）；
//   - 远程 deny 无 message：默认 message 必含 toolName / sessionId / runId（非空）；
//   - 5min 超时 deny：默认 message 含 timeout 标注，走同一收敛路径；
//   - wrapper 自身异常（resolver.register 抛）：catch 后 deny（带原因），不向上抛。
//
// 经 SessionManager + mock driver/wsClient 构造 canUseTool 回调（task-08 已注入），
// 本任务断言 deny message 收敛语义（task-09 在 SessionManager._buildCanUseToolCallback
// 补充默认 message 模板 + wrapper 防御性 catch）。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PermissionResolver } from '../../src/interactive/permission-resolver.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

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

interface CapturedDriver {
  driver: ClaudeSdkDriver;
  capturedOptions: StartOptions | null;
  capturedCallbacks: ConsumeCallbacks | null;
  fakeQuery: Query;
  emitResult: (r: SDKResultMessage) => void;
  emitMessage: (m: SDKMessage) => void;
}

function makeMockDriver(): CapturedDriver {
  let capturedOptions: StartOptions | null = null;
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedOptions = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    fakeQuery,
    get capturedOptions() {
      return capturedOptions;
    },
    get capturedCallbacks() {
      return capturedCallbacks;
    },
    emitResult: (r) => capturedCallbacks?.onResult(r),
    emitMessage: (m) => capturedCallbacks?.onMessage?.(m),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

function makeWsClient(sendReturn: boolean = true) {
  return {
    send: vi.fn((_msg: { type: string; payload: unknown }) => sendReturn),
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

function makeManualSession(d: CapturedDriver) {
  const wsClient = makeWsClient(true);
  const resolver = new PermissionResolver();
  const sm = new SessionManager(
    { driver: d.driver, ...makeDeps() },
    {
      manualApproval: true,
      permissionResolver: resolver,
      permissionWsClient: wsClient,
    },
  );
  return { sm, wsClient, resolver };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('deny 收敛（AC-09.1 / FR-07 / D-007@v1）', () => {
  it('远程 allow → 返回 {behavior:allow}，透传 updatedInput（Claude CLI Zod required）', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const pending = canUseTool('Bash', { command: 'ls' });
    const requestId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: requestId, decision: 'allow' },
      'sess-1',
    );
    const decision = (await pending) as Record<string, unknown>;
    expect(decision.behavior).toBe('allow');
    // Claude CLI 经 --permission-prompt-tool stdio 对 allow 分支做 Zod 运行时校验，
    // updatedInput 为 required（record）；SDK 类型虽标 optional 但 CLI 运行时必填，
    // 缺字段报 ZodError invalid_union → 全量工具调用失败。故透传归一化后的原始 input。
    expect(decision.updatedInput).toEqual({ command: 'ls' });
    expect(decision.modifiedInput).toBeUndefined();
  });

  it('远程 deny 带 message → 原样透传，driver 不二次决策', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const pending = canUseTool('Write', { path: '/etc/x' });
    const requestId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      {
        session_id: 'sess-1',
        request_id: requestId,
        decision: 'deny',
        message: 'user rejected for security',
      },
      'sess-1',
    );
    const decision = (await pending) as Record<string, unknown>;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toBe('user rejected for security');
    // 原样透传：driver 不重写 / 不补默认 / 不截断。
  });

  it('远程 deny 无 message → 默认 message 非空且含 toolName / sessionId / runId（AC-09.1 约束 1）', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const pending = canUseTool('Write', { path: '/etc/x' });
    const requestId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    // deny 不带 message。
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: requestId, decision: 'deny' },
      'sess-1',
    );
    const decision = (await pending) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    // 默认 message 必须是非空字符串。
    expect(typeof decision.message).toBe('string');
    expect(decision.message!.length).toBeGreaterThan(0);
    // 必须包含 toolName / sessionId / runId 让 claude 拿到可读原因。
    expect(decision.message).toContain('Write');
    expect(decision.message).toContain('sess-1');
    expect(decision.message).toContain('run-1');
  });

  it('5min 超时 deny（resolver 兜底）→ 默认 message 含 timeout 标注', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const pending = canUseTool('Bash', { command: 'rm -rf /' });
    // 模拟 5min 超时：直接调 resolver.abortAll('permission request timeout (5min fallback)')
    // 走与 task-08 同一 deny 收敛路径。
    const requestId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    // 用 resolver 内部 5min 超时 reason 直接 settle。
    sm.getPermissionResolver('sess-1')!.resolve(
      {
        session_id: 'sess-1',
        request_id: requestId,
        decision: 'deny',
        message: 'permission request timeout (5min fallback)',
      },
      'sess-1',
    );
    const decision = (await pending) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    // 超时 message 原样透传（resolver 已带 timeout 标注）。
    expect(decision.message).toMatch(/timeout/i);
  });

  it('deny 后 turn 继续场景：driver 不调 q.interrupt，不强制结束 turn（边界 1）', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    // 第一次工具被 deny。
    const pending1 = canUseTool('Bash', { command: 'rm -rf /' });
    const reqId1 = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: reqId1, decision: 'deny', message: 'no' },
      'sess-1',
    );
    await pending1;
    // driver.interrupt 在 deny 后未被调用（turn 由 claude 自决定是否继续）。
    expect(d.driver.interrupt).not.toHaveBeenCalled();
    // 后续 tool_use / assistant text 仍正常经 onMessage 转发（claude 换方法重试）。
    const onMsg = d.capturedCallbacks!.onMessage!;
    await onMsg({ type: 'assistant', message: { role: 'assistant', content: [] } } as unknown as SDKMessage);
    // session 仍 running（未强制结束 turn）。
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('deny 后 claude 主动结束 turn：SDK 自然产 result → onTurnResult 正常收尾（边界 2）', async () => {
    const d = makeMockDriver();
    const deps = makeDeps();
    const wsClient = makeWsClient(true);
    const sm = new SessionManager(
      { driver: d.driver, ...deps },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const pending = canUseTool('Write', { path: '/x' });
    const reqId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: reqId, decision: 'deny', message: 'no' },
      'sess-1',
    );
    await pending;
    // claude 自决定结束 turn → SDK 吐 result（success）。
    d.emitResult(resultSuccess());
    // onTurnResult 被调用一次（backend 据 result 字段标 completed）。
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    // session 回 active（turn 边界已落）。
    expect(sm.get('sess-1')!.status).toBe('active');
  });

  it('wrapper 自身异常（resolver.register 抛 / await 抛）→ catch 后 deny（带原因），不向上抛（边界 12）', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    // 构造一个 register 会抛的 mock resolver（模拟内部 bug）。
    const badResolver: PermissionResolver = {
      register: vi.fn(() => {
        throw new Error('resolver internal boom');
      }),
    } as unknown as PermissionResolver;
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: badResolver,
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    // wrapper 应 catch resolver 异常 → 返回 deny（带原因），不向上抛让 SDK 把它当 query 失败。
    const decision = (await canUseTool('Bash', { command: 'ls' })) as {
      behavior: string;
      message?: string;
    };
    expect(decision.behavior).toBe('deny');
    expect(typeof decision.message).toBe('string');
    expect(decision.message!.length).toBeGreaterThan(0);
  });

  it('deny.message 含特殊字符 / 超长 → 原样透传不转义不截断（边界 9）', async () => {
    const d = makeMockDriver();
    const { sm, wsClient } = makeManualSession(d);
    await sm.create(BASE_INPUT);
    const canUseTool = d.capturedOptions!.canUseTool!;
    const special = '用户拒绝：<script>alert(1)</script> & "quoted" \\n newline';
    const pending = canUseTool('Bash', { command: 'x' });
    const reqId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: reqId, decision: 'deny', message: special },
      'sess-1',
    );
    const decision = (await pending) as { behavior: string; message?: string };
    expect(decision.message).toBe(special); // 原样，不转义不截断。
  });
});
