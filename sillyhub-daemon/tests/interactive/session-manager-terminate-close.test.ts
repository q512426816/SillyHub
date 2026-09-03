// tests/interactive/session-manager-terminate-close.test.ts
// task-03 / Phase1 切断契约测试（change 2026-08-05-daemon-kill-channel-unify）。
//
// 验证 task-01 引入的 ``_terminateSession`` 统一收敛契约（design §5 Phase1 /
// §7.5 / decisions D-001@v2 / D-003 / D-004 / R-01）：
//   AC-1：``end`` 和 ``fail`` 必须触发 ``driverHandle.close?.()``（接通 SDK kill 链：
//         close → stdin EOF → 2s → SIGTERM → 5s → SIGKILL，止血 P0「卡死 turn 烧 token」）。
//   AC-2：``interrupt`` **不得**触发 close（守 D-001@v2：「打断本轮」按钮保持软
//         ``q.interrupt()``，session 仍 active 可续轮；只有 end/fail/cancel 走硬杀）。
//   AC-3：close 抛异常时 ``end``/``fail`` 不能向上冒泡（R-01：try/catch 兜底；
//         SDK 内部已有 SIGTERM→SIGKILL 升级。impl 把 catch 放在 ``_terminateSession``
//         调用层而非 ``ClaudeDriverHandle.close`` 自身——见 claude-sdk-driver.ts 注释
//         L268「本方法不吞错」，故本文件在 SessionManager 层断言「不冒泡」）。
//
// 与既有测试分工（不重复）：
//   - session-manager.test.ts：end/fail/interrupt 的 status / onSessionEnd / 幂等
//     通用语义，但其 mock driver 返回的 fakeQuery **没有 close 方法**，无法断言 close
//     调用契约——本文件补这一层。
//   - session-interrupt.test.ts：interrupt turn 级 SDK 交互（result subtype / 续轮），
//     不涉及 close。
//   - session-manager-pending-cleanup.test.ts：终态触发 resolver.abortAll，不涉及 close。
//
// 策略：mock driver 的 ``start`` 返回一个「同时携带 ``interrupt`` 与 ``close`` spy」的
// fakeQuery（claude provider 下 SessionManager.create 把它存入 ``state.query``；
// ``_terminateSession`` 经 ``state.query.close?.()`` 触发，``interrupt`` 经
// ``driver.interrupt(state.query)`` 触发）。如此即可在同一会话上同时观测两条通道。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  InteractiveDriverCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

/**
 * mock driver：start 返回一个 fakeQuery，同时挂 ``interrupt``（soft turn 级）与
 * ``close``（hard kill 链入口）两个 spy。两者均被 SessionManager 在不同路径调用：
 *   - interrupt()  → driver.interrupt(query) → query.interrupt()
 *   - end()/fail() → _terminateSession        → query.close?.()
 *
 * 返回 driver + 两个 spy 句柄 + consume 回调注入手柄（供 emitResult 模拟 SDK
 * 吐 result 让 session 进入 active 态，便于测 interrupt no-op / 续轮）。
 */
