// tests/control-dispatcher.test.ts
// 2026-08-29-daemon-platform-resilience task-06 / design A2 消费端：
// 控制指令统一消费入口——kind 路由 / LRU command_id 去重 / ack 收集与重试。
// 覆盖任务卡验收：
//   - 六类 kind 各路由到对应 handler（payload 原样透传）；
//   - 补拉消息与 WS 推送同 command_id 只执行一次（LRU 去重用例）；
//   - 处理成功与业务失败（handler 抛错 / 未知 kind）均发 ack；
//   - ack 网络失败不删队列留待下轮；getPendingControls 网络错上抛由调用方降级；
//   - LRU 容量淘汰（滑动窗语义，同 backend ws_hub 128 先例）。
// ql-20260904-022 追加：WS 送达指令 immediateAck 立即冲刷——防 delivered 指令
// 无冲刷触发点（心跳 pending_controls 只统计 pending 行）被 backend GC 按
// delivered-未-ack 误杀等用户回答的活轮（事故会话 e148364e）。

import { describe, it, expect, vi } from 'vitest';
import {
  ControlDispatcher,
  CONTROL_DEDUP_LRU_CAPACITY,
  type ControlCommandSource,
  type ControlDispatcherLogger,
} from '../src/control-dispatcher.js';
import { CONTROL_KIND } from '../src/protocol.js';
import type { PendingControlCommand } from '../src/protocol.js';

/** 构造一条补拉指令（形状对齐 GET pending-controls 响应条目）。 */
function cmd(
  id: string,
  kind = CONTROL_KIND.SESSION_INJECT,
  payload: Record<string, unknown> = { session_id: 's1' },
): PendingControlCommand {
  return { id, kind, payload, created_at: '2026-08-29T00:00:00Z' };
}

/** mock HTTP 源：可编程的补拉队列 + ack 调用记录（ackImpl.fn 可运行时替换）。 */
function makeSource(commands: PendingControlCommand[] = []): ControlCommandSource & {
  ackCalls: { runtimeId: string; ids: string[] }[];
  ackImpl: { fn: (runtimeId: string, ids: string[]) => Promise<unknown> };
  queue: PendingControlCommand[];
} {
  const ackCalls: { runtimeId: string; ids: string[] }[] = [];
  // 可变引用持有 ack 实现——测试替换 source.ackImpl.fn 即生效（默认成功回
  // {acked: n}，对齐 backend acked=实际翻转数语义）。
  const ackImpl: { fn: (runtimeId: string, ids: string[]) => Promise<unknown> } = {
    fn: async (_rid, ids) => ({ acked: ids.length }),
  };
  const queue = commands;
  const source: ControlCommandSource & {
    ackCalls: typeof ackCalls;
    ackImpl: typeof ackImpl;
    queue: typeof queue;
  } = {
    queue,
    ackCalls,
    ackImpl,
    getPendingControls: async () => {
      // 模拟「补拉只返回 pending」：queue 内容即本趟可见指令（不模拟 ack 后
      // backend 状态翻转——那是 backend 侧语义，daemon 测试只关心调用序列）。
      return [...queue];
    },
    ackControls: async (rid: string, ids: string[]) => {
      ackCalls.push({ runtimeId: rid, ids: [...ids] });
      return ackImpl.fn(rid, ids);
    },
  };
  return source;
}

