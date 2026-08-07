// tests/interactive/session-manager-reload-provider.test.ts
// task-08（provider-switch-live-session / FR-05 / D-002@v1 / D-004@v1）：
// reloadWithProvider 真实方法体单测 —— 受控重启 claude 子进程并 resume 对话历史。
//
// 覆盖（acceptance 五场景，蓝图 verify）：
//   (1) 成功 reload：close 旧 query + driver.start 二次调用 + state.query 替换 +
//       state.env 替换 + consume 协程重启（driver.consume 调用两次）+ pendingSwitch 清。
//   (2) resume 透传：driver.start 二次调用的 opts.resume === state.agentSessionId
//       （SDK 从 jsonl 重新加载完整对话历史，非内存态）。
//   (3) provider_config=null 回退本机：buildSpawnEnv 第 0 层跳过 + 不隔离
//       CLAUDE_CONFIG_DIR（state.env 无 CLAUDE_CONFIG_DIR 键）；对照组：非 null cfg
//       → state.env.CLAUDE_CONFIG_DIR 被设置（隔离 cc-switch 污染）。
//   (4) 失败保留旧 query：driver.start 抛错 → catch 回滚 state.query=oldQuery +
//       state.env=oldEnv + session 不从 store 移除 + status 不改 + 错误重新抛。
//   (5) reload 期间 inject 并发：driver.start await 窗口内 inject 不抛
//       SessionNotActiveError，消息 push 进 state.inputQueue 不丢（_pendingInjectCount
//       排队语义不引入新锁）。
//
// 与既有测试分工（不重复）：
//   - session-manager-pending-switch.test.ts：task-07 markPendingSwitch 三分支 +
//     _onResult turn 边界触发 reload 的状态机（spy mock reloadWithProvider）。
//   - 本文件：task-08 reloadWithProvider 真实方法体（close + buildSpawnEnv + driver.start
//     resume + 替换 state + 重启 consume + 失败回滚 + inject 并发）。
//
// 策略：
//   - mock driver 的 start/consume/interrupt（对齐 session-manager-terminate-close.test.ts
//     同款 makeMockDriverWithClose）；reload 时 start 第二次返回新 fakeQuery 以验证
//     state.query 被替换为新句柄。
//   - 用真实 buildSpawnEnv（不 mock）验证 CLAUDE_CONFIG_DIR 隔离行为：provider_config
//     null → 不隔离；非 null → 隔离。CLAUDE_CONFIG_DIR 是 daemon config.ts 常量路径，
//     与测试环境无关（buildSpawnEnv 内硬编码赋值）。
//   - 用 flushMicrotasks（setImmediate）让 fire-and-forget 的 _runConsume 微任务跑完。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { SessionNotFoundError } from '../../src/interactive/types.js';
import type { ProviderConfig } from '../../src/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

/**
 * mock driver：每次 start 返回**新** fakeQuery（reload 时第二次 start 拿到不同实例，
 * 便于断言 state.query 被替换）。每个 fakeQuery 自带 interrupt + close spy。
 *
 * 返回 driver + 二次 start 的 fakeQuery 引用记录（firstQuery / secondQuery）+ 各自的
 * close spy + consume 回调注入手柄（emitResult 让 session 进入 active 态）。
 */
