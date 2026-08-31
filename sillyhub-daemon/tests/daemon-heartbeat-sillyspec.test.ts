/**
 * task-05（2026-08-31-machine-sillyspec-version）：daemon 心跳/注册携带 sillyspec
 * 字段（FR-05 / D-002@v1 键存在性语义，design §1 协议与上报接线）。
 *
 * 来源：tasks/task-05.md acceptance + design.md「heartbeat/register body 扩展」。
 * 覆盖（四分支 + WS 指令接线）：
 *   - HubClient heartbeat 第 5 可选位置参数 sillyspec：
 *     · version/latest/update 齐备 → body 三键成对出现（update 为状态机快照形状）；
 *     · update 缺省（null/undefined）→ sillyspec_update 键完全不出现（=backend
 *       清除，pending_update 同款反向语义）；
 *     · version/latest 缺省（null/未知）→ 对应键不出现（兄弟字段语义=backend 保留）；
 *     · 整参缺省（4 参旧调用）→ 请求体无任何 sillyspec_* 键且逐字段与现状一致。
 *   - HubClient register sillyspec 参数：提供 → sillyspec_version/latest 成对携带
 *     （null 也携带，D-002@v1 register 直接落值语义）；缺省 → 两键不出现。
 *   - Daemon._sendHeartbeatOnce：manager 快照注入第 5 参——update===undefined 时
 *     整个 sillyspec 参数不占位（调用保持 4 参旧形态，pending 既有断言零回归）。
 *   - Daemon._registerDaemon：注册前 probeLocal/probeLatest 一次，快照 version/
 *     latest 随 register 携带（update 启动时恒无）。
 *   - WS SILLYSPEC_UPDATE → manager.requestUpgrade('server_command') fire-and-forget。
 *
 * 策略：hub-client 层照 hub-client.test.ts 惯例 vi.stubGlobal('fetch') mock；daemon
 * 层照 daemon-heartbeat-pending.test.ts 惯例真实构造 Daemon（client mock 只提供
 * heartbeat/register）+ DaemonOptions.sillyspecManager 注入假 manager（避免真实
 * spawn），_registeredRuntimes 直填一条绕过注册循环。
 *
 * @module daemon-heartbeat-sillyspec.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HubClient } from '../src/hub-client.js';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DaemonMessage } from '../src/types.js';
import { MSG, REST_PREFIX } from '../src/protocol.js';
import { DAEMON_VERSION } from '../src/daemon-version.js';
import { BUILD_ID } from '../src/build-id.js';
import type { SillySpecSnapshot } from '../src/sillyspec-manager.js';

// ── fetch mock 工具（照 daemon-heartbeat-pending.test.ts）─────────────────────

let lastCall: { url: string; init: RequestInit } | null = null;

/** 构造返回 2xx JSON 的 fetch 替身。 */
function mockFetchOk(body: unknown): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

// ── daemon 层 fixture ─────────────────────────────────────────────────────────

/** 完整 DaemonConfig fixture（循环间隔拉满防噪音；sillyspec 循环关闭防探测）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task05-ss',
    profile: 'default',
    workspace_dir: '/tmp/ws-task05-ss',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'debug',
    default_timeout_seconds: 1800,
    max_retries: 1,
    retry_max_attempts: 3,
    retry_base_delay_ms: 1000,
    retry_backoff_factor: 2,
    retry_jitter: 0.2,
    loop_restart_backoff_ms: 5000,
    max_loop_restarts: 10,
    outbox_max_per_run: 500,
    outbox_max_total: 5000,
    disconnect_log_threshold_sec: 30,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: [],
    spec_root_map: '',
    self_reload_check_interval_sec: 600,
    sillyspec_update_interval_sec: 9999,
    ...overrides,
  };
}

/**
 * 假 SillySpecManager（鸭子类型注入，避免真实 spawn）。快照/探测行为全部可编程。
 */
interface FakeManagerControls {
  snapshot: SillySpecSnapshot;
  probeLocalResult: string | null;
  probeLatestResult: string | null;
}