const silentLogger: ControlDispatcherLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('ControlDispatcher — kind 路由（统一消费入口）', () => {
  it('六类 kind 各路由到对应 handler，payload 原样透传', async () => {
    const handlers = {
      [CONTROL_KIND.SESSION_INJECT]: vi.fn(async () => undefined),
      [CONTROL_KIND.SESSION_INTERRUPT]: vi.fn(async () => undefined),
      [CONTROL_KIND.SESSION_END]: vi.fn(async () => undefined),
      [CONTROL_KIND.SESSION_RESUME]: vi.fn(async () => undefined),
      [CONTROL_KIND.PERMISSION_RESPONSE]: vi.fn(async () => undefined),
      [CONTROL_KIND.PROVIDER_CONFIG_CHANGED]: vi.fn(async () => undefined),
    };
    const d = new ControlDispatcher({ handlers });
    const cases: [string, Record<string, unknown>][] = [
      [CONTROL_KIND.SESSION_INJECT, { session_id: 's1', prompt: 'hi' }],
      [CONTROL_KIND.SESSION_INTERRUPT, { session_id: 's1' }],
      [CONTROL_KIND.SESSION_END, { session_id: 's1' }],
      [CONTROL_KIND.SESSION_RESUME, { session_id: 's1', agent_session_id: 'a1' }],
      [CONTROL_KIND.PERMISSION_RESPONSE, { request_id: 'q1', decision: 'allow' }],
      [CONTROL_KIND.PROVIDER_CONFIG_CHANGED, { session_id: 's1', provider_config: null }],
    ];
    for (const [kind, payload] of cases) {
      const outcome = await d.consume(kind, payload);
      expect(outcome).toBe('handled');
    }
    for (const [kind, fn] of Object.entries(handlers)) {
      expect(fn, `handler ${kind} called once`).toHaveBeenCalledTimes(1);
    }
    expect(handlers[CONTROL_KIND.SESSION_INJECT]!).toHaveBeenCalledWith({
      session_id: 's1',
      prompt: 'hi',
    });
    expect(handlers[CONTROL_KIND.PROVIDER_CONFIG_CHANGED]!).toHaveBeenCalledWith({
      session_id: 's1',
      provider_config: null,
    });
  });

  it('无 command_id（旧 backend WS 消息）→ 跳过去重直接路由，行为同改造前', async () => {
    const handler = vi.fn(async () => undefined);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
    });
    const payload = { session_id: 's1' };
    // 同一 payload 两次消费（无 id 无法去重——与改造前 WS 直连路由语义一致）。
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, payload)).toBe('handled');
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, payload)).toBe('handled');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('未知 kind → unknown_kind，不执行任何 handler，仍收集 ack（毒丸不重投）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    const outcome = await d.consume('future_kind_xyz', { a: 1 }, {
      commandId: 'cmd-9',
      runtimeId: 'rt-1',
    });
    expect(outcome).toBe('unknown_kind');
    expect(handler).not.toHaveBeenCalled();
    // 未知 kind = 业务失败 → ack 已排队；手动拉一趟空补拉触发 flush。
    await d.pullAndConsume('rt-1');
    expect(source.ackCalls.length).toBe(1);
    expect(source.ackCalls[0]!.ids).toContain('cmd-9');
  });
});

describe('ControlDispatcher — LRU command_id 去重（WS + 补拉双通道）', () => {
  it('核心验收：补拉与 WS 推送同 command_id 只执行一次（先 WS 后补拉）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    // WS 通道先到（payload 尾部 command_id，runtime_id 缺省）。
    const wsOutcome = await d.consume(
      CONTROL_KIND.SESSION_INJECT,
      { session_id: 's1', command_id: 'cmd-1' },
      { commandId: 'cmd-1' },
    );
    expect(wsOutcome).toBe('handled');
    // 补拉通道同条到达（backend 尚未 ack 仍 pending）。
    source.queue.push(cmd('cmd-1'));
    const summary = await d.pullAndConsume('rt-1');
    expect(summary.pulled).toBe(1);
    expect(summary.consumed).toBe(0); // duplicate 不计执行
    expect(handler).toHaveBeenCalledTimes(1); // 只执行一次（核心）
    // duplicate 仍回执（ack 收敛：backend 端该行仍 pending，需 ack 消化）。
    expect(source.ackCalls.length).toBe(1);
    expect(source.ackCalls[0]!.ids).toContain('cmd-1');
  });

  it('反向竞态：补拉在途时 WS 推送同条到达 → 只执行一次（先补拉后 WS）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource([cmd('cmd-2', CONTROL_KIND.SESSION_INTERRUPT)]);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INTERRUPT]: handler },
      source,
      logger: silentLogger,
    });
    // 补拉先标记去重窗。
    await d.pullAndConsume('rt-1');
    expect(handler).toHaveBeenCalledTimes(1);
    // WS 同条推送（payload 携带 command_id）。
    const outcome = await d.consume(
      CONTROL_KIND.SESSION_INTERRUPT,
      { session_id: 's1', command_id: 'cmd-2' },
      { commandId: 'cmd-2' },
    );
    expect(outcome).toBe('duplicate');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('不同 command_id 不互相去重', async () => {
    const handler = vi.fn(async () => undefined);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
    });
    await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'a' });
    await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'b' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('LRU 滑动窗淘汰：容量 2，最旧 id 被挤出后可重新执行（同 ws_hub deque 先例）', async () => {
    const handler = vi.fn(async () => undefined);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      lruCapacity: 2,
    });
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'id-1' })).toBe('handled');
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'id-2' })).toBe('handled');
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'id-3' })).toBe('handled');
    // 窗 = 最近 2 条 {id-2, id-3}（id-1 被挤出，deque(maxlen) 语义）。
    // 窗内 id-2 仍判重。
    expect(
      await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'id-2' }),
    ).toBe('duplicate');
    // 出窗的 id-1 不再判重 → 重新执行（窗口容量有限是设计取舍：超出 256 条的
    // 远古重放由 backend pending-only 补拉语义兜底，不重发 delivered）。
    expect(await d.consume(CONTROL_KIND.SESSION_INJECT, {}, { commandId: 'id-1' })).toBe('handled');
    expect(handler).toHaveBeenCalledTimes(4); // id-1 执行了两次（第二次是出窗后）
  });

  it('默认去重窗容量 256（design A2）', () => {
    expect(CONTROL_DEDUP_LRU_CAPACITY).toBe(256);
  });
});

