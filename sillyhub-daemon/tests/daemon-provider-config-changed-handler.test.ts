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
//
// task-04（2026-09-10-multi-provider-injection / FR-03 / D-009+D-011）：下方第二
// 个 describe 扩展「热切换按会话重写」——markPendingSwitch 成功后对活跃 codex/pi
// 会话复用 applyProviderFileSettings 重写 per-session 目录（复用同函数 = 产物与
// 新会话 spawn 前逐字一致）；claude/absent 零动作；null 仅记日志；终态/不存在
// 会话零重写（防死会话重建目录孤儿）；hot_switch_rewrite 可观测日志不含 key。
//
// task-06（2026-09-11-session-provider-switch-codex-pi / FR-04 / D-003@v1）：热切换
// 语义升级——task-03 删 reloadWithProvider claude-only 守卫后，PROVIDER_CONFIG_
// CHANGED 对 codex/pi 从「尽力重写」升级为确定性 reload（与 claude 同语义）；既有
// task-04 重写断言按「reload 前幂等预写」语义保留（design 非目标：不动 daemon.ts
// 重写块），下方补 handler → markPendingSwitch → reloadWithProvider 接线断言
// （codex 配置全程不撞 not-yet-supported——真实内核走通证据归
// session-manager-config-switch REG-4 / reload-provider 边界-2 改写）。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { DaemonMessage, ProviderConfig } from '../src/types.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
// task-04：热切换重写产物断言（复用 task-03 同一函数对照「逐字一致」；
// 2026-09-11-session-provider-switch-codex-pi task-01 起单点定义在 provider-file-settings.ts）。
import { applyProviderFileSettings } from '../src/provider-file-settings.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

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

/** mock SessionManager，markPendingSwitch 是 spy，断言调用次数 + 参数。
 * task-04：getState 可注入 get() 返回值（热切换重写的活跃门控用）。 */
function createMockSessionManager(
  markImpl?: (sessionId: string, cfg: ProviderConfig | null) => void,
  getState?: (sessionId: string) => Readonly<SessionState> | undefined,
): SessionManager & {
  markPendingSwitch: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(getState ?? (() => undefined)),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    // 默认 no-op；测试可覆盖为抛 SessionNotFoundError 模拟迟到/重放场景。
    markPendingSwitch: vi.fn(markImpl ?? (() => {})),
  };
  return sm as unknown as SessionManager & {
    markPendingSwitch: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
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

  it('task-06/D-003: codex 配置经 markPendingSwitch 空闲路径直达 reloadWithProvider（不撞 not-yet-supported）', async () => {
    // task-03 删守卫后热切换接线为确定性 reload：handler → markPendingSwitch（空闲
    // 会话）→ reloadWithProvider。markPendingSwitch 用真实形状实现（mock sm 上自
    // 路由到 reloadWithProvider spy）——锁 daemon 分发对 codex 配置零拦截；真实
    // 内核 codex 走通断言归 session-manager 系列测试（REG-4 / 边界-2 改写）。
    const reloadSpy = vi.fn(async () => {});
    const sm = createMockSessionManager(function (
      this: { reloadWithProvider: typeof reloadSpy },
      sessionId: string,
      cfg: ProviderConfig | null,
    ) {
      // 真实 markPendingSwitch 空闲分支形状（session-manager.ts）：fire-and-forget
      // reload，不写标记。
      void this.reloadWithProvider(sessionId, cfg);
    });
    (sm as unknown as { reloadWithProvider: typeof reloadSpy }).reloadWithProvider =
      reloadSpy;
    const { daemon, captured } = buildDaemon({ sessionManager: sm });
    daemons.push(daemon);
    await daemon.start();
    await waitForWsInit(captured);

    const codexCfg: ProviderConfig = {
      agent_kind: 'codex',
      api_key: 'sk-hot-codex',
      base_url: 'https://hot.example/v1',
      model: 'glm-4.8',
    };
    captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: codexCfg },
    } as DaemonMessage);
    await flushMicro();
    await flushMicro();

    // 接线断言：codex 配置直达 reloadWithProvider（守卫删除前此链对 codex 终止于
    // not-yet-supported 抛错——markPendingSwitch 的 .catch 吞错，reload 永不发生）。
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(SESSION_ID, codexCfg);
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

// ── task-04（2026-09-10-multi-provider-injection / FR-03 / D-009+D-011）──────────
// 热切换按会话重写：markPendingSwitch 成功后，活跃 codex/pi 会话的 per-session
// 目录由 _routeProviderConfigChanged 复用 applyProviderFileSettings 重写（与
// spawn 前产物同函数）；隔离照搬 daemon-provider-file-dispatch.test.ts——
// vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot)，零触碰真实 ~/.sillyhub。

