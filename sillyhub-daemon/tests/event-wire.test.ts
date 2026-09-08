/**
 * tests/event-wire.test.ts —— task-04 轻重构②定向测试（design §5 Wave 1 / FR-05）。
 *
 * 断言收敛后「同一 AgentEvent 输入下 event-wire 核心输出与两消费方输出一致」且
 * 与收敛前语义逐字节等价（golden 字面量 = 收敛前 events.ts eventToReportDict /
 * task-runner.ts _eventToMessages 的实现口径）：
 *   - session-manager events.ts eventToReportDict（seq 补号 + 委托核心）；
 *   - task-runner facade _eventToMessages（委托核心）。
 * 典型事件类型覆盖：result（complete）/ message（text 系）/ system（status 型）等。
 */

import { describe, expect, it } from 'vitest';

import {
  eventToReportWireDict,
  eventToSubmitMessages,
} from '../src/event-wire.js';
import { eventToReportDict } from '../src/interactive/session-manager/events.js';
import type { SessionManagerCore } from '../src/interactive/session-manager/types.js';
import type { SessionState } from '../src/interactive/types.js';
import { TaskRunner } from '../src/task-runner.js';
import type { AgentEvent } from '../src/types.js';

/** eventToReportDict 最小 mgr 桩（仅需 _turnEventSeq 补号表）。 */
function makeStubMgr(): SessionManagerCore {
  return { _turnEventSeq: new Map<string, number>() } as unknown as SessionManagerCore;
}

function makeStubState(sessionId = 's1'): SessionState {
  return { sessionId } as unknown as SessionState;
}