describe('ControlDispatcher — ack 语义（成功/业务失败均回执）', () => {
  it('handler 抛错（业务失败）→ handler_error + ack 仍发（毒丸指令不无限重投）', async () => {
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: {
        [CONTROL_KIND.SESSION_END]: async () => {
          throw new Error('session not found');
        },
      },
      source,
      logger: silentLogger,
    });
    const outcome = await d.consume(CONTROL_KIND.SESSION_END, { session_id: 's1' }, {
      commandId: 'cmd-e1',
      runtimeId: 'rt-1',
    });
    expect(outcome).toBe('handler_error');
    await d.pullAndConsume('rt-1'); // 触发 flush
    expect(source.ackCalls.length).toBe(1);
    expect(source.ackCalls[0]!.ids).toContain('cmd-e1');
  });

  it('pullAndConsume：逐条消费成功后批量 ack（ids 齐全，runtimeId 正确）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource([cmd('c1'), cmd('c2', CONTROL_KIND.SESSION_INTERRUPT)]);
    const d = new ControlDispatcher({
      handlers: {
        [CONTROL_KIND.SESSION_INJECT]: handler,
        [CONTROL_KIND.SESSION_INTERRUPT]: handler,
      },
      source,
      logger: silentLogger,
    });
    const summary = await d.pullAndConsume('rt-9');
    expect(summary).toEqual({ pulled: 2, consumed: 2, acked: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(source.ackCalls.length).toBe(1);
    expect(source.ackCalls[0]!.runtimeId).toBe('rt-9');
    expect(source.ackCalls[0]!.ids.sort()).toEqual(['c1', 'c2']);
  });

  it('ack POST 网络失败 → ids 留队不下账，下一趟补拉重试成功', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource([cmd('k1')]);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    let failAck = true;
    source.ackImpl.fn = async () => {
      if (failAck) throw new Error('ack network down');
      return { acked: 1 };
    };
    const first = await d.pullAndConsume('rt-1');
    expect(first.acked).toBe(0); // 失败趟不发
    expect(d.pendingAckCount).toBe(1); // k1 仍在待回执队列
    // 网络恢复：backend 侧 k1 仍 pending（ack 未达）→ 补拉同条 → duplicate 跳过
    // 执行 + 重新排队回执，本趟 ack 成功出队。
    failAck = false;
    const second = await d.pullAndConsume('rt-1');
    expect(second.consumed).toBe(0);
    expect(second.acked).toBe(1);
    expect(d.pendingAckCount).toBe(0);
    expect(source.ackCalls.length).toBe(2);
    expect(source.ackCalls[1]!.ids).toContain('k1');
  });

  it('WS 通道（payload 无 runtime_id）消费的指令由下一趟补拉捎带回执', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.PERMISSION_RESPONSE]: handler },
      source,
      logger: silentLogger,
    });
    // WS 消费（无 runtimeId → 进未知 runtime 桶）。
    expect(
      await d.consume(CONTROL_KIND.PERMISSION_RESPONSE, { request_id: 'q1' }, {
        commandId: 'ws-1',
      }),
    ).toBe('handled');
    // 空补拉趟（无 pending 指令）也 flush 未知桶。
    const summary = await d.pullAndConsume('rt-1');
    expect(summary.pulled).toBe(0);
    expect(summary.acked).toBe(1);
    expect(source.ackCalls[0]!.ids).toEqual(['ws-1']);
    expect(d.pendingAckCount).toBe(0);
  });

  it('getPendingControls 网络错/旧 backend 404 → 上抛由调用方降级（不 ack）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    source.getPendingControls = async () => {
      throw new Error('HTTP 404');
    };
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    await expect(d.pullAndConsume('rt-1')).rejects.toThrow('HTTP 404');
    expect(handler).not.toHaveBeenCalled();
    expect(source.ackCalls.length).toBe(0);
  });

  it('未注入 source（旧 client mock）→ pullAndConsume no-op，WS 路由照常', async () => {
    const handler = vi.fn(async () => undefined);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      logger: silentLogger,
    });
    const summary = await d.pullAndConsume('rt-1');
    expect(summary).toEqual({ pulled: 0, consumed: 0, acked: 0 });
    expect(
      await d.consume(CONTROL_KIND.SESSION_INJECT, { session_id: 's1' }, {
        commandId: 'no-src-1',
      }),
    ).toBe('handled');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('payload 为 null（补拉行无 payload）→ 以空对象路由不崩', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource([
      { id: 'null-p', kind: CONTROL_KIND.SESSION_END, payload: null, created_at: 't' },
    ]);
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_END]: handler },
      source,
      logger: silentLogger,
    });
    const summary = await d.pullAndConsume('rt-1');
    expect(summary.consumed).toBe(1);
    expect(handler).toHaveBeenCalledWith({});
  });
});

