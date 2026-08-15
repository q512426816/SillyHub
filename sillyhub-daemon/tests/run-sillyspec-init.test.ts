// tests/run-sillyspec-init.test.ts
// 2026-08-15-init-trigger-sillyspec-init task-04：runSillyspecInit 单测。
//
// 覆盖（task 卡 acceptance）：
//   - 版本门控（D-009）：版本过低 fail-fast（init spawn 未发起）；查询失败/解析失败 fail-safe。
//   - 参数组装：5 类 flag（--dir/--spec-dir/--workspace-id/--no-skills/--tool 逗号连接）。
//   - 退出码映射：0 → ok:true；非 0 → sillyspec_init_failed。
//   - 超时映射：超时（注入极小超时不真等 60s）→ 杀树 + ok:false + 超时原因。
//   - tools 兜底：空数组/缺省 → ['claude']（D-005@v1）。
//
// mock 方式：spawnFn 依赖注入（runSillyspecInit 第二参数），不全局 vi.mock child_process。
// 超时不真等：定时器由 runInitCmd 的 setTimeout 驱动，测试注入 spawn 的 child 不退出 +
// 用 vi.useFakeTimers 快进到超时；版本门控用注入超时也可绕开真实 3s——门控通过用例直接
// 返回正常退出的 mock child（不触发超时路径）。
//
// vitest.config.ts: globals=false → 显式 import。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import {
  runSillyspecInit,
  parseSemver,
  MIN_SILLYSPEC_VERSION_FOR_INIT,
  type SpawnFn,
} from '../src/spec-sync.js';

/** 构造一个可控的 fake ChildProcess（stdout/stderr 可写、close 可手动触发）。 */
function makeFakeChild(): ChildProcess & {
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
  stdout: EventEmitter & { emitData: (s: string) => void };
  stderr: EventEmitter & { emitData: (s: string) => void };
} {
  const stdout = Object.assign(new EventEmitter(), {
    emitData(s: string): void {
      stdout.emit('data', Buffer.from(s));
    },
  });
  const stderr = Object.assign(new EventEmitter(), {
    emitData(s: string): void {
      stderr.emit('data', Buffer.from(s));
    },
  });
  const ee = new EventEmitter();
  const child = Object.assign(ee, {
    pid: 4242,
    stdout,
    stderr,
    kill: vi.fn(),
  }) as unknown as ChildProcess & {
    emitClose: (code: number | null) => void;
    emitError: (err: Error) => void;
  };
  (child as unknown as { emitClose: (code: number | null) => void }).emitClose = (code) => {
    ee.emit('close', code);
  };
  (child as unknown as { emitError: (err: Error) => void }).emitError = (err) => {
    ee.emit('error', err);
  };
  return child;
}

/**
 * 构造 spawn mock：按调用序返回 scripted 结果。
 * 每项：{ stdout?, stderr?, exitCode?, error? } —— 异步（queueMicrotask，待监听器挂上后）
 * 写 stdout/stderr 并 close(exitCode) 或 emit('error')；exitCode/error undefined 且未给
 * 输出 → child 永不退出（超时用例）。
 * 记录每次调用的 (cmd, options) 供断言。
 */
function makeSpawnMock(
  script: Array<{ stdout?: string; stderr?: string; exitCode?: number; error?: Error }>,
) {
  const calls: Array<{ cmd: unknown; opts: unknown }> = [];
  const spawnMock = vi.fn(
    (cmd: unknown, opts?: unknown): ChildProcess => {
      const step = calls.length;
      calls.push({ cmd, opts });
      const child = makeFakeChild();
      const s = script[Math.min(step, script.length - 1)];
      if (s && (s.exitCode !== undefined || s.error !== undefined)) {
        queueMicrotask(() => {
          if (s.stdout) child.stdout.emitData(s.stdout);
          if (s.stderr) child.stderr.emitData(s.stderr);
          if (s.error) child.emitError(s.error);
          else child.emitClose(s.exitCode!);
        });
      }
      return child;
    },
  );
  return { spawnMock: spawnMock as unknown as SpawnFn, calls };
}

const BASE_PARAMS = {
  rootPath: 'C:/proj/my workspace', // 故意带空格：验证 --dir 加引号
  specCacheRoot: 'C:/Users/x/.sillyhub/daemon/specs/ws-1',
  wsId: 'ws-1',
  tools: ['claude', 'codex'],
};

describe('parseSemver（D-009 门控解析）', () => {
  it('标准 / v 前缀 / 尾缀 / 缺段', () => {
    expect(parseSemver('3.30.0')).toEqual([3, 30, 0]);
    expect(parseSemver('v3.31.1')).toEqual([3, 31, 1]);
    expect(parseSemver('3.30.0-beta.1')).toEqual([3, 30, 0]);
    expect(parseSemver('3.30')).toEqual([3, 30, 0]);
    expect(parseSemver('3')).toEqual([3, 0, 0]);
  });
  it('非法输入 → null', () => {
    expect(parseSemver('abc')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('x.y.z')).toBeNull();
  });
});

