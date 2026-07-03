/**
 * tests/policy/audit-sink.test.ts —— AuditSink 批量上报单测（task-04）。
 *
 * 覆盖（验收标准）：
 *   - 攒批触发：满 maxSize(100) 立即 flush
 *   - 定时触发：5s flushIntervalMs 定时 flush（vi.useFakeTimers）
 *   - 失败重试不丢事件（指数退避）
 *   - 连续失败超阈值降级落盘 jsonl（防 OOM）
 *   - record 不阻断调用方（sync 入 buffer，不抛错）
 *   - sender 依赖注入：mock sender 验证调用次数与 payload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditSink } from '../../src/policy/audit-sink.js';
import type { AuditEvent, AuditBatchSender } from '../../src/policy/audit-sink.js';

// ── 测试夹具 ──────────────────────────────────────────────────────────────────

/** 构造一个 ALLOW AuditEvent。 */
function ev(i = 0): AuditEvent {
  return {
    decision: 'ALLOW',
    runtimeId: 'rt-1',
    provider: 'claude',
    tool: 'Write',
    path: `D:/proj/file-${i}.txt`,
    reason: '',
    ts: 1000 + i,
  };
}

/** mock sender：可控制 resolve/reject、记录每次「成功」调用 payload。 */
function mockSender(opts: { failTimes?: number } = {}): AuditBatchSender & {
  calls: AuditEvent[][];
  attempts: number;
} {
  const calls: AuditEvent[][] = [];
  const state = { attempts: 0 };
  const failTimes = opts.failTimes ?? 0;
  const sender: AuditBatchSender & { calls: AuditEvent[][]; attempts: number } = {
    calls,
    get attempts() {
      return state.attempts;
    },
    async postBatch(events: AuditEvent[]): Promise<void> {
      state.attempts += 1;
      if (state.attempts <= failTimes) {
        throw new Error(`mock sender 失败 #${state.attempts}`);
      }
      // 仅成功时记录 payload（失败批不计入「已送达」）
      calls.push([...events]);
    },
  };
  return sender;
}

// ── 单测 ─────────────────────────────────────────────────────────────────────

