// tests/adapters/json-rpc.test.ts
// task-07: JsonRpcAdapter 解析逻辑 1:1 迁移自 Python test_json_rpc.py。
// fixture 从 Python _make_rpc_* helper 实际调用处提取（tests/fixtures/json-rpc/）。
// turn/started 按 IR 收敛规则映射为 type:'text' + metadata.status（对齐 task-02/task-06）。

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { loadFixture } from '../helpers';
import { JsonRpcAdapter } from '../../src/adapters/json-rpc';
import type { ProtocolAdapter, PendingServerRequest } from '../../src/adapters/json-rpc';
import type { AgentEvent } from '../../src/types';

/** 取数组首元素，noUncheckedIndexedAccess 下兜底 null。 */
function first<T>(arr: T[] | null): T | null {
  return arr && arr.length > 0 ? arr[0] ?? null : null;
}

const P = (provider: 'codex' | 'hermes' | 'kimi' | 'kiro', name: string) =>
  loadFixture(`json-rpc/${provider}/${name}`);

// ===========================================================================
// notification: item/completed (agentMessage / commandExecution / fileChange)
// 对照 Python parse_output L705-727
// ===========================================================================

describe('parse notification - item/completed', () => {
  it('agentMessage → text event', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-completed-agentMessage.json'));
    const ev = first(events);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('text');
    expect(ev!.content).toBe('Hello'); // 源 test L596
    expect(ev!.metadata?.call_id).toBe('i1');
  });

  it('commandExecution → tool_result + aggregatedOutput', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-completed-commandExecution.json'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_result');
    expect(ev!.metadata?.tool_name).toBe('exec_command');
    expect(ev!.metadata?.call_id).toBe('i2');
    expect(ev!.content).toContain('file1.txt'); // 源 test L642
    expect(ev!.content).toContain('file2.txt');
  });

  it('fileChange → tool_result patch_apply（content 空）', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-completed-fileChange.json'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_result');
    expect(ev!.metadata?.tool_name).toBe('patch_apply');
    expect(ev!.metadata?.call_id).toBe('i3');
    expect(ev!.content).toBe(''); // 源 test L671-675 无 output
  });
});

// ===========================================================================
// notification: item/started (commandExecution / fileChange)
// 对照 Python parse_output L728-745
// ===========================================================================

