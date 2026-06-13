// tests/adapters/jsonl.test.ts
// task-08: JsonlAdapter 解析逻辑 1:1 迁移自 Python test_jsonl_backend.py。
// 4 份 fixture 落盘自 Python _make_jsonl_line helper 实际调用处
// （tests/fixtures/jsonl/copilot/）。
// IR 收敛后的事件类型对齐 task-02（5 元组）：turn_start/reasoning/session.warning
// 收敛为 type:'text' + metadata（对齐 task-06 stream-json）。
// metadata 字段名 snake_case（对齐 task-06/07 + types.ts L48-55 注释）。

import { describe, it, expect, expectTypeOf } from 'vitest';
import { loadFixture } from '../helpers';
import { JsonlAdapter } from '../../src/adapters/jsonl';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter';
import type { AgentEvent } from '../../src/types';

/** 构造一行 jsonl 事件（对齐 Python `_make_jsonl_line`，test_jsonl_backend.py L16-22）。 */
function makeJsonlLine(
  eventType: string,
  data?: Record<string, unknown>,
  extra?: Record<string, unknown>,
): string {
  const obj: Record<string, unknown> = { type: eventType };
  if (data !== undefined) obj.data = data;
  if (extra) Object.assign(obj, extra);
  return JSON.stringify(obj);
}

/** 取数组首元素，noUncheckedIndexedAccess 下兜底 null。 */
function first<T>(arr: T[]): T | null {
  return arr.length > 0 ? (arr[0] ?? null) : null;
}

/** fixture 加载器（jsonl/copilot/<name>）。 */
const F = (name: string): string => loadFixture(`jsonl/copilot/${name}`);

// ===========================================================================
// session.start（对照 Python TestJsonlParseSessionStart L90-110）
// ===========================================================================

describe('parse session.start', () => {
  it('更新 state（sessionId + activeModel），返回 []', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('session.start', { sessionId: 'abc-123', selectedModel: 'gpt-4.1' }),
    );
    expect(events).toEqual([]);
    expect(a.getState().sessionId).toBe('abc-123');
    expect(a.getState().activeModel).toBe('gpt-4.1');
  });

  it('无 data → []（state 不变）', () => {
    const a = new JsonlAdapter();
    expect(a.parse(makeJsonlLine('session.start'))).toEqual([]);
    expect(a.getState().sessionId).toBe('');
    expect(a.getState().activeModel).toBe('');
  });
});

// ===========================================================================
// assistant.message_delta（对照 Python TestJsonlParseMessageDelta L118-157）
// ===========================================================================

describe('parse assistant.message_delta', () => {
  it('产出 text event + content', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message_delta', { messageId: 'm1', deltaContent: 'Hello ' }),
    );
    expect(events).toEqual([{ type: 'text', content: 'Hello ' }]);
  });

  it('多行 delta 累积到 output', () => {
    const a = new JsonlAdapter();
    a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'Hello ' }));
    a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'World' }));
    expect(a.getState().output).toBe('Hello World');
  });

  it('空 deltaContent → []', () => {
    const a = new JsonlAdapter();
    expect(a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: '' }))).toEqual([]);
  });
});

// ===========================================================================
// assistant.message（对照 Python TestJsonlParseMessageFull L165-233）
// 一行多 event 的核心场景（reasoning + tool_use...）
// ===========================================================================

