// tests/stream-json.test.ts
// task-06: StreamJsonAdapter 解析逻辑 1:1 迁移自 Python test_stream_json_backend.py。
// fixture 从 Python inline json.dumps 样本提取落盘（tests/fixtures/stream-json/）。
// 期望值按 Node IR 收敛后的语义（非 Python 原始 event_type）。

import { describe, it, expect, vi } from 'vitest';
import { loadLines } from './helpers';
import { StreamJsonAdapter } from '../src/adapters/stream-json';
import type { ProtocolAdapter } from '../src/adapters/protocol-adapter';
import type { AgentEvent } from '../src/types';

/** 取 fixture 首行（单行 fixture 用）。noUncheckedIndexedAccess 下兜底空串。 */
function firstLine(lines: string[]): string {
  return lines[0] ?? '';
}

// ===========================================================================
// 边界：空行 / 非 JSON / 非对象 / 未知 type → null
// ===========================================================================

describe('parse edge cases (→ null)', () => {
  const a = new StreamJsonAdapter('claude');

  it('空行 / 空白行 → null', () => {
    expect(a.parse('')).toBeNull();
    expect(a.parse('   ')).toBeNull();
    expect(a.parse('\n')).toBeNull();
    expect(a.parse('\t')).toBeNull();
  });

  it('非 JSON 字符串 → null（不抛异常）', () => {
    expect(a.parse('not json at all')).toBeNull();
    expect(a.parse('{invalid}')).toBeNull();
    expect(a.parse('12345')).toBeNull();
  });

  it('非对象 JSON（数组 / 字符串 / 数字）→ null', () => {
    expect(a.parse('[1,2,3]')).toBeNull();
    expect(a.parse('"a string"')).toBeNull();
    expect(a.parse('123')).toBeNull();
    expect(a.parse('true')).toBeNull();
    expect(a.parse('null')).toBeNull();
  });

  it('未知 type → null', () => {
    expect(a.parse('{"type":"custom","data":"hello"}')).toBeNull();
  });
});

// ===========================================================================
// system：session_id 提取 + status event
// ===========================================================================

describe('parse system', () => {
  it('system subtype=init → status event + sessionId 累积', () => {
    const a = new StreamJsonAdapter('claude');
    const line = firstLine(loadLines('stream-json/claude-system-init.jsonl'));
    const events = a.parse(line);
    expect(events).not.toBeNull();
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.metadata?.status).toBe('system');
    expect(events?.[0]?.metadata?.subtype).toBe('init');
    expect(events?.[0]?.metadata?.session_id).toBe('sess_abc123');
    expect(a.getSessionId()).toBe('sess_abc123');
  });

  it('ql-20260617-008 system subtype=status 非 requesting → 产 event，content 含 status=<value>', () => {
    const a = new StreamJsonAdapter('claude');
    const line = JSON.stringify({
      type: 'system',
      subtype: 'status',
      status: 'ready',
      session_id: 'sess_abc123',
    });
    const events = a.parse(line) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.status).toBe('system');
    expect(events[0]!.metadata?.subtype).toBe('status');
    expect(events[0]!.content).toContain('status=ready');
    expect(events[0]!.content).toContain('session=sess_abc123');
    expect(a.getSessionId()).toBe('sess_abc123');
  });

  it('ql-20260617-010 system subtype=status status=requesting → 过滤（高频心跳，仍提取 sessionId）', () => {
    const a = new StreamJsonAdapter('claude');
    const line = JSON.stringify({
      type: 'system',
      subtype: 'status',
      status: 'requesting',
      session_id: 'sess_xyz',
    });
    expect(a.parse(line)).toBeNull();
    // sessionId 仍被提取（parseSystem 副作用）
    expect(a.getSessionId()).toBe('sess_xyz');
  });

  it('ql-20260617-008 system subtype=api_retry → 产 event，content 含 attempt/error', () => {
    const a = new StreamJsonAdapter('claude');
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
      error_status: 529,
      error: 'rate_limit',
      session_id: 'sess_abc123',
    });
    const events = a.parse(line) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.subtype).toBe('api_retry');
    expect(events[0]!.content).toContain('attempt=1/10');
    expect(events[0]!.content).toContain('http=529');
    expect(events[0]!.content).toContain('error=rate_limit');
    expect(a.getSessionId()).toBe('sess_abc123');
  });

  it('ql-20260617-008 system 未知 subtype → 兜底产 event，保留顶层标量字段', () => {
    const a = new StreamJsonAdapter('claude');
    const line = JSON.stringify({
      type: 'system',
      subtype: 'custom_event',
      foo: 'bar',
      count: 42,
      nested: { x: 1 },
      session_id: 'sess_xyz',
    });
    const events = a.parse(line) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.subtype).toBe('custom_event');
    expect(events[0]!.content).toContain('foo=bar');
    expect(events[0]!.content).toContain('count=42');
    // 嵌套对象不展开（仅保留标量）
    expect(events[0]!.content).not.toContain('nested');
  });
});