describe('runSillyspecInit 版本门控（D-009 / FR-03）', () => {
  it('版本过低 → ok:false，error 含 sillyspec_init_cli_too_old 与中文升级指引，init spawn 未发起', async () => {
    const { spawnMock, calls } = makeSpawnMock([
      { stdout: '3.26.7\n', exitCode: 0 }, // --version 返回过旧版本
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_cli_too_old');
    expect(result.error).toContain('3.26.7');
    expect(result.error).toContain(MIN_SILLYSPEC_VERSION_FOR_INIT);
    // 中文升级指引：重启 daemon / npm install -g sillyspec@latest
    expect(result.error).toContain('重启 daemon');
    expect(result.error).toContain('npm install -g sillyspec@latest');
    // fail-fast：只有 1 次 spawn（--version），init 未发起
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.cmd)).toContain('--version');
  });

  it('版本查询失败（非 0 退出）→ 门控 fail-safe，init 未发起', async () => {
    const { spawnMock, calls } = makeSpawnMock([{ exitCode: 1 }]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_cli_too_old');
    expect(calls).toHaveLength(1);
  });

  it('版本输出无法解析 → 门控 fail-safe，init 未发起', async () => {
    const { spawnMock, calls } = makeSpawnMock([
      { stdout: 'not-a-version\n', exitCode: 0 },
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_cli_too_old');
    expect(calls).toHaveLength(1);
  });

  it('spawn error（ENOENT）→ 门控 fail-safe，init 未发起', async () => {
    const { spawnMock, calls } = makeSpawnMock([
      { error: new Error('spawn ENOENT') },
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_cli_too_old');
    expect(calls).toHaveLength(1); // 仅 --version 一次，init 未发起
  });
});

describe('runSillyspecInit init 执行（FR-01/FR-02）', () => {
  it('门控通过 → spawn init，参数含全部 5 类 flag；退出码 0 → ok:true', async () => {
    const { spawnMock, calls } = makeSpawnMock([
      { stdout: `${MIN_SILLYSPEC_VERSION_FOR_INIT}\n`, exitCode: 0 }, // --version 放行
      { stdout: 'init done\n', exitCode: 0 }, // init 成功
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(calls).toHaveLength(2);

    const initCall = calls[1]!;
    expect(String(initCall.cmd)).toContain('sillyspec init');
    // 5 类 flag（task acceptance）——带空格路径验证引号包裹
    expect(String(initCall.cmd)).toContain(`--dir "${BASE_PARAMS.rootPath}"`);
    expect(String(initCall.cmd)).toContain(`--spec-dir "${BASE_PARAMS.specCacheRoot}"`);
    expect(String(initCall.cmd)).toContain(`--workspace-id ws-1`);
    expect(String(initCall.cmd)).toContain('--no-skills');
    expect(String(initCall.cmd)).toContain('--tool claude,codex');
    // shell:true（X-06：Windows bare name 必 ENOENT）
    expect((initCall.opts as Record<string, unknown>).shell).toBe(true);
  });

  it('tools 缺省 / 空数组 → 兜底 --tool claude（D-005）', async () => {
    for (const tools of [undefined, []]) {
      const { spawnMock, calls } = makeSpawnMock([
        { stdout: `${MIN_SILLYSPEC_VERSION_FOR_INIT}\n`, exitCode: 0 },
        { exitCode: 0 },
      ]);
      const result = await runSillyspecInit({ ...BASE_PARAMS, tools }, spawnMock);
      expect(result.ok).toBe(true);
      expect(String(calls[1]!.cmd)).toContain('--tool claude');
    }
  });

  it('退出码非 0 → ok:false，error 前缀 sillyspec_init_failed，stdout/stderr 截断收集', async () => {
    const { spawnMock } = makeSpawnMock([
      { stdout: `${MIN_SILLYSPEC_VERSION_FOR_INIT}\n`, exitCode: 0 },
      { stderr: 'boom on line 3\n', exitCode: 2 },
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_failed');
    expect(result.error).toContain('退出码非 0');
    expect(result.error).toContain('boom on line 3');
  });

  it('超时 → 杀树 + ok:false，error 含超时说明（fake timers 快进，不真等 60s）', async () => {
    vi.useFakeTimers();
    try {
      // 第 1 步 --version 正常完成；第 2 步 init child 无 exitCode/error → 永不退出
      const { spawnMock, calls } = makeSpawnMock([
        { stdout: `${MIN_SILLYSPEC_VERSION_FOR_INIT}\n`, exitCode: 0 },
        {},
      ]);
      const pending = runSillyspecInit(BASE_PARAMS, spawnMock);
      // 微任务排空让 --version 完成、init spawn 已发起
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(2);

      // 快进 60s → runInitCmd 定时器触发：POSIX 上 process.kill(-pid) 会因假 pid 抛错，
      // 被内层 catch 兜底 process.kill(pid) 再抛又被 killInitTree 外层 catch 吞（win32 走
      // spawnFn('taskkill') 返回 fake child 不执行）——杀树失败不影响 finish(false,true)。
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.error).toContain('sillyspec_init_failed');
      expect(result.error).toContain('超时');
    } finally {
      vi.useRealTimers();
    }
  });

  it('init spawn error → ok:false + sillyspec_init_failed', async () => {
    const { spawnMock } = makeSpawnMock([
      { stdout: `${MIN_SILLYSPEC_VERSION_FOR_INIT}\n`, exitCode: 0 },
      { error: new Error('spawn ENOENT') },
    ]);
    const result = await runSillyspecInit(BASE_PARAMS, spawnMock);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sillyspec_init_failed');
  });
});
