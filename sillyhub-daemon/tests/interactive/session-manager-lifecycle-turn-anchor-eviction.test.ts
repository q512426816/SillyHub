/**
 * session-manager/lifecycle terminateSession 接线测试（2026-10-14-turn-anchor-
 * cache-eviction FR-01）。
 *
 * 断言 terminateSession 在会话级清理簇（4b _clearBackgroundTasks 与 5
 * _destroyUsageLedger 之间的第 4c 步）调用 turn-anchor 的
 * clearTurnAnchorCache(sessionId) 恰一次——防 Map 慢性增长的会话终结收口。
 *
 * 手法：vi.mock turn-anchor 模块（importOriginal 保留其余导出真身，仅替换
 * clearTurnAnchorCache 为 spy）+ 最小伪造 SessionManagerCore（terminateSession
 * 触及的成员逐个提供）。clearTurnAnchorCache 的行为面（幂等/兜底/竞态）在
 * turn-anchor.test.ts 真 git 仓用例覆盖，此处只验接线。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/interactive/turn-anchor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/interactive/turn-anchor.js')>()),
  clearTurnAnchorCache: vi.fn(),
}));

import { clearTurnAnchorCache } from '../../src/interactive/turn-anchor.js';
import { terminateSession } from '../../src/interactive/session-manager/lifecycle.js';
import type { SessionState } from '../../src/interactive/types.js';
import type { SessionManagerCore } from '../../src/interactive/session-manager/types.js';

const anchorMock = vi.mocked(clearTurnAnchorCache);

interface FakeMgrExtras {
  abortPermissionResolver: ReturnType<typeof vi.fn>;
  clearBorrowSandbox: ReturnType<typeof vi.fn>;
  clearBackgroundTasks: ReturnType<typeof vi.fn>;
  destroyUsageLedger: ReturnType<typeof vi.fn>;
  onSessionEnd: ReturnType<typeof vi.fn>;
  disarmTurnStartWatchdog: ReturnType<typeof vi.fn>;
}

/** 最小伪造 mgr：只提供 terminateSession 实际触及的成员（10 分钟延迟清理
 *  timer 真实 setTimeout + unref，不阻塞 vitest 退出）。 */
function makeFakeMgr(): { mgr: SessionManagerCore; extras: FakeMgrExtras } {
  const extras: FakeMgrExtras = {
    abortPermissionResolver: vi.fn(),
    clearBorrowSandbox: vi.fn(),
    clearBackgroundTasks: vi.fn(),
    destroyUsageLedger: vi.fn(),
    onSessionEnd: vi.fn(async () => {}),
    disarmTurnStartWatchdog: vi.fn(),
  };
  const mgr = {
    _pendingFirstPrompt: new Map(),
    _abortPermissionResolver: extras.abortPermissionResolver,
    _clearBorrowSandbox: extras.clearBorrowSandbox,
    _clearBackgroundTasks: extras.clearBackgroundTasks,
    // 2026-10-21-daemon-zombie-turn FR-01：0b 步撤防轮启动看门狗（core 新成员）。
    _disarmTurnStartWatchdog: extras.disarmTurnStartWatchdog,
    // 2026-10-21-task-wakeup-restore：4b-2 唤醒 debounce 清理触及的注册表。
    _taskWakeupPending: new Map(),
    _destroyUsageLedger: extras.destroyUsageLedger,
    _runNotifyChain: vi.fn(async (_sid: string, fn: () => Promise<void>) => {
      await fn();
    }),
    deps: { onSessionEnd: extras.onSessionEnd },
    _scheduleFlush: vi.fn(),
    _terminalCleanupTimers: new Map(),
    _store: new Map(),
    _pendingInjectCount: new Map(),
  } as unknown as SessionManagerCore;
  return { mgr, extras };
}

function makeState(sessionId: string): SessionState {
  return {
    sessionId,
    status: 'running',
    provider: 'claude',
    query: { close: vi.fn() },
    inputQueue: { close: vi.fn() },
  } as unknown as SessionState;
}

beforeEach(() => {
  anchorMock.mockReset();
});

describe('terminateSession × turn-anchor 缓存清理接线', () => {
  it('manual 终结：clearTurnAnchorCache 恰调一次且入参为 sessionId（4c 接线）', async () => {
    const { mgr } = makeFakeMgr();
    const state = makeState('sess-evict-manual');
    await terminateSession(mgr, state, 'manual');
    expect(anchorMock).toHaveBeenCalledTimes(1);
    expect(anchorMock).toHaveBeenCalledWith('sess-evict-manual');
  });

  it('driver_error 终结同样调用（end/fail 双路径收口）', async () => {
    const { mgr } = makeFakeMgr();
    const state = makeState('sess-evict-fail');
    await terminateSession(mgr, state, 'driver_error');
    expect(anchorMock).toHaveBeenCalledTimes(1);
    expect(anchorMock).toHaveBeenCalledWith('sess-evict-fail');
  });

  it('调用位置在 4b _clearBackgroundTasks 之后、5 _destroyUsageLedger 之前（清理簇同点惯例）', async () => {
    const { mgr, extras } = makeFakeMgr();
    const state = makeState('sess-evict-order');
    await terminateSession(mgr, state, 'manual');
    const anchorOrder = anchorMock.mock.invocationCallOrder[0]!;
    expect(anchorOrder).toBeGreaterThan(extras.clearBackgroundTasks.mock.invocationCallOrder[0]!);
    expect(anchorOrder).toBeLessThan(extras.destroyUsageLedger.mock.invocationCallOrder[0]!);
  });
});