// ===========================================================================
// assistant：text / thinking / tool_use / null input / no content / multi-block
// ===========================================================================

describe('parse assistant', () => {
  it('text block → text event', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-assistant-text.jsonl')));
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.content).toBe('Hello from Claude!');
  });

  it('thinking block → text + metadata.thinking=true（IR 收敛）', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-assistant-thinking.jsonl')));
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.content).toBe('Let me think about this...');
    expect(events?.[0]?.metadata?.thinking).toBe(true);
  });

  it('tool_use block → tool_use event + metadata', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-assistant-tool-use.jsonl')));
    expect(events?.[0]?.type).toBe('tool_use');
    expect(events?.[0]?.metadata?.tool_name).toBe('Read');
    expect(events?.[0]?.metadata?.call_id).toBe('call_001');
    expect(events?.[0]?.metadata?.tool_input).toEqual({ file_path: '/tmp/test.py' });
  });

  it('tool_use input=null → metadata.tool_input 归一为 {}', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-tool-use-null-input.jsonl')));
    expect(events?.[0]?.type).toBe('tool_use');
    expect(events?.[0]?.metadata?.tool_input).toEqual({});
  });

  it('assistant 无 content 数组 → null', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.parse(firstLine(loadLines('stream-json/claude-assistant-no-content.jsonl')))).toBeNull();
  });

  it('assistant 多 block → 返回全部 event（方案B 升级，区别于 Python 取最后）', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-assistant-multi-block.jsonl')));
    expect(events?.length).toBe(2);
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.content).toBe('Part 1');
    expect(events?.[1]?.content).toBe('Part 2');
  });
});

// ===========================================================================
// user：tool_result（string / list content 归一）
// ===========================================================================

describe('parse user tool_result', () => {
  it('tool_result string content', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-user-tool-result.jsonl')));
    expect(events?.[0]?.type).toBe('tool_result');
    expect(events?.[0]?.metadata?.call_id).toBe('call_001');
    expect(events?.[0]?.content).toBe('file contents here');
  });

  it('tool_result list content → 各 text 用 \\n 拼接', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-user-tool-result-list.jsonl')));
    expect(events?.[0]?.content).toBe('a\nb');
    expect(events?.[0]?.metadata?.call_id).toBe('call_003');
  });
});

// ===========================================================================
// result：success → complete；error → error
// ===========================================================================

describe('parse result', () => {
  it('success → complete event + stats + lastResultInfo', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-result-success.jsonl')));
    expect(events?.[0]?.type).toBe('complete');
    expect(events?.[0]?.metadata?.session_id).toBe('sess_abc');
    expect(events?.[0]?.metadata?.is_error).toBe(false);
    expect(events?.[0]?.metadata?.stats).toBeDefined();
    expect(events?.[0]?.metadata?.stats).toEqual(expect.any(Object));
    expect(a.getLastResultInfo()?.isError).toBe(false);
    expect(a.getLastResultInfo()?.sessionId).toBe('sess_abc');
    expect(a.getLastResultInfo()?.resultText).toBe('Task completed successfully');
  });

  it('error → error event + lastResultInfo.isError=true', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-result-error.jsonl')));
    expect(events?.[0]?.type).toBe('error');
    expect(events?.[0]?.metadata?.is_error).toBe(true);
    expect(events?.[0]?.content).toBe('Something went wrong');
    expect(a.getLastResultInfo()?.isError).toBe(true);
  });
});