describe('parse notification - item/started', () => {
  it('commandExecution → tool_use + command', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-started-commandExecution.json'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata?.tool_name).toBe('exec_command');
    expect(ev!.metadata?.call_id).toBe('i2'); // 源 test L617
    expect(ev!.content).toBe('ls -la');
  });

  it('fileChange → tool_use patch_apply', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-started-fileChange.json'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata?.tool_name).toBe('patch_apply');
    expect(ev!.metadata?.call_id).toBe('i3');
  });

  // ql-20260618-004：reasoning + delta 流式
  it('item/started reasoning → text + thinking=true + summary 文本', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-started-reasoning.json'));
    const ev = first(events);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('text');
    expect(ev!.metadata?.thinking).toBe(true);
    expect(ev!.content).toBe("Analyzing the user's question");
    expect(ev!.metadata?.source).toBe('reasoning_started');
  });

  it('item/agentMessage/delta 小 delta（< 阈值）→ null，暂存 buffer', () => {
    const a = new JsonRpcAdapter('codex');
    // "Hello" = 5 字符 < 80 阈值，进 buffer，parse 返回 null
    const events = a.parse(P('codex', 'notification-item-agentMessage-delta.json'));
    expect(events).toBeNull();
  });

  it('ql-20260618-005 item/agentMessage/delta 累积达 AGENT_MESSAGE_FLUSH_CHARS → flush', () => {
    const a = new JsonRpcAdapter('codex');
    // 发 3 段 delta：每段 30 字符，总 90 ≥ 80 阈值
    const pieces = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)];
    let lastEvents: AgentEvent[] | null = null;
    for (const p of pieces) {
      lastEvents = a.parse(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { threadId: 't1', turnId: 'tu1', itemId: 'msg_xyz', delta: p },
        }),
      );
    }
    // 最后一段触发 flush（累积 ≥ 80 字符）
    expect(lastEvents).not.toBeNull();
    expect(lastEvents).toHaveLength(1);
    expect(lastEvents![0]!.type).toBe('text');
    expect(lastEvents![0]!.content).toBe('a'.repeat(30) + 'b'.repeat(30) + 'c'.repeat(30));
    expect(lastEvents![0]!.metadata?.source).toBe('agent_message_delta');
    expect(lastEvents![0]!.metadata?.streaming).toBe(true);
    expect(lastEvents![0]!.metadata?.call_id).toBe('msg_xyz');
  });

  it('ql-20260618-005 item/agentMessage/delta 累积达 AGENT_MESSAGE_FLUSH_MS 时间窗口 → flush', () => {
    vi.useFakeTimers();
    try {
      const a = new JsonRpcAdapter('codex');
      // 第一段 delta 入 buffer（5 字符 < 阈值）
      const first = a.parse(P('codex', 'notification-item-agentMessage-delta.json'));
      expect(first).toBeNull();

      // 时间前进 150ms（> 120ms 阈值），第二段 delta 触发时间窗口 flush
      vi.advanceTimersByTime(150);
      const second = a.parse(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { threadId: 't1', turnId: 'tu1', itemId: 'msg_xyz', delta: ' world' },
        }),
      );
      expect(second).not.toBeNull();
      expect(second).toHaveLength(1);
      expect(second![0]!.content).toBe('Hello world');
      expect(second![0]!.metadata?.streaming).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ql-20260618-005 itemId 切换时 flush 旧 buffer（多 message 边界）', () => {
    const a = new JsonRpcAdapter('codex');
    // 第一条 message 的 delta（小，未达阈值）
    expect(
      a.parse(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { threadId: 't1', turnId: 'tu1', itemId: 'msg_a', delta: 'part1' },
        }),
      ),
    ).toBeNull();

    // 第二条 message 的 delta → 应触发旧 buffer flush
    const events = a.parse(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { threadId: 't1', turnId: 'tu1', itemId: 'msg_b', delta: 'part2' },
      }),
    );
    expect(events).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events![0]!.content).toBe('part1');
    expect(events![0]!.metadata?.call_id).toBe('msg_a');
  });

  it('ql-20260618-005 item/completed(agentMessage) flush 残留 buffer + 跳过重复文本', () => {
    const a = new JsonRpcAdapter('codex');
    // 先发 delta（小，未达阈值，进 buffer）
    a.parse(P('codex', 'notification-item-agentMessage-delta.json'));
    // 再发 completed（同 itemId）→ 应 flush buffer（'Hello'），跳过 completed 文本
    const line = JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 't1',
        item: { id: 'msg_xyz', type: 'agentMessage', text: 'Hello world' },
      },
    });
    const events = a.parse(line);
    expect(events).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events![0]!.content).toBe('Hello');
    expect(events![0]!.metadata?.source).toBe('agent_message_delta');
  });

  it('ql-20260618-005 turn/completed flush 残留 buffer（兜底尾部不丢）', () => {
    const a = new JsonRpcAdapter('codex');
    // 单段 delta（小，未达阈值）
    a.parse(P('codex', 'notification-item-agentMessage-delta.json'));
    // turn/completed（无 item/completed 兜底）→ 应 flush buffer 后再产 complete
    const events = a.parse(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      }),
    );
    expect(events).not.toBeNull();
    // 第一条是 flushed delta，最后一条是 complete
    const flushed = events!.find((e) => e.metadata?.source === 'agent_message_delta');
    expect(flushed).toBeDefined();
    expect(flushed!.content).toBe('Hello');
    const complete = events!.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('item/completed(agentMessage) 未走 delta → 正常发完整文本', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-item-completed-agentMessage.json'));
    const ev = first(events);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('text');
    expect(ev!.content).toBe('Hello');
  });
});

// ===========================================================================
// notification: turn/started / turn/completed
// 对照 Python parse_output L747-749 + on_notification L355-377
// ===========================================================================