describe('ControlDispatcher — WS 送达指令立即回执（ql-20260904-022）', () => {
  it('immediateAck：WS 消费成功后不等补拉即冲刷 ack（runtime_id 实值）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    // WS 消费（payload 尾部 command_id + runtime_id，同 daemon _dispatchControl
    // 提取后的调用形状）——不跑 pullAndConsume，ack 也应已发出。
    const outcome = await d.consume(
      CONTROL_KIND.SESSION_INJECT,
      { session_id: 's1', command_id: 'cmd-i1', runtime_id: 'rt-1' },
      { commandId: 'cmd-i1', runtimeId: 'rt-1', immediateAck: true },
    );
    expect(outcome).toBe('handled');
    await vi.waitFor(() => expect(source.ackCalls.length).toBe(1));
    expect(source.ackCalls[0]!.runtimeId).toBe('rt-1');
    expect(source.ackCalls[0]!.ids).toContain('cmd-i1');
    // mock 在 POST 开始时记录调用、dispatcher 在 POST 成功后才出队（一个微任务
    // 之差）——等出队收敛后再断言队列清空。
    await vi.waitFor(() => expect(d.pendingAckCount).toBe(0));
  });

  it('immediateAck 冲刷失败（网络抖动）→ ids 留桶，补拉趟兜底重发', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    source.ackImpl.fn = async () => {
      throw new Error('ack network down');
    };
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.SESSION_INJECT]: handler },
      source,
      logger: silentLogger,
    });
    await d.consume(
      CONTROL_KIND.SESSION_INJECT,
      { session_id: 's1', command_id: 'cmd-i2', runtime_id: 'rt-1' },
      { commandId: 'cmd-i2', runtimeId: 'rt-1', immediateAck: true },
    );
    // 立即冲刷已尝试且失败（调用发生）但 ids 未出队。
    await vi.waitFor(() => expect(source.ackCalls.length).toBe(1));
    expect(d.pendingAckCount).toBe(1);
    // 网络恢复：空补拉趟（无 pending 指令）冲刷留队 ack。
    source.ackImpl.fn = async (_rid, ids) => ({ acked: ids.length });
    const summary = await d.pullAndConsume('rt-1');
    expect(summary.acked).toBe(1);
    expect(d.pendingAckCount).toBe(0);
    expect(source.ackCalls[1]!.ids).toContain('cmd-i2');
  });

  it('immediateAck 但 runtimeId 缺省（UNKNOWN 桶）→ 不立即 POST，维持入队等捎带', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource();
    const d = new ControlDispatcher({
      handlers: { [CONTROL_KIND.PERMISSION_RESPONSE]: handler },
      source,
      logger: silentLogger,
    });
    await d.consume(
      CONTROL_KIND.PERMISSION_RESPONSE,
      { request_id: 'q1', command_id: 'cmd-i3' },
      { commandId: 'cmd-i3', immediateAck: true },
    );
    // 无 runtime_id 无 ack 端点可定位——立即冲刷不触发（既有未知桶语义）。
    await new Promise((r) => setTimeout(r, 10));
    expect(source.ackCalls.length).toBe(0);
    expect(d.pendingAckCount).toBe(1);
    // 下一趟任意 runtime 补拉捎带回执。
    const summary = await d.pullAndConsume('rt-1');
    expect(summary.acked).toBe(1);
  });

  it('补拉路径不传 immediateAck → 维持批尾单次 ack（批量语义不变）', async () => {
    const handler = vi.fn(async () => undefined);
    const source = makeSource([cmd('b1'), cmd('b2', CONTROL_KIND.SESSION_INTERRUPT)]);
    const d = new ControlDispatcher({
      handlers: {
        [CONTROL_KIND.SESSION_INJECT]: handler,
        [CONTROL_KIND.SESSION_INTERRUPT]: handler,
      },
      source,
      logger: silentLogger,
    });
    const summary = await d.pullAndConsume('rt-1');
    expect(summary).toEqual({ pulled: 2, consumed: 2, acked: 2 });
    // 批量语义：两条指令一次 ack POST（不是逐条立即冲刷）。
    expect(source.ackCalls.length).toBe(1);
    expect(source.ackCalls[0]!.ids.sort()).toEqual(['b1', 'b2']);
  });
});
