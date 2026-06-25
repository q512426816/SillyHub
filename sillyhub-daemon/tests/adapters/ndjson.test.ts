// tests/adapters/ndjson.test.ts
// task-09: NdjsonAdapter 解析逻辑 1:1 迁移自 Python test_ndjson_backend.py。
// 2 份 fixture（opencode/openclaw）落盘自 Python _make_ndjson_line 样本
// （tests/fixtures/ndjson/）。
// IR 收敛后的事件类型对齐 task-02（5 元组）：step_start/status 收敛为
// type:'text' + metadata.status（对齐 task-06/07/08）。
// metadata 字段名 snake_case（对齐 task-06/07/08 + types.ts L48-55 注释）。

import { describe, it, expect, expectTypeOf } from 'vitest';
import { loadFixture } from '../helpers';
import { NdjsonAdapter, type NdjsonProvider } from '../../src/adapters/ndjson';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter';
import type { AgentEvent } from '../../src/types';

/** 构造一行 ndjson 事件（对齐 Python `_make_ndjson_line`，test_ndjson_backend.py L16-20）。 */
function makeNdjsonLine(
  eventType: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({ type: eventType, ...fields });
}

/** 新 adapter 实例（默认 opencode）。 */
function newAdapter(provider: NdjsonProvider = 'opencode'): NdjsonAdapter {
  return new NdjsonAdapter(provider);
}

/** fixture 加载器（ndjson/<provider>/sample.txt，返回完整多行文本）。 */
const SAMPLE = (provider: 'opencode' | 'openclaw'): string =>
  loadFixture(`ndjson/${provider}/sample.txt`);

/** 取数组首元素，noUncheckedIndexedAccess 下兜底 null。 */
function first<T>(arr: T[]): T | null {
  return arr.length > 0 ? (arr[0] ?? null) : null;
}

// ===========================================================================
// text event（对照 Python TestNdjsonParseTextEvent L103-143）
// ===========================================================================

describe('parse text event', () => {
  it('parses text event with content', () => {
    const a = newAdapter();
    const events = a.parse(
      makeNdjsonLine('text', { part: { text: 'Hello from opencode' }, sessionID: 's1' }),
    );
    expect(events).toHaveLength(1);
    expect(events![0]!.type).toBe('text');
    expect(events![0]!.content).toBe('Hello from opencode');
  });

  it('returns null for empty text', () => {
    expect(newAdapter().parse(makeNdjsonLine('text', { part: { text: '' } }))).toBeNull();
  });

  it('accumulates output across lines', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'Line 1' } }));
    a.parse(makeNdjsonLine('text', { part: { text: 'Line 2' } }));
    expect(a.getOutput()).toBe('Line 1Line 2');
  });
});

// ===========================================================================
// tool_use event（对照 Python TestNdjsonParseToolUseEvent L151-201）
// ===========================================================================

describe('parse tool_use event', () => {
  it('emits tool_use only when status=running', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Bash', callID: 'call-1', state: { status: 'running', input: { command: 'ls -la' } } },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(1);
    const ev = first(events!);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata?.tool_name).toBe('Bash');
    expect(ev!.metadata?.call_id).toBe('call-1');
    expect(ev!.metadata?.tool_input).toEqual({ command: 'ls -la' });
  });

  it('emits tool_use + tool_result when status=completed', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: {
        tool: 'Read',
        callID: 'call-2',
        state: { status: 'completed', input: { file_path: '/tmp/x.py' }, output: 'file contents here' },
      },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(2);
    expect(events![0]!.type).toBe('tool_use');
    expect(events![1]!.type).toBe('tool_result');
    expect(events![1]!.metadata?.tool_output).toBe('file contents here');
  });

  it('serializes dict tool_output to JSON（B-06）', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: {
        tool: 'Grep',
        callID: 'call-3',
        state: { status: 'completed', input: {}, output: { matches: ['line1', 'line2'] } },
      },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(2);
    expect(events![1]!.type).toBe('tool_result');
    expect(JSON.parse(events![1]!.content)).toEqual({ matches: ['line1', 'line2'] });
  });

  it('parses string tool_input via JSON.parse', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Bash', callID: 'call-4', state: { status: 'running', input: '{"command":"ls"}' } },
    });
    expect(first(a.parse(line)!)!.metadata?.tool_input).toEqual({ command: 'ls' });
  });

  it('wraps non-JSON string tool_input as {raw}（B-05）', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Bash', callID: 'call-5', state: { status: 'running', input: 'not json' } },
    });
    expect(first(a.parse(line)!)!.metadata?.tool_input).toEqual({ raw: 'not json' });
  });
});

// ===========================================================================
// error event（对照 Python TestNdjsonParseErrorEvent L209-233）
// ===========================================================================

