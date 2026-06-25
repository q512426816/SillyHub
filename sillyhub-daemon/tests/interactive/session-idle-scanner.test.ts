// tests/interactive/session-idle-scanner.test.ts
// task-07 Step 3：空闲 30min 扫描定时器（FR-06 / D-004@v1）。
//
// 覆盖（task-07 蓝图 §5.3 + §6 边界 3/4/6/9/11/12 + §10 AC-06~AC-12）：
//   - active/running session 空闲超 idleTimeoutSec → 扫描命中 → end → onSessionEnd(ended)
//   - 未超阈值不动
//   - inject 更新 lastActiveAt 重置空闲窗口
//   - running session 超时 → 先 driver.interrupt(query) 再 end（spike D1 兜底）；
//     interrupt 抛错时仍 end
//   - reconnecting session 跳过（守卫 continue）
//   - 扫描异常隔离（单 session end 抛错不中断本轮其他 session）
//   - start/stop 生命周期 + 幂等 + 重建（真实短周期定时器）
//   - idleTimeoutSec 可配 + 非法值（NaN/<=0）回退 1800
//
// 测试策略：扫描逻辑用 scanOnce() 直接驱动单轮（避免 setInterval 在 fake timer 下
// 嵌套宏任务时序问题）；start/stop 生命周期用真实短周期定时器 + 真实 sleep。

import { describe, it, expect, afterEach, vi } from 'vitest';
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

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeMockDriver(opts: { interruptThrow?: boolean } = {}) {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = {
    interrupt: vi.fn(async () => {
      if (opts.interruptThrow) throw new Error('interrupt boom');
    }),
  } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => {
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(
      async (_s: string, _r: string, _res: SDKResultMessage) => {},
    ),
    onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ── AC-06：active session 空闲超阈值 → end（scanOnce 直接驱动）────────────────

describe('task-07 AC-06 空闲扫描 active 超阈值 → end', () => {
  it('未超阈值 → onSessionEnd 零调用', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    // create 后 lastActiveAt=now，advance 1.5s（用 vi fake timer 仅推进 Date）
    vi.useFakeTimers();
    vi.advanceTimersByTime(1500);
    await sm.scanOnce();
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('active session 空闲超 idleTimeoutSec → end → onSessionEnd(ended) 调用一次；status=ended', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    vi.useFakeTimers();
    vi.advanceTimersByTime(2500); // 2.5s > 2s
    await sm.scanOnce();
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-1')!.status).toBe('ended');
    vi.useRealTimers();
  });
});

// ── AC-07：inject 更新 lastActiveAt 重置空闲窗口 ──────────────────────────────

describe('task-07 AC-07 inject 重置空闲窗口', () => {
  it('空闲窗口内 inject 后 lastActiveAt=now；连续 inject 不超时', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);

    vi.useFakeTimers();
    vi.advanceTimersByTime(1500); // 1.5s < 2s
    // 注意 inject 用真实 timer（Date.now 已被 fake 推进，inject 写入新 lastActiveAt）
    // 但 inject 不依赖 timer，只写 Date.now()——fake timer 下 Date.now() 也被推进，
    // 这里只是模拟「inject 发生在 t=1.5s」。还原真实 timer 后 inject 仍写当前（真实）时间。
    vi.useRealTimers();

    // 用真实 timer：手动调整 state.lastActiveAt 模拟 inject 重置
    await sm.inject('sess-1', 'keep alive', 'run-inj-1');
    // 现在 lastActiveAt ≈ now；advance 1.5s 不应超时
    vi.useFakeTimers();
    vi.advanceTimersByTime(1500);
    await sm.scanOnce();
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    // 再 advance 1s → 总 2.5s > 2s → 超时 end
    vi.advanceTimersByTime(1000);
    await sm.scanOnce();
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    vi.useRealTimers();
  });
});

// ── AC-08：running session 空闲回收先 interrupt 再 end ────────────────────────

describe('task-07 AC-08 running session 空闲回收先 interrupt 再 end', () => {
  it('running turn 卡死超阈值 → 先 driver.interrupt(query) 兜底、再 end', async () => {
    const { driver, fakeQuery } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    // status 仍 running（无 result）
    expect(sm.get('sess-1')!.status).toBe('running');
    vi.useFakeTimers();
    vi.advanceTimersByTime(2500);
    await sm.scanOnce();
    expect(driver.interrupt).toHaveBeenCalledWith(fakeQuery);
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    expect(sm.get('sess-1')!.status).toBe('ended');
    vi.useRealTimers();
  });

  it('interrupt 抛错时仍 end（catch 吞，InputQueue.close 让 query 自然结束）', async () => {
    const { driver, fakeQuery } = makeMockDriver({ interruptThrow: true });
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    vi.useFakeTimers();
    vi.advanceTimersByTime(2500);
    await sm.scanOnce();
    // driver.interrupt 在 mock 内 q.interrupt 抛 → 仍调 end（_onIdleExpire catch 吞）
    expect(driver.interrupt).toHaveBeenCalledWith(fakeQuery);
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    expect(sm.get('sess-1')!.status).toBe('ended');
    vi.useRealTimers();
  });
});

