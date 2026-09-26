/**
 * 2026-09-27-daemon-queue-stop-gaps：hits 周期上行器的 daemon 生命周期收口测试。
 *
 * 背景（只读审查实证）：`_hitsPeriodic` 在 start() 无条件 new 新实例并启动，但
 * `_stopInternal()` 清了四个兄弟定时器（恢复重试/磁盘探测/服务器版本轮询/升级
 * 复查）唯独漏它——同进程 stop→start 重启会叠加 interval，停机后到进程退出的
 * 窗口内仍触发上行。
 *
 * 覆盖行为：
 *   - `_stopInternal()` 调用 `_hitsPeriodic.stop()` 并置空实例（start() 下次
 *     无条件重建，置空只为幂等与「停机后不再上行」语义自明）；
 *   - 实例为 null 时重复停机不炸（?. 守卫）。
 *
 * 策略：照 sillyspec-platform-command.test.ts 惯例——真实构造 Daemon（最小
 * DaemonOptions，client 鸭子类型桩：无 markOffline 即 `_markRegisteredRuntimesOffline`
 * 短路；sessionManager/persistence/lockManager 均缺省 null，收尾链各守卫短路），
 * 私有字段/方法 `as unknown` 直达。零真实网络、零文件 IO、零平台分支。
 *
 * @module daemon-hits-periodic-lifecycle.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';

/** 完整 DaemonConfig fixture（循环间隔拉满防噪音；照 sillyspec-platform-command 惯例）。 */
function makeConfig(): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-hits-lifecycle',
    profile: 'default',
    workspace_dir: '/tmp/ws-hits-lifecycle',
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
    sillyspec_update_interval_sec: 0,
    self_reload_check_interval_sec: 0,
    sillyspec_command_timeout_sec: 120,
  } as DaemonConfig;
}

describe('2026-09-27-daemon-queue-stop-gaps：_stopInternal 清 hits 周期上行器', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('停机调用 _hitsPeriodic.stop() 并置空实例（同进程 stop→start 不残留旧 interval）', async () => {
    const daemon = new Daemon(
      makeConfig(),
      { heartbeat: vi.fn(async () => ({})), close: vi.fn() } as never,
      null as never,
      { sessionManager: null },
    );
    const fakeUploader = { stop: vi.fn() };
    (daemon as unknown as { _hitsPeriodic: unknown })._hitsPeriodic = fakeUploader;
    await (daemon as unknown as { _stopInternal: () => Promise<void> })._stopInternal();
    expect(fakeUploader.stop).toHaveBeenCalledTimes(1);
    expect((daemon as unknown as { _hitsPeriodic: unknown })._hitsPeriodic).toBeNull();
  });

  it('实例为 null（未启动/已清）时停机不炸（幂等重复停机）', async () => {
    const daemon = new Daemon(
      makeConfig(),
      { heartbeat: vi.fn(async () => ({})), close: vi.fn() } as never,
      null as never,
      { sessionManager: null },
    );
    const internals = daemon as unknown as { _stopInternal: () => Promise<void> };
    await expect(internals._stopInternal()).resolves.toBeUndefined();
    // 二次停机（stop() 幂等语义之外的直调路径）同样安全。
    await expect(internals._stopInternal()).resolves.toBeUndefined();
    expect((daemon as unknown as { _hitsPeriodic: unknown })._hitsPeriodic).toBeNull();
  });
});

function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}