describe('parse notification - turn lifecycle', () => {
  it('turn/started → text + metadata.status=running（IR 收敛）', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-turn-started.json'));
    const ev = first(events);
    expect(ev).not.toBeNull();
    // IR 收敛：status 合入 text + metadata.status（非 type:'status'，对齐 task-02/06）
    expect(ev!.type).toBe('text');
    expect(ev!.metadata?.status).toBe('running');
    expect(ev!.metadata?.source).toBe('turn_started');
  });

  it('turn/completed success → complete event（Node 升级，Python 返回 None）', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-turn-completed.json'));
    expect(events).not.toBeNull();
    const complete = events!.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    expect(complete!.metadata?.turn_status).toBe('completed');
  });

  it('turn/completed failed → error event + message', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'notification-turn-completed-failed.json'));
    const err = events!.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err!.content).toBe('something went wrong'); // 源 test L929
    expect(err!.metadata?.turn_status).toBe('failed');
  });
});

// ===========================================================================
// server request: approval → tool_use + pending id（AC-03）
// 对照 Python _handle_server_request L237-247
// ===========================================================================

describe('parse server request - pending id 记录与消费', () => {
  it('commandExecution approval → tool_use + 记录 pending id=10', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'server-request-commandExecution-approval.json'));
    const ev = first(events);
    expect(ev!.type).toBe('tool_use');
    expect(ev!.metadata?.kind).toBe('approval');
    expect(ev!.metadata?.auto_accept).toBe(true);
    expect(ev!.metadata?.response_template).toEqual({ decision: 'accept' });
    // AC-03: pending id 已记录
    const pending = a.getPendingServerRequests();
    expect(pending.length).toBe(1);
    expect(pending[0]!.id).toBe(10); // 源 test L238
    expect(pending[0]!.method).toBe('item/commandExecution/requestApproval');
    expect(pending[0]!.responseTemplate).toEqual({ decision: 'accept' });
  });

  it('markResponded(10) 移除 pending id', () => {
    const a = new JsonRpcAdapter('codex');
    a.parse(P('codex', 'server-request-commandExecution-approval.json'));
    expect(a.getPendingServerRequests().length).toBe(1);
    a.markResponded(10);
    expect(a.getPendingServerRequests().length).toBe(0);
  });

  it('未知 server request method → error event 但仍登记 id', () => {
    const a = new JsonRpcAdapter('codex');
    const line = '{"jsonrpc":"2.0","id":99,"method":"custom/unknown","params":{}}';
    const events = a.parse(line);
    const ev = first(events);
    expect(ev!.type).toBe('error');
    expect(ev!.content).toContain('unhandled server request');
    expect(a.getPendingServerRequests().length).toBe(1);
    expect(a.getPendingServerRequests()[0]!.responseTemplate).toBeNull();
  });

  it('其他 approval method 也有正确 template（hermes fileChange）', () => {
    const a = new JsonRpcAdapter('hermes');
    a.parse(P('hermes', 'server-request-fileChange-approval.json'));
    const p = a.getPendingServerRequests()[0]!;
    expect(p.id).toBe(11);
    expect(p.method).toBe('item/fileChange/requestApproval');
    expect(p.responseTemplate).toEqual({ decision: 'accept' });
  });

  it('execCommandApproval（kimi）+ mcpServer/elicitation（kiro）template', () => {
    const kimi = new JsonRpcAdapter('kimi');
    kimi.parse(P('kimi', 'server-request-execCommandApproval.json'));
    expect(kimi.getPendingServerRequests()[0]!.responseTemplate).toEqual({ decision: 'accept' });

    const kiro = new JsonRpcAdapter('kiro');
    kiro.parse(P('kiro', 'server-request-mcp-elicitation.json'));
    const kiroPending = kiro.getPendingServerRequests()[0]!;
    expect(kiroPending.responseTemplate).toEqual({ action: 'accept', content: null, _meta: null });
  });
});

// ===========================================================================
// response: thread.id 提取 / capabilities 无事件
// 对照 Python _handle_response + parse_output L697-699
// ===========================================================================

