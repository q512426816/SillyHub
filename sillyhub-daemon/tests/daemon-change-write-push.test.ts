/**
 * 2026-10-16-backend-mem-polling task-07：change-write WS 轻通知 daemon 侧测试
 * （D-001@v1 / FR-07 / FR-08）。
 *
 * 覆盖：
 *   - 分发：CHANGE_WRITE_AVAILABLE 合法 payload → _pullPendingChangeWritesOnce
 *     立即拉取；缺 runtime_id → warn 丢弃不拉取（盲区1 旧 daemon 兼容面由
 *     protocol.contract.test 锁双端字面量）；
 *   - 兜底节奏门 changeWritePollDue：≥interval 到期 / 未到 / 非法间隔恒 true；
 *   - config 默认 change_write_poll_interval=120（轮询降级依据）。
 *
 * 策略：daemon 分发照 sillyspec-tombstone-cleanup.test.ts 的 makeDispatchHarness
 * 惯例（依赖注入 + spy 私有方法）；纯函数直测。
 *
 * @module daemon-change-write-push.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Daemon } from '../src/daemon.js';
import { changeWritePollDue } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DaemonMessage } from '../src/types.js';
import { MSG } from '../src/protocol.js';

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-cw01',
    profile: 'default',
    workspace_dir: '/tmp/ws-cw01',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    change_write_poll_interval: 120,
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
    sillyspec_status_interval_sec: 0,
    sillyspec_command_timeout_sec: 120,
    ...overrides,
  };
}

describe('task-07 change-write WS 轻通知 daemon 侧', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    const warnOrig = console.warn;
    const infoOrig = console.info;
    console.warn = () => {};
    console.info = () => {};
    restoreConsole = () => {
      console.warn = warnOrig;
      console.info = infoOrig;
    };
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  function makeHarness() {
    const daemon = new Daemon(
      makeConfig(),
      { heartbeat: vi.fn(async () => ({})) } as never,
      null as never,
      { sessionManager: null },
    );
    const pullSpy = vi
      .spyOn(daemon as never as { _pullPendingChangeWritesOnce: (rid: string) => Promise<void> }, '_pullPendingChangeWritesOnce')
      .mockResolvedValue(undefined);
    const handleWsMessage = (msg: DaemonMessage): Promise<void> =>
      (daemon as unknown as { _handleWsMessage: (m: DaemonMessage) => Promise<void> })
        ._handleWsMessage(msg);
    return { daemon, pullSpy, handleWsMessage };
  }

  it('双端契约：MSG.CHANGE_WRITE_AVAILABLE 与 backend 常量字面量逐字对齐', () => {
    expect(MSG.CHANGE_WRITE_AVAILABLE).toBe('daemon:change_write_available');
  });

  it('合法 payload → 立即拉取该 runtime 的 pending change-writes', async () => {
    const h = makeHarness();
    await expect(
      h.handleWsMessage({
        type: MSG.CHANGE_WRITE_AVAILABLE,
        payload: { runtime_id: 'rt-cw-target', workspace_id: null },
      } as unknown as DaemonMessage),
    ).resolves.toBeUndefined();
    expect(h.pullSpy).toHaveBeenCalledTimes(1);
    expect(h.pullSpy).toHaveBeenCalledWith('rt-cw-target');
  });

  it('缺 runtime_id / 空 runtime_id → warn 丢弃不拉取', async () => {
    const h = makeHarness();
    await expect(
      h.handleWsMessage({
        type: MSG.CHANGE_WRITE_AVAILABLE,
        payload: { workspace_id: 'ws-1' },
      } as unknown as DaemonMessage),
    ).resolves.toBeUndefined();
    await expect(
      h.handleWsMessage({
        type: MSG.CHANGE_WRITE_AVAILABLE,
        payload: { runtime_id: '', workspace_id: null },
      } as unknown as DaemonMessage),
    ).resolves.toBeUndefined();
    expect(h.pullSpy).not.toHaveBeenCalled();
  });

  it('兜底节奏门：到期/未到/非法间隔三态', () => {
    const interval = 120;
    expect(changeWritePollDue(0, interval, 120_000)).toBe(true);
    expect(changeWritePollDue(0, interval, 119_999)).toBe(false);
    expect(changeWritePollDue(1000, interval, 1000 + 120_000)).toBe(true);
    // 非法间隔恒 true（防配置错误卡死兜底通道）
    expect(changeWritePollDue(Date.now(), 0, Date.now())).toBe(true);
    expect(changeWritePollDue(Date.now(), -5, Date.now())).toBe(true);
    expect(changeWritePollDue(Date.now(), Number.NaN, Date.now())).toBe(true);
  });

  it('config 默认：change_write_poll_interval=120（轮询降级为兜底）', async () => {
    const { DEFAULT_CONFIG } = await import('../src/config.js');
    expect(DEFAULT_CONFIG.change_write_poll_interval).toBe(120);
  });

  it('旧 backend 兼容面：未知消息 default 分支 warn 丢弃不崩（盲区1）', async () => {
    const h = makeHarness();
    await expect(
      h.handleWsMessage({ type: 'daemon:not_a_real_type', payload: {} } as unknown as DaemonMessage),
    ).resolves.toBeUndefined();
    expect(h.pullSpy).not.toHaveBeenCalled();
  });
});
