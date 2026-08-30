/**
 * task-05（2026-08-29-daemon-selfupdate-safety）：daemon 心跳携带 pending_update
 * （FR-04 / D-004@v1，design S3 可见性链 daemon 侧出口）。
 *
 * 来源：tasks/task-05.md acceptance + design.md S3。
 * 覆盖：
 *   - HubClient heartbeat 第 4 可选位置参数：传 → body.pending_update 恰含
 *     reason/current_version/target_version 三字段（无 since）；不传 / 显式
 *     undefined → 键完全不出现（禁空对象兜底）；3 参旧调用请求体逐字段与
 *     现状一致（零破坏，AC：hub-client 既有调用兼容）。
 *   - Daemon._sendHeartbeatOnce：pending 期注入第 4 参——spy readPendingUpdate
 *     返回记录（剥 since）与真实落盘链（writePendingUpdate → readPendingUpdate，
 *     task-03 读取口接线验证）两条路；无 pending（null / 文件不存在）→ 第 4 参
 *     undefined（body 无该键 = backend 清除，task-06「无字段=清除」语义）。
 *
 * 策略：hub-client 层照 hub-client.test.ts 惯例 vi.stubGlobal('fetch') mock（不
 * 发真实网络请求）；daemon 层照 daemon-selfupdate-orchestrator.test.ts 惯例真实
 * 构造 Daemon（client mock 只提供 heartbeat），_registeredRuntimes 直填一条绕过
 * 注册循环。
 *
 * @module daemon-heartbeat-pending.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

import { HubClient } from '../src/hub-client.js';
import { Daemon, RECOVER_AFTER_DEGRADED_MS } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { REST_PREFIX } from '../src/protocol.js';
import { DAEMON_VERSION } from '../src/daemon-version.js';
import { BUILD_ID } from '../src/build-id.js';
import { makeTmpDir, cleanupDir } from './helpers.js';

// ── fetch mock 工具（照 hub-client.test.ts，记录最后一次 (url, init)）──────────

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

// ── daemon 层 fixture（照 daemon-selfupdate-orchestrator.test.ts）─────────────

/** 完整 DaemonConfig fixture（循环间隔拉满防噪音）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task05-hb',
    profile: 'default',
    workspace_dir: '/tmp/ws-task05',
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
    ...overrides,
  };
}

/**
 * daemon 测试 harness：真实构造 Daemon（client mock 仅 heartbeat；成功路径
 * _syncAllowedRoots/_maybeTriggerControlPull 对空响应均安全 no-op），私有字段
 * `_registeredRuntimes` 直填一条（否则 _sendHeartbeatOnce 首行即 return false）。
 */
function makeDaemonHarness(pendingPath: string) {
  const heartbeatMock = vi.fn(async () => ({}));
  const daemon = new Daemon(
    makeConfig(),
    { heartbeat: heartbeatMock } as never,
    null as never,
    { sessionManager: null, pendingUpdatePath: pendingPath },
  );
  (daemon as unknown as { _registeredRuntimes: Map<string, string> })._registeredRuntimes.set(
    'claude',
    'rt-task05-hb-1',
  );
  const sendHeartbeatOnce = (): Promise<boolean> =>
    (daemon as unknown as { _sendHeartbeatOnce: () => Promise<boolean> })._sendHeartbeatOnce();
  return { daemon, heartbeatMock, sendHeartbeatOnce };
}

