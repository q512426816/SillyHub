// tests/interactive/session-manager-provider-routing.test.ts
// task-02 TDD step 1：create/restore/interrupt/consume 按 provider 路由（FR-03/FR-06/D-001/D-007）。
//
// 覆盖（蓝图 task-02「TDD 步骤 1」+ AC-02.5..02.8 + 边界 3/5）：
//   2.1 codex session interrupt() 调 codex driver.interrupt(handle)，不调 claude driver.interrupt（边界 3 spy 断言）
//   2.2 restoreAndReconnect({provider:codex, agentSessionId:'thread-1'}) 调 codex driver.start（FR-06）
//   2.3 restoreAndReconnect({provider:codex, agentSessionId:''}) 抛错且不调 driver.start（边界 5 D-007 不伪造 thread）
//   2.4 codex session 的 _runConsume 调 codex driver.consume(handle)（通过 create 后断言 consume 被调）
//   2.5（FR-10 回归）claude session interrupt 调 claude driver，不调 codex driver（不串 provider）
//
// 关键：同时注册 claude + codex 两个 fake driver，断言 interrupt/consume 只命中 session 归属的 driver。

import { describe, it, expect, vi } from 'vitest';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import type { PersistedSessionRecord } from '../../src/interactive/types.js';
import { SessionManager } from '../../src/interactive/session-manager.js';

function makeFakeDriver(provider: 'claude' | 'codex'): {
  driver: InteractiveDriver;
  handle: InteractiveDriverHandle;
  captured: () => InteractiveDriverCallbacks | null;
} {
  const handle: InteractiveDriverHandle = {
    provider,
    processId: 9_000 + (provider === 'codex' ? 1 : 0),
    close: vi.fn(async () => {}),
  };
  let captured: InteractiveDriverCallbacks | null = null;
  const driver: InteractiveDriver = {
    start: vi.fn(async () => handle),
    consume: vi.fn(async (_h, cb: InteractiveDriverCallbacks) => {
      captured = cb;
    }),
    interrupt: vi.fn(async (_h: InteractiveDriverHandle | null) => true),
  };
  return { driver, handle, captured: () => captured };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const baseCodexInput = {
  sessionId: 'sess-codex-x',
  leaseId: 'lease-x',
  claimToken: 'token-x',
  firstPrompt: 'hi',
  firstRunId: 'run-x',
  cwd: '/tmp',
  provider: 'codex' as const,
  pathToClaudeCodeExecutable: '/fake/codex',
};

describe('task-02 provider routing (FR-03/FR-06/D-001/D-007)', () => {
  it('2.1 codex session interrupt() 调 codex driver.interrupt，不调 claude driver（边界 3）', async () => {
    const claude = makeFakeDriver('claude');
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      {
        drivers: { claude: claude.driver, codex: codex.driver },
        ...makeDeps(),
      },
      {},
    );
    // codex session 进入 running（create 后 status=running）。
    await sm.create(baseCodexInput);
    expect(codex.driver.start).toHaveBeenCalledTimes(1);

    const ok = await sm.interrupt(baseCodexInput.sessionId);
    expect(ok).toBe(true);
    // 关键断言：codex driver.interrupt 被调，claude driver.interrupt 不被调。
    expect(codex.driver.interrupt).toHaveBeenCalledTimes(1);
    expect(claude.driver.interrupt).not.toHaveBeenCalled();
  });

  it('2.2 restoreAndReconnect({provider:codex, agentSessionId}) 调 codex driver.start（FR-06）', async () => {
    const claude = makeFakeDriver('claude');
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      {
        drivers: { claude: claude.driver, codex: codex.driver },
        ...makeDeps(),
      },
      {},
    );
    const record: PersistedSessionRecord = {
      sessionId: 'sess-restore-codex',
      leaseId: 'lease-r',
      agentSessionId: 'codex-thread-1',
      cwd: '/tmp',
      provider: 'codex',
      turnCount: 0,
      lastActiveAt: Date.now(),
    };
    await sm.restoreAndReconnect(record);
    expect(codex.driver.start).toHaveBeenCalledTimes(1);
    expect(claude.driver.start).not.toHaveBeenCalled();
  });

  it('2.3 restoreAndReconnect 缺 agentSessionId（thread id）抛错且不调 driver.start（边界 5 D-007）', async () => {
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      { drivers: { codex: codex.driver }, ...makeDeps() },
      {},
    );
    const record: PersistedSessionRecord = {
      sessionId: 'sess-restore-empty',
      leaseId: 'lease-r2',
      agentSessionId: '', // 空 thread id
      cwd: '/tmp',
      provider: 'codex',
      turnCount: 0,
      lastActiveAt: Date.now(),
    };
    await expect(sm.restoreAndReconnect(record)).rejects.toThrow(
      /agentSessionId/i,
    );
    expect(codex.driver.start).not.toHaveBeenCalled();
  });

  it('2.4 codex session _runConsume 调 codex driver.consume(handle)（按 provider 路由 consume）', async () => {
    const claude = makeFakeDriver('claude');
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      {
        drivers: { claude: claude.driver, codex: codex.driver },
        ...makeDeps(),
      },
      {},
    );
    await sm.create(baseCodexInput);
    // consume 由 create 内 fire（_runConsume）；按 provider 命中 codex。
    expect(codex.driver.consume).toHaveBeenCalledTimes(1);
    expect(claude.driver.consume).not.toHaveBeenCalled();
  });

  it('2.5（FR-10 回归）claude session interrupt 调 claude driver，不调 codex driver（不串 provider）', async () => {
    const claude = makeFakeDriver('claude');
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      {
        drivers: { claude: claude.driver, codex: codex.driver },
        ...makeDeps(),
      },
      {},
    );
    await sm.create({
      ...baseCodexInput,
      sessionId: 'sess-claude-y',
      provider: 'claude',
    });
    const ok = await sm.interrupt('sess-claude-y');
    expect(ok).toBe(true);
    expect(claude.driver.interrupt).toHaveBeenCalledTimes(1);
    expect(codex.driver.interrupt).not.toHaveBeenCalled();
  });

  it('2.6 codex session interrupt 不命中 claude driverHandle（codex handle provider 标记隔离）', async () => {
    // 额外保险：codex session 传给 codex.interrupt 的 handle.provider === 'codex'。
    const claude = makeFakeDriver('claude');
    const codex = makeFakeDriver('codex');
    const sm = new SessionManager(
      {
        drivers: { claude: claude.driver, codex: codex.driver },
        ...makeDeps(),
      },
      {},
    );
    await sm.create(baseCodexInput);
    await sm.interrupt(baseCodexInput.sessionId);
    const arg = (codex.driver.interrupt as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as InteractiveDriverHandle | undefined;
    expect(arg).toBeDefined();
    expect(arg?.provider).toBe('codex');
  });
});
