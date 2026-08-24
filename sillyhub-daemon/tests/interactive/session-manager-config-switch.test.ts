// tests/interactive/session-manager-config-switch.test.ts
// task-08（2026-08-14-sessions-portal / FR-05 / D-012@v1 / Grill C-07）：
// daemon 统一热切换内核 —— _reloadSession 抽取 + SessionSwitchConfigPayload +
// reloadWithConfig / markPendingConfigSwitch + 持久化 config 快照。
//
// 覆盖（蓝图 implementation / acceptance）：
//   (1) reload 内核抽取后 reloadWithProvider 行为回归不变（零语义漂移）：
//       close 旧 query / driver.start resume / env 替换（CLAUDE_CONFIG_DIR 隔离）/
//       失败回滚 / codex 仍抛 not-yet-supported / SessionNotFoundError。
//   (2) reloadWithConfig：resume + 新 systemPrompt（preset+append）+ 新 providerConfig
//       （layer 0 env 注入）+ 切换轮 prompt 喂入（status/currentRunId/claimToken）；
//       profile=null / providerConfig=null = 保持现状；切到无人格清空；失败回滚。
//   (3) markPendingConfigSwitch：idle 立即执行（不写标记）/ running 挂至 _onResult
//       turn 边界（事件注入 emitResult，不真等定时器）/ 覆盖写幂等 / 不存在抛错。
//   (4) Codex reloadWithConfig：只切 providerConfig 不注人格（opts 无 systemPrompt），
//       driverHandle 替换 + 旧句柄 close + resume=threadId。
//   (5) 持久化：reload 后 snapshotPersistable 带 systemPrompt/providerConfig 快照；
//       restoreAndReconnect 用快照重建 env + systemPrompt；旧 sessions.json 无 config
//       字段缺省容错（design §9）。
//
// 策略（对齐 session-manager-reload-provider.test.ts）：
//   - mock driver（start 每次返回新 fake 句柄便于断言替换；consume 捕获回调注入
//     system/init / thread_started / turn result，无真实定时器等待）。
//   - 用真实 buildSpawnEnv（不 mock）验证 env 层级行为；测试前清 process.env 的
//     ANTHROPIC_* 残留防宿主机污染断言。
//   - AAA 结构；断言真实副作用（state 替换 / start 调用参数 / close 调用），
//     不 mock 被测方法自身（markPendingConfigSwitch 状态机用 spy 替身 reloadWithConfig
//     ——被测对象是标记路由本身）。

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { JsonSessionPersistence } from '../../src/interactive/session-store-persistence.js';
import type { PersistedSessionRecord } from '../../src/interactive/types.js';
import {
  SessionNotActiveError,
  SessionNotFoundError,
} from '../../src/interactive/types.js';
import type { ProviderConfig } from '../../src/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { InteractiveDriver } from '../../src/interactive/driver.js';

// ── 辅助构造（对齐 session-manager-reload-provider.test.ts）────────────────────

