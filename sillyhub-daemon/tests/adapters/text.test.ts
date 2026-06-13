// tests/adapters/text.test.ts
// task-10: TextAdapter 解析逻辑 1:1 迁移自 Python test_text_backend.py。
// 仅迁移 parse 相关用例（build_args / output 累积已下沉 task-19，见 N-10-3 / N-10-5）。
// fixture 落盘自 Python parse_line 样本（tests/fixtures/text/antigravity/）。

import { describe, it, expect, expectTypeOf } from 'vitest';
import { loadFixture } from '../helpers';
import { TextAdapter } from '../../src/adapters/text';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter';
import type { AgentEvent } from '../../src/types';

/** fixture 加载器（text/antigravity/<name>）。 */
const F = (name: string): string => loadFixture(`text/antigravity/${name}`);

// ===========================================================================
// meta（对照 Python test_text_backend.py:140-153 TestTextBackendMeta）
// ===========================================================================

describe('meta', () => {
  it('provider = "antigravity"（AC-06）', () => {
    expect(new TextAdapter().provider).toBe('antigravity');
  });

  it('implements ProtocolAdapter 契约（无 onControl，AC-05/AC-09）', () => {
    const a: ProtocolAdapter = new TextAdapter();
    expect(a.provider).toBe('antigravity');
    expect(typeof a.parse).toBe('function');
    expect(a.onControl).toBeUndefined(); // text 协议无 stdin 应答
  });
});

// ===========================================================================
// parse 非空行（对照 Python test_text_backend.py:88-93）
// ===========================================================================

describe('parse — 非空行', () => {
  const a = new TextAdapter();

  it('非空行 → 单元素数组 [{type:text, content:line}]（AC-01）', () => {
    expect(a.parse('Hello, I am an agent')).toEqual([
      { type: 'text', content: 'Hello, I am an agent' },
    ]);
  });

  it('含前后空白的非空行 → content 为 trim 后值', () => {
    expect(a.parse('  hello world  ')).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('fixture single-line.txt 读入后 parse', () => {
    const line = F('single-line.txt').trim();
    expect(a.parse(line)).toEqual([{ type: 'text', content: 'Hello, I am an agent' }]);
  });
});

// ===========================================================================
// parse 空行 / 纯空白行（对照 Python test_text_backend.py:95-103）
// ===========================================================================

describe('parse — 空行 / 纯空白行 → null（AC-02）', () => {
  const a = new TextAdapter();

  it('空字符串 → null', () => {
    expect(a.parse('')).toBeNull();
  });

  it('纯空格 → null', () => {
    expect(a.parse('   ')).toBeNull();
  });

  it('纯 tab → null', () => {
    expect(a.parse('\t\t')).toBeNull();
  });

  it('混合空白（空格 + tab + \\r）→ null', () => {
    expect(a.parse(' \t\r ')).toBeNull();
  });

  it('fixture whitespace.txt → null', () => {
    expect(a.parse(F('whitespace.txt'))).toBeNull();
  });
});

// ===========================================================================
// 无状态（对照 Python _state.output 累积已下沉 task-19）
// ===========================================================================

describe('无状态（AC-08）', () => {
  it('连续 parse 多行，每次结果独立（无累积副作用）', () => {
    const a = new TextAdapter();
    const e1 = a.parse('Line 1');
    const e2 = a.parse('');
    const e3 = a.parse('Line 2');
    expect(e1).toEqual([{ type: 'text', content: 'Line 1' }]);
    expect(e2).toBeNull();
    expect(e3).toEqual([{ type: 'text', content: 'Line 2' }]);
  });

  it('两个 TextAdapter 实例互不影响', () => {
    const a = new TextAdapter();
    const b = new TextAdapter();
    a.parse('foo');
    expect(b.parse('bar')).toEqual([{ type: 'text', content: 'bar' }]);
  });
});

// ===========================================================================
// 事件类型约束（AC-07）：永不返回 complete/error
// ===========================================================================

describe('事件类型约束（AC-07）', () => {
  const a = new TextAdapter();

  it('parse 永不返回 complete/error 事件，恒为 text 或 null', () => {
    const inputs = ['', 'done', 'task completed', 'error occurred', 'EXIT', '  \n  '];
    for (const line of inputs) {
      const events = a.parse(line);
      if (events !== null) {
        for (const ev of events) {
          expect(ev.type).toBe('text');
        }
      }
    }
  });

  it('parse 返回类型为 AgentEvent[] | null', () => {
    const r = a.parse('text');
    expectTypeOf(r).toEqualTypeOf<AgentEvent[] | null>();
  });
});

// ===========================================================================
// CRLF 行尾（B-03 双保险）
// ===========================================================================

describe('CRLF 行尾（B-03）', () => {
  it('残留 \\r 被 trim 吃掉', () => {
    expect(new TextAdapter().parse('hello\r')).toEqual([
      { type: 'text', content: 'hello' },
    ]);
  });

  it('fixture crlf.txt 切行后每行 trim 干净', () => {
    const a = new TextAdapter();
    const lines = F('crlf.txt').split('\n');
    const events = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) events.push(...ev);
    }
    // Hello + World（\r 被 trim），忽略末尾空行
    expect(events).toEqual([
      { type: 'text', content: 'Hello' },
      { type: 'text', content: 'World' },
    ]);
  });
});

// ===========================================================================
// multi-line fixture 端到端（覆盖空行/纯空白行丢弃）
// ===========================================================================

describe('multi-line fixture 端到端', () => {
  it('fixture multi-line.txt：3 条非空行产 3 个 text 事件', () => {
    const a = new TextAdapter();
    const lines = F('multi-line.txt').split('\n');
    const events = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) events.push(...ev);
    }
    // Line 1 / (空行丢弃) / Line 2 / ("   " 丢弃) / Line 3
    expect(events).toEqual([
      { type: 'text', content: 'Line 1' },
      { type: 'text', content: 'Line 2' },
      { type: 'text', content: 'Line 3' },
    ]);
  });
});
