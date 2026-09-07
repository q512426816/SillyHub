/**
 * `agent-log/liveness/tailer.ts` —— daemon liveness 周期推导循环。
 *
 * task-03（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：对 watch list
 * 内每个会话日志做周期（10s）offset 差量续读（design §5.2）——新字节喂
 * format→deriver 注册表（L1），未注册/异常回落 L0 mtime 判定；轮转（size 变小
 * /文件消失）offset 重置 + 证据 `reset` 标记，消失超 15min 窗 → `ended` 并移出
 * watch（E-03 实证：上下文压缩会话中途换文件是常态非边缘）；watch ≤16
 * （lastSeenAt 旧者优先淘汰）+ 单轮 4MB 字节预算双上限。
 *
 * 铁律 R-02（fail-open）：任何单路径异常（读失败/deriver 抛错）只降级该路径
 * 本轮 `unknown`，不影响其他路径、不影响下一轮重试，也绝不波及登记链路与
 * host-fs-handler（本模块不 import 它）。fs 原语与时钟全注入（constraints：
 * 测试零真实等待、tick 手动驱动）。
 *
 * @module agent-log/liveness/tailer
 */

import { getDeriver } from './registry.js';
import type { LivenessState } from './types.js';

/** L0 兜底窗口（design §5.1）：≤quietMs → working；~endedMs → idle；超 → ended。 */
const QUIET_MS = 120_000;
const ENDED_MS = 15 * 60 * 1000;
/** 并发上限（design §5.2）：watch 数默认 16、单轮读取字节预算 4MB。 */
const MAX_WATCH = 16;
const MAX_BYTES_PER_TICK = 4 * 1024 * 1024;
/** 差量缓冲上限：deriver 只看尾部事件，超限裁掉头部。 */
const TAIL_BUFFER_MAX = 64 * 1024;

/** 文件系统原语（注入；默认实现走 node:fs/promises，测试零 mock 文件）。 */
export interface TailerFs {
  /** @returns 文件信息；不存在返回 null。 */
  statSize(path: string): { size: number; mtimeMs: number } | null;
  /** 读 [start, end) 字节区间的 UTF-8 文本（差量续读）。 */
  readRange(path: string, start: number, end: number): string;
}

/** 一个被 watch 的会话日志目标（发现通道由 discovery/task-06 注入）。 */
export interface WatchTarget {
  logPath: string;
  /** 与 platform_agent_logs.format 落库串逐字一致。 */
  format: string;
  workspace: string;
  harness?: string;
  agentSessionId?: string | null;
  source?: 'spawn-record' | 'sessions-json' | 'rescan' | 'registry-sync';
}

/** 单周期单路径的推导产出（上报 /api/agent-logs/states 的载荷来源）。 */
export interface TickResult {
  logPath: string;
  workspace: string;
  state: LivenessState;
  evidence: string;
  derivedAt: number;
  /** 最后日志事件时间（无文件/无数据为 null；近似取文件 mtime）。 */
  lastEventAt: number | null;
}

export interface LivenessTailerOptions {
  intervalMs?: number;
  quietMs?: number;
  endedMs?: number;
  maxWatch?: number;
  maxBytesPerTick?: number;
  fs?: TailerFs;
  now?: () => number;
  /** 每条推导结果的回调（task-06 上报接线消费；回调抛错按 R-02 吞掉）。 */
  onResult?: (r: TickResult) => void;
}

