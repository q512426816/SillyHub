// tests/plan-response-delivery.test.ts
// change 2026-08-24-platform-session-feedback-fix / task-02 verify P0 返工 / FR-02 / D-001@v1。
//
// 覆盖「plan 决策回传闭环」的 daemon 接收端：
//   Part 1  SessionManager.resolvePlanResponse —— 决策格式化为用户消息经 inject
//           注入 InputQueue（run_id 新旧校验 / 终态拒收 / 三种决策文案）。
//   Part 2  daemon._handleWsMessage 收到 PLAN_RESPONSE WS 消息 → 非阻塞调
//           sessionManager.resolvePlanResponse（字段校验 / 非法 decision 丢弃）。
//
// 协议字符串契约（MSG.PLAN_RESPONSE === 'daemon:plan_response'，与 backend
// DAEMON_MSG_PLAN_RESPONSE 逐字对齐）由 Part 1 首用例锚定。
// backend 侧（plan-response 端点 200/422/404 + WS send_session_control 下发
// daemon:plan_response）已由 backend test_session_plan_bash_events.py 覆盖——本文件不重复。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionManagerDeps } from '../src/interactive/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
} from '../src/interactive/types.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { DaemonMessage } from '../src/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1: SessionManager.resolvePlanResponse
//（fake driver 模式与 tests/session-plan-bash-events.test.ts 同构）
// ═══════════════════════════════════════════════════════════════════════════════

function createSessionManagerWithFakeDriver() {
  const fakeDriver: InteractiveDriver = {
    provider: 'claude',
    async start() {
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(_handle, callbacks: InteractiveDriverCallbacks) {
      // 不真正消费——turn 不结束，resolvePlanResponse 的注入停留在 InputQueue。
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return false;
    },
  };

  const deps: SessionManagerDeps = {
    driver: fakeDriver as never,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: vi.fn(),
  };

  const sm = new SessionManager(deps);
  return { sm, deps };
}

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

describe('session-manager — resolvePlanResponse 决策送达 turn', () => {
  it('confirm → inject 注入「计划确认」消息（含 run_id 归属），返回 true', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await sm.create(MIN_CREATE);
    const injectSpy = vi.spyOn(sm, 'inject');

    const ok = await sm.resolvePlanResponse('sess-1', 'run-1', 'confirm');

    expect(ok).toBe(true);
    expect(injectSpy).toHaveBeenCalledTimes(1);
    const [sessionId, prompt, runId] = injectSpy.mock.calls[0];
    expect(sessionId).toBe('sess-1');
    expect(runId).toBe('run-1');
    expect(prompt).toContain('【计划确认】');
    expect(prompt).toContain('继续执行');
  });

  it('revise → 文案含用户反馈文本', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await sm.create(MIN_CREATE);
    const injectSpy = vi.spyOn(sm, 'inject');

    const ok = await sm.resolvePlanResponse('sess-1', 'run-1', 'revise', '把 Wave 3 拆成两批');

    expect(ok).toBe(true);
    const prompt = injectSpy.mock.calls[0][1] as string;
    expect(prompt).toContain('【计划修订】');
    expect(prompt).toContain('把 Wave 3 拆成两批');
  });

  it('cancel → 文案含取消原因；feedback 空白时兜底「（未填写）」不抛错', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await sm.create(MIN_CREATE);
    const injectSpy = vi.spyOn(sm, 'inject');

    const ok1 = await sm.resolvePlanResponse('sess-1', 'run-1', 'cancel', '  ');
    expect(ok1).toBe(true);
    expect(injectSpy.mock.calls[0][1] as string).toContain('【计划取消】');
    expect(injectSpy.mock.calls[0][1] as string).toContain('（未填写）');

    const ok2 = await sm.resolvePlanResponse('sess-1', 'run-1', 'cancel', '方向不对');
    expect(ok2).toBe(true);
    expect(injectSpy.mock.calls[1][1] as string).toContain('方向不对');
  });

  it('真实注入路径：confirm 后 session 保持 running、currentRunId 归属 plan 轮', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await sm.create(MIN_CREATE);

    const ok = await sm.resolvePlanResponse('sess-1', 'run-1', 'confirm');

    expect(ok).toBe(true);
    const state = sm.get('sess-1');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('running');
    expect(state!.currentRunId).toBe('run-1');
  });

  it('stale run_id（会话已推进到后续 turn）→ 拒收返回 false，不注入旧消息', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await sm.create(MIN_CREATE);
    // 模拟会话推进：真实 inject 切换 currentRunId 到 run-2。
    await sm.inject('sess-1', '下一轮问题', 'run-2');
    const injectSpy = vi.spyOn(sm, 'inject');

    const ok = await sm.resolvePlanResponse('sess-1', 'run-1', 'confirm');

    expect(ok).toBe(false);
    expect(injectSpy).not.toHaveBeenCalled();
    // currentRunId 不被旧决策回拨。
    expect(sm.get('sess-1')!.currentRunId).toBe('run-2');
  });

  it('未知 session → false 不抛错；已 end 的 session → false 拒收', async () => {
    const { sm } = createSessionManagerWithFakeDriver();
    await expect(sm.resolvePlanResponse('no-such', 'run-1', 'confirm')).resolves.toBe(false);

    await sm.create(MIN_CREATE);
    await sm.end('sess-1');
    await expect(sm.resolvePlanResponse('sess-1', 'run-1', 'confirm')).resolves.toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: daemon WS 分发接线（风格对齐 tests/daemon-lease-cancel-handler.test.ts）
// ═══════════════════════════════════════════════════════════════════════════════

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function mockAgent(): DetectedAgent {
  return {
    provider: 'claude',
    path: 'C:\\bin\\claude.exe',
    version: '1.0.0',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

interface CapturedWs {
  callbacks: WsClientCallbacks;
}

function buildDaemon(sessionManager: Record<string, unknown> | null) {
  const client = {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 't',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r', claude_md: '' })),
    close: vi.fn(),
  };
  const taskRunner = {
    runLease: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: '',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      output: 'ok',
      error: '',
      durationMs: 10,
      sessionId: '',
      metadata: {},
    })),
    cancel: vi.fn(async () => true),
  };
  const detector = { detectAgents: vi.fn(async () => [mockAgent()]) };
  const captured: CapturedWs = { callbacks: {} };
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    captured.callbacks = o.callbacks;
    return {
      connect: vi.fn(() => {
        captured.callbacks.onConnected?.();
      }),
      close: vi.fn(() => {
        captured.callbacks.onDisconnected?.(1000, 'test');
      }),
      send: vi.fn(() => true),
      registerRpcHandler: vi.fn(),
    };
  });
  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    {
      detector,
      wsClientFactory,
      sessionManager: sessionManager
        ? { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), ...sessionManager }
        : null,
    } as never,
  );
  return { daemon, captured };
}