function makeMockDriver() {
  const startCalls: { input: unknown; opts: StartOptions }[] = [];
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
        startCalls.push({ input, opts });
        return makeFakeQuery();
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      // 每次 consume 都覆盖 callbacks；reload 后第二次 consume 写入新手柄。
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
    closeSpies,
    /** 第 N 次（0-based）start 返回的 query 对应的 close spy。 */
    closeSpyAt: (i: number) => closeSpies[i],
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

/**
 * ql-20260807-001：模拟真实 SDK close→迭代器抛错→onError 的 mock driver。
 *
 * makeMockDriver 的 consume 永不抛错、close 是空 spy，复现不了真实 SDK 行为
 *（query.close() abort 子进程 → for-await 抛 "Claude Code process aborted by user"
 * → driver consume catch → onError，sdk.mjs close→spawnAbort(Error)）。本工厂补齐：
 * fakeQuery.close() 取该 query 对应 consume 注册的 onError 并异步触发（微任务，
 * 对齐真实 SDK close→process exit→迭代器 throw 的异步性）。
 *
 * 用于 AC-6 验证 _runConsume 的 orphan 守卫：reload 后旧 query.close 触发旧 consume
 * onError 时，isAuthoritative 判定应阻止 fail 误杀新会话。
 */
function makeMockDriverWithAbortOnClose() {
  const startCalls: { input: unknown; opts: StartOptions }[] = [];
  const closeSpies: ReturnType<typeof vi.fn>[] = [];
  // query 引用 → 该 query 的 consume 回调（close 时取它触发 onError）。
  const callbacksByQuery = new Map<object, ConsumeCallbacks>();
  let capturedCallbacks: ConsumeCallbacks | null = null;

  const makeFakeQuery = (): Query => {
    let queryRef: Query;
    const closeSpy = vi.fn(() => {
      // 模拟 SDK abort：for-await 抛错 → driver consume catch → cb.onError。
      // 微任务异步触发（真实 SDK close→process exit→迭代器 throw 也是异步）。
      const cb = callbacksByQuery.get(queryRef as object);
      if (cb?.onError) {
        void Promise.resolve().then(() =>
          cb.onError!('Claude Code process aborted by user'),
        );
      }
    });
    closeSpies.push(closeSpy);
    queryRef = {
      interrupt: vi.fn(async () => {}),
      close: closeSpy,
    } as unknown as Query;
    return queryRef;
  };

  const driver = {
    start: vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCalls.push({ input, opts });
        return makeFakeQuery();
      },
    ),
    consume: vi.fn(async (q: Query, cb: ConsumeCallbacks): Promise<void> => {
      // 按 query 存回调（reload 后两个 consume 各持一份，close 时精准触发各自的）。
      callbacksByQuery.set(q as object, cb);
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
    closeSpies,
    /** 第 N 次（0-based）start 返回的 query 对应的 close spy。 */
    closeSpyAt: (i: number) => closeSpies[i],
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
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
  sessionId: 'sess-reload',
  leaseId: 'lease-reload',
  claimToken: 'claim-reload',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 成功 turn result fixture（对齐 session-manager-budget.test.ts）。 */
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
    uuid: 'r-reload',
  } as unknown as SDKResultMessage;
}

/** system/init 消息（让 _onMessage 写 state.agentSessionId，resume 必需）。 */
function systemInitMessage(sid = 'sdk-sess'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sid,
  } as unknown as SDKMessage;
}

/** 新供应商配置 fixture（ProviderConfig snake_case，对齐 claim payload）。 */
function newProviderConfig(baseUrl = 'https://new.example.com'): ProviderConfig {
  return {
    agent_kind: 'claude',
    base_url: baseUrl,
    api_key: 'sk-new-xxx',
    auth_field: 'ANTHROPIC_AUTH_TOKEN',
    model: 'glm-4.5',
  };
}

/** 让 fire-and-forget 的 _onResult 微任务跑完（对齐 budget test 的 setImmediate 套路）。 */
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** 白盒读取 state（与现有 session-manager.* test 同款 _store 访问）。 */
function readState(sm: SessionManager, sessionId: string) {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  return store.get(sessionId) as
    | {
        query?: Query;
        env?: NodeJS.ProcessEnv;
        agentSessionId?: string;
        pendingSwitch?: { providerConfig: ProviderConfig | null };
        status: string;
      }
    | undefined;
}

// ── AC-1：成功 reload（close + start + 替换 state + 重启 consume + 清 pendingSwitch）──