/** 逐字节等价断言：JSON.stringify 键序敏感比较。 */
function expectWireEqual(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

// ── 事件轨 report dict（session-manager 侧核心）────────────────────────────

describe('eventToReportWireDict（AgentEvent v2 一等字段蛇形平铺）', () => {
  it('稀疏事件：仅基础四列（event_type/type/content/seq）', () => {
    expectWireEqual(eventToReportWireDict({ type: 'text', content: 'hi' }, 3), {
      event_type: 'text',
      type: 'text',
      content: 'hi',
      seq: 3,
    });
  });

  it('全一等字段：12 列条件平铺 + metadata 非空才带（键序对齐收敛前）', () => {
    const usage = { input_tokens: 1, output_tokens: 2 };
    const metadata = { model: 'glm' };
    const ev: AgentEvent = {
      type: 'status',
      content: '',
      subtype: 'session_started',
      tool_name: 'Bash',
      call_id: 'c1',
      session_id: 'as1',
      usage,
      parent_tool_use_id: 'p1',
      subagent_type: 'general',
      depth: 2,
      segment_id: 'seg1',
      is_partial: true,
      override: false,
      edit_patch: '{}',
      metadata,
    };
    expectWireEqual(eventToReportWireDict(ev, 7), {
      event_type: 'status',
      type: 'status',
      content: '',
      seq: 7,
      subtype: 'session_started',
      tool_name: 'Bash',
      call_id: 'c1',
      session_id: 'as1',
      usage,
      parent_tool_use_id: 'p1',
      subagent_type: 'general',
      depth: 2,
      segment_id: 'seg1',
      is_partial: true,
      override: false,
      edit_patch: '{}',
      metadata,
    });
  });

  it('空 metadata 对象省略；undefined 字段全部省略', () => {
    const dict = eventToReportWireDict({ type: 'text', content: 'x', metadata: {} }, 1);
    expectWireEqual(dict, { event_type: 'text', type: 'text', content: 'x', seq: 1 });
    expect('metadata' in dict).toBe(false);
  });
});

describe('eventToReportDict（session-manager 消费方委托核心）', () => {
  it('事件自带 seq → 透传不覆盖；输出与核心逐字节一致', () => {
    const ev: AgentEvent = { type: 'tool_use', content: '{"a":1}', seq: 42, tool_name: 'Bash' };
    const viaConsumer = eventToReportDict(makeStubMgr(), makeStubState(), ev);
    expectWireEqual(viaConsumer, eventToReportWireDict(ev, 42));
    expect(viaConsumer['seq']).toBe(42);
  });

  it('事件缺 seq → SessionManager 补号（1 起单调递增，per-session 隔离）', () => {
    const mgr = makeStubMgr();
    const d1 = eventToReportDict(mgr, makeStubState('s1'), { type: 'text', content: 'a' });
    const d2 = eventToReportDict(mgr, makeStubState('s1'), { type: 'text', content: 'b' });
    const dOther = eventToReportDict(mgr, makeStubState('s2'), { type: 'text', content: 'c' });
    expect(d1['seq']).toBe(1);
    expect(d2['seq']).toBe(2);
    expect(dOther['seq']).toBe(1); // 另一会话独立计数
    expectWireEqual(d1, eventToReportWireDict({ type: 'text', content: 'a' }, 1));
  });
});

// ── submit_messages message dict（task-runner 侧核心）──────────────────────

describe('eventToSubmitMessages（1:N 渲染，1:1 复现老 SERVER 路径格式）', () => {
  it('text → 1 条 [ASSISTANT] (stdout)；业务三列（session_id/call_id/usage ← metadata）注入首条', () => {
    const usage = { input_tokens: 5, output_tokens: 6 };
    const msgs = eventToSubmitMessages({
      type: 'text',
      content: 'hello world',
      metadata: { session_id: 'as1', call_id: 'c1', usage },
    });
    expectWireEqual(msgs, [
      {
        event_type: 'text',
        content: '[ASSISTANT] hello world',
        channel: 'stdout',
        session_id: 'as1',
        call_id: 'c1',
        usage: { ...usage },
      },
    ]);
  });

  it('usage 为浅拷贝（不与 metadata 共享可变引用）', () => {
    const usage = { input_tokens: 5 };
    const msgs = eventToSubmitMessages({ type: 'text', content: 'x', metadata: { usage } });
    expect(msgs![0]!['usage']).not.toBe(usage);
    expect(msgs![0]!['usage']).toEqual(usage);
  });

  it('thinking → [THINKING] 前缀 + 20000 截断追加省略号', () => {
    const short = eventToSubmitMessages({ type: 'text', content: 'deep', metadata: { thinking: true } });
    expectWireEqual(short, [{ event_type: 'text', content: '[THINKING] deep', channel: 'stdout' }]);

    const long = eventToSubmitMessages({ type: 'text', content: 'x'.repeat(20_001), metadata: { thinking: true } });
    expect((long![0]!['content'] as string).length).toBe('[THINKING] '.length + 20_000 + 3);
    expect((long![0]!['content'] as string).endsWith('...')).toBe(true);
  });

  it('streaming delta → 原始文本不加前缀；usage_update → 空 content 透传', () => {
    expectWireEqual(
      eventToSubmitMessages({ type: 'text', content: 'de', metadata: { streaming: true } }),
      [{ event_type: 'text', content: 'de', channel: 'stdout' }],
    );
    expectWireEqual(
      eventToSubmitMessages({ type: 'text', content: '', metadata: { status: 'usage_update' } }),
      [{ event_type: 'text', content: '', channel: 'stdout' }],
    );
  });

  it('system → [SYSTEM:<subtype>] 截断 2000；log → [LOG:<level>] stderr 级', () => {
    expectWireEqual(
      eventToSubmitMessages({ type: 'text', content: 'session=x', metadata: { status: 'system', subtype: 'init' } }),
      [{ event_type: 'text', content: '[SYSTEM:init] session=x', channel: 'stdout' }],
    );
    // subtype 缺失 → unknown
    expectWireEqual(
      eventToSubmitMessages({ type: 'text', content: 'y', metadata: { status: 'system' } }),
      [{ event_type: 'text', content: '[SYSTEM:unknown] y', channel: 'stdout' }],
    );
    expectWireEqual(
      eventToSubmitMessages({ type: 'text', content: 'boom', metadata: { log: true, level: 'error' } }),
      [{ event_type: 'text', content: '[LOG:error] boom', channel: 'stderr' }],
    );
  });

  it('空 content + 非 thinking/system/log → null（对齐老空消息丢弃语义）', () => {
    expect(eventToSubmitMessages({ type: 'text', content: '' })).toBeNull();
  });

  it('tool_use 审批拒绝 → [APPROVAL:DECLINE] 中文理由（stderr）', () => {
    expectWireEqual(
      eventToSubmitMessages({
        type: 'tool_use',
        content: '',
        metadata: { tool_name: 'Write', approval_decision: 'decline', deny_reason: '越权路径' },
      }),
      [{ event_type: 'tool_use', content: '[APPROVAL:DECLINE] Write\n越权路径', channel: 'stderr' }],
    );
  });

  it('tool_use → 2 条：[TOOL_USE] stdout 行 + tool_call JSON（tool_use_id 多键兼容 + call_id 注入首条）', () => {
    const msgs = eventToSubmitMessages({
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        call_id: 'call_9', // 旧字段名兜底（md.tool_use_id / md.id 优先）
        session_id: 'as1',
      },
    });
    expect(msgs).toHaveLength(2);
    expectWireEqual(msgs![0], {
      event_type: 'tool_use',
      content: '[TOOL_USE] Bash: ls -la',
      channel: 'stdout',
      session_id: 'as1',
      call_id: 'call_9',
    });
    const tc = JSON.parse(msgs![1]!['content'] as string) as Record<string, unknown>;
    expect(tc['tool']).toBe('Bash');
    expect(tc['tool_use_id']).toBe('call_9'); // call_id 键兜底命中
    expect(tc['args']).toEqual({ command: 'ls -la' });
    expect(tc['status']).toBe('allowed');
    expect(tc['success']).toBe(true);
    expect(typeof tc['timestamp']).toBe('string');
    expect(msgs![1]!['channel']).toBe('tool_call');
  });

  it('tool_use 无 command → args JSON 序列化；tool_input 非对象退化 {}', () => {
    const msgs = eventToSubmitMessages({
      type: 'tool_use',
      content: '',
      metadata: { tool_name: 'Read', tool_input: { file_path: '/a' } },
    });
    expect((msgs![0]!['content'] as string)).toBe('[TOOL_USE] Read: {"file_path":"/a"}');
    const degenerate = eventToSubmitMessages({
      type: 'tool_use',
      content: '',
      metadata: { tool_name: 'Read', tool_input: 'not-object' },
    });
    const tc = JSON.parse(degenerate![1]!['content'] as string) as Record<string, unknown>;
    expect(tc['args']).toEqual({});
    expect('tool_use_id' in tc).toBe(false); // 无 id → 字段省略（退化保持原形状）
  });

  it('tool_result → [TOOL_RESULT] 截断 100000 + 中文标注', () => {
    expectWireEqual(
      eventToSubmitMessages({ type: 'tool_result', content: 'ok' }),
      [{ event_type: 'tool_result', content: '[TOOL_RESULT] ok', channel: 'stdout' }],
    );
    const long = 'y'.repeat(100_001);
    const msgs = eventToSubmitMessages({ type: 'tool_result', content: long });
    expect(msgs![0]!['content']).toBe(
      `[TOOL_RESULT] ${'y'.repeat(100_000)}\n...(输出过长，已截断，共 ${long.length} 字符)`,
    );
  });

  it('error → [LEVEL] stderr；complete → [RESULT:success] + duration/turns（result 型覆盖）', () => {
    expectWireEqual(
      eventToSubmitMessages({ type: 'error', content: 'bad', metadata: { level: 'warn' } }),
      [{ event_type: 'error', content: '[WARN] bad', channel: 'stderr' }],
    );
    expectWireEqual(
      eventToSubmitMessages({
        type: 'complete',
        content: ' done summary ',
        metadata: { stats: { total_duration_ms: 1200, num_turns: 3 } },
      }),
      [
        {
          event_type: 'complete',
          content: '[RESULT:success] done summary duration=1200ms turns=3',
          channel: 'stdout',
        },
      ],
    );
  });

  it('未处理类型（status / turn_result / thinking）→ null（丢弃不污染日志）', () => {
    expect(eventToSubmitMessages({ type: 'status', content: '', subtype: 'session_started' })).toBeNull();
    expect(eventToSubmitMessages({ type: 'turn_result', content: 'r' })).toBeNull();
    expect(eventToSubmitMessages({ type: 'thinking', content: 't' })).toBeNull();
  });
});

