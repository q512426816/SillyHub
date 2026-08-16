// tests/daemon-lease-cancel-handler.test.ts
// change 2026-08-05-daemon-kill-channel-unify / task-06 / FR-03 / R-06
//（design §5 Phase2 + §7.5 + §9 + §10 R-06）。
//
// 覆盖 task-06 验收点 #2 的「daemon 侧 handler 接线」部分：
//   daemon._handleWsMessage 收到 LEASE_CANCEL WS 消息后，必须非阻塞调
//   taskRunner.cancel(leaseId)（复用 AbortController → _killChild 即时杀 batch 子进程）。
//
// 本文件 ONLY 测 daemon.ts 的 WS 分发接线（handler → taskRunner.cancel 调用契约）：
//   - snake_case / camelCase payload 归一化后取到 leaseId
//   - 缺 leaseId / 无 taskRunner / 无 cancel 方法 → 仅 warn，不抛
//   - cancel 抛错 / 返回 false → best-effort 不崩 WS 接收
// taskRunner.cancel → _killChild 的执行链 + 双触发幂等见
// tests/task-runner-lease-cancel-idempotent.test.ts（同 task）。
//
// task-04 的字符串契约（MSG.LEASE_CANCEL === 'daemon:lease_cancel'）已由
// tests/protocol-session-contract.test.ts 覆盖；task-05 的 backend cancel_lease
// → ws_hub.send_to_runtime(LEASE_CANCEL) 已由 backend test_cancel_lease_session.py
// 的 TestCancelLeaseSendsLeaseCancelForBatch 覆盖——本文件不重复。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { DaemonMessage } from '../src/types.js';

// ── 共用 mock 基础设施（风格对齐 daemon-session-lifecycle-wiring.test.ts）──────

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

function createMockClient() {
  return {
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
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'r',
      claude_md: '',
    })),
    close: vi.fn(),
  };
}

/** mock taskRunner，cancel 是 spy，便于断言 daemon 是否调用 + 用什么 leaseId 调。 */
function createMockTaskRunner(cancelImpl?: (leaseId: string) => Promise<boolean>) {
  return {
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
    // 默认返回 true（找到并取消）；测试可覆盖为抛错 / 返回 false。
    cancel: vi.fn(cancelImpl ?? (async () => true)),
  };
}

interface CapturedWs {
  callbacks: WsClientCallbacks;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  registerRpcHandler: ReturnType<typeof vi.fn>;
}

function buildDaemon(opts: {
  taskRunner?: ReturnType<typeof createMockTaskRunner> | null;
} = {}) {
  const client = createMockClient();
  // 默认注入带 cancel 的 taskRunner；opts.taskRunner=null 透传测「无 runner」分支。
  const taskRunner =
    opts.taskRunner === undefined ? createMockTaskRunner() : opts.taskRunner;

  const detector = {
    detectAgents: vi.fn(async () => [mockAgent()]),
  };

  const captured: CapturedWs = {
    callbacks: {},
    connect: vi.fn(() => {
      // 模拟连接成功 → 触发 onConnected（让 drainOutbox 等 .?. 兜底走过）
      captured.callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      captured.callbacks.onDisconnected?.(1000, 'test');
    }),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
  };

  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    captured.callbacks = o.callbacks;
    return {
      connect: captured.connect,
      close: captured.close,
      send: captured.send,
      registerRpcHandler: captured.registerRpcHandler,
    };
  });

  const ctorOpts: Record<string, unknown> = {
    detector,
    wsClientFactory,
    sessionManager: null,
  };

  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return { daemon, client, taskRunner, captured };
}

/** 等到 WS client factory 被调用（_wsLoop 在 start 后会 _ensureWsClient）。 */
async function waitForWsInit(captured: CapturedWs): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (captured.callbacks.onMessage) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error('WS client factory 未在 start() 中被调用');
}

/** 让被 fire-and-forget 的 cancel().then().catch() 链 settle 完。 */
async function flushMicro(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

const LEASE_ID = 'lease-abc-123';
const RUNTIME_ID = 'runtime-uuid-123';

describe('task-06 / FR-03 / R-06: daemon LEASE_CANCEL WS handler 接线', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('LEASE_CANCEL（snake_case payload）→ taskRunner.cancel(leaseId) 被调一次', async () => {
    const { daemon, taskRunner, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    // 模拟 backend ws_hub.send_to_runtime 下发的 envelope（snake_case）
    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { lease_id: LEASE_ID, runtime_id: RUNTIME_ID },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(taskRunner.cancel).toHaveBeenCalledTimes(1);
    expect(taskRunner.cancel).toHaveBeenCalledWith(LEASE_ID);
  });

  it('LEASE_CANCEL（camelCase payload）也归一化取到 leaseId（snake/camel 双写）', async () => {
    const { daemon, taskRunner, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { leaseId: LEASE_ID, runtimeId: RUNTIME_ID },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(taskRunner.cancel).toHaveBeenCalledWith(LEASE_ID);
  });

  it('缺 lease_id → 仅 warn，taskRunner.cancel 不被调（no-op return）', async () => {
    const { daemon, taskRunner, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { runtime_id: RUNTIME_ID }, // 无 lease_id
    };
    // handler return（不抛）
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(taskRunner.cancel).not.toHaveBeenCalled();
  });

  it('taskRunner=null → 仅 warn lease_cancel_no_runner，不抛（兼容未注入 runner）', async () => {
    const { daemon, captured } = buildDaemon({ taskRunner: null });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { lease_id: LEASE_ID, runtime_id: RUNTIME_ID },
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();
  });

  it('taskRunner 未实现 cancel 方法（duck-type）→ 仅 warn，不抛', async () => {
    // 仅含 runLease 的 mock（duck-typed），daemon 用 typeof === 'function' 探测
    const duckRunner = { runLease: vi.fn(async () => ({ status: 'completed' })) };
    const { daemon, captured } = buildDaemon({
      taskRunner: duckRunner as unknown as ReturnType<typeof createMockTaskRunner>,
    });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { lease_id: LEASE_ID, runtime_id: RUNTIME_ID },
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();
  });

  it('cancel 抛错 → best-effort 捕获（void .catch），不导致 unhandledRejection / 不崩 WS', async () => {
    const boom = new Error('kill child failed');
    const { daemon, taskRunner, captured } = buildDaemon({
      taskRunner: createMockTaskRunner(async () => {
        throw boom;
      }),
    });
    daemons.push(daemon);

    let unhandled = false;
    const onUnhandled = (): void => {
      unhandled = true;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await daemon.start();
      await waitForWsInit(captured);

      const msg: DaemonMessage = {
        type: MSG.LEASE_CANCEL,
        payload: { lease_id: LEASE_ID, runtime_id: RUNTIME_ID },
      };
      expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
      // 等 void .then().catch() 链 settle（多拍确保 unhandledRejection 能被抓到）
      await flushMicro();
      await flushMicro();

      expect(taskRunner.cancel).toHaveBeenCalledTimes(1);
      expect(unhandled).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('cancel 返回 false（lease 已 untracked，心跳竞态）→ 不抛，handler 正常 return', async () => {
    const { daemon, taskRunner, captured } = buildDaemon({
      taskRunner: createMockTaskRunner(async () => false),
    });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.LEASE_CANCEL,
      payload: { lease_id: LEASE_ID, runtime_id: RUNTIME_ID },
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();

    expect(taskRunner.cancel).toHaveBeenCalledWith(LEASE_ID);
  });
});
