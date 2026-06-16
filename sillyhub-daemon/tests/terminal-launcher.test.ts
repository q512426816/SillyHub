/**
 * terminal-launcher.test.ts —— ql-20260616-003：跨平台终端弹窗 spawn 分支测试。
 *
 * 不真弹终端（CI / 测试环境不可能弹），mock node:child_process.spawn 拦截调用，
 * 验证 4 个分支调对参数：
 *   - win32 → wt.exe（带 fallback）
 *   - darwin → osascript
 *   - linux → x-terminal-emulator / gnome-terminal / konsole / xterm 候选
 *   - custom → shell:true + replaceAll {log}/{title}
 *
 * 关键断言：
 *   1. 平台分支正确选择 spawn 命令（command/args 首项）。
 *   2. custom 模式把 {log} {title} 占位符替换成实际值。
 *   3. spawn 返回的 child 都被 unref()（detached 解耦，daemon 退出后终端继续）。
 *   4. 'error' 事件触发不会抛错（弹窗失败不影响业务）。
 *
 * @module terminal-launcher.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

// ── 顶层 mock：vi.mock 会被 hoist 到 import 之前 ─────────────────────────────
// 测试运行时 spawn 被替换为下面的实现，所有调用记录到 __SPAWN_CALLS__。
// 在测试用例里通过 import { __SPAWN_CALLS__, __LAST_CHILD__ } from 'node:child_process' 读取。

interface SpawnCall {
  command: string | (string | boolean | undefined)[];
  args?: string[];
  options?: Record<string, unknown>;
}

const calls: SpawnCall[] = [];

/** 共享 mock ChildProcess（带 unrefCalled 标记，验证 detached + unref 契约）。 */
function makeMockChild(): ChildProcess & { unrefCalled: boolean } {
  const errorHandlers: Array<(e: Error) => void> = [];
  return {
    pid: 99999,
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null] as unknown as ChildProcess['stdio'],
    unrefCalled: false,
    on(event: string, listener: (...args: unknown[]) => void): ChildProcess {
      if (event === 'error') errorHandlers.push(listener as (e: Error) => void);
      return this as unknown as ChildProcess;
    },
    once(_event: string, _listener: (...args: unknown[]) => void): ChildProcess {
      return this as unknown as ChildProcess;
    },
    off(): ChildProcess { return this as unknown as ChildProcess; },
    removeListener(): ChildProcess { return this as unknown as ChildProcess; },
    removeAllListeners(): ChildProcess { return this as unknown as ChildProcess; },
    emit(event: string, ...args: unknown[]): boolean {
      if (event === 'error') {
        for (const h of errorHandlers) h(args[0] as Error);
      }
      return true;
    },
    ref(): ChildProcess { return this as unknown as ChildProcess; },
    unref(): ChildProcess {
      (this as { unrefCalled: boolean }).unrefCalled = true;
      return this as unknown as ChildProcess;
    },
    kill(): boolean { return true; },
    send(): boolean { return true; },
    disconnect(): void {},
  } as unknown as ChildProcess & { unrefCalled: boolean };
}

let lastChild: ReturnType<typeof makeMockChild>;

vi.mock('node:child_process', () => ({
  spawn: (
    command: string | (string | boolean | undefined)[],
    arg2?: string[] | Record<string, unknown>,
    arg3?: Record<string, unknown>,
  ) => {
    // 兼容两种调用形式：
    //   3-arg: spawn(cmd, args[], options)
    //   2-arg: spawn(cmd, options)
    let args: string[] | undefined;
    let options: Record<string, unknown> | undefined;
    if (Array.isArray(arg2)) {
      args = arg2;
      options = arg3;
    } else {
      args = undefined;
      options = arg2 as Record<string, unknown> | undefined;
    }
    calls.push({ command, args, options });
    lastChild = makeMockChild();
    return lastChild;
  },
}));

// mock 模块里把 calls / lastChild 暴露给测试（统一通过命名导出）
// 实际 spawn 的 mock 已经在上面 closure 内访问 calls/lastChild，这里不需要再导出
// 测试通过本文件顶层声明的 calls 数组直接断言

import { launchTerminal } from '../src/terminal-launcher.js';

