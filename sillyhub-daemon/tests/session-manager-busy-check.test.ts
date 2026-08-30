// tests/session-manager-busy-check.test.ts
// change 2026-08-29-daemon-selfupdate-safety / task-01 / FR-01 / D-001@v1。
//
// 覆盖 SessionManager.hasRunningTurn 空闲屏障忙判定查询口（daemon 升级编排器
// tryUpdate（task-04）的消费契约）：
//   - 仅 status === 'running' 算忙（公开链路 create 后即 running）；
//   - active / reconnecting 空闲会话不算忙（D-001@v1：可经挂起/恢复链路无损
//     穿越升级窗口）；
//   - ended / failed 终态延迟清理残留条目（ql-20260825-f3#1 窗口内仍留在
//     _store）不误报；
//   - 空 store → false；纯查询零副作用（不改 _store 内容）。
//
// 构造模式与 tests/plan-response-delivery.test.ts 的 fake driver 同构：
// driver.consume 永不 resolve → 公开 create() 后 turn 停在 running。
// 非 running 状态经 `as any` 直注 _store 驱动（task 卡允许的注入路径）。

import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../src/interactive/session-manager.js';
import { InputQueue } from '../src/interactive/input-queue.js';
import type { SessionManagerDeps } from '../src/interactive/types.js';
import { SessionBusyError } from '../src/interactive/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
  PersistedSessionRecord,
  SessionState,
  SessionStatus,
} from '../src/interactive/types.js';

