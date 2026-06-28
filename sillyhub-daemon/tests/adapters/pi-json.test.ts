// tests/adapters/pi-json.test.ts
// PiJsonAdapter 解析逻辑测试。fixture 落盘自 Pi CLI 实测事件样本
// （tests/fixtures/pi-json/sample.txt）。
// IR 收敛后的事件类型对齐 task-02（5 元组）；metadata 字段名 snake_case
// （对齐 types.ts 注释 + 各 adapter 全局约定）。

import { describe, it, expect, expectTypeOf } from 'vitest';
import { loadFixture } from '../helpers';
import { PiJsonAdapter, type PiJsonProvider } from '../../src/adapters/pi-json';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter';
import type { AgentEvent } from '../../src/types';

/** 构造一行 Pi 事件（顶层 type + 平铺 payload）。 */
function makePiEvent(
  type: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({ type, ...fields });
}

/** 新 adapter 实例。 */
function newAdapter(provider: PiJsonProvider = 'pi'): PiJsonAdapter {
  return new PiJsonAdapter(provider);
}

/** fixture 加载器。 */
const SAMPLE = (): string => loadFixture('pi-json/sample.txt');

/** 取数组首元素，noUncheckedIndexedAccess 下兜底 null。 */
function first<T>(arr: T[]): T | null {
  return arr.length > 0 ? (arr[0] ?? null) : null;
}

// ===========================================================================
// buildArgs（对照 Pi 实测接口 pi --mode json -p <prompt>）
// ===========================================================================

describe('buildArgs', () => {
  it('无参 → --mode json -p \"\"', () => {
    expect(newAdapter().buildArgs()).toEqual(['--mode', 'json', '-p', '']);
  });

  it('带 prompt → -p 位置参数', () => {
    expect(newAdapter().buildArgs({ prompt: '写个 hello world' })).toEqual([
      '--mode', 'json', '-p', '写个 hello world',
    ]);
  });

  it('带 model（无 provider 前缀）→ --model', () => {
    expect(newAdapter().buildArgs({ prompt: 'hi', model: 'glm-5.2' })).toEqual([
      '--mode', 'json', '--model', 'glm-5.2', '-p', 'hi',
    ]);
  });

  it('带 model="provider/model" → 拆成 --provider + --model', () => {
    expect(newAdapter().buildArgs({ prompt: 'hi', model: 'zai/glm-5.2' })).toEqual([
      '--mode', 'json', '--provider', 'zai', '--model', 'glm-5.2', '-p', 'hi',
    ]);
  });

  it('不传 --dangerously-skip-permissions（Pi 默认不弹窗）', () => {
    const args = newAdapter().buildArgs({ prompt: 'x' });
    expect(args.some((a) => a.includes('skip-permissions'))).toBe(false);
    expect(args.some((a) => a === 'run')).toBe(false); // 无 run 子命令
  });
});

// ===========================================================================
// parse text_delta（核心流式文本）
// ===========================================================================

describe('parse message_update / text_delta', () => {
  it('text_delta → text 事件，content=delta', () => {
    const events = newAdapter().parse(
      makePiEvent('message_update', {
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events![0]!.type).toBe('text');
    expect(events![0]!.content).toBe('Hello');
  });

  it('accumulates output across deltas', () => {
    const a = newAdapter();
    a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} },
    }));
    a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '! 👋', partial: {} },
    }));
    expect(a.getOutput()).toBe('Hello! 👋');
  });

  it('text_start / text_end → null（不双计）', () => {
    const a = newAdapter();
    expect(
      a.parse(makePiEvent('message_update', {
        assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} },
      })),
    ).toBeNull();
    // text_end 的 content 不重复进 output
    a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'done', partial: {} },
    }));
    expect(a.getOutput()).toBe('');
  });

  it('空 delta → null', () => {
    expect(
      newAdapter().parse(makePiEvent('message_update', {
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '', partial: {} },
      })),
    ).toBeNull();
  });
});

// ===========================================================================
// parse tool_execution_*
// ===========================================================================

describe('parse tool_execution_start → tool_use', () => {
  it('产出 tool_use，metadata 含 tool_name/call_id/tool_input', () => {
    const events = newAdapter().parse(
      makePiEvent('tool_execution_start', {
        toolCallId: 'call_abc',
        toolName: 'bash',
        args: { command: 'echo hello' },
      }),
    );
    expect(events).toHaveLength(1);
    const ev = first(events!);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.content).toBe(JSON.stringify({ command: 'echo hello' }));
    expect(ev!.metadata?.tool_name).toBe('bash');
    expect(ev!.metadata?.call_id).toBe('call_abc');
    expect(ev!.metadata?.tool_input).toEqual({ command: 'echo hello' });
  });
});

