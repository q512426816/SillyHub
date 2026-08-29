/**
 * task-03（2026-08-29-daemon-selfupdate-safety）：磁盘旁路探测 + pending-update 测试。
 *
 * 来源：tasks/task-03.md acceptance + design.md S2/S3。
 * 覆盖：
 *   - S2 探测：差异恰触发一次回调（参数=盘上 BUILD_ID）/ 同值不触发 / 读失败与
 *     正则不中不触发（D-003@v2 防替换窗口自杀）/ interval=0 不创建定时器 /
 *     dev 构建跳过 / 定时器清理。
 *   - S3 pending：原子写（tmp+rename，无 tmp 残留）读回四字段 / 覆盖写 /
 *     clear 删除 + 幂等 / readPendingUpdateFile 严格校验 / 启动清矛盾残留
 *    （target==内存删、target≠内存留、结构无效删）。
 *   - S3 status：cli.statusAction 存在 pending 时追加「等待空闲升级」行
 *    （HOME/USERPROFILE stub 隔离，照 cli.test.ts 惯例）。
 *
 * 策略：不跑完整 daemon.start()（preflight spawn 在 fake timers 下会卡死，照
 * w1-resilience.test.ts 教训），直接调 task-03 公开方法；路径经 DaemonOptions
 * （selfUpdateBundlePath / pendingUpdatePath）注入临时目录，不污染真实 ~/.sillyhub。
 *
 * @module disk-probe-pending.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Daemon, readPendingUpdateFile } from '../src/daemon.js';
import { BUILD_ID } from '../src/build-id.js';
import type { DaemonConfig } from '../src/config.js';
import { makeTmpDir, cleanupDir } from './helpers.js';

// ── fixture ──────────────────────────────────────────────────────────────────

/** 测试用假 bundle 内容（gen-build-id.mjs 生成的单行格式，regex 兼容）。 */
function bundleWith(buildId: string): string {
  return `// fake daemon bundle (task-03 test)\nexport const BUILD_ID = "${buildId}";\nexport const DAEMON_VERSION = "0.0.0";\n`;
}

/** 完整 DaemonConfig fixture（仅本测试关心的字段覆盖，其余取安全值）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task03-disk-probe',
    profile: 'default',
    workspace_dir: '/tmp/ws-task03',
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

/** 最小 client mock（构造器只探测 getPendingControls/ackControls/close）。 */
function makeClient(): { close: () => void } {
  return { close: () => undefined };
}

/** 构造注入了临时 bundle/pending 路径的 Daemon（不 start，直接调 task-03 方法）。 */
function buildDaemon(opts: {
  config?: Partial<DaemonConfig>;
  bundlePath: string;
  pendingPath: string;
}): Daemon {
  return new Daemon(makeConfig(opts.config), makeClient() as never, null, {
    selfUpdateBundlePath: opts.bundlePath,
    pendingUpdatePath: opts.pendingPath,
  });
}

/** 静音 daemon createLogger 的 console 输出（探测定时器每轮记日志，防刷屏）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

// ── S2：磁盘旁路探测 ─────────────────────────────────────────────────────────

/**
 * 让真实 fs IO（node 线程池 readFile）在 fake timers 下有机会完成。
 *
 * 纯 advanceTimersByTimeAsync 只推进假时钟 + 微任务，真实线程池回调拿不到事件循环
 * 轮转 → 探测的 readFile 永不 resolve（回调断言恒 0，实测踩坑）。开
 * shouldAdvanceTime 后假时钟随真实时间自走：await 一个 faked setTimeout 即让出
 * 真实事件循环 ~50ms，期间 readFile 完成且回调微任务落定。
 */
