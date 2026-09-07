// tests/interactive/pi-events.test.ts
// 2026-09-04-provider-pi-onboarding task-01：PiEventNormalizer 归一化用例。
//
// 覆盖（task-01 验收四条）：
//   1. 每事件型映射正确——manual-success-turn fixture 逐行喂 normalizeRpcLine，
//      产出与预期逐字段对照（text_delta 直通 / thinking part / tool_use·tool_result
//      配对 / turn_end usage 四维+cache 两字段 / agent_settled 零产出）；
//   2. 错误路径——real-error-turn fixture（本机实跑采样）：turn_end stopReason=error
//      → error 事件（errorMessage 载体）；extension_error（手工构造，rpc-mode.js:259
//      形状）→ error；message_update+ame.error（流层中止）→ error；顶层 error → error；
//   3. 未知事件降级——不丢不抛（content=原 type，metadata.original_event_type +
//      原字段全量保留），全部产出过 safeParseAgentEvent；
//   4. text_delta 轮内合并（ql-20260904-031）——节流增量 partial+message_end override 全文；
//   5. turnTask 状态机（2026-09-07-pi-task-events task-02）——轮生命周期派生
//      agent_task_status（running/工具刷新/completed/failed）、FR-03 防御补终态、
//      task_id 实例内递增、now 注入走秒；既有 fixture 用例 expected 已按
//      「派生 status 先行、原内容事件随后」适配（R-01 预期适配非破坏）。
//
// 全部产出事件（含内联构造例）逐条过 safeParseAgentEvent（zod 校验，
// agent-event-schema.ts——档C onboarding 清单要求）。
//
// fixture 来源（实跑采样 + 手工构造 + 脱敏）见
// tests/fixtures/pi-rpc-events/README.md。

import { describe, it, expect } from 'vitest';

import { PiEventNormalizer } from '../../src/interactive/pi-events.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import type { AgentEvent } from '../../src/types.js';
import { loadLines } from '../helpers';

/** 逐行归一化整份 fixture，返回 (event, 原始行) 对（含行号定位失败用）。 */
function normalizeFixture(name: string): Array<{ ev: AgentEvent; lineNo: number }> {
  const normalizer = new PiEventNormalizer();
  const out: Array<{ ev: AgentEvent; lineNo: number }> = [];
  const lines = loadLines(`pi-rpc-events/${name}.jsonl`);
  lines.forEach((line, idx) => {
    for (const ev of normalizer.normalizeRpcLine(line)) {
      out.push({ ev, lineNo: idx + 1 });
    }
  });
  return out;
}