describe('parse response', () => {
  it('thread/start response → text+system event with session_id（ql-20260618-003：不再产 complete）', () => {
    const a = new JsonRpcAdapter('codex');
    const events = a.parse(P('codex', 'response-thread-start.json'));
    expect(events).not.toBeNull();
    // ql-20260618-003：thread/start 只是会话创建，不是任务完成。
    // 改为 text+status=system+subtype=thread_started 承载 session_id，
    // 避免被 TaskRunner 当成任务终结（complete 事件会触发 stats 收集）。
    const sys = events!.find(
      (e) => e.type === 'text' && e.metadata?.status === 'system',
    );
    expect(sys).toBeDefined();
    expect(sys!.metadata?.session_id).toBe('t_abc');
    expect(sys!.metadata?.source).toBe('thread_response');
    expect(sys!.metadata?.subtype).toBe('thread_started');
    // 不应再有 complete 事件（turn 完成由 turn/completed 走 parseTurnCompleted）
    const complete = events!.find((e) => e.type === 'complete');
    expect(complete).toBeUndefined();
  });

  it('initialize response（仅 capabilities，无 thread.id）→ null', () => {
    const a = new JsonRpcAdapter('codex');
    // 对照 Python parse_output L697-699：response 返回 None
    expect(a.parse(P('codex', 'response-initialize.json'))).toBeNull();
  });

  it('error response → error event with code', () => {
    const a = new JsonRpcAdapter('codex');
    const line = '{"jsonrpc":"2.0","id":5,"error":{"code":-32600,"message":"Invalid Request"}}';
    const events = a.parse(line);
    const ev = first(events);
    expect(ev!.type).toBe('error');
    expect(ev!.content).toBe('Invalid Request');
    expect(ev!.metadata?.rpc_error_code).toBe(-32600);
  });
});

// ===========================================================================
// 四 provider 等价（AC-01）
// ===========================================================================

describe('four providers equivalence (AC-01)', () => {
  it.each(['codex', 'hermes', 'kimi', 'kiro'] as const)(
    '%s 解析 agentMessage 等价（产出 text event）',
    (provider) => {
      const a = new JsonRpcAdapter(provider);
      const events = a.parse(P(provider, 'notification-item-completed-agentMessage.json'));
      const ev = first(events);
      expect(ev!.type).toBe('text');
      expect(ev!.content).toBe('Hello');
    },
  );

  it('provider 字段正确', () => {
    expect(new JsonRpcAdapter('codex').provider).toBe('codex');
    expect(new JsonRpcAdapter('hermes').provider).toBe('hermes');
    expect(new JsonRpcAdapter('kimi').provider).toBe('kimi');
    expect(new JsonRpcAdapter('kiro').provider).toBe('kiro');
  });

  it('implements ProtocolAdapter 契约（无 onControl）', () => {
    const a: ProtocolAdapter = new JsonRpcAdapter('codex');
    expect(a.provider).toBe('codex');
    expect(typeof a.parse).toBe('function');
    // AC-10: json_rpc 不实现 onControl
    expect(a.onControl).toBeUndefined();
  });
});

// ===========================================================================
// 边界（AC-08）
// ===========================================================================

describe('parse boundary (→ null)', () => {
  const a = new JsonRpcAdapter('codex');

  it('非 JSON 字符串 → null（不抛异常）', () => {
    expect(a.parse(P('codex', 'malformed-line.txt'))).toBeNull(); // 源 test L526
  });

  it('空字符串 / 空白 → null', () => {
    expect(a.parse('')).toBeNull();
    expect(a.parse('   ')).toBeNull();
  });

  it('非对象 JSON（数组 / 字符串 / 数字 / null）→ null', () => {
    expect(a.parse('[1,2,3]')).toBeNull();
    expect(a.parse('"hello"')).toBeNull();
    expect(a.parse('42')).toBeNull();
    expect(a.parse('true')).toBeNull();
    expect(a.parse('null')).toBeNull();
  });

  it('id=null 的非法 request → null', () => {
    // B-07-7: JSON-RPC 规范不允许 null id
    expect(a.parse('{"jsonrpc":"2.0","id":null,"method":"x"}')).toBeNull();
  });

  it('未知 notification method → null', () => {
    expect(a.parse('{"jsonrpc":"2.0","method":"unknown/method","params":{}}')).toBeNull();
  });

  it('parse 返回类型为 AgentEvent[] | null', () => {
    const r = a.parse('{"jsonrpc":"2.0","method":"item/completed"}');
    expectTypeOf(r).toEqualTypeOf<AgentEvent[] | null>();
  });
});

