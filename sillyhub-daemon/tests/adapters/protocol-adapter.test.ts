// tests/adapters/protocol-adapter.test.ts
// task-05 接口契约验证：mock adapter 能赋值给 ProtocolAdapter，
// parse 返回 AgentEvent[] | null，onControl 可选（省略不报错）。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { AgentEvent } from '../../src/types';
import type { ProtocolAdapter, BackendExecResult } from '../../src/adapters/protocol-adapter';

// AC-03: mock adapter 能赋值给 ProtocolAdapter 接口（onControl 故意不实现）
const mockAdapter: ProtocolAdapter = {
  provider: 'mock',
  parse(line: string): AgentEvent[] | null {
    return line.trim() ? [{ type: 'text', content: line }] : null;
  },
};

describe('ProtocolAdapter interface contract', () => {
  it('mock adapter satisfies ProtocolAdapter (no onControl needed)', () => {
    expect(mockAdapter.provider).toBe('mock');
    const events = mockAdapter.parse('hello');
    expect(events).not.toBeNull();
    expect(events?.[0]?.type).toBe('text');
    expect(events?.[0]?.content).toBe('hello');
  });

  it('parse returns null on blank line', () => {
    expect(mockAdapter.parse('   ')).toBeNull();
    expect(mockAdapter.parse('')).toBeNull();
  });

  it('onControl is optional (callable via ?. without implementing)', () => {
    // 未实现 onControl，可选链调用应为 undefined（no-op）
    expect(mockAdapter.onControl).toBeUndefined();
    expect(() => mockAdapter.onControl?.(process.stdin)).not.toThrow();
  });

  it('parse return type is AgentEvent[] | null', () => {
    const r = mockAdapter.parse('x');
    expectTypeOf(r).toEqualTypeOf<AgentEvent[] | null>();
  });
});

describe('BackendExecResult interface contract', () => {
  it('minimal BackendExecResult (status + output only)', () => {
    const result: BackendExecResult = {
      status: 'completed',
      output: 'done',
    };
    expect(result.status).toBe('completed');
    expect(result.output).toBe('done');
    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });

  it('status is exactly completed | failed | timeout', () => {
    expectTypeOf<BackendExecResult['status']>().toEqualTypeOf<'completed' | 'failed' | 'timeout'>();
  });
});