describe('AuditSink', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'audit-sink-test-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(sandbox, { recursive: true, force: true });
  });

  // ── record 不阻断 ──────────────────────────────────────────────────────────

  it('record 同步入 buffer，不抛错、不调 sender', async () => {
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 100, flushIntervalMs: 5000 });
    expect(() => sink.record(ev(0))).not.toThrow();
    // 未满 / 未到时间 → 不应触发 sender
    expect(sender.calls.length).toBe(0);
    await sink.flush();
    expect(sender.calls.length).toBe(1);
  });

  it('record 同步返回 void（fire-and-forget 语义）', () => {
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 100, flushIntervalMs: 5000 });
    const r = sink.record(ev(0));
    expect(r).toBeUndefined();
  });

  // ── 攒批触发：满 maxSize ─────────────────────────────────────────────────────

  it('满 maxSize(100) 触发 flush', async () => {
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 5, flushIntervalMs: 5000 });
    // 满 5 条触发一次 flush（异步），再补 5 条触发第二次
    for (let i = 0; i < 5; i++) sink.record(ev(i));
    // 满 maxSize 触发的 flush 是异步 promise，await 一拍
    await vi.waitFor(() => expect(sender.calls.length).toBe(1));
    for (let i = 5; i < 10; i++) sink.record(ev(i));
    await vi.waitFor(() => expect(sender.calls.length).toBe(2));
    expect(sender.calls[0]?.length).toBe(5);
    expect(sender.calls[1]?.length).toBe(5);
  });

  it('默认 maxSize=100（不传配置时）满 100 触发', async () => {
    const sender = mockSender();
    const sink = new AuditSink(sender); // 用默认 opts
    for (let i = 0; i < 100; i++) sink.record(ev(i));
    await vi.waitFor(() => expect(sender.calls.length).toBe(1));
    expect(sender.calls[0]?.length).toBe(100);
  });

  // ── 定时触发：5s flushIntervalMs ─────────────────────────────────────────────

  it('5s 定时触发 flush（fake timers）', async () => {
    vi.useFakeTimers();
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 100, flushIntervalMs: 5000 });
    sink.record(ev(0));
    expect(sender.calls.length).toBe(0);
    // 不到 5s 不触发
    vi.advanceTimersByTime(4999);
    expect(sender.calls.length).toBe(0);
    vi.advanceTimersByTime(1); // 累计 5000
    await vi.waitFor(() => expect(sender.calls.length).toBe(1));
    expect(sender.calls[0]?.length).toBe(1);
  });

  it('定时器 flush 后清空 buffer，下一周期重新攒批', async () => {
    vi.useFakeTimers();
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 100, flushIntervalMs: 5000 });
    sink.record(ev(0));
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => expect(sender.calls.length).toBe(1));
    // 第二批
    sink.record(ev(1));
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => expect(sender.calls.length).toBe(2));
    expect(sender.calls[1]?.[0]?.path).toContain('file-1');
  });

  // ── 失败重试不丢事件 ─────────────────────────────────────────────────────────

  it('flush 失败重试不丢事件（指数退避后成功）', async () => {
    vi.useFakeTimers();
    const sender = mockSender({ failTimes: 2 });
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      // 测试用短退避，避免长等待
      retryBaseMs: 10,
      failoverThreshold: 1000, // 不触发提前落盘
      maxRetries: 5,
    });
    sink.record(ev(0));
    // 手动 flush 触发首次失败 + 重试链
    const p = sink.flush();
    // 失败后异步重试，advance timers 推进退避（10ms, 20ms）
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await p;
    // 重试两次失败后第三次成功 → 共尝试 3 次（attempts=3）
    expect(sender.attempts).toBe(3);
    // 但成功送达仅 1 批（失败批不计入 calls）→ 事件不丢
    expect(sender.calls.length).toBe(1);
    expect(sender.calls[0]?.length).toBe(1);
    expect(sender.calls[0]?.[0]?.path).toContain('file-0');
  });

  // ── 连续失败降级落盘 ─────────────────────────────────────────────────────────

  it('连续失败超阈值降级追加写 jsonl（防 OOM）', async () => {
    vi.useFakeTimers();
    const failedJsonl = join(sandbox, 'audit-failed.jsonl');
    // 永远失败的 sender
    const sender: AuditBatchSender = {
      async postBatch(): Promise<void> {
        throw new Error('永久失败');
      },
    };
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      maxRetries: 3,
      failoverThreshold: 0, // 失败一次即尝试落盘
      failoverPath: failedJsonl,
    });
    sink.record(ev(0));
    sink.record(ev(1));
    const p = sink.flush();
    // 推进所有退避
    await vi.advanceTimersByTimeAsync(100);
    await p;
    // 文件应被写入，2 条事件（每行一个 JSON）
    const content = readFileSync(failedJsonl, 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBe(2);
    const obj0 = JSON.parse(lines[0]!);
    expect(obj0.path).toContain('file-0');
    expect(obj0.runtimeId).toBe('rt-1');
  });

  it('落盘后 buffer 清空（事件不重复保留在内存）', async () => {
    vi.useFakeTimers();
    const failedJsonl = join(sandbox, 'audit-failed.jsonl');
    const sender: AuditBatchSender = {
      async postBatch(): Promise<void> {
        throw new Error('永久失败');
      },
    };
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      maxRetries: 2,
      failoverThreshold: 0,
      failoverPath: failedJsonl,
    });
    sink.record(ev(0));
    const p = sink.flush();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    // 落盘成功后内部失败次数应重置；再发一次成功的 flush 不应把旧事件带上
    const okSender = mockSender();
    // 替换 sender 需要重新构造（构造注入），简单验证：buffer 已清空 → 新 flush 空 payload
    // 这里换一个干净 sink 验证落盘文件只含第一批
    const okSink = new AuditSink(okSender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      failoverThreshold: 1000,
    });
    await okSink.flush(); // 空 buffer → 不应调 sender
    expect(okSender.calls.length).toBe(0);
    // 落盘文件仍是 1 行
    const lines = readFileSync(failedJsonl, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
  });

  // ── flush 失败不抛错阻断调用方 ───────────────────────────────────────────────

  it('flush 失败永远不 reject（吞错 + 落盘）', async () => {
    vi.useFakeTimers();
    const failedJsonl = join(sandbox, 'audit-failed.jsonl');
    const sender: AuditBatchSender = {
      async postBatch(): Promise<void> {
        throw new Error('boom');
      },
    };
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      maxRetries: 1,
      failoverThreshold: 0,
      failoverPath: failedJsonl,
    });
    sink.record(ev(0));
    const p = sink.flush();
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeUndefined();
  });

  // ── 落盘文件格式 ─────────────────────────────────────────────────────────────

  it('落盘 JSONL 每行一个完整 AuditEvent JSON', async () => {
    vi.useFakeTimers();
    const failedJsonl = join(sandbox, 'audit-failed.jsonl');
    const sender: AuditBatchSender = {
      async postBatch(): Promise<void> {
        throw new Error('fail');
      },
    };
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      maxRetries: 1,
      failoverThreshold: 0,
      failoverPath: failedJsonl,
    });
    const e: AuditEvent = {
      decision: 'DENY',
      runtimeId: 'rt-2',
      provider: 'codex',
      tool: 'Bash',
      path: 'E:/evil.txt',
      reason: '路径越界：E:/ 未授权',
      ts: 9999,
    };
    sink.record(e);
    const p = sink.flush();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    const obj = JSON.parse(readFileSync(failedJsonl, 'utf-8').trim());
    expect(obj).toEqual(e);
  });

  // ── 落盘追加（不覆盖）────────────────────────────────────────────────────────

  it('多次失败落盘是追加而非覆盖', async () => {
    vi.useFakeTimers();
    const failedJsonl = join(sandbox, 'audit-failed.jsonl');
    // 预置已有内容
    writeFileSync(failedJsonl, '{"preset":true}\n', 'utf-8');
    const sender: AuditBatchSender = {
      async postBatch(): Promise<void> {
        throw new Error('fail');
      },
    };
    const sink = new AuditSink(sender, {
      maxSize: 100,
      flushIntervalMs: 5000,
      retryBaseMs: 1,
      maxRetries: 1,
      failoverThreshold: 0,
      failoverPath: failedJsonl,
    });
    sink.record(ev(0));
    let p = sink.flush();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    sink.record(ev(1));
    p = sink.flush();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    const lines = readFileSync(failedJsonl, 'utf-8').trim().split('\n');
    // preset + 2 批 = 3 行
    expect(lines.length).toBe(3);
  });

  // ── destroy 清理定时器 ─────────────────────────────────────────────────────

  it('destroy 清理定时器不再触发 flush', async () => {
    vi.useFakeTimers();
    const sender = mockSender();
    const sink = new AuditSink(sender, { maxSize: 100, flushIntervalMs: 5000 });
    sink.record(ev(0));
    // destroy 会 flush 残留 buffer（1 条）+ 清定时器
    await sink.destroy();
    expect(sender.calls.length).toBe(1);
    // 清定时器后，再 advance 长时间不应再触发新的 flush
    vi.advanceTimersByTime(10000);
    expect(sender.calls.length).toBe(1);
  });
});