/** claude mock driver：每次 start 返回新 fakeQuery；consume 捕获回调供事件注入。 */
function makeMockClaudeDriver() {
  const startCalls: Array<{ input: unknown; opts: Record<string, unknown> }> = [];
  const closeSpies: ReturnType<typeof vi.fn>[] = [];
  let capturedCallbacks: ConsumeCallbacks | null = null;

  const makeFakeQuery = (): Query => {
    const closeSpy = vi.fn(() => {});
    closeSpies.push(closeSpy);
    return {
      interrupt: vi.fn(async () => {}),
      close: closeSpy,
    } as unknown as Query;
  };

  const driver = {
    start: vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCalls.push({ input, opts: opts as Record<string, unknown> });
        return makeFakeQuery();
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
    startCalls,
    /** 第 N 次（0-based）start 返回的句柄对应 close spy。 */
    closeSpyAt: (i: number) => closeSpies[i],
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

/**
 * codex mock driver（InteractiveDriver 形态）：start 返回 {close} 句柄，
 * consume 捕获 onTurnMessage/onTurnResult 供 thread_started / turn result 注入。
 */
function makeMockCodexDriver() {
  const startCalls: Array<{ input: unknown; opts: Record<string, unknown> }> = [];
  const closeSpies: ReturnType<typeof vi.fn>[] = [];
  let captured: {
    onTurnMessage?: (m: Record<string, unknown>) => void | Promise<void>;
    onTurnResult?: (r: Record<string, unknown>) => void | Promise<void>;
  } | null = null;

  const driver = {
    start: vi.fn(
      async (
        input: AsyncIterable<unknown>,
        opts: Record<string, unknown>,
      ): Promise<{ close: () => void }> => {
        startCalls.push({ input, opts });
        const closeSpy = vi.fn(() => {});
        closeSpies.push(closeSpy);
        return { close: closeSpy };
      },
    ),
    consume: vi.fn(
      async (
        _h: unknown,
        cb: {
          onTurnMessage?: (m: Record<string, unknown>) => void | Promise<void>;
          onTurnResult?: (r: Record<string, unknown>) => void | Promise<void>;
        },
      ): Promise<void> => {
        captured = cb;
      },
    ),
    interrupt: vi.fn(async () => true),
  } as unknown as InteractiveDriver;

  return {
    driver,
    startCalls,
    closeSpyAt: (i: number) => closeSpies[i],
    emitMessage: (m: Record<string, unknown>) => captured?.onTurnMessage?.(m),
    emitResult: (r: Record<string, unknown>) => captured?.onTurnResult?.(r),
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
  sessionId: 'sess-cfg',
  leaseId: 'lease-cfg',
  claimToken: 'claim-orig',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r-cfg',
  } as unknown as SDKResultMessage;
}

function systemInitMessage(sid = 'sdk-sess'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sid,
  } as unknown as SDKMessage;
}

/** Codex thread_started flat message（_onMessage 提取 threadId 写 agentSessionId）。 */
function threadStartedMessage(threadId: string): Record<string, unknown> {
  return {
    event_type: 'system',
    content: '',
    metadata: { subtype: 'thread_started' },
    session_id: threadId,
  };
}

function newProviderConfig(baseUrl = 'https://new.example.com'): ProviderConfig {
  return {
    agent_kind: 'claude',
    base_url: baseUrl,
    api_key: 'sk-new-xxx',
    auth_field: 'ANTHROPIC_AUTH_TOKEN',
    model: 'glm-4.5',
  };
}

/** 切换 payload fixture（design §7.2 SessionSwitchConfigPayload）。 */
function switchPayload(overrides: Partial<{
  runId: string;
  claimToken: string;
  prompt: string;
  systemPrompt: string | undefined;
  providerConfig: ProviderConfig | null;
}> = {}): {
  sessionId: string;
  runId: string;
  claimToken: string;
  prompt: string;
  profile: { systemPrompt?: string; mcpRefs?: string[]; skillRefs?: string[] } | null;
  providerConfig: ProviderConfig | null;
} {
  return {
    sessionId: BASE_INPUT.sessionId,
    runId: overrides.runId ?? 'run-switch-1',
    claimToken: overrides.claimToken ?? 'claim-switched',
    prompt: overrides.prompt ?? '继续，用新配置回答',
    profile:
      overrides.systemPrompt === undefined && !overrides.providerConfig && !('systemPrompt' in overrides)
        ? { systemPrompt: '你是新档案人格', mcpRefs: ['mcp-a'], skillRefs: ['skill-x'] }
        : { systemPrompt: overrides.systemPrompt },
    providerConfig:
      overrides.providerConfig === undefined
        ? newProviderConfig()
        : overrides.providerConfig,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** 白盒读取 state（与现有 session-manager.* test 同款 _store 访问）。 */
function readState(sm: SessionManager, sessionId: string) {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  return store.get(sessionId) as
    | {
        query?: Query;
        driverHandle?: { close?: () => void };
        env?: NodeJS.ProcessEnv;
        agentSessionId?: string;
        systemPrompt?: string;
        providerConfig?: ProviderConfig | null;
        mcpRefs?: string[];
        skillRefs?: string[];
        pendingConfigSwitch?: { payload: unknown };
        status: string;
        currentRunId?: string;
        claimToken: string;
      }
    | undefined;
}

/** 清宿主机 process.env 残留，防 buildSpawnEnv 层 3 污染断言。 */
const SENSITIVE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_OAUTH_TOKEN',
] as const;
const savedEnv = new Map<string, string | undefined>();
beforeAll(() => {
  for (const k of SENSITIVE_ENV_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── (1) reload 内核抽取回归：reloadWithProvider 行为不变 ──────────────────────

describe('task-08 / reload 内核抽取回归（reloadWithProvider 零语义漂移）', () => {
  it('REG-1: 成功 reload —— close 旧 query + start 二次 + resume + env 隔离 + 状态不破坏', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess-reg'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const oldQuery = readState(sm, BASE_INPUT.sessionId)!.query;

    // Act
    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    // Assert：与重构前内联实现一致（reload-provider.test AC-1/AC-2 关键子集）。
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(1);
    expect(mock.driver.start).toHaveBeenCalledTimes(2);
    expect(mock.startCalls[1].opts['resume']).toBe('sdk-sess-reg');
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.query).not.toBe(oldQuery);
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(mock.driver.consume).toHaveBeenCalledTimes(2);
    expect(state.status).toBe('active');
  });

  it('REG-2: provider_config=null → 仍保持 daemon 隔离 CLAUDE_CONFIG_DIR（ql-20260807-002）', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // Act
    await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

    // Assert
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(state.status).toBe('active');
  });

  it('REG-3: driver.start 抛错 → 回滚旧 query/env + session 不破坏 + 错误重抛', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const originalStart = mock.driver.start;
    let call = 0;
    mock.driver.start = vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        call += 1;
        if (call === 1) {
          return (originalStart as unknown as (
            i: AsyncIterable<SDKUserMessage>,
            o: StartOptions,
          ) => Query)(input, opts);
        }
        throw new Error('simulated spawn EINVAL');
      },
    ) as unknown as ClaudeSdkDriver['start'];
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const before = readState(sm, BASE_INPUT.sessionId)!;

    // Act + Assert
    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig()),
    ).rejects.toThrow(/simulated spawn EINVAL/);
    const after = readState(sm, BASE_INPUT.sessionId)!;
    expect(after.query).toBe(before.query);
    expect(after.env).toBe(before.env);
    expect(sm.get(BASE_INPUT.sessionId)).toBeDefined();
    expect(after.status).toBe('active');
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(0);
  });

  it('REG-4: provider 非 claude → reloadWithProvider 仍抛 not-yet-supported（既有契约保留）', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    const state = readState(sm, BASE_INPUT.sessionId)!;
    (state as { provider: 'claude' | 'codex' }).provider = 'codex';

    // Act + Assert
    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, null),
    ).rejects.toThrow(/provider codex not yet supported/);
  });

  it('REG-5: session 不存在 → SessionNotFoundError', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // Act + Assert
    await expect(sm.reloadWithProvider('no-such', null)).rejects.toThrow(
      SessionNotFoundError,
    );
  });
});

