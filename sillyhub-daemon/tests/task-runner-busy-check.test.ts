// tests/task-runner-busy-check.test.ts
// change 2026-08-29-daemon-selfupdate-safety / task-01 / FR-01 / D-001@v1。
//
// 覆盖 TaskRunner.hasActiveLease 空闲屏障忙判定查询口（daemon 升级编排器
// tryUpdate（task-04）的消费契约）：
//   - 空 _controllers 追踪集 → false；
//   - track(leaseId) 后 → true（与 activeTaskCount getter 口径严格一致）；
//   - untrack 后 → false（runLease 终态自动 untrack 同效）；
//   - 幂等重 track 同一 lease 不虚增忙判定。
//
// 经公开 track/untrack（task-runner.ts track/untrack）驱动，不起 runLease /
// 不 spawn 子进程——hasActiveLease 是纯查询，无需执行链参与。构造 mock 风格
// 对齐 tests/task-runner-lease-cancel-idempotent.test.ts 的 makeClient 等 helper。

import { describe, it, expect, vi } from 'vitest';
import { TaskRunner } from '../src/task-runner.js';

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

function makeRunner(): TaskRunner {
  return new TaskRunner(
    makeClient() as never,
    makeWorkspace() as never,
    makeCred() as never,
  );
}

describe('task-01 / FR-01 / D-001@v1: TaskRunner.hasActiveLease 忙判定', () => {
  it('空追踪集 → false（无在跑 batch lease 不忙）', () => {
    const runner = makeRunner();
    expect(runner.hasActiveLease()).toBe(false);
  });

  it('track 后 → true；untrack 后 → false（生命周期与 activeTaskCount 同步）', () => {
    const runner = makeRunner();
    runner.track('lease-1');
    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.activeTaskCount).toBe(1);

    runner.untrack('lease-1');
    expect(runner.hasActiveLease()).toBe(false);
    expect(runner.activeTaskCount).toBe(0);
  });

  it('多 lease 并存 → true；逐个 untrack 至最后一个才翻 false', () => {
    const runner = makeRunner();
    runner.track('lease-1');
    runner.track('lease-2');

    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.activeTaskCount).toBe(2);

    runner.untrack('lease-1');
    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.activeTaskCount).toBe(1);

    runner.untrack('lease-2');
    expect(runner.hasActiveLease()).toBe(false);
  });

  it('幂等重 track 同一 lease → 仍 true 且不虚增计数', () => {
    const runner = makeRunner();
    runner.track('lease-1');
    runner.track('lease-1'); // 对齐 Python 不重复创建 Task

    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.activeTaskCount).toBe(1);
  });

  it('纯查询零副作用：hasActiveLease 不改变追踪集', () => {
    const runner = makeRunner();
    runner.track('lease-1');

    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.hasActiveLease()).toBe(true);
    expect(runner.activeTaskCount).toBe(1);
    expect(runner.getState('lease-1')).toBe('running');
  });
});
