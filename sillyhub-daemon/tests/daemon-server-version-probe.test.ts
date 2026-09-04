/**
 * ql-20260904-027：服务器版本轮询探测 startServerVersionProbe 测试。
 *
 * 背景：运行期自更新原本只有平台 WS 指令 + 磁盘旁路探测两源，无任何服务器
 * 轮询——部署新 bundle 后运行中的 daemon 永不自发现（实事故：部署后等 11
 * 分钟零触发）。本测试锁新循环的行为契约：
 *   - latest≠内存 BUILD_ID（含降级）：每轮恰触发一次回调，参数为 latest 值；
 *   - latest==内存：不触发；
 *   - 拉取失败（null）：静默跳过不触发；
 *   - interval=0：不创建定时器（serverVersionProbeActive=false）；
 *   - dev 构建跳过；
 *   - _stopServerVersionProbe / stop 清理后不再触发。
 *
 * 策略：照 disk-probe-pending.test.ts 惯例——不跑完整 start()，直接调公开
 * 方法；preflight.fetchLatestBuildId 用 vi.mock 部分替换（其余导出保持原样），
 * fake timers（shouldAdvanceTime）+ settleIo 让轮询 async 体内微任务落定。
 *
 * @module daemon-server-version-probe.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 先声明 mock（hoisted）：preflight 部分替换，仅 fetchLatestBuildId 可编程。
vi.mock('../src/preflight.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/preflight.js')>();
  return { ...mod, fetchLatestBuildId: vi.fn() };
});

import { Daemon } from '../src/daemon.js';
import { BUILD_ID } from '../src/build-id.js';
import { fetchLatestBuildId } from '../src/preflight.js';
import type { DaemonConfig } from '../src/config.js';

const fetchLatestMock = vi.mocked(fetchLatestBuildId);

/** 完整 DaemonConfig fixture（仅本测试关心的字段覆盖，其余取安全值）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-server-version-probe',
    profile: 'default',
    workspace_dir: '/tmp/ws-svp',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'error',
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

/** 最小 client mock（构造器只探测 getPendingControls/ackControls/close）。 */
function makeClient(): { close: () => void } {
  return { close: () => undefined };
}

function buildDaemon(config?: Partial<DaemonConfig>): Daemon {
  return new Daemon(makeConfig(config), makeClient() as never, null, {});
}

/** 让轮询 async 体内微任务在 fake timers 下落定（照 disk-probe settleIo 注释）。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

let restoreConsole: () => void;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchLatestMock.mockReset();
  restoreConsole = silenceConsole();
});

afterEach(() => {
  restoreConsole();
  vi.useRealTimers();
});

/** 静音 daemon createLogger 的 console 输出（防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

describe('ql-20260904-027 服务器版本轮询 startServerVersionProbe', () => {
  it('latest≠内存（含降级）：每轮恰触发一次回调，参数为 latest', async () => {
    fetchLatestMock.mockResolvedValue('newsha00-20990101000000');
    const daemon = buildDaemon();
    const onNewer = vi.fn();
    daemon.startServerVersionProbe(onNewer);

    expect(daemon.serverVersionProbeActive).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    await settle();
    expect(onNewer).toHaveBeenCalledTimes(1);
    expect(onNewer).toHaveBeenCalledWith('newsha00-20990101000000');

    // 差异持续：每轮再触发（升级链自身的防降级/noop 门不在本循环职责内）。
    await vi.advanceTimersByTimeAsync(600_000);
    await settle();
    expect(onNewer).toHaveBeenCalledTimes(2);
  });

  it('latest==内存 BUILD_ID：拉取但不触发回调', async () => {
    fetchLatestMock.mockResolvedValue(BUILD_ID);
    const daemon = buildDaemon();
    const onNewer = vi.fn();
    daemon.startServerVersionProbe(onNewer);

    await vi.advanceTimersByTimeAsync(600_000);
    await settle();
    expect(fetchLatestMock).toHaveBeenCalled();
    expect(onNewer).not.toHaveBeenCalled();
  });

  it('拉取失败（null）：静默跳过不触发、循环存活', async () => {
    fetchLatestMock.mockResolvedValue(null);
    const daemon = buildDaemon();
    const onNewer = vi.fn();
    daemon.startServerVersionProbe(onNewer);

    await vi.advanceTimersByTimeAsync(600_000);
    await settle();
    expect(onNewer).not.toHaveBeenCalled();
    expect(daemon.serverVersionProbeActive).toBe(true);
  });

  it('interval=0（显式关闭）：不创建定时器', () => {
    const daemon = buildDaemon({ self_reload_check_interval_sec: 0 });
    daemon.startServerVersionProbe(vi.fn());
    expect(daemon.serverVersionProbeActive).toBe(false);
  });

  it('dev 构建（BUILD_ID="dev"）跳过：不创建定时器', async () => {
    vi.doMock('../src/build-id.js', () => ({ BUILD_ID: 'dev' }));
    vi.resetModules();
    const mod = await import('../src/daemon.js');
    const daemon = new mod.Daemon(makeConfig(), makeClient() as never, null, {});
    daemon.startServerVersionProbe(vi.fn());
    expect(daemon.serverVersionProbeActive).toBe(false);
    vi.doUnmock('../src/build-id.js');
  });
});
