// tests/daemon-provider-config-changed-handler.test.ts
// change 2026-08-06-provider-switch-live-session / task-06 / FR-04 / D-002@v1
//（design §5 Wave2 + §9 向前兼容）。
//
// 覆盖 task-06 验收点「daemon 侧 WS 分发接线」：
//   daemon._handleWsMessage 收到 PROVIDER_CONFIG_CHANGED WS 消息后，必须调
//   sessionManager.markPendingSwitch(sessionId, providerConfig|null)（task-07 实现）。
//
// 本文件 ONLY 测 daemon.ts 的 WS 分发接线（handler → markPendingSwitch 调用契约）：
//   - snake_case / camelCase payload 归一化后取到 session_id + provider_config
//   - provider_config=null（停止 → 回退本机凭证，D-004@v1）透传不拦截
//   - 缺 session_id / 无 sessionManager → 仅 warn 不抛
//   - markPendingSwitch 抛 SessionNotFoundError → best-effort warn，不崩 WS 主循环
//   - 未知消息类型仍走 default warn（向前兼容 design §9）
// markPendingSwitch 内部空闲/生成中分支 + reloadWithProvider 见 session-manager
// 系列测试（task-07 / task-08）。
//
// task-02 的字符串契约（MSG.PROVIDER_CONFIG_CHANGED === 'daemon:provider_config_changed'）
// 由 tests/protocol.contract.test.ts 覆盖——本文件不重复。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { DaemonMessage, ProviderConfig } from '../src/types.js';
import type { SessionManager } from '../src/interactive/session-manager.js';

// ── 共用 mock 基础设施（风格对齐 daemon-lease-cancel-handler.test.ts）──────────

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

function createMockTaskRunner() {
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
  };
}

/** mock SessionManager，markPendingSwitch 是 spy，断言调用次数 + 参数。 */
function createMockSessionManager(
  markImpl?: (sessionId: string, cfg: ProviderConfig | null) => void,
): SessionManager & {
  markPendingSwitch: ReturnType<typeof vi.fn>;
} {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() => undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    // 默认 no-op；测试可覆盖为抛 SessionNotFoundError 模拟迟到/重放场景。
    markPendingSwitch: vi.fn(markImpl ?? (() => {})),
  };
  return sm as unknown as SessionManager & {
    markPendingSwitch: ReturnType<typeof vi.fn>;
  };
}

interface CapturedWs {
  callbacks: WsClientCallbacks;
}

function buildDaemon(opts: {
  sessionManager?: SessionManager & { markPendingSwitch: ReturnType<typeof vi.fn> } | null;
} = {}) {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const sessionManager =
    opts.sessionManager === undefined ? createMockSessionManager() : opts.sessionManager;

  const detector = {
    detectAgents: vi.fn(async () => [mockAgent()]),
  };

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

  const ctorOpts: Record<string, unknown> = {
    detector,
    wsClientFactory,
    sessionManager,
  };

  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return { daemon, client, sessionManager, captured };
}

/** 等到 WS client factory 被调用（_wsLoop 在 start 后会 _ensureWsClient）。 */
async function waitForWsInit(captured: CapturedWs): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (captured.callbacks.onMessage) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error('WS client factory 未在 start() 中被调用');
}

/** 让被 fire-and-forget 的 _routeProviderConfigChanged().catch() 链 settle 完。 */
async function flushMicro(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

const SESSION_ID = 'sess-abc-123';

const SAMPLE_PROVIDER_CONFIG: ProviderConfig = {
  agent_kind: 'claude',
  base_url: 'https://api.anthropic.example',
  api_key: 'sk-test-secret',
  auth_field: 'ANTHROPIC_AUTH_TOKEN',
  model: 'claude-sonnet-4',
};

describe('task-06 / FR-04 / D-002@v1: daemon PROVIDER_CONFIG_CHANGED WS handler 接线', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('PROVIDER_CONFIG_CHANGED（snake_case payload）→ markPendingSwitch(sessionId, cfg) 被调一次', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: {
        session_id: SESSION_ID,
        provider_config: SAMPLE_PROVIDER_CONFIG,
      },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(sessionManager.markPendingSwitch).toHaveBeenCalledTimes(1);
    expect(sessionManager.markPendingSwitch).toHaveBeenCalledWith(
      SESSION_ID,
      SAMPLE_PROVIDER_CONFIG,
    );
  });

  it('PROVIDER_CONFIG_CHANGED（camelCase payload）也归一化（snake/camel 双写）', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: {
        sessionId: SESSION_ID,
        providerConfig: SAMPLE_PROVIDER_CONFIG,
      },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(sessionManager.markPendingSwitch).toHaveBeenCalledWith(
      SESSION_ID,
      SAMPLE_PROVIDER_CONFIG,
    );
  });

  it('provider_config=null（停止）→ 透传 null 给 markPendingSwitch（D-004@v1 回退本机凭证）', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: null },
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(sessionManager.markPendingSwitch).toHaveBeenCalledTimes(1);
    expect(sessionManager.markPendingSwitch).toHaveBeenCalledWith(SESSION_ID, null);
  });

  it('payload 缺 provider_config 字段 → 当作 null 透传（停止语义）', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID }, // 无 provider_config
    };
    captured.callbacks.onMessage!(msg);
    await flushMicro();

    expect(sessionManager.markPendingSwitch).toHaveBeenCalledWith(SESSION_ID, null);
  });

  it('缺 session_id → 仅 warn，markPendingSwitch 不被调（no-op return）', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { provider_config: SAMPLE_PROVIDER_CONFIG }, // 无 session_id
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();

    expect(sessionManager.markPendingSwitch).not.toHaveBeenCalled();
  });

  it('sessionManager=null（未注入）→ 仅 warn，不抛（AC-14 同 SESSION_INJECT 风格）', async () => {
    const { daemon, captured } = buildDaemon({ sessionManager: null });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: null },
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();
  });

  it('markPendingSwitch 抛 SessionNotFoundError（迟到/重放）→ best-effort warn，不崩 WS', async () => {
    const boom = new Error('SessionNotFoundError: not in store');
    const { daemon, sessionManager, captured } = buildDaemon({
      sessionManager: createMockSessionManager(() => {
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
        type: MSG.PROVIDER_CONFIG_CHANGED,
        payload: { session_id: SESSION_ID, provider_config: null },
      };
      expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
      // 多拍让 void .catch 链 settle（捕获潜在 unhandledRejection）
      await flushMicro();
      await flushMicro();

      expect(sessionManager.markPendingSwitch).toHaveBeenCalledTimes(1);
      expect(unhandled).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('未知消息类型 → default warn 忽略（向前兼容 design §9）', async () => {
    const { daemon, sessionManager, captured } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const msg: DaemonMessage = {
      // 旧 / 未知类型字符串字面量（模拟未来版本回退 / 旧 daemon 升级路径）
      type: 'daemon:future_unknown_msg' as never,
      payload: { session_id: SESSION_ID },
    };
    expect(() => captured.callbacks.onMessage!(msg)).not.toThrow();
    await flushMicro();

    // markPendingSwitch 绝不应被未知类型触发
    expect(sessionManager.markPendingSwitch).not.toHaveBeenCalled();
  });
});