// ── (2) reloadWithConfig（claude 路径）────────────────────────────────────────

describe('task-08 / reloadWithConfig（FR-05 / D-012@v1，claude）', () => {
  it('CFG-1: 切档案+供应商 —— resume + 新 systemPrompt preset+append + provider env + 喂切换轮 prompt', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess-cfg1'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const oldQuery = readState(sm, BASE_INPUT.sessionId)!.query;
    const cfg = newProviderConfig();

    // Act
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-switch-9',
      claimToken: 'claim-new',
      prompt: '用新配置继续',
      profile: { systemPrompt: '你是新档案人格', mcpRefs: ['mcp-a'], skillRefs: ['skill-x'] },
      providerConfig: cfg,
    });

    // Assert —— reload 内核：resume + close 旧句柄 + 新配置 driverOpts。
    expect(mock.driver.start).toHaveBeenCalledTimes(2);
    expect(mock.startCalls[1].opts['resume']).toBe('sdk-sess-cfg1');
    expect(mock.startCalls[1].opts['systemPrompt']).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '你是新档案人格',
    });
    // provider_config layer 0 注入（真实 buildSpawnEnv + claude injector）。
    const reloadEnv = mock.startCalls[1].opts['env'] as NodeJS.ProcessEnv;
    expect(reloadEnv.ANTHROPIC_BASE_URL).toBe('https://new.example.com');
    expect(reloadEnv.ANTHROPIC_AUTH_TOKEN).toBe('sk-new-xxx');
    expect(reloadEnv.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(1);
    expect(mock.closeSpyAt(1)).not.toHaveBeenCalled();

    // Assert —— state：query 替换 + config 快照 + profile 承载字段。
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.query).not.toBe(oldQuery);
    expect(state.systemPrompt).toBe('你是新档案人格');
    expect(state.providerConfig).toBe(cfg);
    expect(state.mcpRefs).toEqual(['mcp-a']);
    expect(state.skillRefs).toEqual(['skill-x']);

    // Assert —— 切换轮 prompt 喂入：runId/status/claimToken（对齐 inject 语义）。
    expect(state.status).toBe('running');
    expect(state.currentRunId).toBe('run-switch-9');
    expect(state.claimToken).toBe('claim-new');
  });

  it('CFG-2: profile=null & providerConfig=null —— 保持现人格 + 切回本机（ql-20260824-016 新契约）', async () => {
    // Arrange：create 带人格 → 首次切换到供应商 A → 二次切换 providerConfig=null。
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, systemPrompt: '原人格' });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-sw-1',
      claimToken: 'c1',
      prompt: 'p1',
      profile: null,
      providerConfig: newProviderConfig('https://a.example.com'),
    });
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('active');

    // Act：二次切换 providerConfig=null（后端「切回本机默认」正是下发 null——
    // 原 ?? 塌缩成沿用旧供应商，实测切回后 /model 仍显示旧供应商模型）。
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-sw-2',
      claimToken: 'c2',
      prompt: 'p2',
      profile: null,
      providerConfig: null,
    });

    // Assert —— 人格保留并重新注入（reload 重建 driverOpts 必须重传）。
    expect(mock.startCalls).toHaveLength(3);
    expect(mock.startCalls[2].opts['systemPrompt']).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '原人格',
    });
    // 供应商清空：env 无供应商注入（回本机凭证链）。
    const env3 = mock.startCalls[2].opts['env'] as NodeJS.ProcessEnv;
    expect(env3.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env3.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.systemPrompt).toBe('原人格');
    expect(state.providerConfig).toBeNull();
  });

  it('CFG-2b: providerConfig 字段缺席（undefined）→ 不切供应商，保持现值', async () => {
    // Arrange：切到供应商 A 后，payload 不带 providerConfig 键（daemon.ts 路由层
    // ql-20260824-016 起保留缺席为 undefined，不再归一 null）。
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess-cfg2b'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-sw-1',
      claimToken: 'c1',
      prompt: 'p1',
      profile: null,
      providerConfig: newProviderConfig('https://a.example.com'),
    });
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('active');

    // Act：不带 providerConfig 键（纯档案切换轮的后端兼容形态；
    // 显式 undefined 与字段缺席在 !== undefined 判定下等价）。
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-sw-2',
      claimToken: 'c2',
      prompt: 'p2',
      profile: null,
      providerConfig: undefined,
    });

    // Assert —— 供应商保持 A（state.providerConfig 现值重建 env）。
    expect(mock.startCalls).toHaveLength(3);
    const env3 = mock.startCalls[2].opts['env'] as NodeJS.ProcessEnv;
    expect(env3.ANTHROPIC_BASE_URL).toBe('https://a.example.com');
    expect(readState(sm, BASE_INPUT.sessionId)!.providerConfig?.base_url).toBe(
      'https://a.example.com',
    );
  });

  it('CFG-3: profile 带空 systemPrompt（切到无人格）→ 清空注入', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, systemPrompt: '旧人格' });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // Act：切到无 systemPrompt 的档案（profile 提供但 systemPrompt 缺省）。
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-sw-3',
      claimToken: 'c3',
      prompt: 'p3',
      profile: { mcpRefs: [] },
      providerConfig: null,
    });

    // Assert（ql-20260818-009 新语义：取消=中和指令+fork——
    // 纯 preset-only 不够（fork 历史里人格角色延续，实测复现）。
    expect(mock.startCalls[1].opts['systemPrompt']).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: expect.stringContaining('用户已取消'),
    });
    expect(mock.startCalls[1].opts['forkSession']).toBe(true);
    expect(readState(sm, BASE_INPUT.sessionId)!.systemPrompt).toContain('用户已取消');
  });

  it('CFG-4: driver.start 抛错 → 回滚 query/env/systemPrompt/providerConfig + 不喂 prompt', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const originalStart = mock.driver.start;
    let call = 0;
    mock.driver.start = vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        call += 1;
        if (call === 1) {
          return (originalStart as unknown as (
            i: AsyncIterable<SDKUserMessage>,
            o: StartOptions,
          ) => Query)(input, opts);
        }
        throw new Error('simulated jsonl missing');
      },
    ) as unknown as ClaudeSdkDriver['start'];
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, systemPrompt: '旧人格' });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const before = readState(sm, BASE_INPUT.sessionId)!;

    // Act + Assert
    await expect(
      sm.reloadWithConfig(BASE_INPUT.sessionId, {
        sessionId: BASE_INPUT.sessionId,
        runId: 'run-sw-fail',
        claimToken: 'claim-fail',
        prompt: '不应被喂入',
        profile: { systemPrompt: '新人格' },
        providerConfig: newProviderConfig(),
      }),
    ).rejects.toThrow(/simulated jsonl missing/);

    const after = readState(sm, BASE_INPUT.sessionId)!;
    // R-01：全部回滚（query/env/systemPrompt/providerConfig），session 不破坏。
    expect(after.query).toBe(before.query);
    expect(after.env).toBe(before.env);
    expect(after.systemPrompt).toBe('旧人格');
    expect(after.providerConfig).toBeUndefined();
    expect(sm.get(BASE_INPUT.sessionId)).toBeDefined();
    // 未喂 prompt：status 仍 active、currentRunId 未切换。
    expect(after.status).toBe('active');
    expect(after.currentRunId).toBeUndefined();
  });

  it('CFG-5: agentSessionId 缺失 → 抛错不破坏会话（内核守卫透传）', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    // 不 emit system/init → agentSessionId undefined。
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // Act + Assert
    await expect(
      sm.reloadWithConfig(BASE_INPUT.sessionId, switchPayload()),
    ).rejects.toThrow(/missing agentSessionId/);
    expect(sm.get(BASE_INPUT.sessionId)?.status).toBe('active');
  });

  it('CFG-6: 终态会话（ended）→ SessionNotActiveError', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    await sm.end(BASE_INPUT.sessionId);

    // Act + Assert
    await expect(
      sm.reloadWithConfig(BASE_INPUT.sessionId, switchPayload()),
    ).rejects.toThrow(SessionNotActiveError);
  });

  it('CFG-7: session 不存在 → SessionNotFoundError', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // Act + Assert
    await expect(
      sm.reloadWithConfig('no-such', switchPayload()),
    ).rejects.toThrow(SessionNotFoundError);
  });
});