describe('parse tool_execution_end → tool_result', () => {
  it('提取 result.content[].text 拼接', () => {
    const events = newAdapter().parse(
      makePiEvent('tool_execution_end', {
        toolCallId: 'call_abc',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'hello\n' }] },
        isError: false,
      }),
    );
    expect(events).toHaveLength(1);
    const ev = first(events!);
    expect(ev!.type).toBe('tool_result');
    expect(ev!.content).toBe('hello\n');
    expect(ev!.metadata?.tool_output).toBe('hello\n');
    expect(ev!.metadata?.is_error).toBe(false);
  });

  it('isError=true 写入 metadata.is_error 但不改 finalStatus', () => {
    const a = newAdapter();
    const events = a.parse(
      makePiEvent('tool_execution_end', {
        toolCallId: 'call_x',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'boom' }] },
        isError: true,
      }),
    );
    expect(first(events!)!.metadata?.is_error).toBe(true);
    expect(a.getFinalStatus()).toBe('completed'); // 不因工具错误置 failed
  });

  it('result.content 多段 → 全部拼接', () => {
    const events = newAdapter().parse(
      makePiEvent('tool_execution_end', {
        toolCallId: 'c1',
        toolName: 't',
        result: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
        isError: false,
      }),
    );
    expect(first(events!)!.content).toBe('ab');
  });

  it('result 为 string → 直接返回', () => {
    const events = newAdapter().parse(
      makePiEvent('tool_execution_end', {
        toolCallId: 'c2', toolName: 't', result: 'raw string', isError: false,
      }),
    );
    expect(first(events!)!.content).toBe('raw string');
  });

  it('result.content 为空数组 → 兜底 JSON.stringify(result)', () => {
    const events = newAdapter().parse(
      makePiEvent('tool_execution_end', {
        toolCallId: 'c3', toolName: 't', result: { content: [] }, isError: false,
      }),
    );
    expect(first(events!)!.content).toBe(JSON.stringify({ content: [] }));
  });

  it('tool_execution_update → null（中间态不产出）', () => {
    expect(
      newAdapter().parse(
        makePiEvent('tool_execution_update', {
          toolCallId: 'call_abc',
          toolName: 'bash',
          args: {},
          partialResult: { content: [{ type: 'text', text: 'hello\n' }] },
        }),
      ),
    ).toBeNull();
  });
});

// ===========================================================================
// parse turn_end → usage 累积（task-03 cache_creation_tokens 别名）
// ===========================================================================

describe('parse turn_end → usage', () => {
  it('从 message.usage 映射 4 字段 + cache_creation_tokens 别名，并 emit usage_update 事件', () => {
    const a = newAdapter();
    const events = a.parse(
      makePiEvent('turn_end', {
        message: {
          role: 'assistant',
          content: [],
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 },
          stopReason: 'stop',
        },
        toolResults: [],
      }),
    );
    // c2563282：turn_end 累积 usage 后 emit usage_update 事件（text + metadata.status），
    // 让 task-runner _eventToMessages 透传 token 到 backend（pi provider 否则 input_tokens 永空）。
    // 事件格式对齐 stream-json adapter 的 _buildUsageUpdateEvent。
    expect(events).toHaveLength(1);
    expect(events![0]!.type).toBe('text');
    expect(events![0]!.content).toBe('');
    expect(events![0]!.metadata).toMatchObject({
      status: 'usage_update',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 2,
        cache_creation_tokens: 1,
      },
    });
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(10);
    expect(usage.output_tokens).toBe(5);
    expect(usage.cache_read_tokens).toBe(2);
    expect(usage.cache_write_tokens).toBe(1);
    // 别名 = cache_write_tokens（对齐后端 cache_creation_tokens）
    expect(usage.cache_creation_tokens).toBe(1);
    expect(usage.cache_creation_tokens).toBe(usage.cache_write_tokens);
  });

  it('多 turn_end 累加', () => {
    const a = newAdapter();
    a.parse(makePiEvent('turn_end', {
      message: { usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 } },
    }));
    a.parse(makePiEvent('turn_end', {
      message: { usage: { input: 20, output: 10, cacheRead: 4, cacheWrite: 2 } },
    }));
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(30);
    expect(usage.output_tokens).toBe(15);
    expect(usage.cache_read_tokens).toBe(6);
    expect(usage.cache_write_tokens).toBe(3);
    expect(usage.cache_creation_tokens).toBe(3);
  });

  it('turn_end 无 usage → no-op', () => {
    const a = newAdapter();
    a.parse(makePiEvent('turn_end', { message: {} }));
    expect(a.getUsage().input_tokens).toBe(0);
  });

  it('usage 缺 cacheWrite 时 cache_creation_tokens=0', () => {
    const a = newAdapter();
    a.parse(makePiEvent('turn_end', {
      message: { usage: { input: 7, output: 3 } },
    }));
    expect(a.getUsage().cache_write_tokens).toBe(0);
    expect(a.getUsage().cache_creation_tokens).toBe(0);
  });
});

// ===========================================================================
// parse error
// ===========================================================================

