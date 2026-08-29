// tests/integration/selfupdate-scenarios.test.ts
// task-08（2026-08-29-daemon-selfupdate-safety）：SELF_UPDATE 安全层四路径集成
// 回归（design 全局验收标准）。
//
// 编排方式：node 环境 + 全 fake 编排（fake sessionManager / fake hub client /
// preflight 模块 vi.mock 置换下载与交接），照 tests/integration/resilience-
// scenarios.test.ts 形态真实构造 Daemon（不 start——三循环归 resilience 场景），
// 与单测（daemon-selfupdate-orchestrator.test.ts）的差别：writePendingUpdate /
// clearPendingUpdate / readPendingUpdate 走**真实落盘链**（spy-through 只记调用
// 不替换实现），磁盘探测路径③连探测循环本身也真实跑（真 bundle 文件 + 正则
// 提取 + 差异回调），端到端锁定安全层语义。
//
// 四路径（tasks/task-08.md acceptance）：
//   - 路径① 忙→推迟→空闲→升级：忙触发推迟（pending 真实落盘+30s 定时器+所有权
//     已释放可再入）→ fake timers 30s 重探仍忙再推迟 → 转空闲重探走下载链，
//     runDaemonSelfUpdate → stop → respawn 顺序断言。
//   - 路径② 下载窗口插任务→终检回推迟：可控 deferred 挂起下载，窗口内 fake
//     session 转 running → 终检拦下：stop/respawn 未被调、回推迟（pending 真实
//     保留在盘）→ 释放后 30s 重探走通升级链。
//   - 路径③ 磁盘替换→直启：真 bundle 文件（BUILD_ID≠内存）+ startDiskProbe
//     探测循环（与 start() 相同接线）→ runDaemonSelfUpdate / fetchLatestBuildId
//     零调用 → 直接 stop + respawn（盘上版本即意图，B2）。
//   - 路径④ pending 可见性闭环：writePendingUpdate → readPendingUpdate 四字段
//     → heartbeat 第 4 参恰三字段（剥 since）→ clearPendingUpdate 后
//     readPendingUpdate null + 第 4 参 undefined（无字段=backend 清除语义）。
//
// @module integration/selfupdate-scenarios.test
//

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── hoisted mocks（preflight 模块置换，daemon.ts 静态引入经此生效——照 ──
// daemon-selfupdate-orchestrator.test.ts 惯例：仅换自更新三件套，其余真实导出）──

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

vi.mock('../../src/preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/preflight.js')>();
  return {
    ...actual,
    runPreflight: runPreflightMock,
    runDaemonSelfUpdate: runDaemonSelfUpdateMock,
    respawnDaemonAndExit: respawnMock,
    fetchLatestBuildId: fetchLatestBuildIdMock,
  };
});

import { Daemon, SELF_UPDATE_RETRY_INTERVAL_MS } from '../../src/daemon.js';
import { BUILD_ID } from '../../src/build-id.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';
import { makeTmpDir, cleanupDir } from '../helpers.js';

// ── fixture ──────────────────────────────────────────────────────────────────

/** 完整 DaemonConfig fixture（照 daemon-selfupdate-orchestrator.test.ts）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task08-selfupdate',
    profile: 'default',
    workspace_dir: '/tmp/ws-task08',
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

/** 测试用假 bundle 内容（gen-build-id.mjs 生成的单行格式，regex 兼容）。 */
function bundleWith(buildId: string): string {
  return `// fake daemon bundle (task-08 integration test)\nexport const BUILD_ID = "${buildId}";\nexport const DAEMON_VERSION = "0.0.0";\n`;
}

/**
 * 集成 harness：真实 Daemon + 状态驱动的 fake sessionManager（忙判定唯一变量）
 * + fake hub client（heartbeat 记录第 4 参）。
 *
 * 与单测的差别：writePendingUpdate 用 spy-through（记调用同时保留真实落盘），
 * 只有 stop 置换（四路径均不 start()，真实 stop 全链属 resilience 场景③用例）。
 */