// ── (3) markPendingConfigSwitch 状态机（idle 立即 / running 挂 _onResult 边界）──

describe('task-08 / markPendingConfigSwitch（等 turn 边界语义）', () => {
  it('PEND-1: idle（active 且无 currentRunId）→ 立即 reloadWithConfig，不写标记', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const spy = vi
      .spyOn(sm, 'reloadWithConfig')
      .mockResolvedValue(undefined);
    const payload = switchPayload();

    // Act
    sm.markPendingConfigSwitch(BASE_INPUT.sessionId, payload);

    // Assert
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(BASE_INPUT.sessionId, payload);
    expect(readState(sm, BASE_INPUT.sessionId)!.pendingConfigSwitch).toBeUndefined();
  });

  it('PEND-2: running → 仅写标记不 reload；turn 收尾（emitResult 事件注入）→ 触发 reload + 清标记', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    // create 后 status=running（首 turn in-flight），不 emitResult 维持生成中。
    const spy = vi
      .spyOn(sm, 'reloadWithConfig')
      .mockResolvedValue(undefined);
    const payload = switchPayload();

    // Act（生成中标记）
    sm.markPendingConfigSwitch(BASE_INPUT.sessionId, payload);

    // Assert（不中断当前 turn）
    expect(spy).not.toHaveBeenCalled();
    expect(readState(sm, BASE_INPUT.sessionId)!.pendingConfigSwitch).toEqual({
      payload,
    });

    // Act（turn 收尾：事件注入 result，无真实定时器等待）
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // Assert（边界触发一次 + 标记清除 + 用原 payload）
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(BASE_INPUT.sessionId, payload);
    expect(readState(sm, BASE_INPUT.sessionId)!.pendingConfigSwitch).toBeUndefined();
  });

  it('PEND-3: WS 重放覆盖写幂等 —— 连续两次只保留最后一次；turn 收尾只 reload 一次', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    const payloadA = switchPayload();
    const payloadB = switchPayload({ prompt: '第二次切换' });

    // Act（生成中连续两次覆盖写）
    sm.markPendingConfigSwitch(BASE_INPUT.sessionId, payloadA);
    sm.markPendingConfigSwitch(BASE_INPUT.sessionId, payloadB);

    // Assert（覆盖不累积）
    expect(readState(sm, BASE_INPUT.sessionId)!.pendingConfigSwitch).toEqual({
      payload: payloadB,
    });

    // Act + Assert（turn 收尾只触发一次，用最后一次 payload）
    const spy = vi
      .spyOn(sm, 'reloadWithConfig')
      .mockResolvedValue(undefined);
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(BASE_INPUT.sessionId, payloadB);
  });

  it('PEND-4: session 不存在 → SessionNotFoundError', () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // Act + Assert
    expect(() =>
      sm.markPendingConfigSwitch('no-such', switchPayload()),
    ).toThrow(SessionNotFoundError);
  });
});