/** 静音 daemon createLogger 的 console 输出（落盘链会记 info 日志，防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

// ── HubClient heartbeat 第 4 可选参数（body 契约）─────────────────────────────

describe('task-05 HubClient heartbeat 第 4 可选参数 pendingUpdate', () => {
  beforeEach(() => {
    lastCall = null;
    vi.stubGlobal('fetch', mockFetchOk({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('传 pendingUpdate → body.pending_update 恰含三字段（无 since）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat(
      'dlid-1',
      [{ provider: 'claude', status: 'online' }],
      1700000000000,
      { reason: 'server_command', current_version: 'cur-1', target_version: 'tgt-2' },
    );
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    const body = JSON.parse(lastCall!.init.body as string);
    // toEqual 深比较：多出 since / 缺任一字段都会失败。
    expect(body.pending_update).toEqual({
      reason: 'server_command',
      current_version: 'cur-1',
      target_version: 'tgt-2',
    });
  });

  it('不传第 4 参（3 参旧调用）→ 请求体无 pending_update 键且逐字段与现状一致（零破坏）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }], 1700000000000);
    const body = JSON.parse(lastCall!.init.body as string);
    expect('pending_update' in body).toBe(false);
    // 与 hub-client.test.ts 既有断言同构的整 body 深比较（含 started_at 序列化）。
    expect(body).toEqual({
      daemon_local_id: 'dlid-1',
      daemon_version: DAEMON_VERSION,
      daemon_build_id: BUILD_ID,
      started_at: new Date(1700000000000).toISOString(),
      providers: [{ provider: 'claude', status: 'online' }],
    });
  });

  it('显式传 undefined（占位空参）→ 键同样完全不出现（禁空对象兜底）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }], null, undefined);
    const body = JSON.parse(lastCall!.init.body as string);
    expect('pending_update' in body).toBe(false);
    expect(body.pending_update).toBeUndefined();
  });
});

// ── Daemon._sendHeartbeatOnce 注入第 4 参（design S3 出口）────────────────────

describe('task-05 Daemon._sendHeartbeatOnce 注入 pending_update', () => {
  let tmpDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task05-hb-pending-');
    restoreConsole = silenceConsole();
  });
  afterEach(async () => {
    restoreConsole();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  it('spy readPendingUpdate 返回记录（含 since）→ 第 4 参剥 since 恰三字段', async () => {
    const h = makeDaemonHarness(join(tmpDir, 'pending.json'));
    vi.spyOn(h.daemon, 'readPendingUpdate').mockResolvedValue({
      reason: 'server_command',
      current_version: 'cur-a',
      target_version: 'tgt-b',
      since: 1750000000000,
    });
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock).toHaveBeenCalledTimes(1);
    const call = h.heartbeatMock.mock.calls[0]!;
    expect(call.length).toBe(4);
    // 剥掉 since 只传三字段（backend 首次落库盖 since，daemon 不上报）。
    expect(call[3]).toEqual({
      reason: 'server_command',
      current_version: 'cur-a',
      target_version: 'tgt-b',
    });
    // 前 3 参语义不变：daemonLocalId / providers / startedAt。
    expect(call[0]).toBe('rt-task05-hb');
    expect(call[1]).toEqual([{ provider: 'claude', status: 'online' }]);
    expect(call[2]).toBeUndefined();
  });

  it('spy readPendingUpdate 返回 null → 第 4 参 undefined（无字段=清除语义）', async () => {
    const h = makeDaemonHarness(join(tmpDir, 'pending.json'));
    vi.spyOn(h.daemon, 'readPendingUpdate').mockResolvedValue(null);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock).toHaveBeenCalledTimes(1);
    expect(h.heartbeatMock.mock.calls[0]![3]).toBeUndefined();
  });

  it('真实落盘链（writePendingUpdate → readPendingUpdate）→ disk_change 记录注入三字段', async () => {
    const h = makeDaemonHarness(join(tmpDir, 'pending-disk.json'));
    await h.daemon.writePendingUpdate({
      reason: 'disk_change',
      current_version: 'cur-disk',
      target_version: 'tgt-disk',
    });
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock.mock.calls[0]![3]).toEqual({
      reason: 'disk_change',
      current_version: 'cur-disk',
      target_version: 'tgt-disk',
    });
  });

  it('R2：覆盖写（target 已存在）→ 直接 rename 原子替换成功，内容为最新', async () => {
    const h = makeDaemonHarness(join(tmpDir, 'pending-overwrite.json'));
    await h.daemon.writePendingUpdate({
      reason: 'disk_change',
      current_version: 'cur-1',
      target_version: 'tgt-1',
    });
    // 第二次覆盖（target 已存在——修复前无条件先 unlink，存在 ENOENT 窗口）
    await h.daemon.writePendingUpdate({
      reason: 'server_command',
      current_version: 'cur-2',
      target_version: 'tgt-2',
    });
    const rec = await h.daemon.readPendingUpdate();
    expect(rec).not.toBeNull();
    expect(rec?.reason).toBe('server_command');
    expect(rec?.current_version).toBe('cur-2');
    expect(rec?.target_version).toBe('tgt-2');
    expect(rec?.since).toBeTruthy();
  });

  it('无 pending 文件（真实读取路径）→ 第 4 参 undefined', async () => {
    const h = makeDaemonHarness(join(tmpDir, 'absent.json'));
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock).toHaveBeenCalledTimes(1);
    expect(h.heartbeatMock.mock.calls[0]![3]).toBeUndefined();
  });
});

// ── task-06（2026-08-30-daemon-self-heal）：心跳脱离降级触发恢复 ─────────────
//
// 覆盖（tasks/task-06.md acceptance）：
//   - 断连累计 >RECOVER_AFTER_DEGRADED_MS（720s，D-001）→ 下一拍心跳成功触发
//     _recoverPersistedSessions('heartbeat_recover')；_recoverInFlight 在途置位 /
//     finally 复位；下一拍（failSince 已清、无 pending）不重复触发（R6）。
//   - ≤720s 闪断不触发；boot 首拍 failSince=null 不触发；恰 =720_000（严格大于
//     才触发）不触发、+1ms 触发。
//   - 忙（在跑 turn）→ D-007 忙门控：仅置 _recoverPendingAfterDegraded + warn
//     session_recover_deferred_busy，不打断本地工作；空闲后下一拍心跳（纯靠
//     pending 复查臂）补触发并清标志。
//   - 无持久化记录 → 真实恢复链零成本早退（load 一次 [] 即返回，无 recover 调用）。
//   - D-008：401/403 分支补置 failSince（原 null 时）；已非 null 不覆盖；
//     heartbeat_auth_rejected FATAL 日志语义不变。
//
// 直驱私有 _sendHeartbeatOnce 的注入模式与上方 task-05 harness 同口径。

/** task-06 私有成员直取类型（忙门控/触发链断言载体）。 */
interface RecoverInternals {
  _registeredRuntimes: Map<string, string>;
  _heartbeatFailSince: number | null;
  _recoverInFlight: boolean;
  _recoverPendingAfterDegraded: boolean;
  _recoverPersistedSessions: (trigger: string) => Promise<void>;
  _logger: {
    warn: (event: string, kv?: Record<string, unknown>) => void;
    error: (event: string, kv?: Record<string, unknown>) => void;
  };
}