// ===========================================================================
// PendingServerRequest 接口契约
// ===========================================================================

describe('PendingServerRequest interface', () => {
  it('最小条目（id + method + params + null template）', () => {
    const entry: PendingServerRequest = {
      id: 1,
      method: 'm',
      params: {},
      responseTemplate: null,
    };
    expect(entry.responseTemplate).toBeNull();
  });
});

// ===========================================================================
// buildArgs：四 provider 启动参数差异（ql-20260617-006）
// 对照 Python _PROVIDER_COMMANDS；codex 必须 app-server --listen stdio://，
// 否则 codex CLI 进入交互式 TUI，stdin 非 terminal 立即 exit 1。
// 文档：.sillyspec/changes/2026-06-09-daemon-agent-detection/tasks/task-05.md:67
// ===========================================================================

describe('buildArgs - provider 启动参数（ql-20260617-006）', () => {
  it('codex 返回 app-server --listen stdio://', () => {
    const a = new JsonRpcAdapter('codex');
    expect(a.buildArgs()).toEqual(['app-server', '--listen', 'stdio://']);
  });

  it('codex buildArgs 不受 opts 影响（model/sessionId 不进启动参数）', () => {
    const a = new JsonRpcAdapter('codex');
    const args1 = a.buildArgs({ model: 'gpt-5', sessionId: 's1', resumeSessionId: 'r1' });
    const args2 = a.buildArgs();
    expect(args1).toEqual(args2);
    expect(args1).toEqual(['app-server', '--listen', 'stdio://']);
  });

  it('hermes 返回空数组（无子命令）', () => {
    const a = new JsonRpcAdapter('hermes');
    expect(a.buildArgs()).toEqual([]);
  });

  it('kimi 返回空数组（无子命令）', () => {
    const a = new JsonRpcAdapter('kimi');
    expect(a.buildArgs()).toEqual([]);
  });

  it('kiro 返回空数组（无子命令）', () => {
    const a = new JsonRpcAdapter('kiro');
    expect(a.buildArgs()).toEqual([]);
  });

  it('JsonRpcAdapter 实现 ProtocolAdapter.buildArgs（类型契约）', () => {
    const a: ProtocolAdapter = new JsonRpcAdapter('codex');
    expect(typeof a.buildArgs).toBe('function');
    expect(a.buildArgs!()).toEqual(['app-server', '--listen', 'stdio://']);
  });
});

// ===========================================================================
// buildHandshake / buildTurnStart：codex JSON-RPC 协议握手（ql-20260617-008）
// 文档：design.md §方案A / proposal.md
// 对照实测：codex app-server --listen stdio:// + generate-json-schema
// ===========================================================================