// ===========================================================================
// log：level + message
// ===========================================================================

describe('parse log', () => {
  it('log → text event + metadata.level / log', () => {
    const a = new StreamJsonAdapter('claude');
    const events = a.parse(firstLine(loadLines('stream-json/claude-log.jsonl')));
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.content).toBe('Processing started');
    expect(events?.[0]?.metadata?.level).toBe('info');
    expect(events?.[0]?.metadata?.log).toBe(true);
  });
});

// ===========================================================================
// control_request（R-03）：回写 control_response + 返回 []
// ===========================================================================

describe('parse control_request (R-03)', () => {
  it('回写 control_response 到 stdin + 返回 []', () => {
    const write = vi.fn();
    const mockStdin = { write } as unknown as NodeJS.WritableStream;
    const a = new StreamJsonAdapter('claude');
    a.attachStdin(mockStdin);
    const events = a.parse(firstLine(loadLines('stream-json/claude-control-request.jsonl')));
    expect(events).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0]?.[0] as string;
    expect(written).toContain('"type":"control_response"');
    expect(written).toContain('"behavior":"allow"');
    expect(written).toContain('"request_id":"req_001"');
    expect(written).toContain('"command":"ls"'); // updatedInput 透传 input
    expect(written.endsWith('\n')).toBe(true);
  });

  it('stdin 未注入 → 不崩溃，返回 []', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.parse(firstLine(loadLines('stream-json/claude-control-request.jsonl')))).toEqual([]);
  });

  it('stdin.write 抛异常 → 静默吞掉，不外抛', () => {
    const write = vi.fn(() => {
      throw new Error('BrokenPipe');
    });
    const mockStdin = { write } as unknown as NodeJS.WritableStream;
    const a = new StreamJsonAdapter('claude');
    a.attachStdin(mockStdin);
    expect(() =>
      a.parse(firstLine(loadLines('stream-json/claude-control-request.jsonl'))),
    ).not.toThrow();
  });
});

// ===========================================================================
// 完整会话 / control 流程（多行 fixture）
// ===========================================================================

describe('full session / control flow', () => {
  it('claude-full-session: system → assistant → result', () => {
    const a = new StreamJsonAdapter('claude');
    const lines = loadLines('stream-json/claude-full-session.jsonl');
    const all: AgentEvent[] = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) all.push(...ev);
    }
    // system(status) + assistant(text) + result(complete) = 3 events
    expect(all.length).toBe(3);
    expect(a.getSessionId()).toBe('sess_001');
    expect(a.getLastResultInfo()?.resultText).toBe('Done');
  });

  it('claude-control-flow: system → control_request → assistant → result', () => {
    const write = vi.fn();
    const mockStdin = { write } as unknown as NodeJS.WritableStream;
    const a = new StreamJsonAdapter('claude');
    a.attachStdin(mockStdin);
    const lines = loadLines('stream-json/claude-control-flow.jsonl');
    const all: AgentEvent[] = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) all.push(...ev);
    }
    // control_request 不产 event：system + assistant + result = 3
    expect(all.length).toBe(3);
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0]?.[0] as string;
    expect(written).toContain('"command":"echo hello"');
  });
});

// ===========================================================================
// provider 三合一 + implements ProtocolAdapter
// ===========================================================================

