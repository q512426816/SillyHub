/**
 * policy/audit-sink.ts —— Audit 批量上报 + 限流 + 失败落盘（D-006/D-008）。
 *
 * Filesystem Policy Engine 的审计层。所有写类决策（canWrite/canCreate/canDelete/
 * canRename，D-008）经 PolicyEngine 产出 AuditEvent 后入此 sink，攒批回传 backend。
 *
 * 设计要点：
 *   1. 攒批：buffer 满 maxSize(默认 100) 或 flushIntervalMs(默认 5000ms) 触发 flush；
 *   2. 失败重试：POST 失败指数退避（base * 2^attempt），连续失败不丢事件；
 *   3. 降级落盘：连续失败超阈值（或重试耗尽）追加写 `~/.sillyhub/daemon/audit-failed.jsonl`
 *      防 OOM（buffer 必须能清空，否则内存持续增长）；
 *   4. POST 能力依赖倒置：构造注入 `AuditBatchSender`（最小接口 { postBatch(events) }），
 *      不硬耦合 HubClient —— task-11 装配真实 HubClient 适配器，测试注入 mock。
 *   5. flush 失败永远吞错，不阻断调用方（PolicyEngine / agent 执行）。
 *
 * @module policy/audit-sink
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// ── 类型 ──────────────────────────────────────────────────────────────────────

/** 审计事件（写类决策）。字段与 backend PolicyAuditLog 一一对应（design §7.4）。 */
export interface AuditEvent {
  /** 决策结果：ALLOW / DENY */
  decision: 'ALLOW' | 'DENY';
  /** 归属 runtime id（per-runtime 隔离，D-002） */
  runtimeId: string;
  /** agent 种类：claude / codex / ... */
  provider: string;
  /** 触发工具：Write / Edit / Bash / PowerShell / CMD / list_dir / ... */
  tool: string;
  /** 规范化后的目标路径 */
  path: string;
  /** deny 时的中文理由（allow 为空串） */
  reason: string;
  /** 毫秒时间戳（daemon 运行时可用 Date.now，调用方可传） */
  ts: number;
}

/**
 * 最小 POST 能力接口（依赖倒置）。
 *
 * task-11 装配真实实现：包装 HubClient POST /daemon/audit/batch。
 * 测试注入 mock：控制 resolve/reject 验证攒批与重试。
 */
export interface AuditBatchSender {
  /** 批量上报事件到 backend。失败时 reject。 */
  postBatch(events: AuditEvent[]): Promise<void>;
}

/** 空实现（默认值，未注入 sender 时不真正上报，仅落 buffer）。 */
export const nullSender: AuditBatchSender = {
  async postBatch(): Promise<void> {
    /* no-op：未配置上报通道时静默丢弃（不阻断） */
  },
};

/** AuditSink 构造选项。 */
export interface AuditSinkOptions {
  /** buffer 上限，满即 flush。默认 100。 */
  maxSize?: number;
  /** 定时 flush 周期（ms）。默认 5000。 */
  flushIntervalMs?: number;
  /** 指数退避基数（ms）。默认 500。 */
  retryBaseMs?: number;
  /** 单批最大重试次数。默认 5。 */
  maxRetries?: number;
  /** 连续失败累计阈值：超过则强制落盘降级。默认 3。 */
  failoverThreshold?: number;
  /** 落盘 jsonl 路径。默认 ~/.sillyhub/daemon/audit-failed.jsonl（跨平台）。 */
  failoverPath?: string;
}

/** 默认落盘路径：~/.sillyhub/daemon/audit-failed.jsonl（Linux/macOS/Windows 均成立）。 */
export function defaultFailoverPath(): string {
  return join(homedir(), '.sillyhub', 'daemon', 'audit-failed.jsonl');
}

// ── AuditSink ─────────────────────────────────────────────────────────────────

/**
 * Audit 批量上报 sink。
 *
 * 线程模型：record 同步入 buffer（不抛错、不阻塞）；满 maxSize 同步触发一次异步
 * flush（fire-and-forget）；定时器周期 flush。所有 flush 错误被吞，最坏降级落盘。
 */
export class AuditSink {
  private readonly buffer: AuditEvent[] = [];
  private readonly sender: AuditBatchSender;
  private readonly maxSize: number;
  private readonly flushIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly maxRetries: number;
  private readonly failoverThreshold: number;
  private readonly failoverPath: string;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(sender: AuditBatchSender = nullSender, opts: AuditSinkOptions = {}) {
    this.sender = sender;
    this.maxSize = opts.maxSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.maxRetries = opts.maxRetries ?? 5;
    this.failoverThreshold = opts.failoverThreshold ?? 3;
    this.failoverPath = opts.failoverPath ?? defaultFailoverPath();
    this.startTimer();
  }

  /**
   * 入 buffer（D-008：仅写类决策调用）。同步、不抛错。
   * 满 maxSize 立即触发一次异步 flush（fire-and-forget）。
   */
  record(e: AuditEvent): void {
    this.buffer.push(e);
    if (this.buffer.length >= this.maxSize) {
      // 满 maxSize 即异步 flush，不 await（record 是同步的，不阻断调用方）
      void this.flush();
    }
  }

  /**
   * flush 当前 buffer 到 backend。
   *
   * 流程：取快照 → 指数退避重试 → 全失败则落盘 jsonl。
   * 永远 resolve（吞错），不阻断调用方。
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // 原子取走当前 buffer 快照（splice 保证并发 flush 不会重复处理同一批事件）
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.sendWithRetry(batch);
    } catch {
      // 重试耗尽 → 降级落盘，防 OOM
      this.failoverToDisk(batch);
    }
  }

  /**
   * 指数退避重试发送。
   * @throws 重试 maxRetries 次仍失败时 reject（由 flush 兜底落盘）
   */
  private async sendWithRetry(batch: AuditEvent[]): Promise<void> {
    let attempt = 0;
    // failoverThreshold 用于「连续失败累计」语义：当 attempt 达到阈值即提前落盘，
    // 避免极端情况下重试太久占用事件。这里以 maxRetries 为上限，failoverThreshold
    // 作为提前熔断点（取较小者）。
    const effectiveMax = Math.min(this.maxRetries, Math.max(1, this.failoverThreshold));
    while (true) {
      try {
        await this.sender.postBatch(batch);
        return; // 成功
      } catch (err) {
        attempt += 1;
        if (attempt >= effectiveMax) {
          throw err; // 交给 flush 落盘
        }
        // 指数退避：base * 2^(attempt-1)
        const delay = this.retryBaseMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }
  }

  /**
   * 降级落盘：把 batch 每行一个 JSON 追加写入 jsonl（防 OOM）。
   * 失败也吞错（落盘都失败则只能丢弃，保进程不崩）。
   */
  private failoverToDisk(batch: AuditEvent[]): void {
    try {
      // 确保目录存在（首次落盘）
      mkdirSync(dirname(this.failoverPath), { recursive: true });
      const lines = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(this.failoverPath, lines, 'utf-8');
    } catch {
      // 落盘失败（磁盘满/权限）→ 最后兜底丢弃，保进程存活（已尽力）
    }
  }

  /** 启动定时 flush。 */
  private startTimer(): void {
    if (this.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // unref：定时器不阻止 Node 进程退出（daemon 正常退出时无需手动 destroy）
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /** 可中断的 sleep（fake timers 友好）。 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 销毁：清理定时器，触发最后一次 flush。
   * daemon 关闭 / 测试 teardown 调用。
   */
  async destroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