/**
 * task-06 恢复触发 harness：真实构造 Daemon（client mock 仅 heartbeat），在
 * makeDaemonHarness 基础上支持忙开关（hasRunningTurn，D-007 唯一变量）与
 * 持久化三件套注入（零记录早退用例走真实 _recoverPersistedSessions）。
 */
function makeRecoverHarness(
  pendingPath: string,
  opts: { running?: boolean; persistence?: unknown; recoveryClient?: unknown } = {},
) {
  const heartbeatMock = vi.fn(async () => ({}));
  const session = { running: opts.running ?? false };
  const daemon = new Daemon(
    makeConfig(),
    { heartbeat: heartbeatMock } as never,
    null as never,
    {
      sessionManager: { hasRunningTurn: () => session.running } as never,
      persistence: (opts.persistence ?? null) as never,
      recoveryClient: (opts.recoveryClient ?? null) as never,
      pendingUpdatePath: pendingPath,
    },
  );
  const anyd = daemon as unknown as RecoverInternals;
  anyd._registeredRuntimes.set('claude', 'rt-task06-hb-1');
  const sendHeartbeatOnce = (): Promise<boolean> =>
    (daemon as unknown as { _sendHeartbeatOnce: () => Promise<boolean> })._sendHeartbeatOnce();
  const setFailSinceMsAgo = (msAgo: number | null): void => {
    anyd._heartbeatFailSince = msAgo === null ? null : Date.now() - msAgo;
  };
  const spyRecover = () =>
    vi.spyOn(anyd, '_recoverPersistedSessions').mockResolvedValue(undefined);
  return { daemon, heartbeatMock, anyd, session, sendHeartbeatOnce, setFailSinceMsAgo, spyRecover };
}