// ── (4) Codex reloadWithConfig（只切 providerConfig 不注人格，原 D-003）────────

describe('task-08 / reloadWithConfig Codex 路径（NG-02：人格不注入）', () => {
  it('CODEX-1: codex 切供应商 —— resume=threadId + 无 systemPrompt + driverHandle 替换 + 旧句柄 close + 喂 prompt', async () => {
    // Arrange
    const codex = makeMockCodexDriver();
    const claude = makeMockClaudeDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { codex: codex.driver },
      ...makeDeps(),
    });
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-codex',
      provider: 'codex',
      pathToAgentExecutable: 'C:\\bin\\codex.cmd',
    });
    codex.emitMessage(threadStartedMessage('thread-codex-1'));
    await flushMicrotasks();
    codex.emitResult({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
    await flushMicrotasks();
    const oldHandle = readState(sm, 'sess-codex')!.driverHandle;

    // Act
    await sm.reloadWithConfig('sess-codex', {
      sessionId: 'sess-codex',
      runId: 'run-codex-sw',
      claimToken: 'claim-codex',
      prompt: 'codex 切供应商继续',
      profile: { systemPrompt: '不应被注入的人格' },
      providerConfig: newProviderConfig('https://codex-relay.example.com'),
    });

    // Assert —— 内核：resume=threadId + 旧句柄 close + 新句柄替换。
    expect(codex.driver.start).toHaveBeenCalledTimes(2);
    expect(codex.startCalls[1].opts['resume']).toBe('thread-codex-1');
    expect(codex.closeSpyAt(0)).toHaveBeenCalledTimes(1);
    const state = readState(sm, 'sess-codex')!;
    expect(state.driverHandle).not.toBe(oldHandle);
    // 人格不注入（原 D-003 / NG-02）：opts 无 systemPrompt、state.systemPrompt 不写。
    expect(codex.startCalls[1].opts['systemPrompt']).toBeUndefined();
    expect(state.systemPrompt).toBeUndefined();
    // 只切 providerConfig：state.providerConfig 更新。
    expect(state.providerConfig?.base_url).toBe('https://codex-relay.example.com');
    // 喂 prompt。
    expect(state.status).toBe('running');
    expect(state.currentRunId).toBe('run-codex-sw');
    expect(state.claimToken).toBe('claim-codex');
  });
});

