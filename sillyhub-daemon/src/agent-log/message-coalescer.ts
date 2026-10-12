/**
 * agent-log/message-coalescer.ts —— 流式 delta 消息级合并缓冲器（F2b）。
 *
 * 2026-10-12-session-defects task-02 / FR-03 / D-004@v1：同一助手消息的连续
 * 流式 delta（event-wire.ts 渲染轨 `metadata.streaming === true` 分支曾逐条
 * 直发——生产会话 47e2ff1a 实证同一消息拆成十几个重复/截断片段行的碎片根因）
 * 按 message id 缓冲，消息完结（非流式完整行）到达时输出单行完整内容。
 *
 * 生命周期（design R-02 防泄漏）：纯请求内缓冲——由调用方按 turn 创建实例并在
 * turn 边界丢弃（无定时器、无外部资源、无跨请求状态）；缓冲上限与 TTL 双保险：
 *   - 单缓冲字节数超 CAP_BYTES → 立即按序冲刷为独立行（宁可碎片不丢内容）；
 *   - 缓冲条目闲置超 TTL_MS（无后续 delta 也无完结）→ 下次 feed 时惰性冲刷。
 * 任何异常序列（乱序/完结缺失/TTL 边界）下不丢内容，至多退化为碎片行。
 *
 * 接入：eventToSubmitMessages(ev, coalescer?) 可选参——传入时流式 delta 走
 * 缓冲合并；不传零回归（既有直发行为，向后兼容）。
 */

/** 单缓冲条目字节数上限（超限立即冲刷，UTF-16 长度近似）。 */
export const COALESCER_CAP_BYTES = 64 * 1024;

/** 缓冲条目闲置 TTL（毫秒）：超龄条目在下次 feed 时按序冲刷。 */
export const COALESCER_TTL_MS = 30_000;

interface BufferedDelta {
  /** 首个 delta 到达时刻（TTL 判定基准）。 */
  startedAtMs: number;
  /** 最近 delta 到达时刻。 */
  lastAtMs: number;
  /** 按序累积的 delta 文本。 */
  text: string;
}

export interface CoalescedMessage {
  event_type: 'text';
  content: string;
  channel: 'stdout';
  [key: string]: unknown;
}

/** message id 提取：事件 metadata 的 message id / segment id 家族字段。 */
function messageIdOf(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '';
  for (const key of ['message_id', 'messageId', 'segmentId', 'segment_id', 'id'] as const) {
    const v = metadata[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

export class MessageCoalescer {
  private readonly buffers = new Map<string, BufferedDelta>();
  private readonly nowMs: () => number;

  constructor(nowMs: () => number = () => Date.now()) {
    this.nowMs = nowMs;
  }

  /** 当前缓冲的消息数（测试/观测用）。 */
  get size(): number {
    return this.buffers.size;
  }

  /**
   * 喂入一个 text 事件，返回「本事件应直发的行」。
   *
   * - delta（metadata.streaming=true）：并入缓冲，返回空数组（不直发）；
   * - 完整行（非 streaming）：冲刷同 id 残留缓冲与超龄条目（保底不丢内容，
   *   半截撤回由终态协议负责），冲刷行先于完整行输出；调用方随后照常渲染
   *   完整行。
   */
  feed(ev: {
    type: string;
    content: string;
    metadata?: Record<string, unknown> | undefined;
  }): CoalescedMessage[] {
    const metadata = ev.metadata;
    const isStreaming = metadata?.['streaming'] === true;
    const id = messageIdOf(metadata);
    const now = this.nowMs();

    if (!isStreaming) {
      // 完整行：同 id 缓冲即刻保底冲刷（终态协议负责撤回半截，此处防御
      // 无完结异常序列不丢内容），其余超龄条目惰性冲刷。
      const flushed: CoalescedMessage[] = [];
      for (const [key, buf] of this.buffers) {
        if (key === id || now - buf.lastAtMs > COALESCER_TTL_MS) {
          flushed.push(this.flushOne(key, buf));
        }
      }
      return flushed;
    }

    // delta：并入缓冲（无 id 的 delta 无法跨事件归并——保持直发，宁碎片不丢）。
    if (!id) {
      return [{ event_type: 'text', content: ev.content, channel: 'stdout' }];
    }
    const existing = this.buffers.get(id);
    if (existing) {
      existing.text += ev.content;
      existing.lastAtMs = now;
    } else {
      this.buffers.set(id, {
        startedAtMs: now,
        lastAtMs: now,
        text: ev.content,
      });
    }
    // 容量守卫：超限立即冲刷（宁可本消息提前成行，不丢内容）。
    const buf = this.buffers.get(id);
    if (buf && buf.text.length > COALESCER_CAP_BYTES) {
      return [this.flushOne(id, buf)];
    }
    // 其他消息的超龄惰性冲刷。
    const stale: CoalescedMessage[] = [];
    for (const [key, b] of this.buffers) {
      if (now - b.lastAtMs > COALESCER_TTL_MS) {
        stale.push(this.flushOne(key, b));
      }
    }
    return stale;
  }

  /** turn 边界清理：冲刷全部残留缓冲（调用方在 turn 收尾调用，防跨 turn 泄漏）。 */
  flushAll(): CoalescedMessage[] {
    const out: CoalescedMessage[] = [];
    for (const [key, buf] of this.buffers) {
      out.push(this.flushOne(key, buf));
    }
    return out;
  }

  private flushOne(key: string, buf: BufferedDelta): CoalescedMessage {
    this.buffers.delete(key);
    // 冲刷行与 legacy delta 行同形（裸拼接文本、stdout、无前缀）——TTL/容量
    // 冲刷是「提前成行的合并结果」，不是渲染形态切换。
    return {
      event_type: 'text',
      content: buf.text,
      channel: 'stdout',
    };
  }
}