// ── AC-09：reconnecting session 跳过 ──────────────────────────────────────────

describe('task-07 AC-09 reconnecting session 跳过扫描', () => {
  it('status=reconnecting 不被空闲扫描 end', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    // 强置 reconnecting（Wave3 才有，这里模拟）
    const state = sm.get('sess-1') as unknown as { status: string };
    state.status = 'reconnecting';
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000); // 远超 2s
    await sm.scanOnce();
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ended/failed session 跳过扫描', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    await sm.end('sess-1'); // status=ended
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    await sm.scanOnce();
    // end 已调用一次（手动），扫描不应再调（ended 跳过 + end 幂等）
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ── AC-10：扫描异常隔离 ───────────────────────────────────────────────────────

describe('task-07 AC-10 扫描异常隔离', () => {
  it('单 session end 抛错 → _scanIdle 外层 catch；其他 session 仍扫描', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    // 让 onSessionEnd 对 sess-1 抛错
    deps.onSessionEnd.mockImplementation(async (sid: string) => {
      if (sid === 'sess-1') throw new Error('end boom');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    await sm.create({ ...BASE_INPUT, sessionId: 'sess-2', firstRunId: 'run-2' });
    vi.useFakeTimers();
    vi.advanceTimersByTime(2500);
    await sm.scanOnce();
    // sess-1 end 抛错（被 catch 记日志）；sess-2 仍被 end
    expect(errSpy).toHaveBeenCalled();
    expect(sm.get('sess-2')!.status).toBe('ended');
    vi.useRealTimers();
  });
});

// ── AC-11：idleTimeoutSec 可配 + 非法值兜底 ───────────────────────────────────

describe('task-07 AC-11 idleTimeoutSec 可配 + 非法值兜底', () => {
  it('opts.idleTimeoutSec 覆盖默认（未超时不 end）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 5, idleScanSec: 1 },
    );
    await sm.create(BASE_INPUT);
    vi.useFakeTimers();
    vi.advanceTimersByTime(2500); // 2.5s < 5s
    await sm.scanOnce();
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('env SESSION_IDLE_TIMEOUT_SEC 覆盖默认 1800', () => {
    const { driver } = makeMockDriver();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', '60');
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getIdleTimeoutSec()).toBe(60);
  });

  it('env 非法（NaN）→ 回退默认 0（D-001@v1 默认禁用）', () => {
    const { driver } = makeMockDriver();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', 'not-a-number');
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getIdleTimeoutSec()).toBe(0);
  });

  it('env <=0 → 回退默认 0（D-001@v1 默认禁用，idle 不启动）', () => {
    const { driver } = makeMockDriver();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', '0');
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getIdleTimeoutSec()).toBe(0);
  });

  it('opts.idleTimeoutSec 优先于 env', () => {
    const { driver } = makeMockDriver();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', '60');
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      { idleTimeoutSec: 120 },
    );
    expect(sm.getIdleTimeoutSec()).toBe(120);
  });
});

// ── AC-12：start/stop 生命周期（真实短周期定时器）─────────────────────────────

describe('task-07 AC-12 start/stop 生命周期（真实定时器）', () => {
  // 真实 timer：idleScanSec=0.05s（50ms），idleTimeoutSec=0.02s（20ms）
  // 让 start 后 100ms 内必触发至少一次扫描且超时 end。
  it('start 后定时器扫描命中超时 session → end', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 0.02, idleScanSec: 0.05 },
    );
    await sm.create(BASE_INPUT);
    sm.start();
    // 等待至少一次扫描周期（50ms）+ buffer
    await new Promise((r) => setTimeout(r, 150));
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    sm.stop();
  });

  it('start 幂等（多次 start 不创建多个定时器，只 end 一次）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 0.02, idleScanSec: 0.05 },
    );
    await sm.create(BASE_INPUT);
    sm.start();
    sm.start();
    sm.start();
    await new Promise((r) => setTimeout(r, 150));
    // 多次扫描命中但 end 幂等（task-04 end 已 ended 直接 return），onSessionEnd 只调一次
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
    sm.stop();
  });

  it('stop 后不再扫描（advance 真实时间不再 end）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 0.02, idleScanSec: 0.05 },
    );
    await sm.create(BASE_INPUT);
    sm.start();
    sm.stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
  });

  it('stop→start 重建定时器恢复扫描', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 0.02, idleScanSec: 0.05 },
    );
    await sm.create(BASE_INPUT);
    sm.start();
    sm.stop();
    await new Promise((r) => setTimeout(r, 150));
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    // 重建后恢复（lastActiveAt 已是 create 时刻，远超 20ms 阈值）
    sm.start();
    await new Promise((r) => setTimeout(r, 150));
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    sm.stop();
  });

  it('stop 幂等（多次 stop 不抛）', () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    expect(() => {
      sm.stop();
      sm.stop();
    }).not.toThrow();
  });

  it('未 start 直接 stop 不抛', () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      { idleTimeoutSec: 2, idleScanSec: 1 },
    );
    expect(() => sm.stop()).not.toThrow();
  });
});