async function settleIo(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('task-03 S2 磁盘旁路探测 startDiskProbe', () => {
  let tmpDir: string;
  let bundlePath: string;
  let pendingPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    // shouldAdvanceTime：见 settleIo 注释（真实 IO 与 fake timers 共存的关键）。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tmpDir = await makeTmpDir('task03-probe-');
    bundlePath = join(tmpDir, 'bin', 'sillyhub-daemon.js');
    pendingPath = join(tmpDir, 'pending-update.json');
    restoreConsole = silenceConsole();
  });

  afterEach(async () => {
    restoreConsole();
    vi.useRealTimers();
    await cleanupDir(tmpDir);
  });

  it('盘上 BUILD_ID≠内存（含降级）：每轮恰触发一次回调，参数为盘上 BUILD_ID', async () => {
    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    // 任意差异值即触发（降级同理：操作者换文件即意图，不做新旧的语义）。
    await writeFile(bundlePath, bundleWith('oldsha00-20200101000000'), 'utf-8');

    const daemon = buildDaemon({ bundlePath, pendingPath });
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    expect(daemon.diskProbeActive).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    expect(onDiskChange).toHaveBeenCalledTimes(1);
    expect(onDiskChange).toHaveBeenCalledWith('oldsha00-20200101000000');

    // 差异持续存在：每轮再触发（每轮至多一次；去抖/刷新语义归 task-04 pending 路径）。
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    expect(onDiskChange).toHaveBeenCalledTimes(3);
  });

  it('盘上 BUILD_ID==内存：不触发回调', async () => {
    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    await writeFile(bundlePath, bundleWith(BUILD_ID), 'utf-8');

    const daemon = buildDaemon({ bundlePath, pendingPath });
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    // settleIo 让 readFile 真实完成（非空转断言：读到同值后选择不动作）。
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    await vi.advanceTimersByTimeAsync(600_000 * 2);
    await settleIo();
    expect(onDiskChange).not.toHaveBeenCalled();
  });

  it('读文件失败（bundle 不存在）：不触发回调（D-003@v2 探测失败≠版本变化）', async () => {
    // 不写 bundle 文件（bin 目录也不存在）。
    const daemon = buildDaemon({ bundlePath, pendingPath });
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    expect(onDiskChange).not.toHaveBeenCalled();
  });

  it('正则不中 / 提取值为空：不触发回调', async () => {
    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    // 无 BUILD_ID 字样的普通 JS。
    await writeFile(bundlePath, 'export const OTHER = 1;\n', 'utf-8');
    const daemonA = buildDaemon({ bundlePath, pendingPath });
    const cbA = vi.fn();
    daemonA.startDiskProbe(cbA);
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    expect(cbA).not.toHaveBeenCalled();

    // 空值（`BUILD_ID = ""` 捕获组要求 1+ 非引号字符 → 不匹配）。
    await writeFile(bundlePath, 'export const BUILD_ID = "";\n', 'utf-8');
    const daemonB = buildDaemon({ bundlePath, pendingPath });
    const cbB = vi.fn();
    daemonB.startDiskProbe(cbB);
    await vi.advanceTimersByTimeAsync(600_000);
    await settleIo();
    expect(cbB).not.toHaveBeenCalled();
  });

  it('self_reload_check_interval_sec=0：不创建定时器（显式关闭）', () => {
    const daemon = buildDaemon({
      config: { self_reload_check_interval_sec: 0 },
      bundlePath,
      pendingPath,
    });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(daemon.diskProbeActive).toBe(false);
    // 必须还原：残留 spy 会破坏后续 useFakeTimers({shouldAdvanceTime}) 的挂载。
    setIntervalSpy.mockRestore();
  });

  it('dev 构建（BUILD_ID="dev"）跳过探测：不创建定时器', async () => {
    // build-id.js 是模块顶层常量，静态 import 已绑定真实值；用 resetModules +
    // doMock 注入 'dev' 后动态 import，让 daemon.ts 拿到 dev 构建。
    vi.resetModules();
    vi.doMock('../src/build-id.js', () => ({ BUILD_ID: 'dev' }));
    const { Daemon: DaemonDev } = await import('../src/daemon.js');

    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    await writeFile(bundlePath, bundleWith('releasesha-20260101000000'), 'utf-8');

    const daemon = new DaemonDev(
      makeConfig(),
      makeClient() as never,
      null,
      { selfUpdateBundlePath: bundlePath, pendingUpdatePath: pendingPath },
    );
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    expect(daemon.diskProbeActive).toBe(false);
    await vi.advanceTimersByTimeAsync(600_000 * 2);
    expect(onDiskChange).not.toHaveBeenCalled();
    vi.doUnmock('../src/build-id.js');
  });

  it('定时器 unref 可用且 _stopDiskProbe 清理（stop() 同款路径）', async () => {
    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    await writeFile(bundlePath, bundleWith('othersha1-20260101000000'), 'utf-8');

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      const daemon = buildDaemon({ bundlePath, pendingPath });
      daemon.startDiskProbe(vi.fn());

      // fake timers（Node 目标）返回带 unref/ref 的 Timer 对象——验证 unref 挂钩存在
      //（生产 NodeJS.Timeout 恒有；实现侧 typeof 守卫兼容无 unref 环境）。
      const timer = setIntervalSpy.mock.results[0]?.value as
        | { unref?: unknown }
        | undefined;
      expect(timer).toBeDefined();
      expect(typeof timer?.unref).toBe('function');

      // stop() 内部调 _stopDiskProbe；直接调私有方法验证清理语义（daemon 未 start，
      // stop() 会因 !_running 提前 return，故走同款私有路径）。
      (daemon as unknown as { _stopDiskProbe(): void })._stopDiskProbe();
      expect(daemon.diskProbeActive).toBe(false);
      const calls = vi.mocked(setIntervalSpy).mock.calls.length;
      await vi.advanceTimersByTimeAsync(600_000);
      expect(setIntervalSpy).toHaveBeenCalledTimes(calls); // 不再重排
    } finally {
      // 必须还原：残留 spy 会破坏后续 useFakeTimers({shouldAdvanceTime}) 的挂载。
      setIntervalSpy.mockRestore();
    }
  });

  it('间隔读 config：自定义间隔生效（非默认 600s）', async () => {
    await mkdir(join(tmpDir, 'bin'), { recursive: true });
    await writeFile(bundlePath, bundleWith('customsha-20260101000000'), 'utf-8');

    const daemon = buildDaemon({
      config: { self_reload_check_interval_sec: 30 },
      bundlePath,
      pendingPath,
    });
    const onDiskChange = vi.fn();
    daemon.startDiskProbe(onDiskChange);

    // 29s 未到间隔不触发；30s 到点触发一次。
    await vi.advanceTimersByTimeAsync(29_000);
    await settleIo();
    expect(onDiskChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await settleIo();
    expect(onDiskChange).toHaveBeenCalledTimes(1);
  });
});