function createSessionManager(): SessionManager {
  const fakeDriver: InteractiveDriver = {
    provider: 'claude',
    async start() {
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(_handle, _callbacks: InteractiveDriverCallbacks) {
      // 不真正消费——turn 永不结束，create 后 status 停在 running。
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return false;
    },
  };

  const deps: SessionManagerDeps = {
    driver: fakeDriver as never,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: vi.fn(),
  };

  return new SessionManager(deps);
}

/** `as any` 直注 _store 的最小 SessionState（只填 hasRunningTurn 关心的字段形态）。 */
function makeState(sessionId: string, status: SessionStatus): SessionState {
  return {
    sessionId,
    leaseId: `lease-${sessionId}`,
    claimToken: `ct-${sessionId}`,
    inputQueue: new InputQueue(),
    status,
    lastActiveAt: Date.now(),
    cwd: '/tmp/test',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/usr/bin/claude',
    subagentDepth: new Map<string, number>(),
  };
}

/** 注入一个 session 状态到私有 _store（测试驱动口，task 卡允许）。 */
function seed(sm: SessionManager, state: SessionState): void {
  (sm as unknown as { _store: Map<string, SessionState> })._store.set(
    state.sessionId,
    state,
  );
}

describe('task-01 / FR-01 / D-001@v1: SessionManager.hasRunningTurn 忙判定', () => {
  it('空 store → false（无任何会话不忙）', () => {
    const sm = createSessionManager();
    expect(sm.hasRunningTurn()).toBe(false);
  });

  it('公开链路：create 后（turn 进行中）→ true', async () => {
    const sm = createSessionManager();
    await sm.create({
      sessionId: 'sess-run',
      leaseId: 'lease-1',
      claimToken: 'ct-1',
      firstPrompt: 'hello',
      firstRunId: 'run-1',
      cwd: '/tmp/test',
      provider: 'claude',
      pathToClaudeCodeExecutable: '/usr/bin/claude',
    });
    // 锚定公开状态口径：create 后首 turn 确为 running。
    expect(sm.get('sess-run')!.status).toBe('running');
    expect(sm.hasRunningTurn()).toBe(true);
  });

  it.each(['active', 'reconnecting'] as const)(
    '空闲会话 status=%s → false（D-001：不算忙，可无损穿越升级窗口）',
    (status) => {
      const sm = createSessionManager();
      seed(sm, makeState('sess-idle', status));
      expect(sm.get('sess-idle')!.status).toBe(status);
      expect(sm.hasRunningTurn()).toBe(false);
    },
  );

  it.each(['ended', 'failed'] as const)(
    '终态延迟清理残留条目 status=%s → false（不误报）',
    (status) => {
      const sm = createSessionManager();
      seed(sm, makeState('sess-terminal', status));
      expect(sm.get('sess-terminal')!.status).toBe(status);
      expect(sm.hasRunningTurn()).toBe(false);
    },
  );

  it('混合场景：active + reconnecting → false；任一 running 出现 → true', () => {
    const sm = createSessionManager();
    seed(sm, makeState('sess-a', 'active'));
    seed(sm, makeState('sess-b', 'reconnecting'));
    expect(sm.hasRunningTurn()).toBe(false);

    seed(sm, makeState('sess-c', 'running'));
    expect(sm.hasRunningTurn()).toBe(true);
  });

  it('全状态合租：running 只需一个即 true，且不因 ended/failed 残留翻回 false', () => {
    const sm = createSessionManager();
    seed(sm, makeState('sess-active', 'active'));
    seed(sm, makeState('sess-ended', 'ended'));
    seed(sm, makeState('sess-failed', 'failed'));
    seed(sm, makeState('sess-recon', 'reconnecting'));
    seed(sm, makeState('sess-running', 'running'));
    expect(sm.hasRunningTurn()).toBe(true);
  });

  it('纯查询零副作用：重复调用不改 _store 内容与状态', () => {
    const sm = createSessionManager();
    seed(sm, makeState('sess-a', 'active'));
    seed(sm, makeState('sess-b', 'running'));

    expect(sm.hasRunningTurn()).toBe(true);
    expect(sm.hasRunningTurn()).toBe(true);

    const store = (sm as unknown as { _store: Map<string, SessionState> })._store;
    expect(store.size).toBe(2);
    expect(sm.get('sess-a')!.status).toBe('active');
    expect(sm.get('sess-b')!.status).toBe('running');
  });
});

// ── ql-20260831-001-6dde：restoreAndReconnect 活会话守卫（恢复链不杀在途 turn）──
//
// 恢复链（boot/heartbeat_recover/backend SESSION_RESUME）经 restoreAndReconnect
// 重建会话时，对内存残留条目先静默驱逐（ql-20260823-006）。守卫补丁：本地条目
// 仍在跑 turn（status=running）或待处理输入（_pendingInjectCount>0，附件下载中）
// 时拒绝驱逐——抛 SessionBusyError 由调用方重试/跳过，绝不 terminate 在途工作
//（2026-08-31 风险审查发现①：恢复链触发瞬间的忙检只查一次，恢复在途期间新起
// 的 turn 只能靠本守卫兜底）。

describe('ql-20260831-001-6dde: restoreAndReconnect 活会话守卫', () => {
  function mkRecord(sessionId: string): PersistedSessionRecord {
    return {
      sessionId,
      leaseId: `lease-${sessionId}`,
      agentSessionId: `sdk-${sessionId}`,
      cwd: '/tmp/test',
      provider: 'claude',
      pathToClaudeCodeExecutable: '/usr/bin/claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
    };
  }

  it('本地条目 status=running（在途 turn）→ 抛 SessionBusyError，条目原样保留', async () => {
    const sm = createSessionManager();
    seed(sm, makeState('s-busy', 'running'));

    await expect(sm.restoreAndReconnect(mkRecord('s-busy'))).rejects.toBeInstanceOf(
      SessionBusyError,
    );

    // 未被驱逐：条目仍在 store（对比旧行为 terminate + delete）
    const store = (sm as unknown as { _store: Map<string, SessionState> })._store;
    expect(store.has('s-busy')).toBe(true);
  });

  it('status=active 但有待处理输入（_pendingInjectCount>0，附件下载中）→ 同样抛 SessionBusyError', async () => {
    const sm = createSessionManager();
    seed(sm, makeState('s-queued', 'active'));
    (sm as unknown as { _pendingInjectCount: Map<string, number> })._pendingInjectCount.set(
      's-queued',
      1,
    );

    await expect(sm.restoreAndReconnect(mkRecord('s-queued'))).rejects.toBeInstanceOf(
      SessionBusyError,
    );
    const store = (sm as unknown as { _store: Map<string, SessionState> })._store;
    expect(store.has('s-queued')).toBe(true);
  });

  it('空闲 active 条目（无在途 turn、无待处理输入）→ 不抛 SessionBusyError（维持驱逐重建语义）', async () => {
    const sm = createSessionManager();
    seed(sm, makeState('s-idle', 'active'));

    // 走驱逐后的正常恢复路径：fake driver.start 成功 → restore 正常返回，
    // 守卫只拦 running/待处理输入，不误伤空闲条目。
    await expect(sm.restoreAndReconnect(mkRecord('s-idle'))).resolves.toBeUndefined();
  });
});
