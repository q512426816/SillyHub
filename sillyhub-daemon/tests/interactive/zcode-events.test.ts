// tests/interactive/zcode-events.test.ts
// 2026-10-15-zcode-engine-appserver task-03：通知 → AgentEvent 归一化器单测。
// fixtures = 2026-10-15 实测抓包序列（subscribe deliveryKind='desktop-continuous'
// 后 session/event 推流 + state.updated 模型目录），逐条钉映射。

import { describe, it, expect } from 'vitest';
import {
  normalizeZcodeNotification,
  type ZcodeStateSnapshot,
} from '../../src/interactive/zcode-events.js';

const SID = 'sess_78bf90e1-fe5c-4df2-a4df-be536f93f2b0';
const TURN = 'turn_47b8d224-2a70-4e22-aa36-a132c87496b6';
const AMID = 'msg_mv95rwm4_e5171a92-d5be-4686-98da-f18f894ef7b5';

/** 实测 session/event 帧骨架（seq/type/payload 逐字段来自抓包）。 */
function sev(seq: number, type: string, payload: Record<string, unknown>) {
  return {
    method: 'session/event',
    params: { sessionId: SID, turnId: TURN, seq, type, payload },
  };
}

describe('normalizeZcodeNotification：model.streaming 双通道', () => {
  it('text_delta → text 事件（delta 直通 + streaming 元数据 + assistantMessageId）', () => {
    const out = normalizeZcodeNotification(
      sev(8, 'model.streaming', {
        assistantMessageId: AMID,
        delta: '乒乓',
        done: false,
        kind: 'text_delta',
      }),
    );
    expect(out).toEqual([
      {
        type: 'text',
        content: '乒乓',
        session_id: SID,
        metadata: {
          zcodeTurnId: TURN,
          zcodeSeq: 8,
          source: 'model_streaming',
          streaming: true,
          assistantMessageId: AMID,
        },
      },
    ]);
  });

  it('reasoning_delta → thinking 事件（思考流通道）', () => {
    const out = normalizeZcodeNotification(
      sev(5, 'model.streaming', {
        assistantMessageId: AMID,
        delta: 'The',
        done: false,
        kind: 'reasoning_delta',
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('thinking');
    expect(out[0]?.content).toBe('The');
  });

  it('空 delta → 零事件（不产空文本）', () => {
    expect(
      normalizeZcodeNotification(
        sev(9, 'model.streaming', { delta: '', done: false, kind: 'text_delta' }),
      ),
    ).toEqual([]);
  });

  it('未知 kind（如未来新增）→ 宽松直通 text 通道', () => {
    const out = normalizeZcodeNotification(
      sev(10, 'model.streaming', { delta: 'x', done: false, kind: 'future_kind' }),
    );
    expect(out[0]?.type).toBe('text');
  });
});

describe('normalizeZcodeNotification：turn.completed 收尾', () => {
  it('完整 usage 载荷 → 单个 turn_result 事件（一等 usage 字段全量映射）', () => {
    const out = normalizeZcodeNotification(
      sev(11, 'turn.completed', {
        response: '乒乓',
        tokenCount: 30249,
        usage: {
          source: 'provider',
          modelRequestCount: 1,
          inputTokens: 30224,
          outputTokens: 25,
          totalTokens: 30249,
          cacheReadTokens: 30208,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        toolCallCount: 0,
        historyRoundCount: 1,
        duration: 2783,
        resultType: 'success',
      }),
    );
    expect(out).toHaveLength(1);
    const ev = out[0]!;
    expect(ev.type).toBe('turn_result');
    expect(ev.content).toBe('');
    expect(ev.usage).toEqual({
      input_tokens: 30224,
      output_tokens: 25,
      cache_read_tokens: 30208,
      cache_creation_tokens: 0,
      ctx_tokens: 30249,
      api_duration_ms: 2783,
    });
    expect(ev.metadata?.response).toBe('乒乓');
    expect(ev.metadata?.turn_status).toBe('success');
  });

  it('无 usage 载荷 → turn_result 仍产出（usage undefined，轮收敛不依赖 usage）', () => {
    const out = normalizeZcodeNotification(sev(12, 'turn.completed', {}));
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('turn_result');
    expect(out[0]?.usage).toBeUndefined();
  });

  it('turn.failed（provider 业务错误实测形状）→ error + turn_result(failed) 双事件收敛', () => {
    // 2026-10-15 实测抓包（429 额度用尽：session/event type=turn.failed）
    const out = normalizeZcodeNotification(
      sev(20, 'turn.failed', {
        error: {
          type: 'unknown_error',
          attribution: {
            source: 'provider',
            reason: 'rate_limited',
            errorPhase: 'stream',
            exceptionKind: 'provider_business',
            providerId: 'bigmodel-api',
            modelId: 'GLM-5.3',
            providerKind: 'anthropic',
            transport: 'sse',
            statusCode: 429,
            providerErrorCode: '1308',
            retryable: false,
          },
          code: '1308',
          message: '[1308][已达到 5 小时的使用上限。您的限额将在 2026-10-15 18:19:50 重置。]',
        },
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('error');
    expect(out[0]?.content).toContain('使用上限');
    expect(out[0]?.metadata?.error_code).toBe('1308');
    expect(out[0]?.metadata?.error_type).toBe('unknown_error');
    expect((out[0]?.metadata?.attribution as Record<string, unknown>)?.reason).toBe('rate_limited');
    // turn_result 失败收尾（驱动收敛判据）
    expect(out[1]?.type).toBe('turn_result');
    expect(out[1]?.metadata?.turn_status).toBe('failed');
    expect(out[1]?.metadata?.source).toBe('turn_failed');
  });

  it('turn.failed 无 message → 兜底文案不空', () => {
    const out = normalizeZcodeNotification(sev(21, 'turn.failed', {}));
    expect(out[0]?.content).toBe('zcode 轮失败（引擎未附 message）');
    expect(out[1]?.metadata?.turn_status).toBe('failed');
  });
});

describe('normalizeZcodeNotification：观察面与 fail-soft', () => {
  it('turn.started / session.updated / session.titleUpdated → 零事件', () => {
    expect(normalizeZcodeNotification(sev(1, 'session.titleUpdated', { title: 'x' }))).toEqual([]);
    expect(normalizeZcodeNotification(sev(2, 'turn.started', { input: 'y' }))).toEqual([]);
    expect(normalizeZcodeNotification(sev(3, 'session.updated', { messageCount: 6 }))).toEqual([]);
  });

  it('未知顶层 type → 零事件不抛错', () => {
    expect(normalizeZcodeNotification(sev(99, 'session.futureThing', {}))).toEqual([]);
  });

  it('遥测通道通知（v4/telemetry / computer-use / process/*）→ 零事件（内容不在其中）', () => {
    expect(
      normalizeZcodeNotification({
        method: 'v4/telemetry/event',
        params: { kind: 'stream.chunk', channel: 'text', chunkLength: 2 },
      }),
    ).toEqual([]);
    expect(
      normalizeZcodeNotification({
        method: 'computer-use/operation-event',
        params: { kind: 'turn-completed', turnId: TURN },
      }),
    ).toEqual([]);
    expect(normalizeZcodeNotification({ method: 'process/mcpTelemetry', params: {} })).toEqual([]);
  });
});

describe('normalizeZcodeNotification：state.updated 快照', () => {
  it('实测形状 → 模型目录 + reasoning levels + 当前模型写回 stateOut', () => {
    const state: { snapshot?: ZcodeStateSnapshot } = {};
    const out = normalizeZcodeNotification(
      {
        method: 'state.updated',
        params: {
          sessionId: SID,
          scope: 'session',
          reason: 'model_list_refreshed',
          patch: {
            status: 'idle',
            model: {
              current: { providerId: 'bigmodel-api', modelId: 'GLM-5.3' },
              available: [
                {
                  ref: { providerId: 'bigmodel-api', modelId: 'GLM-5.3' },
                  label: 'GLM-5.3',
                  providerLabel: 'bigmodel-api',
                  contextWindow: 200000,
                  maxOutputTokens: 128000,
                  reasoning: { levels: [{ value: 'low' }, { value: 'high' }], defaultLevel: 'high' },
                },
                {
                  ref: { providerId: 'kimi', modelId: 'k3' },
                  label: 'k3',
                  reasoning: { levels: [] },
                },
                { ref: { providerId: 'bad' }, label: '缺 modelId 条目应被跳过' },
              ],
            },
          },
        },
      },
      state,
    );
    expect(out).toEqual([]); // 快照不产出消息事件
    const snap = state.snapshot!;
    expect(snap.status).toBe('idle');
    expect(snap.currentModel).toEqual({ providerId: 'bigmodel-api', modelId: 'GLM-5.3' });
    expect(snap.modelCatalog).toHaveLength(2); // 非法条目（缺 modelId）被跳过
    expect(snap.modelCatalog?.[0]).toEqual({
      providerId: 'bigmodel-api',
      modelId: 'GLM-5.3',
      label: 'GLM-5.3',
      contextWindow: 200000,
      maxOutputTokens: 128000,
      reasoningLevels: ['low', 'high'], // {value} 对象数组取 value
      reasoningDefaultLevel: 'high', // 引擎自报默认档（setModel 需带 reasoningLevel 时消费）
    });
  });

  it('state.updated 非 {value} 形态 levels（纯字符串数组）同样提取', () => {
    const state: { snapshot?: ZcodeStateSnapshot } = {};
    normalizeZcodeNotification(
      {
        method: 'state.updated',
        params: { patch: { model: { available: [{ ref: { providerId: 'p', modelId: 'm' }, reasoning: { levels: ['low', 'medium', 'high'] } }] } } },
      },
      state,
    );
    expect(state.snapshot?.modelCatalog?.[0]?.reasoningLevels).toEqual(['low', 'medium', 'high']);
  });
});

describe('normalizeZcodeNotification：实测全序列（fixtures 钉映射）', () => {
  it('一轮「乒乓」对话的完整事件序列归一化对账', () => {
    // 抓包序列：titleUpdated → turn.started → session.updated → 3×reasoning_delta
    // → 1×text_delta → turn.completed（seq 与 kind 逐字段来自 2026-10-15 实测）
    const frames = [
      sev(1, 'session.titleUpdated', { previousTitle: '', source: 'first_input', title: '只回复两个字：乒乓' }),
      sev(2, 'turn.started', { input: '只回复两个字：乒乓', turnNumber: 0 }),
      sev(3, 'session.updated', { messageCount: 6, providerId: 'bigmodel-api', modelId: 'GLM-5.3' }),
      sev(5, 'model.streaming', { assistantMessageId: AMID, delta: 'The', done: false, kind: 'reasoning_delta' }),
      sev(6, 'model.streaming', { assistantMessageId: AMID, delta: ' user just wants me to reply with exactly', done: false, kind: 'reasoning_delta' }),
      sev(7, 'model.streaming', { assistantMessageId: AMID, delta: ' two characters: "乒乓" (ping pong). Simple instruction.', done: false, kind: 'reasoning_delta' }),
      sev(8, 'model.streaming', { assistantMessageId: AMID, delta: '乒乓', done: false, kind: 'text_delta' }),
      sev(11, 'turn.completed', {
        response: '乒乓',
        usage: { inputTokens: 30224, outputTokens: 25, totalTokens: 30249, cacheReadTokens: 30208, cacheWriteTokens: 0 },
        duration: 2783,
        resultType: 'success',
      }),
    ];
    const all = frames.flatMap((f) => normalizeZcodeNotification(f));
    // 产出：3 thinking + 1 text + 1 turn_result
    expect(all.map((e) => e.type)).toEqual([
      'thinking',
      'thinking',
      'thinking',
      'text',
      'turn_result',
    ]);
    // 文本通道拼接 = 最终回复
    expect(all.filter((e) => e.type === 'text').map((e) => e.content).join('')).toBe('乒乓');
    // 思考通道拼接完整
    expect(all.filter((e) => e.type === 'thinking').map((e) => e.content).join('')).toContain('ping pong');
    // 收尾 usage
    const final = all[all.length - 1]!;
    expect(final.usage?.ctx_tokens).toBe(30249);
    expect(final.metadata?.response).toBe('乒乓');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-29-engine-live-perception FR-01：v4/telemetry tool_input_delta 心跳增量
// （spike 结论：2026-10-15 四轮实测 kind 枚举含 tool_input_delta；归一化器经
// stateCarrier.heartbeatDelta 出参透传，驱动层累计节流）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeZcodeNotification：v4/telemetry tool_input_delta 心跳（FR-01）', () => {
  function telemetry(payload: Record<string, unknown>) {
    return {
      method: 'v4/telemetry/event',
      params: { payload },
    } as Parameters<typeof normalizeZcodeNotification>[0];
  }

  it('kind=tool_input_delta 带 length → heartbeatDelta 增量，事件流零产出', () => {
    const state: { heartbeatDelta?: { chars: number } } = {};
    const out = normalizeZcodeNotification(
      telemetry({ kind: 'tool_input_delta', length: 128 }),
      state,
    );
    expect(out).toEqual([]);
    expect(state.heartbeatDelta).toEqual({ chars: 128 });
  });

  it('候选字段多形态：delta.length / chars / inputLength 均可提取', () => {
    for (const payload of [
      { kind: 'tool_input_delta', chars: 64 },
      { kind: 'tool_input_delta', inputLength: 32 },
      { kind: 'tool_input_delta', delta: { length: 16 } },
    ]) {
      const state: { heartbeatDelta?: { chars: number } } = {};
      normalizeZcodeNotification(telemetry(payload), state);
      expect(state.heartbeatDelta).toBeDefined();
    }
  });

  it('字段缺失/零值 → 无信号（宽松 fail-soft，不伪造）', () => {
    const state: { heartbeatDelta?: { chars: number } } = {};
    normalizeZcodeNotification(
      telemetry({ kind: 'tool_input_delta' }),
      state,
    );
    expect(state.heartbeatDelta).toBeUndefined();
    normalizeZcodeNotification(
      telemetry({ kind: 'tool_input_delta', length: 0 }),
      state,
    );
    expect(state.heartbeatDelta).toBeUndefined();
  });

  it('其他遥测 kind（stream.chunk/usage.delta/tool_call/turn.*）不产心跳信号', () => {
    for (const kind of [
      'stream.chunk',
      'usage.delta',
      'tool_call',
      'tool.lifecycle',
      'turn.started',
      'turn.terminal',
    ]) {
      const state: { heartbeatDelta?: { chars: number } } = {};
      const out = normalizeZcodeNotification(
        telemetry({ kind, length: 999 }),
        state,
      );
      expect(out).toEqual([]);
      expect(state.heartbeatDelta).toBeUndefined();
    }
  });

  it('载荷非对象 → 无信号不抛错', () => {
    const state: { heartbeatDelta?: { chars: number } } = {};
    expect(() =>
      normalizeZcodeNotification(
        { method: 'v4/telemetry/event', params: {} } as Parameters<
          typeof normalizeZcodeNotification
        >[0],
        state,
      ),
    ).not.toThrow();
    expect(state.heartbeatDelta).toBeUndefined();
  });
});