// ── 消费方一致性：facade _eventToMessages 与核心同输入同输出 ─────────────────

describe('task-runner facade _eventToMessages 委托核心（收敛后一致性）', () => {
  const runner = new TaskRunner(null as never, null as never, null as never);

  function callFacade(ev: AgentEvent): Record<string, unknown>[] | null {
    return (runner as unknown as {
      _eventToMessages: (ev: AgentEvent) => Record<string, unknown>[] | null;
    })._eventToMessages(ev);
  }

  /** tool_call JSON 内嵌 timestamp（new Date() 实时）→ 比较前抹平。 */
  function stripTimestamp(msgs: Record<string, unknown>[] | null): unknown {
    if (!msgs) return null;
    return msgs.map((m) => {
      if (m['channel'] === 'tool_call') {
        const parsed = JSON.parse(m['content'] as string) as Record<string, unknown>;
        return { ...m, content: { ...parsed, timestamp: '<TS>' } };
      }
      return m;
    });
  }

  const representativeEvents: AgentEvent[] = [
    { type: 'text', content: 'hi', metadata: { session_id: 's', usage: { input_tokens: 1 } } },
    { type: 'text', content: 'deep', metadata: { thinking: true } },
    { type: 'text', content: '', metadata: { status: 'usage_update' } },
    { type: 'text', content: 'init line', metadata: { status: 'system', subtype: 'init' } },
    { type: 'tool_use', content: '', metadata: { tool_name: 'Bash', tool_input: { command: 'ls' }, call_id: 'c' } },
    { type: 'tool_use', content: '', metadata: { tool_name: 'Write', approval_decision: 'decline', deny_reason: 'r' } },
    { type: 'tool_result', content: 'out' },
    { type: 'error', content: 'oops' },
    { type: 'complete', content: 'summary', metadata: { stats: { total_duration_ms: 9, num_turns: 1 } } },
    { type: 'status', content: '', subtype: 'session_started' }, // → null
  ];

  it.each(representativeEvents.map((ev, i) => [`case #${i} ${ev.type}`, ev] as const))(
    '%s：facade 输出与 event-wire 核心逐字节一致',
    (_label, ev) => {
      const viaFacade = callFacade(ev);
      const viaCore = eventToSubmitMessages(ev);
      expect(JSON.stringify(stripTimestamp(viaFacade))).toBe(JSON.stringify(stripTimestamp(viaCore)));
    },
  );
});
