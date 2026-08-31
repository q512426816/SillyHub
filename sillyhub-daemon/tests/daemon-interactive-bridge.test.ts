// tests/daemon-interactive-bridge.test.ts
// Wave2 task-04（gap-1）：daemon 桥接 onTurnResult/onTurnMessage/onSessionEnd
// → hubClient.notifyRunResult/submitMessages/notifySessionEnd。
//
// 覆盖（design §2 + §6）：
//   - daemon.onTurnResult(sessionId, runId, result) → 查 SessionState →
//     hubClient.notifyRunResult(leaseId, claimToken, runId, payload)
//     payload 字段：status / is_error / subtype? / result_summary?
//   - daemon.onTurnMessage(sessionId, runId, msg) → 查 SessionState →
//     hubClient.submitMessages(leaseId, claimToken, runId, [msg])
//   - daemon.onSessionEnd(sessionId, status) → hubClient.notifySessionEnd
//     （sessionId, status, reason）— reason 推导：ended→manual / failed→error
//   - 边界（R-bridge）：state 不存在 / sessionManager null → warn 不抛（不崩 daemon）
//   - 边界：hubClient 抛错 → warn 不向上抛（不崩 daemon 主循环）

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

/** mock client：含 notifyRunResult/submitMessages/notifySessionEnd（W1 已加 HubClient）。 */
function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
    // gap-3 / gap-4 桥接端点
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
  };
}

function createMockTaskRunner() {
  return {
    runLease: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: '',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      output: 'ok',
      error: '',
      durationMs: 10,
      sessionId: '',
      metadata: {},
    })),
  };
}

/**
 * mock SessionManager：get 返回注入的 state（或 undefined）。
 * 真实 SessionManager 接口包含更多方法，测试只断言 get + 桥接调用。
 */
function createMockSessionManager(state?: Partial<SessionState>): SessionManager {
  const fullState: SessionState | undefined = state
    ? ({
        sessionId: 'sess-1',
        leaseId: 'lease-1',
        claimToken: 'claim-token-1',
        currentRunId: 'run-1',
        status: 'running',
        lastActiveAt: Date.now(),
        cwd: '/tmp',
        provider: 'claude',
        pathToClaudeCodeExecutable: '/bin/claude',
        inputQueue: { push() {}, close() {} } as never,
        ...state,
      } as SessionState)
    : undefined;
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((() => fullState) as never),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
  } as unknown as SessionManager;
}

function buildDaemon(sm: SessionManager | null = createMockSessionManager({})) {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    {
      sessionManager: sm,
      detector: {
        detectAgents: vi.fn(async () => [] as DetectedAgent[]),
      },
    },
  );
  return { daemon, client, taskRunner, sessionManager: sm };
}