describe('parse assistant.message', () => {
  it('防双计：delta 已累积 content 后，message 不翻倍（B-07/AC-09）', () => {
    const a = new JsonlAdapter();
    a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'Hello World' }));
    expect(a.getState().output).toBe('Hello World');
    a.parse(makeJsonlLine('assistant.message', { messageId: 'm1', content: 'Hello World' }));
    expect(a.getState().output).toBe('Hello World'); // 不翻倍
  });

  it('toolRequests → tool_use event + metadata（snake_case）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message', {
        messageId: 'm1',
        content: '',
        toolRequests: [
          {
            toolCallId: 'tc1',
            name: 'Read',
            arguments: { file_path: '/tmp/x.py' },
            type: 'tool_call',
          },
        ],
      }),
    );
    expect(events).toHaveLength(1);
    const ev = first(events);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata).toMatchObject({
      tool_name: 'Read',
      call_id: 'tc1',
      tool_input: { file_path: '/tmp/x.py' },
    });
  });

  it('reasoningText → text + metadata.thinking=true（IR 收敛）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message', {
        messageId: 'm1',
        content: 'answer',
        reasoningText: 'Let me think...',
      }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('text'); // thinking 收敛为 text
    expect(ev!.content).toBe('Let me think...');
    expect(ev!.metadata?.thinking).toBe(true);
  });

  it('reasoning + 多 toolRequests 同行 → 1 thinking + N tool_use（AC-02 一行多 event）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message', {
        messageId: 'm1',
        content: '',
        reasoningText: 'I need to read two files',
        toolRequests: [
          { toolCallId: 'tc1', name: 'Read', arguments: { file_path: '/a.py' }, type: 'tool_call' },
          { toolCallId: 'tc2', name: 'Read', arguments: { file_path: '/b.py' }, type: 'tool_call' },
        ],
      }),
    );
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('text');
    expect(events[0]!.metadata?.thinking).toBe(true);
    expect(events[1]!.type).toBe('tool_use');
    expect(events[1]!.metadata).toMatchObject({ call_id: 'tc1' });
    expect(events[2]!.type).toBe('tool_use');
    expect(events[2]!.metadata).toMatchObject({ call_id: 'tc2' });
  });

  it('arguments 为 JSON string 时二次解析', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message', {
        messageId: 'm1',
        content: '',
        toolRequests: [
          {
            toolCallId: 'tc1',
            name: 'Bash',
            arguments: '{"command":"ls"}',
            type: 'tool_call',
          },
        ],
      }),
    );
    expect(first(events)!.metadata?.tool_input).toEqual({ command: 'ls' });
  });

  it('arguments 为坏 JSON string → {raw: args} 兜底（B-06）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.message', {
        messageId: 'm1',
        content: '',
        toolRequests: [
          { toolCallId: 'tc1', name: 'Bash', arguments: 'not json', type: 'tool_call' },
        ],
      }),
    );
    expect(first(events)!.metadata?.tool_input).toEqual({ raw: 'not json' });
  });
});

// ===========================================================================
// tool.execution_complete（对照 Python TestJsonlParseToolComplete L240-273）
// ===========================================================================

describe('parse tool.execution_complete', () => {
  it('success → tool_result + tool_output（snake_case）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('tool.execution_complete', {
        toolCallId: 'tc1',
        success: true,
        result: { content: 'file contents here' },
      }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('tool_result');
    expect(ev!.content).toBe('file contents here');
    expect(ev!.metadata).toMatchObject({ call_id: 'tc1', tool_output: 'file contents here' });
  });

  it('failure → tool_result + "Error: ..." 前缀（B-08）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('tool.execution_complete', {
        toolCallId: 'tc2',
        success: false,
        error: { message: 'file not found' },
      }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('tool_result');
    expect(ev!.content).toContain('Error: file not found');
  });

  it('failure 无 error 对象 → "Error: unknown"', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('tool.execution_complete', { toolCallId: 'tc3', success: false }),
    );
    expect(first(events)!.content).toBe('Error: unknown');
  });
});

// ===========================================================================
// result（对照 Python TestJsonlParseResult L281-309）
// ===========================================================================

describe('parse result', () => {
  it('success → [] + sessionId/finalStatus 更新（fixture complete.txt）', () => {
    const a = new JsonlAdapter();
    expect(a.parse(F('complete.txt'))).toEqual([]);
    expect(a.getState().sessionId).toBe('final-session-1');
    expect(a.getState().finalStatus).toBe('completed');
  });

  it('exitCode != 0 → finalStatus=failed + finalError 含 exit code（B-08）', () => {
    const a = new JsonlAdapter();
    a.parse(JSON.stringify({ type: 'result', sessionId: 'final-session-2', exitCode: 1 }));
    expect(a.getState().finalStatus).toBe('failed');
    expect(a.getState().finalError).toContain('exited with code 1');
  });

  it('session.error 先到 + result exitCode≠0 → finalError 拼接不覆盖（B-08）', () => {
    const a = new JsonlAdapter();
    a.parse(makeJsonlLine('session.error', { message: 'OOM killed' }));
    a.parse(JSON.stringify({ type: 'result', exitCode: 1 }));
    expect(a.getState().finalError).toContain('OOM killed');
    expect(a.getState().finalError).toContain('exited with code 1');
  });
});