/** 断言事件过 zod 校验（失败时打印 issue 定位）。 */
function expectValid(ev: AgentEvent): void {
  const r = safeParseAgentEvent(ev);
  if (!r.success) {
    throw new Error(
      `safeParseAgentEvent failed: ${JSON.stringify(r.error.issues)} on ${JSON.stringify(ev)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 成功轮映射（manual-success-turn.jsonl 逐行逐字段）
// ─────────────────────────────────────────────────────────────────────────────

describe('PiEventNormalizer / manual-success-turn（成功轮逐型映射）', () => {
  const all = normalizeFixture('manual-success-turn');

  it('全部产出过 safeParseAgentEvent', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const { ev } of all) expectValid(ev);
  });

  it('text_delta 轮内合并（ql-20260904-031）：节流窗内 delta 累积、message_end override 全文', () => {
    // fixture 第二次 LLM 调用有两条 text_delta（"Bash " / "已执行成功，输出为 pi-smoke。"）
    // + message_end text part 全文。新语义：500ms 窗外首 delta 起段 flush 增量（partial），
    // message_end 产 override 完整事件（撤 partial+落全文）。
    const texts = all.filter((x) => x.ev.type === 'text' && x.ev.content !== '');
    // 终态断言：必含 override 完整事件（全文），且不再有"逐 delta 碎片直通"
    const overrides = texts.filter((x) => x.ev.override === true);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    expect(overrides.map((x) => x.ev.content)).toContain('Bash 已执行成功，输出为 pi-smoke。'.slice(0, Math.min(30, 'Bash 已执行成功，输出为 pi-smoke。'.length)) );
    for (const { ev } of overrides) {
      expect(ev.is_partial).toBeUndefined();
      expect(typeof ev.segment_id).toBe('string');
    }
    // partial 事件（若有 flush）带 is_partial+segment_id
    for (const { ev } of texts.filter((x) => x.ev.is_partial === true)) {
      expect(typeof ev.segment_id).toBe('string');
      expect(ev.override).toBeUndefined();
    }
  });

  it('轮内合并·快照增量+节流+乱序免疫（ql-20260904-031 内联）', () => {
    // 可注入时钟：t=0 起，500ms 节流窗。
    let t = 0;
    const n = new PiEventNormalizer({ flushIntervalMs: 500, now: () => t });
    const mk = (delta: string, snap: string, ci = 1) =>
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: ci, delta, partial: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: snap }] } },
      });
    const start = JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(n.normalizeRpcLine(start)).toEqual([]);
    // t=0：首个 delta（快照"你好"）→ 起段 flush "你好"（partial）
    let out = n.normalizeRpcLine(mk('你好', '你好'));
    expect(out).toEqual([{ type: 'text', content: '你好', is_partial: true, segment_id: 'pi:msg0:ci1' }]);
    // t=100（窗内）：快照"你好世界" → 累积不 flush
    t = 100;
    out = n.normalizeRpcLine(mk('世界', '你好世界'));
    expect(out).toEqual([]);
    // t=499（仍窗内）
    t = 499;
    out = n.normalizeRpcLine(mk('！', '你好世界！'));
    expect(out).toEqual([]);
    // t=600（窗外）：flush 增量"世界！"（快照-已flush）
    t = 600;
    out = n.normalizeRpcLine(mk('。', '你好世界！。'));
    expect(out).toEqual([{ type: 'text', content: '世界！。', is_partial: true, segment_id: 'pi:msg0:ci1' }]);
    // 乱序旧快照（长度回缩）→ 忽略
    out = n.normalizeRpcLine(mk('旧', '你好'));
    expect(out).toEqual([]);
    // message_end → override 全文（撤 partial+落完整行）
    out = n.normalizeRpcLine(JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '完整思考' }, { type: 'text', text: '你好世界！。终态' }] },
    }));
    const textEv = out.find((e) => e.type === 'text');
    expect(textEv).toMatchObject({ type: 'text', content: '你好世界！。终态', override: true, segment_id: 'pi:msg0:ci1' });
    expect(out.find((e) => e.type === 'thinking')).toMatchObject({ type: 'thinking', content: '完整思考' });
  });

  it('跨消息 contentIndex 重号不串段（ql-20260905-001）：第二条消息从零起段，turn_end 全清', () => {
    // 事故形状：两条 assistant text 消息同用 ci0（真实 fixture 两消息均 ci0）。
    // 旧实现 segment 键只有 ci0——第二条消息继承第一条的 flushedLen →
    // 快照长度 ≤ 遗留值时 partial 全被压制（或从错误偏移截取）。
    let t = 0;
    const n = new PiEventNormalizer({ flushIntervalMs: 500, now: () => t });
    const start = JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const mk = (snap: string, ci = 0) =>
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: ci,
          delta: snap,
          partial: { role: 'assistant', content: [{ type: 'text', text: snap }] },
        },
      });

    // 第一条消息：起段 flush + message_end override（并清当前消息段）。
    expect(n.normalizeRpcLine(start)).toEqual([]);
    expect(n.normalizeRpcLine(mk('第一段'))).toEqual([
      { type: 'text', content: '第一段', is_partial: true, segment_id: 'pi:msg0:ci0' },
    ]);
    expect(
      n.normalizeRpcLine(
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: '第一段终态' }] },
        }),
      ),
    ).toMatchObject([{ type: 'text', content: '第一段终态', override: true, segment_id: 'pi:msg0:ci0' }]);

    // 第二条消息（同 ci0）：必须从零起段正常 flush——旧键撞车时
    // 「第二条」（3 字）≤ 遗留 flushedLen（3 字）→ 被长度守卫全吞。
    t = 1000;
    expect(n.normalizeRpcLine(start)).toEqual([]);
    let out = n.normalizeRpcLine(mk('第二条'));
    expect(out).toEqual([
      { type: 'text', content: '第二条', is_partial: true, segment_id: 'pi:msg1:ci0' },
    ]);

    // turn_end 全清记账：下一 turn 从零起段（message_end 丢帧的兜底）。
    t = 2000;
    expect(n.normalizeRpcLine(JSON.stringify({ type: 'turn_end', message: {} }))).toEqual([]);
    expect(n.normalizeRpcLine(start)).toEqual([]);
    out = n.normalizeRpcLine(mk('新turn'));
    expect(out).toEqual([
      { type: 'text', content: '新turn', is_partial: true, segment_id: 'pi:msg2:ci0' },
    ]);
  });

  it('message_end thinking part → thinking（每 part 一事件，逐字段）', () => {
    const thinkings = all.filter((x) => x.ev.type === 'thinking');
    expect(thinkings.length).toBe(1);
    const ev = thinkings[0]!.ev;
    // fixture 的 thinking part：{type:'thinking', thinking:'用户要求执行 echo 并汇报。……'}
    expect(ev.content).toBe(
      '用户要求执行 echo 并汇报。我将调用 bash 工具运行该命令，然后转述输出。',
    );
    expectValid(ev);
  });

  it('tool_execution_start → tool_use（tool_name/call_id 一等 + 入参 JSON + tool_input）', () => {
    const uses = all.filter((x) => x.ev.type === 'tool_use');
    expect(uses.length).toBe(1);
    const ev = uses[0]!.ev;
    expect(ev.tool_name).toBe('bash');
    expect(ev.call_id).toBe('call-7f3a');
    expect(ev.content).toBe(JSON.stringify({ command: 'echo pi-smoke' }));
    expect(ev.metadata).toEqual({ tool_input: { command: 'echo pi-smoke' } });
    expectValid(ev);
  });

  it('tool_execution_end → tool_result（call_id 配对 + result.content[].text 提取 + is_error）', () => {
    const results = all.filter((x) => x.ev.type === 'tool_result');
    expect(results.length).toBe(1);
    const ev = results[0]!.ev;
    expect(ev.tool_name).toBe('bash');
    expect(ev.call_id).toBe('call-7f3a'); // 与 tool_use 同 call_id 配对
    expect(ev.content).toBe('pi-smoke\n');
    expect(ev.metadata).toEqual({ tool_output: 'pi-smoke\n', is_error: false });
    expect(ev.edit_patch).toBeUndefined(); // pi 无结构化 patch（design §3 非目标）
    expectValid(ev);
  });

  it('turn_end → usage 快照（四维 + cache 两字段，cacheWrite→cache_creation 口径）', () => {
    const usageEvents = all.filter(
      (x) => x.ev.type === 'text' && x.ev.content === '' && x.ev.usage !== undefined,
    );
    expect(usageEvents.length).toBe(1);
    const ev = usageEvents[0]!.ev;
    // fixture turn_end.usage：input=520 output=64 cacheRead=1024 cacheWrite=256
    expect(ev.usage).toEqual({
      input_tokens: 520,
      output_tokens: 64,
      cache_read_tokens: 1024,
      cache_creation_tokens: 256, // pi cacheWrite = Anthropic cache_creation（批量口径）
    });
    expect(ev.metadata).toEqual({
      status: 'usage_update',
      usage: {
        input_tokens: 520,
        output_tokens: 64,
        cache_read_tokens: 1024,
        cache_creation_tokens: 256,
      },
    });
    expectValid(ev);
  });

  it('已知生命周期型零产出（agent_start/message_start/tool_execution_update/agent_settled 等）', () => {
    // fixture 全部事件中，无产出的已知型：agent_start、message_start×2、
    // thinking 三段等 message_update 子事件、tool_execution_update、节流窗内
    // text_delta×3、agent_end、agent_settled —— 共 14 行
    // （2026-09-07-pi-task-events：turn_start 现派生 running status，不再静默）
    const producing = new Set(all.map((x) => x.lineNo));
    const lines = loadLines('pi-rpc-events/manual-success-turn.jsonl');
    const silentLines = lines.filter((_l, i) => !producing.has(i + 1));
    expect(silentLines.length).toBe(14);
  });

  it('产出全集恰为预期序列（9 事件：派生 status×3 + thinking + tool_use + tool_result + 2×text + usage）', () => {
    expect(all.map((x) => x.ev.type)).toEqual([
      'status', // turn_start → 派生 agent_task_status(running)（2026-09-07-pi-task-events）
      'thinking', // message_end（第一次调用：thinking part）
      'status', // tool_execution_start → 派生 agent_task_status(running) 刷新（status 先行）
      'tool_use', // tool_execution_start
      'tool_result', // tool_execution_end（派生零事件）
      'text', // text_delta 起段 flush
      'text', // message_end override 全文
      'status', // turn_end → 派生 agent_task_status(completed)（status 先行）
      'text', // turn_end → usage 快照（空 text 载体）
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 错误路径（real-error-turn 实跑采样 + extension_error/ame.error 手工例）
// ─────────────────────────────────────────────────────────────────────────────

describe('PiEventNormalizer / real-error-turn（实跑采样错误路径）', () => {
  const all = normalizeFixture('real-error-turn');

  it('全部产出过 safeParseAgentEvent', () => {
    for (const { ev } of all) expectValid(ev);
  });

  it('turn_end stopReason=error → error 事件（errorMessage 载体，实跑证实）', () => {
    const errors = all.filter((x) => x.ev.type === 'error');
    expect(errors.length).toBe(1);
    const ev = errors[0]!.ev;
    // 采样日 429 限额错误原文（脱敏不含凭证）
    expect(ev.content).toContain('429');
    expect(ev.content).toContain('使用上限');
  });

  it('错误轮 turn_end 仍产出全零 usage 快照（用量事实如实透传）', () => {
    const usageEvents = all.filter(
      (x) => x.ev.type === 'text' && x.ev.content === '' && x.ev.usage !== undefined,
    );
    expect(usageEvents.length).toBe(1);
    expect(usageEvents[0]!.ev.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  it('实跑事件序（turn_start/user 消息/turn_end 派生 status + error + usage；其余生命周期行零产出）', () => {
    // 修剪后的实跑 fixture：turn_start 一行派生 running status；message_start(user)
    // 一行派生任务名刷新（ql-20260907-011）；turn_end 一行产出
    // failed status（先行）+ error + 全零 usage 快照；其余 8 行零产出
    expect(all.length).toBe(5);
    expect(all.map((x) => x.ev.type)).toEqual(['status', 'status', 'status', 'error', 'text']);
    // 任务名升级断言：user 指令摘要覆盖缺省名（第 2 个 status 事件）
    const nameEv = all[1]!.ev;
    expect(nameEv.type === 'status' && nameEv.metadata?.task_name).toBeTruthy();
  });
});

describe('PiEventNormalizer / 错误型（内联构造：rpc 层形状）', () => {
  const normalizer = new PiEventNormalizer();

  it('extension_error → error（rpc-mode.js:259 形状，原字段进 metadata）', () => {
    const line = JSON.stringify({
      type: 'extension_error',
      extensionPath: '/home/<redacted>/example-ext/index.ts',
      event: 'session_before_prompt',
      error: "TypeError: Cannot read properties of undefined (reading 'x')",
    });
    const out = normalizer.normalizeRpcLine(line);
    expect(out.length).toBe(1);
    expect(out[0]!.type).toBe('error');
    expect(out[0]!.content).toBe(
      'extension error (/home/<redacted>/example-ext/index.ts) in session_before_prompt: '
        + "TypeError: Cannot read properties of undefined (reading 'x')",
    );
    expect(out[0]!.metadata).toEqual({
      original_event_type: 'extension_error',
      extension_path: '/home/<redacted>/example-ext/index.ts',
      extension_event: 'session_before_prompt',
      extension_error: "TypeError: Cannot read properties of undefined (reading 'x')",
    });
    expectValid(out[0]!);
  });

  it('message_update + ame.error → error（流层中止，errorMessage 优先）', () => {
    const line = JSON.stringify({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'error',
        reason: 'aborted',
        error: { role: 'assistant', errorMessage: 'request aborted by user' },
      },
    });
    const out = normalizer.normalizeRpcLine(line);
    expect(out).toEqual([{ type: 'error', content: 'request aborted by user' }]);
    expectValid(out[0]!);
  });

  it('message_update + ame.error 无 errorMessage → reason 兜底', () => {
    const line = JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'error', reason: 'error', error: {} },
    });
    expect(normalizer.normalizeRpcLine(line)).toEqual([
      { type: 'error', content: 'assistant stream error' },
    ]);
  });

  it('顶层 error（批量 pi-json 实测词汇）→ error（message > name 兜底链）', () => {
    const withMessage = normalizer.normalizeRpcLine(
      JSON.stringify({ type: 'error', error: { message: 'boom', name: 'Err' } }),
    );
    expect(withMessage).toEqual([{ type: 'error', content: 'boom' }]);

    const withNameOnly = normalizer.normalizeRpcLine(
      JSON.stringify({ type: 'error', error: { name: 'ProviderError' } }),
    );
    expect(withNameOnly).toEqual([{ type: 'error', content: 'ProviderError' }]);

    const withBare = normalizer.normalizeRpcLine(JSON.stringify({ type: 'error' }));
    expect(withBare).toEqual([{ type: 'error', content: 'unknown error' }]);
    for (const ev of [...withMessage, ...withNameOnly, ...withBare]) expectValid(ev);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 未知事件降级 + 边界（fail-safe 不丢不抛）
// ─────────────────────────────────────────────────────────────────────────────

describe('PiEventNormalizer / 未知事件降级与边界', () => {
  const normalizer = new PiEventNormalizer();

  it('未知事件 → status/task_notification 降级（content=原 type，原字段全量保留）', () => {
    const line = JSON.stringify({ type: 'some_future_event', foo: 'bar', count: 42 });
    const out = normalizer.normalizeRpcLine(line);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({
      type: 'status',
      subtype: 'task_notification',
      content: 'some_future_event',
      metadata: {
        original_event_type: 'some_future_event',
        foo: 'bar',
        count: 42,
      },
    });
    expectValid(out[0]!); // status 必带闭合枚举 subtype（schema superRefine）
  });

  it('未知事件降级在 fixture 内联覆盖（manual-rpc-extras 第二行）', () => {
    const all = normalizeFixture('manual-rpc-extras');
    // 第一行 extension_error → error；第二行未知事件 → status 降级
    expect(all.map((x) => x.ev.type)).toEqual(['error', 'status']);
    expect(all[1]!.ev.content).toBe('some_future_event');
    for (const { ev } of all) expectValid(ev);
  });

  it('坏 JSON / 非对象 / 空 type → 空数组不抛', () => {
    expect(normalizer.normalizeRpcLine('')).toEqual([]);
    expect(normalizer.normalizeRpcLine('   ')).toEqual([]);
    expect(normalizer.normalizeRpcLine('{broken json')).toEqual([]);
    expect(normalizer.normalizeRpcLine('"just a string"')).toEqual([]);
    expect(normalizer.normalizeRpcLine('123')).toEqual([]);
    expect(normalizer.normalizeRpcLine('{"noType":1}')).toEqual([]);
    expect(normalizer.normalizeRpcLine('{"type":123}')).toEqual([]);
  });

  it('缺字段的畸形已知事件不抛（防御守卫）', () => {
    // tool_execution_end 无 result → 空 content
    expect(
      normalizer.normalizeRpcLine(
        JSON.stringify({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash' }),
      ),
    ).toEqual([
      {
        type: 'tool_result',
        content: '',
        tool_name: 'bash',
        call_id: 'c1',
        metadata: { tool_output: '', is_error: false },
      },
    ]);
    // message_end message 非对象 → 零产出
    expect(
      normalizer.normalizeRpcLine(JSON.stringify({ type: 'message_end' })),
    ).toEqual([]);
    // turn_end 无 message 且无前序 turn_start → 零产出：无 running 行时派生
    // 防御跳过（2026-09-07-pi-task-events）+ 无 usage 载体，[] 即防御语义守护
    expect(normalizer.normalizeRpcLine(JSON.stringify({ type: 'turn_end' }))).toEqual([]);
    // message_update 无 assistantMessageEvent → 零产出
    expect(
      normalizer.normalizeRpcLine(JSON.stringify({ type: 'message_update' })),
    ).toEqual([]);
    // text_delta 空 delta → 跳过
    expect(
      normalizer.normalizeRpcLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: '' },
        }),
      ),
    ).toEqual([]);
  });

  it('usage 非数值字段按 0 容错（numOr0 守卫）', () => {
    // 先开一行任务：有 running 行时 turn_end(stop) 会先派生 completed status
    // （2026-09-07-pi-task-events R-01 适配：status 先行、usage 快照随后）
    const opened = normalizer.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(opened.length).toBe(1);
    expect(opened[0]!.metadata).toMatchObject({ task_id: 'pi-t1', status: 'running' });
    const line = JSON.stringify({
      type: 'turn_end',
      message: {
        role: 'assistant',
        usage: { input: 'NaN-ish', output: 5, cacheRead: null, cacheWrite: {} },
        stopReason: 'stop',
      },
    });
    const out = normalizer.normalizeRpcLine(line);
    expect(out.length).toBe(2);
    expect(out[0]!.metadata).toMatchObject({ task_id: 'pi-t1', status: 'completed', tool_uses: 0 });
    expect(out[1]!.usage).toEqual({
      input_tokens: 0,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. turnTask 状态机（2026-09-07-pi-task-events task-02：派生 agent_task_status）
//    每测试独立 normalizer 实例 + now 注入时钟（elapsed_ms 可断言走秒）。
// ─────────────────────────────────────────────────────────────────────────────

describe('PiEventNormalizer / turnTask 状态机（轮生命周期派生 agent_task_status）', () => {
  it('完整轮：turn_start→tool_execution_start×2→tool_execution_end→turn_end(stop) → running→刷新→completed', () => {
    let t = 1_000;
    const n = new PiEventNormalizer({ now: () => t });

    // turn_start → running（task_id=pi-t1；task_name 保守命名'执行任务'）
    const startOut = n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(startOut).toEqual([
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: '',
        metadata: { task_id: 'pi-t1', task_name: '执行任务', status: 'running' },
      },
    ]);

    // 第 1 个工具：running 刷新（tool_uses=1 + last_tool_name + summary）
    t = 1_500;
    const tool1 = n.normalizeRpcLine(
      JSON.stringify({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'c1', args: { path: 'a.ts' } }),
    );
    expect(tool1.length).toBe(2); // 派生 status 先行 + tool_use 内容事件
    expect(tool1[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '正在调用 read',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'running',
        last_tool_name: 'read',
        summary: '正在调用 read',
        tool_uses: 1,
      },
    });
    expect(tool1[1]!.type).toBe('tool_use');

    // 第 2 个工具：再次刷新（tool_uses=2）
    t = 2_000;
    const tool2 = n.normalizeRpcLine(
      JSON.stringify({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'c2', args: { command: 'ls' } }),
    );
    expect(tool2.length).toBe(2);
    expect(tool2[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '正在调用 bash',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'running',
        last_tool_name: 'bash',
        summary: '正在调用 bash',
        tool_uses: 2,
      },
    });

    // tool_execution_end：零派生事件（tool_uses 已在 start 计；工具成败≠任务成败）
    t = 2_500;
    const toolEnd = n.normalizeRpcLine(
      JSON.stringify({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'c2', result: 'ok' }),
    );
    expect(toolEnd.length).toBe(1);
    expect(toolEnd[0]!.type).toBe('tool_result');

    // turn_end(stop) → completed（status 先行 + usage 快照随后）；
    // elapsed_ms 走秒断言：started 基准 t=1_000，收行 t=5_000 → 4_000
    t = 5_000;
    const endOut = n.normalizeRpcLine(
      JSON.stringify({
        type: 'turn_end',
        message: { role: 'assistant', stopReason: 'stop', usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 } },
      }),
    );
    expect(endOut.length).toBe(2);
    expect(endOut[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'completed',
        last_tool_name: 'bash',
        elapsed_ms: 4_000,
        tool_uses: 2,
      },
    });
    expect(endOut[1]!.type).toBe('text'); // usage 快照（既有语义不变）
    for (const ev of [...startOut, ...tool1, ...tool2, ...toolEnd, ...endOut]) expectValid(ev);
  });

  it('错误轮：turn_end stopReason=error → failed（summary=errorMessage，elapsed_ms 走秒）', () => {
    let t = 100;
    const n = new PiEventNormalizer({ now: () => t });
    expect(n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' })).length).toBe(1);

    t = 700; // 600ms 后失败
    const out = n.normalizeRpcLine(
      JSON.stringify({
        type: 'turn_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: '429 已达到使用上限' },
      }),
    );
    expect(out.length).toBe(2); // failed status 先行 + error 内容事件
    expect(out[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '429 已达到使用上限',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'failed',
        summary: '429 已达到使用上限',
        elapsed_ms: 600,
        tool_uses: 0,
      },
    });
    expect(out[1]).toEqual({ type: 'error', content: '429 已达到使用上限' });
    for (const ev of out) expectValid(ev);
  });

  it('FR-03 防御：上轮缺 turn_end 时新 turn_start 先补 completed(pi-t1) 再开 running(pi-t2)', () => {
    let t = 1_000;
    const n = new PiEventNormalizer({ now: () => t });
    // 第一轮开启后未收 turn_end（异常流：turn_end 丢失）
    expect(n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' })).length).toBe(1);

    t = 3_000;
    const out = n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'completed', // 防御补终态，不产生悬挂 running
        elapsed_ms: 2_000,
        tool_uses: 0,
      },
    });
    expect(out[1]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: '',
      metadata: { task_id: 'pi-t2', task_name: '执行任务', status: 'running' },
    });
    for (const ev of out) expectValid(ev);
  });

  it('error 帧仅置 pendingError 零新增派生；FR-03 补 completed 时 summary 带出错误', () => {
    let t = 1_000;
    const n = new PiEventNormalizer({ now: () => t });
    expect(n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' })).length).toBe(1);

    // 顶层 error：error 内容事件照旧，无新增派生事件（派生规则表第 6 行）
    t = 2_000;
    const errOut = n.normalizeRpcLine(JSON.stringify({ type: 'error', error: { message: 'boom' } }));
    expect(errOut).toEqual([{ type: 'error', content: 'boom' }]);

    // 下一轮 turn_start：补 completed(pi-t1, summary=pendingError) + running(pi-t2)
    t = 2_500;
    const out = n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({
      type: 'status',
      subtype: 'agent_task_status',
      content: 'boom',
      metadata: {
        task_id: 'pi-t1',
        task_name: '执行任务',
        status: 'completed',
        summary: 'boom',
        elapsed_ms: 1_500,
        tool_uses: 0,
      },
    });
    expect(out[1]!.metadata).toMatchObject({ task_id: 'pi-t2', status: 'running' });
    for (const ev of [...errOut, ...out]) expectValid(ev);
  });

  it('task_id 实例内递增；无 running 行时工具/turn_end 防御跳过派生（仅内容事件）', () => {
    const n = new PiEventNormalizer();
    // 无前序 turn_start：tool_execution_start 防御跳过派生（仅 tool_use）
    const orphanTool = n.normalizeRpcLine(
      JSON.stringify({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'c0', args: {} }),
    );
    expect(orphanTool.length).toBe(1);
    expect(orphanTool[0]!.type).toBe('tool_use');
    // 孤立 turn_end（无前序 turn_start）→ 零产出（防御跳过）
    expect(
      n.normalizeRpcLine(JSON.stringify({ type: 'turn_end', message: { stopReason: 'stop' } })),
    ).toEqual([]);

    // 两轮依次开行：pi-t1 → pi-t2 递增（上一轮未收尾走 FR-03 补 completed）
    const t1 = n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(t1.length).toBe(1);
    expect(t1[0]!.metadata).toMatchObject({ task_id: 'pi-t1', status: 'running' });
    const t2 = n.normalizeRpcLine(JSON.stringify({ type: 'turn_start' }));
    expect(t2.length).toBe(2);
    expect(t2.map((e) => (e.metadata as Record<string, unknown>).task_id)).toEqual(['pi-t1', 'pi-t2']);
    expect(t2.map((e) => (e.metadata as Record<string, unknown>).status)).toEqual(['completed', 'running']);

    // 有 running 行时 tool_execution_end 仍零任务事件（仅 tool_result）
    const toolEnd = n.normalizeRpcLine(
      JSON.stringify({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'c1', result: 'ok' }),
    );
    expect(toolEnd.length).toBe(1);
    expect(toolEnd[0]!.type).toBe('tool_result');
    for (const ev of [...orphanTool, ...t1, ...t2, ...toolEnd]) expectValid(ev);
  });
});
