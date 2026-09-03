// tests/interactive/session-manager-reload-serial.test.ts
// ql-20260825-f3#2：_reloadSession per-session 串行化（chain 模式）。
//
// 修复前：_reloadSession 无串行化，空闲路径 fire-and-forget 两次快速切换并发时
// A/B 快照同一 oldHandle——后完成者覆盖 state.query，先完成者的新句柄永不 close
//（每轮只 close 各自快照的 oldHandle），其 consume isAuthoritative() 恒 false，
// 背后子进程无人 kill（僵尸 claude 进程沉默烧 token）。
//
// 修复后：per-session chain 保证 last-wins 顺序执行——每轮 oldHandle 快照都是
// 上一轮完成后的最新句柄，逐轮 close 无孤儿。
//
// 断言：并发两次 reload 后，中间产生的每个 handle 都被 close **恰好一次**，
// 最终 state.query 是最后一次 reload 的句柄。
//
// 与 session-manager-reload-provider.test.ts 分工：那边覆盖单轮 reload 语义
//（close/start/替换/回滚），本文件只覆盖并发串行化矩阵。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { ProviderConfig } from '../../src/types.js';
import type {
  ClaudeSdkDriver,
  InteractiveDriverCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

/**
 * mock driver：每次 start 返回新 fakeQuery（记录引用 + 各自 close spy），start
 * 内 await 一拍（setImmediate）模拟真实 SDK spawn 的异步窗口——让两个并发 reload
 * 的 start 重叠（修复前快照同一 oldHandle 的必要条件；修复后串行链让第二次
 * start 排在第一次完成之后）。
 */
function makeSlowStartDriver() {
  const queries: Query[] = [];
  const closeSpies: ReturnType<typeof vi.fn>[] = [];
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;

  const driver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => {
        const closeSpy = vi.fn(() => {});
        closeSpies.push(closeSpy);
        const q = {
          interrupt: vi.fn(async () => {}),
          close: closeSpy,
        } as unknown as Query;
        queries.push(q);
        return q;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  // consume 内异步一拍（对齐 reload-provider 测试的 flushMicrotasks 套路）。
  void queries;
  return {
    driver,
    closeSpies,
    getQueries: () => queries,
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onTurnMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onTurnResult?.(r),
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
  sessionId: 'sess-serial',
  leaseId: 'lease-serial',
  claimToken: 'claim-serial',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

function systemInitMessage(sid = 'sdk-sess-serial'): SDKMessage {
  // task-08：归一化器等价 session_started 事件。
  return {
    events: [{ type: 'status', subtype: 'session_started', content: '', session_id: sid }],
  } as unknown as TurnMessageEnvelope;
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
    session_id: 'sdk-sess-serial',
    uuid: 'r-serial',
  } as unknown as SDKResultMessage;
}

function providerConfig(baseUrl: string): ProviderConfig {
  return {
    agent_kind: 'claude',
    base_url: baseUrl,
    api_key: 'sk-xxx',
    auth_field: 'ANTHROPIC_AUTH_TOKEN',
    model: 'glm-4.5',
  };
}

/** 让 fire-and-forget 微任务（_runConsume / chain 链尾）跑完。 */
function flushMicrotasks(times = 8): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) {
    p = p.then(() => new Promise<void>((r) => setImmediate(r)));
  }
  return p;
}

/** 白盒读取 state.query（与 reload-provider 测试同款 _store 访问）。 */
function readQuery(sm: SessionManager, sessionId: string): unknown {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  return (store.get(sessionId) as { query?: unknown } | undefined)?.query;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 并发串行化矩阵 ───────────────────────────────────────────────────────────

describe('_reloadSession per-session 串行化（ql-20260825-f3#2）', () => {
  it('并发两次 reload：每个中间 handle close 恰好一次，state.query 是最后句柄', async () => {
    const d = makeSlowStartDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    d.emitMessage(systemInitMessage()); // 写 agentSessionId（reload 必需）。
    await flushMicrotasks();

    const firstQuery = d.getQueries()[0]!;
    // 并发触发两次（模拟空闲路径两次快速切换 fire-and-forget）。
    const pA = sm.reloadWithProvider(BASE_INPUT.sessionId, providerConfig('https://a.example.com'));
    const pB = sm.reloadWithProvider(BASE_INPUT.sessionId, providerConfig('https://b.example.com'));
    await Promise.all([pA, pB]);
    await flushMicrotasks();

    // start 共 3 次：create 1 + reload 2。
    expect(d.getQueries()).toHaveLength(3);
    // 修复点：每个被替换的 handle close 恰好一次——
    //   H0（create）由 reload A close；H1（A 产）由 reload B close；H2（B 产）存活。
    expect(d.closeSpies[0]).toHaveBeenCalledTimes(1);
    expect(d.closeSpies[1]).toHaveBeenCalledTimes(1);
    expect(d.closeSpies[2]).not.toHaveBeenCalled();
    // 最终 state.query 是最后一次 reload 的句柄（last-wins）。
    expect(readQuery(sm, BASE_INPUT.sessionId)).toBe(d.getQueries()[2]);
    void firstQuery;
  });

  it('串行链隔离不同 session：A 会话 reload 不等待 B 会话', async () => {
    const d = makeSlowStartDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, sessionId: 'sa', leaseId: 'la' });
    d.emitMessage(systemInitMessage()); // sa 的 agentSessionId（create 后回调槽位属于 sa）。
    await sm.create({ ...BASE_INPUT, sessionId: 'sb', leaseId: 'lb', firstRunId: 'rb' });
    d.emitMessage(systemInitMessage()); // sb（第二次 create 覆盖回调槽位）。
    await flushMicrotasks();

    // 两会话各 reload 一次，并发触发。
    await Promise.all([
      sm.reloadWithProvider('sa', providerConfig('https://a.example.com')),
      sm.reloadWithProvider('sb', providerConfig('https://b.example.com')),
    ]);
    await flushMicrotasks();

    // 各自完成：start = create 2 + reload 2 = 4；close 恰好 2 次（各会话旧句柄）。
    expect(d.getQueries()).toHaveLength(4);
    const totalCloses = d.closeSpies.reduce((n, s) => n + s.mock.calls.length, 0);
    expect(totalCloses).toBe(2);
  });

  it('上一轮 reload 失败不阻塞下一轮（错误不沿链传播）', async () => {
    const d = makeSlowStartDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // 不发 system/init → 第一轮 reload 因缺 agentSessionId 抛错（回滚保留旧句柄）。
    const first = sm.reloadWithProvider(BASE_INPUT.sessionId, providerConfig('https://a.example.com'));
    await expect(first).rejects.toThrow(/agentSessionId/);

    // 补 init 后第二轮必须能正常执行（链未卡死在上一轮失败）。
    d.emitMessage(systemInitMessage());
    await flushMicrotasks();
    await sm.reloadWithProvider(BASE_INPUT.sessionId, providerConfig('https://b.example.com'));
    await flushMicrotasks();

    expect(d.getQueries()).toHaveLength(2); // create + 第二轮 reload。
    expect(d.closeSpies[0]).toHaveBeenCalledTimes(1); // 旧句柄被第二轮 close。
    expect(readQuery(sm, BASE_INPUT.sessionId)).toBe(d.getQueries()[1]);
  });
});