function makeMockDriverWithClose() {
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;
  const interruptSpy = vi.fn(async () => {});
  const closeSpy = vi.fn(() => {});
  const fakeQuery = {
    interrupt: interruptSpy,
    close: closeSpy,
  } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => {
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
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
    interruptSpy,
    closeSpy,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onTurnResult?.(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onTurnMessage?.(m),
  };
}

function makeMockDriverWithoutClose() {
  // FR-07 brownfield：旧 driver / 未实现 close 的 driver —— close?.() no-op 不报错。
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;
  const fakeQuery = {
    interrupt: vi.fn(async () => {}),
    // 故意不定义 close
  } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => {
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;
  return { driver, fakeQuery };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

const BASE_INPUT = {
  sessionId: 'sess-kill',
  leaseId: 'lease-kill',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// ── AC-1：end / fail 触发 close（D-003 接通 SDK kill 链）──────────────────────

describe('task-03 AC-1: end/fail 触发 driverHandle.close（_terminateSession 硬杀链）', () => {
  it('end → state.query.close 调用一次（claude provider 经 state.query 取 close）', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    expect(closeSpy).not.toHaveBeenCalled();

    await sm.end('sess-kill');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    // 终态语义保留（原 end 契约不回归）
    expect(sm.get('sess-kill')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'ended');
  });

  it('fail → state.query.close 调用一次（driver_error 收敛走同一 _terminateSession）', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    expect(closeSpy).not.toHaveBeenCalled();

    await sm.fail('sess-kill');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-kill')!.status).toBe('failed');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'failed');
  });

  it('end 在 turn 进行中（status=running）也调 close（止血 P0：当前 turn 卡死也能强杀）', async () => {
    // 直接 end，不先 emit result → status 仍 running（卡死 turn 场景）。
    // _terminateSession 必须在 running 态也触发 close（design §1 隐患 1 止血目标）。
    const { driver, closeSpy } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    expect(sm.get('sess-kill')!.status).toBe('running');

    await sm.end('sess-kill');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-kill')!.status).toBe('ended');
  });
});

// ── AC-2：interrupt 不触发 close（守 D-001@v2「打断本轮」软语义）──────────────

describe('task-03 AC-2: interrupt 不触发 close（D-001@v2 软中断，session 保持 active）', () => {
  it('interrupt(running) → 只调 driver.interrupt(query)；close 一次都不调', async () => {
    const { driver, interruptSpy, closeSpy } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    expect(sm.get('sess-kill')!.status).toBe('running');

    const ok = await sm.interrupt('sess-kill');

    expect(ok).toBe(true);
    // interrupt 通道触发
    expect(driver.interrupt).toHaveBeenCalledTimes(1);
    expect(interruptSpy).toHaveBeenCalledTimes(1);
    // 关键守卫：close 通道一次都不触发（打断本轮 ≠ 杀进程，可续轮）
    expect(closeSpy).not.toHaveBeenCalled();
    // status 仍 running（spike D1：终态由后续 SDK result 收敛，interrupt 本身不改 status）
    expect(sm.get('sess-kill')!.status).toBe('running');
  });

  it('interrupt 后 session 仍可 inject 续轮（close 没被调 → SDK query 未结束）', async () => {
    const { driver, closeSpy, emitResult } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    await sm.interrupt('sess-kill');
    expect(closeSpy).not.toHaveBeenCalled();

    // SDK 吐 interrupt result → status 回 active（spike D1 续轮语义）
    emitResult({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      num_turns: 1,
      duration_ms: 1,
      duration_api_ms: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      errors: ['interrupted'],
      session_id: 'sdk-sess',
      uuid: 'ri',
    } as unknown as SDKResultMessage);
    expect(sm.get('sess-kill')!.status).toBe('active');
    expect(closeSpy).not.toHaveBeenCalled();

    // 续轮 inject 不抛（session 未进 ended/failed）
    const res = await sm.inject('sess-kill', 'next turn', 'run-2');
    expect(res.runId).toBe('run-2');
    // 全程 close 都没被调
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('interrupt(active 无 running turn) no-op → close 不调、driver.interrupt 也不调', async () => {
    const { driver, closeSpy, emitResult } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    emitResult(resultSuccess()); // → active
    expect(sm.get('sess-kill')!.status).toBe('active');

    const ok = await sm.interrupt('sess-kill');

    expect(ok).toBe(false);
    expect(driver.interrupt).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

// ── AC-3：close 抛异常时 end/fail 不冒泡（R-01 兜底）──────────────────────────

describe('task-03 AC-3 / R-01: close 抛异常 → end/fail 不向上冒泡（_terminateSession try/catch）', () => {
  it('query.close 抛错时 end 不抛、status=ended、onSessionEnd 仍调用', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    closeSpy.mockImplementation(() => {
      throw new Error('query.close boom (SDK bad state)');
    });
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // 不抛（R-01：close 异常被 _terminateSession 的 try/catch 兜住）
    await expect(sm.end('sess-kill')).resolves.toBeUndefined();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // 终态语义不因 close 抛错丢失
    expect(sm.get('sess-kill')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'ended');
  });

  it('query.close 抛错时 fail 不抛、status=failed、onSessionEnd(failed) 仍调用', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    closeSpy.mockImplementation(() => {
      throw new Error('query.close boom on fail path');
    });
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    await expect(sm.fail('sess-kill')).resolves.toBeUndefined();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-kill')!.status).toBe('failed');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'failed');
  });
});

// ── FR-07 brownfield：driver 不实现 close → close?.() no-op 不报错 ─────────────

describe('task-03 FR-07: driver 未实现 close 时 end/fail 不报错（可选契约 close?.()）', () => {
  it('fakeQuery 无 close 方法 → end 正常完成、status=ended', async () => {
    const { driver } = makeMockDriverWithoutClose();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    await expect(sm.end('sess-kill')).resolves.toBeUndefined();
    expect(sm.get('sess-kill')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'ended');
  });

  it('fakeQuery 无 close 方法 → fail 正常完成、status=failed', async () => {
    const { driver } = makeMockDriverWithoutClose();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    await expect(sm.fail('sess-kill')).resolves.toBeUndefined();
    expect(sm.get('sess-kill')!.status).toBe('failed');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-kill', 'failed');
  });
});

// ── 幂等：终态后再次 end/fail 不再调 close（避免重复 kill 链触发）──────────────

describe('task-03 幂等: 已终态 session 再次 end/fail 不再触发 close', () => {
  it('end 后再 end → close 只调一次（幂等，_terminateSession 早返回）', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    await sm.end('sess-kill');
    await sm.end('sess-kill'); // 幂等：status 已 ended，早返回

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('fail 后再 fail → close 只调一次', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    await sm.fail('sess-kill');
    await sm.fail('sess-kill');

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('end 后 fail（或反之）→ close 只调一次（终态互斥）', async () => {
    const { driver, closeSpy } = makeMockDriverWithClose();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    await sm.end('sess-kill');
    await sm.fail('sess-kill'); // 已 ended，幂等早返回，不再走 _terminateSession

    expect(closeSpy).toHaveBeenCalledTimes(1);
    // 首次终态 ended 不被 fail 覆盖
    expect(sm.get('sess-kill')!.status).toBe('ended');
  });
});