async function waitForWsInit(captured: CapturedWs): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (captured.callbacks.onMessage) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error('WS client factory 未在 start() 中被调用');
}

async function flushMicro(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('task-02 P0 返工 / FR-02: daemon PLAN_RESPONSE WS handler 接线', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('MSG.PLAN_RESPONSE 协议常量与 backend DAEMON_MSG_PLAN_RESPONSE 逐字对齐', () => {
    expect(MSG.PLAN_RESPONSE).toBe('daemon:plan_response');
  });

  it('PLAN_RESPONSE（snake_case payload）→ sessionManager.resolvePlanResponse 被调', async () => {
    const resolvePlanResponse = vi.fn(async () => true);
    const { daemon, captured } = buildDaemon({
      resolvePlanResponse,
      get: vi.fn(),
    });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PLAN_RESPONSE,
      payload: {
        session_id: 'sess-9',
        run_id: 'run-9',
        decision: 'revise',
        feedback: '加一步回归',
        runtime_id: 'rt-1',
      },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(resolvePlanResponse).toHaveBeenCalledTimes(1);
    expect(resolvePlanResponse).toHaveBeenCalledWith('sess-9', 'run-9', 'revise', '加一步回归');
  });

  it('decision 非法 → warn 丢弃，resolvePlanResponse 不被调', async () => {
    const resolvePlanResponse = vi.fn(async () => true);
    const { daemon, captured } = buildDaemon({ resolvePlanResponse, get: vi.fn() });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    captured.callbacks.onMessage!({
      type: MSG.PLAN_RESPONSE,
      payload: { session_id: 'sess-9', run_id: 'run-9', decision: 'maybe' },
    } as DaemonMessage);
    await flushMicro();

    expect(resolvePlanResponse).not.toHaveBeenCalled();
  });

  it('缺 session_id / run_id → warn 丢弃，不路由', async () => {
    const resolvePlanResponse = vi.fn(async () => true);
    const { daemon, captured } = buildDaemon({ resolvePlanResponse, get: vi.fn() });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    captured.callbacks.onMessage!({
      type: MSG.PLAN_RESPONSE,
      payload: { run_id: 'run-9', decision: 'confirm' },
    } as DaemonMessage);
    await flushMicro();

    expect(resolvePlanResponse).not.toHaveBeenCalled();
  });

  it('未注入 sessionManager → warn 不崩（向后兼容旧装配）', async () => {
    const { daemon, captured } = buildDaemon(null);
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    expect(() => {
      captured.callbacks.onMessage!({
        type: MSG.PLAN_RESPONSE,
        payload: { session_id: 's', run_id: 'r', decision: 'confirm' },
      } as DaemonMessage);
    }).not.toThrow();
    await flushMicro();
  });

  it('resolvePlanResponse 返回 false（stale/终态）→ 仅记 warn，WS 接收不中断', async () => {
    const resolvePlanResponse = vi.fn(async () => false);
    const { daemon, captured } = buildDaemon({ resolvePlanResponse, get: vi.fn() });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    captured.callbacks.onMessage!({
      type: MSG.PLAN_RESPONSE,
      payload: { session_id: 's', run_id: 'r', decision: 'confirm' },
    } as DaemonMessage);
    await flushMicro();

    expect(resolvePlanResponse).toHaveBeenCalledTimes(1);
    // 后续消息仍能正常分发（WS 接收未断）。
    captured.callbacks.onMessage!({
      type: MSG.PLAN_RESPONSE,
      payload: { session_id: 's2', run_id: 'r2', decision: 'cancel', feedback: 'x' },
    } as DaemonMessage);
    await flushMicro();
    expect(resolvePlanResponse).toHaveBeenCalledTimes(2);
  });
});
