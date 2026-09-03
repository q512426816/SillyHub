// tests/agent-event-schema.test.ts
// task-01（2026-09-03-agent-provider-abstraction）：AgentEvent v2 zod schema 校验 +
// schema 推断类型与 AgentEvent 接口字段集合一致性守护（design.md §7）。
//
// 覆盖：
//   - 合法：8 型各一（status 带 subtype；tool_use 带 tool_name/call_id）+
//     subtype 全枚举 + 全一等字段填充用例；
//   - 非法：缺 type / 未知 type / status 缺 subtype（superRefine 交叉校验）/
//     缺 content / 未知 subtype；
//   - 一致性：类型层 expectTypeOf（z.infer ≡ AgentEvent）+ 运行时对象键集合断言。

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  agentEventSchema,
  parseAgentEvent,
  safeParseAgentEvent,
} from '../src/agent-event-schema.js';
import type { AgentEvent } from '../src/types.js';

describe('agent-event-schema 合法用例（8 型各一）', () => {
  it('text：最小形态', () => {
    const ev = { type: 'text', content: 'hello' } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('thinking：partial 流式形态（is_partial + segment_id）', () => {
    const ev = {
      type: 'thinking',
      content: '先分析调用链…',
      is_partial: true,
      segment_id: 'seg-think-1',
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('tool_use：带 tool_name / call_id（provider 原生工具名不重命名）', () => {
    const ev = {
      type: 'tool_use',
      content: '{"file_path":"a.ts"}',
      tool_name: 'Edit',
      call_id: 'toolu_01',
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('tool_result：与 tool_use 经 call_id 配对', () => {
    const ev = {
      type: 'tool_result',
      content: 'ok',
      tool_name: 'Edit',
      call_id: 'toolu_01',
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('status：带 subtype（session_started + session_id）', () => {
    const ev = {
      type: 'status',
      content: '',
      subtype: 'session_started',
      session_id: 'sess-abc',
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('error：最小形态', () => {
    const ev = { type: 'error', content: 'boom' } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('turn_result：携带 usage（交互式一轮结束）', () => {
    const ev = {
      type: 'turn_result',
      content: '',
      usage: { input_tokens: 12, output_tokens: 34 },
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('complete：批量兼容别名（metadata 长尾透传）', () => {
    const ev = {
      type: 'complete',
      content: '',
      metadata: { model: 'claude-sonnet-4', num_turns: 3 },
    } as const;
    expect(parseAgentEvent(ev)).toEqual(ev);
  });

  it('status：subtype 七个枚举值全部可解析（D-005@v1 增 thinking_tokens）', () => {
    const subtypes = [
      'session_started',
      'bash_chunk',
      'bash_status',
      'plan_mode',
      'agent_task_status',
      'task_notification',
      'thinking_tokens',
    ] as const;
    for (const subtype of subtypes) {
      const res = safeParseAgentEvent({ type: 'status', content: '', subtype });
      expect(res.success).toBe(true);
    }
  });
});

describe('agent-event-schema 全字段填充', () => {
  // 全 16 个字段都赋实值：既是"全一等字段可解析"用例，也是运行时键集合断言的锚
  // （对象字面量标注 AgentEvent，编译期保证键 ⊆ 接口键；全赋值 ⇒ 键 = 接口全集）。
  const fullEvent: AgentEvent = {
    type: 'status',
    content: 'session started',
    subtype: 'session_started',
    seq: 3,
    tool_name: 'Task',
    call_id: 'toolu_02',
    session_id: 'sess-01',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
      ctx_tokens: 100, // D-005@v1 补遗字段（上下文环分子）
    },
    parent_tool_use_id: 'toolu_parent',
    subagent_type: 'general-purpose',
    depth: 2,
    segment_id: 'seg-01',
    is_partial: false,
    override: true,
    edit_patch: '{"old_string":"a","new_string":"b"}',
    metadata: { claude_code_version: '1.0.0' },
  };

  it('全字段填充可解析且逐字段保真', () => {
    expect(parseAgentEvent(fullEvent)).toEqual(fullEvent);
  });

  it('解析结果键集合 = AgentEvent 接口 16 键全集', () => {
    const expectedKeys = [
      'type',
      'content',
      'subtype',
      'seq',
      'tool_name',
      'call_id',
      'session_id',
      'usage',
      'parent_tool_use_id',
      'subagent_type',
      'depth',
      'segment_id',
      'is_partial',
      'override',
      'edit_patch',
      'metadata',
    ].sort();
    expect(Object.keys(parseAgentEvent(fullEvent)).sort()).toEqual(expectedKeys);
  });

  it('顶层未知键被剥离（开放长尾一律进 metadata）', () => {
    expect(
      parseAgentEvent({ ...fullEvent, bogus_key: 'x' } as Record<string, unknown>),
    ).toEqual(fullEvent);
  });
});

describe('agent-event-schema 非法用例', () => {
  it('缺 type：解析失败，issue path 指向 type，parseAgentEvent 抛 ZodError', () => {
    const res = safeParseAgentEvent({ content: 'x' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('type'))).toBe(true);
    }
    expect(() => parseAgentEvent({ content: 'x' })).toThrowError(z.ZodError);
  });

  it('未知 type 值：解析失败，issue path 指向 type', () => {
    const res = safeParseAgentEvent({ type: 'bogus', content: '' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('type'))).toBe(true);
    }
  });

  it("status 缺 subtype：superRefine 交叉校验拒绝，issue path 指向 subtype", () => {
    const res = safeParseAgentEvent({ type: 'status', content: '' });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.path.includes('subtype'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('subtype');
    }
    expect(() => parseAgentEvent({ type: 'status', content: '' })).toThrowError(
      z.ZodError,
    );
  });

  it('缺 content：解析失败，issue path 指向 content', () => {
    const res = safeParseAgentEvent({ type: 'text' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('content'))).toBe(true);
    }
  });

  it('未知 subtype 值：解析失败', () => {
    const res = safeParseAgentEvent({
      type: 'status',
      content: '',
      subtype: 'bogus',
    });
    expect(res.success).toBe(false);
  });

  it('usage 形态非法：解析失败', () => {
    const res = safeParseAgentEvent({
      type: 'turn_result',
      content: '',
      usage: { input_tokens: 'not-a-number' },
    });
    expect(res.success).toBe(false);
  });

  it('非对象输入：解析失败', () => {
    expect(safeParseAgentEvent('text').success).toBe(false);
    expect(safeParseAgentEvent(null).success).toBe(false);
  });
});

describe('agent-event-schema 与 TS 类型一致性（类型层断言）', () => {
  it('z.infer 与 AgentEvent 接口完全相等（字段 + 可选性）', () => {
    type SchemaEvent = z.infer<typeof agentEventSchema>;
    expectTypeOf<SchemaEvent>().toEqualTypeOf<AgentEvent>();
  });

  it('z.infer 与 AgentEvent 接口字段键集合一致', () => {
    type SchemaEvent = z.infer<typeof agentEventSchema>;
    expectTypeOf<keyof SchemaEvent>().toEqualTypeOf<keyof AgentEvent>();
  });
});