function makeFakeManager(controls: FakeManagerControls) {
  return {
    getSnapshot: vi.fn(() => controls.snapshot),
    probeLocal: vi.fn(async () => controls.probeLocalResult),
    probeLatest: vi.fn(async () => controls.probeLatestResult),
    requestUpgrade: vi.fn(async () => undefined),
    checkAndUpgrade: vi.fn(async () => undefined),
  };
}

/** 心跳 harness：真实构造 Daemon（client mock 仅 heartbeat），假 manager 注入。 */
function makeHeartbeatHarness(controls: FakeManagerControls) {
  const heartbeatMock = vi.fn(async () => ({}));
  const manager = makeFakeManager(controls);
  const daemon = new Daemon(
    makeConfig(),
    { heartbeat: heartbeatMock } as never,
    null as never,
    { sessionManager: null, sillyspecManager: manager as never },
  );
  (daemon as unknown as { _registeredRuntimes: Map<string, string> })._registeredRuntimes.set(
    'claude',
    'rt-task05-ss-1',
  );
  const sendHeartbeatOnce = (): Promise<boolean> =>
    (daemon as unknown as { _sendHeartbeatOnce: () => Promise<boolean> })._sendHeartbeatOnce();
  return { daemon, manager, heartbeatMock, sendHeartbeatOnce };
}

/** 注册 harness：真实构造 Daemon（client mock 仅 register），假 manager 注入。 */
function makeRegisterHarness(controls: FakeManagerControls) {
  const registerMock = vi.fn(async () => ({ runtimes: [] }));
  const manager = makeFakeManager(controls);
  const daemon = new Daemon(
    makeConfig(),
    { register: registerMock } as never,
    null as never,
    { sessionManager: null, sillyspecManager: manager as never },
  );
  const registerDaemon = (): Promise<void> =>
    (
      daemon as unknown as {
        _registerDaemon: (agents: unknown[]) => Promise<void>;
      }
    )._registerDaemon([{ provider: 'claude', path: '/usr/bin/claude' }]);
  return { daemon, manager, registerMock, registerDaemon };
}

