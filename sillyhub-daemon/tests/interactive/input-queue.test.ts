// tests/interactive/input-queue.test.ts
// task-04 Step 1：InputQueue per-session AsyncIterable<SDKUserMessage>。
// 行为（spike H2/S1 + 蓝图 §4.1）：
//   - push 后 iterator 按序 yield；close 前已 push 消息全部 yield 完再结束
//   - close 后 push 抛 SessionQueueClosedError
//   - 二次 [Symbol.asyncIterator] 抛 SessionQueueDoubleSubscribeError
//   - turn 级串行：连续 push 两条，慢消费按序不丢
// SDK 不连真实 bigmodel——本测试只测队列语义，不触发 SDK。

import { describe, it, expect } from 'vitest';
import {
  InputQueue,
  SessionQueueClosedError,
  SessionQueueDoubleSubscribeError,
} from '../../src/interactive/input-queue.js';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

function userMsg(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

/**
 * 从 AsyncIterable drain 出全部元素（直到 iterator done），返回数组。
 * 用于一次性消费并断言顺序。
 */
async function drain(queue: InputQueue): Promise<SDKUserMessage[]> {
  const out: SDKUserMessage[] = [];
  for await (const msg of queue) {
    out.push(msg);
  }
  return out;
}

describe('InputQueue', () => {
  it('push 后按序 yield；close 后结束 iterator', async () => {
    const q = new InputQueue();
    q.push(userMsg('A'));
    q.push(userMsg('B'));
    q.close();
    const got = await drain(q);
    expect(got.map((m) => (m.message.content as string[] | string))).toEqual([
      'A',
      'B',
    ]);
  });

  it('close 前已 push 消息必须全部 yield 完再结束', async () => {
    const q = new InputQueue();
    q.push(userMsg('one'));
    q.push(userMsg('two'));
    q.push(userMsg('three'));
    q.close();
    const got = await drain(q);
    expect(got).toHaveLength(3);
    expect(got[0]!.message.content).toBe('one');
    expect(got[2]!.message.content).toBe('three');
  });

  it('push 到未消费队列：close 后 consumer drain 出全部已 push 消息', async () => {
    const q = new InputQueue();
    // 先 push 三条（consumer 尚未启动），再 close
    q.push(userMsg('x'));
    q.push(userMsg('y'));
    q.close();
    const got = await drain(q);
    expect(got.map((m) => m.message.content)).toEqual(['x', 'y']);
  });

  it('turn 级串行：慢消费按 FIFO 顺序不丢消息', async () => {
    const q = new InputQueue();
    const consumed: string[] = [];

    // consumer 先启动（订阅），但消费时每条 sleep 一下
    const consumePromise = (async () => {
      for await (const msg of q) {
        consumed.push(msg.message.content as string);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();

    // 边 sleep 边 push，模拟同 turn / 跨 turn 追加
    q.push(userMsg('m1'));
    await new Promise((r) => setTimeout(r, 10));
    q.push(userMsg('m2'));
    await new Promise((r) => setTimeout(r, 10));
    q.push(userMsg('m3'));
    q.close();

    await consumePromise;
    expect(consumed).toEqual(['m1', 'm2', 'm3']);
  });

  it('close 后 push 抛 SessionQueueClosedError', () => {
    const q = new InputQueue();
    q.close();
    expect(() => q.push(userMsg('late'))).toThrow(SessionQueueClosedError);
    expect(() => q.push(userMsg('late'))).toThrow('SESSION_QUEUE_CLOSED');
  });

  it('close 幂等（多次 close 不抛）', () => {
    const q = new InputQueue();
    q.close();
    expect(() => q.close()).not.toThrow();
    expect(() => q.close()).not.toThrow();
  });

  it('第二次 [Symbol.asyncIterator] 抛 SessionQueueDoubleSubscribeError', async () => {
    const q = new InputQueue();
    q.push(userMsg('a'));
    q.close();
    // 第一次订阅正常 drain
    await drain(q);
    // 第二次订阅应抛
    expect(() => q[Symbol.asyncIterator]()).toThrow(
      SessionQueueDoubleSubscribeError,
    );
    expect(() => q[Symbol.asyncIterator]()).toThrow(
      'SESSION_QUEUE_DOUBLE_SUBSCRIBE',
    );
  });

  it('push 到空队列阻塞直到 push 发生（await 等待）', async () => {
    const q = new InputQueue();
    const first = (async () => {
      for await (const msg of q) {
        return msg.message.content;
      }
      return null;
    })();

    // consumer 已 await，此时 push 一条
    await new Promise((r) => setTimeout(r, 10));
    q.push(userMsg('delayed'));
    q.close();
    expect(await first).toBe('delayed');
  });

  it('close 空队列后 drain 立即返回空数组', async () => {
    const q = new InputQueue();
    q.close();
    const got = await drain(q);
    expect(got).toEqual([]);
  });
});