describe('provider 三合一 (claude/gemini/cursor)', () => {
  it('provider 字段正确', () => {
    expect(new StreamJsonAdapter('claude').provider).toBe('claude');
    expect(new StreamJsonAdapter('gemini').provider).toBe('gemini');
    expect(new StreamJsonAdapter('cursor').provider).toBe('cursor');
  });

  it('gemini-typical: 等价解析 + session_id 前缀保留', () => {
    const a = new StreamJsonAdapter('gemini');
    const events = a.parse(firstLine(loadLines('stream-json/gemini-typical.jsonl')));
    expect(events?.[0]?.metadata?.session_id).toBe('gemini-xyz789');
    expect(a.getSessionId()).toBe('gemini-xyz789');
  });

  it('cursor-typical: 等价解析 + session_id 前缀保留', () => {
    const a = new StreamJsonAdapter('cursor');
    const events = a.parse(firstLine(loadLines('stream-json/cursor-typical.jsonl')));
    expect(events?.[0]?.metadata?.session_id).toBe('cursor-abc456');
    expect(a.getSessionId()).toBe('cursor-abc456');
  });

  it('implements ProtocolAdapter 契约', () => {
    const a: ProtocolAdapter = new StreamJsonAdapter('claude');
    expect(a.provider).toBe('claude');
    expect(typeof a.parse).toBe('function');
    expect(typeof a.onControl).toBe('function');
    // buildArgs / buildInput 也是契约方法（task-runner spawn + stdin 写入依赖）
    expect(typeof a.buildArgs).toBe('function');
    expect(typeof a.buildInput).toBe('function');
  });
});

// ===========================================================================
// buildArgs / buildInput（spawn 参数 + stdin 输入，对照 Python _build_args/_build_input）
// task-runner.ts:314/457 调用，缺失会让 claude 裸启动进交互模式 hang。
// ===========================================================================

describe('buildArgs / buildInput (spawn 参数 + stdin 输入)', () => {
  it('buildArgs 含 -p + stream-json 输入输出格式 + bypassPermissions', () => {
    const a = new StreamJsonAdapter('claude');
    const args = a.buildArgs();
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    let idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('stream-json');
    expect(args).toContain('--input-format');
    idx = args.indexOf('--input-format');
    expect(args[idx + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--permission-mode');
    idx = args.indexOf('--permission-mode');
    expect(args[idx + 1]).toBe('bypassPermissions');
  });

  it('buildArgs 无 resume 时不带 --resume', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.buildArgs()).not.toContain('--resume');
    expect(a.buildArgs({})).not.toContain('--resume');
    expect(a.buildArgs({ model: 'sonnet', sessionId: 's1' })).not.toContain('--resume');
  });

  it('buildArgs model 非空时追加 --model <name>', () => {
    const a = new StreamJsonAdapter('claude');
    const args = a.buildArgs({ model: 'claude-sonnet-4' });
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-sonnet-4');
  });

  it('buildArgs model 空白时不追加 --model', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.buildArgs({ model: '   ' })).not.toContain('--model');
  });

  it('buildArgs resumeSessionId 非空时追加 --resume <id>（多轮续跑）', () => {
    const a = new StreamJsonAdapter('claude');
    const args = a.buildArgs({ resumeSessionId: 'sess_resume_123' });
    const idx = args.indexOf('--resume');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('sess_resume_123');
    // 其余基础参数仍在
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
  });

  it('buildInput 返回合法 user message JSON（对照 Python TestBuildInput）', () => {
    const a = new StreamJsonAdapter('claude');
    const data = a.buildInput('hello world');
    // 末尾换行先剥掉再 parse
    expect(data.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(data.slice(0, -1)) as {
      type: string;
      message: { role: string; content: Array<{ type: string; text: string }> };
    };
    expect(parsed.type).toBe('user');
    expect(parsed.message.role).toBe('user');
    expect(parsed.message.content).toHaveLength(1);
    expect(parsed.message.content[0]?.type).toBe('text');
    expect(parsed.message.content[0]?.text).toBe('hello world');
  });

  it('buildInput 结尾是 \\n（NDJSON 单行）', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.buildInput('test prompt').endsWith('\n')).toBe(true);
  });

  it('buildInput 含特殊字符的 prompt 也合法（不破坏 JSON）', () => {
    const a = new StreamJsonAdapter('claude');
    const data = a.buildInput('line1\nline2 "quote" {brace}');
    const json = data.slice(0, -1);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as { message: { content: Array<{ text: string }> } };
    expect(parsed.message.content[0]?.text).toBe('line1\nline2 "quote" {brace}');
  });

  it('三个 provider（claude/gemini/cursor）都实现了 buildArgs/buildInput', () => {
    for (const p of ['claude', 'gemini', 'cursor'] as const) {
      const a = new StreamJsonAdapter(p);
      expect(typeof a.buildArgs).toBe('function');
      expect(typeof a.buildInput).toBe('function');
      expect(a.buildArgs()).toContain('-p');
      expect(a.buildInput('hi').endsWith('\n')).toBe(true);
    }
  });
});