describe('parse error', () => {
  it('error.message → error 事件 + finalStatus=failed', () => {
    const a = newAdapter();
    const events = a.parse(makePiEvent('error', { error: { message: 'boom', name: 'X' } }));
    expect(events).toHaveLength(1);
    expect(first(events!)!.type).toBe('error');
    expect(first(events!)!.content).toBe('boom');
    expect(a.getFinalStatus()).toBe('failed');
    expect(a.getFinalError()).toBe('boom');
  });

  it('error.name 兜底（无 message）', () => {
    expect(
      first(newAdapter().parse(makePiEvent('error', { error: { name: 'FatalError' } }))!)!.content,
    ).toBe('FatalError');
  });

  it('unknown error 兜底', () => {
    expect(
      first(newAdapter().parse(makePiEvent('error', { error: {} }))!)!.content,
    ).toBe('unknown error');
  });
});

// ===========================================================================
// parse session → sessionId
// ===========================================================================

describe('parse session', () => {
  it('提取 id', () => {
    const a = newAdapter();
    expect(a.parse(makePiEvent('session', { id: 'sess-pi-1', version: 3 }))).toBeNull();
    expect(a.getSessionId()).toBe('sess-pi-1');
  });
});

// ===========================================================================
// 生命周期事件 → null
// ===========================================================================

describe('parse lifecycle events → null', () => {
  const a = newAdapter();
  it.each([
    'agent_start',
    'agent_end',
    'turn_start',
    'message_start',
    'message_end',
  ])('%s → null', (type) => {
    expect(a.parse(makePiEvent(type, {}))).toBeNull();
  });
});

// ===========================================================================
// edge cases（→ null）
// ===========================================================================

describe('parse edge cases (→ null)', () => {
  const a = newAdapter();

  it('空行 → null', () => {
    expect(a.parse('')).toBeNull();
  });

  it('仅空白行 → null', () => {
    expect(a.parse('   \n\t  ')).toBeNull();
  });

  it('坏 JSON → null（不抛异常）', () => {
    expect(a.parse('not json')).toBeNull();
    expect(a.parse('{invalid}')).toBeNull();
  });

  it('未知 type → null', () => {
    expect(a.parse(makePiEvent('future_event', {}))).toBeNull();
  });

  it('parse 返回类型为 AgentEvent[] | null', () => {
    const r = a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', delta: 'x' },
    }));
    expectTypeOf(r).toEqualTypeOf<AgentEvent[] | null>();
  });
});

// ===========================================================================
// provider 字段 + 构造校验
// ===========================================================================

describe('provider field & construction', () => {
  it('provider = "pi"', () => {
    expect(newAdapter().provider).toBe('pi');
  });

  it('非法 provider 抛错', () => {
    expect(() => new PiJsonAdapter('claude' as PiJsonProvider)).toThrow(
      /Unknown PiJsonAdapter provider/,
    );
  });

  it('implements ProtocolAdapter 契约（无 onControl）', () => {
    const a: ProtocolAdapter = new PiJsonAdapter();
    expect(a.provider).toBe('pi');
    expect(typeof a.parse).toBe('function');
    expect(a.onControl).toBeUndefined();
  });
});

// ===========================================================================
// fixture 完整解析
// ===========================================================================

describe('fixture sample（完整事件流）', () => {
  it('解析真实 Pi 事件样本：output/sessionId/usage/事件类型', () => {
    const a = newAdapter();
    const lines = SAMPLE().split('\n').filter((l) => l.trim());
    const all: AgentEvent[] = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) all.push(...ev);
    }
    // text×2 + tool_use + tool_result + usage_update(text) = 5
    expect(all.length).toBe(5);
    expect(all.map((e) => e.type)).toEqual([
      'text', 'text', 'tool_use', 'tool_result', 'text',
    ]);
    expect(a.getOutput()).toBe('Hello! 👋');
    expect(a.getSessionId()).toBe('sess-pi-019efc1d');
    expect(a.getFinalStatus()).toBe('completed');
    // usage 来自 turn_end（非 message_end）
    expect(a.getUsage().input_tokens).toBe(10);
    expect(a.getUsage().output_tokens).toBe(5);
    expect(a.getUsage().cache_creation_tokens).toBe(1);
  });
});

// ===========================================================================
// 状态隔离 + resetAccumulator
// ===========================================================================

describe('state isolation & resetAccumulator', () => {
  it('两实例 output 互不污染', () => {
    const a = newAdapter();
    const b = newAdapter();
    a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', delta: 'A' },
    }));
    b.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', delta: 'B' },
    }));
    expect(a.getOutput()).toBe('A');
    expect(b.getOutput()).toBe('B');
  });

  it('resetAccumulator 清空累积状态', () => {
    const a = newAdapter();
    a.parse(makePiEvent('session', { id: 's1' }));
    a.parse(makePiEvent('message_update', {
      assistantMessageEvent: { type: 'text_delta', delta: 'before reset' },
    }));
    a.parse(makePiEvent('error', { error: { message: 'err' } }));
    a.parse(makePiEvent('turn_end', {
      message: { usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 } },
    }));
    expect(a.getOutput()).toBe('before reset');
    expect(a.getFinalStatus()).toBe('failed');
    a.resetAccumulator();
    expect(a.getOutput()).toBe('');
    expect(a.getSessionId()).toBe('');
    expect(a.getFinalStatus()).toBe('completed');
    expect(a.getFinalError()).toBe('');
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(0);
    expect(usage.cache_creation_tokens).toBe(0);
  });
});
