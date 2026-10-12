/**
 * tests/task-runner/spawn-stream-coalescer.test.ts —— F2b 接线
 * （2026-10-13-review-risk-fixes FR-01）渲染轨合并缓冲器生产接线测试。
 *
 * 背景缺陷：bf4c47c07 落了 eventToSubmitMessages(ev, coalescer?) 可选参与
 * MessageCoalescer 本体，但唯一生产调用点（spawn-stream handleLine →
 * _eventToMessages）未传实例——功能死代码，提交宣称的碎片行修复未生效。
 * 本文件守护接线成立：
 *  1. handleLine 把 env.coalescer 透传给 _eventToMessages（接线断言）；
 *  2. 接线后同 id 多条 delta 仅在完结行到达时产出「保底冲刷行 + 完结行」
 *     单批次（前序 delta 零直发，不再逐条碎片行）；
 *  3. attempt 收尾冲刷组合件：coalescerFlushAllMessages 产出带消息级
 *     timestamp 的残留行并清空缓冲；forwardSubmitMessages 经 client
 *     fire-and-forget 转发并入 pendingForwards，空 claimToken 守卫不转发
 *     （与 handleLine 既有口径一致）。
 */

import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { MessageCoalescer } from '../../src/agent-log/message-coalescer.js';
import { coalescerFlushAllMessages, eventToSubmitMessages } from '../../src/event-wire.js';
import {
  forwardSubmitMessages,
  handleLine,
} from '../../src/task-runner/spawn-stream.js';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter.js';
import type { TaskRunnerCore } from '../../src/task-runner/runner-types.js';
import type { AgentEvent } from '../../src/types.js';

function delta(id: string, text: string): AgentEvent {
  return { type: 'text', content: text, metadata: { streaming: true, message_id: id } };
}

function complete(id: string, text: string): AgentEvent {
  return { type: 'text', content: text, metadata: { message_id: id } };
}

interface TestEnv {
  outputParts: string[];
  onSessionId: (sid: string) => void;
  leaseId: string;
  claimToken: string;
  agentRunId: string;
  runtimeId: string;
  observer: { writeParsed: (s: string) => void; writeRawStdout: (s: string) => void };
  pendingForwards: Promise<unknown>[];
  coalescer: MessageCoalescer;
}

function makeEnv(coalescer: MessageCoalescer): TestEnv {
  return {
    outputParts: [],
    onSessionId: () => {},
    leaseId: 'lease-1',
    claimToken: 'token-1',
    agentRunId: 'run-1',
    runtimeId: 'rt-1',
    observer: { writeParsed: () => {}, writeRawStdout: () => {} },
    pendingForwards: [],
    coalescer,
  };
}

/** 每次 parse 吐一批事件的假 adapter（逐行喂 handleLine）。 */
function adapterReturning(batches: AgentEvent[][]): ProtocolAdapter {
  let i = 0;
  return { parse: () => batches[i++] ?? null } as unknown as ProtocolAdapter;
}

const fakeChild = { stdin: null } as unknown as ChildProcess;

/** 真实 eventToSubmitMessages 委托的 fake runner（可选捕获透传的 coalescer）。 */
function makeRunner(
  submits: Record<string, unknown>[][],
  received?: { coalescer?: unknown },
): TaskRunnerCore {
  return {
    client: {
      submitMessages: async (
        _l: string,
        _t: string,
        _r: string,
        messages: Record<string, unknown>[],
      ) => {
        submits.push(messages);
      },
    },
    resilience: null,
    _eventToMessages: (ev: AgentEvent, coalescer?: MessageCoalescer) => {
      if (received) received.coalescer = coalescer;
      return eventToSubmitMessages(ev, coalescer);
    },
    _handleApprovalDecision: async () => {},
    _killChild: () => {},
  } as unknown as TaskRunnerCore;
}

describe('spawn-stream coalescer 接线（FR-01）', () => {
  it('handleLine 把 env.coalescer 透传给 _eventToMessages（接线断言）', async () => {
    const received: { coalescer?: unknown } = {};
    const runner = makeRunner([], received);
    const env = makeEnv(new MessageCoalescer());
    await handleLine(
      runner,
      '{"i":0}',
      adapterReturning([[delta('m1', 'A')]]),
      fakeChild,
      env as Parameters<typeof handleLine>[4],
    );
    expect(received.coalescer).toBe(env.coalescer);
  });

  it('同 id 多条 delta 仅在完结行到达时产出合并行 + 完结行（不再逐条直发）', async () => {
    const submits: Record<string, unknown>[][] = [];
    const runner = makeRunner(submits);
    const env = makeEnv(new MessageCoalescer());
    const adapter = adapterReturning([
      [delta('m1', '你')],
      [delta('m1', '好，')],
      [delta('m1', '世界')],
      [complete('m1', '你好，世界')],
    ]);
    for (let i = 0; i < 4; i++) {
      await handleLine(
        runner,
        `{"i":${i}}`,
        adapter,
        fakeChild,
        env as Parameters<typeof handleLine>[4],
      );
    }
    // 前三条 delta 全入缓冲零提交；完结行批次 = 同 id 保底冲刷行（合并文本）
    // + 完结行本体（[ASSISTANT] 前缀渲染），共一批两行。
    expect(submits).toHaveLength(1);
    const batch = submits[0]!;
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({
      event_type: 'text',
      content: '你好，世界',
      channel: 'stdout',
    });
    expect(String(batch[1]!['content'])).toContain('你好，世界');
    // 完结批次走 pendingForwards fire-and-forget 通道。
    await Promise.allSettled(env.pendingForwards);
  });

  it('attempt 收尾冲刷：残留缓冲 → 带时间戳单行 → forwardSubmitMessages 转发', async () => {
    // ① 残留缓冲经 coalescerFlushAllMessages 产出带消息级 timestamp 的单行，缓冲清空。
    const c = new MessageCoalescer();
    c.feed(delta('m9', 'TAIL'));
    const flushed = coalescerFlushAllMessages(c);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({
      event_type: 'text',
      content: 'TAIL',
      channel: 'stdout',
    });
    expect(typeof flushed[0]!['timestamp']).toBe('string');
    expect(c.size).toBe(0);

    // ② forwardSubmitMessages 经 client 转发（fire-and-forget promise 入队）。
    const submits: Record<string, unknown>[][] = [];
    const runner = makeRunner(submits);
    const pendingForwards: Promise<unknown>[] = [];
    forwardSubmitMessages(
      runner,
      { leaseId: 'l', claimToken: 't', agentRunId: 'r', pendingForwards },
      flushed,
    );
    expect(pendingForwards).toHaveLength(1);
    await Promise.allSettled(pendingForwards);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toEqual(flushed);

    // ③ 守卫：claimToken 为空不转发（与 handleLine 既有 ql-004 口径一致）。
    const pending2: Promise<unknown>[] = [];
    forwardSubmitMessages(
      runner,
      { leaseId: 'l', claimToken: '', agentRunId: 'r', pendingForwards: pending2 },
      flushed,
    );
    expect(pending2).toHaveLength(0);
  });
});