describe('task-04 / D-009+D-011: PROVIDER_CONFIG_CHANGED 热切换按会话重写 per-session 目录', () => {
  let daemons: Daemon[] = [];
  let tmpRoot: string;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  function stubbedRoot(): string {
    return tmpRoot;
  }

  /** 活跃会话状态（active 无在跑 turn）——热切换重写的活跃门控取值。 */
  function activeState(sessionId: string): Readonly<SessionState> {
    return { sessionId, leaseId: `lease-${sessionId}`, status: 'active' } as Readonly<SessionState>;
  }

  function codexSwitchConfig(): ProviderConfig {
    return {
      agent_kind: 'codex',
      api_key: 'sk-codex-hot-new',
      base_url: 'https://hot-new.example/v1',
      model: 'glm-4.8',
    };
  }

  function piSwitchConfig(): ProviderConfig {
    return {
      agent_kind: 'pi',
      api_key: 'sk-pi-hot-new',
      base_url: 'https://pi-hot.example/v1',
      model: 'kimi-k3',
    };
  }

  /** 轮询等待条件成立（重写是 handler 内异步 FS 写，microtask 不够）。 */
  async function waitForCond(
    cond: () => boolean,
    { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
  ): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (cond()) return;
      await new Promise<void>((r) => setTimeout(r, interval));
    }
    throw new Error(`waitForCond: 条件在 ${timeout}ms 内未成立`);
  }

  /** console.info 是否出现过 [daemon.<event>] 且携带全部期望 kv 片段。 */
  function sawLog(event: string, kvContains: string[]): boolean {
    return infoSpy.mock.calls.some(
      (call) =>
        call[0] === `[daemon.${event}]` &&
        kvContains.every((kv) => (call as unknown[]).includes(kv)),
    );
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hs-'));
    vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
    // daemon createLogger 走 console.info；时间戳包装在 spy 下游，记录原始实参。
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    vi.unstubAllEnvs();
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('codex 活跃会话 → per-session 目录按新供应商重写 + hot_switch_rewrite 日志（含 session/kind 不含 key）', async () => {
    // 预置「旧供应商」目录产物（模拟会话 spawn 前已写入）。
    const codexHome = join(stubbedRoot(), 'codex', SESSION_ID);
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-codex-old"}');
    writeFileSync(join(codexHome, 'config.toml'), 'model = "old-model"');

    const sm = createMockSessionManager(undefined, () => activeState(SESSION_ID));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: codexSwitchConfig() },
    } as DaemonMessage);
    await waitForCond(() =>
      existsSync(join(codexHome, 'auth.json')) &&
      readFileSync(join(codexHome, 'auth.json'), 'utf-8').includes('sk-codex-hot-new'),
    );

    // 产物按新供应商重写（auth key + config.toml 端点/模型）。
    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toContain('sk-codex-hot-new');
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain('base_url = "https://hot-new.example/v1"');
    expect(toml).toContain('model = "glm-4.8"');
    expect(toml).not.toContain('old-model');
    // 可观测日志：session/kind 齐、key 明文绝不出现（R-02/R-05）。
    expect(sawLog('hot_switch_rewrite', ['session_id=' + SESSION_ID, 'agent_kind=codex', 'rewritten=true'])).toBe(true);
    const logged = infoSpy.mock.calls
      .filter((c) => c[0] === '[daemon.hot_switch_rewrite]')
      .flat()
      .join(' ');
    expect(logged).not.toContain('sk-codex-hot-new');
    // 推送流不受影响：markPendingSwitch 照常被调（D-009 尽力语义旁路）。
    expect(sm.markPendingSwitch).toHaveBeenCalledTimes(1);
  });

  it('重写产物与新会话 spawn 前产物逐字一致（复用同一 applyProviderFileSettings）', async () => {
    const codexHome = join(stubbedRoot(), 'codex', SESSION_ID);
    mkdirSync(codexHome, { recursive: true });

    const sm = createMockSessionManager(undefined, () => activeState(SESSION_ID));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: codexSwitchConfig() },
    } as DaemonMessage);
    await waitForCond(() => existsSync(join(codexHome, 'config.toml')));

    // 对照组：同输入走 spawn 前同一函数（anthropic 形态 daemonApiKey 不参与）。
    await applyProviderFileSettings({
      sessionKey: 'fresh-ref',
      provider: codexSwitchConfig(),
      daemonApiKey: null,
    });
    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toBe(
      readFileSync(join(stubbedRoot(), 'codex', 'fresh-ref', 'auth.json'), 'utf-8'),
    );
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf-8')).toBe(
      readFileSync(join(stubbedRoot(), 'codex', 'fresh-ref', 'config.toml'), 'utf-8'),
    );
  });

  it('pi 活跃会话 → pi 目录三文件按新供应商重写 + agent_kind=pi 日志', async () => {
    const piDir = join(stubbedRoot(), 'pi', SESSION_ID);
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'settings.json'), '{"defaultModel":"old-m"}');

    const sm = createMockSessionManager(undefined, () => activeState(SESSION_ID));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: piSwitchConfig() },
    } as DaemonMessage);
    await waitForCond(() =>
      existsSync(join(piDir, 'settings.json')) &&
      readFileSync(join(piDir, 'settings.json'), 'utf-8').includes('kimi-k3'),
    );

    const settings = JSON.parse(readFileSync(join(piDir, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(settings['defaultModel']).toBe('kimi-k3');
    expect(settings['defaultProvider']).toBe('sillyhub');
    const auth = JSON.parse(readFileSync(join(piDir, 'auth.json'), 'utf-8')) as Record<string, unknown>;
    expect(auth['sillyhub']).toEqual({ type: 'api_key', key: 'sk-pi-hot-new' });
    expect(existsSync(join(piDir, 'models.json'))).toBe(true);
    expect(sawLog('hot_switch_rewrite', ['session_id=' + SESSION_ID, 'agent_kind=pi', 'rewritten=true'])).toBe(true);
  });

  it('claude kind 活跃会话 → 零动作（无目录创建、无 hot_switch_rewrite 日志；markPendingSwitch 照常）', async () => {
    const sm = createMockSessionManager(undefined, () => activeState(SESSION_ID));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: SAMPLE_PROVIDER_CONFIG },
    } as DaemonMessage);
    // 留拍给潜在异步写盘（不应发生——断言的是「零动作」）。
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
    expect(infoSpy.mock.calls.some((c) => c[0] === '[daemon.hot_switch_rewrite]')).toBe(false);
    expect(sm.markPendingSwitch).toHaveBeenCalledTimes(1);
  });

  it('provider_config=null → 不重写仅记日志（skipped_no_provider），预置目录内容不变', async () => {
    const codexHome = join(stubbedRoot(), 'codex', SESSION_ID);
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-keep-me"}');

    const sm = createMockSessionManager(undefined, () => activeState(SESSION_ID));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: null },
    } as DaemonMessage);
    await flushMicro();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(sm.markPendingSwitch).toHaveBeenCalledWith(SESSION_ID, null);
    expect(sawLog('hot_switch_rewrite_skipped_no_provider', ['session_id=' + SESSION_ID])).toBe(true);
    // 不重写：旧产物逐字保留（null = 停止/回退本机凭证，目录留待终态清理）。
    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toBe(
      '{"OPENAI_API_KEY":"sk-keep-me"}',
    );
    expect(infoSpy.mock.calls.some((c) => c[0] === '[daemon.hot_switch_rewrite]')).toBe(false);
  });

  it('markPendingSwitch 抛（session 不存在/迟到）→ 既有 warn 丢弃路径零回归，零重写', async () => {
    const sm = createMockSessionManager(() => {
      throw new Error('SessionNotFoundError: not in store');
    });
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: codexSwitchConfig() },
    } as DaemonMessage);
    await flushMicro();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(sm.markPendingSwitch).toHaveBeenCalledTimes(1);
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(infoSpy.mock.calls.some((c) => c[0] === '[daemon.hot_switch_rewrite]')).toBe(false);
  });

  it('会话终态（ended，store 仍在但 status 非活跃）→ 不重写（防死会话重建目录孤儿）', async () => {
    const sm = createMockSessionManager(undefined, (sid) => ({
      ...activeState(sid),
      status: 'ended',
    }));
    const built = buildDaemon({ sessionManager: sm });
    daemons.push(built.daemon);
    await built.daemon.start();
    await waitForWsInit(built.captured);
    built.captured.callbacks.onMessage!({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: { session_id: SESSION_ID, provider_config: codexSwitchConfig() },
    } as DaemonMessage);
    await flushMicro();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(infoSpy.mock.calls.some((c) => c[0] === '[daemon.hot_switch_rewrite]')).toBe(false);
  });
});