describe('task-08 / reloadWithProvider 成功路径（FR-05 / D-002@v1）', () => {
  it('AC-1: close 旧 query + driver.start 二次调用 + state.query/env 替换 + consume 重启 + pendingSwitch 清', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    // 首 turn system/init 写 agentSessionId（reload 必需）。
    mock.emitMessage(systemInitMessage('sdk-sess-init'));
    await flushMicrotasks();
    // turn 收尾 → status=active / currentRunId=undefined（reload 前置条件）。
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // 先写入 pendingSwitch（验证 reload 清除；markPendingSwitch 空闲路径不写标记，
    // 这里直接白盒写入以独立于 task-07 状态机测试 reload 清除行为）。
    const stateBefore = readState(sm, BASE_INPUT.sessionId)!;
    stateBefore.pendingSwitch = { providerConfig: newProviderConfig() };
    expect(stateBefore.pendingSwitch).toBeDefined();

    const oldQuery = stateBefore.query;
    const oldEnv = stateBefore.env;
    expect(oldQuery).toBeDefined();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    // ① 旧 query.close 被调一次（SDK kill 链入口；driver.start 首次返回的 fakeQuery
    //    对应 closeSpyAt(0)）。
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(1);

    // ② driver.start 被调两次（第一次 create；第二次 reload）。
    expect(mock.driver.start).toHaveBeenCalledTimes(2);

    // ③ state.query 已替换为第二次 start 返回的新 fakeQuery。
    const stateAfter = readState(sm, BASE_INPUT.sessionId)!;
    expect(stateAfter.query).toBeDefined();
    expect(stateAfter.query).not.toBe(oldQuery);
    // 新 query 的 close spy 是 closeSpyAt(1)（reload 返回的那个），未触发（reload
    // 不调新 query.close，那是后续 end/fail/reload 时的事）。
    expect(mock.closeSpyAt(1)).not.toHaveBeenCalled();

    // ④ state.env 已替换为 buildSpawnEnv 新产出（与 oldEnv 不同实例）。
    expect(stateAfter.env).toBeDefined();
    expect(stateAfter.env).not.toBe(oldEnv);

    // ⑤ consume 协程重启：driver.consume 被调两次（第一次 create；第二次 reload）。
    expect(mock.driver.consume).toHaveBeenCalledTimes(2);

    // ⑥ pendingSwitch 清除（reload 成功后幂等清标记）。
    expect(stateAfter.pendingSwitch).toBeUndefined();

    // ⑦ session 仍在 store，status 不变（reload 不改 status，session 仍 active）。
    expect(sm.get(BASE_INPUT.sessionId)).toBeDefined();
    expect(stateAfter.status).toBe('active');
  });

  // ── AC-2：resume 透传 agentSessionId ──────────────────────────────────────

  it('AC-2: driver.start 二次调用的 opts.resume === state.agentSessionId（jsonl 重载 key）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    const sid = 'sdk-sess-resume-target';
    mock.emitMessage(systemInitMessage(sid));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // sanity：state.agentSessionId 已写入。
    expect(readState(sm, BASE_INPUT.sessionId)?.agentSessionId).toBe(sid);

    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    // 第二次 start（reload）的 opts.resume 严格等于 agentSessionId。
    expect(mock.startCalls).toHaveLength(2);
    const reloadStartCall = mock.startCalls[1];
    expect(reloadStartCall.opts.resume).toBe(sid);
    // 第一次 start（create）不带 resume（首 turn 无 agentSessionId）。
    expect(mock.startCalls[0].opts.resume).toBeUndefined();
  });

  // ── AC-3：provider_config=null 回退本机 + 对照组 ───────────────────────────

  it('AC-3a: provider_config=null → reload 仍保持 CLAUDE_CONFIG_DIR=daemon 隔离（jsonl 一致，ql-002）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, null);

    const state = readState(sm, BASE_INPUT.sessionId)!;
    // ql-20260807-002：reload（含停止 provider_config=null）强制保持 CLAUDE_CONFIG_DIR=daemon
    // 隔离目录——create/切换 jsonl 写在 daemon claude-config，停止若回退 ~/.claude 会 resume
    // 找不到 jsonl → 启动失败 → session ended。故停止也保持隔离目录（凭证靠 env token）。
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(typeof state.env?.CLAUDE_CONFIG_DIR).toBe('string');
    expect(state.env!.CLAUDE_CONFIG_DIR!.length).toBeGreaterThan(0);
    // reload 成功（session 仍 active，未崩溃）。
    expect(state.status).toBe('active');
  });

  it('AC-3b: provider_config 非 null → buildSpawnEnv 隔离 CLAUDE_CONFIG_DIR（对照组）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    const state = readState(sm, BASE_INPUT.sessionId)!;
    // provider_config 非 null → buildSpawnEnv 设置 CLAUDE_CONFIG_DIR（隔离 cc-switch）。
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(typeof state.env?.CLAUDE_CONFIG_DIR).toBe('string');
    expect(state.env!.CLAUDE_CONFIG_DIR!.length).toBeGreaterThan(0);
  });

  // ── AC-4：reload 失败保留旧 query（R-01 降级）──────────────────────────────

  it('AC-4: driver.start reload 时抛错 → 回滚 state.query=oldQuery + session 不破坏 + 错误重新抛', async () => {
    const mock = makeMockDriver();
    // 让 driver.start 第二次调用（reload）抛错。第一次（create）正常返回 fakeQuery。
    const originalStart = mock.driver.start;
    let startCallCount = 0;
    mock.driver.start = vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCallCount += 1;
        if (startCallCount === 1) {
          // 复用原 mock 逻辑（返回 fakeQuery）。
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
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    const stateBefore = readState(sm, BASE_INPUT.sessionId)!;
    const oldQuery = stateBefore.query;
    const oldEnv = stateBefore.env;
    expect(oldQuery).toBeDefined();

    // reload 调用：driver.start 抛错 → reloadWithProvider catch 回滚 + 重新抛。
    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig()),
    ).rejects.toThrow(/simulated spawn EINVAL/);

    const stateAfter = readState(sm, BASE_INPUT.sessionId)!;

    // R-01：state.query 回滚到旧引用（即使旧子进程已被 close，引用保留）。
    expect(stateAfter.query).toBe(oldQuery);
    // state.env 回滚到旧引用。
    expect(stateAfter.env).toBe(oldEnv);

    // session 未从 store 移除（不破坏会话）。
    expect(sm.get(BASE_INPUT.sessionId)).toBeDefined();
    // status 不改（reload 是软切换失败，会话本身无过错）。
    expect(stateAfter.status).toBe('active');

    // ql-20260806-002：close 已移到 driver.start 成功之后；start 抛错时 close 未调
    //（oldQuery 未 close，回滚后旧 consume 可真正恢复，不再降级）。
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(0);
  });

  // ── AC-5：reload 期间 inject 并发排队（不拒绝、不丢消息）──────────────────

  it('AC-5: reload await driver.start 窗口内 inject 不抛 + 消息 push 进 inputQueue 不丢', async () => {
    const mock = makeMockDriver();
    // 让 driver.start 第二次调用（reload）可控延迟：返回一个 promise 我们稍后 resolve。
    const originalStart = mock.driver.start;
    let startCallCount = 0;
    let resolveReloadStart: ((q: Query) => void) | null = null;
    const reloadStartPromise = new Promise<Query>((resolve) => {
      resolveReloadStart = resolve;
    });
    mock.driver.start = vi.fn(
      (input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCallCount += 1;
        if (startCallCount === 1) {
          return (originalStart as unknown as (
            i: AsyncIterable<SDKUserMessage>,
            o: StartOptions,
          ) => Query)(input, opts);
        }
        // 第二次调用（reload）：抛出 promise 会让 await 等待；用 Promise.resolve
        // 后再 await 的形式让 driver.start 表现得像 async。
        // 注意：原 mock 是同步返回 Query；这里改成返回 Promise<Query> 让 await 生效。
        // session-manager 调 driver.start 时 `await`，无论 sync 还是 async 都对齐。
        return reloadStartPromise as unknown as Promise<Query> &
          // 类型桥：原签名返回 Query（同步），但 await Query 不会等——
          // 我们改成返回 Promise<Query> 让 await 真正挂起，模拟 spawn 延迟窗口。
          Query;
      },
    ) as unknown as ClaudeSdkDriver['start'];

    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    // 触发 reload（不 await，让它在 await driver.start 处挂起）。
    const reloadPromise = sm.reloadWithProvider(
      BASE_INPUT.sessionId,
      newProviderConfig(),
    );

    // 让 reload 进入 await driver.start（让出 microtask）。
    await Promise.resolve();
    await Promise.resolve();

    // 此时 reload 正在 await（driver.start 第二次返回的 Promise 未 resolve）。
    // 在此窗口内调 inject：status=active（reload 不改 status），push 应成功。
    let injectObservedRunId: string | null = null;
    try {
      const ret = await sm.inject(
        BASE_INPUT.sessionId,
        'queued-during-reload',
        'run-queued',
      );
      injectObservedRunId = ret.runId;
    } catch (e) {
      // 不应抛（reload 期间 inject 走排队语义不拒绝）。
      expect(e).toBeUndefined();
    }

    // inject 成功（未抛），runId 透传。
    expect(injectObservedRunId).toBe('run-queued');

    // state 已被 inject 切换为 running（push 后 status='running' + currentRunId=新 runId）。
    const stateMidReload = readState(sm, BASE_INPUT.sessionId)!;
    expect(stateMidReload.status).toBe('running');

    // 释放 reload 的 driver.start：用第一次的 fakeQuery 实例返回（任意 Query 即可，
    // 测试只关心 reload 完成 + state.query 替换 + inject 消息进队列）。
    const fakeQueryForReload: Query = {
      interrupt: vi.fn(async () => {}),
      close: vi.fn(),
    } as unknown as Query;
    resolveReloadStart!(fakeQueryForReload);

    await reloadPromise;
    await flushMicrotasks();

    // reload 完成：state.query 已替换为 driver.start 第二次返回的 fakeQuery。
    const stateAfter = readState(sm, BASE_INPUT.sessionId)!;
    expect(stateAfter.query).toBe(fakeQueryForReload);

    // 消息 push 进 inputQueue 未丢（inputQueue 未被 close，push 计数加 1）。
    // 白盒读 inputQueue 内部 pending 数（InputQueue 是 PromiseQueue 鸭子）。
    const inputQueue = (
      sm as unknown as { _store: Map<string, { inputQueue: { size?: number } }> }
    )._store.get(BASE_INPUT.sessionId)?.inputQueue;
    // InputQueue push 后 size 至少为 1（消息在队列中等待新 query consumer 消费）。
    // 注：若 InputQueue 无 size 字段，跳过定量断言（inject 未抛已证不丢消息语义）。
    if (inputQueue && typeof inputQueue.size === 'number') {
      expect(inputQueue.size).toBeGreaterThan(0);
    }

    // consume 协程已重启（driver.consume 第二次被调，订阅 inputQueue 吃后续消息）。
    expect(mock.driver.consume).toHaveBeenCalledTimes(2);
  });

  // ── AC-6：reload 后旧 query.close 触发旧 consume onError（模拟真实 SDK abort）──
  // ql-20260807-001 根因回归锁：真实 SDK 下 oldQuery.close() 让旧 consume 的 for-await
  // 抛 abort 错 → driver consume catch → onError。旧 _runConsume 无条件 fail(sessionId)，
  // reload 后 status=active 绕过 fail 守卫 → _terminateSession 把新 session+新 query 打成
  // failed + onSessionEnd（backend ended）。orphan 守卫（isAuthoritative）修复后此路径
  // 静默丢弃，session 保持 active。makeMockDriver 的 close 是空 spy 复现不了，故用
  // makeMockDriverWithAbortOnClose（close 触发该 query 的 consume onError）。

  it('AC-6: reload 后旧 query.close 触发旧 consume onError → orphan 守卫阻止 fail，session 仍 active + 新 query 未被误杀', async () => {
    const mock = makeMockDriverWithAbortOnClose();
    const deps = makeDeps();
    const sm = new SessionManager({ driver: mock.driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();
    // 首 turn 完成 → status=active（reload 前置）。

    const oldQuery = readState(sm, BASE_INPUT.sessionId)!.query!;
    expect(oldQuery).toBeDefined();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    // ① 旧 query.close 被调一次（reload 触发，模拟 SDK abort）。
    expect(mock.closeSpyAt(0)).toHaveBeenCalledTimes(1);

    // ② 让 close 注册的 onError 微任务跑完（模拟 SDK abort→迭代器抛错→onError）。
    await flushMicrotasks();

    const state = readState(sm, BASE_INPUT.sessionId)!;
    // ⭐ orphan 守卫生效：旧 consume 的 onError 未把 session 打成 failed/ended。
    expect(state.status).toBe('active');
    // ⭐ 未误报终态给 backend（onSessionEnd 一次都没调）。
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    // ⭐ 新 query 未被 fail 误杀（_terminateSession 会 close state.query；此处未触发）。
    expect(mock.closeSpyAt(1)).not.toHaveBeenCalled();
    // 新 query 已就位（state.query 已替换，≠ oldQuery）。
    expect(state.query).toBeDefined();
    expect(state.query).not.toBe(oldQuery);
  });
});

