// tests/daemon-agent-event-report.test.ts
// task-09（2026-09-03-agent-provider-abstraction / FR-01 / D-001@v1）：
// daemon.onTurnMessage 事件契约上报接线测试——
//   ① 默认态：SessionManager._eventToReportDict 产出的事件 dict（AgentEvent v2
//      蛇形平铺 + event_type 别名 + seq）包装 {"kind":"agent_event","event":{...},
//      "dedup_key":...} 经 submitMessages 上报（text/tool_use/partial 各一）；
//   ② SILLYHUB_LEGACY_TEXT_EVENTS=1 回退开关两态：开 = dict 原样透传（task-08
//      窗口态，backend 未升级时的本地回退）；关 = kind 包装。legacy flat dict
//      （[TASK_*] 行 / 旧 Codex flat）两态都恒原样（新旧形态共存）；
//   ③ usage 透传：事件 usage（AgentEventUsage 短名 + ctx_tokens）字段名不变
//      （SSE summary 契约，R-07），随 event 原样上报，daemon 不重拷贝；
//   ④ status/session_started 随 submitMessages 上报（backend resume 指针 pin，
//      task-08 已透传，此处锁定 daemon 侧不再旁路）；
//   ⑤ [ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT] 前缀不出现在 daemon 侧
//      content（前缀合成归 backend _persist_agent_event，design §5.1）；
//   ⑥ _assistantMsgCountByRun 计数恢复（事件轨 text 非 partial 计 1，partial/
//      thinking/tool_use 不计；旧 SDK assistant 形态兜底保留）。
//
// 输入形态对齐 SessionManager._eventToReportDict（task-08）实产 dict；mock
// hub-client（submitMessages）——daemon 未注入 resilience → 直发 _client 路径，
// submitMessages 第 4 参即最终 messages 数组（非 resilience 展开形态）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'info',
  allowed_roots: [tmpdir()],
};

/** mock hub-client：只关心 submitMessages，其余方法补空防 not-a-function。 */
function createMockClient() {
  return {
    register: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    leaseHeartbeat: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getPendingChangeWrites: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'run-default', claude_md: '' })),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    syncStatus: vi.fn(async () => ({})),
    recoverSession: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

/** mock SessionManager：get 按预置 state 返回（onTurnMessage 唯一依赖面）。 */
function createMockSessionManager(
  stateMap: Map<string, Partial<SessionState>>,
): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((sid: string) => stateMap.get(sid) as Readonly<SessionState> | undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    markRecoveredSessionFailed: vi.fn(async () => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    refreshClaimToken: vi.fn(async () => {}),
  };
  return sm as unknown as SessionManager;
}

function buildDaemon(stateMap: Map<string, Partial<SessionState>>) {
  const detector = {
    detectAgents: vi.fn(async () => [
      { provider: 'claude', path: '/fake/claude', version: '1.0.0', protocol: 'stream_json', status: 'available', versionWarning: null },
    ]),
  };
  const wsClientMock = {
    connect: vi.fn(),
    close: vi.fn(),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
  };
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    { runLease: vi.fn(async () => ({})) } as never,
    {
      detector,
      wsClientFactory: vi.fn(() => wsClientMock),
      sessionManager: createMockSessionManager(stateMap),
    } as never,
  );
  const client = createMockClient();
  (daemon as unknown as { _client: unknown })._client = client as never;
  return { daemon, client };
}

/** 单 session 预置 state（claimToken 非空 → 主路径直发 submitMessages）。 */
function defaultStateMap(): Map<string, Partial<SessionState>> {
  return new Map<string, Partial<SessionState>>([
    ['sess-1', { leaseId: 'lease-1', claimToken: 'tok-1', provider: 'claude' }],
  ]);
}

/** _eventToReportDict 同构事件 dict（task-08 契约：event_type+type 别名+seq 平铺）。 */
function evDict(dict: Record<string, unknown>): Record<string, unknown> {
  return dict;
}

