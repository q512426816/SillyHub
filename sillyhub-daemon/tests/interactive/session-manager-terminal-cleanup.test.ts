// tests/interactive/session-manager-terminal-cleanup.test.ts
// ql-20260825-f3#1：终态延迟清理矩阵。
//
// 修复前：_terminateSession 收尾链不删 _store 条目 → end/fail 后含凭证 env、
// subagentDepth、inputQueue buffer 的 SessionState 永久滞留（内存只增不减）。
// 修复后：延迟 10 分钟删除 _store + _pendingInjectCount 条目，且：
//   - 窗口内（既有测试语义）get 可查、status 保留；
//   - create / restoreAndReconnect 重建的同 id 新条目不被误删；
//   - stop()（daemon shutdown）清全部待清理 timer。
//
// 策略：fake timers 推进 10min+1ms 触发清理；mock driver 对齐
// session-manager-pending-cleanup.test.ts 同款。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { PersistedSessionRecord } from '../../src/interactive/types.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

const TERMINAL_CLEANUP_DELAY_MS = 10 * 60 * 1000;

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query =>
        ({ interrupt: vi.fn(async () => {}) }) as unknown as Query,
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

function baseInput(sessionId: string, runId: string) {
  return {
    sessionId,
    leaseId: `lease-${sessionId}`,
    firstPrompt: 'hi',
    firstRunId: runId,
    cwd: 'C:\\work',
    provider: 'claude' as const,
    pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── end / fail 到期删除 ───────────────────────────────────────────────────────

describe('终态延迟清理（ql-20260825-f3#1）', () => {
  it('end 后窗口内可查；到点删除 _store + _pendingInjectCount 条目', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    // running 中再 inject 一条 → 排队计数 =1（验证 _pendingInjectCount 一并回收）。
    await sm.inject('s1', 'queued-turn', 'r2');
    expect(sm.getPendingInjectCount('s1')).toBe(1);

    await sm.end('s1');
    // 窗口内：既有行为保留（终态对账 / 立即 get 查询）。
    expect(sm.get('s1')!.status).toBe('ended');
    expect(sm.getPendingInjectCount('s1')).toBe(1);

    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS + 1);
    // 到点：条目删除（修复点——原先永久滞留）。
    expect(sm.get('s1')).toBeUndefined();
    expect(sm.getPendingInjectCount('s1')).toBe(0);
  });

  it('fail 同样延迟清理', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    await sm.fail('s1');
    expect(sm.get('s1')!.status).toBe('failed');

    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS + 1);
    expect(sm.get('s1')).toBeUndefined();
  });

  it('未到点不删（差 1ms 窗口内保留）', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    await sm.end('s1');
    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS - 1);
    expect(sm.get('s1')!.status).toBe('ended');
  });
});

// ── 重建不被误删 ─────────────────────────────────────────────────────────────

describe('终态延迟清理的重建守卫', () => {
  it('窗口中段 restoreAndReconnect 重建（reconnecting）的条目不被误删', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    await sm.end('s1');
    // 清理 timer 已排队（剩 ~1min 到点）——此时 backend 下发 SESSION_RESUME →
    // restore 驱逐残留终态条目 + 重建（ql-20260823-006 reopen 语义）。注意 create
    // 对同 id 会抛 SessionAlreadyExistsError，同 id 重建只走 restore 路径。
    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS - 60_000);
    const record: PersistedSessionRecord = {
      sessionId: 's1',
      leaseId: 'lease-s1',
      agentSessionId: 'sdk-sess-s1',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 2,
      lastActiveAt: 1_700_000_000_000,
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
    };
    await sm.restoreAndReconnect(record);
    expect(sm.get('s1')!.status).toBe('reconnecting');

    // 推进越过原 timer 到点时刻 + 一个完整窗口：重建条目必须存活（timer 已被
    // _cancelTerminalCleanup 取消；即便竞态漏取消，状态守卫也兜底不删非终态条目）。
    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS);
    expect(sm.get('s1')).toBeDefined();
    expect(sm.get('s1')!.status).toBe('reconnecting');
  });

  it('restore 重建后的新终态会重新排队清理（不被旧 schedule 幂等守卫吞掉）', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    await sm.end('s1');
    const record: PersistedSessionRecord = {
      sessionId: 's1',
      leaseId: 'lease-s1',
      agentSessionId: 'sdk-sess-s1',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 2,
      lastActiveAt: 1_700_000_000_000,
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
    };
    await sm.restoreAndReconnect(record);
    await sm.fail('s1');
    expect(sm.get('s1')!.status).toBe('failed');

    // 重建后的终态重新 schedule（旧 timer 已取消，此处是新 timer）→ 到点删除。
    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS + 1);
    expect(sm.get('s1')).toBeUndefined();
  });
});

// ── stop() 清 timer ──────────────────────────────────────────────────────────

describe('stop() 清终态延迟清理 timer', () => {
  it('stop 后推进时钟条目保留（进程退出由 OS 回收内存）', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(baseInput('s1', 'r1'));
    await sm.end('s1');
    sm.stop();

    vi.advanceTimersByTime(TERMINAL_CLEANUP_DELAY_MS * 2);
    // stop 已 clearTimeout：不再触发删除。
    expect(sm.get('s1')!.status).toBe('ended');
  });
});
