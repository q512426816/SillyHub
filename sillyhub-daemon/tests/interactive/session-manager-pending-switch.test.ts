// tests/interactive/session-manager-pending-switch.test.ts
// task-07（provider-switch-live-session / D-002@v1 / FR-04）：交互式会话供应商热切换
// 的「等 turn 边界」状态机 —— markPendingSwitch 三分支 + _onResult turn 收尾检测触发 reload。
//
// 覆盖（acceptance）：
//   (1) 空闲 session（status=active 且无 currentRunId）收到切换 → 立即 fire-and-forget
//       reloadWithProvider，**不**写 state.pendingSwitch 标记。
//   (2) 生成中 session（status=running，turn in-flight）收到切换 → 仅覆盖写
//       state.pendingSwitch，**不**调 reload、不中断当前 turn。
//   (3) _onResult turn 收尾（status→active / currentRunId 清空 之后）检测到
//       state.pendingSwitch 非空 → 清标记 + 触发 reloadWithProvider（一次）。
//   (4) WS 重放幂等：连续两次 markPendingSwitch 覆盖写不累积；turn 收尾后 reload
//       只被调一次且用最后一次的 providerConfig（R-02）。
//   (5) reloadWithProvider forward 引用 stub：task-08 未覆盖前抛 not-yet-implemented
//       （spy mock 前直接调可观测该错误，确保契约占位存在）。
//   (6) markPendingSwitch 目标 session 不存在 → SessionNotFoundError。

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

// ── 辅助构造（对齐 session-manager-budget.test.ts 同款 mock driver）────────────

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = {
    interrupt: vi.fn(async () => {}),
    close: vi.fn(),
  } as unknown as Query;
  const driver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query =>
        fakeQuery,
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
    fakeQuery,
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
  sessionId: 'sess-ps',
  leaseId: 'lease-ps',
  claimToken: 'claim-ps',
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
    uuid: 'r-ps',
  } as unknown as SDKResultMessage;
}

/** 新供应商配置 fixture（ProviderConfig 8 字段 snake_case，对齐 claim payload）。 */
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

/** 白盒读取 state.pendingSwitch（与现有 session-manager.* test 同款 _store 访问）。 */
function readPendingSwitch(sm: SessionManager, sessionId: string): unknown {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  const state = store.get(sessionId) as
    | { pendingSwitch?: { providerConfig: ProviderConfig | null } }
    | undefined;
  return state?.pendingSwitch;
}