/** 静音 daemon createLogger 的 console 输出（防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

// ── HubClient heartbeat 第 5 可选参数 sillyspec（body 契约）───────────────────

describe('task-05 HubClient heartbeat 第 5 可选参数 sillyspec', () => {
  beforeEach(() => {
    lastCall = null;
    vi.stubGlobal('fetch', mockFetchOk({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('version/latest/update 齐备 → body 三键成对出现（update 为状态机快照形状）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }], 1700000000000, undefined, {
      version: '3.26.15',
      latest_version: '3.27.11',
      update: {
        state: 'running',
        trigger: 'server_command',
        from_version: '3.26.15',
      },
    });
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.sillyspec_version).toBe('3.26.15');
    expect(body.sillyspec_latest_version).toBe('3.27.11');
    // toEqual 深比较：update 恰为状态机三字段快照（多余/缺失字段都会失败）。
    expect(body.sillyspec_update).toEqual({
      state: 'running',
      trigger: 'server_command',
      from_version: '3.26.15',
    });
  });

  it('update 缺省（undefined）→ sillyspec_update 键完全不出现（=backend 清除）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], 1700000000000, undefined, {
      version: '3.26.15',
      latest_version: '3.27.11',
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_update' in body).toBe(false);
    expect(body.sillyspec_update).toBeUndefined();
    expect(body.sillyspec_version).toBe('3.26.15');
  });

  it('update 显式 null → 键同样完全不出现（禁 null 兜底写键）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], null, undefined, {
      version: '3.26.15',
      update: null,
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_update' in body).toBe(false);
  });

  it('version/latest 缺省（null/未知）→ 对应键不出现（兄弟字段语义=backend 保留）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], null, undefined, {
      version: null,
      latest_version: null,
      update: { state: 'deferred', trigger: 'auto', from_version: null },
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_version' in body).toBe(false);
    expect('sillyspec_latest_version' in body).toBe(false);
    // update 不受 version/latest 缺省影响（独立键存在性）。
    expect(body.sillyspec_update).toEqual({
      state: 'deferred',
      trigger: 'auto',
      from_version: null,
    });
  });

  it('不传第 5 参（4 参旧调用）→ 请求体无任何 sillyspec_* 键且逐字段与现状一致（零破坏）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }], 1700000000000, {
      reason: 'server_command',
      current_version: 'cur-1',
      target_version: 'tgt-2',
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_version' in body).toBe(false);
    expect('sillyspec_latest_version' in body).toBe(false);
    expect('sillyspec_update' in body).toBe(false);
    // 与 daemon-heartbeat-pending.test.ts 同构的整 body 深比较（含 pending_update）。
    expect(body).toEqual({
      daemon_local_id: 'dlid-1',
      daemon_version: DAEMON_VERSION,
      daemon_build_id: BUILD_ID,
      started_at: new Date(1700000000000).toISOString(),
      providers: [{ provider: 'claude', status: 'online' }],
      pending_update: {
        reason: 'server_command',
        current_version: 'cur-1',
        target_version: 'tgt-2',
      },
    });
  });
});

// ── HubClient register sillyspec 参数（body 契约）─────────────────────────────

describe('task-05 HubClient register sillyspec 参数', () => {
  beforeEach(() => {
    lastCall = null;
    vi.stubGlobal('fetch', mockFetchOk({ runtimes: [] }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('提供 sillyspec → 两键成对携带（D-002@v1 register 直接落值语义）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'h',
      providers: [],
      sillyspec: { version: '3.26.15', latest_version: '3.27.11' },
    });
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/register`);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.sillyspec_version).toBe('3.26.15');
    expect(body.sillyspec_latest_version).toBe('3.27.11');
  });

  it('提供 sillyspec 且值为 null → 两键仍携带（卸载场景唯一落 NULL 路径）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'h',
      providers: [],
      sillyspec: { version: null, latest_version: '3.27.11' },
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.sillyspec_version).toBeNull();
    expect(body.sillyspec_latest_version).toBe('3.27.11');
  });

  it('缺省 sillyspec → 两键完全不出现（旧调用请求体逐字段不变）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'h',
      providers: [],
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_version' in body).toBe(false);
    expect('sillyspec_latest_version' in body).toBe(false);
  });
});

// ── Daemon._sendHeartbeatOnce 注入第 5 参（manager 快照透传）──────────────────

describe('task-05 Daemon._sendHeartbeatOnce 注入 sillyspec 快照', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('快照有 update → 第 5 参携带 update（+已知 version/latest）', async () => {
    const h = makeHeartbeatHarness({
      snapshot: {
        version: '3.26.15',
        latest_version: '3.27.11',
        update: { state: 'running', trigger: 'server_command', from_version: '3.26.15' },
      },
      probeLocalResult: null,
      probeLatestResult: null,
    });
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock).toHaveBeenCalledTimes(1);
    const call = h.heartbeatMock.mock.calls[0]!;
    expect(call.length).toBe(5);
    expect(call[4]).toEqual({
      version: '3.26.15',
      latest_version: '3.27.11',
      update: { state: 'running', trigger: 'server_command', from_version: '3.26.15' },
    });
    // 前 4 参语义不变：daemonLocalId / providers / startedAt / pendingUpdate。
    expect(call[0]).toBe('rt-task05-ss');
    expect(call[1]).toEqual([{ provider: 'claude', status: 'online' }]);
    expect(call[2]).toBeUndefined();
    expect(call[3]).toBeUndefined();
  });

  it('快照无 update、version 已知 → 第 5 参仅带 version（update 键完全不出现）', async () => {
    const h = makeHeartbeatHarness({
      snapshot: { version: '3.26.15', latest_version: null },
      probeLocalResult: null,
      probeLatestResult: null,
    });
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    const call = h.heartbeatMock.mock.calls[0]!;
    expect(call.length).toBe(5);
    expect(call[4]).toEqual({ version: '3.26.15' });
    expect('update' in (call[4] as object)).toBe(false);
    expect('latest_version' in (call[4] as object)).toBe(false);
  });

  it('快照三键全无（未探测/终态窗过期）→ 第 5 参不占位（调用保持 4 参旧形态）', async () => {
    const h = makeHeartbeatHarness({
      snapshot: { version: null, latest_version: null },
      probeLocalResult: null,
      probeLatestResult: null,
    });
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    const call = h.heartbeatMock.mock.calls[0]!;
    expect(call.length).toBe(4);
    expect(call[3]).toBeUndefined();
    expect(call[4]).toBeUndefined();
  });
});

// ── Daemon._registerDaemon 注册前探测 + 携带（design §1 启动衔接）────────────

describe('task-05 Daemon._registerDaemon 注册前探测并携带版本', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('注册前 probeLocal/probeLatest 各一次，快照 version/latest 随 register 携带', async () => {
    const h = makeRegisterHarness({
      snapshot: { version: '3.26.15', latest_version: '3.27.11' },
      probeLocalResult: '3.26.15',
      probeLatestResult: '3.27.11',
    });
    await expect(h.registerDaemon()).resolves.toBe(undefined);
    expect(h.manager.probeLocal).toHaveBeenCalledTimes(1);
    expect(h.manager.probeLatest).toHaveBeenCalledTimes(1);
    expect(h.registerMock).toHaveBeenCalledTimes(1);
    const params = h.registerMock.mock.calls[0]![0] as {
      sillyspec?: { version: string | null; latest_version: string | null };
    };
    expect(params.sillyspec).toEqual({ version: '3.26.15', latest_version: '3.27.11' });
  });

  it('探测全失败（双 null）→ sillyspec 参数缺省（键不出现，不误报未知）', async () => {
    const h = makeRegisterHarness({
      snapshot: { version: null, latest_version: null },
      probeLocalResult: null,
      probeLatestResult: null,
    });
    await expect(h.registerDaemon()).resolves.toBe(undefined);
    const params = h.registerMock.mock.calls[0]![0] as {
      sillyspec?: { version: string | null; latest_version: string | null };
    };
    expect(params.sillyspec).toBeUndefined();
  });

  it('本机未安装（local null / latest 已知）→ 仍携带 {version: null, ...}（卸载红徽标数据源）', async () => {
    const h = makeRegisterHarness({
      snapshot: { version: null, latest_version: '3.27.11' },
      probeLocalResult: null,
      probeLatestResult: '3.27.11',
    });
    await expect(h.registerDaemon()).resolves.toBe(undefined);
    const params = h.registerMock.mock.calls[0]![0] as {
      sillyspec?: { version: string | null; latest_version: string | null };
    };
    expect(params.sillyspec).toEqual({ version: null, latest_version: '3.27.11' });
  });
});

// ── WS SILLYSPEC_UPDATE → manager.requestUpgrade（fire-and-forget）───────────

describe('task-05 WS SILLYSPEC_UPDATE 指令接线', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('收到 daemon:sillyspec_update → requestUpgrade("server_command")，不抛不回执', async () => {
    const h = makeHeartbeatHarness({
      snapshot: { version: null, latest_version: null },
      probeLocalResult: null,
      probeLatestResult: null,
    });
    const handleWsMessage = (
      h.daemon as unknown as {
        _handleWsMessage: (msg: DaemonMessage) => Promise<void>;
      }
    )._handleWsMessage.bind(h.daemon);
    const msg: DaemonMessage = { type: MSG.SILLYSPEC_UPDATE, payload: {} };
    await expect(handleWsMessage(msg)).resolves.toBe(undefined);
    expect(h.manager.requestUpgrade).toHaveBeenCalledTimes(1);
    expect(h.manager.requestUpgrade).toHaveBeenCalledWith('server_command');
  });
});

// ── 类型层：快照类型可引用（编译期守卫，tsc --noEmit 覆盖）────────────────────

it('类型层：SillySpecSnapshot 形状可引用', () => {
  const snapshot: SillySpecSnapshot = { version: null, latest_version: null };
  expect(snapshot.update).toBeUndefined();
});
