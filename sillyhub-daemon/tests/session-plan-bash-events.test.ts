// tests/session-plan-bash-events.test.ts
// task-11: HubClient 4 notify 方法 HTTP 契约 + session-manager turn 事件检测。
//
// 策略：
//   - HubClient notify 方法：vi.stubGlobal('fetch') mock，验证 URL/method/auth header/body。
//   - Session-manager 事件检测：mock driver 捕获 onTurnMessage 回调，直接触发模拟
//     SDK 消息，断言 deps.onSessionEvent 被正确调用。
//   - 覆盖边界：重复 tool_use_id 幂等、未知 tool_use_id 忽略、HubHttpError 透传。
//   - 不发起真实网络请求。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, HubHttpError } from '../src/hub-client';
import { REST_PREFIX } from '../src/protocol';
import { SessionManager } from '../src/interactive/session-manager';
import { ClaudeEventNormalizer } from '../src/interactive/claude-events';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
} from '../src/interactive/driver';
import type { SessionManagerDeps } from '../src/interactive/types';

// ═══════════════════════════════════════════════════════════════════════════════
// HubClient notify 方法：fetch mock 工具
// ═══════════════════════════════════════════════════════════════════════════════

let lastCall: { url: string; init: RequestInit } | null = null;

function mockFetchOk(body: unknown, status = 200): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function mockFetchStatus(status: number, bodyText: string): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(bodyText, { status });
  }) as typeof fetch;
}