// ── (5) 持久化恢复：config 快照落盘 + 旧 sessions.json 容错 ────────────────────

describe('task-08 / 持久化 config 快照（design §5 Wave2 / §9）', () => {
  it('PERSIST-1: reloadWithConfig 后 snapshotPersistable 带 systemPrompt + providerConfig', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess-p1'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    const cfg = newProviderConfig('https://persist.example.com');

    // Act
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-p1',
      claimToken: 'c-p1',
      prompt: 'p',
      profile: { systemPrompt: '持久化人格' },
      providerConfig: cfg,
    });
    const records = sm.snapshotPersistable();

    // Assert
    expect(records).toHaveLength(1);
    expect(records[0].systemPrompt).toBe('持久化人格');
    expect(records[0].providerConfig).toEqual(cfg);
  });

  it('PERSIST-2: providerConfig=null（回退本机）→ 不落 providerConfig（缺省=本机语义）', async () => {
    // Arrange
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess-p2'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    // 先切到供应商（state.providerConfig 写入）。
    await sm.reloadWithConfig(BASE_INPUT.sessionId, {
      sessionId: BASE_INPUT.sessionId,
      runId: 'run-p2a',
      claimToken: 'c-a',
      prompt: 'p',
      profile: null,
      providerConfig: newProviderConfig(),
    });
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    // 再用 reloadWithProvider(null) 显式停止（回退本机）。
    await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

    // Act
    const records = sm.snapshotPersistable();

    // Assert：null 不落盘（restore 缺省=本机凭证链，design §9 等价语义）。
    expect(records).toHaveLength(1);
    expect(records[0].providerConfig).toBeUndefined();
  });

  it('PERSIST-3: restoreAndReconnect 用快照重建 env + systemPrompt（重启不丢配置）', async () => {
    // Arrange：模拟「另一代 daemon」——新 SessionManager + mock driver 恢复落盘记录。
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    const record: PersistedSessionRecord = {
      sessionId: 'sess-restore',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-restore',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 3,
      lastActiveAt: Date.now(),
      systemPrompt: '恢复人格',
      providerConfig: newProviderConfig('https://restore.example.com'),
    };

    // Act
    await sm.restoreAndReconnect(record);
    await flushMicrotasks();

    // Assert：systemPrompt 重新注入 + provider_config layer 0 重建 env。
    expect(mock.driver.start).toHaveBeenCalledTimes(1);
    expect(mock.startCalls[0].opts['resume']).toBe('sdk-sess-restore');
    expect(mock.startCalls[0].opts['systemPrompt']).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '恢复人格',
    });
    const env = mock.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://restore.example.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new-xxx');
    const state = readState(sm, 'sess-restore')!;
    expect(state.providerConfig?.base_url).toBe('https://restore.example.com');
    expect(state.systemPrompt).toBe('恢复人格');
  });

  it('PERSIST-4: 旧 sessions.json 无 config 字段 → 缺省容错（validateRecord 不丢记录，恢复走本机链）', async () => {
    // Arrange：写一个 task-08 之前格式的 sessions.json（无 systemPrompt/providerConfig）。
    const dir = mkdtempSync(join(tmpdir(), 'sm-cfg-switch-'));
    const filePath = join(dir, 'sessions.json');
    const oldFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      sessions: [
        {
          sessionId: 'sess-legacy',
          leaseId: 'lease-legacy',
          agentSessionId: 'sdk-sess-legacy',
          cwd: 'C:\\work',
          provider: 'claude',
          turnCount: 1,
          lastActiveAt: Date.now(),
          // 无 systemPrompt / providerConfig（旧格式）。
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(oldFile, null, 2), 'utf8');
    try {
      const persistence = new JsonSessionPersistence(filePath);

      // Act
      const loaded = await persistence.load();

      // Assert：旧格式记录通过校验，config 字段缺省容错。
      expect(loaded).toHaveLength(1);
      expect(loaded[0].sessionId).toBe('sess-legacy');
      expect(loaded[0].systemPrompt).toBeUndefined();
      expect(loaded[0].providerConfig).toBeUndefined();

      // Act + Assert：用缺省记录恢复 → 本机凭证链（env 无 provider 注入）+ 无 systemPrompt。
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
      await sm.restoreAndReconnect(loaded[0]);
      await flushMicrotasks();
      expect(mock.driver.start).toHaveBeenCalledTimes(1);
      const env = mock.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBeDefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(mock.startCalls[0].opts['systemPrompt']).toBeUndefined();
      expect(readState(sm, 'sess-legacy')!.providerConfig).toBeUndefined();
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── ql-20260822-001：home 会话切供应商 → jsonl 迁移隔离目录（env 污染修复）──
// E2E 实锤：本机 ~/.claude/settings.json 的 env 块（cc-switch 指向本机网关）
// 优先于进程注入的供应商 env——仅「回本机目录 resume」会把切换后的流量串到
// 本机默认网关（BigModel 400[1214]）。修复：home + 生效供应商非空 → 迁移
// jsonl 到隔离目录 → 回隔离 env。用 resumeDirs tmp 目录对端到端验证。
// （移植说明：本地原版走 resolveResumeConfigDir 探测 + 迁移覆盖；main 上
// ql-20260822-009 已用 claude-transcript-dir 模块统一探测，此处迁移改为
// 模块内自门控——isolated 已有副本即跳过，防回灌丢增量。）

describe('ql-20260822-001 / home 会话切供应商迁移 jsonl 到隔离目录', () => {
  const buildDirs = () => {
    const root = mkdtempSync(join(tmpdir(), 'sm-migrate-'));
    return {
      root,
      isolated: join(root, 'iso-claude-config'),
      home: join(root, 'home-claude'),
    };
  };
  const writeHomeJsonl = (dirs: ReturnType<typeof buildDirs>, sid: string) => {
    const dir = join(dirs.home, 'projects', 'C--work');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sid}.jsonl`), '{}\n', 'utf8');
  };
  const writeIsolatedJsonl = (
    dirs: ReturnType<typeof buildDirs>,
    sid: string,
    content = '{}\n',
  ) => {
    const dir = join(dirs.isolated, 'projects', 'C--work');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sid}.jsonl`), content, 'utf8');
  };

  it('MIG-5: home jsonl + reload 切供应商 → 迁移生效：env 回隔离目录 + 隔离副本落盘', async () => {
    // Arrange：本机默认创建（jsonl 在 home）→ 首 turn 完成拿到 sid。
    const dirs = buildDirs();
    try {
      writeHomeJsonl(dirs, 'sdk-sess-mig');
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager(
        { driver: mock.driver, ...makeDeps() },
        { resumeDirs: dirs },
      );
      await sm.create({ ...BASE_INPUT });
      mock.emitMessage(systemInitMessage('sdk-sess-mig'));
      await flushMicrotasks();
      mock.emitResult(resultSuccess());
      await flushMicrotasks();

      // Act：切供应商。
      await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

      // Assert：迁移后回隔离 env（阻断本机 settings.json 污染）+ 副本落盘
      // + 供应商 env 注入 + resume key 不变 + 会话状态不破坏。
      const env = mock.startCalls[1].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBe(dirs.isolated);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://new.example.com');
      expect(mock.startCalls[1].opts['resume']).toBe('sdk-sess-mig');
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sdk-sess-mig.jsonl')),
      ).toBe(true);
      // home 原件保留（复制非移动）。
      expect(
        existsSync(join(dirs.home, 'projects', 'C--work', 'sdk-sess-mig.jsonl')),
      ).toBe(true);
      expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('active');
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-6: home jsonl + reload 切回本机默认（null）→ 不迁移，env 保持本机目录', async () => {
    const dirs = buildDirs();
    try {
      writeHomeJsonl(dirs, 'sdk-sess-mig6');
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager(
        { driver: mock.driver, ...makeDeps() },
        { resumeDirs: dirs },
      );
      await sm.create({ ...BASE_INPUT });
      mock.emitMessage(systemInitMessage('sdk-sess-mig6'));
      await flushMicrotasks();
      mock.emitResult(resultSuccess());
      await flushMicrotasks();

      await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

      const env = mock.startCalls[1].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      // 无供应商 → 不迁移（本机会话本来就要读本机 settings/凭证）。
      expect(existsSync(join(dirs.isolated, 'projects'))).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-7: restore 带供应商 + home jsonl → 迁移生效（存量会话重启自愈）', async () => {
    const dirs = buildDirs();
    try {
      writeHomeJsonl(dirs, 'sdk-sess-mig7');
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager(
        { driver: mock.driver, ...makeDeps() },
        { resumeDirs: dirs },
      );
      const record: PersistedSessionRecord = {
        sessionId: 'sess-mig7',
        leaseId: 'lease-mig7',
        agentSessionId: 'sdk-sess-mig7',
        cwd: 'C:\work',
        provider: 'claude',
        turnCount: 3,
        lastActiveAt: Date.now(),
        providerConfig: newProviderConfig('https://mig7.example.com'),
      };

      await sm.restoreAndReconnect(record);
      await flushMicrotasks();

      const env = mock.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBe(dirs.isolated);
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sdk-sess-mig7.jsonl')),
      ).toBe(true);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-8: 双侧都无 jsonl → unknown 兜底强制隔离（ql-20260822-009 语义不变）', async () => {
    // 迁移找不到源（false）→ 探测亦未命中 → unknown → 保持强制隔离默认。
    const dirs = buildDirs();
    try {
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager(
        { driver: mock.driver, ...makeDeps() },
        { resumeDirs: dirs },
      );
      await sm.create({ ...BASE_INPUT });
      mock.emitMessage(systemInitMessage('sdk-sess-mig8'));
      await flushMicrotasks();
      mock.emitResult(resultSuccess());
      await flushMicrotasks();

      await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

      const env = mock.startCalls[1].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBe(dirs.isolated);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://new.example.com');
      expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('active');
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-9: isolated jsonl + reloadWithConfig(null) 切回本机 → jsonl 回迁宿主机 + env 不隔离无供应商注入（ql-20260824-016）', async () => {
    // Arrange：模拟「曾用平台供应商」的会话——jsonl 已在隔离目录（含供应商期间
    // 增量 turn），state 挂着供应商配置。
    const dirs = buildDirs();
    try {
      writeIsolatedJsonl(dirs, 'sdk-sess-mig9', '{"turns":["provider-period"]}\n');
      const mock = makeMockClaudeDriver();
      const sm = new SessionManager(
        { driver: mock.driver, ...makeDeps() },
        { resumeDirs: dirs },
      );
      await sm.create({ ...BASE_INPUT });
      mock.emitMessage(systemInitMessage('sdk-sess-mig9'));
      await flushMicrotasks();
      mock.emitResult(resultSuccess());
      await flushMicrotasks();
      // 先切到供应商（复现用户路径：state.providerConfig 挂上）。
      await sm.reloadWithConfig(BASE_INPUT.sessionId, {
        sessionId: BASE_INPUT.sessionId,
        runId: 'run-mig9-a',
        claimToken: 'c-a',
        prompt: 'p',
        profile: null,
        providerConfig: newProviderConfig('https://glm.example.com'),
      });
      mock.emitResult(resultSuccess());
      await flushMicrotasks();
      expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('active');

      // Act：切回本机默认（后端下发 providerConfig:null 的修复路径）。
      await sm.reloadWithConfig(BASE_INPUT.sessionId, {
        sessionId: BASE_INPUT.sessionId,
        runId: 'run-mig9-b',
        claimToken: 'c-b',
        prompt: 'p',
        profile: null,
        providerConfig: null,
      });

      // Assert —— jsonl 回迁宿主机（isolated 副本删除，home 拿到含增量的最新版）。
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sdk-sess-mig9.jsonl')),
      ).toBe(false);
      expect(
        readFileSync(
          join(dirs.home, 'projects', 'C--work', 'sdk-sess-mig9.jsonl'),
          'utf8',
        ),
      ).toBe('{"turns":["provider-period"]}\n');
      // env：不隔离（读宿主机 ~/.claude/settings.json，本机供应商生效）+ 无供应商注入。
      const env = mock.startCalls[2].opts['env'] as NodeJS.ProcessEnv;
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      // resume key 不变 + 会话状态不破坏。
      expect(mock.startCalls[2].opts['resume']).toBe('sdk-sess-mig9');
      expect(readState(sm, BASE_INPUT.sessionId)!.providerConfig).toBeNull();
      expect(readState(sm, BASE_INPUT.sessionId)!.status).toBe('running');
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});