// ===========================================================================
// 边界：空行 / 坏 JSON / 未知 type（对照 Python TestJsonlEdgeCases L320-339）
// ===========================================================================

describe('parse edge cases (→ [])', () => {
  const a = new JsonlAdapter();

  it('空行 → []', () => {
    expect(a.parse('')).toEqual([]);
  });

  it('仅空白行 → []', () => {
    expect(a.parse('   ')).toEqual([]);
    expect(a.parse('\t\n')).toEqual([]);
  });

  it('坏 JSON → []（不抛异常）', () => {
    expect(a.parse('not valid json at all')).toEqual([]);
    expect(a.parse('{invalid}')).toEqual([]);
  });

  it('非对象 JSON → []', () => {
    expect(a.parse('[1,2,3]')).toEqual([]);
    expect(a.parse('"a string"')).toEqual([]);
    expect(a.parse('42')).toEqual([]);
    expect(a.parse('null')).toEqual([]);
  });

  it('未知 type → []（B-01）', () => {
    expect(a.parse(makeJsonlLine('unknown.event.type', { foo: 'bar' }))).toEqual([]);
    expect(a.parse(makeJsonlLine('foo.bar.baz', {}))).toEqual([]);
  });

  it('parse 返回类型为 AgentEvent[]（jsonl 协议永远返回数组，不返回 null）', () => {
    const r = a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'x' }));
    expectTypeOf(r).toEqualTypeOf<AgentEvent[]>();
  });
});

// ===========================================================================
// session.error / warning / turn_start / reasoning
// （对照 Python TestJsonlEdgeCases L341-393）
// ===========================================================================

describe('parse lifecycle / reasoning events', () => {
  it('session.error → error event + finalStatus=failed', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('session.error', { errorType: 'fatal', message: 'OOM killed' }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('error');
    expect(ev!.content).toBe('OOM killed');
    expect(a.getState().finalStatus).toBe('failed');
    expect(a.getState().finalError).toBe('OOM killed');
  });

  it('session.warning → text + metadata.level=warn（IR 收敛）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('session.warning', { warningType: 'deprecation', message: 'model deprecated' }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('text'); // status 收敛为 text
    expect(ev!.content).toBe('model deprecated');
    expect(ev!.metadata?.level).toBe('warn');
    // warning 不影响 finalStatus
    expect(a.getState().finalStatus).toBe('completed');
  });

  it('assistant.turn_start → text + metadata.status=running（IR 收敛）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(makeJsonlLine('assistant.turn_start', {}));
    const ev = first(events);
    expect(ev!.type).toBe('text'); // status 收敛为 text
    expect(ev!.metadata?.status).toBe('running');
  });

  it('assistant.reasoning → text + metadata.thinking=true（IR 收敛）', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.reasoning', { content: 'I should check the file first' }),
    );
    const ev = first(events);
    expect(ev!.type).toBe('text'); // thinking 收敛为 text
    expect(ev!.content).toBe('I should check the file first');
    expect(ev!.metadata?.thinking).toBe(true);
  });

  it('assistant.reasoning_delta → text + metadata.thinking=true', () => {
    const a = new JsonlAdapter();
    const events = a.parse(makeJsonlLine('assistant.reasoning_delta', { deltaContent: 'Hmm' }));
    const ev = first(events);
    expect(ev!.type).toBe('text');
    expect(ev!.content).toBe('Hmm');
    expect(ev!.metadata?.thinking).toBe(true);
  });

  it('reasoning content 空但 deltaContent 非空 → 取 deltaContent', () => {
    const a = new JsonlAdapter();
    const events = a.parse(
      makeJsonlLine('assistant.reasoning', { content: '', deltaContent: 'fallback' }),
    );
    expect(first(events)!.content).toBe('fallback');
  });
});

