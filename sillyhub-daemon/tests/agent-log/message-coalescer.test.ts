/**
 * tests/agent-log/message-coalescer.test.ts —— F2b（2026-10-12-session-defects
 * task-02 / FR-03）消息级 delta 合并缓冲器单测。
 *
 * 守护点（acceptance 逐条）：
 *  1. 同一 message id 的 3 个 delta（A/B/C）缓冲后（经完结触发）冲刷为单行
 *     "ABC"，无独立 delta 行残留；
 *  2. 无完结事件 + TTL 超龄 → 下次 feed 惰性冲刷为独立行，内容零丢失；
 *  3. 跨消息隔离：两个 message id 的 delta 序列互不串缓冲；
 *  4. 容量超限立即冲刷不丢内容；无 id 的 delta 保持直发（宁碎片不丢）；
 *  5. flushAll turn 边界清空。
 */

import { describe, expect, it } from 'vitest';

import {
  COALESCER_CAP_BYTES,
  COALESCER_TTL_MS,
  MessageCoalescer,
} from '../../src/agent-log/message-coalescer.js';
import { eventToSubmitMessages } from '../../src/event-wire.js';
import type { AgentEvent } from '../../src/types.js';

function delta(id: string, text: string, thinking = false): AgentEvent {
  return {
    type: 'text',
    content: text,
    metadata: { streaming: true, message_id: id, ...(thinking ? { thinking: true } : {}) },
  };
}

function complete(id: string, text: string): AgentEvent {
  return { type: 'text', content: text, metadata: { message_id: id } };
}

describe('MessageCoalescer', () => {
  it('3 delta 并入缓冲不直发；完结触发冲刷为单行完整内容', () => {
    const c = new MessageCoalescer();
    expect(c.feed(delta('m1', 'A'))).toEqual([]);
    expect(c.feed(delta('m1', 'B'))).toEqual([]);
    expect(c.feed(delta('m1', 'C'))).toEqual([]);
    expect(c.size).toBe(1);
    // 完整行到达 → 同 id 缓冲保底冲刷（单行 ABC）。
    const flushed = c.feed(complete('m1', 'ABC'));
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.content).toBe('ABC');
    expect(c.size).toBe(0);
  });

  it('TTL 超龄：无完结事件时下次 feed 惰性冲刷，内容零丢失', () => {
    let clock = 1_000;
    const c = new MessageCoalescer(() => clock);
    c.feed(delta('m1', 'HELLO'));
    expect(c.size).toBe(1);
    clock += COALESCER_TTL_MS + 1;
    // 新事件（另一消息）触发惰性冲刷。
    const out = c.feed(delta('m2', 'x'));
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe('HELLO');
    expect(c.size).toBe(1); // 仅剩 m2
  });

  it('跨消息隔离：两个 id 的 delta 互不串缓冲', () => {
    const c = new MessageCoalescer();
    c.feed(delta('m1', 'A1'));
    c.feed(delta('m2', 'B1'));
    c.feed(delta('m1', 'A2'));
    c.feed(delta('m2', 'B2'));
    expect(c.size).toBe(2);
    const out = c.feed(complete('m1', 'A1A2'));
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe('A1A2');
    expect(c.size).toBe(1); // m2 未受影响
    const rest = c.flushAll();
    expect(rest[0]!.content).toBe('B1B2');
  });

  it('容量超限立即冲刷不丢内容', () => {
    const c = new MessageCoalescer();
    const big = 'x'.repeat(COALESCER_CAP_BYTES);
    expect(c.feed(delta('m1', big))).toEqual([]);
    const out = c.feed(delta('m1', 'TAIL'));
    expect(out).toHaveLength(1);
    expect(out[0]!.content.endsWith('TAIL')).toBe(true);
    expect(out[0]!.content.startsWith(big)).toBe(true);
  });

  it('无 id 的 delta 保持直发（宁碎片不丢内容）', () => {
    const c = new MessageCoalescer();
    const out = c.feed({ type: 'text', content: 'no-id', metadata: { streaming: true } });
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe('no-id');
    expect(c.size).toBe(0);
  });

  it('flushAll turn 边界清空全部缓冲', () => {
    const c = new MessageCoalescer();
    c.feed(delta('m1', 'a'));
    c.feed(delta('m2', 'b'));
    const out = c.flushAll();
    expect(out).toHaveLength(2);
    expect(c.size).toBe(0);
  });
});

describe('eventToSubmitMessages × coalescer 接入', () => {
  it('传入 coalescer：流式 delta 走缓冲（不直发），完结事件照常输出完整行', () => {
    const c = new MessageCoalescer();
    // delta 全部入缓冲 → 无直发行（wire 语义 null = 本事件零输出）。
    expect(eventToSubmitMessages(delta('m1', 'A'), c)).toBeNull();
    expect(eventToSubmitMessages(delta('m1', 'B'), c)).toBeNull();
    // 完整行（非 streaming）照常渲染输出。
    const out = eventToSubmitMessages(complete('m1', 'AB'), c);
    expect(out).not.toBeNull();
    // 完整行渲染带 [ASSISTANT] 前缀（legacy 渲染轨口径）；保底冲刷行为裸拼接。
    const contents = out!.map((m) => String(m['content']));
    expect(contents).toContain('[ASSISTANT] AB');
    expect(contents).toContain('AB');
  });

  it('不传 coalescer：流式 delta 保持 legacy 直发（零回归）', () => {
    const out = eventToSubmitMessages(delta('m1', 'A'));
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    expect(out![0]!['content']).toBe('A');
  });
});