describe('terminal-launcher', () => {
  let origPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origPlatform) {
      Object.defineProperty(process, 'platform', origPlatform);
      origPlatform = undefined;
    }
  });

  /** 覆盖 process.platform（platform 是 getter-only，需用 defineProperty）。 */
  function setPlatform(p: 'win32' | 'darwin' | 'linux'): void {
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  // ── custom 模式优先级最高：给 customCommand 时不走平台分支 ─────────────────

  it('custom 模式：spawn shell:true + 占位符 {log}/{title} 替换', () => {
    launchTerminal({
      title: 'SillyHub abc',
      logPath: '/tmp/run.log',
      customCommand: 'xterm -T "{title}" -e tail -f {log}',
    });
    expect(calls.length).toBe(1);
    expect(calls[0].options?.shell).toBe(true);
    expect(calls[0].command).toBe('xterm -T "SillyHub abc" -e tail -f /tmp/run.log');
    expect(lastChild.unrefCalled).toBe(true);
  });

  it('custom 模式：log/title 都未给占位符时保持原命令字面', () => {
    launchTerminal({
      title: 't',
      logPath: '/x.log',
      customCommand: 'konsole --hold',
    });
    expect(calls[0].command).toBe('konsole --hold');
  });

  // ── Windows：wt.exe new-tab + powershell Get-Content ─────────────────────

  it('win32：spawn wt.exe，args 含 new-tab + powershell + Get-Content -Wait', () => {
    setPlatform('win32');
    launchTerminal({ title: 'SillyHub x', logPath: 'C:/tmp/run.log' });
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('wt.exe');
    const args = calls[0].args ?? [];
    expect(args[0]).toBe('new-tab');
    expect(args).toContain('--title');
    expect(args).toContain('SillyHub x');
    expect(args).toContain('powershell');
    const cmdIdx = args.indexOf('-Command');
    expect(cmdIdx).toBeGreaterThan(-1);
    expect(args[cmdIdx + 1]).toContain('Get-Content');
    expect(args[cmdIdx + 1]).toContain('-Wait');
    expect(args[cmdIdx + 1]).toContain('C:/tmp/run.log');
    expect(lastChild.unrefCalled).toBe(true);
  });

  it('win32：logPath 含单引号时 PowerShell 双单引号转义', () => {
    setPlatform('win32');
    launchTerminal({ title: 't', logPath: "C:/it's.log" });
    const args = calls[0].args ?? [];
    const cmdIdx = args.indexOf('-Command');
    expect(args[cmdIdx + 1]).toContain("it''s.log");
  });

  // ── macOS：osascript + tail -f ─────────────────────────────────────────────

  it('darwin：spawn osascript，script 含 do script + tail -f', () => {
    setPlatform('darwin');
    launchTerminal({ title: 't', logPath: '/Users/x/run.log' });
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('osascript');
    const args = calls[0].args ?? [];
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain('tell application "Terminal"');
    expect(args[1]).toContain('do script');
    expect(args[1]).toContain('tail -f');
    expect(args[1]).toContain('/Users/x/run.log');
    expect(lastChild.unrefCalled).toBe(true);
  });

  // ── Linux：候选链 + 命中第一个返回 ─────────────────────────────────────────

  it('linux：spawn x-terminal-emulator（候选链首选）', () => {
    setPlatform('linux');
    launchTerminal({ title: 't', logPath: '/tmp/run.log' });
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('x-terminal-emulator');
    const args = calls[0].args ?? [];
    expect(args.join(' ')).toContain('tail -f');
    expect(args.join(' ')).toContain('/tmp/run.log');
    expect(lastChild.unrefCalled).toBe(true);
  });

  it('linux：args 包含 bash -lc 包装的 cmd', () => {
    setPlatform('linux');
    launchTerminal({ title: 't', logPath: '/x.log' });
    const args = calls[0].args ?? [];
    expect(args).toContain('bash');
    expect(args).toContain('-lc');
  });

  // ── 不抛错契约：spawn 后 childMock 上 emit('error') 不应让 launch 抛 ────────

  it('child emit error：launch 不抛（弹窗失败不影响业务）', () => {
    setPlatform('darwin');
    expect(() => {
      launchTerminal({ title: 't', logPath: '/x.log' });
      lastChild.emit('error', new Error('spawn ENOENT osascript'));
    }).not.toThrow();
  });

  // ── detached + stdio ignore（所有平台共用契约）────────────────────────────

  it('win32：options.detached=true, stdio=ignore, windowsHide=false', () => {
    setPlatform('win32');
    launchTerminal({ title: 't', logPath: 'C:/x.log' });
    expect(calls[0].options?.detached).toBe(true);
    expect(calls[0].options?.stdio).toBe('ignore');
    expect(calls[0].options?.windowsHide).toBe(false);
  });

  it('custom：options.detached=true, stdio=ignore', () => {
    launchTerminal({ title: 't', logPath: '/x.log', customCommand: 'x' });
    expect(calls[0].options?.detached).toBe(true);
    expect(calls[0].options?.stdio).toBe('ignore');
  });
});