describe('task-09: daemon agent_event 上报接线', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── ① 默认态消息形态（text / tool_use / partial 各一）──────────────────────
  it('① 默认态：事件 dict 包 kind:agent_event + event + dedup_key（runId:0:flatSeq 单调）', async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    // text 完整事件
    const textDict = evDict({
      event_type: 'text', type: 'text', content: '你好世界', seq: 1,
    });
    await daemon.onTurnMessage('sess-1', 'run-1', textDict);
    // tool_use 事件（一等字段 tool_name/call_id 平铺）
    const toolDict = evDict({
      event_type: 'tool_use', type: 'tool_use', content: '{"command":"ls"}',
      seq: 2, tool_name: 'Bash', call_id: 'toolu_01',
    });
    await daemon.onTurnMessage('sess-1', 'run-1', toolDict);
    // partial 流式事件（is_partial + segment_id 一等字段）
    const partialDict = evDict({
      event_type: 'text', type: 'text', content: '半截输出',
      seq: 3, is_partial: true, segment_id: 'seg-01',
    });
    await daemon.onTurnMessage('sess-1', 'run-1', partialDict);

    expect(client.submitMessages).toHaveBeenCalledTimes(3);
    const calls = client.submitMessages.mock.calls;
    for (let i = 0; i < 3; i++) {
      expect(calls[i][0]).toBe('lease-1');
      expect(calls[i][1]).toBe('tok-1');
      expect(calls[i][2]).toBe('run-1');
      const sent = (calls[i][3] as Record<string, unknown>[])[0];
      // 三键形态：kind / event / dedup_key（backend _persist_agent_event 契约）
      expect(sent['kind']).toBe('agent_event');
      expect(Object.keys(sent).sort()).toEqual(['dedup_key', 'event', 'kind']);
      // dedup_key：事件 dict 无顶层 id → 确定性 seq 分支 `${runId}:0:${flatSeq}`（0 起单调）
      expect(sent['dedup_key']).toBe(`run-1:0:${i}`);
    }
    // event 原样嵌入（一等字段蛇形平铺保留，不改写）
    expect((calls[0][3] as Record<string, unknown>[])[0]['event']).toEqual(textDict);
    expect((calls[1][3] as Record<string, unknown>[])[0]['event']).toEqual(toolDict);
    expect((calls[2][3] as Record<string, unknown>[])[0]['event']).toEqual(partialDict);
  });

  // ── ② legacy 开关两态 + 新旧形态共存 ─────────────────────────────────────
  it('② legacy 开关：默认关=kind 包装；SILLYHUB_LEGACY_TEXT_EVENTS=1=dict 原样透传（窗口态回退）', async () => {
    // 默认态（开关关）
    const d1 = buildDaemon(defaultStateMap());
    const dictA = evDict({ event_type: 'text', type: 'text', content: 'a', seq: 1 });
    await d1.daemon.onTurnMessage('sess-1', 'run-1', dictA);
    const sentA = (d1.client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    expect(sentA['kind']).toBe('agent_event');

    // 开关开：同一 dict 原样上报（toBe 同一对象，无包装无改写）
    vi.stubEnv('SILLYHUB_LEGACY_TEXT_EVENTS', '1');
    const d2 = buildDaemon(defaultStateMap());
    const dictB = evDict({
      event_type: 'thinking', type: 'thinking', content: '思考内容',
      seq: 1, usage: { input_tokens: 5, output_tokens: 3 },
    });
    await d2.daemon.onTurnMessage('sess-1', 'run-1', dictB);
    expect(d2.client.submitMessages).toHaveBeenCalledTimes(1);
    const sentB = (d2.client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    expect(sentB).toBe(dictB);
    expect(sentB['kind']).toBeUndefined();
  });

  it('②b 新旧形态共存：legacy flat dict（[TASK_*] 行 / 旧 Codex flat）默认态也恒原样（不包 kind）', async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    // SessionManager._writeTaskLine 产物（无 type/seq → 非事件轨）
    const taskLine = {
      event_type: 'text',
      content: '[TASK_STARTED] {"task_id":"t1"}',
      channel: 'stdout',
    };
    await daemon.onTurnMessage('sess-1', 'run-1', taskLine);
    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    let sent = (client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    expect(sent).toBe(taskLine);
    expect(sent['kind']).toBeUndefined();

    // 旧 Codex flat（event_type+metadata.subtype，无 type/seq）
    const codexFlat = {
      event_type: 'text', content: '', metadata: { subtype: 'thread_started' },
      session_id: 'thread-xyz',
    };
    await daemon.onTurnMessage('sess-1', 'run-1', codexFlat);
    sent = (client.submitMessages.mock.calls[1][3] as Record<string, unknown>[])[0];
    expect(sent).toBe(codexFlat);

    // budget_exceeded 软切断事件（event_type:'system' + reason/usage 顶层键，backend 旧轨识别）
    const budgetMsg = {
      event_type: 'system',
      content: '[BUDGET_EXCEEDED] input=10 output=5 budget=100',
      reason: 'budget_exceeded',
      usage: { input_tokens: 10, output_tokens: 5 },
      budget_tokens: 100,
    };
    await daemon.onTurnMessage('sess-1', 'run-1', budgetMsg);
    sent = (client.submitMessages.mock.calls[2][3] as Record<string, unknown>[])[0];
    expect(sent).toBe(budgetMsg);
  });

  // ── ③ usage lift 字段（D-003@v1 实时透传，SSE summary 字段名不变）──────────
  it('③ usage：事件 usage 短名五维（含 ctx_tokens）随 event 原样透传，daemon 不改写', async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    const usage = {
      input_tokens: 11, output_tokens: 7, cache_read_tokens: 3,
      cache_creation_tokens: 2, ctx_tokens: 99,
    };
    const dict = evDict({
      event_type: 'text', type: 'text', content: 'partial 实时计费',
      seq: 1, is_partial: true, segment_id: 'seg-u', usage,
    });
    await daemon.onTurnMessage('sess-1', 'run-1', dict);

    const sent = (client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    // usage 在 event 内（backend _persist_agent_event 从 event.usage stamp 进首条
    // record → SSE summary input/output/cache_read/cache_creation/ctx_tokens 字段名不变）
    expect(sent['event']).toMatchObject({ usage });
    // wrapper 顶层不重复挂 usage（backend 新轨只读 event 内字段）
    expect(sent['usage']).toBeUndefined();
    // 同一对象引用（零拷贝：归一化器已短名化，daemon 侧重复映射是恒等，跳过）
    expect((sent['event'] as Record<string, unknown>)['usage']).toBe(usage);

    // legacy 开=1 时 usage 仍平铺在 dict 顶层（旧链路 backend 读顶层）
    vi.stubEnv('SILLYHUB_LEGACY_TEXT_EVENTS', '1');
    const d2 = buildDaemon(defaultStateMap());
    await d2.daemon.onTurnMessage('sess-1', 'run-1', dict);
    const sent2 = (d2.client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    expect(sent2['usage']).toBe(usage);
  });

  // ── ④ session_started 随 submitMessages 上报（backend resume 指针 pin）────
  it('④ status/session_started 事件随 submitMessages 上报（kind 包装内含 session_id）', async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    const dict = evDict({
      event_type: 'status', type: 'status', subtype: 'session_started',
      content: '', session_id: 'provider-sess-abc', seq: 1,
    });
    await daemon.onTurnMessage('sess-1', 'run-1', dict);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const sent = (client.submitMessages.mock.calls[0][3] as Record<string, unknown>[])[0];
    expect(sent['kind']).toBe('agent_event');
    // backend 从 event{type:'status',subtype:'session_started',session_id} 提取 pin
    expect(sent['event']).toEqual(dict);
    expect((sent['event'] as Record<string, unknown>)['session_id']).toBe('provider-sess-abc');
  });

  // ── ⑤ 前缀合成归 backend：daemon 侧 content 无 [ASSISTANT] 等前缀 ─────────
  it('⑤ daemon 侧 content 不含 [ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT] 前缀', async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    const dicts = [
      evDict({ event_type: 'text', type: 'text', content: '纯文本', seq: 1 }),
      evDict({ event_type: 'thinking', type: 'thinking', content: '纯思考', seq: 2 }),
      evDict({ event_type: 'tool_use', type: 'tool_use', content: '{"command":"ls"}', seq: 3, tool_name: 'Bash' }),
      evDict({ event_type: 'tool_result', type: 'tool_result', content: '结果原文', seq: 4, call_id: 'toolu_01' }),
      evDict({ event_type: 'text', type: 'text', content: '流式半截', seq: 5, is_partial: true, segment_id: 's1' }),
    ];
    for (const d of dicts) {
      await daemon.onTurnMessage('sess-1', 'run-1', d);
    }
    expect(client.submitMessages).toHaveBeenCalledTimes(dicts.length);
    for (let i = 0; i < dicts.length; i++) {
      const sent = (client.submitMessages.mock.calls[i][3] as Record<string, unknown>[])[0];
      const content = String((sent['event'] as Record<string, unknown>)['content']);
      expect(content).toBe(dicts[i]['content']);
      expect(content).not.toMatch(/^\[(ASSISTANT|THINKING|TOOL_USE|TOOL_RESULT)/);
    }
  });

  // ── ⑥ _assistantMsgCountByRun 计数恢复 ────────────────────────────────────
  it('⑥ 计数恢复：事件轨完整 text 计 1，partial/thinking/tool_use 不计（两态同计）', async () => {
    const { daemon } = buildDaemon(defaultStateMap());
    const countOf = () =>
      (daemon as unknown as { _assistantMsgCountByRun: Map<string, number> })
        ._assistantMsgCountByRun.get('run-cnt') ?? 0;

    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'text', type: 'text', content: '完整回复', seq: 1 }));
    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'text', type: 'text', content: '半截', seq: 2, is_partial: true, segment_id: 's' }));
    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'thinking', type: 'thinking', content: '思考', seq: 3 }));
    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'tool_use', type: 'tool_use', content: '{}', seq: 4, tool_name: 'Bash' }));
    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'text', type: 'text', content: 'override 完整', seq: 5, override: true, segment_id: 's' }));
    // 完整 text 2 条（含 override 完整行）计 2；partial/thinking/tool_use 不计
    expect(countOf()).toBe(2);

    // legacy 开关开：计数口径不变（开关只切上报形态）
    vi.stubEnv('SILLYHUB_LEGACY_TEXT_EVENTS', '1');
    await daemon.onTurnMessage('sess-1', 'run-cnt',
      evDict({ event_type: 'text', type: 'text', content: 'legacy 完整', seq: 6 }));
    expect(countOf()).toBe(3);

    // 旧 SDK 形态（type==='assistant'，测试替身/未升级路径）兜底保留
    await daemon.onTurnMessage('sess-1', 'run-cnt', {
      type: 'assistant',
      message: { id: 'msg-1', usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
    });
    expect(countOf()).toBe(4);
  });

  // ── 附：claim_token 空窗 pending_token 入箱形态与主路径一致 ──────────────────
  it('附：claim_token 空窗时事件 dict 也以 kind 包装入箱（drain 重放走同一 backend 分支）', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      ['sess-1', { leaseId: 'lease-1', claimToken: '', provider: 'claude' }],
    ]);
    const { daemon } = buildDaemon(stateMap);
    const envelopes: Array<{ message: Record<string, unknown>; dedup_key: string }> = [];
    const resilience = {
      submitWithRetry: vi.fn(async () => {}),
      retryTerminal: vi.fn(async () => {}),
      enqueuePendingToken: vi.fn(async (_l: string, _r: string, envs: typeof envelopes) => {
        envelopes.push(...envs);
      }),
      enqueueRunResult: vi.fn(async () => {}),
      enqueueSessionEnd: vi.fn(async () => {}),
    };
    (daemon as unknown as { _resilience: unknown })._resilience = resilience;

    const dict = evDict({ event_type: 'text', type: 'text', content: '空窗消息', seq: 1 });
    await daemon.onTurnMessage('sess-1', 'run-1', dict);

    expect(resilience.enqueuePendingToken).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].message['kind']).toBe('agent_event');
    expect(envelopes[0].dedup_key).toBe('run-1:0:0');
    expect(envelopes[0].message['event']).toEqual(dict);
  });
});
