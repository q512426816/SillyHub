// tests/interactive/session-manager-driver-registry.test.ts
// task-02 TDD step 1：SessionManager provider driver registry 接线（D-001/D-009/FR-01/FR-10）。
//
// 覆盖（蓝图 task-02「TDD 步骤 1」+ AC-02.1..02.4 + 边界 6）：
//   1.1 new SessionManager({ drivers: { claude } }) 构造不抛；create({provider:'claude'}) 调 claude driver.start
//   1.2 兼容旧入参 new SessionManager({ driver }) → create claude 成功（D-009 向后兼容，cli.ts 零改动）
//   1.3 drivers.codex 注册 + create({provider:'codex'}) 调 codex driver.start，不抛 UnsupportedProviderError（FR-01）
//   1.4 仅注册 claude + create({provider:'codex'}) → 抛 UnsupportedProviderError（D-001 driver 未注册）
//   1.5 同时传 deps.driver 和 deps.drivers.claude → drivers.claude 优先（边界 6）
//
// mock driver 实现 InteractiveDriver 契约（driver.ts）：start/consume/interrupt；
// start 返回带 provider 标记的 InteractiveDriverHandle，便于断言路由正确。

import { describe, it, expect, vi } from 'vitest';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { UnsupportedProviderError } from '../../src/interactive/types.js';

// ── fake driver 工厂 ──────────────────────────────────────────────────────────

/**
 * 构造一个实现了 InteractiveDriver 契约的 fake driver。
 * - start：记录被调用（spy），返回带 provider 标记的 handle。
 * - consume：捕获 callbacks（测试可注入 result/message），不自动 yield。
 * - interrupt：spy，默认返回 true（handle 非空）。
 */
function makeFakeDriver(provider: 'claude' | 'codex'): {
  driver: InteractiveDriver;
  handle: InteractiveDriverHandle;
} {
  const handle: InteractiveDriverHandle = {
    provider,
    processId: 42_001,
    close: vi.fn(async () => {}),
  };
  let captured: InteractiveDriverCallbacks | null = null;
  const driver: InteractiveDriver = {
    start: vi.fn(
      async (
        _input: AsyncIterable<UserTurnInput>,
        _opts: unknown,
      ): Promise<InteractiveDriverHandle> => {
        return handle;
      },
    ),
    consume: vi.fn(
      async (
        _h: InteractiveDriverHandle,
        cb: InteractiveDriverCallbacks,
      ): Promise<void> => {
        captured = cb;
        // 不自动 yield；测试按需注入。
      },
    ),
    interrupt: vi.fn(async (_h: InteractiveDriverHandle | null) => true),
  };
  // 把 captured 挂到 driver 上便于测试取用（类型断言绕过 readonly）。
  (driver as unknown as { _captured: typeof captured })._captured = captured;
  return { driver, handle };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const baseClaudeInput = {
  sessionId: 'sess-claude-1',
  leaseId: 'lease-1',
  claimToken: 'token-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: '/tmp',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: '/fake/claude',
};

const baseCodexInput = {
  sessionId: 'sess-codex-1',
  leaseId: 'lease-2',
  claimToken: 'token-2',
  firstPrompt: 'hi codex',
  firstRunId: 'run-2',
  cwd: '/tmp',
  provider: 'codex' as const,
  pathToClaudeCodeExecutable: '/fake/codex',
};

describe('task-02 driver registry (D-001/D-009)', () => {
  it('1.1 drivers.claude registry: create({provider:claude}) 调 claude driver.start', async () => {
    const { driver: claudeDriver } = makeFakeDriver('claude');
    const sm = new SessionManager(
      { drivers: { claude: claudeDriver }, ...makeDeps() },
      {},
    );
    await sm.create(baseClaudeInput);
    expect(claudeDriver.start).toHaveBeenCalledTimes(1);
    expect(claudeDriver.consume).toHaveBeenCalledTimes(1);
  });

  it('1.2 兼容旧入参 deps.driver（非 drivers registry）：create claude 成功', async () => {
    // 旧 cli.ts: new SessionManager({ driver: new ClaudeSdkDriver(), ... })
    // task-02 构造函数把 deps.driver 映射到 _drivers.claude（D-009 向后兼容）。
    // 这里用 fake driver 扮演 ClaudeSdkDriver（鸭子类型满足 InteractiveDriver）。
    const { driver } = makeFakeDriver('claude');
    // deps.driver 在类型上仍要求 ClaudeSdkDriver，但运行时 duck-type 兼容。
    const sm = new SessionManager(
      { driver: driver as unknown as never, ...makeDeps() },
      {},
    );
    await sm.create(baseClaudeInput);
    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(driver.consume).toHaveBeenCalledTimes(1);
  });

  it('1.3 drivers.codex 注册 + create({provider:codex}) 调 codex driver，不抛 UnsupportedProviderError (FR-01)', async () => {
    const { driver: codexDriver } = makeFakeDriver('codex');
    const sm = new SessionManager(
      { drivers: { codex: codexDriver }, ...makeDeps() },
      {},
    );
    await sm.create(baseCodexInput);
    expect(codexDriver.start).toHaveBeenCalledTimes(1);
    expect(codexDriver.consume).toHaveBeenCalledTimes(1);
  });

  it('1.4 仅注册 claude + create({provider:codex}) → UnsupportedProviderError (D-001 driver 未注册)', async () => {
    const { driver: claudeDriver } = makeFakeDriver('claude');
    const sm = new SessionManager(
      { drivers: { claude: claudeDriver }, ...makeDeps() },
      {},
    );
    await expect(sm.create(baseCodexInput)).rejects.toBeInstanceOf(
      UnsupportedProviderError,
    );
    // claude driver 不应被误调（错误在写 store 前）。
    expect(claudeDriver.start).not.toHaveBeenCalled();
  });

  it('1.5 同时传 deps.driver 和 deps.drivers.claude → drivers.claude 优先（边界 6）', async () => {
    const { driver: compatDriver } = makeFakeDriver('claude');
    const { driver: registryDriver } = makeFakeDriver('claude');
    const sm = new SessionManager(
      {
        driver: compatDriver as unknown as never,
        drivers: { claude: registryDriver },
        ...makeDeps(),
      },
      {},
    );
    await sm.create(baseClaudeInput);
    // drivers.claude 优先；compat driver 不被调。
    expect(registryDriver.start).toHaveBeenCalledTimes(1);
    expect(compatDriver.start).not.toHaveBeenCalled();
  });
});
