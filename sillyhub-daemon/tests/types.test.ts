// tests/types.test.ts
// task-02 类型断言：编译期保证 AgentEventType / TaskState union 恰为预期字面量集合，
// TaskResult 字段 1:1 对齐 Python task_runner.py:36-48。
// 纯 type-level 断言（expectTypeOf），无运行时副作用。

import { describe, it, expectTypeOf } from 'vitest';
import type {
  AgentEvent,
  AgentEventType,
  TaskResult,
  TaskState,
  DaemonMessage,
  LeaseCtx,
  LeaseClaimResult,
  LeaseMessage,
} from '../src/types';

describe('types.ts type assertions', () => {
  it('AgentEvent.type is exactly the 5-value union', () => {
    expectTypeOf<AgentEventType>().toEqualTypeOf<
      'text' | 'tool_use' | 'tool_result' | 'error' | 'complete'
    >();
  });

  it('TaskResult has all 10 required fields', () => {
    expectTypeOf<TaskResult>().toMatchTypeOf<{
      success: boolean;
      exitCode: number;
      patch: string;
      filesChanged: number;
      insertions: number;
      deletions: number;
      output: string;
      error: string;
      durationMs: number;
      metadata: Record<string, unknown>;
    }>();
  });

  it('TaskState is exactly the 5-value union', () => {
    expectTypeOf<TaskState>().toEqualTypeOf<
      'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    >();
  });

  it('DaemonMessage payload is unknown by default', () => {
    expectTypeOf<DaemonMessage['payload']>().toEqualTypeOf<unknown>();
  });

  it('LeaseCtx.repoUrl accepts string | null | undefined', () => {
    const ctx: LeaseCtx = { leaseId: 'l1', runtimeId: 'r1', repoUrl: null };
    expectTypeOf(ctx.repoUrl).toEqualTypeOf<string | null | undefined>();
  });

  it('LeaseClaimResult.claimToken is required', () => {
    expectTypeOf<LeaseClaimResult>().toHaveProperty('claimToken').toEqualTypeOf<string>();
  });

  it('LeaseMessage.eventType is required, others optional', () => {
    const msg: LeaseMessage = { eventType: 'text' };
    expectTypeOf(msg).toMatchTypeOf<LeaseMessage>();
  });

  it('AgentEvent minimal shape', () => {
    const ev: AgentEvent = { type: 'text', content: 'hi' };
    expectTypeOf(ev).toEqualTypeOf<AgentEvent>();
  });
});