function makeHarness(opts: { pendingPath: string; bundlePath: string; intervalSec?: number }) {
  const heartbeatMock = vi.fn(async () => ({}));
  const client = { heartbeat: heartbeatMock, close: vi.fn() };
  // fake sessionManager：hasRunningTurn 由可翻转开关驱动（D-001：仅 running 算忙）。
  const session = { running: false };
  const sessionManager = {
    hasRunningTurn: () => session.running,
  } as unknown as SessionManager;
  const daemon = new Daemon(
    makeConfig({ self_reload_check_interval_sec: opts.intervalSec ?? 600 }),
    client as never,
    null as never,
    {
      sessionManager,
      pendingUpdatePath: opts.pendingPath,
      selfUpdateBundlePath: opts.bundlePath,
    },
  );
  // 路径④前置：直填一条已注册 runtime（照 daemon-heartbeat-pending.test.ts 惯例，
  // 否则 _sendHeartbeatOnce 首行 return false）。
  (
    daemon as unknown as { _registeredRuntimes: Map<string, string> }
  )._registeredRuntimes.set('claude', 'rt-task08-selfupdate-1');
  // R1（2026-08-30）起 30s 复查定时器带 ``!this._running`` 停机守卫——四路径
  // 不 start() 的本 harness 需模拟在跑 daemon，否则推迟路径的重探全被守卫跳过。
  (daemon as unknown as { _running: boolean })._running = true;

  // 顺序断言载体：download（mock 实现）/ stop（spy 置换）/ respawn（mock 实现）。
  const order: string[] = [];
  const stopSpy = vi
    .spyOn(daemon, 'stop')
    .mockImplementation(async () => {
      order.push('stop');
    });
  // spy-through：断言「被调」+ 参数，同时保留真实落盘（集成口径）。
  const writeSpy = vi.spyOn(daemon, 'writePendingUpdate');
  runDaemonSelfUpdateMock.mockImplementation(async () => {
    order.push('download');
    return true;
  });
  respawnMock.mockImplementation(() => {
    order.push('respawn');
  });

  type TryUpdateFn = (
    reason: 'server_command' | 'disk_change',
    targetVersion?: string,
  ) => Promise<void>;
  const tryUpdate: TryUpdateFn = (reason, targetVersion) =>
    (daemon as unknown as { _tryUpdate: TryUpdateFn })._tryUpdate(reason, targetVersion);
  const sendHeartbeatOnce = (): Promise<boolean> =>
    (daemon as unknown as { _sendHeartbeatOnce: () => Promise<boolean> })._sendHeartbeatOnce();
  const setBusy = (running: boolean): void => {
    session.running = running;
  };
  return { daemon, heartbeatMock, order, stopSpy, writeSpy, tryUpdate, sendHeartbeatOnce, setBusy };
}

/** 静音 daemon createLogger 的 console 输出（编排器每步记日志，防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

/**
 * 让真实 fs IO（node 线程池）在 fake timers 下有机会完成——照 disk-probe-
 * pending.test.ts 的 settleIo 惯例；shouldAdvanceTime 让 faked setTimeout 随
 * 真实时间自走，await 一个 50ms 定时器即让出真实事件循环。
 */
