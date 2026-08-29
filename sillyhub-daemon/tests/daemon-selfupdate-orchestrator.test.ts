/**
 * task-04（2026-08-29-daemon-selfupdate-safety）：daemon 自更新单入口编排器
 * _tryUpdate 测试（本变更核心任务）。
 *
 * 来源：tasks/task-04.md acceptance + design.md S1（Grill B2/B3 修正版流程图）。
 * 覆盖：
 *   - 忙判定 _isBusyForUpdate：session 在跑轮次 / taskRunner 活跃 lease /
 *     旧 mock（无 hasActiveLease）缺省不忙。
 *   - 所有权：已占忽略（在途下载 await 挂起期间第二条指令直接 return）；
 *     交接排定后保持到进程退出；noop/异常路径释放可再触发。
 *   - 忙推迟：writePendingUpdate 落 pending + 30s 复查定时器（不叠：pending 期间
 *     新触发仅刷新目标）；30s 重探仍忙再推迟、转空闲走升级链。
 *   - 终检（Grill B3）：下载 resolve 后注入新忙 → 回推迟，stop 不被调。
 *   - disk_change 直启：runDaemonSelfUpdate 零调用 + stop + respawn（盘上版本即
 *     目标，不被 manifest 的防降级/noop 挡死）。
 *   - server_command 顺序：runDaemonSelfUpdate → stop → respawn。
 *   - noop：释放 + clearPendingUpdate + 定时器清（advance 60s 无再触发）。
 *   - 接线：SELF_UPDATE case → _tryUpdate('server_command', version)；
 *     start() 末尾 startDiskProbe 回调 → _tryUpdate('disk_change', 盘上值)。
 *
 * 策略（照 disk-probe-pending.test.ts 惯例）：不跑真实升级链——preflight 模块
 * vi.mock 置换 runDaemonSelfUpdate / respawnDaemonAndExit / fetchLatestBuildId
 *（保留其余真实导出），daemon.stop / writePendingUpdate / clearPendingUpdate 用
 * 实例 spy 置换（不真 stop / 不落盘）；fake timers 驱动 30s 复查定时器。
 *
 * @module daemon-selfupdate-orchestrator.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';

// ── hoisted mocks（preflight 模块置换，daemon.ts 静态引入经此生效）─────────────

const {
  runPreflightMock,
  runDaemonSelfUpdateMock,
  respawnMock,
  fetchLatestBuildIdMock,
} = vi.hoisted(() => ({
  runPreflightMock: vi.fn(async () => undefined),
  runDaemonSelfUpdateMock: vi.fn(),
  respawnMock: vi.fn(),
  fetchLatestBuildIdMock: vi.fn(),
}));

vi.mock('../src/preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/preflight.js')>();
  return {
    ...actual,
    runPreflight: runPreflightMock,
    runDaemonSelfUpdate: runDaemonSelfUpdateMock,
    respawnDaemonAndExit: respawnMock,
    fetchLatestBuildId: fetchLatestBuildIdMock,
  };
});

import { Daemon, SELF_UPDATE_RETRY_INTERVAL_MS } from '../src/daemon.js';
import { BUILD_ID } from '../src/build-id.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import { makeTmpDir, cleanupDir } from './helpers.js';

// ── fixture ──────────────────────────────────────────────────────────────────

/** 完整 DaemonConfig fixture（照 disk-probe-pending.test.ts，循环间隔拉满防噪音）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task04-orch',
    profile: 'default',
    workspace_dir: '/tmp/ws-task04',
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

/** 最小 client mock（编排器路径只经 _handleWsMessage / 构造器，不触网络）。 */
function makeClient(): Record<string, unknown> {
  return { close: () => undefined };
}

/** 可翻转的忙开关（session 在跑轮次 / taskRunner 活跃 lease 两维）。 */
interface BusyFlags {
  session: boolean;
  lease: boolean;
}

/**
 * 构造编排器测试 harness：忙开关注入 mock sessionManager / taskRunner +
 * daemon 实例上 spy 置换 stop / writePendingUpdate / clearPendingUpdate（不真
 * stop / 不落盘）+ 私有方法访问器（照 disk-probe 测试 `_stopDiskProbe` 先例）。
 */
