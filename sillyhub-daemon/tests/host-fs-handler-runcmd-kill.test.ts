// tests/host-fs-handler-runcmd-kill.test.ts
// ql-20260903-007（24h 审计低危④）：runCmd 超时杀树单测。
//
// 背景：execFile 的 timeout 只向直接子进程发 killSignal（Windows 上
// TerminateProcess 单杀），git worktree add/merge 可经 hook/filter spawn 孙进程——
// 超时杀 git.exe 后孙进程残留并继续写目标目录（preflight.ts 2026-08-12
// .cmd wrapper 孙 node.exe 卡死实证同型）。runCmd 据超时特征（err.killed +
// signal='SIGTERM'，Node 默认 killSignal）补 killTree：win32 走
// `taskkill /PID <pid> /T /F`；并在 stderr 追加 `timed out` 标记行
// （runGitRevParse 的 /timed out/ → git_timeout 映射此前对真实超时恒不命中）。
//
// mock 策略（对齐 host-fs-handler-worktree.test）：vi.mock 拦截
// node:child_process 的 execFile / spawn——execFile 按 hoisted 状态开关模拟
// 超时/普通失败两种回调，spawn 记录 taskkill 调用；process.platform 钉 win32
// 使断言跨平台确定。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

/** mock 行为开关（hoisted：vi.mock 工厂闭包内可引用）。 */
const mockState = vi.hoisted(() => ({
  mode: 'timeout' as 'timeout' | 'plain-fail',
}));

/** 记录 spawn 调用（taskkill 杀树断言锚）。 */
const spawnCalls = vi.hoisted(() => [] as Array<{ cmd: string; args: string[] }>);
/** 最近一次 spawn 返回的 mock child（KT3 断言 'error' 监听器用）。 */
const lastSpawnedChild = vi.hoisted(() => ({ emitter: null as EventEmitter | null }));

// vi.mock 拦截 node:child_process（hoist 到文件顶部）。
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]): unknown => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: Buffer | string,
      stderr: Buffer | string,
    ) => void;
    setImmediate(() => {
      if (mockState.mode === 'timeout') {
        // 模拟 execFile 超时：killed + signal='SIGTERM'（Node 超时默认
        // killSignal）；stderr 仅子进程已写出的进度条（ql-20260902-001 实况：
        // 无 fatal 行可读）。
        const err = Object.assign(new Error('mock timeout'), {
          killed: true,
          signal: 'SIGTERM',
        }) as NodeJS.ErrnoException & { killed: boolean; signal: string };
        cb(err, '', 'Updating files: 42%');
        return;
      }
      // 普通失败（exit 非 0）：无 killed/signal 超时特征。
      cb(new Error('mock fail'), '', 'fatal: not a git repository');
    });
    // runCmd 持有 child 引用杀树——返回带固定 pid 的假 child。
    return { pid: 4242, stdin: null };
  },
  spawn: (...args: unknown[]): unknown => {
    spawnCalls.push({ cmd: args[0] as string, args: (args[1] as string[]) ?? [] });
    // ql-20260904-L1：killTree 对 taskkill child 挂 'error' 监听（防 spawn
    // 异步 error 以 uncaughtException 崩 daemon）——mock 返回真 EventEmitter。
    const child = new EventEmitter();
    lastSpawnedChild.emitter = child;
    return child;
  },
}));

import { HostFsHandler } from '../src/host-fs-handler';

describe('HostFsHandler — runCmd 超时杀树（ql-20260903-007）', () => {
  let root: string;
  let handler: HostFsHandler;
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sillyhub-kill-'));
    handler = new HostFsHandler({ rootsProvider: () => [root] });
    // 钉 win32：killTree 走 taskkill 分支（断言跨平台确定）。
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    mockState.mode = 'timeout';
    spawnCalls.length = 0;
  });

  afterEach(async () => {
    platformSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it('KT1: execFile 超时（killed+SIGTERM）→ taskkill /PID <pid> /T /F 杀树 + stderr 带 timed out 标记（git_timeout 映射命中）', async () => {
    // 经公开方法 gitRevParse 驱动 runCmd（10s 轻命令档）。
    const result = await handler.gitRevParse({ root, ref: 'HEAD' });
    expect(result.commit).toBeNull();
    // 超时映射命中（此前真实超时 stderr 只有进度条，git_timeout 恒不触发）。
    expect(result.error).toBe('git_timeout');

    // 杀树：taskkill /PID 4242 /T /F（/T 含孙进程，/F 强制）。
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]!.cmd).toBe('taskkill');
    expect(spawnCalls[0]!.args).toEqual(['/PID', '4242', '/T', '/F']);
  });

  it('KT2: 普通失败（无超时特征）→ 不杀树，stderr 原样透传（fatal → not_git_repo）', async () => {
    mockState.mode = 'plain-fail';
    const result = await handler.gitRevParse({ root, ref: 'HEAD' });
    expect(result.commit).toBeNull();
    // 普通失败映射照旧（不误报超时）。
    expect(result.error).toBe('not_git_repo');
    // 无超时特征 → 不触发杀树。
    expect(spawnCalls.length).toBe(0);
  });

  it('KT3: taskkill spawn 异步 error（ENOENT 等）被监听器吞掉——不崩 daemon（ql-20260904-L1）', async () => {
    const result = await handler.gitRevParse({ root, ref: 'HEAD' });
    expect(result.error).toBe('git_timeout');
    expect(spawnCalls.length).toBe(1);

    // killTree 对 taskkill child 挂了 'error' 监听器——EventEmitter 语义下
    // 无监听器的 emit('error') 会 throw（对应真实 ChildProcess 的
    // uncaughtException 崩 daemon）；有监听器则安全吞掉。
    const killer = lastSpawnedChild.emitter!;
    expect(killer.listenerCount('error')).toBe(1);
    expect(() => killer.emit('error', new Error('spawn ENOENT'))).not.toThrow();
  });
});