async function settleIo(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// ── 四路径 ───────────────────────────────────────────────────────────────────

describe('task-08 SELF_UPDATE 安全层四路径集成回归', () => {
  let tmpDir: string;
  let pendingPath: string;
  let bundlePath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task08-selfupdate-');
    pendingPath = join(tmpDir, 'pending-update.json');
    bundlePath = join(tmpDir, 'bin', 'sillyhub-daemon.js');
    restoreConsole = silenceConsole();
    runDaemonSelfUpdateMock.mockReset();
    respawnMock.mockReset();
    fetchLatestBuildIdMock.mockReset().mockResolvedValue(null);
  });
  afterEach(async () => {
    restoreConsole();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await cleanupDir(tmpDir);
  });

  // 路径①②③：30s 复查定时器 / 磁盘探测循环用 fake timers 驱动（shouldAdvanceTime
  // 让真实落盘 IO 与 fake timers 共存，见 settleIo 注释）。
  describe('路径① 忙→推迟→空闲→升级', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('忙触发推迟（pending 真实落盘+定时器排定+所有权已释放）→ 30s 仍忙再推迟 → 转空闲重探 download→stop→respawn', async () => {
      const h = makeHarness({ pendingPath, bundlePath });

      // ── 忙（fake session 在跑轮次）→ 推迟：写 pending + 不下载不打断 ──
      h.setBusy(true);
      await h.tryUpdate('server_command', 'v-target-1');
      expect(h.writeSpy).toHaveBeenCalledTimes(1);
      expect(h.writeSpy).toHaveBeenCalledWith({
        reason: 'server_command',
        current_version: BUILD_ID,
        target_version: 'v-target-1',
      });
      expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
      expect(h.stopSpy).not.toHaveBeenCalled();

      // ── 所有权已释放：推迟态第二条指令可再入（刷新目标，非 in-flight 忽略）──
      await h.tryUpdate('server_command', 'v-target-2');
      expect(h.writeSpy).toHaveBeenCalledTimes(2);

      // ── fake timers 30s 重探：仍忙 → 再推迟（真实落盘刷新目标版本）──
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
      await settleIo();
      expect(h.writeSpy).toHaveBeenCalledTimes(3);
      const rec = await h.daemon.readPendingUpdate();
      expect(rec).toMatchObject({
        reason: 'server_command',
        current_version: BUILD_ID,
        target_version: 'v-target-2',
      });
      expect(rec?.since).toEqual(expect.any(Number));
      expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
      expect(h.stopSpy).not.toHaveBeenCalled();

      // ── 转空闲 → 下一轮 30s 重探走升级链：download → stop → respawn 顺序 ──
      h.setBusy(false);
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
      await settleIo();
      expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);
      expect(h.order).toEqual(['download', 'stop', 'respawn']);
    });
  });

  describe('路径② 下载窗口插任务→终检回推迟', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('deferred 挂起下载期间注入新忙 → 终检拦下：stop/respawn 未调、pending 真实保留 → 释放后 30s 重探走通', async () => {
      const h = makeHarness({ pendingPath, bundlePath });

      // 可控 deferred：runDaemonSelfUpdate 下载挂起窗口（Grill B3 竞态窗口）。
      let resolveUpdate!: (v: boolean) => void;
      runDaemonSelfUpdateMock.mockImplementationOnce(() => {
        h.order.push('download');
        return new Promise<boolean>((r) => {
          resolveUpdate = r;
        });
      });

      const p = h.tryUpdate('server_command', 'v-window');
      // async 函数体同步执行到首个 await：下载已进入挂起窗口。
      expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(1);

      // 下载窗口内插入新任务：fake session 转 running。
      h.setBusy(true);
      resolveUpdate(true);
      await p;

      // 终检拦下：不打断在跑任务（stop/respawn 均未被调）。
      expect(h.stopSpy).not.toHaveBeenCalled();
      expect(respawnMock).not.toHaveBeenCalled();
      expect(h.order).toEqual(['download']); // 只有被挂起的那次下载，无交接动作

      // 回推迟：pending 真实保留在盘（四字段，目标=被推迟的指令版本）。
      expect(h.writeSpy).toHaveBeenCalledTimes(1);
      const rec = await h.daemon.readPendingUpdate();
      expect(rec).toEqual({
        reason: 'server_command',
        current_version: BUILD_ID,
        target_version: 'v-window',
        since: expect.any(Number),
      });

      // 回推迟非死路：忙释放后 30s 重探走通升级链（第二次 download 完整交接）。
      h.setBusy(false);
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_RETRY_INTERVAL_MS);
      await settleIo();
      expect(runDaemonSelfUpdateMock).toHaveBeenCalledTimes(2);
      expect(h.order).toEqual(['download', 'download', 'stop', 'respawn']);
    });
  });

  describe('路径③ 磁盘替换→直启', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('真 bundle 差异 → startDiskProbe 回调（start() 同款接线）→ 零下载直启 stop+respawn', async () => {
      // 盘上替换后的 bundle：BUILD_ID≠内存（差异即意图，含降级）。
      await mkdir(join(tmpDir, 'bin'), { recursive: true });
      const diskBuildId = 'disksha7f-20260829120500';
      await writeFile(bundlePath, bundleWith(diskBuildId), 'utf-8');

      // interval=5s：探测循环真实跑（readFile + 正则提取 + 差异比对）。
      const h = makeHarness({ pendingPath, bundlePath, intervalSec: 5 });

      // 与 daemon.start() 完全相同的接线（daemon.ts startDiskProbe 回调汇入 _tryUpdate）。
      const received: string[] = [];
      h.daemon.startDiskProbe((diskBuildIdFromDisk) => {
        received.push(diskBuildIdFromDisk);
        void h.tryUpdate('disk_change', diskBuildIdFromDisk);
      });
      expect(h.daemon.diskProbeActive).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      await settleIo();

      // 探测出口：恰一次，参数=盘上 BUILD_ID（正则提取自真实文件）。
      expect(received).toEqual([diskBuildId]);

      // B2 直启：不经 runDaemonSelfUpdate（不下载不查 manifest）、不拉 latest.json。
      expect(runDaemonSelfUpdateMock).not.toHaveBeenCalled();
      expect(fetchLatestBuildIdMock).not.toHaveBeenCalled();
      // 直启不写 pending（推迟才写）。
      expect(h.writeSpy).not.toHaveBeenCalled();
      expect(await h.daemon.readPendingUpdate()).toBeNull();
      // 直接 stop → respawn 到盘上版本。
      expect(h.order).toEqual(['stop', 'respawn']);
    });
  });

  // 路径④无定时器参与：real timers（writePendingUpdate 的 since=真实 Date.now()）。
  describe('路径④ pending 可见性闭环', () => {
    it('writePendingUpdate → readPendingUpdate 四字段 → heartbeat 第 4 参三字段（剥 since）→ clear 后 null+undefined', async () => {
      const h = makeHarness({ pendingPath, bundlePath });

      // 推迟落盘（照 disk_change 推迟路径的写入形状）。
      await h.daemon.writePendingUpdate({
        reason: 'disk_change',
        current_version: 'cur-p4',
        target_version: 'tgt-p4',
      });

      // readPendingUpdate：四字段全量读回（since=落盘时刻）。
      const rec = await h.daemon.readPendingUpdate();
      expect(rec).toEqual({
        reason: 'disk_change',
        current_version: 'cur-p4',
        target_version: 'tgt-p4',
        since: expect.any(Number),
      });

      // 心跳携带：第 4 参恰三字段（剥 since——backend 首落库盖 since，daemon 不上报）。
      await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
      expect(h.heartbeatMock).toHaveBeenCalledTimes(1);
      const first = h.heartbeatMock.mock.calls[0]!;
      expect(first.length).toBe(4);
      expect(first[3]).toEqual({
        reason: 'disk_change',
        current_version: 'cur-p4',
        target_version: 'tgt-p4',
      });
      expect(first[3]).not.toHaveProperty('since');
      // 前 3 参语义不变：daemonLocalId / providers / startedAt。
      expect(first[0]).toBe('rt-task08-selfupdate');
      expect(first[1]).toEqual([{ provider: 'claude', status: 'online' }]);

      // 清除闭环：readPendingUpdate null + 心跳第 4 参 undefined
      //（undefined=请求体无该键=backend 置 NULL 清除，task-06 反向语义）。
      await h.daemon.clearPendingUpdate();
      expect(await h.daemon.readPendingUpdate()).toBeNull();
      await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
      const second = h.heartbeatMock.mock.calls[1]!;
      expect(second.length).toBe(4);
      expect(second[3]).toBeUndefined();
    });
  });
});
