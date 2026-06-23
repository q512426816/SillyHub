/**
 * terminal-observer.test.ts —— ql-20260616-003：观察日志写入 + 弹窗触发测试。
 *
 * 测三件事：
 *   1. createTerminalObserver 在正确目录创建 terminal.log + 写 header
 *      （lease=/cwd=/cmd=/mode=/observer_enabled=）
 *   2. mode=parsed：writeParsed 落日志，writeRawStdout/Stderr noop
 *   3. mode=raw：writeParsed noop，writeRawStdout/Stderr 落日志
 *   4. mode=both：三类都落日志
 *   5. close 幂等（多次调只写一次 summary）
 *   6. enabled=true → launchTerminal 被调（mock 掉避免真弹窗）
 *   7. launchTerminal 抛错不传染业务（observer 仍返回可用实例）
 *   8. NOOP_TERMINAL_OBSERVER 全 no-op，close 幂等
 *
 * 路径隔离：terminal-observer 用 DEFAULT_CONFIG_DIR（homedir/.sillyhub/daemon），
 * stub HOME 到 tmpDir 后再 import 让其重算路径。
 *
 * @module terminal-observer.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupDir } from './helpers.js';

// ── mock launchTerminal（避免真弹窗）────────────────────────────────────────
const launchCalls: Array<{
  title: string;
  logPath: string;
  closeOnExit?: boolean;
  customCommand?: string | null;
}> = [];

let launchShouldThrow = false;

vi.mock('../src/terminal-launcher.js', () => ({
  launchTerminal: (opts: {
    title: string;
    logPath: string;
    closeOnExit?: boolean;
    customCommand?: string | null;
  }) => {
    if (launchShouldThrow) {
      throw new Error('mock terminal launch failure');
    }
    launchCalls.push(opts);
  },
}));

describe('terminal-observer', () => {
  let tmpDir: string;
  let observerMod: typeof import('../src/terminal-observer.js');
  let configMod: typeof import('../src/config.js');

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-observer-');
    launchCalls.length = 0;
    launchShouldThrow = false;

    // resetModules 让 config.ts / terminal-observer.ts 重算 DEFAULT_CONFIG_DIR
    vi.resetModules();

    // 用 vi.mock 替换 os.homedir（terminal-observer 间接经 config.ts 用 homedir）
    // 必须在 resetModules 之后，import 之前；doMock 在每次 beforeEach 重置生效
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual('node:os');
      return { ...(actual as Record<string, unknown>), homedir: () => tmpDir };
    });

    configMod = await import('../src/config.js');
    observerMod = await import('../src/terminal-observer.js');
  });

  afterEach(async () => {
    vi.doUnmock('node:os');
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  /**
   * 读 observer 日志全文。
   * observer 写入是 fire-and-forget appendFile（terminal-observer.ts L126），
   * writeParsed/close 后立即读存在竞态（pre-existing flaky，全量并发下尤其明显）。
   * 轮询直到内容连续两轮相同（IO 已追平）或超时。
   */
  async function readLog(leaseId: string): Promise<string> {
    const path = join(configMod.DEFAULT_CONFIG_DIR, 'runs', leaseId, 'terminal.log');
    let prev = '';
    for (let i = 0; i < 60; i++) {
      let log = '';
      try {
        log = await readFile(path, 'utf-8');
      } catch {
        log = ''; // header 尚未落盘
      }
      if (log.length > 0 && log === prev) return log;
      prev = log;
      await new Promise<void>((r) => setTimeout(r, 10));
    }
    return prev;
  }

  /**
   * 等 fire-and-forget appendFile 写入落盘（observer 写入是非阻塞的）。
   * 多 tick setImmediate + 一个短 setTimeout 兜底（实测 Node 20 上 1 个 setImmediate
   * 不够，fileSystem syscall 落盘需要 event-loop 多轮）。
   */
  async function flushAsyncWrites(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }
    await new Promise<void>((r) => setTimeout(r, 30));
  }

  /** 检查日志文件是否已创建。 */
  function logExists(leaseId: string): boolean {
    const path = join(configMod.DEFAULT_CONFIG_DIR, 'runs', leaseId, 'terminal.log');
    return existsSync(path);
  }

  // ── 创建 + header ──────────────────────────────────────────────────────────

  it('createTerminalObserver：建 runs/<leaseId>/terminal.log + 写 header', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'lease-001-full-uuid',
      cwd: '/workspace/foo',
      cmdPath: '/usr/bin/claude',
      args: ['-p', 'hi'],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_mode: 'parsed' },
    });
    obs.close();
    await flushAsyncWrites();
    expect(logExists('lease-001-full-uuid')).toBe(true);
    const log = await readLog('lease-001-full-uuid');
    expect(log).toContain('lease=lease-001-full-uuid');
    expect(log).toContain('cwd=/workspace/foo');
    expect(log).toContain('cmd=/usr/bin/claude -p hi');
    expect(log).toContain('mode=parsed');
    expect(log).toContain('observer_enabled=false');
  });

  it('DEFAULT_CONFIG_DIR 指向 tmpDir（HOME 隔离生效）', () => {
    expect(configMod.DEFAULT_CONFIG_DIR).toBe(join(tmpDir, '.sillyhub', 'daemon'));
  });

  // ── mode=parsed：writeParsed 落日志，raw 系列 noop ───────────────────────

  it('mode=parsed：writeParsed 写入日志，writeRawStdout/Stderr noop', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'p-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_mode: 'parsed' },
    });
    obs.writeParsed('[task xxx] hello');
    obs.writeRawStdout('raw-out-line');
    obs.writeRawStderr('raw-err-line');
    obs.close();
    await flushAsyncWrites();
    const log = await readLog('p-001');
    expect(log).toContain('[task xxx] hello');
    expect(log).not.toContain('raw-out-line');
    expect(log).not.toContain('raw-err-line');
  });

  // ── mode=raw：writeParsed noop，raw 系列 [raw stdout]/[stderr] 前缀 ───────

  it('mode=raw：writeRawStdout 加 [raw stdout] 前缀，writeParsed noop', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'r-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_mode: 'raw' },
    });
    obs.writeParsed('parsed-line');
    obs.writeRawStdout('stdout-raw');
    obs.writeRawStderr('stderr-raw');
    obs.close();
    await flushAsyncWrites();
    const log = await readLog('r-001');
    expect(log).not.toContain('parsed-line');
    expect(log).toContain('[raw stdout] stdout-raw');
    expect(log).toContain('[stderr] stderr-raw');
  });

  // ── mode=both：parsed + raw 都落日志 ──────────────────────────────────────

  it('mode=both：三类写入都落日志', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'b-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_mode: 'both' },
    });
    obs.writeParsed('parsed-X');
    obs.writeRawStdout('stdout-X');
    obs.writeRawStderr('stderr-X');
    obs.close();
    await flushAsyncWrites();
    const log = await readLog('b-001');
    expect(log).toContain('parsed-X');
    expect(log).toContain('[raw stdout] stdout-X');
    expect(log).toContain('[stderr] stderr-X');
  });

  // ── close 幂等 ─────────────────────────────────────────────────────────────

  it('close 多次调用只写一次 summary', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'c-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG },
    });
    obs.close('[custom summary]');
    obs.close('[second summary]');
    obs.close();
    await flushAsyncWrites();
    const log = await readLog('c-001');
    // 自定义 summary 只出现一次
    const matches = log.match(/\[custom summary\]/g) ?? [];
    expect(matches.length).toBe(1);
    expect(log).not.toContain('[second summary]');
  });

  // ── enabled=true 触发 launchTerminal ───────────────────────────────────────

  it('enabled=true：launchTerminal 被调一次 + 传 logPath + title', async () => {
    await observerMod.createTerminalObserver({
      leaseId: 'launch-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: {
        ...configMod.DEFAULT_CONFIG,
        terminal_observer_enabled: true,
        terminal_observer_close_on_exit: true,
      },
    });
    expect(launchCalls.length).toBe(1);
    expect(launchCalls[0].title).toContain('SillyHub');
    expect(launchCalls[0].logPath).toContain('launch-001');
    expect(launchCalls[0].logPath).toContain('terminal.log');
    expect(launchCalls[0].closeOnExit).toBe(true);
  });

  it('enabled=false：launchTerminal 不被调', async () => {
    await observerMod.createTerminalObserver({
      leaseId: 'nolaunch-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_enabled: false },
    });
    expect(launchCalls.length).toBe(0);
  });

  // ── launchTerminal 抛错：observer 接口仍可用 ───────────────────────────────

  it('launchTerminal 抛错：observer 仍可用，错误追加到日志文件', async () => {
    launchShouldThrow = true;
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'throw-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: { ...configMod.DEFAULT_CONFIG, terminal_observer_enabled: true },
    });
    // observer 接口仍可用
    expect(() => obs.writeParsed('still works')).not.toThrow();
    obs.close();
    const log = await readLog('throw-001');
    expect(log).toContain('open terminal failed');
    expect(log).toContain('still works');
  });

  // ── config 缺省时 mode 归一到 parsed ───────────────────────────────────────

  it('config=undefined：mode 默认 parsed（normalizeMode 兜底）', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'default-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      // 不传 config
    });
    obs.writeParsed('parsed-only');
    obs.writeRawStdout('should-be-noop');
    obs.close();
    const log = await readLog('default-001');
    expect(log).toContain('mode=parsed');
    expect(log).toContain('parsed-only');
    expect(log).not.toContain('should-be-noop');
  });

  it('非法 mode 字符串：归一到 parsed', async () => {
    const obs = await observerMod.createTerminalObserver({
      leaseId: 'badmode-001',
      cwd: '/ws',
      cmdPath: '/claude',
      args: [],
      config: {
        ...configMod.DEFAULT_CONFIG,
        terminal_observer_mode: 'invalid' as 'parsed',
      },
    });
    obs.close();
    const log = await readLog('badmode-001');
    expect(log).toContain('mode=parsed');
  });

  // ── NOOP_TERMINAL_OBSERVER：全 no-op + close 幂等 ──────────────────────────

  it('NOOP_TERMINAL_OBSERVER：所有方法 no-op，不抛错', () => {
    expect(() => {
      observerMod.NOOP_TERMINAL_OBSERVER.writeParsed('x');
      observerMod.NOOP_TERMINAL_OBSERVER.writeRawStdout('x');
      observerMod.NOOP_TERMINAL_OBSERVER.writeRawStderr('x');
      observerMod.NOOP_TERMINAL_OBSERVER.close();
      observerMod.NOOP_TERMINAL_OBSERVER.close('summary');
    }).not.toThrow();
  });

  it('NOOP_TERMINAL_OBSERVER：不创建任何日志文件', async () => {
    observerMod.NOOP_TERMINAL_OBSERVER.writeParsed('x');
    // 给点时间让 fire-and-forget 不影响判断（虽然 noop 本应同步）
    await new Promise((r) => setTimeout(r, 10));
    expect(logExists('noop-should-not-exist')).toBe(false);
  });
});