// ── S3：pending-update.json 模块 ──────────────────────────────────────────────

describe('task-03 S3 pending-update 模块', () => {
  let tmpDir: string;
  let pendingPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task03-pending-');
    pendingPath = join(tmpDir, 'pending-update.json');
    restoreConsole = silenceConsole();
  });

  afterEach(async () => {
    restoreConsole();
    await cleanupDir(tmpDir);
  });

  it('writePendingUpdate 原子落盘（tmp+rename，无 tmp 残留），readPendingUpdate 读回四字段', async () => {
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    expect(daemon.pendingUpdatePath).toBe(pendingPath);

    const before = Date.now();
    await daemon.writePendingUpdate({
      reason: 'disk_change',
      current_version: BUILD_ID,
      target_version: 'newsha99-20260101000000',
    });
    const after = Date.now();

    // 读回：四字段齐全，since 落在写入时刻窗口。
    const record = await daemon.readPendingUpdate();
    expect(record).not.toBeNull();
    expect(record?.reason).toBe('disk_change');
    expect(record?.current_version).toBe(BUILD_ID);
    expect(record?.target_version).toBe('newsha99-20260101000000');
    expect(typeof record?.since).toBe('number');
    expect(record!.since).toBeGreaterThanOrEqual(before);
    expect(record!.since).toBeLessThanOrEqual(after);

    // 落盘内容：恰好四键 + 无 tmp 残留（rename 已落位）。
    const raw = JSON.parse(await readFile(pendingPath, 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual([
      'current_version',
      'reason',
      'since',
      'target_version',
    ]);
    const leftovers = (await readdir(tmpDir)).filter((n) => n.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('覆盖写：再次 write 刷新内容（Windows unlink+rename 分支），旧值被替换', async () => {
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await daemon.writePendingUpdate({
      reason: 'server_command',
      current_version: BUILD_ID,
      target_version: 'firstsha-20260101000000',
    });
    await daemon.writePendingUpdate({
      reason: 'disk_change',
      current_version: BUILD_ID,
      target_version: 'secondsha-20260101000000',
    });
    const record = await daemon.readPendingUpdate();
    expect(record?.reason).toBe('disk_change');
    expect(record?.target_version).toBe('secondsha-20260101000000');
  });

  it('clearPendingUpdate 删除文件；不存在时幂等不抛', async () => {
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await daemon.writePendingUpdate({
      reason: 'disk_change',
      current_version: BUILD_ID,
      target_version: 'clearsha-20260101000000',
    });
    expect(existsSync(pendingPath)).toBe(true);

    await daemon.clearPendingUpdate();
    expect(existsSync(pendingPath)).toBe(false);

    // 幂等：再删（ENOENT）不抛。
    await expect(daemon.clearPendingUpdate()).resolves.toBeUndefined();
    expect(await daemon.readPendingUpdate()).toBeNull();
  });

  it('readPendingUpdateFile：缺失 / JSON 损坏 / 字段缺失或类型错 → null', async () => {
    // 缺失。
    expect(await readPendingUpdateFile(pendingPath)).toBeNull();

    // JSON 损坏。
    await writeFile(pendingPath, '{not-json', 'utf-8');
    expect(await readPendingUpdateFile(pendingPath)).toBeNull();

    // reason 缺失（结构无效）。
    await writeFile(
      pendingPath,
      JSON.stringify({ current_version: 'a', target_version: 'b', since: 1 }),
      'utf-8',
    );
    expect(await readPendingUpdateFile(pendingPath)).toBeNull();

    // since 非数值。
    await writeFile(
      pendingPath,
      JSON.stringify({
        reason: 'disk_change',
        current_version: 'a',
        target_version: 'b',
        since: 'not-a-number',
      }),
      'utf-8',
    );
    expect(await readPendingUpdateFile(pendingPath)).toBeNull();
  });
});

// ── S3：启动清矛盾残留 ───────────────────────────────────────────────────────

describe('task-03 S3 启动清矛盾残留 cleanupStalePendingUpdate', () => {
  let tmpDir: string;
  let pendingPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task03-stale-');
    pendingPath = join(tmpDir, 'pending-update.json');
    restoreConsole = silenceConsole();
  });

  afterEach(async () => {
    restoreConsole();
    await cleanupDir(tmpDir);
  });

  it('target_version==内存 BUILD_ID（升级已完成，矛盾）→ 删除', async () => {
    // 模拟：上次推迟等待 target，升级执行后新进程内存 BUILD_ID==target。
    await writeFile(
      pendingPath,
      JSON.stringify({
        reason: 'disk_change',
        current_version: 'oldsha00-20200101000000',
        target_version: BUILD_ID,
        since: 1750000000000,
      }),
      'utf-8',
    );
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await daemon.cleanupStalePendingUpdate();
    expect(existsSync(pendingPath)).toBe(false);
  });

  it('target_version≠内存 BUILD_ID（仍在途推迟）→ 保留', async () => {
    await writeFile(
      pendingPath,
      JSON.stringify({
        reason: 'server_command',
        current_version: BUILD_ID,
        target_version: 'waitingsha-20260101000000',
        since: 1750000000000,
      }),
      'utf-8',
    );
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await daemon.cleanupStalePendingUpdate();
    expect(existsSync(pendingPath)).toBe(true);
    const record = await daemon.readPendingUpdate();
    expect(record?.target_version).toBe('waitingsha-20260101000000');
  });

  it('结构无效（reason 缺失）→ 删除', async () => {
    await writeFile(
      pendingPath,
      JSON.stringify({ current_version: 'a', target_version: 'b', since: 1 }),
      'utf-8',
    );
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await daemon.cleanupStalePendingUpdate();
    expect(existsSync(pendingPath)).toBe(false);
  });

  it('文件不存在 → no-op 不抛', async () => {
    const daemon = buildDaemon({ bundlePath: join(tmpDir, 'no-bundle.js'), pendingPath });
    await expect(daemon.cleanupStalePendingUpdate()).resolves.toBeUndefined();
  });
});

// ── S3：cli status 展示（HOME 隔离，照 cli.test.ts 惯例）──────────────────────

describe('task-03 S3 cli statusAction pending 展示', () => {
  let tmpDir: string;
  let _origArgv: string[] | null = null;
  let _origExit: typeof process.exit | null = null;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('task03-status-');
    // cli.ts 顶层 void main()：stub argv（无子命令）+ exit 防 commander 副作用。
    if (_origArgv === null) {
      _origArgv = process.argv;
      _origExit = process.exit;
    }
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
  });

  afterEach(async () => {
    if (_origArgv !== null) {
      process.argv = _origArgv;
      process.exit = _origExit!;
      _origArgv = null;
      _origExit = null;
    }
    vi.unstubAllEnvs();
    vi.resetModules();
    await cleanupDir(tmpDir);
  });

  /** resetModules + HOME/USERPROFILE stub + 动态 import（DEFAULT_CONFIG_DIR 指向 tmp）。 */
  async function setupCliWithTmpHome(): Promise<{
    cli: typeof import('../src/cli.js');
    configMod: typeof import('../src/config.js');
  }> {
    vi.resetModules();
    // Windows 的 os.homedir() 读 USERPROFILE 而非 HOME，两侧都 stub（cli.test.ts 惯例）。
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
    const configMod = await import('../src/config.js');
    const cli = await import('../src/cli.js');
    return { cli, configMod };
  }

  /** 捕获 process.stdout.write。 */
  function captureStdout(): { writes: string[]; restore: () => void } {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    return { writes, restore: () => spy.mockRestore() };
  }

  it('pending 文件存在：status 追加「等待空闲升级」行（含盘上/运行版本+原因+since）', async () => {
    const { cli, configMod } = await setupCliWithTmpHome();
    const since = new Date('2026-08-29T08:30:00.000Z').getTime();
    await mkdir(configMod.DEFAULT_CONFIG_DIR, { recursive: true });
    await writeFile(
      join(configMod.DEFAULT_CONFIG_DIR, 'pending-update.json'),
      JSON.stringify({
        reason: 'disk_change',
        current_version: 'cur-1111',
        target_version: 'tgt-2222',
        since,
      }),
      'utf-8',
    );

    const { writes, restore } = captureStdout();
    const code = await cli.statusAction();
    restore();

    expect(code).toBe(0);
    const out = writes.join('');
    expect(out).toContain('State:');
    expect(out).toContain(
      '等待空闲升级：盘上 tgt-2222 运行 cur-1111（原因 disk_change，since 2026-08-29T08:30:00.000Z）',
    );
  });

  it('无 pending 文件：status 不追加该行', async () => {
    const { cli } = await setupCliWithTmpHome();
    const { writes, restore } = captureStdout();
    const code = await cli.statusAction();
    restore();

    expect(code).toBe(0);
    expect(writes.join('')).not.toContain('等待空闲升级');
  });
});