// ===========================================================================
// provider + ProtocolAdapter 契约
// ===========================================================================

describe('provider & contract', () => {
  it('provider = copilot（AC-05）', () => {
    expect(new JsonlAdapter().provider).toBe('copilot');
  });

  it('implements ProtocolAdapter 契约（无 onControl，AC-06）', () => {
    const a: ProtocolAdapter = new JsonlAdapter();
    expect(a.provider).toBe('copilot');
    expect(typeof a.parse).toBe('function');
    expect(a.onControl).toBeUndefined();
  });
});

// ===========================================================================
// 状态隔离（AC-07）：每实例独立，互不污染
// ===========================================================================

describe('state isolation (AC-07)', () => {
  it('两个实例的 output 互不污染', () => {
    const a = new JsonlAdapter();
    const b = new JsonlAdapter();
    a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'from A' }));
    b.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'from B' }));
    expect(a.getState().output).toBe('from A');
    expect(b.getState().output).toBe('from B');
  });

  it('两个实例的 sessionId / finalStatus 独立', () => {
    const a = new JsonlAdapter();
    const b = new JsonlAdapter();
    a.parse(JSON.stringify({ type: 'result', sessionId: 's-A', exitCode: 1 }));
    b.parse(JSON.stringify({ type: 'result', sessionId: 's-B', exitCode: 0 }));
    expect(a.getState().sessionId).toBe('s-A');
    expect(a.getState().finalStatus).toBe('failed');
    expect(b.getState().sessionId).toBe('s-B');
    expect(b.getState().finalStatus).toBe('completed');
  });
});

// ===========================================================================
// fixture 文件可解析（AC-08）
// ===========================================================================

describe('fixture files parseable (AC-08)', () => {
  it('session_start.txt → sessionId=abc-123 + activeModel=gpt-4.1', () => {
    const a = new JsonlAdapter();
    a.parse(F('session_start.txt'));
    expect(a.getState().sessionId).toBe('abc-123');
    expect(a.getState().activeModel).toBe('gpt-4.1');
  });

  it('tool_use.txt → tool_use event + Read/file_path', () => {
    const a = new JsonlAdapter();
    const events = a.parse(F('tool_use.txt'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata).toMatchObject({
      tool_name: 'Read',
      call_id: 'tc1',
      tool_input: { file_path: '/tmp/x.py' },
    });
  });

  it('message.txt → text event + deltaContent', () => {
    const a = new JsonlAdapter();
    const events = a.parse(F('message.txt'));
    expect(first(events)!.content).toBe('Hello ');
    expect(a.getState().output).toBe('Hello ');
  });

  it('complete.txt → finalStatus=completed + sessionId', () => {
    const a = new JsonlAdapter();
    a.parse(F('complete.txt'));
    expect(a.getState().finalStatus).toBe('completed');
    expect(a.getState().sessionId).toBe('final-session-1');
  });
});

// ===========================================================================
// 完整流程（对照 Python test_full_flow_accumulated_output L403-441）
// ===========================================================================

describe('full flow accumulates output', () => {
  it('session.start → delta → message(重置) → result', () => {
    const a = new JsonlAdapter();
    a.parse(makeJsonlLine('session.start', { sessionId: 'sess-flow', selectedModel: 'gpt-4.1' }));
    a.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'Hello' }));
    a.parse(makeJsonlLine('assistant.message', { messageId: 'm1', content: 'Hello' }));
    a.parse(JSON.stringify({ type: 'result', sessionId: 'sess-flow', exitCode: 0 }));

    expect(a.getState().output).toBe('Hello'); // delta 被 message 重置，不翻倍
    expect(a.getState().sessionId).toBe('sess-flow');
    expect(a.getState().activeModel).toBe('gpt-4.1');
    expect(a.getState().finalStatus).toBe('completed');
  });
});
