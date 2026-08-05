// tests/task-runner-lease-cancel-idempotent.test.ts
// change 2026-08-05-daemon-kill-channel-unify / task-06 / FR-03 / R-06
//（design §5 Phase2 + §10 R-06 + §9 兼容策略）。
//
// 覆盖 task-06 验收点 #2 的「执行链」部分 + 验收点 #3「双触发幂等」：
//   #2  cancel(leaseId) → AbortController.abort → _spawnAndStream 的 onAbort
//       listener → _killChild(child, SIGTERM) → child.kill('SIGTERM')。
//   #3  LEASE_CANCEL 与心跳轮询（_runLeaseHeartbeatLoop）双触发 cancel 时：
//       AbortController.abort() 幂等 + onAbort listener { once: true } +
//       _killChild 内 child.killed 守卫 → child.kill 只被调一次、不抛。
//
// 关键点（design §10 R-06）：双触发不会 double-kill。两条触发路径都汇聚到
// TaskRunner.cancel（daemon.ts LEASE_CANCEL handler 调一次 + task-runner.ts
// heartbeat loop 检测 cancelled 调一次），cancel 内部 abort 幂等，_killChild
// 内部 child.killed 守卫 → kill 一次。
//
// 本文件用真实 TaskRunner + vi.mock('node:child_process') 的 createFakeChild
// 验证完整 kill 链。daemon.ts handler → taskRunner.cancel 调用契约见
// tests/daemon-lease-cancel-handler.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({
  linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })),
}));

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => null as unknown) };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_p: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner } from '../src/task-runner.js';
import type { DaemonConfig } from '../src/config.js';
import type { LeaseCtx } from '../src/types.js';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';

// ── 共用 helper（风格对齐 task-runner-retry-timeout.test.ts）──────────────────

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

/** 推进微任务直到 spawn 被调用（实现层 await 完 prepareWorkspace/getBackend/
 * startLease 等步骤后才 spawn），再多让一拍让 abort listener 注册完成。 */
async function waitForSpawnAndListener(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await vi.advanceTimersByTimeAsync(0);
    if (vi.mocked(spawn).mock.calls.length > 0) break;
  }
  await vi.advanceTimersByTimeAsync(0);
}

// ════════════════════════════════════════════════════════════════════════════
// task-06 验收 #2 执行链：cancel(leaseId) → AbortController → _killChild
// ════════════════════════════════════════════════════════════════════════════

describe('task-06 / FR-03: TaskRunner.cancel → AbortController → _killChild 执行链', () => {
  beforeEach(() => {
    mockAdapter = {
      provider: 'claude',
      parse: vi.fn((): null => null),
      buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
      buildInput: vi.fn((p: string) => `${p}\n`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel 在跑 lease → child.kill(SIGTERM) 被调一次（_killChild 真实触发）', async () => {
    vi.useFakeTimers();
    const fake = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const killSpy = vi.spyOn(fake, 'kill');

    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      // timeoutSeconds=-1 → 看门狗不启动（仅 cancel 路径触发 kill，避免噪音）
      makeConfig({ max_retries: 0 }),
    );
    const ctx = makeCtx({ leaseId: 'lease-cancel-1', timeoutSeconds: -1 });
    const p = runner.runLease(ctx);

    await waitForSpawnAndListener();
    expect(runner.activeTaskCount).toBe(1);

    // cancel → ac.abort() → onAbort listener → _killChild(SIGTERM)
    const result = await runner.cancel('lease-cancel-1');
    expect(result).toBe(true);

    expect(fake.killed).toBe(true);
    expect(killSpy).toHaveBeenCalledTimes(1);
    // SIGTERM 先发（killSpy 首调信号）
    expect(
      (fake as unknown as { _lastKillSignal?: string })._lastKillSignal,
    ).toBe('SIGTERM');

    // 让 runLease 收敛（emit exit → finally 清 killTimer + removeEventListener）
    fake._emitExit(null, 'SIGTERM');
    await p;
    killSpy.mockRestore();
  });

  it('cancel 后 SIGKILL 升级定时器到期 → _killChild 被 child.killed 守卫跳过（不二次 kill）', async () => {
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
    const ctx = makeCtx({ leaseId: 'lease-sigkill-guard', timeoutSeconds: -1 });
    const p = runner.runLease(ctx);

    await waitForSpawnAndListener();

    await runner.cancel('lease-sigkill-guard');
    expect(killSpy).toHaveBeenCalledTimes(1); // SIGTERM

    // 推进超过 KILL_GRACE_MS（2_000ms）→ onAbort 设的 killTimer 触发 _killChild(SIGKILL)
    await vi.advanceTimersByTimeAsync(2_100);
    // child.killed 已 true → _killChild 内部 !child.killed 守卫跳过，killSpy 不再增加
    expect(killSpy).toHaveBeenCalledTimes(1);

    fake._emitExit(null, 'SIGTERM');
    await p;
    killSpy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-06 验收 #3 / R-06：LEASE_CANCEL + 心跳轮询双触发 cancel 幂等
// ════════════════════════════════════════════════════════════════════════════

describe('task-06 / R-06: LEASE_CANCEL + 心跳轮询双触发 cancel 幂等（不 double-kill）', () => {
  beforeEach(() => {
    mockAdapter = {
      provider: 'claude',
      parse: vi.fn((): null => null),
      buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
      buildInput: vi.fn((p: string) => `${p}\n`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('两次 cancel(leaseId)（LEASE_CANCEL + heartbeat 双触发）→ child.kill 只调一次、不抛', async () => {
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
    const ctx = makeCtx({ leaseId: 'lease-double', timeoutSeconds: -1 });
    const p = runner.runLease(ctx);

    await waitForSpawnAndListener();

    // 双触发：daemon LEASE_CANCEL handler 调一次 cancel，心跳轮询检测 cancelled 再调一次
    await expect(runner.cancel('lease-double')).resolves.toBe(true);
    // 第二次 abort：AbortController 已 aborted → abort() 幂等 no-op；
    // onAbort listener { once: true } 已触发并移除 → 不再二次 _killChild
    await expect(runner.cancel('lease-double')).resolves.toBe(true);

    // 关键幂等断言：child.kill 只被调一次（无 double-kill）
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(fake.killed).toBe(true);

    fake._emitExit(null, 'SIGTERM');
    await p;
    killSpy.mockRestore();
  });

  it('cancel 未知 leaseId（任务已 untrack / 心跳竞态）→ 返回 false、不抛、不 kill', async () => {
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
    const ctx = makeCtx({ leaseId: 'lease-real', timeoutSeconds: -1 });
    const p = runner.runLease(ctx);

    await waitForSpawnAndListener();

    // 心跳轮询在 lease 已 untrack 后才检测到 cancelled → cancel 找不到 controller
    await expect(runner.cancel('lease-never-tracked')).resolves.toBe(false);
    expect(killSpy).not.toHaveBeenCalled();

    // 正常退出（不影响真实 lease）
    fake._emitExit(0, null);
    await p;
    killSpy.mockRestore();
  });

  it('track 幂等：重复 track 同一 leaseId 返回同一 AbortController（cancel 一次即全中）', async () => {
    // 守护 track 的幂等契约（task-runner.ts:303-311 已在跑则返回现有 controller），
    // 这是双触发不会创建两个 controller 的前置保证。
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
      makeConfig({ max_retries: 0 }),
    );
    const ac1 = runner.track('lease-idem');
    const ac2 = runner.track('lease-idem');
    expect(ac1).toBe(ac2); // 同一引用
    runner.untrack('lease-idem');
  });
});