beforeEach(() => { lastCall = null; });
afterEach(() => { vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1: HubClient 4 notify 方法 HTTP 契约
// ═══════════════════════════════════════════════════════════════════════════════

describe('HubClient — session feedback 4 notify 方法 URL/method/鉴权/body', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('notifyPlanModeEntered: POST /sessions/{id}/plan-mode-entered + body {session_id, run_id, summary}', async () => {
    const c = new HubClient('http://x:8000', 'token-1');
    await c.notifyPlanModeEntered('sess-p1', 'run-p1', {
      objective: '实现功能 X',
      tasks: ['分析需求', '编码实现'],
      design_snippet: '§5.3 概要',
    });
    expect(lastCall!.url).toBe(
      `http://x:8000${REST_PREFIX}/sessions/sess-p1/plan-mode-entered`,
    );
    expect(lastCall!.init.method).toBe('POST');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-1');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      session_id: 'sess-p1',
      run_id: 'run-p1',
      summary: {
        objective: '实现功能 X',
        tasks: ['分析需求', '编码实现'],
        design_snippet: '§5.3 概要',
      },
    });
  });

  it('notifyBashStatus: POST /sessions/{id}/bash-status + body {session_id, run_id, command, status} + url encode', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyBashStatus('sess-b1', 'run-b1', 'ls -la', 'running');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/sessions/sess-b1/bash-status`);
    expect(lastCall!.init.method).toBe('POST');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      session_id: 'sess-b1',
      run_id: 'run-b1',
      command: 'ls -la',
      status: 'running',
    });
  });

  it('notifyBashStatus: exit_code/elapsed_ms 可选字段守卫 — 未提供时不写入 body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyBashStatus('s', 'r', 'echo hi', 'running');
    const body = JSON.parse(lastCall!.init.body as string);
    expect('exit_code' in body).toBe(false);
    expect('elapsed_ms' in body).toBe(false);
  });

  it('notifyBashStatus: exit_code/elapsed_ms 提供时写入 body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyBashStatus('s', 'r', 'echo hi', 'completed', 0, 1500);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.exit_code).toBe(0);
    expect(body.elapsed_ms).toBe(1500);
  });

  it('notifyBashChunk: POST /sessions/{id}/bash-chunk + body 含 channel/content/is_final', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyBashChunk('sess-bc', 'run-bc', 'cat file.txt', 'stdout', 'line1\n', false);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/sessions/sess-bc/bash-chunk`);
    expect(lastCall!.init.method).toBe('POST');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      session_id: 'sess-bc',
      run_id: 'run-bc',
      command: 'cat file.txt',
      channel: 'stdout',
      content: 'line1\n',
      is_final: false,
    });
  });

  it('notifyAgentTaskStatus: POST /sessions/{id}/agent-task-status + body 含 task_id/task_name/status', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyAgentTaskStatus('sess-at', 'run-at', 'task-1', '实现模块A', 'running');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/sessions/sess-at/agent-task-status`);
    expect(lastCall!.init.method).toBe('POST');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      session_id: 'sess-at',
      run_id: 'run-at',
      task_id: 'task-1',
      task_name: '实现模块A',
      status: 'running',
    });
  });

  it('notifyAgentTaskStatus: progress/message 可选字段守卫 — 未提供时不写入 body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyAgentTaskStatus('s', 'r', 't1', 'task', 'completed');
    const body = JSON.parse(lastCall!.init.body as string);
    expect('progress' in body).toBe(false);
    expect('message' in body).toBe(false);
  });

  it('notifyAgentTaskStatus: progress/message 提供时写入 body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyAgentTaskStatus('s', 'r', 't1', 'task', 'running', 50, '进行中');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.progress).toBe(50);
    expect(body.message).toBe('进行中');
  });

  it('notifyAgentTaskStatus: 鉴权走 X-API-Key（daemon 长期凭证）', async () => {
    const c = new HubClient('http://x:8000', { apiKey: 'shk_daemon' });
    await c.notifyAgentTaskStatus('s', 'r', 't1', 'task', 'running');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('shk_daemon');
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HubClient notify 方法：错误处理 + HubHttpError 透传
// ═══════════════════════════════════════════════════════════════════════════════

describe('HubClient — session feedback notify 方法错误处理', () => {
  it('notifyPlanModeEntered 非 2xx → HubHttpError 含 status/method', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(404, 'session not found'));
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifyPlanModeEntered('no-such', 'r1', { objective: '', tasks: [] }),
    ).rejects.toMatchObject({ name: 'HubHttpError', status: 404, method: 'POST' });
  });

  it('notifyBashStatus 网络错误透传（TypeError，不包装为 HubHttpError）', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifyBashStatus('s', 'r', 'cmd', 'running'),
    ).rejects.toThrow(TypeError);
    await expect(
      c.notifyBashStatus('s', 'r', 'cmd', 'running'),
    ).rejects.not.toBeInstanceOf(HubHttpError);
  });

  it('notifyBashChunk 500 → HubHttpError', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(500, 'internal error'));
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifyBashChunk('s', 'r', 'cmd', 'stdout', 'data', true),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('notifyAgentTaskStatus 403 → HubHttpError', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(403, 'forbidden'));
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifyAgentTaskStatus('s', 'r', 't1', 'task', 'running'),
    ).rejects.toMatchObject({ status: 403, method: 'POST' });
  });

  it('notifyPlanModeEntered: sessionId 含斜杠时 URL encode', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ ok: true }));
    const c = new HubClient('http://x:8000', 't');
    await c.notifyPlanModeEntered('s/1', 'r1', { objective: '', tasks: [] });
    expect(lastCall!.url).toContain('/sessions/s%2F1/plan-mode-entered');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: session-manager turn 事件检测
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 构造最小可用的 SessionManager + fake driver，捕获 _runConsume 注入的 onTurnMessage 回调。
 *
 * create() 触发 _runConsume → driver.consume(callbacks) 捕获 onTurnMessage；
 * 调用 onTurnMessage(msg) 相当于 driver 推送一条消息进 _onMessage 处理链。
 *
 * AgentEvent v2（2026-09-03-agent-provider-abstraction）：归一化下沉 driver，
 * onTurnMessage 契约改为 TurnMessageEnvelope{events}，session-manager 不再解析
 * raw SDK 消息。本文件保持「喂原始 SDK 消息」的端到端口径——捕获回调包一层
 * 真实 ClaudeEventNormalizer（raw → 归一化 events → envelope → _onMessage 分发
 * → onSessionEvent），与 claude driver 生产路径同构。
 */
function createSessionManagerWithFakeDriver(onSessionEvent?: SessionManagerDeps['onSessionEvent']) {
  let capturedOnTurnMessage: ((msg: Record<string, unknown>) => Promise<void>) | null = null;
  let startResolved = false;

  const normalizer = new ClaudeEventNormalizer({ onPartialFlush: () => {} });

  const fakeDriver: InteractiveDriver = {
    provider: 'claude',
    async start() {
      startResolved = true;
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(_handle, callbacks: InteractiveDriverCallbacks) {
      // _runConsume 内部对 callbacks.onTurnMessage 包了一层 orphan 守卫后转发 _onMessage；
      // 直接捕获原始 onTurnMessage 引用，调用即触发 _onMessage 全链路（见上：入参
      // 先经 normalizer 归一化成 envelope，模拟 claude driver 的下沉归一化）。
      const cb = callbacks.onTurnMessage as unknown as (envelope: unknown) => Promise<void>;
      capturedOnTurnMessage = (msg) =>
        cb({ events: normalizer.normalizeMessage(msg as never) });
      // simulate driver running indefinitely until close
      return new Promise<void>(() => {});
    },
    async interrupt() { return false; },
  };

  const deps: SessionManagerDeps = {
    driver: fakeDriver as any,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: onSessionEvent ?? vi.fn(),
  };

  const sm = new SessionManager(deps);
  return { sm, deps, capturedOnTurnMessage: () => capturedOnTurnMessage, startResolved: () => startResolved };
}

/** 最小 create 入参（其余缺省）。 */
const MIN_CREATE = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  claimToken: 'ct-1',
  firstPrompt: 'hello',
  firstRunId: 'run-1',
  cwd: '/tmp/test',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: '/usr/bin/claude',
};

// ── assistant message tool_use 识别 ──────────────────────────────────────────

describe('session-manager — assistant message Bash tool_use → bash_status(running)', () => {
  it('含 Bash tool_use 的 assistant message 触发 onSessionEvent(bash_status, running)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);

    // 等待 _runConsume 异步完成、driver.consume 捕获回调
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage();
    expect(onTurnMessage).not.toBeNull();

    // 模拟 assistant message 含 Bash tool_use block
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_bash_001',
            name: 'Bash',
            input: { command: 'ls -la /tmp' },
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'bash_status',
        command: 'ls -la /tmp',
        status: 'running',
      }),
    );
  });
});

describe('session-manager — assistant message EnterPlanMode/ExitPlanMode → plan_mode_entered', () => {
  it('EnterPlanMode tool_use 触发 onSessionEvent(plan_mode_entered)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_plan_001',
            name: 'EnterPlanMode',
            input: {
              objective: '实现 plan 功能',
              tasks: ['task-1', 'task-2'],
              design_snippet: '§3 设计',
            },
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'plan_mode_entered',
        summary: {
          objective: '实现 plan 功能',
          tasks: ['task-1', 'task-2'],
          design_snippet: '§3 设计',
        },
      }),
    );
  });

  it('ExitPlanMode 同样触发 plan_mode_entered（exit 也携带 summary）', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_exit_001',
            name: 'ExitPlanMode',
            input: { objective: '退出', tasks: [] },
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'plan_mode_entered',
        summary: expect.objectContaining({ objective: '退出' }),
      }),
    );
  });

  it('EnterPlanMode design_snippet 为空时不写入 summary（undefined 守卫）', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_plan_002',
            name: 'EnterPlanMode',
            input: { objective: '简要', tasks: [], design_snippet: '' },
          },
        ],
      },
    });

    const call = onSessionEvent.mock.calls.find(
      ([, , e]) => (e as any).kind === 'plan_mode_entered',
    );
    expect(call).toBeDefined();
    const summary = (call![2] as any).summary;
    expect(summary).toHaveProperty('objective', '简要');
    expect('design_snippet' in summary).toBe(false);
  });
});

describe('session-manager — assistant message Task/Agent tool_use → agent_task_status(running)', () => {
  it('Task tool_use 触发 onSessionEvent(agent_task_status, running)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_task_001',
            name: 'Task',
            input: { task_id: 'task-a1', description: '实现模块A' },
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'agent_task_status',
        task_id: 'task-a1',
        task_name: '实现模块A',
        status: 'running',
      }),
    );
  });

  it('Agent tool_use 触发 onSessionEvent(agent_task_status, running)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_agent_001',
            name: 'Agent',
            input: { name: 'research-agent', task_id: 'task-r1' },
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'agent_task_status',
        task_id: 'task-r1',
        task_name: 'research-agent',
        status: 'running',
      }),
    );
  });

  it('Task tool_use 缺 task_id → 用 tool_use_id 兜底；缺 description → 用 toolName 兜底', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'fallback-id',
            name: 'Task',
            input: {},
          },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        kind: 'agent_task_status',
        task_id: 'fallback-id',
        task_name: 'Task',
        status: 'running',
      }),
    );
  });
});

// ── user message tool_result 识别 ─────────────────────────────────────────────

describe('session-manager — user message tool_result → bash_chunk + bash_status(completed/failed)', () => {
  it('tool_result 匹配运行中 bash → emit bash_chunk(final) + bash_status(completed)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // 1. assistant 发出 Bash tool_use
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'echo hi' } }],
      },
    });
    expect(onSessionEvent).toHaveBeenCalledTimes(1);
    expect(onSessionEvent.mock.calls[0][2]).toMatchObject({ kind: 'bash_status', status: 'running' });

    // 2. user 回送 tool_result（is_error=false）。标准 SDK 形状：content 嵌在
    // message.content（旧测试顶层 content 是适配旧 session-manager 的非标准形状）。
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'hi\n', is_error: false },
        ],
      },
    });

    // 应新增 2 个事件：bash_chunk(final) + bash_status(completed)
    expect(onSessionEvent).toHaveBeenCalledTimes(3);

    const chunkCall = onSessionEvent.mock.calls[1][2];
    expect(chunkCall).toMatchObject({
      kind: 'bash_chunk',
      command: 'echo hi',
      channel: 'stdout',
      content: 'hi\n',
      is_final: true,
    });

    const statusCall = onSessionEvent.mock.calls[2][2];
    expect(statusCall).toMatchObject({
      kind: 'bash_status',
      command: 'echo hi',
      status: 'completed',
      exit_code: 0,
    });
    expect(typeof (statusCall as any).elapsed_ms).toBe('number');
  });

  it('tool_result is_error=true → bash_status(failed) + bash_chunk(stderr)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-err', name: 'Bash', input: { command: 'false' } }],
      },
    });

    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu-err', content: 'exit 1', is_error: true },
        ],
      },
    });

    const statusCall = onSessionEvent.mock.calls[2][2];
    expect(statusCall).toMatchObject({
      kind: 'bash_status',
      status: 'failed',
      exit_code: 1,
    });

    const chunkCall = onSessionEvent.mock.calls[1][2];
    expect(chunkCall).toMatchObject({ kind: 'bash_chunk', channel: 'stderr' });
  });

  it('tool_result content 为 object 时 JSON.stringify 透传', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-obj', name: 'Bash', input: { command: 'jq' } }],
      },
    });

    const objContent = { key: 'value', nested: [1, 2] };
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu-obj', content: objContent, is_error: false },
        ],
      },
    });

    const chunkCall = onSessionEvent.mock.calls[1][2];
    expect((chunkCall as any).content).toBe(JSON.stringify(objContent));
  });
});

// ── 边界条件 ──────────────────────────────────────────────────────────────────

describe('session-manager — 重复 tool_use_id 幂等（不产生双倍 running 事件）', () => {
  it('同一 tool_use_id 的 Bash tool_use 出现两次 → Map.set 幂等，两次均 emit bash_status(running)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // 第一次 assistant 消息含 Bash tool_use（tu-dup）
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-dup', name: 'Bash', input: { command: 'echo 1' } }],
      },
    });

    // 第二次 assistant 消息含同一 tool_use_id（SDK 重放 / streaming 重复）
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-dup', name: 'Bash', input: { command: 'echo 1' } }],
      },
    });

    // 两次 bash_status(running) 均触发（Map.set 幂等，无额外抑制，行为正确）
    const runningEvents = onSessionEvent.mock.calls.filter(
      ([, , e]) => (e as any).kind === 'bash_status' && (e as any).status === 'running',
    );
    expect(runningEvents.length).toBe(2);
  });

  it('同一 tool_use_id 的 tool_result 只匹配一次（首次消费后 Map.delete，第二次不再触发）', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // assistant 发出 Bash tool_use
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-once', name: 'Bash', input: { command: 'x' } }],
      },
    });

    // 第一次 tool_result → 触发 bash_chunk + bash_status，Map.delete 清除条目
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-once', content: 'ok', is_error: false }],
      },
    });
    const countAfterFirst = onSessionEvent.mock.calls.length;

    // 第二次相同 tool_use_id 的 tool_result → _runningBashCommands.get 返回 undefined → 不触发
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-once', content: 'dup', is_error: false }],
      },
    });

    expect(onSessionEvent.mock.calls.length).toBe(countAfterFirst);
  });
});

describe('session-manager — 未知 tool_use_id 的 tool_result 被忽略', () => {
  it('tool_result tool_use_id 不在 _runningBashCommands 中 → 不触发 onSessionEvent', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // 直接发 tool_result，无先前 assistant Bash tool_use
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'unknown-id', content: 'stale', is_error: false }],
      },
    });

    expect(onSessionEvent).not.toHaveBeenCalled();
  });
});

describe('session-manager — 非 Bash 工具的 tool_result 不触发事件', () => {
  it('Read 工具的 tool_result → 不触发 onSessionEvent', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // assistant 发出 Read tool_use（非 Bash，不在 _runningBashCommands）
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/tmp/x' } }],
      },
    });

    // user 回送 tool_result
    await onTurnMessage({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-read', content: 'file data', is_error: false }],
      },
    });

    expect(onSessionEvent).not.toHaveBeenCalled();
  });
});

describe('session-manager — onSessionEvent 内部异常不阻塞消息流', () => {
  it('onSessionEvent 抛出后 _onMessage 不中断，后续事件仍正常触发', async () => {
    let callCount = 0;
    const onSessionEvent = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('callback boom');
      // 后续调用正常返回
    });

    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    // 第一条：Bash tool_use → onSessionEvent 抛异常（被 _emitSessionEvent catch 吞掉）
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tu-boom', name: 'Bash', input: { command: 'echo 1' } }],
      },
    });

    // 第二条：EnterPlanMode → onSessionEvent 正常触发（不被前一条异常阻塞）
    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'toolu_plan_ok', name: 'EnterPlanMode', input: { objective: 'ok', tasks: [] } }],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledTimes(2);
    // 第二次调用是 plan_mode_entered
    expect(onSessionEvent.mock.calls[1][2]).toMatchObject({ kind: 'plan_mode_entered' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 3: 多事件类型混合消息
// ═══════════════════════════════════════════════════════════════════════════════

describe('session-manager — 一条 assistant message 含多个 tool_use block', () => {
  it('同时含 Bash + EnterPlanMode → 各自 emit 对应事件', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'tu-mix-bash', name: 'Bash', input: { command: 'echo hi' } },
          { type: 'tool_use', id: 'tu-mix-plan', name: 'EnterPlanMode', input: { objective: 'plan', tasks: ['a'] } },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledTimes(2);

    const kinds = onSessionEvent.mock.calls.map(([, , e]) => (e as any).kind);
    expect(kinds).toContain('bash_status');
    expect(kinds).toContain('plan_mode_entered');
  });

  it('同时含 Task + Bash → agent_task_status(running) + bash_status(running)', async () => {
    const onSessionEvent = vi.fn();
    const { sm, capturedOnTurnMessage } = createSessionManagerWithFakeDriver(onSessionEvent);
    await sm.create(MIN_CREATE);
    await new Promise(r => setTimeout(r, 0));
    const onTurnMessage = capturedOnTurnMessage()!;

    await onTurnMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'tu-task2', name: 'Task', input: { task_id: 't2', description: 'task B' } },
          { type: 'tool_use', id: 'tu-bash2', name: 'Bash', input: { command: 'pwd' } },
        ],
      },
    });

    expect(onSessionEvent).toHaveBeenCalledTimes(2);
    const kinds = onSessionEvent.mock.calls.map(([, , e]) => (e as any).kind);
    expect(kinds).toContain('agent_task_status');
    expect(kinds).toContain('bash_status');
  });
});