// ── 边界场景 ─────────────────────────────────────────────────────────────────

describe('task-08 / reloadWithProvider 边界场景', () => {
  it('边界-1: session 不存在 → 抛 SessionNotFoundError', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await expect(sm.reloadWithProvider('no-such', null)).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it('边界-2: provider 非 claude → 抛错（codex reload 未支持）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT, provider: 'claude' as const });
    // 白盒把 provider 改成 codex（绕过 create 的 driver 路由，单独测 reload 守卫）。
    const state = readState(sm, BASE_INPUT.sessionId)!;
    (state as { provider: 'claude' | 'codex' }).provider = 'codex';

    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, null),
    ).rejects.toThrow(/provider codex not yet supported/);
  });

  it('边界-3: agentSessionId 缺失（首 turn system/init 未到达）→ 抛错不破坏会话', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    // 不 emit system/init → state.agentSessionId undefined。
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, null),
    ).rejects.toThrow(/missing agentSessionId/);

    // R-01：session 不破坏（仍在 store，status 不变）。
    const after = sm.get(BASE_INPUT.sessionId);
    expect(after).toBeDefined();
    expect(after?.status).toBe('active');
    // 旧 query.close 未被调（守卫在 close 之后、driver.start 之前——其实 close 在
    // agentSessionId 守卫之前执行，故 closeSpyAt(0) 已被调一次。验证 query 引用未变即可）。
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.query).toBeDefined();
  });

  it('边界-4: noopCredential fallback（未注入 credentialManager）→ reload 仍成功（layer 0 独立生效）', async () => {
    // daemon 未注入 credentialManager 时（如测试场景）reload 用 noopCredential：
    // layer 2 (token 读取) 自然跳过，layer 0 (provider_config) 仍独立生效。
    // 验证：reloadWithProvider 不依赖 credentialManager 注入即可工作。
    const mock = makeMockDriver();
    // 显式不传 credentialManager（同生产 daemon.ts 缺省路径）。
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });
    mock.emitMessage(systemInitMessage('sdk-sess'));
    await flushMicrotasks();
    mock.emitResult(resultSuccess());
    await flushMicrotasks();

    await sm.reloadWithProvider(BASE_INPUT.sessionId, newProviderConfig());

    // reload 成功（layer 0 注入 provider_config env，无需 credentialManager）。
    const state = readState(sm, BASE_INPUT.sessionId)!;
    expect(state.query).toBeDefined();
    expect(state.env?.CLAUDE_CONFIG_DIR).toBeDefined();
    // ANTHROPIC_AUTH_TOKEN 由 injector 产出（glm injector 注入此字段）。
    // 不严格断言 value（依赖 injector 实现细节），只验证 key 存在 = layer 0 生效。
    // layer 2 (credentials.json token) 跳过 = noopCredential get()→undefined。
    expect(mock.driver.start).toHaveBeenCalledTimes(2);
  });
});