describe('parse error event', () => {
  it('extracts message from error.data.message + sets finalStatus=failed', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('error', { error: { name: 'ModelError', data: { message: 'invalid model' } } });
    const events = a.parse(line);
    expect(events).toHaveLength(1);
    const ev = first(events!);
    expect(ev!.type).toBe('error');
    expect(ev!.content).toBe('invalid model');
    expect(a.getFinalStatus()).toBe('failed');
    expect(a.getFinalError()).toBe('invalid model');
  });

  it('falls back to error.name when data.message missing', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('error', { error: { name: 'FatalError' } });
    expect(first(a.parse(line)!)!.content).toBe('FatalError');
  });

  it('falls back to "unknown error" when both missing（B-09）', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('error', { error: {} });
    expect(first(a.parse(line)!)!.content).toBe('unknown error');
  });
});

// ===========================================================================
// step events（对照 Python TestNdjsonParseStepEvents L241-299）
// ===========================================================================

describe('parse step events', () => {
  it('maps step_start to text + metadata.status=running（IR 收敛，AC-09）', () => {
    const a = newAdapter();
    const events = a.parse(makeNdjsonLine('step_start', { part: {} }));
    expect(events).toHaveLength(1);
    const ev = first(events!);
    expect(ev!.type).toBe('text'); // status 收敛为 text
    expect(ev!.content).toBe('');
    expect(ev!.metadata?.status).toBe('running');
  });

  it('accumulates tokens from step_finish', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('step_finish', {
      part: { tokens: { input: 100, output: 50, cache: { read: 20, write: 10 } } },
    });
    expect(a.parse(line)).toBeNull(); // step_finish 无事件产出
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_read_tokens).toBe(20);
    expect(usage.cache_write_tokens).toBe(10);
    // task-03：cache_creation_tokens 别名 = cache_write_tokens（对齐后端契约）
    expect(usage.cache_creation_tokens).toBe(10);
    expect(usage.cache_creation_tokens).toBe(usage.cache_write_tokens);
  });

  it('accumulates tokens across multiple step_finish', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('step_finish', { part: { tokens: { input: 100, output: 50 } } }));
    a.parse(makeNdjsonLine('step_finish', { part: { tokens: { input: 200, output: 100 } } }));
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(300);
    expect(usage.output_tokens).toBe(150);
  });

  it('extracts sessionID from any event（B-08，后到覆盖）', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'hi' }, sessionID: 'sess-ndjson-1' }));
    expect(a.getSessionId()).toBe('sess-ndjson-1');
    // 后到覆盖
    a.parse(makeNdjsonLine('step_start', { part: {}, sessionID: 'sess-ndjson-2' }));
    expect(a.getSessionId()).toBe('sess-ndjson-2');
  });

  it('step_finish without tokens → no-op, returns null', () => {
    const a = newAdapter();
    expect(a.parse(makeNdjsonLine('step_finish', { part: {} }))).toBeNull();
    expect(a.getUsage().input_tokens).toBe(0);
  });

  // task-03：多 step cache 累加 + cache_creation_tokens 别名同步
  it('accumulates cache across multiple step_finish and syncs cache_creation_tokens alias', () => {
    const a = newAdapter();
    a.parse(
      makeNdjsonLine('step_finish', {
        part: { tokens: { input: 100, output: 50, cache: { read: 200, write: 80 } } },
      }),
    );
    a.parse(
      makeNdjsonLine('step_finish', {
        part: { tokens: { input: 50, output: 30, cache: { read: 100, write: 40 } } },
      }),
    );
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(150);
    expect(usage.output_tokens).toBe(80);
    expect(usage.cache_read_tokens).toBe(300);
    expect(usage.cache_write_tokens).toBe(120);
    // 别名 = 累加后的 cache_write_tokens，与后端 cache_creation_tokens 对齐
    expect(usage.cache_creation_tokens).toBe(120);
  });

  // task-03：cache 缺失时 cache_creation_tokens 也为 0（初值同步）
  it('cache_creation_tokens defaults to 0 when no cache field', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('step_finish', { part: { tokens: { input: 10, output: 5 } } }));
    const usage = a.getUsage();
    expect(usage.cache_write_tokens).toBe(0);
    expect(usage.cache_creation_tokens).toBe(0);
  });
});

// ===========================================================================
// edge cases（对照 Python TestNdjsonEdgeCases L307-362）
// ===========================================================================

