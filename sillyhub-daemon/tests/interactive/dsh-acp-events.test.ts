// tests/interactive/dsh-acp-events.test.ts
// 2026-10-15-dsh-engine-acp task-02：ACP session/update 通知 → AgentEvent 归一化器。
// 样例事件形状对照 dsh 仓库 packages/acp/acp/src/updates.ts（assistantUpdates /
// toolCallUpdate / toolResultUpdate / usageUpdate 的实际产出结构）：
//   agent_thought_chunk {messageId, content:{type:'text',text}}
//   agent_message_chunk {messageId, content:{type:'text'|'image'|'resource_link',...}}
//   tool_call           {toolCallId, title, kind, status:'in_progress', rawInput}
//   tool_call_update    {toolCallId, status:'completed'|'failed', content:[{type:'content',content}]}
//   usage_update        {used, size}
// 未知 sessionUpdate（config_option_update / plan / current_mode_update 等）安全忽略。

import { describe, it, expect } from 'vitest';
import {
  normalizeAcpUpdate,
  type AcpSessionUpdate,
} from '../../src/interactive/dsh-acp-events.js';

describe('normalizeAcpUpdate：文本与思考', () => {
  it('agent_message_chunk text 块 → text 事件（带 messageId 元数据）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm-1',
      content: { type: 'text', text: '你好，世界' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'text',
      content: '你好，世界',
      metadata: { message_id: 'm-1' },
    });
  });

  it('agent_thought_chunk → thinking 事件', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'm-1',
      content: { type: 'text', text: '先想一下' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'thinking', content: '先想一下' });
  });

  it('agent_message_chunk image 块 → 忽略（multimodal=false 已知限制，不产出事件）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm-2',
      content: { type: 'image', data: '...', mimeType: 'image/png' },
    } as AcpSessionUpdate);
    expect(out).toHaveLength(0);
  });

  it('agent_message_chunk resource_link 块 → 文本引用行（模型可见形态保持一致）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm-3',
      content: { type: 'resource_link', name: '设计文档', uri: 'file:///tmp/design.md' },
    } as AcpSessionUpdate);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('text');
    expect(out[0].content).toContain('设计文档');
    expect(out[0].content).toContain('file:///tmp/design.md');
  });

  it('空文本 thought（dsh updates.ts 长度 0 跳过分支的客户端侧防御）→ 不产出', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'm-4',
      content: { type: 'text', text: '' },
    });
    expect(out).toHaveLength(0);
  });
});

describe('normalizeAcpUpdate：工具生命周期', () => {
  it('tool_call in_progress → tool_use 事件（tool_name=title / call_id=toolCallId / 入参 JSON）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'read_file',
      kind: 'other',
      status: 'in_progress',
      rawInput: { path: '/tmp/a.txt' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool_use',
      tool_name: 'read_file',
      call_id: 'tc-1',
    });
    expect(JSON.parse(out[0].content)).toEqual({ path: '/tmp/a.txt' });
  });

  it('tool_call rawInput 为非 JSON 字符串（模型坏输出保留原文）→ content 原文', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-2',
      title: 'bash',
      kind: 'other',
      status: 'in_progress',
      rawInput: 'not-json{',
    } as AcpSessionUpdate);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('tool_use');
    expect(out[0].content).toBe('not-json{');
  });

  it('tool_call_update completed → tool_result（content 块文本拼接）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: '第一行\n' } },
        { type: 'content', content: { type: 'text', text: '第二行' } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'tool_result', call_id: 'tc-1' });
    expect(out[0].content).toBe('第一行\n第二行');
  });

  it('tool_call_update failed → tool_result 带 metadata.status=failed（错误可见不丢）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-3',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'boom' } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool_result',
      call_id: 'tc-3',
      metadata: { tool_status: 'failed' },
    });
    expect(out[0].content).toBe('boom');
  });

  it('tool_call_update 无 content（部分失败形态）→ 空文本 tool_result 仍产出（call_id 配对不悬空）', () => {
    const out = normalizeAcpUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-4',
      status: 'completed',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'tool_result', call_id: 'tc-4', content: '' });
  });
});

describe('normalizeAcpUpdate：上下文用量与未知类型', () => {
  it('usage_update → usage-only 空事件（type=text/content=""，ctx_tokens=used，pi/codex 同款载体）', () => {
    const out = normalizeAcpUpdate({ sessionUpdate: 'usage_update', used: 12345, size: 200000 });
    expect(out).toHaveLength(1);
    const ev = out[0];
    expect(ev.type).toBe('text');
    expect(ev.content).toBe('');
    expect(ev.usage).toEqual({ ctx_tokens: 12345 });
    expect(ev.metadata).toMatchObject({ status: 'usage_update' });
  });

  it('未知 sessionUpdate（config_option_update / plan / current_mode_update / 未来新增）→ 安全忽略返回 []', () => {
    for (const sessionUpdate of ['config_option_update', 'plan', 'current_mode_update', 'user_message_chunk', 'some_future_kind']) {
      expect(normalizeAcpUpdate({ sessionUpdate } as AcpSessionUpdate)).toEqual([]);
    }
  });

  it('整轮样例序列（dsh updates.ts 产出顺序）：thought → message → tool_call → tool_call_update → usage → 逐字段对齐', () => {
    const seq: AcpSessionUpdate[] = [
      { sessionUpdate: 'agent_thought_chunk', messageId: 'm-9', content: { type: 'text', text: '思考中' } },
      { sessionUpdate: 'agent_message_chunk', messageId: 'm-9', content: { type: 'text', text: '我去读文件' } },
      { sessionUpdate: 'tool_call', toolCallId: 'tc-9', title: 'read_file', kind: 'other', status: 'in_progress', rawInput: { path: 'x' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'tc-9', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '内容' } }] },
      { sessionUpdate: 'agent_message_chunk', messageId: 'm-10', content: { type: 'text', text: '结论' } },
      { sessionUpdate: 'usage_update', used: 500, size: 1000 },
    ];
    const events = seq.flatMap(normalizeAcpUpdate);
    expect(events.map((e) => e.type)).toEqual([
      'thinking',
      'text',
      'tool_use',
      'tool_result',
      'text',
      'text',
    ]);
    // 配对完整性：tool_use 与 tool_result 的 call_id 一致
    expect(events[2].call_id).toBe('tc-9');
    expect(events[3].call_id).toBe('tc-9');
    // usage-only 事件内容为空
    expect(events[5].content).toBe('');
  });
});
