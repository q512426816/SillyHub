// tests/interactive/claude-driver-close-contract.test.ts
// task-03 / Phase1：ClaudeDriverHandle.close 契约测试
//（change 2026-08-05-daemon-kill-channel-unify / decisions D-003 / D-004 / R-01）。
//
// AC-3：``ClaudeDriverHandle.close`` 必须调用底层 ``query.close()``（D-003：接通 SDK
// 已有 kill 链 close → stdin EOF → 2s → SIGTERM → 5s → SIGKILL，sdk.mjs ``vB=2000``）。
//
// impl 决策（claude-sdk-driver.ts 注释 L256-270）：``close`` 方法本身 **不** 吞异常——
// ``close: () => { query.close(); }``；异常由调用方 ``SessionManager._terminateSession``
// 的 try/catch 兜底（R-01，见 session-manager-terminate-close.test.ts AC-3）。故本文件
// 只断言「close 调 query.close()」这条调用契约，异常吞没的断言在 SessionManager 层覆盖。
//
// 与既有测试分工（不重复）：
//   - claude-sdk-driver.test.ts：start/consume/interrupt/executable 解析，**未覆盖 close**
//    （其 makeFakeQuery 不挂 close；本文件补 close 契约）。
//
// 策略：vi.mock SDK 的 ``query`` 导出，返回带 ``close`` spy 的 fakeQuery；调真实
// ``ClaudeSdkDriver.start`` 拿 handle，再调 ``handle.close()`` 断言 query.close 被调。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UserTurnInput } from '../../src/interactive/driver.js';

// ── mock node:fs：existsSync / readFileSync（claude-sdk-driver.ts start 内解析 exe）──
const { fsExists, fsRead } = vi.hoisted(() => ({
  fsExists: vi.fn((p: unknown) => false),
  fsRead: vi.fn((_p: unknown) => '' as unknown as Buffer),
}));
vi.mock('node:fs', () => ({
  existsSync: fsExists,
  readFileSync: fsRead,
}));

// ── mock SDK：query 工厂返回带 close spy 的 fakeQuery ─────────────────────────
const { mockQuery, setMockQueryImpl } = vi.hoisted(() => {
  const defaultQuery = (): Query =>
    ({
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: async () => {},
      close: () => {},
    }) as unknown as Query;
  let impl:
    | ((params: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options?: Record<string, unknown>;
      }) => Query)
    | null = null;
  const mockQuery = vi.fn(
    (params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Record<string, unknown>;
    }): Query => (impl ? impl(params) : defaultQuery()),
  );
  return {
    mockQuery,
    setMockQueryImpl: (
      fn:
        | ((params: {
            prompt: string | AsyncIterable<SDKUserMessage>;
            options?: Record<string, unknown>;
          }) => Query)
        | null,
    ) => {
      impl = fn;
    },
  };
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type { ClaudeDriverHandle } from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助 ─────────────────────────────────────────────────────────────────────

const REAL_EXE = 'C:\\bin\\claude.exe';

/** 空输入 AsyncIterable（start 只需拿到句柄，不消费 prompt）。 */
function emptyInput(): AsyncIterable<UserTurnInput> {
  return {
    [Symbol.asyncIterator]: () =>
      (async function* (): AsyncGenerator<UserTurnInput, void> {})(),
  };
}

/** 构造带 ``close`` spy 的 fakeQuery，并注入 SDK mock 返回它。 */
function makeQueryWithCloseSpy(): { query: Query; closeSpy: ReturnType<typeof vi.fn> } {
  const closeSpy = vi.fn(() => {});
  const query = {
    [Symbol.asyncIterator]: () =>
      (async function* (): AsyncGenerator<SDKMessage, void> {})(),
    interrupt: vi.fn(async () => {}),
    close: closeSpy,
  } as unknown as Query;
  setMockQueryImpl(() => query);
  return { query, closeSpy };
}

beforeEach(() => {
  mockQuery.mockClear();
  setMockQueryImpl(null);
  fsExists.mockReset();
  fsRead.mockReset();
  fsExists.mockReturnValue(true); // REAL_EXE 默认存在
  fsRead.mockReturnValue('' as unknown as Buffer);
});

// ── AC-3：ClaudeDriverHandle.close → query.close() ───────────────────────────

describe('task-03 AC-3: ClaudeDriverHandle.close 调用 query.close()（D-003 接通 SDK kill 链）', () => {
  it('start 返回的 handle 含 close 方法（契约存在性）', async () => {
    const { query } = makeQueryWithCloseSpy();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });
    expect(typeof handle.close).toBe('function');
    // handle 仍携带底层 query（interrupt/consume 用，契约不回归）
    expect((handle as ClaudeDriverHandle).query).toBe(query);
    expect(handle.provider).toBe('claude');
  });

  it('handle.close() → query.close() 调一次（D-003 接通 SDK kill 链入口）', async () => {
    const { closeSpy } = makeQueryWithCloseSpy();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });

    expect(closeSpy).not.toHaveBeenCalled();
    handle.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('handle.close() 多次调用 → query.close() 每次都调（无隐式幂等守卫，由 SDK close 自身幂等）', async () => {
    // impl：``close: () => { query.close(); }`` 无 if-guard；是否真重复 kill 由 SDK
    // close 内部状态机决定（已 closed 的 query 再调为 no-op）。本断言守护「driver
    // 层不吞调用」，让 SessionManager 层的幂等（_terminateSession 早返回）独立负责。
    const { closeSpy } = makeQueryWithCloseSpy();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });

    handle.close();
    handle.close();
    handle.close();
    expect(closeSpy).toHaveBeenCalledTimes(3);
  });

  it('handle.close() 调用的是 start 创建句柄时绑定的同一个 query（绑定正确，不串句柄）', async () => {
    // 两次 start 各拿独立 query + close spy，调 A 的 close 不该触发 B 的 query.close。
    const { query: queryA, closeSpy: closeA } = makeQueryWithCloseSpy();
    const driver = new ClaudeSdkDriver();
    const handleA = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });

    // 第二次 start 用新 query（覆盖 mock impl）
    const closeB = vi.fn(() => {});
    const queryB = {
      [Symbol.asyncIterator]: () =>
        (async function* (): AsyncGenerator<SDKMessage, void> {})(),
      interrupt: vi.fn(async () => {}),
      close: closeB,
    } as unknown as Query;
    setMockQueryImpl(() => queryB);
    const handleB = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });

    handleA.close();
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect((handleA as ClaudeDriverHandle).query).toBe(queryA);
    expect((handleB as ClaudeDriverHandle).query).toBe(queryB);
  });

  it('handle.close 抛出的异常不被 driver 层吞（R-01 决策：由 _terminateSession 兜底）', async () => {
    // impl 注释 L268「本方法不吞错」：close 自身不 catch；本测试守护此契约——
    // 异常向上抛由调用方决定（SessionManager._terminateSession 包 try/catch，
    // 见 session-manager-terminate-close.test.ts AC-3；若未来直接裸调 handle.close
    // 必须自行兜底）。
    const closeSpy = vi.fn(() => {
      throw new Error('sdk close internal error');
    });
    const query = {
      [Symbol.asyncIterator]: () =>
        (async function* (): AsyncGenerator<SDKMessage, void> {})(),
      interrupt: vi.fn(async () => {}),
      close: closeSpy,
    } as unknown as Query;
    setMockQueryImpl(() => query);

    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
    });

    expect(() => handle.close()).toThrow('sdk close internal error');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
