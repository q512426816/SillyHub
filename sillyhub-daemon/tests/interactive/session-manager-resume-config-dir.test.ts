// tests/interactive/session-manager-resume-config-dir.test.ts
// ql-20260822-009：resume（restoreAndReconnect）/ reload（reloadWithProvider →
// _reloadSession）的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定——集成断言。
//
// 覆盖（mock claude-transcript-dir 模块控制探测结果，SessionManager 真逻辑）：
//   - RESUME host：transcript 仅在宿主机 ~/.claude → restore 的 start opts env 不带
//     CLAUDE_CONFIG_DIR（修复点：原先无条件隔离 → resume 找不到 jsonl → fail →
//     会话被打回 ended，已结束会话重开失效）；
//   - RESUME isolated：transcript 在 daemon 隔离目录 → 仍隔离（ql-20260807-002 /
//     「重启 daemon 后 active session 变 ended」旧修复语义保留）；
//   - RESUME unknown：探测不到 → 维持隔离默认（修复前行为）；
//   - RELOAD host：热切换（停止供应商 null）时同样按位置回 ~/.claude；
//   - 探测入参：restore/reload 均以会话 agentSessionId 调 applyTranscriptConfigDir。
//
// 策略对齐 session-manager-config-switch.test.ts：mock driver 捕获 start opts；
// 真实 buildSpawnEnv；测试前清 process.env 的 ANTHROPIC_* 残留防宿主机污染。

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

// ── mock claude-transcript-dir（本测试被控变量）───────────────────────────────

type Location = 'isolated' | 'host' | 'unknown';
let probeLocation: Location = 'unknown';
const applyCalls: Array<{ sid: string | undefined }> = [];

vi.mock('../../src/interactive/claude-transcript-dir.js', () => ({
  applyTranscriptConfigDir: vi.fn(
    async (env: NodeJS.ProcessEnv, sid: string | undefined) => {
      applyCalls.push({ sid });
      if (probeLocation === 'host') delete env.CLAUDE_CONFIG_DIR;
      else env.CLAUDE_CONFIG_DIR = '/fake-isolated';
    },
  ),
  // ql-20260822-001 移植后 SessionManager 新增 import；探测语义由上方
  // applyTranscriptConfigDir mock 全权控制，迁移在本测试不触发真实 fs。
  defaultTranscriptDirs: () => ({
    isolated: '/fake-isolated',
    home: '/fake-home/.claude',
  }),
  migrateClaudeTranscriptToIsolated: vi.fn(() => false),
  // ql-20260824-016 切回本机反向迁移；本测试不触发真实 fs，与正向迁移同款 no-op。
  migrateClaudeTranscriptToHost: vi.fn(() => false),
}));

// ── 辅助构造（对齐 config-switch / main-agent-mcp 测试）───────────────────────

function makeMockClaudeDriver() {
  const startCalls: Array<{ input: unknown; opts: StartOptions }> = [];
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver = {
    start: vi.fn((_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
      startCalls.push({ input: _input, opts });
      return fakeQuery;
    }),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    startCalls,
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

const BASE_INPUT = {
  sessionId: 'sess-dir',
  leaseId: 'lease-dir',
  claimToken: 'claim-dir',
  firstPrompt: 'hi',
  firstRunId: 'run-dir',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

const SDK_SID = 'sdk-sess-dir';

function systemInitMessage(sid = SDK_SID): SDKMessage {
  return { type: 'system', subtype: 'init', session_id: sid } as unknown as SDKMessage;
}

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
    session_id: SDK_SID,
    uuid: 'r-dir',
  } as unknown as SDKResultMessage;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

function readState(sm: SessionManager, sessionId: string) {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  return store.get(sessionId) as
    | { env?: NodeJS.ProcessEnv; status: string }
    | undefined;
}

/** 清宿主机 process.env 残留，防 buildSpawnEnv 层 3 污染断言。 */
const SENSITIVE_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;
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

/** restoreAndReconnect 用的最小持久化记录（未配供应商：providerConfig 缺省）。 */
function persistedRecord() {
  return {
    sessionId: BASE_INPUT.sessionId,
    leaseId: 'lease-restored',
    agentSessionId: SDK_SID,
    cwd: BASE_INPUT.cwd,
    provider: 'claude' as const,
    lastActiveAt: Date.now(),
  };
}

// ── resume 路径（restoreAndReconnect）─────────────────────────────────────────

describe('ql-20260822-009: restoreAndReconnect 的 CLAUDE_CONFIG_DIR 按位置判定', () => {
  it('RESUME-host: transcript 仅在宿主机 → start env 不带 CLAUDE_CONFIG_DIR', async () => {
    probeLocation = 'host';
    applyCalls.length = 0;
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.restoreAndReconnect(persistedRecord());

    expect(mock.startCalls.length).toBeGreaterThan(0);
    expect(mock.startCalls[0].opts.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    // 探测入参 = 会话 agentSessionId
    expect(applyCalls.at(-1)?.sid).toBe(SDK_SID);
  });

  it('RESUME-isolated: transcript 在隔离目录 → 仍强制隔离（ql-20260807-002 语义保留）', async () => {
    probeLocation = 'isolated';
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.restoreAndReconnect(persistedRecord());

    expect(mock.startCalls[0].opts.env?.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
  });

  it('RESUME-unknown: 探测不到 → 维持隔离默认（修复前行为不回归）', async () => {
    probeLocation = 'unknown';
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.restoreAndReconnect(persistedRecord());

    expect(mock.startCalls[0].opts.env?.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
  });
});

// ── reload 路径（reloadWithProvider → _reloadSession）────────────────────────

describe('ql-20260822-009: reload 的 CLAUDE_CONFIG_DIR 按位置判定', () => {
  it('RELOAD-host: 停止供应商(null) + transcript 在宿主机 → 新 env 不带 CLAUDE_CONFIG_DIR', async () => {
    probeLocation = 'host';
    applyCalls.length = 0;
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(state.status).toBe('active');
    expect(applyCalls.at(-1)?.sid).toBe(SDK_SID);
  });

  it('RELOAD-isolated: transcript 在隔离目录 → 热切换后仍隔离（REG-2 旧语义保留）', async () => {
    probeLocation = 'isolated';
    const mock = makeMockClaudeDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage());
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.env?.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
  });
});