async function statSizeDefault(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  const { stat } = await import('node:fs/promises');
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** 默认 fs 实现（同步签名包装异步原语：tick 内 await 预取，见 _statCache）。 */
class DefaultFs implements TailerFs {
  private cache = new Map<string, { size: number; mtimeMs: number } | null>();

  async prefetch(path: string): Promise<void> {
    this.cache.set(path, await statSizeDefault(path));
  }

  statSize(path: string): { size: number; mtimeMs: number } | null {
    if (!this.cache.has(path)) throw new Error(`stat not prefetched: ${path}`);
    return this.cache.get(path) ?? null;
  }

  private contentCache: { path: string; buf: Buffer } | null = null;

  readRange(path: string, start: number, end: number): string {
    throw new Error('DefaultFs.readRange 需经 tailer 异步路径调用');
  }

  async readRangeAsync(path: string, start: number, end: number): Promise<string> {
    const { open } = await import('node:fs/promises');
    const fh = await open(path, 'r');
    try {
      const len = end - start;
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, start);
      void this.contentCache;
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  }
}

/** watch 条目运行态：目标 + offset 游标 + 尾部差量缓冲 + 消失计时。 */
interface WatchEntry {
  target: WatchTarget;
  offset: number;
  /** 尾部差量缓冲（≤64KB，裁头留尾），供无新字节轮次复判新鲜度。 */
  tail: string;
  lastSeenAt: number;
  missingSince: number | null;
  evicted: boolean;
}

/**
 * liveness tailer（周期 10s，可注入 interval/timer；tick 可手动驱动）。
 *
 * 设计要点（design §5.2）：watch 来源由 discovery/task-06 注入（本模块不管发现）；
 * ended 行移出 watch 但调用方负责落库行保留；`evicted` 条目本轮产出一条
 * unknown 收尾即弃（不再跟踪）。
 */
export class LivenessTailer {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly fs: TailerFs | DefaultFs;
  private readonly defaultFs: DefaultFs | null;
  private readonly now: () => number;
  private readonly opts: Required<Pick<LivenessTailerOptions, 'intervalMs' | 'quietMs' | 'endedMs' | 'maxWatch' | 'maxBytesPerTick'>>;
  onResult?: (r: TickResult) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: LivenessTailerOptions = {}) {
    this.opts = {
      intervalMs: opts.intervalMs ?? 10_000,
      quietMs: opts.quietMs ?? QUIET_MS,
      endedMs: opts.endedMs ?? ENDED_MS,
      maxWatch: opts.maxWatch ?? MAX_WATCH,
      maxBytesPerTick: opts.maxBytesPerTick ?? MAX_BYTES_PER_TICK,
    };
    this.now = opts.now ?? Date.now;
    this.onResult = opts.onResult;
    const injected = opts.fs;
    this.defaultFs = injected ? null : new DefaultFs();
    this.fs = injected ?? this.defaultFs!;
  }

  /** 加入 watch；超上限淘汰 lastSeenAt 最旧条目（新者优先，design §5.2）。 */
  add(target: WatchTarget): boolean {
    if (this.entries.has(target.logPath)) return true;
    if (this.entries.size >= this.opts.maxWatch) {
      let oldest: WatchEntry | null = null;
      for (const e of this.entries.values()) {
        if (!oldest || e.lastSeenAt < oldest.lastSeenAt) oldest = e;
      }
      if (oldest) {
        oldest.evicted = true;
        this.entries.delete(oldest.target.logPath);
      }
    }
    this.entries.set(target.logPath, {
      target,
      offset: 0,
      tail: '',
      lastSeenAt: this.now(),
      missingSince: null,
      evicted: false,
    });
    return true;
  }

  remove(logPath: string): void {
    this.entries.delete(logPath);
  }

  watchCount(): number {
    return this.entries.size;
  }

  /** 周期启动（独立定时器；tick 内异常全部吞掉，绝不冒泡影响宿主进程）。 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tickAsync().catch(() => undefined);
    }, this.opts.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 单轮推导（同步接口，注入 fs 用）；生产异步路径走 tickAsync。 */
  tick(): TickResult[] {
    const now = this.now();
    const results: TickResult[] = [];
    const budget = { left: this.opts.maxBytesPerTick };
    for (const [logPath, entry] of [...this.entries]) {
      const out = this.deriveOne(entry, now, budget);
      results.push(out);
      if (out.state === 'ended') {
        this.entries.delete(logPath);
      } else {
        entry.lastSeenAt = now;
      }
      try {
        this.onResult?.(out);
      } catch {
        /* R-02：回调异常不影响循环 */
      }
    }
    return results;
  }

  /** 异步单轮（默认 fs 场景：预取 stat 后走同步推导）。 */
  async tickAsync(): Promise<TickResult[]> {
    if (this.defaultFs) {
      for (const logPath of this.entries.keys()) {
        await this.defaultFs.prefetch(logPath);
      }
      this.readRangeFn = (p, s, e) => this.defaultFs!.readRangeAsync(p, s, e);
    }
    return this.tick();
  }

  private readRangeFn: ((p: string, s: number, e: number) => string | Promise<string>) | null = null;

  /** 单路径一轮推导（R-02 fail-open：任何异常 → unknown）。 */
  private deriveOne(entry: WatchEntry, now: number, budget: { left: number }): TickResult {
    const t = entry.target;
    const base: TickResult = { logPath: t.logPath, workspace: t.workspace, state: 'unknown', evidence: '', derivedAt: now, lastEventAt: null };
    try {
      const st = this.fs.statSize(t.logPath);
      if (st === null) {
        if (entry.missingSince === null) entry.missingSince = now;
        if (now - entry.missingSince > this.opts.endedMs) {
          return { ...base, state: 'ended', evidence: 'file_gone>15m' };
        }
        entry.offset = 0;
        entry.tail = '';
        return { ...base, state: 'unknown', evidence: 'file_missing(reset)' };
      }
      entry.missingSince = null;
      let resetMark = false;
      if (st.size < entry.offset) {
        // 轮转/截断（E-03：上下文压缩换文件）→ 重置全量重读
        entry.offset = 0;
        entry.tail = '';
        resetMark = true;
      }
      const cap = Math.min(st.size, entry.offset + Math.max(0, budget.left));
      if (cap > entry.offset) {
        const chunk = this.readRangeSync(t.logPath, entry.offset, cap);
        budget.left -= cap - entry.offset;
        entry.offset = cap;
        entry.tail = (entry.tail + chunk).slice(-TAIL_BUFFER_MAX);
      }
      const deriver = getDeriver(t.format);
      if (deriver) {
        const out = deriver({ tail: entry.tail, prev: { state: 'unknown', offset: entry.offset }, now });
        return { ...base, state: out.state, evidence: out.evidence + (resetMark ? '|reset' : ''), lastEventAt: st.mtimeMs };
      }
      // L0 mtime 兜底（design §5.1）
      const age = now - st.mtimeMs;
      if (age <= this.opts.quietMs) {
        return { ...base, state: 'working', evidence: 'mtime_fresh' + (resetMark ? '|reset' : ''), lastEventAt: st.mtimeMs };
      }
      if (age <= this.opts.endedMs) {
        return { ...base, state: 'idle', evidence: 'mtime_idle' + (resetMark ? '|reset' : ''), lastEventAt: st.mtimeMs };
      }
      return { ...base, state: 'ended', evidence: 'mtime_ended', lastEventAt: st.mtimeMs };
    } catch (err) {
      return { ...base, state: 'unknown', evidence: `fail_open:${(err as Error).message.slice(0, 80)}` };
    }
  }

  /** 读区间（注入 fs 同步读；默认 fs 异步路径在 tickAsync 前置后可用同步缓存）。 */
  private readRangeSync(path: string, start: number, end: number): string {
    if (this.readRangeFn) {
      const r = this.readRangeFn(path, start, end);
      if (typeof r === 'string') return r;
      throw new Error('async fs in sync tick（生产应走 tickAsync）');
    }
    return this.fs.readRange(path, start, end);
  }
}
