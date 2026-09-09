// tests/daemon-interactive-microbatch.test.ts
// ql-20260909-011（交互会话逐事件上报微批化）：daemon.onTurnMessage 提交段
// 微批队列专项测试。vitest.config 全局 SILLYHUB_INTERACTIVE_BATCH_MS=0（旁路
// 同步直发，既有测试语义不变），本文件内逐用例启用窗口（_interactiveBatchMs
// 注入 25ms，真实 timers——窗口毫秒级直等即可，无 fake timers 交互坑）。
//
// 覆盖：
//   ① 攒批合并：同窗多事件一次 submitMessages 批量提交，顺序=入队顺序
//     （flatSeq 入队前取号，dedup_key 单调）；
//   ② flushInteractiveBatches：显式冲队（终态钩子底层），等待在跑 drain
//     完成后积压清空；
//   ③ onTurnResult 终态前冲队：事件先于 run 终态（notifyRunResult）到达；
//   ④ claimToken 空窗兜底：drain 时 token 失效 → resilience enqueuePendingToken
//     整批入箱（对齐 onTurnMessage 空窗分支语义）；
//   ⑤ 提交失败容错：单批失败 warn 不抛，队列照常回收。

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import { createMockClient, createMockSessionManager, mockConfig } from './interactive-test-helpers.js';

/** 启用微批（窗口 25ms）的 daemon 构造。 */
function buildMicrobatchDaemon(
  stateMap: Map<string, Partial<SessionState>>,
  resilience?: Record<string, unknown>,
) {
  const detector = {
    detectAgents: async () => [
      { provider: 'claude', path: '/fake/claude', version: '1.0.0', protocol: 'stream_json', status: 'available', versionWarning: null },
    ],
  };
  const wsClientMock = {
    connect: () => {},
    close: () => {},
    send: () => true,
    registerRpcHandler: () => {},
  };
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    { runLease: async () => ({}) } as never,
    {
      detector,
      wsClientFactory: () => wsClientMock,
      sessionManager: createMockSessionManager(stateMap),
      resilience: resilience as never,
    } as never,
  );
  const client = createMockClient();
  (daemon as unknown as { _client: unknown })._client = client as never;
  // 构造时 env=0（vitest 全局）→ 旁路；此处显式启用 25ms 微批窗
  (daemon as unknown as { _interactiveBatchMs: number })._interactiveBatchMs = 25;
  return { daemon, client };
}

function defaultStateMap(): Map<string, Partial<SessionState>> {
  return new Map<string, Partial<SessionState>>([
    ['sess-1', { leaseId: 'lease-1', claimToken: 'tok-1', provider: 'claude' }],
  ]);
}

function evDict(seq: number, content: string): Record<string, unknown> {
  return { event_type: 'text', type: 'text', content, seq };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ql-20260909-011: interactive 上报微批', () => {
  it('① 同窗多事件攒批一次提交，顺序=入队顺序（dedup_key 单调）', async () => {
    const { daemon, client } = buildMicrobatchDaemon(defaultStateMap());
    // 三连发（25ms 窗内同步连发 → 同批）
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(1, '第一条'));
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(2, '第二条'));
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(3, '第三条'));
    // 窗口内尚未提交
    expect(client.submitMessages).not.toHaveBeenCalled();
    await sleep(60);
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const [leaseId, claimToken, runId, msgs] = client.submitMessages.mock.calls[0];
    expect(leaseId).toBe('lease-1');
    expect(claimToken).toBe('tok-1');
    expect(runId).toBe('run-1');
    expect(msgs).toHaveLength(3);
    // 顺序=入队顺序：dedup_key flatSeq 0 起单调
    expect(
      (msgs as Record<string, unknown>[]).map((m) => m['dedup_key']),
    ).toEqual(['run-1:0:0', 'run-1:0:1', 'run-1:0:2']);
  });

  it('② flushInteractiveBatches 显式冲队：在跑 drain 等待完成、积压清空', async () => {
    const { daemon, client } = buildMicrobatchDaemon(defaultStateMap());
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(1, '积压'));
    await daemon.flushInteractiveBatches('lease-1');
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    expect(
      (client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0]['dedup_key'],
    ).toBe('run-1:0:0');
    // 队列已回收：二次 flush 无新提交
    await daemon.flushInteractiveBatches('lease-1');
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
  });

  it('③ onTurnResult 终态前冲队：事件先于 run 终态到达', async () => {
    const { daemon, client } = buildMicrobatchDaemon(defaultStateMap());
    const order: string[] = [];
    client.submitMessages.mockImplementation(async () => {
      order.push('event');
      return {};
    });
    client.notifyRunResult.mockImplementation(async () => {
      order.push('terminal');
      return {};
    });
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(1, '终态前事件'));
    // 不等窗口，直接进终态（onTurnResult 内部 flushInteractiveBatches 前置）
    await daemon.onTurnResult('sess-1', 'run-1', {
      subtype: 'success',
      is_error: false,
    } as never);
    expect(order).toEqual(['event', 'terminal']);
  });

  it('④ claimToken 空窗兜底：drain 时 token 失效 → 整批 enqueuePendingToken 入箱', async () => {
    const stateMap = defaultStateMap();
    const resilience = {
      setClaimTokenRefresher: vi.fn(),
      submitWithRetry: vi.fn(async () => ({})),
      enqueuePendingToken: vi.fn(async () => ({})),
      retryTerminal: vi.fn(async (call: () => Promise<unknown>) => call()),
    };
    const { daemon, client } = buildMicrobatchDaemon(stateMap, resilience);
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(1, 'a'));
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(2, 'b'));
    // 窗口内把 token 置空（模拟 drain 延迟窗口内 lease 刷新空窗）
    stateMap.set('sess-1', { leaseId: 'lease-1', claimToken: '', provider: 'claude' });
    await sleep(60);
    // 直发未发生，整批入箱（2 条，含 dedup_key）
    expect(client.submitMessages).not.toHaveBeenCalled();
    expect(resilience.enqueuePendingToken).toHaveBeenCalledTimes(1);
    const enqueued = resilience.enqueuePendingToken.mock.calls[0];
    expect(enqueued[0]).toBe('lease-1');
    expect(enqueued[1]).toBe('run-1');
    expect(enqueued[2]).toHaveLength(2);
  });

  it('⑤ 单批提交失败 warn 不抛，队列照常回收', async () => {
    const { daemon, client } = buildMicrobatchDaemon(defaultStateMap());
    client.submitMessages.mockRejectedValueOnce(new Error('boom'));
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(1, '会失败'));
    // 不等窗口（避免 unhandled rejection 悬挂）：flush 走同一 drain 链路
    await daemon.flushInteractiveBatches('lease-1');
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    // 队列回收：后续消息正常直发（新 drain）
    client.submitMessages.mockClear();
    await daemon.onTurnMessage('sess-1', 'run-1', evDict(2, '后续'));
    await daemon.flushInteractiveBatches('lease-1');
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
  });
});