/** 让 fire-and-forget 恢复的微任务（含 .finally 复位）走完（真实定时器用例）。 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('task-06 心跳脱离降级触发恢复（RECOVER_AFTER_DEGRADED_MS 守卫 + D-007 忙门控）', () => {
  let tmpDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task06-hb-recover-');
    restoreConsole = silenceConsole();
  });
  afterEach(async () => {
    restoreConsole();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  it('断连累计 >720s → 触发 _recoverPersistedSessions(heartbeat_recover)，在途标志置位后 finally 复位，不重复触发', async () => {
    const h = makeRecoverHarness(join(tmpDir, 'p1.json'));
    let inFlightAtCall: boolean | null = null;
    const recoverSpy = h
      .spyRecover()
      .mockImplementation(async () => {
        // 调用时刻在途标志应已置位（_isBusyForUpdate 第三臂数据源，D-002）。
        inFlightAtCall = h.anyd._recoverInFlight;
      });
    h.setFailSinceMsAgo(RECOVER_AFTER_DEGRADED_MS + 60_000);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith('heartbeat_recover');
    expect(inFlightAtCall).toBe(true);
    // 成功拍已重置降级起点（触发用捕获值，重置语义不变）。
    expect(h.anyd._heartbeatFailSince).toBeNull();
    await flushAsync();
    expect(h.anyd._recoverInFlight).toBe(false);
    // 下一拍（failSince 已清、无 pending）不重复触发（R6：boot/恢复无重叠）。
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).toHaveBeenCalledTimes(1);
  });

  it('断连累计 ≤720s 的闪断不触发；boot 首拍 failSince=null 也不触发', async () => {
    const h = makeRecoverHarness(join(tmpDir, 'p2.json'));
    const recoverSpy = h.spyRecover();
    // 600s 闪断：sweep 宽限（600s）未翻 suspended，不触发。
    h.setFailSinceMsAgo(600_000);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).not.toHaveBeenCalled();
    // 首拍语义（failSince=null → degradedMs=0）：boot 后第一拍不触发。
    h.setFailSinceMsAgo(null);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).not.toHaveBeenCalled();
  });

  it('阈值边界：恰 =720_000（严格大于才触发）不触发；+1ms 触发', async () => {
    // 冻结时间做精确边界（真实时钟下毫秒漂移会把「恰等于」推成「大于」）。
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const h = makeRecoverHarness(join(tmpDir, 'p-boundary.json'));
    vi.spyOn(h.daemon, 'readPendingUpdate').mockResolvedValue(null);
    const recoverSpy = h.spyRecover();
    // 恰好 720_000：degradedMs === RECOVER_AFTER_DEGRADED_MS，非严格大于 → 不触发。
    h.anyd._heartbeatFailSince = 1_700_000_000_000 - RECOVER_AFTER_DEGRADED_MS;
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).not.toHaveBeenCalled();
    // +1ms 越过守卫 → 触发（advanceTimersByTimeAsync(0) 冲刷微任务让 finally 复位）。
    vi.setSystemTime(1_700_000_000_001);
    h.anyd._heartbeatFailSince = 1_700_000_000_001 - RECOVER_AFTER_DEGRADED_MS - 1;
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith('heartbeat_recover');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.anyd._recoverInFlight).toBe(false);
  });

  it('忙（在跑 turn）→ 仅置 pending + warn session_recover_deferred_busy；空闲后下一拍心跳补触发并清标志', async () => {
    const h = makeRecoverHarness(join(tmpDir, 'p3.json'), { running: true });
    const recoverSpy = h.spyRecover();
    const warnSpy = vi.spyOn(h.anyd._logger, 'warn');
    h.setFailSinceMsAgo(RECOVER_AFTER_DEGRADED_MS + 60_000);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    // 忙门控（D-007）：不触发恢复链、不置在途（本地在跑轮次不被打断）。
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(h.anyd._recoverInFlight).toBe(false);
    expect(h.anyd._recoverPendingAfterDegraded).toBe(true);
    const deferCall = warnSpy.mock.calls.find(([ev]) => ev === 'session_recover_deferred_busy');
    expect(deferCall).toBeDefined();
    expect((deferCall![1] as { degraded_ms: number }).degraded_ms).toBeGreaterThan(
      RECOVER_AFTER_DEGRADED_MS,
    );
    // 空闲（turn 结束）→ 下一拍心跳：failSince 已 null、degradedMs=0，纯靠
    // pending 复查臂补触发，触发后清标志。
    h.session.running = false;
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith('heartbeat_recover');
    expect(h.anyd._recoverPendingAfterDegraded).toBe(false);
    await flushAsync();
    expect(h.anyd._recoverInFlight).toBe(false);
  });

  it('无持久化记录 → 恢复链零成本早退（真实 _recoverPersistedSessions：load 一次 [] 即返回，无 recover 调用）', async () => {
    const loadSpy = vi.fn(async () => [] as never[]);
    const recoverSession = vi.fn(async () => ({ status: 'reconnecting' }));
    const h = makeRecoverHarness(join(tmpDir, 'p4.json'), {
      persistence: { load: loadSpy },
      recoveryClient: { recoverSession },
    });
    h.setFailSinceMsAgo(RECOVER_AFTER_DEGRADED_MS + 60_000);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    await flushAsync();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(recoverSession).not.toHaveBeenCalled();
    expect(h.anyd._recoverInFlight).toBe(false);
  });

  it('D-008：401/403 凭证拒绝补置 failSince（原 null 时）；已非 null 保持原值不覆盖；FATAL 日志语义不变', async () => {
    const h = makeRecoverHarness(join(tmpDir, 'p5.json'));
    const errorSpy = vi.spyOn(h.anyd._logger, 'error');
    // 401：原 null → 补置降级起点。
    h.heartbeatMock.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );
    await expect(h.sendHeartbeatOnce()).resolves.toBe(false);
    expect(h.anyd._heartbeatFailSince).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'heartbeat_auth_rejected',
      expect.objectContaining({ status: 401 }),
    );
    // 401 分支清了注册表 → 模拟重注册后再打 403（已非 null → 不覆盖最早时刻）。
    h.anyd._registeredRuntimes.set('claude', 'rt-task06-hb-2');
    const earliest = h.anyd._heartbeatFailSince! - 5_000;
    h.anyd._heartbeatFailSince = earliest;
    h.heartbeatMock.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { status: 403 }),
    );
    await expect(h.sendHeartbeatOnce()).resolves.toBe(false);
    expect(h.anyd._heartbeatFailSince).toBe(earliest);
    expect(errorSpy).toHaveBeenCalledWith(
      'heartbeat_auth_rejected',
      expect.objectContaining({ status: 403 }),
    );
  });
});
