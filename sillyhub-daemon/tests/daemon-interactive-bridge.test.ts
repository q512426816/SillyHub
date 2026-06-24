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
  server_url: 'http://test:8000',
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