function makeHarness(opts: {
  sessionManager?: { hasRunningTurn: () => boolean } | null;
  taskRunner?: Record<string, unknown> | null;
  pendingPath: string;
}) {
  const busy: BusyFlags = { session: false, lease: false };
  const sessionManager =
    opts.sessionManager === undefined
      ? ({ hasRunningTurn: () => busy.session } as unknown as SessionManager)
      : opts.sessionManager;
  const taskRunner =
    opts.taskRunner === undefined
      ? {
          runLease: vi.fn(async () => ({
            status: 'completed',
            sessionId: '',
            success: true,
            exitCode: 0,
            patch: '',
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            output: '',
            error: '',
            durationMs: 0,
            metadata: {},
          })),
          hasActiveLease: () => busy.lease,
        }
      : opts.taskRunner;
  const daemon = new Daemon(
    makeConfig(),
    makeClient() as never,
    (taskRunner ?? null) as never,
    {
      sessionManager: sessionManager ?? null,
      pendingUpdatePath: opts.pendingPath,
      selfUpdateBundlePath: join(opts.pendingPath, '..', 'no-bundle.js'),
    },
  );
  const writeSpy = vi
    .spyOn(daemon, 'writePendingUpdate')
    .mockResolvedValue(undefined);
  const clearSpy = vi
    .spyOn(daemon, 'clearPendingUpdate')
    .mockResolvedValue(undefined);
  const stopSpy = vi.spyOn(daemon, 'stop').mockResolvedValue(undefined);
  type TryUpdate = (
    reason: 'server_command' | 'disk_change',
    targetVersion?: string,
  ) => Promise<void>;
  const tryUpdate = (
    reason: 'server_command' | 'disk_change',
    targetVersion?: string,
  ): Promise<void> =>
    (daemon as unknown as { _tryUpdate: TryUpdate })._tryUpdate(
      reason,
      targetVersion,
    );
  const isBusy = (): boolean =>
    (daemon as unknown as { _isBusyForUpdate: () => boolean })._isBusyForUpdate();
  const handleWsMessage = (msg: unknown): Promise<void> =>
    (
      daemon as unknown as {
        _handleWsMessage: (msg: unknown) => Promise<void>;
      }
    )._handleWsMessage(msg);
  return { daemon, busy, writeSpy, clearSpy, stopSpy, tryUpdate, isBusy, handleWsMessage };
}