describe('Wave2 task-04 gap-1 daemon 桥接 onTurnResult/onTurnMessage/onSessionEnd', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  // ── onTurnResult → hubClient.notifyRunResult ──────────────────────────────

  it('onTurnResult(state.active) → notifyRunResult(leaseId, claimToken, runId, payload)', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sess-1',
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    expect(client.notifyRunResult).toHaveBeenCalledWith(
      'lease-1',
      'claim-token-1',
      'run-1',
      expect.objectContaining({
        status: 'success',
        is_error: false,
      }),
    );
  });

  it('onTurnResult 含 subtype + result_summary → payload 透传', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'boom',
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    expect(client.notifyRunResult).toHaveBeenCalledWith(
      'lease-1',
      'claim-token-1',
      'run-1',
      expect.objectContaining({
        status: 'error_during_execution',
        is_error: true,
        subtype: 'error_during_execution',
      }),
    );
  });

  // SDKResultSuccess 透传：usage / cost / duration 字段必须从 result 提取并写进
  // payload，否则 backend AgentRun 这些列全 NULL（修复 interactive usage bug）。
  it('onTurnResult 含 SDKResultSuccess usage/cost/duration → payload 全字段透传', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.0123,
      num_turns: 3,
      duration_ms: 4567,
      duration_api_ms: 3900,
      usage: { input_tokens: 1024, output_tokens: 512 },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    expect(client.notifyRunResult).toHaveBeenCalledWith(
      'lease-1',
      'claim-token-1',
      'run-1',
      expect.objectContaining({
        status: 'success',
        is_error: false,
        total_cost_usd: 0.0123,
        num_turns: 3,
        duration_ms: 4567,
        duration_api_ms: 3900,
        input_tokens: 1024,
        output_tokens: 512,
      }),
    );
  });

  it('onTurnResult 缺 usage/cost/duration → payload 不含这些字段（向后兼容）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      // 无 total_cost_usd / usage / num_turns / duration_ms 等
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.status).toBe('success');
    expect(payload.is_error).toBe(false);
    // 缺失字段不应出现在 payload（undefined → 不写），避免覆盖 backend AgentRun 原值。
    expect(payload.total_cost_usd).toBeUndefined();
    expect(payload.num_turns).toBeUndefined();
    expect(payload.duration_ms).toBeUndefined();
    expect(payload.input_tokens).toBeUndefined();
    expect(payload.output_tokens).toBeUndefined();
  });

  // task-16 (2026-06-24-runtime-usage-stats)：SDK usage cache 全名 → 短名映射。
  // Claude SDK result.usage 用 Anthropic 全名 cache_creation_input_tokens /
  // cache_read_input_tokens；daemon 提取处映射为短名 cache_creation_tokens /
  // cache_read_tokens（对齐 backend agent_runs 列 / _METADATA_FIELDS）。
  it('task-16 onTurnResult: SDK cache_*_input_tokens 全名 → payload cache_*_tokens 短名映射', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'cached',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 800,
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    // 全名 → 短名映射
    expect(payload.cache_creation_tokens).toBe(200);
    expect(payload.cache_read_tokens).toBe(800);
    // 全名不应出现在 payload（backend 期望短名）
    expect(payload.cache_creation_input_tokens).toBeUndefined();
    expect(payload.cache_read_input_tokens).toBeUndefined();
    // input/output 仍正常透传
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(50);
  });

  // task-16 / D-001@v1：usage 无 cache 字段（codex/老 CLI）→ payload 不含 cache → backend NULL。
  it('task-16 onTurnResult: usage 无 cache 字段 → payload 不含 cache_*（D-001@v1 backend NULL）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: { input_tokens: 100, output_tokens: 50 }, // 无 cache_*_input_tokens
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.input_tokens).toBe(100);
    expect(payload.cache_read_tokens).toBeUndefined();
    expect(payload.cache_creation_tokens).toBeUndefined();
  });

  // task-16：cache_*_input_tokens=0（无缓存命中）合法，typeof number 守卫放行 0。
  it('task-16 onTurnResult: cache_*_input_tokens=0 合法值透传（守卫 typeof number 非 truthy）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.cache_creation_tokens).toBe(0);
    expect(payload.cache_read_tokens).toBe(0);
  });

  // ql-20260829-002：token 四维优先 modelUsage 跨模型聚合（含 Task 子代理），
  // 缺失/空回落 result.usage（主循环 only，D-001 兼容）。
  it('ql-002 onTurnResult: modelUsage 聚合优先（含子代理模型条目，跨 key 求和）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      // 主循环 only（不含子代理）——修复前会被当作全量透传
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30000,
      },
      // 全 pipeline per-model 账（主模型 + 子代理模型）
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadInputTokens: 30000,
          cacheCreationInputTokens: 50,
        },
        'claude-haiku-4-6': {
          inputTokens: 500,
          outputTokens: 80,
          cacheReadInputTokens: 8000,
          cacheCreationInputTokens: 0,
        },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    // 四维 = 跨模型求和（含子代理），不再用主循环 only 的 usage 值
    expect(payload.input_tokens).toBe(1500);
    expect(payload.output_tokens).toBe(280);
    expect(payload.cache_read_tokens).toBe(38000);
    expect(payload.cache_creation_tokens).toBe(50);
  });

  it('ql-002 onTurnResult: modelUsage 空对象 → 回落 result.usage（老 CLI 兼容）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 800,
      },
      modelUsage: {}, // 空对象（无有效条目）→ seen=false → 回落
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(50);
    expect(payload.cache_read_tokens).toBe(800);
    expect(payload.cache_creation_tokens).toBe(200);
  });

  it('ql-002 onTurnResult: modelUsage 非法条目（非 number 值）跳过、有效条目仍聚合', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 'oops' as unknown as number, // 非法 → 跳过
          outputTokens: 10,
          cacheReadInputTokens: Number.NaN, // 非有限数 → 跳过
          cacheCreationInputTokens: 5,
        },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    // 有效字段聚合，非法字段按 0 基线（seen 由其它维触发，input 全非法 → 0 仍写）
    expect(payload.input_tokens).toBe(0);
    expect(payload.output_tokens).toBe(10);
    expect(payload.cache_read_tokens).toBe(0);
    expect(payload.cache_creation_tokens).toBe(5);
  });

  // ── onTurnMessage → hubClient.submitMessages ──────────────────────────────

  it('onTurnMessage(state.active) → submitMessages(leaseId, claimToken, runId, [msg])', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const msg = { type: 'assistant', message: { role: 'assistant' } } as unknown as SDKMessage;

    await daemon.onTurnMessage('sess-1', 'run-1', msg);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    expect(client.submitMessages).toHaveBeenCalledWith(
      'lease-1',
      'claim-token-1',
      'run-1',
      [msg],
    );
  });

  // ql-004：空 runId（''/undefined）不发 submitMessages，防空 agent_run_id 422 风暴。
  it('onTurnMessage(empty runId) → 不调 submitMessages（防 422 风暴 ql-004）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);
    const msg = { type: 'assistant', message: { role: 'assistant' } } as unknown as SDKMessage;
    await daemon.onTurnMessage('sess-1', '', msg);
    expect(client.submitMessages).not.toHaveBeenCalled();
    await daemon.onTurnMessage('sess-1', undefined as unknown as string, msg);
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  // task-16 (2026-06-24-runtime-usage-stats)：实时回写 —— Claude SDK assistant
  // message 的 usage（msg.message.usage）含 Anthropic 全名 cache_*_input_tokens，
  // daemon 提到顶层时映射为短名 cache_*_tokens（backend _METADATA_FIELDS 命中）。
  it('task-16 onTurnMessage(assistant): usage 提顶层 + cache 全名→短名映射', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const msg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 900,
        },
      },
    } as unknown as SDKMessage;

    await daemon.onTurnMessage('sess-1', 'run-1', msg);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const forwarded = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls[0]![3] as Record<string, unknown>[];
    // 顶层 usage 已注入，且短名 alias 存在（全名 → 短名映射）
    const usage = forwarded[0]!.usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(100);
    expect(usage.cache_creation_tokens).toBe(300);
    expect(usage.cache_read_tokens).toBe(900);
  });

  it('task-16 onTurnMessage(assistant): usage 无 cache → 顶层 usage 不含 cache 短名（D-001@v1）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const msg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 100, output_tokens: 50 }, // 无 cache
      },
    } as unknown as SDKMessage;

    await daemon.onTurnMessage('sess-1', 'run-1', msg);

    const forwarded = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls[0]![3] as Record<string, unknown>[];
    const usage = forwarded[0]!.usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(100);
    expect(usage.cache_read_tokens).toBeUndefined();
    expect(usage.cache_creation_tokens).toBeUndefined();
  });

  // ── onSessionEnd → hubClient.notifySessionEnd ─────────────────────────────

  it('onSessionEnd(status=ended) → notifySessionEnd(sessionId, ended, reason=manual)', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onSessionEnd('sess-1', 'ended');

    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(client.notifySessionEnd).toHaveBeenCalledWith(
      'sess-1',
      'ended',
      expect.any(String),
    );
  });

  it('onSessionEnd(status=failed) → notifySessionEnd reason 含 error', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onSessionEnd('sess-1', 'failed');

    expect(client.notifySessionEnd).toHaveBeenCalledWith(
      'sess-1',
      'failed',
      expect.stringContaining('error'),
    );
  });

  it('onSessionEnd 幂等：backend 已 ended → 不崩（notifySessionEnd backend 自身幂等）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onSessionEnd('sess-1', 'ended');
    await daemon.onSessionEnd('sess-1', 'ended');

    expect(client.notifySessionEnd).toHaveBeenCalledTimes(2);
  });

  // ── 边界：state 不存在 / sessionManager null ──────────────────────────────

  it('onTurnResult session 不存在 → warn 不抛，不调 notifyRunResult', async () => {
    const sm = createMockSessionManager(undefined); // get → undefined
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    const result = { type: 'result', subtype: 'success', is_error: false } as unknown as SDKResultMessage;

    await expect(daemon.onTurnResult('sess-x', 'run-1', result)).resolves.toBeUndefined();
    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('onTurnMessage session 不存在 → warn 不抛，不调 submitMessages', async () => {
    const sm = createMockSessionManager(undefined);
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    const msg = { type: 'assistant' } as unknown as SDKMessage;

    await expect(daemon.onTurnMessage('sess-x', 'run-1', msg)).resolves.toBeUndefined();
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  it('sessionManager=null → onTurnResult/onTurnMessage/onSessionEnd 不抛（?. 链）', async () => {
    const { daemon, client } = buildDaemon(null);
    daemons.push(daemon);

    const result = { type: 'result', subtype: 'success', is_error: false } as unknown as SDKResultMessage;
    const msg = { type: 'assistant' } as unknown as SDKMessage;

    await expect(daemon.onTurnResult('sess-1', 'run-1', result)).resolves.toBeUndefined();
    await expect(daemon.onTurnMessage('sess-1', 'run-1', msg)).resolves.toBeUndefined();
    await expect(daemon.onSessionEnd('sess-1', 'ended')).resolves.toBeUndefined();

    expect(client.notifyRunResult).not.toHaveBeenCalled();
    expect(client.submitMessages).not.toHaveBeenCalled();
    // onSessionEnd 不依赖 state，sessionManager=null 时仍可调 notifySessionEnd
    // （session 级通知，api-key 鉴权，无需 claim_token）；但也允许 daemon 选 ?. no-op。
  });

  // ── 边界：hubClient 抛错 → warn 不向上抛 ──────────────────────────────────

  it('onTurnResult notifyRunResult 抛错 → warn 不向上抛（不崩主循环）', async () => {
    const client = createMockClient();
    client.notifyRunResult.mockRejectedValueOnce(new Error('backend 500'));
    const daemon = new Daemon(
      mockConfig,
      client as never,
      createMockTaskRunner() as never,
      { sessionManager: createMockSessionManager() },
    );
    daemons.push(daemon);

    const result = { type: 'result', subtype: 'success', is_error: false } as unknown as SDKResultMessage;

    await expect(daemon.onTurnResult('sess-1', 'run-1', result)).resolves.toBeUndefined();
  });

  it('onTurnMessage submitMessages 抛错 → warn 不向上抛', async () => {
    const client = createMockClient();
    client.submitMessages.mockRejectedValueOnce(new Error('backend 422'));
    const daemon = new Daemon(
      mockConfig,
      client as never,
      createMockTaskRunner() as never,
      { sessionManager: createMockSessionManager() },
    );
    daemons.push(daemon);

    const msg = { type: 'assistant' } as unknown as SDKMessage;

    await expect(daemon.onTurnMessage('sess-1', 'run-1', msg)).resolves.toBeUndefined();
  });

  it('onSessionEnd notifySessionEnd 抛错 → warn 不向上抛', async () => {
    const client = createMockClient();
    client.notifySessionEnd.mockRejectedValueOnce(new Error('backend 500'));
    const daemon = new Daemon(
      mockConfig,
      client as never,
      createMockTaskRunner() as never,
      { sessionManager: createMockSessionManager() },
    );
    daemons.push(daemon);

    await expect(daemon.onSessionEnd('sess-1', 'ended')).resolves.toBeUndefined();
  });

  // ── deps 闭包：onTurnResult 用的 state.claimToken 是 lease 级（跨 turn 复用）──

  it('onTurnResult 用 state.claimToken（W1 已加，跨 turn 复用 lease 级 token）', async () => {
    const sm = createMockSessionManager({ claimToken: 'lease-claim-token-xyz' });
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    const result = { type: 'result', subtype: 'success', is_error: false } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    expect(client.notifyRunResult).toHaveBeenCalledWith(
      'lease-1',
      'lease-claim-token-xyz',
      'run-1',
      expect.anything(),
    );
  });
});

// ── ql-20260825-f3#8：_interactiveFlatSeq 终态清理（原只增不减）─────────────────

describe('ql-20260825-f3#8：_interactiveFlatSeq 终态按 session 回收', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  /** 白盒读取 flatSeq / owner 两个 Map。 */
  function readSeqMaps(
    daemon: Daemon,
  ): {
    seq: Map<string, number>;
    owner: Map<string, string>;
  } {
    const d = daemon as unknown as {
      _interactiveFlatSeq: Map<string, number>;
      _interactiveFlatSeqOwner: Map<string, string>;
    };
    return { seq: d._interactiveFlatSeq, owner: d._interactiveFlatSeqOwner };
  }

  it('onTurnMessage 计数按 runId 递增；onSessionEnd 回收该 session 全部 run 条目', async () => {
    const { daemon } = buildDaemon();
    daemons.push(daemon);
    const msg = { type: 'assistant', message: { role: 'assistant' } } as unknown as SDKMessage;

    // sess-1 两个 run 各转发消息（run-1 两条、run-2 一条）+ sess-2 一个 run。
    await daemon.onTurnMessage('sess-1', 'run-1', msg);
    await daemon.onTurnMessage('sess-1', 'run-1', msg);
    await daemon.onTurnMessage('sess-1', 'run-2', msg);
    await daemon.onTurnMessage('sess-2', 'run-x', msg);

    const { seq, owner } = readSeqMaps(daemon);
    expect(seq.get('run-1')).toBe(2);
    expect(seq.get('run-2')).toBe(1);
    expect(seq.get('run-x')).toBe(1);
    expect(owner.get('run-1')).toBe('sess-1');
    expect(owner.get('run-x')).toBe('sess-2');

    // sess-1 终态 → 其全部 run 条目回收；sess-2 的条目不受影响。
    await daemon.onSessionEnd('sess-1', 'ended');
    expect(seq.has('run-1')).toBe(false);
    expect(seq.has('run-2')).toBe(false);
    expect(owner.has('run-1')).toBe(false);
    expect(seq.get('run-x')).toBe(1);
    expect(owner.get('run-x')).toBe('sess-2');
  });

  it('onSessionEnd 幂等：重复终态不抛、无残留', async () => {
    const { daemon } = buildDaemon();
    daemons.push(daemon);
    const msg = { type: 'assistant', message: { role: 'assistant' } } as unknown as SDKMessage;
    await daemon.onTurnMessage('sess-1', 'run-1', msg);
    await daemon.onSessionEnd('sess-1', 'ended');
    await expect(daemon.onSessionEnd('sess-1', 'failed')).resolves.toBeUndefined();
    const { seq } = readSeqMaps(daemon);
    expect(seq.size).toBe(0);
  });
});

// ── task-06（2026-08-29-usage-by-provider-model）：终态 model_usage 明细行 ────
// + run 级 assistant 计数（FR-01-3 / FR-02-1，design §2/§3.1）────────────────

describe('task-06：onTurnResult model_usage 拆行 + api_requests 计数', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  /** 白盒读取 run 级 assistant 计数 Map。 */
  function readCountMap(daemon: Daemon): Map<string, number> {
    const d = daemon as unknown as { _assistantMsgCountByRun: Map<string, number> };
    return d._assistantMsgCountByRun;
  }

  const assistantMsg = {
    type: 'assistant',
    message: { role: 'assistant' },
  } as unknown as SDKMessage;

  // 子代理消息也是 assistant 类型（带 parent_tool_use_id），design §2 口径计入。
  const subagentMsg = {
    type: 'assistant',
    parent_tool_use_id: 'toolu_01ABC',
    message: { role: 'assistant' },
  } as unknown as SDKMessage;

  it('modelUsage 多模型 → payload.model_usage 拆行（camel→snake）+ 分摊和 == api_requests', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    // 3 条 assistant（含 1 条子代理）→ run 级 api_requests = 3。
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', subagentMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadInputTokens: 30000,
          cacheCreationInputTokens: 50,
        },
        'claude-haiku-4-6': {
          inputTokens: 500,
          outputTokens: 80,
          cacheReadInputTokens: 8000,
          cacheCreationInputTokens: 0,
        },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.api_requests).toBe(3);
    const rows = payload.model_usage as Array<Record<string, number | string>>;
    expect(rows).toHaveLength(2);
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-4-6')!;
    const haiku = rows.find((r) => r.model === 'claude-haiku-4-6')!;
    // camelCase 四维 → snake_case 拆行
    expect(sonnet).toMatchObject({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: 30000,
      cache_creation_tokens: 50,
    });
    expect(haiku).toMatchObject({
      input_tokens: 500,
      output_tokens: 80,
      cache_read_tokens: 8000,
      cache_creation_tokens: 0,
    });
    // 分摊按 input+output 占比：sonnet 1200/1780*3≈2.02→2；haiku 580/1780*3≈0.98→1。
    expect(sonnet.api_requests).toBe(2);
    expect(haiku.api_requests).toBe(1);
    // 核心不变量：Σ行 api_requests == run 级 total（四舍五入残差守恒）。
    expect(sonnet.api_requests + haiku.api_requests).toBe(payload.api_requests as number);
  });

  it('分摊残差补给最大消耗行（四舍五入不均时 Σ行仍 == api_requests）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    // 3 条 assistant → total=3，两模型 weight 相等（各 100）：份额 round(1.5)=2
    // 各占 → Σ=4 超发 1 → 残差 -1 补给最大消耗行（并列取首行）→ 1 + 2。
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'model-a': { inputTokens: 100, outputTokens: 0 },
        'model-b': { inputTokens: 100, outputTokens: 0 },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.api_requests).toBe(3);
    const rows = payload.model_usage as Array<Record<string, number | string>>;
    const a = rows.find((r) => r.model === 'model-a')!;
    const b = rows.find((r) => r.model === 'model-b')!;
    expect(a.api_requests + b.api_requests).toBe(3);
    // 残差给首行（并列最大）：2 - 1 = 1；次行 2。
    expect(a.api_requests).toBe(1);
    expect(b.api_requests).toBe(2);
  });

  it('无 modelUsage → model_usage/api_requests 两字段都不写（老 CLI 兼容，计数≥1 也不发）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    // 有 assistant 计数（≥1）但 result 无 modelUsage → 两字段均不写
    //（design §3.1：modelUsage 缺失 → 两字段都不写，老行为）。
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.model_usage).toBeUndefined();
    expect(payload.api_requests).toBeUndefined();
    // usage 回落路径不受影响
    expect(payload.input_tokens).toBe(100);
  });

  it('两条 assistant 计数（user 消息不计）→ api_requests=2，单模型行全额分摊', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    // user 消息不是模型调用产出，不计数。
    const userMsg = { type: 'user', message: { role: 'user' } } as unknown as SDKMessage;
    await daemon.onTurnMessage('sess-1', 'run-1', userMsg);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 300,
          outputTokens: 60,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    expect(payload.api_requests).toBe(2);
    const rows = payload.model_usage as Array<Record<string, number | string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.api_requests).toBe(2);
  });

  it('modelUsage 有而计数 0（run 内无 assistant 消息）→ api_requests=0 也发 + 行内全 0', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 300,
          outputTokens: 60,
          cacheReadInputTokens: 10,
          cacheCreationInputTokens: 5,
        },
      },
    } as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', result);

    const callArgs = client.notifyRunResult.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;
    // 有 modelUsage → 两字段都写；0 = 无计数来源的诚实值（非缺失）。
    expect(payload.api_requests).toBe(0);
    const rows = payload.model_usage as Array<Record<string, number | string>>;
    expect(rows[0]!.api_requests).toBe(0);
  });

  it('计数条目生命周期：onTurnResult 读后清理；onSessionEnd 兜底回收未终态 run', async () => {
    const { daemon } = buildDaemon();
    daemons.push(daemon);

    // run-1：有计数 + 达终态 → 读出后条目清理。
    await daemon.onTurnMessage('sess-1', 'run-1', assistantMsg);
    expect(readCountMap(daemon).get('run-1')).toBe(1);
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      modelUsage: {
        'claude-sonnet-4-6': { inputTokens: 10, outputTokens: 5 },
      },
    } as unknown as SDKResultMessage;
    await daemon.onTurnResult('sess-1', 'run-1', result);
    expect(readCountMap(daemon).has('run-1')).toBe(false);

    // run-2：有计数但未达终态（session 中途结束）→ onSessionEnd 反查兜底回收。
    await daemon.onTurnMessage('sess-1', 'run-2', assistantMsg);
    await daemon.onTurnMessage('sess-1', 'run-2', assistantMsg);
    expect(readCountMap(daemon).get('run-2')).toBe(2);
    await daemon.onSessionEnd('sess-1', 'ended');
    expect(readCountMap(daemon).has('run-2')).toBe(false);
  });
});

