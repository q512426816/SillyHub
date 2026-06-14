// tests/task-runner-retry-timeout.test.ts
// task-10 覆盖：B2 超时可配（优先级链）+ B3 spawn 级失败自动重试。
//
// B2 覆盖 AC-01（config 字段）/ AC-04（resolveTimeout 优先级链 6 条）/ AC-06（watchdog 触发）：
//   case1 ctx.timeoutSeconds（lease.metadata 透传）优先级最高
//   case2 ctx.timeoutSeconds 缺失 → config.default_timeout_seconds 兜底
//   case3 ctx + config 都未配 → 默认 1800
//   case4 显式 0 跳过（>0 判断），走 config/兜底
//   case5 显式 -1 → 返回 0（显式不限，看门狗不启动）
//   case6 集成：ctx.timeoutSeconds → 看门狗 setTimeout 触发 SIGTERM
//
// B3 覆盖 AC-05（重试编排 5 条）/ AC-07（ENOENT 重试）/ AC-08（业务 is_error 不重试）/
//        AC-09（重试不传 resume_session_id）/ AC-10（max_retries 截断 3）：
//   isSpawnLevelFailure 判定（规范 §8）：
//     - timeout / spawn ENOENT / OOM / segfault / killed → 重试（true）
//     - cancelled / businessError / completed / 业务非零退出 → 不重试（false）
//
// 优先级链（B2）：ctx.timeoutSeconds > ctx.timeout > config.default_timeout_seconds > 1800
// R-10：重试清空 ctx.resumeSessionId（避免 --resume 重复 side-effect）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => null as unknown) };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_p: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner, resolveTimeout, resolveMaxRetries, isSpawnLevelFailure } from '../src/task-runner.js';
import type { DaemonConfig } from '../src/config.js';
import type { LeaseCtx } from '../src/types.js';
import { createFakeChild, waitForSpawn, type FakeChild } from './helpers/fake-child.js';

// ── 共用 helper ──────────────────────────────────────────────────────────────

function makeCtx(o: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-rt',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'ws-rt',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    resumeSessionId: 'sess-original',
    ...o,
  };
}

function makeConfig(o: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://localhost:8000',
    token: 't',
    runtime_id: 'rt-1',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 1,
    ...o,
  };
}

function makeClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeWorkspace(): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    cleanWorkspace: vi.fn().mockResolvedValue(undefined),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/ws/test'),
  };
}

function makeCred(): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// B2：超时可配（resolveTimeout 优先级链 + 看门狗集成）
// ════════════════════════════════════════════════════════════════════════════

describe('resolveTimeout 优先级链（task-10 B2）', () => {
  it('case1: ctx.timeoutSeconds 优先级最高（lease.metadata 透传）', () => {
    const ctx = makeCtx({ timeoutSeconds: 10 });
    expect(resolveTimeout(ctx, makeConfig({ default_timeout_seconds: 600 }))).toBe(10);
  });

  it('case2: ctx.timeoutSeconds 缺失 → config.default_timeout_seconds 兜底', () => {
    const ctx = makeCtx();
    expect(resolveTimeout(ctx, makeConfig({ default_timeout_seconds: 600 }))).toBe(600);
  });

  it('case3: ctx + config 都未配 → 默认 1800', () => {
    expect(resolveTimeout(makeCtx(), undefined)).toBe(1800);
  });

  it('case4: ctx.timeoutSeconds=0 跳过（>0 判断）→ 走 config', () => {
    const ctx = makeCtx({ timeoutSeconds: 0 });
    expect(resolveTimeout(ctx, makeConfig({ default_timeout_seconds: 900 }))).toBe(900);
  });

  it('case5: ctx.timeoutSeconds=-1 → 返回 0（显式不限，看门狗不启动）', () => {
    const ctx = makeCtx({ timeoutSeconds: -1 });
    expect(resolveTimeout(ctx, makeConfig({ default_timeout_seconds: 600 }))).toBe(0);
  });

  it('case6: 兼容旧字段 ctx.timeout（既有测试 makeLease({timeout}) 仍生效）', () => {
    const ctx = makeCtx({ timeout: 42 });
    expect(resolveTimeout(ctx, makeConfig({ default_timeout_seconds: 600 }))).toBe(42);
  });

  it('不修改入参 ctx（纯函数）', () => {
    const ctx = makeCtx({ timeoutSeconds: 10 });
    resolveTimeout(ctx, makeConfig());
    expect(ctx.timeoutSeconds).toBe(10);
  });
});