/** 静音 daemon createLogger 的 console 输出（编排器每步记日志，防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

// ── 忙判定 ────────────────────────────────────────────────────────────────────

describe('task-04 S1 _isBusyForUpdate 忙判定（D-001）', () => {
  let tmpDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task04-busy-');
    restoreConsole = silenceConsole();
  });
  afterEach(async () => {
    restoreConsole();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  it('两侧空闲 → false', () => {
    const h = makeHarness({ pendingPath: join(tmpDir, 'pending.json') });
    expect(h.isBusy()).toBe(false);
  });

  it('session 存在在跑轮次（hasRunningTurn=true）→ true', () => {
    const h = makeHarness({ pendingPath: join(tmpDir, 'pending.json') });
    h.busy.session = true;
    expect(h.isBusy()).toBe(true);
  });

  it('taskRunner 存在活跃 lease（hasActiveLease=true）→ true', () => {
    const h = makeHarness({ pendingPath: join(tmpDir, 'pending.json') });
    h.busy.lease = true;
    expect(h.isBusy()).toBe(true);
  });

  it('旧 mock 兼容：taskRunner 无 hasActiveLease（TaskRunnerLike 可选化）→ 缺省不忙', () => {
    // 仅含 runLease 的旧测试 mock（Grill M14：可选方法不砸碎）。
    const h = makeHarness({
      taskRunner: { runLease: vi.fn(async () => ({})) },
      pendingPath: join(tmpDir, 'pending.json'),
    });
    expect(h.isBusy()).toBe(false);
  });

  it('未注入 sessionManager（null）+ 无 taskRunner → 不忙', () => {
    const h = makeHarness({
      sessionManager: null,
      taskRunner: null,
      pendingPath: join(tmpDir, 'pending.json'),
    });
    expect(h.isBusy()).toBe(false);
  });
});

// ── 所有权 + 推迟 + 复查定时器（fake timers）─────────────────────────────────

describe('task-04 S1 _tryUpdate 所有权/推迟/复查（D-002）', () => {
  let tmpDir: string;
  let pendingPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task04-orch-');
    pendingPath = join(tmpDir, 'pending-update.json');
    restoreConsole = silenceConsole();
    vi.useFakeTimers();
    runDaemonSelfUpdateMock.mockReset().mockResolvedValue(true);
    respawnMock.mockReset().mockReturnValue(undefined);
    fetchLatestBuildIdMock.mockReset().mockResolvedValue(null);
  });
  afterEach(async () => {
    restoreConsole();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await cleanupDir(tmpDir);
  });

  it('忙 → 推迟：写 pending（reason/当前/目标）+ 排 30s 定时器 + 所有权已释放（第二条指令可入）', async () => {
    const h = makeHarness({ pendingPath });
    h.busy.session = true;

    await h.tryUpdate('server_command', 'v-target-1');
    expect(h.writeSpy).toHaveBeenCalledTimes(1);
    expect(h.writeSpy).toHaveBeenCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'v-target-1',
    });
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
    expect(h.stopSpy).not.toHaveBeenCalled();

    // 所有权已释放：推迟态第二条指令可再入（刷新 pending 目标，不视为 in-flight 忽略）。
    await h.tryUpdate('server_command', 'v-target-2');
    expect(h.writeSpy).toHaveBeenCalledTimes(2);
    expect(h.writeSpy).toHaveBeenLastCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'v-target-2',
    });
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
    expect(h.stopSpy).not.toHaveBeenCalled();

    // 定时器恰 30s 后触发（29.999s 不触发）。
    await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS - 1);
    expect(h.writeSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    // 重探仍忙 → 再推迟恰一次（两次 defer 的定时器 clear+set 不叠——若叠了
    // t=30s 会 fire 两次，writeSpy 变 4）。
    expect(h.writeSpy).toHaveBeenCalledTimes(3);
  });

  it('30s 重探：仍忙再推迟；转空闲后走升级链（无限等 D-002）', async () => {
    const h = makeHarness({ pendingPath });
    h.busy.lease = true;

    await h.tryUpdate('disk_change', 'disksha-20260829');
    expect(h.writeSpy).toHaveBeenCalledTimes(1);

    // 第一轮重探：仍忙 → 再推迟。
    await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
    expect(h.writeSpy).toHaveBeenCalledTimes(2);
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();

    // 转空闲 → 第二轮重探走升级链（disk_change 不下载直启，见后续用例；此处
    // 用 server_command 验证下载链触发）。
    h.busy.lease = false;
    await h.tryUpdate('server_command', 'v-free');
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
    expect(respawnMock).toHaveBeenCalledTimes(1);
  });

  it('所有权已占忽略：下载 await 挂起期间第二条 _tryUpdate 直接 return', async () => {
    const h = makeHarness({ pendingPath });
    // 手动 deferred：模拟 runDaemonSelfUpdate 下载挂起中。
    let resolveUpdate!: (v: boolean) => void;
    runDaemonSelfUpdateMock.mockReturnValue(
      new Promise<boolean>((r) => {
        resolveUpdate = r;
      }),
    );

    const p1 = h.tryUpdate('server_command', 'v1');
    // async 函数体同步执行到首个 await：此刻已占所有权且升级链已进入。
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);

    await h.tryUpdate('server_command', 'v2'); // 已占 → 忽略立即返回
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    expect(h.writeSpy).not.toHaveBeenCalled();
    expect(h.clearSpy).not.toHaveBeenCalled();
    expect(h.stopSpy).not.toHaveBeenCalled();

    resolveUpdate(false); // noop 收尾
    await p1;
    expect(h.clearSpy).toHaveBeenCalledTimes(1);
    expect(h.stopSpy).not.toHaveBeenCalled();

    // noop 已释放：新指令可再触发。
    await h.tryUpdate('server_command', 'v3');
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(2);
  });

  it('noop：释放所有权 + clearPendingUpdate + 复查定时器清（advance 60s 无再触发）', async () => {
    const h = makeHarness({ pendingPath });
    h.busy.session = true;
    await h.tryUpdate('server_command', 'v-defer'); // 推迟，定时器已排

    h.busy.session = false;
    runDaemonSelfUpdateMock.mockResolvedValueOnce(false);
    await h.tryUpdate('server_command', 'v-defer');
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    expect(h.clearSpy).toHaveBeenCalledTimes(1);
    expect(h.stopSpy).not.toHaveBeenCalled();
    expect(respawnMock).not.toHaveBeenCalled();

    // 定时器已清：推迟态已离开，60s 内无任何重探（writeSpy 不增长）。
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.writeSpy).toHaveBeenCalledTimes(1);
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('终检（Grill B3）：下载 resolve 后注入新忙 → 回推迟，stop 未被调', async () => {
    const h = makeHarness({ pendingPath });
    // 下载完成瞬间注入新忙（模拟终检窗口内新起的 turn/lease）。
    runDaemonSelfUpdateMock.mockImplementationOnce(async () => {
      h.busy.session = true;
      return true;
    });

    await h.tryUpdate('server_command', 'v-late-busy');
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    // 回推迟：写 pending + 排定时器；不打断在跑任务。
    expect(h.writeSpy).toHaveBeenCalledTimes(1);
    expect(h.writeSpy).toHaveBeenCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'v-late-busy',
    });
    expect(h.stopSpy).not.toHaveBeenCalled();
    expect(respawnMock).not.toHaveBeenCalled();

    // 忙释放后 30s 重探走通升级链。
    h.busy.session = false;
    await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(2);
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
    expect(respawnMock).toHaveBeenCalledTimes(1);
  });

  it('disk_change 直启：runDaemonSelfUpdate 零调用 + stop + respawn；交接后所有权保持', async () => {
    const h = makeHarness({ pendingPath });

    await h.tryUpdate('disk_change', 'disksha-20260829');
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled(); // 不下载不查 manifest
    expect(fetchLatestBuildIdMock).not.toHaveBeenCalled();
    expect(h.writeSpy).not.toHaveBeenCalled(); // 直启不写 pending
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
    expect(respawnMock).toHaveBeenCalledTimes(1);

    // 交接排定后所有权保持到进程退出：后续触发被忽略。
    await h.tryUpdate('server_command', 'v-after');
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
    expect(h.writeSpy).not.toHaveBeenCalled();
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
  });

  it('disk_change 忙 → 同样推迟（写 pending 目标=盘上版本）+ 30s 重探', async () => {
    const h = makeHarness({ pendingPath });
    h.busy.session = true;

    await h.tryUpdate('disk_change', 'disksha-20260829');
    expect(h.writeSpy).toHaveBeenCalledWith({
      reason: 'disk_change',
      current_version: BUILD_ID,
      target_version: 'disksha-20260829',
    });

    h.busy.session = false;
    await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
    expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled(); // 重探仍直启
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
    expect(respawnMock).toHaveBeenCalledTimes(1);
  });

  it('server_command 顺序：runDaemonSelfUpdate → stop → respawn（stop 先于交接）', async () => {
    const h = makeHarness({ pendingPath });
    const order: string[] = [];
    runDaemonSelfUpdateMock.mockImplementation(async () => {
      order.push('download');
      return true;
    });
    h.stopSpy.mockImplementation(async () => {
      order.push('stop');
    });
    respawnMock.mockImplementation(() => {
      order.push('respawn');
    });

    await h.tryUpdate('server_command', 'v-order');
    expect(order).toEqual(['download', 'stop', 'respawn']);
    // 升级链参数：本地构建标识 + daemon 配置 + logger 适配回调。
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledWith(
      BUILD_ID,
      expect.anything(),
      expect.any(Function),
    );
  });

  it('推迟目标版本解析：指令缺 version → fetchLatestBuildId 兜底；失败 → <disk> 占位', async () => {
    const h = makeHarness({ pendingPath });
    h.busy.session = true;

    // 指令带 version：直接用，不拉 latest.json。
    await h.tryUpdate('server_command', 'v-explicit');
    expect(fetchLatestBuildIdMock).not.toHaveBeenCalled();

    // 缺 version：拉 latest.json 取目标，且复查定时器携带已解析目标（重探不重拉）。
    fetchLatestBuildIdMock.mockResolvedValue('latest-sha-20260829');
    await h.tryUpdate('server_command');
    expect(fetchLatestBuildIdMock).toHaveBeenCalledTimes(1);
    expect(h.writeSpy).toHaveBeenLastCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'latest-sha-20260829',
    });

    // latest.json 也失败 → '<disk>' 占位（可见性字段，不参与升级判定）。
    fetchLatestBuildIdMock.mockResolvedValue(null);
    await h.tryUpdate('server_command');
    expect(h.writeSpy).toHaveBeenLastCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: '<disk>',
    });

    // 重探携带已解析目标：转空闲后 30s 复查走升级链，fetchLatestBuildId 不再被调。
    h.busy.session = false;
    const callsBefore = fetchLatestBuildIdMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    expect(fetchLatestBuildIdMock.mock.calls.length).toBe(callsBefore);
  });

  it('SELF_UPDATE case 接线：WS 消息 → _tryUpdate(server_command, payload.version)', async () => {
    const h = makeHarness({ pendingPath });

    // 空闲：走升级链（fire-and-forget，微任务冲刷后断言）。
    await h.handleWsMessage({ type: MSG.SELF_UPDATE, payload: { version: 'ws-v9' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
    expect(h.stopSpy).toHaveBeenCalledTimes(1);
    expect(respawnMock).toHaveBeenCalledTimes(1);

    // 忙：同一入口走推迟（写 pending 目标=指令 version）。
    const h2 = makeHarness({ pendingPath });
    h2.busy.session = true;
    await h2.handleWsMessage({ type: MSG.SELF_UPDATE, payload: { version: 'ws-v10' } });
    expect(h2.writeSpy).toHaveBeenCalledTimes(1);
    expect(h2.writeSpy).toHaveBeenCalledWith({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'ws-v10',
    });
    expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1); // 未新增
  });
});

// ── start() 接线：磁盘探测回调汇入编排器（real timers，照 kind-dispatch 惯例）──

describe('task-04 S1 start() 磁盘探测接线', () => {
  let tmpDir: string;
  let restoreConsole: () => void;
  const daemons: Daemon[] = [];

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task04-start-');
    restoreConsole = silenceConsole();
    runDaemonSelfUpdateMock.mockReset().mockResolvedValue(true);
    respawnMock.mockReset().mockReturnValue(undefined);
  });
  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) await d.stop().catch(() => undefined);
    }
    daemons.length = 0;
    restoreConsole();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  /** 最小 client mock：register 返空 agent 集、claimLease 恒无 lease（循环静默）。 */
  function makeStartClient(): Record<string, unknown> {
    return {
      register: vi.fn(async () => ({ daemon_instance_id: 'i', runtimes: [] })),
      heartbeat: vi.fn(async () => ({})),
      markOffline: vi.fn(async () => ({})),
      claimLease: vi.fn(async () => null),
      completeLease: vi.fn(async () => ({})),
      getPendingLeases: vi.fn(async () => []),
      close: vi.fn(),
    };
  }

  it('start() 末尾接线 startDiskProbe：探测循环启动（差异回调归 _tryUpdate）', async () => {
    const detector = { detectAgents: vi.fn(async () => []) };
    const sessionManager = {
      hasRunningTurn: () => false,
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as SessionManager;
    const daemon = new Daemon(
      makeConfig({ self_reload_check_interval_sec: 600 }),
      makeStartClient() as never,
      null,
      {
        detector,
        sessionManager,
        pendingUpdatePath: join(tmpDir, 'pending-update.json'),
        selfUpdateBundlePath: join(tmpDir, 'no-bundle.js'),
      },
    );
    daemons.push(daemon);

    await daemon.start();
    expect(daemon.diskProbeActive).toBe(true);
  });

  it('self_reload_check_interval_sec=0：start() 不启动探测（task-03 既有判定）', async () => {
    const detector = { detectAgents: vi.fn(async () => []) };
    const daemon = new Daemon(
      makeConfig({ self_reload_check_interval_sec: 0 }),
      makeStartClient() as never,
      null,
      {
        detector,
        pendingUpdatePath: join(tmpDir, 'pending-update.json'),
        selfUpdateBundlePath: join(tmpDir, 'no-bundle.js'),
      },
    );
    daemons.push(daemon);

    await daemon.start();
    expect(daemon.diskProbeActive).toBe(false);
  });
});