// ===========================================================================
// ql-20260617-006 / ql-20260617-007：stream_event 实时 usage 累加测试
// 覆盖：
//   - --include-partial-messages 启用的 buildArgs 标志
//   - message_delta 真 usage → 产 usage_update event + 累加到 _accumulatedUsage
//   - content_block_delta 流式估算 → output_tokens 增长（节流 20 token）
//   - message_delta 覆盖估算值（_currentTurnHasRealUsage flag）
//   - resetAccumulator / message_start 重置状态
// ===========================================================================

describe('ql-006/007 stream_event 实时 usage 累加', () => {
  it('buildArgs 含 --include-partial-messages（启用 message_delta 流）', () => {
    const a = new StreamJsonAdapter('claude');
    expect(a.buildArgs()).toContain('--include-partial-messages');
  });

  it('message_delta 真 usage → 产 usage_update event（snapshot = 累计 + 当前 turn）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    const events = a.parse(line) ?? [];
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('text');
    expect(ev.metadata?.status).toBe('usage_update');
    expect(ev.metadata?.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
    });
  });

  it('message_delta usage 无增长 → 不产 event（节流）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    expect(a.parse(line)).toBeNull();
  });

  it('content_block_delta text_delta → 估算 output_tokens 增长', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();
    // 短 delta（est=1）→ 不到节流阈值，不产 event（但内部累加器仍 +1）
    const shortLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'abc' },
      },
    });
    expect(a.parse(shortLine)).toBeNull();

    // 长 delta（est=20）→ 累计 1+20=21 ≥ 20，产 event
    const longLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a'.repeat(60) },
      },
    });
    const events = a.parse(longLine) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.status).toBe('usage_update');
    // est = 1 (上轮 short) + ceil(60/3)=20 = 21
    expect(events[0]!.metadata?.usage?.output_tokens).toBe(21);
    expect(events[0]!.metadata?.usage?.input_tokens).toBe(0);
  });

  it('ql-20260617-010 / ql-20260617-012 content_block_delta thinking_delta → 累积到 buffer 不立即 emit（节流）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'I should consider...' },
      },
    });
    // 18 字符 < 80 阈值 → 累积，parse 返回 null
    expect(a.parse(line)).toBeNull();
  });

  it('ql-20260617-012 thinking_delta 累积达 THINKING_FLUSH_CHARS 字符 → flush emit', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();

    // 发 3 段 delta：每段 30 字符，总 90 ≥ 80 阈值
    const pieces = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)];
    let lastEvents: AgentEvent[] | null = null;
    for (const p of pieces) {
      lastEvents = a.parse(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: p },
          },
        }),
      );
    }
    // 最后一段触发 flush（累积 ≥ 80 字符）
    expect(lastEvents).not.toBeNull();
    expect(lastEvents).toHaveLength(1);
    expect(lastEvents![0]!.type).toBe('text');
    expect(lastEvents![0]!.content).toBe('a'.repeat(30) + 'b'.repeat(30) + 'c'.repeat(30));
    expect(lastEvents![0]!.metadata?.thinking).toBe(true);
  });

  it('ql-20260617-012 thinking_delta 累积达 THINKING_FLUSH_MS 时间窗口 → flush emit', () => {
    vi.useFakeTimers();
    try {
      const a = new StreamJsonAdapter('claude');
      a.resetAccumulator();

      // 第一个 delta 累积（30 字符 < 80 阈值，刚入 buffer）
      const first = a.parse(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'thinking chunk 1' },
          },
        }),
      );
      expect(first).toBeNull();

      // 时间前进 150ms（> 120ms 阈值），第二个 delta 触发时间窗口 flush
      vi.advanceTimersByTime(150);
      const second = a.parse(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'thinking chunk 2' },
          },
        }),
      );
      expect(second).not.toBeNull();
      expect(second).toHaveLength(1);
      expect(second![0]!.content).toBe('thinking chunk 1thinking chunk 2');
      expect(second![0]!.metadata?.thinking).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ql-20260617-012 thinking_delta 残留 buffer 在 parseAssistant 入口 flush（不丢尾部）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();

    // 1) 单个 thinking_delta 累积到 buffer（< 阈值，不 emit）
    const deltaLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'streamed thinking content' },
      },
    });
    expect(a.parse(deltaLine)).toBeNull();

    // 2) assistant 消息到达 → 入口 flush 残留 thinking + 处理 content blocks
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', text: 'streamed thinking content (full)' },
          { type: 'text', text: 'final answer' },
        ],
      },
    });
    const events = a.parse(assistantLine) ?? [];
    // flush 残留 thinking (1) + text block (1) = 2 events
    // 完整 thinking block 被跳过（turnEmittedThinking=true）
    expect(events).toHaveLength(2);
    expect(events[0]!.content).toBe('streamed thinking content');
    expect(events[0]!.metadata?.thinking).toBe(true);
    expect(events[1]!.content).toBe('final answer');
    expect(events[1]!.metadata?.thinking).toBeUndefined();
  });

  it('content_block_delta 非 text/thinking delta → 跳过（其他 delta 类型）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
    });
    expect(a.parse(line)).toBeNull();
  });

  it('message_delta 覆盖估算值（_currentTurnHasRealUsage 后 delta 不再更新）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();

    // 1) 先发 message_delta 给真 usage
    const realLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { input_tokens: 1000, output_tokens: 100 },
      },
    });
    const realEv = a.parse(realLine) ?? [];
    expect(realEv[0]!.metadata?.usage?.output_tokens).toBe(100);

    // 2) 后续 content_block_delta 应被忽略（不覆盖真值）
    const deltaLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a'.repeat(60) },
      },
    });
    expect(a.parse(deltaLine)).toBeNull();
  });

  it('assistant 事件 commit 后 _currentTurnHasRealUsage 重置（下一 turn 可重新估算）', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();

    // turn 1: message_delta + assistant commit
    const realLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    a.parse(realLine);

    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    a.parse(assistantLine);

    // turn 2: message_start 重置 flag → content_block_delta 应该能估算
    const startLine = JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start' },
    });
    a.parse(startLine);

    const deltaLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a'.repeat(60) },
      },
    });
    const events = a.parse(deltaLine) ?? [];
    expect(events).toHaveLength(1);
    // 累计值 = turn1 (50) + turn2 估算 (20)
    expect(events[0]!.metadata?.usage?.output_tokens).toBe(70);
  });

  it('resetAccumulator 清零所有状态（_currentTurnUsage / flag / emit 节流）', () => {
    const a = new StreamJsonAdapter('claude');
    // 先污染状态
    const realLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    a.parse(realLine);

    a.resetAccumulator();

    // 重置后，content_block_delta 应能正常估算
    const deltaLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a'.repeat(60) },
      },
    });
    const events = a.parse(deltaLine) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.usage).toEqual({
      input_tokens: 0,
      output_tokens: 20,
    });
  });

  it('content_block_delta 节流：累计增长不到 20 token 时不 emit', () => {
    const a = new StreamJsonAdapter('claude');
    a.resetAccumulator();

    // 多次小 delta 累计 < 20，无 event
    for (let i = 0; i < 5; i++) {
      const line = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'ab' }, // est=1
        },
      });
      expect(a.parse(line)).toBeNull();
    }

    // 再来一次大 delta，累计 5+20=25，emit
    const bigLine = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a'.repeat(60) },
      },
    });
    const events = a.parse(bigLine) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.usage?.output_tokens).toBe(25);
  });
});