describe('parse edge cases (→ null)', () => {
  const a = newAdapter();

  it('空行 → null（B-01）', () => {
    expect(a.parse('')).toBeNull();
  });

  it('仅空白行 → null', () => {
    expect(a.parse('   \n\t  ')).toBeNull();
  });

  it('坏 JSON → null（不抛异常，B-02）', () => {
    expect(a.parse('not json')).toBeNull();
    expect(a.parse('{invalid}')).toBeNull();
  });

  it('未知 type → null（B-03）', () => {
    expect(a.parse(makeNdjsonLine('unknown_event', { part: {} }))).toBeNull();
  });

  it('parse 返回类型为 AgentEvent[] | null', () => {
    const r = a.parse(makeNdjsonLine('text', { part: { text: 'x' } }));
    expectTypeOf(r).toEqualTypeOf<AgentEvent[] | null>();
  });
});

// ===========================================================================
// provider 字段 + 构造校验
// ===========================================================================

describe('provider field & construction', () => {
  it('两 provider 字段正确（AC-01）', () => {
    expect(newAdapter('opencode').provider).toBe('opencode');
    expect(newAdapter('openclaw').provider).toBe('openclaw');
  });

  it('非法 provider 抛错（B-11，AC-11）', () => {
    expect(() => new NdjsonAdapter('claude' as NdjsonProvider)).toThrow(
      /Unknown NdjsonAdapter provider/,
    );
    // pi 已拆出独立 pi_json 协议，不再是 ndjson provider
    expect(() => new NdjsonAdapter('pi' as NdjsonProvider)).toThrow(
      /Unknown NdjsonAdapter provider/,
    );
  });

  it('implements ProtocolAdapter 契约（无 onControl）', () => {
    const a: ProtocolAdapter = new NdjsonAdapter('opencode');
    expect(a.provider).toBe('opencode');
    expect(typeof a.parse).toBe('function');
    expect(a.onControl).toBeUndefined();
  });
});

// ===========================================================================
// 三 provider 等价（AC-01：同输入产等价 IR，无 provider 分支）
// ===========================================================================

describe('two providers equivalence (AC-01, B-10)', () => {
  it.each(['opencode', 'openclaw'] as const)(
    'parses %s fixture without error + output 非空',
    (provider) => {
      const a = new NdjsonAdapter(provider);
      const lines = SAMPLE(provider).split('\n').filter((l) => l.trim());
      const allEvents: AgentEvent[] = [];
      for (const line of lines) {
        const ev = a.parse(line);
        if (ev) allEvents.push(...ev);
      }
      expect(allEvents.length).toBeGreaterThan(0);
      expect(a.getOutput().length).toBeGreaterThan(0);
    },
  );

  it('opencode/openclaw 同输入产完全相同 IR（无 provider 分支）', () => {
    const line = makeNdjsonLine('text', { part: { text: 'same' } });
    expect(new NdjsonAdapter('opencode').parse(line)).toEqual(
      new NdjsonAdapter('openclaw').parse(line),
    );
  });
});

// ===========================================================================
// 状态隔离（每实例独立）
// ===========================================================================

describe('state isolation', () => {
  it('两个实例的 output 互不污染', () => {
    const a = newAdapter();
    const b = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'from A' } }));
    b.parse(makeNdjsonLine('text', { part: { text: 'from B' } }));
    expect(a.getOutput()).toBe('from A');
    expect(b.getOutput()).toBe('from B');
  });

  it('resetState 清空累积状态', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'before reset' } }));
    a.parse(makeNdjsonLine('error', { error: { name: 'Err' } }));
    a.parse(
      makeNdjsonLine('step_finish', {
        part: { tokens: { input: 10, output: 5, cache: { read: 7, write: 3 } } },
      }),
    );
    expect(a.getOutput()).toBe('before reset');
    expect(a.getFinalStatus()).toBe('failed');
    a.resetState();
    expect(a.getOutput()).toBe('');
    expect(a.getFinalStatus()).toBe('completed');
    expect(a.getSessionId()).toBe('');
    // task-03：resetState 含 usage 重置（含 cache + cache_creation_tokens 别名）
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(0);
    expect(usage.cache_read_tokens).toBe(0);
    expect(usage.cache_write_tokens).toBe(0);
    expect(usage.cache_creation_tokens).toBe(0);
  });
});

// ===========================================================================
// fixture 完整解析（opencode 多类型覆盖）
// ===========================================================================

describe('fixture samples (AC-08)', () => {
  it('opencode/sample.txt 覆盖 text/step_start/tool_use×2/step_finish/error', () => {
    const a = newAdapter();
    const lines = SAMPLE('opencode').split('\n').filter((l) => l.trim());
    const all: AgentEvent[] = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) all.push(...ev);
    }
    // text + step_start(text) + tool_use(running) + tool_use+tool_result + error = 6
    expect(all.length).toBe(6);
    expect(a.getSessionId()).toBe('sess-opencode-1');
    expect(a.getOutput()).toBe('Hello from opencode');
    expect(a.getFinalStatus()).toBe('failed'); // 末尾 error 事件
    expect(a.getUsage().input_tokens).toBe(100);
  });
});