describe('buildHandshake - codex 协议握手序列（ql-20260617-008）', () => {
  it('返回 3 行 JSON-RPC 消息（initialize/initialized/thread.start）', () => {
    const a = new JsonRpcAdapter('codex');
    const lines = a.buildHandshake!({ cwd: '/tmp/ws', prompt: 'hi' });
    expect(lines).toHaveLength(3);

    const init = JSON.parse(lines[0]!);
    expect(init.method).toBe('initialize');
    expect(init.id).toBe(1);
    expect(init.params.clientInfo).toEqual({
      name: 'sillyhub-daemon',
      version: '0.1.0',
    });

    const notif = JSON.parse(lines[1]!);
    expect(notif.method).toBe('notifications/initialized');
    expect(notif.id).toBeUndefined(); // notification 无 id

    const threadStart = JSON.parse(lines[2]!);
    expect(threadStart.method).toBe('thread/start');
    expect(threadStart.id).toBe(2);
    expect(threadStart.params.cwd).toBe('/tmp/ws');
  });

  it('initialize 字段名是 clientInfo 不是 client（codex -32600 防御）', () => {
    const a = new JsonRpcAdapter('codex');
    const lines = a.buildHandshake!({ cwd: '/tmp', prompt: '' });
    const init = JSON.parse(lines[0]!);
    expect(init.params.clientInfo).toBeDefined();
    expect(init.params.client).toBeUndefined();
  });

  it('cwd 透传到 thread/start params', () => {
    const a = new JsonRpcAdapter('codex');
    const lines = a.buildHandshake!({
      cwd: 'C:\\Users\\qinyi\\myaaa',
      prompt: 'scan',
    });
    const threadStart = JSON.parse(lines[2]!);
    expect(threadStart.params.cwd).toBe('C:\\Users\\qinyi\\myaaa');
  });

  it('所有行是合法 JSON（无尾换行）', () => {
    const a = new JsonRpcAdapter('codex');
    const lines = a.buildHandshake!({ cwd: '/tmp', prompt: '' });
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line.endsWith('\n')).toBe(false);
    }
  });

  it('hermes/kimi/kiro 仍可调用 buildHandshake（共享 codex 协议）', () => {
    // 文档 backend-json-rpc.md：四 provider 共享 method 名
    const a = new JsonRpcAdapter('hermes');
    expect(typeof a.buildHandshake).toBe('function');
    const lines = a.buildHandshake!({ cwd: '/tmp', prompt: '' });
    expect(lines).toHaveLength(3);
  });
});

describe('buildTurnStart - turn/start request 构造（ql-20260617-008 / ql-20260617-009 input 字段修正）', () => {
  it('返回 turn/start request，含 threadId + input[{type:text,text:prompt}]（ql-20260617-009 codex 0.131 实测）', () => {
    const a = new JsonRpcAdapter('codex');
    const line = a.buildTurnStart!({
      threadId: '019ed60b-8862-78d0-9299-b99adb9e1dd5',
      prompt: 'hello world',
    });
    const msg = JSON.parse(line);
    expect(msg.method).toBe('turn/start');
    expect(msg.id).toBe(3);
    expect(msg.params.threadId).toBe('019ed60b-8862-78d0-9299-b99adb9e1dd5');
    // codex 0.131 TurnStartParams schema：input: UserInput[]，UserInput = {type:'text', text:string}
    expect(msg.params.input).toEqual([{ type: 'text', text: 'hello world' }]);
    // instructions 字段不应存在（被 codex 拒绝为 -32600 missing field `input`）
    expect(msg.params.instructions).toBeUndefined();
  });

  it('字段名是 threadId 不是 thread_id（codex -32600 防御）', () => {
    const a = new JsonRpcAdapter('codex');
    const line = a.buildTurnStart!({ threadId: 'tid', prompt: '' });
    const msg = JSON.parse(line);
    expect(msg.params.threadId).toBeDefined();
    expect(msg.params.thread_id).toBeUndefined();
  });

  it('input 是数组（即使单条 prompt 也包数组），元素结构 {type:text,text}', () => {
    const a = new JsonRpcAdapter('codex');
    const line = a.buildTurnStart!({ threadId: 'tid', prompt: 'one' });
    const msg = JSON.parse(line);
    expect(Array.isArray(msg.params.input)).toBe(true);
    expect(msg.params.input).toHaveLength(1);
    expect(msg.params.input[0].type).toBe('text');
    expect(msg.params.input[0].text).toBe('one');
  });

  it('model 非空时进 params.model，空时 params 不含 model', () => {
    const a = new JsonRpcAdapter('codex');
    const withModel = JSON.parse(
      a.buildTurnStart!({ threadId: 'tid', prompt: 'p', model: 'gpt-5' }),
    );
    expect(withModel.params.model).toBe('gpt-5');

    const noModel = JSON.parse(
      a.buildTurnStart!({ threadId: 'tid', prompt: 'p' }),
    );
    expect(noModel.params.model).toBeUndefined();
  });

  it('JsonRpcAdapter 实现 ProtocolAdapter.buildHandshake/buildTurnStart（类型契约）', () => {
    const a: ProtocolAdapter = new JsonRpcAdapter('codex');
    expect(typeof a.buildHandshake).toBe('function');
    expect(typeof a.buildTurnStart).toBe('function');
  });
});