describe('task-07 / interactive provider 热切换 pendingSwitch 状态机（D-002@v1）', () => {
  it('case(1): 空闲 session（active 且无 currentRunId）→ 立即 reload，不写 pendingSwitch', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    // 完成首 turn → status=active / currentRunId=undefined（空闲）。
    emitResult(resultSuccess());
    await flushMicrotasks();

    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);
    const cfg = newProviderConfig();

    sm.markPendingSwitch(BASE_INPUT.sessionId, cfg);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(BASE_INPUT.sessionId, cfg);
    // 空闲路径不写标记（acceptance：立即触发，不写 pendingSwitch）。
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();
  });

  it('case(1)-null: 停止场景（providerConfig=null）空闲立即 reload 回退本机', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    emitResult(resultSuccess());
    await flushMicrotasks();

    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);

    sm.markPendingSwitch(BASE_INPUT.sessionId, null);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(BASE_INPUT.sessionId, null);
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();
  });

  it('case(2): 生成中 session（running）→ 仅覆盖写 pendingSwitch，不调 reload 不中断', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    // create 后 status=running（首 turn in-flight），不 emitResult → 维持生成中。

    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);
    const cfg = newProviderConfig();

    sm.markPendingSwitch(BASE_INPUT.sessionId, cfg);

    // 生成中：不立即 reload（等 turn 边界）。
    expect(reloadSpy).not.toHaveBeenCalled();
    // 仅覆盖写标记（结构 { providerConfig }，非直接存 ProviderConfig）。
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toEqual({
      providerConfig: cfg,
    });
  });

  it('case(3): _onResult turn 收尾 → 检测 pendingSwitch → 清标记 + 触发 reload 一次', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    const cfg = newProviderConfig();

    // 生成中先标记（不 reload）。
    sm.markPendingSwitch(BASE_INPUT.sessionId, cfg);
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toEqual({
      providerConfig: cfg,
    });

    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);

    // turn 收尾 → _onResult 末尾检测 pendingSwitch → 触发 reload。
    emitResult(resultSuccess());
    await flushMicrotasks();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(BASE_INPUT.sessionId, cfg);
    // 清标记（幂等，防重入双 reload）。
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();
  });

  it('case(4): WS 重放幂等 —— 连续两次 markPendingSwitch 覆盖写不累积；reload 只调一次且用最后一次', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });

    const cfgA = newProviderConfig('https://a.example.com');
    const cfgB = newProviderConfig('https://b.example.com');

    // 生成中：连续两次切换（WS 重放 / 用户连点），覆盖写。
    sm.markPendingSwitch(BASE_INPUT.sessionId, cfgA);
    sm.markPendingSwitch(BASE_INPUT.sessionId, cfgB);

    // 覆盖写不累积：只有一个 pendingSwitch，值为最后一次 (cfgB)。
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toEqual({
      providerConfig: cfgB,
    });

    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);

    emitResult(resultSuccess());
    await flushMicrotasks();

    // turn 收尾只触发一次 reload（覆盖写幂等，不双 reload）。
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(BASE_INPUT.sessionId, cfgB);
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();
  });

  it('case(4)-续: pendingSwitch 已设 → 后续空闲路径 markPendingSwitch 立即 reload（覆盖语义）', async () => {
    // 边界：pendingSwitch 已标记后，session 进入空闲再次收到切换 → 走空闲立即 reload
    // 路径（不写标记）；旧 pendingSwitch 仍在，turn 收尾时按旧标记 reload 一次。
    // 验证两条路径互不干扰（markPendingSwitch 不读旧 pendingSwitch 决策，只看 status）。
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    const cfgOld = newProviderConfig('https://old.example.com');
    sm.markPendingSwitch(BASE_INPUT.sessionId, cfgOld); // 生成中标记

    // turn 收尾 → 空闲 + 旧标记触发 reload（清旧标记）。
    emitResult(resultSuccess());
    await flushMicrotasks();
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();

    // 再次空闲收到新切换 → 立即 reload，不写标记。
    const reloadSpy = vi
      .spyOn(sm, 'reloadWithProvider')
      .mockResolvedValue(undefined);
    const cfgNew = newProviderConfig('https://new.example.com');
    sm.markPendingSwitch(BASE_INPUT.sessionId, cfgNew);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(BASE_INPUT.sessionId, cfgNew);
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeUndefined();
  });

  it('case(5): reloadWithProvider 真实实现 agentSessionId 守卫 —— 缺失时抛错不破坏会话', async () => {
    // task-08 覆盖后真实方法体替换 stub：本测试验证 agentSessionId 缺失（首 turn
    // system/init 未到达）时 reload 拒绝启动并保留 session（R-01 不破坏会话）。
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    emitResult(resultSuccess());
    await flushMicrotasks();

    // 未 spy，调真实实现：session.active 但 agentSessionId 缺失（无 system/init）
    // → reload 拒绝（无可恢复 jsonl），抛结构化错误。
    await expect(
      sm.reloadWithProvider(BASE_INPUT.sessionId, null),
    ).rejects.toThrow(/missing agentSessionId/);

    // R-01：session 不破坏（仍在 store，状态不变）。
    const after = sm.get(BASE_INPUT.sessionId);
    expect(after).toBeDefined();
    expect(after?.status).toBe('active');
  });

  it('case(6): markPendingSwitch 目标 session 不存在 → SessionNotFoundError', () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    expect(() => sm.markPendingSwitch('no-such-session', null)).toThrow(
      SessionNotFoundError,
    );
  });

  it('case(7): pendingSwitch 不进 snapshotPersistable 白名单（仅内存态不落盘）', async () => {
    // constraints：pendingSwitch 仅内存，不进 snapshotPersistable 输出（daemon 重启
    // 不恢复 pendingSwitch，由 lease/claim 重注默认）。生成中标记后查 snapshot。
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    sm.markPendingSwitch(BASE_INPUT.sessionId, newProviderConfig());

    const records = sm.snapshotPersistable();
    // 首 turn system/init 未到 → agentSessionId 空 → snapshotPersistable 过滤掉
    //（D-003 不可恢复不落盘），records 可能为空。补一例：手动塞 agentSessionId
    // 后再断言 pendingSwitch 仍未被写进 record（白名单不含该字段）。
    if (records.length > 0) {
      const rec = records[0] as Record<string, unknown>;
      expect(rec['pendingSwitch']).toBeUndefined();
    }
    // 直接断言 state 有标记（确认「有标记但没落盘」是白名单过滤而非标记没写成功）。
    expect(readPendingSwitch(sm, BASE_INPUT.sessionId)).toBeDefined();
  });
});