describe('看门狗集成（ctx.timeoutSeconds → setTimeout 触发 SIGTERM）', () => {
  beforeEach(() => {
    mockAdapter = {
      provider: 'claude',
      parse: vi.fn((): null => null),
      buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
      buildInput: vi.fn((p: string) => `${p}\n`),
    };
  });

  it('AC-06: ctx.timeoutSeconds=10 → 看门狗 setTimeout 触发 → result.status=timeout', async () => {
    vi.useFakeTimers();
    const fake = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const killSpy = vi.spyOn(fake, 'kill');

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 0 }),
    );
    const p = runner.runLease(makeCtx({ timeoutSeconds: 10 }));

    // fake timer 模式：推进让 spawn 完成 + watchdog 注册
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0);
      if (vi.mocked(spawn).mock.calls.length > 0) break;
    }
    await vi.advanceTimersByTimeAsync(0);
    // 推进超过 timeout（10s）→ watchdog killChild
    await vi.advanceTimersByTimeAsync(11_000);

    expect(killSpy).toHaveBeenCalled();
    // kill 后 emit exit 让 for-await 跳出
    fake._emitExit(null, 'SIGTERM');
    const result = await p;

    expect(result.status).toBe('timeout');
    expect(typeof result.metadata?.retry_count).toBe('number');
    killSpy.mockRestore();
    vi.useRealTimers();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B3：spawn 级失败自动重试（isSpawnLevelFailure + resolveMaxRetries + 集成）
// ════════════════════════════════════════════════════════════════════════════

describe('isSpawnLevelFailure（task-10 B3 判定）', () => {
  it('timeout → true（重试）', () => {
    expect(isSpawnLevelFailure({ status: 'timeout', exitCode: 1 })).toBe(true);
  });

  it('spawn ENOENT（error 含 "spawn ENOENT"）→ true', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 127, error: 'spawn ENOENT' })).toBe(true);
  });

  it('OOM（error 含 "oom"）→ true', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 137, error: 'process killed: oom' })).toBe(true);
  });

  it('segfault（error 含 "segfault"）→ true', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 139, error: 'segfault at 0x0' })).toBe(true);
  });

  it('killed（error 含 "killed"）→ true', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 137, error: 'killed by signal' })).toBe(true);
  });

  it('cancelled → false（不重试）', () => {
    expect(isSpawnLevelFailure({ status: 'cancelled', exitCode: 1 })).toBe(false);
  });

  it('businessError=true → false（业务错误不重试）', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 1, businessError: true })).toBe(false);
  });

  it('completed（exitCode=0）→ false', () => {
    expect(isSpawnLevelFailure({ status: 'completed', exitCode: 0 })).toBe(false);
  });

  it('业务非零退出（无 spawn 关键字，非 businessError）→ false（保守不重试）', () => {
    expect(isSpawnLevelFailure({ status: 'failed', exitCode: 2, error: 'agent process exited with exit code 2' })).toBe(false);
  });
});

describe('resolveMaxRetries（硬上限 3）', () => {
  it('config undefined → 兜底 1', () => {
    expect(resolveMaxRetries(undefined)).toBe(1);
  });

  it('max_retries=2 → 2', () => {
    expect(resolveMaxRetries(makeConfig({ max_retries: 2 }))).toBe(2);
  });

  it('AC-10: max_retries=10 → 截断 3', () => {
    expect(resolveMaxRetries(makeConfig({ max_retries: 10 }))).toBe(3);
  });

  it('max_retries=0 → 0（禁用重试）', () => {
    expect(resolveMaxRetries(makeConfig({ max_retries: 0 }))).toBe(0);
  });
});

