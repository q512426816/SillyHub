// tests/interactive/cursor-events.test.ts
// 2026-09-08-cursor-interactive-session task-03：normalizeCursorFrame golden 测试。
//
// 覆盖（任务卡 acceptance 四条）：
//   1. 映射表七类分支逐字段断言——真实 fixture 驱动（tests/fixtures/cursor/*.ndjson，
//      task-01 实跑采样，逐行 JSON.parse 校验过）：
//      system/init→status/session_started+session_id；assistant→text；
//      thinking delta→thinking(is_partial+segment_id)、completed→[]；
//      tool_call started/completed→tool_use/tool_result（call_id 配对、
//      stdout/stderr 进 content、exitCode 等进 metadata）；
//      result→turn_result+usage camelCase→短名+session_id；
//      user/connection/retry→[]；未知帧（probe_capture）→status/task_notification
//      降级桶+metadata.original_event_type。
//   2. 全部产出事件逐条过 safeParseAgentEvent（expectValid 打印 issues 定位，
//      pi-events.test.ts 同款）；type='status' 恒带 subtype。
//   3. usage 四字段短名与 AgentEventUsage 对齐；tool_name/call_id 原生保留
//      （shellToolCall/editToolCall 不重命名；call_id 含字面 \n 原样透传）。
//   4. 畸形输入（null/数字/字符串/数组/缺 type/坏字段）→ [] 不抛；
//      手工构造未知帧验证降级桶。
//
// fixture 加载手法照 pi-events.test.ts：tests/helpers loadLines 逐行喂
// normalizeCursorFrame（frame 入参为 JSON.parse 后的对象——归一化器契约
// 收 unknown，坏 JSON 防御由 driver 分帧层承担）。

import { describe, it, expect } from 'vitest';

import {
  normalizeCursorFrame,
  type CursorNormalizeCtx,
} from '../../src/interactive/cursor-events.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import type { AgentEvent } from '../../src/types.js';
import { loadLines } from '../helpers';

/**
 * 逐帧归一化整份 fixture，返回 (event, 原始帧号) 对（含帧号定位失败用）。
 * ctx 可选注入（thinking 段号跨帧计数，driver 持有语义；缺省零状态调用）。
 */
function normalizeFixture(
  name: string,
  ctx?: CursorNormalizeCtx,
): Array<{ ev: AgentEvent; frameNo: number }> {
  const out: Array<{ ev: AgentEvent; frameNo: number }> = [];
  const lines = loadLines(`cursor/${name}.ndjson`);
  lines.forEach((line, idx) => {
    for (const ev of normalizeCursorFrame(JSON.parse(line), ctx)) {
      out.push({ ev, frameNo: idx + 1 });
    }
  });
  return out;
}

/** 逐帧归一化并保留「零产出帧号」清单（断言忽略帧用）。 */
function silentFrames(name: string): number[] {
  const lines = loadLines(`cursor/${name}.ndjson`);
  const silent: number[] = [];
  lines.forEach((line, idx) => {
    if (normalizeCursorFrame(JSON.parse(line)).length === 0) {
      silent.push(idx + 1);
    }
  });
  return silent;
}

/** 断言事件过 zod 校验（失败时打印 issue 定位，pi-events.test.ts expectValid 同款）。 */
function expectValid(ev: AgentEvent): void {
  const r = safeParseAgentEvent(ev);
  if (!r.success) {
    throw new Error(
      `safeParseAgentEvent failed: ${JSON.stringify(r.error.issues)} on ${JSON.stringify(ev)}`,
    );
  }
}

