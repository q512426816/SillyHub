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
  /** R6（ql-20260908-006）：产出该日志的会话 cwd——daemon 侧按它归属推送 root/workspace
   *（harness 日志都在用户 home 下、claude 项目目录名还经 munge 抹掉分隔符，
   * logPath.contains(root) 恒 miss）。 */
  agentCwd?: string;
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

/** 默认 fs 实现（同步签名包装异步原语：tickAsync 内 await 预取 stat + 预读字节，
 * 见 _statCache / _rangeCache——同步 tick 内 readRangeFn 从缓存命中）。 */
class DefaultFs implements TailerFs {
  private cache = new Map<string, { size: number; mtimeMs: number } | null>();
  /** R1（ql-20260908-006）：tickAsync 预读的本轮新字节（path → 区间文本）。 */
  private rangeCache = new Map<string, string>();

  async prefetch(path: string): Promise<void> {
    this.cache.set(path, await statSizeDefault(path));
  }

  statSize(path: string): { size: number; mtimeMs: number } | null {
    if (!this.cache.has(path)) throw new Error(`stat not prefetched: ${path}`);
    return this.cache.get(path) ?? null;
  }

  /** R1：预读 [start, end) 字节进同步缓存（tickAsync 在同步推导 pass 前调用）。 */
  async prefetchRange(path: string, start: number, end: number): Promise<void> {
    this.rangeCache.set(path, await this.readRangeAsync(path, start, end));
  }

  /** R1：同步读缓存（同步 tick 内 readRangeFn 走此命中；未预读即 fail-open unknown）。 */
  readCachedRange(path: string): string {
    const c = this.rangeCache.get(path);
    if (c === undefined) throw new Error(`range not prefetched: ${path}`);
    return c;
  }

  /** R9（ql-20260908-006）：路径终结/淘汰时清理缓存（防只增不减）。 */
  forget(path: string): void {
    this.cache.delete(path);
    this.rangeCache.delete(path);
  }

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

/** ended 路径登记上限（R2）：超限丢最早一批（Set 保插入序；日志文件名按会话唯一，
 * ended 路径不会合法复活，淘汰只为防极长运行下的无界增长）。 */
const ENDED_PATHS_MAX = 4096;
const ENDED_PATHS_TRIM = 1024;

/**
 * liveness tailer（周期 10s，可注入 interval/timer；tick 可手动驱动）。
 *
 * 设计要点（design §5.2）：watch 来源由 discovery/task-06 注入（本模块不管发现）；
 * ended 行移出 watch 但调用方负责落库行保留；`evicted` 条目本轮产出一条
 * unknown 收尾即弃（不再跟踪）。
 */
export class LivenessTailer {
  private readonly entries = new Map<string, WatchEntry>();
  /** R2（ql-20260908-006）：已 ended 的 logPath——registry-sync 每 60s 无条件重加
   * 会让死文件在「15min unknown → ended → 60s 后重加」间永久震荡，且挤占 16 个
   * watch 槽位挤出活会话；ended 登记后在 add() 拦截。 */
  private readonly endedPaths = new Set<string>();
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

  /** 加入 watch；超上限淘汰 lastSeenAt 最旧条目（新者优先，design §5.2）。
   * R2：已 ended 的路径直接拒绝（防 registry-sync 重加震荡）。 */
  add(target: WatchTarget): boolean {
    if (this.endedPaths.has(target.logPath)) return false;
    if (this.entries.has(target.logPath)) return true;
    if (this.entries.size >= this.opts.maxWatch) {
      let oldest: WatchEntry | null = null;
      for (const e of this.entries.values()) {
        if (!oldest || e.lastSeenAt < oldest.lastSeenAt) oldest = e;
      }
      if (oldest) {
        oldest.evicted = true;
        this.entries.delete(oldest.target.logPath);
        this.defaultFs?.forget(oldest.target.logPath); // R9：淘汰即清缓存
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
    this.defaultFs?.forget(logPath); // R9：显式移除即清缓存
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
    return this.runPass([...this.entries.keys()]);
  }

  /** 异步单轮（默认 fs 场景）：预取 stat + 预读本轮新字节进同步缓存，再同步推导。 */
  async tickAsync(): Promise<TickResult[]> {
    if (!this.defaultFs) return this.tick();
    // 快照驱动本轮 pass：refresh 协程在预读 await 间隙 add() 的新目标不顺带产出
    //（下轮自然覆盖），避免「stat not prefetched」假 unknown 闪断。
    const paths = [...this.entries.keys()];
    for (const p of paths) {
      await this.defaultFs.prefetch(p);
    }
    // R1（ql-20260908-006）修复核心：deriveOne 的待读区间在此全部 await 预读进
    // rangeCache，随后同步 pass 内 readRangeFn 缓存命中——旧实现把异步 readRangeAsync
    // 塞进 readRangeFn 后直接走同步 tick，readRangeSync 恒抛「async fs in sync tick」，
    // 且 offset 不前进，生产路径任何非空日志永久 unknown。预算/轮转口径与 deriveOne
    // 逐字对齐（同 paths 序、同 stat 缓存值），保证两遍算出的区间一致。
    const budget = { left: this.opts.maxBytesPerTick };
    for (const p of paths) {
      const entry = this.entries.get(p);
      if (!entry) continue;
      const st = this.defaultFs.statSize(p);
      if (st === null) continue; // 文件缺失 → deriveOne 走 file_missing 分支（无读）
      const effective = st.size < entry.offset ? 0 : entry.offset; // 轮转 reset 同口径
      const cap = Math.min(st.size, effective + Math.max(0, budget.left));
      if (cap > effective) {
        try {
          await this.defaultFs.prefetchRange(p, effective, cap);
          budget.left -= cap - effective;
        } catch {
          // 预读失败（读取间隙被删等）→ 不缓存，deriveOne fail_open unknown（R-02）
        }
      }
    }
    this.readRangeFn = (p2) => this.defaultFs!.readCachedRange(p2);
    return this.runPass(paths);
  }

  /** 同步 readRange 源（注入 fs 直读；默认 fs 场景 = tickAsync 预读缓存）。 */
  private readRangeFn: ((p: string, s: number, e: number) => string) | null = null;

  /** 单轮推导（tick / tickAsync 共用；paths 为本轮参与的 logPath 快照）。 */
  private runPass(paths: string[]): TickResult[] {
    const now = this.now();
    const results: TickResult[] = [];
    const budget = { left: this.opts.maxBytesPerTick };
    for (const logPath of paths) {
      const entry = this.entries.get(logPath);
      if (!entry) continue;
      const out = this.deriveOne(entry, now, budget);
      results.push(out);
      if (out.state === 'ended') {
        this.entries.delete(logPath);
        this.rememberEnded(logPath); // R2：登记防重加
        this.defaultFs?.forget(logPath); // R9：终结即清缓存
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

  /** R2：登记 ended 路径（超限丢最早一批，防无界）。 */
  private rememberEnded(logPath: string): void {
    this.endedPaths.add(logPath);
    if (this.endedPaths.size > ENDED_PATHS_MAX) {
      const it = this.endedPaths.values();
      for (let i = 0; i < ENDED_PATHS_TRIM; i++) {
        const n = it.next();
        if (n.done) break;
        this.endedPaths.delete(n.value);
      }
    }
  }

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

  /** 读区间（注入 fs 直读；默认 fs 场景命中 tickAsync 预读缓存）。 */
  private readRangeSync(path: string, start: number, end: number): string {
    if (this.readRangeFn) return this.readRangeFn(path, start, end);
    return this.fs.readRange(path, start, end);
  }
}