describe('重试编排（task-10 B3 集成）', () => {
  beforeEach(() => {
    mockAdapter = {
      provider: 'claude',
      parse: vi.fn((): null => null),
      buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
      buildInput: vi.fn((p: string) => `${p}\n`),
      getLastResultInfo: vi.fn(() => undefined),
    };
  });

  it('AC-07: spawn ENOENT 两次（max_retries=1）→ failed + retry_count=1', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      const fake = createFakeChild();
      // 每次都 ENOENT（spawn 级失败）
      setImmediate(() => {
        fake._emitError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
        fake._emitExit(127);
      });
      return fake as never;
    });

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 1 }),
    );
    const result = await runner.runLease(makeCtx());

    expect(callCount).toBe(2); // 原始 + 重试 1 次
    expect(result.status).toBe('failed');
    expect(result.metadata?.retry_count).toBe(1);
  });

  it('AC-08: 业务 is_error（getLastResultInfo().isError=true）→ 不重试 + retry_count=0', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      const fake = createFakeChild();
      setImmediate(() => {
        fake._emitExit(1); // claude 业务退出非 0
      });
      return fake as never;
    });
    mockAdapter.getLastResultInfo = vi.fn(() => ({ sessionId: 's', resultText: 'err', isError: true }));

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 1 }),
    );
    const result = await runner.runLease(makeCtx());

    expect(callCount).toBe(1); // 不重试
    expect(result.status).toBe('failed');
    expect(result.metadata?.retry_count).toBe(0);
  });

  it('AC-09: 重试清空 resumeSessionId（第二次 buildArgs 不带 --resume）', async () => {
    const buildArgsCalls: { resumeSessionId?: string }[] = [];
    mockAdapter.buildArgs = vi.fn((opts: { resumeSessionId?: string }) => {
      buildArgsCalls.push({ resumeSessionId: opts?.resumeSessionId });
      return ['-p', '--output-format', 'stream-json'];
    });
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      const fake = createFakeChild();
      setImmediate(() => {
        if (callCount === 1) {
          // 第一次 ENOENT → 重试
          fake._emitError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
          fake._emitExit(127);
        } else {
          // 第二次成功
          fake._emitExit(0);
        }
      });
      return fake as never;
    });

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 1 }),
    );
    const result = await runner.runLease(makeCtx({ resumeSessionId: 'sess-original' }));

    expect(callCount).toBe(2);
    expect(result.status).toBe('completed');
    // 第一次带 resumeSessionId，第二次（重试）清空
    expect(buildArgsCalls[0]?.resumeSessionId).toBe('sess-original');
    expect(buildArgsCalls[1]?.resumeSessionId).toBeUndefined();
  });

  it('cancel → 不重试 → cancelled + retry_count=0', async () => {
    let callCount = 0;
    let firstFake: FakeChild | null = null;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      const fake = createFakeChild();
      if (callCount === 1) firstFake = fake;
      return fake as never;
    });

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 1 }),
    );
    const p = runner.runLease(makeCtx());
    await waitForSpawn();
    // 取消
    await runner.cancel('lease-rt');
    // 手动 emit exit 让 for-await 跳出
    firstFake?._emitExit(null, 'SIGTERM');
    const result = await p;

    expect(callCount).toBe(1); // cancel 不重试
    expect(result.status).toBe('cancelled');
    expect(result.metadata?.retry_count).toBe(0);
  });

  it('重试成功（第一次 ENOENT，第二次 exit 0）→ completed + retry_count=1', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      callCount++;
      const fake = createFakeChild();
      setImmediate(() => {
        if (callCount === 1) {
          fake._emitError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
          fake._emitExit(127);
        } else {
          fake._emitExit(0);
        }
      });
      return fake as never;
    });

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 1 }),
    );
    const result = await runner.runLease(makeCtx());

    expect(callCount).toBe(2);
    expect(result.status).toBe('completed');
    expect(result.metadata?.retry_count).toBe(1);
  });
});