/** 断言全部产出合法 + status 恒带 subtype（schema superRefine 交叉校验守护）。 */
function expectAllValid(events: Array<{ ev: AgentEvent }>): void {
  expect(events.length).toBeGreaterThan(0);
  for (const { ev } of events) {
    expectValid(ev);
    if (ev.type === 'status') {
      expect(typeof ev.subtype).toBe('string');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. turn1-fresh（全新会话 8 帧：system/init + user + thinking×4 + assistant + result）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / turn1-fresh（基础轮逐型映射）', () => {
  const all = normalizeFixture('turn1-fresh');

  it('全部产出过 safeParseAgentEvent；status 恒带 subtype', () => {
    expectAllValid(all);
  });

  it('system/init → status/session_started + session_id 一等字段 + model/permissionMode 进 metadata', () => {
    const started = all.filter((x) => x.ev.subtype === 'session_started');
    expect(started.length).toBe(1);
    const ev = started[0]!.ev;
    expect(ev.type).toBe('status');
    expect(ev.session_id).toBe('c482aaa1-d2c7-4ec8-816b-6157ef58800f');
    expect(ev.metadata).toMatchObject({ model: 'Auto', permission_mode: 'default' });
    expect(started[0]!.frameNo).toBe(1);
  });

  it('user 回显帧 → []（第 2 帧零产出，不透传防重复渲染）；thinking/completed 吸收（第 6 帧）', () => {
    expect(silentFrames('turn1-fresh')).toEqual([2, 6]);
  });

  it('thinking delta×3 → thinking(is_partial+segment_id)；content 逐字', () => {
    const thinkings = all.filter((x) => x.ev.type === 'thinking');
    expect(thinkings.length).toBe(3);
    expect(thinkings.map((x) => x.ev.content)).toEqual([
      "I'll store the secret",
      ' code Zebra-42 and reply',
      ' OK.',
    ]);
    for (const { ev, frameNo } of thinkings) {
      expect(ev.is_partial).toBe(true);
      // 缺省 ctx 调用：恒定 segment 0（driver 注入 ctx 时按 completed 递增）
      expect(ev.segment_id).toBe('cursor:thinking:0');
      expect([3, 4, 5]).toContain(frameNo);
    }
  });

  it('assistant 文本块 → text 完整事件（content 逐字）', () => {
    const texts = all.filter((x) => x.ev.type === 'text');
    expect(texts.length).toBe(1);
    expect(texts[0]!.ev.content).toBe('OK.');
    expect(texts[0]!.frameNo).toBe(7);
  });

  it('result → turn_result + usage camelCase→短名映射 + session_id', () => {
    const results = all.filter((x) => x.ev.type === 'turn_result');
    expect(results.length).toBe(1);
    const ev = results[0]!.ev;
    expect(ev.content).toBe('OK.');
    expect(ev.session_id).toBe('c482aaa1-d2c7-4ec8-816b-6157ef58800f');
    expect(ev.usage).toEqual({
      input_tokens: 6578,
      output_tokens: 78,
      cache_read_tokens: 8704,
      cache_creation_tokens: 0,
      ctx_tokens: 15282, // 净值三和 6578+8704+0（ctxTokensFromNetInput）
    });
    expect(ev.metadata).toMatchObject({
      is_error: false,
      duration_ms: 9364,
      request_id: '9908bcc6-a0d1-4d56-95bf-a503ef01cf07',
    });
    expect(results[0]!.frameNo).toBe(8);
  });

  it('产出全集恰为预期序列（status + thinking×3 + text + turn_result = 6 事件）', () => {
    expect(all.map((x) => x.ev.type)).toEqual([
      'status',
      'thinking',
      'thinking',
      'thinking',
      'text',
      'turn_result',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. turn2-resume（resume 轮 6 帧：session_id 与 turn1 同值，cacheRead 非零）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / turn2-resume（resume 记忆连续轮）', () => {
  const all = normalizeFixture('turn2-resume');

  it('全部产出过 safeParseAgentEvent', () => {
    expectAllValid(all);
  });

  it('session_started 与 turn_result 的 session_id 均为 resume 入参同值（同一 ID 空间）', () => {
    const started = all.find((x) => x.ev.subtype === 'session_started');
    const turn = all.find((x) => x.ev.type === 'turn_result');
    expect(started?.ev.session_id).toBe('c482aaa1-d2c7-4ec8-816b-6157ef58800f');
    expect(turn?.ev.session_id).toBe('c482aaa1-d2c7-4ec8-816b-6157ef58800f');
  });

  it('text=Zebra-42；usage 服务端恢复历史（cache_read_tokens=15232）', () => {
    const texts = all.filter((x) => x.ev.type === 'text');
    expect(texts.map((x) => x.ev.content)).toEqual(['Zebra-42']);
    const turn = all.find((x) => x.ev.type === 'turn_result');
    expect(turn?.ev.usage).toEqual({
      input_tokens: 186,
      output_tokens: 33,
      cache_read_tokens: 15232,
      cache_creation_tokens: 0,
      // ctx = 186+15232 = 15418——与 turn1 的 15282 跨轮连续（15282 + 轮间增量
      // ≈ 吻合），净值三和口径的 fixture 实证
      ctx_tokens: 15418,
    });
  });

  it('事件序列：status + thinking + text + turn_result（delta×1 + completed 吸收）', () => {
    expect(all.map((x) => x.ev.type)).toEqual([
      'status',
      'thinking',
      'text',
      'turn_result',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. create-chat-probe（12 帧：create-chat ID 作 --resume；thinking 7 delta）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / create-chat-probe（create-chat 兜底 ID 轮）', () => {
  const all = normalizeFixture('create-chat-probe');

  it('全部产出过 safeParseAgentEvent', () => {
    expectAllValid(all);
  });

  it('session_id = create-chat 裸 UUID（与 --resume 入参同空间）', () => {
    const started = all.find((x) => x.ev.subtype === 'session_started');
    expect(started?.ev.session_id).toBe('4567240b-5393-4637-a5ee-f2f1a6f4ee69');
  });

  it('thinking delta×7 同段（segment_id 恒定）；assistant=text pong；result 收尾', () => {
    const thinkings = all.filter((x) => x.ev.type === 'thinking');
    expect(thinkings.length).toBe(7);
    for (const { ev } of thinkings) {
      expect(ev.is_partial).toBe(true);
      expect(ev.segment_id).toBe('cursor:thinking:0');
    }
    expect(
      thinkings.map((x) => x.ev.content).join(''),
    ).toBe(
      'The user requested a reply of exactly "pong".\n\nThe explicit instruction'
        + ' to reply with exactly "pong" overrides the general Chinese response rule.',
    );
    const texts = all.filter((x) => x.ev.type === 'text');
    expect(texts.map((x) => x.ev.content)).toEqual(['pong']);
    const turn = all.find((x) => x.ev.type === 'turn_result');
    expect(turn?.ev.usage).toEqual({
      input_tokens: 6566,
      output_tokens: 90,
      cache_read_tokens: 8704,
      cache_creation_tokens: 0,
      ctx_tokens: 15270, // 净值三和 6566+8704+0
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. tool-use-probe（16 帧：connection/retry 传输帧 + shellToolCall 工具对）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / tool-use-probe（shellToolCall 工具对 + 传输帧）', () => {
  const all = normalizeFixture('tool-use-probe');

  it('全部产出过 safeParseAgentEvent', () => {
    expectAllValid(all);
  });

  it('user/connection/retry/thinking completed → []（第 2/3/4/5/8/14 帧零产出）', () => {
    expect(silentFrames('tool-use-probe')).toEqual([2, 3, 4, 5, 8, 14]);
  });

  it('tool_call/started → tool_use（tool_name=shellToolCall 原生保留 + call_id 一等字段 + 入参 JSON）', () => {
    const uses = all.filter((x) => x.ev.type === 'tool_use');
    expect(uses.length).toBe(1);
    const ev = uses[0]!.ev;
    expect(ev.tool_name).toBe('shellToolCall'); // 判别联合键原生保留不重命名
    // call_id 含字面 \n（task-01 实测），原样透传不拆分
    expect(ev.call_id).toBe(
      'call-220465b0-99ed-4745-ba36-b94992867c3a-0\nfc_381b4c2d-15d7-90f8-ae57-5072300740b6_0',
    );
    const args = JSON.parse(ev.content) as Record<string, unknown>;
    expect(args.command).toBe('echo toolprobe');
    expect(ev.metadata?.tool_input).toMatchObject({ command: 'echo toolprobe' });
    expect(uses[0]!.frameNo).toBe(9);
  });

  it('tool_call/completed → tool_result（call_id 配对 + stdout 进 content + exitCode/executionTime 进 metadata）', () => {
    const results = all.filter((x) => x.ev.type === 'tool_result');
    expect(results.length).toBe(1);
    const ev = results[0]!.ev;
    expect(ev.tool_name).toBe('shellToolCall');
    // 与 tool_use 同 call_id 配对（含字面 \n）
    expect(ev.call_id).toBe(
      'call-220465b0-99ed-4745-ba36-b94992867c3a-0\nfc_381b4c2d-15d7-90f8-ae57-5072300740b6_0',
    );
    expect(ev.content).toBe('toolprobe\n'); // stdout 进 content（stderr 空不拼）
    expect(ev.metadata).toMatchObject({
      tool_output: 'toolprobe\n',
      exitCode: 0,
      executionTime: 709,
      command: 'echo toolprobe',
    });
    // exitCode=0 → 不浮出 is_error
    expect(ev.metadata?.is_error).toBeUndefined();
    expect(results[0]!.frameNo).toBe(10);
  });

  it('ctx 注入时 thinking 段号跨帧推进：工具前段 segment 0，工具后段 segment 1', () => {
    const ctx: CursorNormalizeCtx = {};
    const withCtx = normalizeFixture('tool-use-probe', ctx);
    const thinkings = withCtx.filter((x) => x.ev.type === 'thinking');
    expect(thinkings.length).toBe(5); // 2 delta（前段）+ 3 delta（后段）
    expect(thinkings.slice(0, 2).every((x) => x.ev.segment_id === 'cursor:thinking:0')).toBe(true);
    expect(thinkings.slice(2).every((x) => x.ev.segment_id === 'cursor:thinking:1')).toBe(true);
    expect(ctx.thinkingSegment).toBe(2); // 两段 completed 各 +1
  });

  it('result → turn_result（usage 短名 + session_id；content=最终 assistant 文本）', () => {
    const turn = all.find((x) => x.ev.type === 'turn_result');
    expect(turn?.ev.content).toBe('输出为：\n\n```\ntoolprobe\n```');
    expect(turn?.ev.session_id).toBe('061900b4-226a-422d-8321-ee99214340c6');
    expect(turn?.ev.usage).toEqual({
      input_tokens: 21429,
      output_tokens: 79,
      cache_read_tokens: 9216,
      cache_creation_tokens: 0,
      ctx_tokens: 30645, // 净值三和 21429+9216+0
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. probe-trust-only（14 帧：editToolCall 工具对——result.success 无 stdout/stderr）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / probe-trust-only（editToolCall 写文件工具对）', () => {
  const all = normalizeFixture('probe-trust-only');

  it('全部产出过 safeParseAgentEvent', () => {
    expectAllValid(all);
  });

  it('editToolCall started → tool_use（tool_name=editToolCall 原生保留 + args 入参）', () => {
    const uses = all.filter((x) => x.ev.type === 'tool_use');
    expect(uses.length).toBe(1);
    const ev = uses[0]!.ev;
    expect(ev.tool_name).toBe('editToolCall');
    expect(ev.call_id).toBe(
      'call-3c193697-0416-434a-be79-e98b5642ff9c-0\nfc_c903b362-5736-9b53-ad51-bfdb80919432_0',
    );
    const args = JSON.parse(ev.content) as Record<string, unknown>;
    expect(args.streamContent).toBe('apple\n');
    expect(typeof args.path).toBe('string');
  });

  it('editToolCall completed → tool_result（无 stdout/stderr 时回退 success.message；path/linesAdded 等进 metadata）', () => {
    const results = all.filter((x) => x.ev.type === 'tool_result');
    expect(results.length).toBe(1);
    const ev = results[0]!.ev;
    expect(ev.tool_name).toBe('editToolCall');
    expect(ev.call_id).toBe(
      'call-3c193697-0416-434a-be79-e98b5642ff9c-0\nfc_c903b362-5736-9b53-ad51-bfdb80919432_0',
    );
    // success 形态：{path, linesAdded, linesRemoved, diffString, afterFullFileContent, message}
    expect(ev.content).toContain('Wrote contents to');
    expect(ev.metadata).toMatchObject({ linesAdded: 1, linesRemoved: 0 });
    expect(typeof ev.metadata?.path).toBe('string');
    expect(typeof ev.metadata?.diffString).toBe('string');
  });

  it('两条 assistant 文本块各产一条 text（正在创建 + done）', () => {
    const texts = all.filter((x) => x.ev.type === 'text');
    expect(texts.map((x) => x.ev.content)).toEqual([
      '正在创建 `probe-a.txt`。',
      'done',
    ]);
  });

  it('result → turn_result（usage 短名 + session_id）', () => {
    const turn = all.find((x) => x.ev.type === 'turn_result');
    expect(turn?.ev.session_id).toBe('bdcb1921-ef53-4d7a-9ade-87761c74c8b8');
    expect(turn?.ev.usage).toEqual({
      input_tokens: 14284,
      output_tokens: 117,
      cache_read_tokens: 16896,
      cache_creation_tokens: 0,
      ctx_tokens: 31180, // 净值三和 14284+16896+0
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. probe-no-flags（1 帧：probe_capture 探针记录，非 cursor 帧 → 未知降级桶）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / probe-no-flags（probe_capture 未知帧降级）', () => {
  const all = normalizeFixture('probe-no-flags');

  it('probe_capture → status/task_notification + metadata.original_event_type 保留原值', () => {
    expect(all.length).toBe(1);
    const ev = all[0]!.ev;
    expect(ev.type).toBe('status');
    expect(ev.subtype).toBe('task_notification');
    expect(ev.content).toBe('probe_capture');
    expect(ev.metadata?.original_event_type).toBe('probe_capture');
    // 原帧字段全量平铺进 metadata（不丢）
    expect(ev.metadata?.exit_code).toBe(1);
    expect(ev.metadata?.stdout_frames).toBe(0);
    expectValid(ev);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 边界与防御（手工构造：畸形输入不抛 / 未知帧降级 / usage 守卫 / ctx 语义）
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCursorFrame / 边界与防御', () => {
  it('null / 数字 / 字符串 / 数组 / 缺 type / type 非 string → [] 不抛', () => {
    expect(normalizeCursorFrame(null)).toEqual([]);
    expect(normalizeCursorFrame(undefined)).toEqual([]);
    expect(normalizeCursorFrame(42)).toEqual([]);
    expect(normalizeCursorFrame('just a string')).toEqual([]);
    expect(normalizeCursorFrame([1, 2])).toEqual([]);
    expect(normalizeCursorFrame({})).toEqual([]);
    expect(normalizeCursorFrame({ noType: 1 })).toEqual([]);
    expect(normalizeCursorFrame({ type: 123 })).toEqual([]);
  });

  it('手工构造未知帧 → status/task_notification 降级（content=原 type + 字段平铺）', () => {
    const out = normalizeCursorFrame({ type: 'some_future_frame', foo: 'bar', n: 1 });
    expect(out).toEqual([{
      type: 'status',
      subtype: 'task_notification',
      content: 'some_future_frame',
      metadata: { original_event_type: 'some_future_frame', foo: 'bar', n: 1 },
    }]);
    expectValid(out[0]!);
  });

  it('system 非 init 子型 → []（防御；实测仅 init）', () => {
    expect(normalizeCursorFrame({ type: 'system', subtype: 'other' })).toEqual([]);
  });

  it('assistant message 缺字段/非 text 块/空 text → 零产出或跳过', () => {
    expect(normalizeCursorFrame({ type: 'assistant' })).toEqual([]);
    expect(normalizeCursorFrame({ type: 'assistant', message: 'bad' })).toEqual([]);
    expect(
      normalizeCursorFrame({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x' }, { type: 'text', text: '' }] },
      }),
    ).toEqual([]);
  });

  it('thinking delta 空 text / 未知子型 → []', () => {
    expect(normalizeCursorFrame({ type: 'thinking', subtype: 'delta', text: '' })).toEqual([]);
    expect(normalizeCursorFrame({ type: 'thinking', subtype: 'delta' })).toEqual([]);
    expect(normalizeCursorFrame({ type: 'thinking', subtype: 'mystery' })).toEqual([]);
  });

  it('tool_call 未知子型 → []；缺 tool_call 联合的 started 仍产 tool_use（tool_name=unknown 兜底）', () => {
    expect(
      normalizeCursorFrame({ type: 'tool_call', subtype: 'paused', call_id: 'c1' }),
    ).toEqual([]);
    const out = normalizeCursorFrame({ type: 'tool_call', subtype: 'started', call_id: 'c1' });
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      type: 'tool_use',
      tool_name: 'unknown',
      call_id: 'c1',
      content: '{}',
    });
    expectValid(out[0]!);
  });

  it('tool_call completed 缺 result → tool_result 空 content 兜底不抛', () => {
    const out = normalizeCursorFrame({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'c2',
      tool_call: { shellToolCall: { args: { command: 'x' } } },
    });
    expect(out).toEqual([{
      type: 'tool_result',
      content: '',
      tool_name: 'shellToolCall',
      call_id: 'c2',
      metadata: { tool_output: '' },
    }]);
    expectValid(out[0]!);
  });

  it('tool_result shell exitCode 非零 → metadata.is_error=true 浮出', () => {
    const out = normalizeCursorFrame({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'c3',
      tool_call: {
        shellToolCall: {
          args: { command: 'false' },
          result: { success: { exitCode: 1, stdout: '', stderr: 'boom', executionTime: 5 } },
        },
      },
    });
    expect(out[0]).toMatchObject({
      type: 'tool_result',
      content: 'boom',
      metadata: { is_error: true, exitCode: 1 },
    });
    expectValid(out[0]!);
  });

  it('result usage 非 number 字段不设值不伪造 0；全无效时不挂 usage 键', () => {
    const partial = normalizeCursorFrame({
      type: 'result',
      subtype: 'success',
      result: 'x',
      session_id: 's1',
      usage: { inputTokens: 'NaN-ish', outputTokens: 5, cacheReadTokens: null },
    });
    expect(partial[0]!.usage).toEqual({ output_tokens: 5 });
    expectValid(partial[0]!);

    const none = normalizeCursorFrame({
      type: 'result',
      subtype: 'success',
      result: 'x',
      usage: { inputTokens: 'bad' },
    });
    expect(none[0]!.usage).toBeUndefined();
    expectValid(none[0]!);

    // usage 非对象 → 不挂
    const noUsage = normalizeCursorFrame({ type: 'result', result: 'x', usage: 7 });
    expect(noUsage[0]!.usage).toBeUndefined();
  });

  it('ctx 缺省调用可用（恒定 segment 0）；注入 ctx 后 completed 推进段号', () => {
    // 缺省：零状态
    const d1 = normalizeCursorFrame({ type: 'thinking', subtype: 'delta', text: 'a' });
    const d2 = normalizeCursorFrame({ type: 'thinking', subtype: 'delta', text: 'b' });
    expect(d1[0]!.segment_id).toBe('cursor:thinking:0');
    expect(d2[0]!.segment_id).toBe('cursor:thinking:0');

    // 注入：completed 推进
    const ctx: CursorNormalizeCtx = {};
    normalizeCursorFrame({ type: 'thinking', subtype: 'delta', text: 'a' }, ctx);
    expect(normalizeCursorFrame({ type: 'thinking', subtype: 'completed' }, ctx)).toEqual([]);
    const next = normalizeCursorFrame({ type: 'thinking', subtype: 'delta', text: 'c' }, ctx);
    expect(next[0]!.segment_id).toBe('cursor:thinking:1');
    expect(ctx.thinkingSegment).toBe(1);
  });

  it('缺 session_id 的 system/init 与 result → 不挂 session_id 键（不伪造）', () => {
    const started = normalizeCursorFrame({ type: 'system', subtype: 'init', model: 'Auto' });
    expect(started[0]!.session_id).toBeUndefined();
    expectValid(started[0]!);
    const turn = normalizeCursorFrame({ type: 'result', subtype: 'success', result: 'x' });
    expect(turn[0]!.session_id).toBeUndefined();
    expectValid(turn[0]!);
  });
});