// ql-20260831-009：modelUsage / total_cost_usd 跨轮累计快照差分。SDK 在
// streaming-input 会话每轮终态报「会话至今累计」，daemon 必须差分为本轮增量再
// 上报，否则 backend 按 run 求和虚增（生产实证：3 轮会话缓存读 338.7 万 vs
// 真实 128.3 万）。用真实数据形态（单调递增快照）作 fixture。
describe('ql-20260831-009：modelUsage/total_cost_usd 跨轮累计快照差分', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  /** 取第 n 次（0 起）notifyRunResult 的 payload。 */
  function payloadOf(client: ReturnType<typeof createMockClient>, n: number) {
    const callArgs = client.notifyRunResult.mock.calls[n]!;
    return callArgs[3] as Record<string, unknown>;
  }

  it('同会话第 2 轮：payload 为快照差值而非快照全量（生产 574793c6 形态回归）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    // 轮 1：快照从零起 → delta = 全量。
    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.5,
        modelUsage: {
          'glm-5.3': {
            inputTokens: 36003,
            outputTokens: 10474,
            cacheReadInputTokens: 880320,
            cacheCreationInputTokens: 0,
          },
        },
      } as unknown as SDKResultMessage,
    );
    // 轮 2：快照单调增长（累计值）→ delta = 差值。
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.8,
        modelUsage: {
          'glm-5.3': {
            inputTokens: 40546,
            outputTokens: 13571,
            cacheReadInputTokens: 1223488,
            cacheCreationInputTokens: 0,
          },
        },
      } as unknown as SDKResultMessage,
    );

    const p1 = payloadOf(client, 0);
    expect(p1.input_tokens).toBe(36003);
    expect(p1.output_tokens).toBe(10474);
    expect(p1.cache_read_tokens).toBe(880320);
    expect(p1.total_cost_usd).toBe(0.5);

    const p2 = payloadOf(client, 1);
    // 差值而非快照：40546-36003 / 13571-10474 / 1223488-880320 / 0.8-0.5。
    expect(p2.input_tokens).toBe(4543);
    expect(p2.output_tokens).toBe(3097);
    expect(p2.cache_read_tokens).toBe(343168);
    expect(p2.total_cost_usd).toBe(0.3);
    // 明细行同步差分（snake_case 拆行仍走 _modelUsageRows）。
    const rows = p2.model_usage as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: 'glm-5.3',
      input_tokens: 4543,
      output_tokens: 3097,
      cache_read_tokens: 343168,
    });
  });

  it('多模型混合：逐模型差分，基线按模型独立推进', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: {
          main: { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 30000 },
          sub: { inputTokens: 500, outputTokens: 80, cacheReadInputTokens: 8000 },
        },
      } as unknown as SDKResultMessage,
    );
    // 轮 2：只有 main 增长，sub 未再被调用（快照持平）→ sub delta 全 0。
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: {
          main: { inputTokens: 1200, outputTokens: 350, cacheReadInputTokens: 45000 },
          sub: { inputTokens: 500, outputTokens: 80, cacheReadInputTokens: 8000 },
        },
      } as unknown as SDKResultMessage,
    );

    const p2 = payloadOf(client, 1);
    expect(p2.input_tokens).toBe(200);
    expect(p2.output_tokens).toBe(150);
    expect(p2.cache_read_tokens).toBe(15000);
    const rows = p2.model_usage as Array<Record<string, unknown>>;
    const subRow = rows.find((r) => r.model === 'sub')!;
    expect(subRow).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
    });
  });

  it('快照复位（当前 < 基线，resume/clear/crash 清零）：该模型按全量上报、基线归零', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.9,
        modelUsage: {
          'glm-5.3': { inputTokens: 5000, outputTokens: 1000, cacheReadInputTokens: 90000 },
        },
      } as unknown as SDKResultMessage,
    );
    // 轮 2：SDK 计数复位（新 query 从零累计），各维均小于基线。
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.2,
        modelUsage: {
          'glm-5.3': { inputTokens: 300, outputTokens: 60, cacheReadInputTokens: 5000 },
        },
      } as unknown as SDKResultMessage,
    );
    // 轮 3：复位后的正常增长 → 相对轮 2 基线差分。
    await daemon.onTurnResult(
      'sess-1',
      'run-3',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.35,
        modelUsage: {
          'glm-5.3': { inputTokens: 400, outputTokens: 90, cacheReadInputTokens: 7000 },
        },
      } as unknown as SDKResultMessage,
    );

    const p2 = payloadOf(client, 1);
    expect(p2.input_tokens).toBe(300);
    expect(p2.cache_read_tokens).toBe(5000);
    expect(p2.total_cost_usd).toBe(0.2); // 成本复位同样报全量
    const p3 = payloadOf(client, 2);
    expect(p3.input_tokens).toBe(100);
    expect(p3.output_tokens).toBe(30);
    expect(p3.cache_read_tokens).toBe(2000);
    expect(p3.total_cost_usd).toBe(0.15);
  });

  it('modelUsage 无效（老 CLI）→ 基线不动回落 result.usage；随后有效快照仍按全量差分', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.4,
        modelUsage: {}, // 空 → 无效，回落 usage
        usage: { input_tokens: 100, output_tokens: 40 },
      } as unknown as SDKResultMessage,
    );
    // 轮 2：首个有效快照（老 CLI 升级后）→ 基线仍空，按全量上报。
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: {
          'glm-5.3': { inputTokens: 700, outputTokens: 300, cacheReadInputTokens: 20000 },
        },
      } as unknown as SDKResultMessage,
    );

    const p1 = payloadOf(client, 0);
    expect(p1.input_tokens).toBe(100);
    expect(p1.total_cost_usd).toBe(0.4); // 成本仍独立差分（首轮基线 0）
    const p2 = payloadOf(client, 1);
    expect(p2.input_tokens).toBe(700);
    expect(p2.cache_read_tokens).toBe(20000);
  });

  it('成本浮点差分截 6 位小数（防 0.8-0.5 类尾差进 payload）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.1,
        modelUsage: { m: { inputTokens: 1 } },
      } as unknown as SDKResultMessage,
    );
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.3,
        modelUsage: { m: { inputTokens: 2 } },
      } as unknown as SDKResultMessage,
    );

    const p2 = payloadOf(client, 1);
    expect(p2.total_cost_usd).toBe(0.2); // 不是 0.19999999999999998
  });

  it('onSessionEnd 回收基线：同 session 后续轮次按新生命周期全量上报', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await daemon.onTurnResult(
      'sess-1',
      'run-1',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: { 'glm-5.3': { inputTokens: 500, outputTokens: 100 } },
      } as unknown as SDKResultMessage,
    );
    await daemon.onSessionEnd('sess-1', 'ended');
    // 会话结束 → 基线回收；若 daemon 侧同 id 重建会话（新流式 query），快照应全量。
    await daemon.onTurnResult(
      'sess-1',
      'run-2',
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: { 'glm-5.3': { inputTokens: 500, outputTokens: 100 } },
      } as unknown as SDKResultMessage,
    );

    const p2 = payloadOf(client, 1);
    expect(p2.input_tokens).toBe(500);
    expect(p2.output_tokens).toBe(100);
  });

  it('不同会话基线相互隔离（并发会话不串差分）', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    const r = (i: number, o: number) =>
      ({
        type: 'result',
        subtype: 'success',
        is_error: false,
        modelUsage: { 'glm-5.3': { inputTokens: i, outputTokens: o } },
      }) as unknown as SDKResultMessage;

    await daemon.onTurnResult('sess-1', 'run-1', r(1000, 100));
    await daemon.onTurnResult('sess-2', 'run-9', r(1000, 100));
    await daemon.onTurnResult('sess-1', 'run-2', r(1200, 150));
    await daemon.onTurnResult('sess-2', 'run-10', r(1100, 120));

    // sess-1 轮 2：差分 200/50；sess-2 轮 2：差分 100/20（不受 sess-1 基线影响）。
    const p1 = payloadOf(client, 2);
    expect(p1.input_tokens).toBe(200);
    expect(p1.output_tokens).toBe(50);
    const p2 = payloadOf(client, 3);
    expect(p2.input_tokens).toBe(100);
    expect(p2.output_tokens).toBe(20);
  });
});
