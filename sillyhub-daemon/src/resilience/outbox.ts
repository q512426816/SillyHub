/**
 * Outbox——失败消息落盘暂存（task-15 / FR-06 / FR-09 / D-001@v2）。
 *
 * 来源：design.md §5 Phase3 / §7 Outbox 接口 / §10 R-04/R-07；plan.md Wave3 task-15。
 * 本质：submitWithRetry 用尽后把消息信封落盘 JSONL（`<outboxDir>/<dedupId>.jsonl`），
 *   daemon 重启后 load 恢复 pending，drainOutbox（task-18）在网络恢复后补发。
 *
 * 2026-08-29-daemon-platform-resilience task-07（D-007@v1 outbox 扩展形态）：
 *   - entry 加可选 `kind` 字段（'messages'（缺省）/ 'run_result' / 'session_end'）；
 *   - 文件命名维度由 runId 泛化为 dedupId（messages/run_result 用 runId、
 *     session_end 用 sessionId）——entry.runId 字段即承载该 dedupId；
 *   - 终态 entry 携带完整 payload 于 envelopes[0].message（dedup_key=dedupId）；
 *   - `pending_token` 标记 claim_token 空窗/422 失效入箱的条目，待
 *     SESSION_INJECT 刷新 token 后 drain 重放（A3/A5）。
 *
 * 设计要点：
 *   - 每 dedupId 一个 jsonl 文件，每 entry 一行 JSON append（enqueue）。
 *   - markDelivered 原子移除匹配 dedup_key：读全→过滤→写临时→rename（防并发损坏）。
 *   - load 启动时 glob 所有 .jsonl 读入内存 pending map（dedupId→entries[]）；
 *     旧文件缺 kind 字段按 'messages' 兼容解析（向后兼容）。
 *   - 容量上限：per-run（maxPerRun）+ total（maxTotal），超限丢最旧 entry + warn（R-04）。
 *   - 文件损坏行跳过 + warn，不整体崩。
 *
 * Envelope/OutboxEntry/Outbox 接口在此定义，service.ts re-export 统一。
 *
 * @module resilience/outbox
 */

import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 待提交消息信封：消息体 + 幂等键。 */
export interface Envelope {
  message: Record<string, unknown>;
  dedup_key: string;
}

/**
 * task-07（D-007@v1）：终态 entry kind 词表。
 * 'messages'（流式消息，缺省）之外的两种终态载荷，drain 按 kind 路由到
 * notifyRunResult / notifySessionEnd（SubmitClient 扩展方法）。
 */
export type OutboxTerminalKinds = 'run_result' | 'session_end';

/** outbox entry 完整 kind 词表（含缺省的 messages）。 */
export type OutboxEntryKind = 'messages' | OutboxTerminalKinds;

/** outbox 落盘条目。 */
export interface OutboxEntry {
  leaseId: string;
  claimToken: string;
  /**
   * 去重维度 id（task-07 泛化，即文件命名 `<dedupId>.jsonl` 的 dedupId）：
   *   - kind=messages / run_result → AgentRun.id（既有语义不变）；
   *   - kind=session_end → AgentSession.id。
   * 内存 pending map 与落盘文件均以该值作 key。
   */
  runId: string;
  /**
   * 消息信封。kind=messages 时为批量消息信封；kind=run_result 时单条——
   * message 携带完整 result payload（status/is_error/usage 等）、dedup_key=runId；
   * kind=session_end 时单条——message={ status, reason }、dedup_key=sessionId。
   */
  envelopes: Envelope[];
  ts: string;
  /**
   * task-07（D-007@v1）：entry 载荷类型。缺省（含旧 `<runId>.jsonl` 文件 load）
   * 按 'messages' 兼容解析。
   */
  kind?: OutboxEntryKind;
  /**
   * task-07（A3/A5）：claim_token 空窗或 422 失效入箱标记。drain 重放前经
   * ClaimTokenRefresher 取当前有效 token（SESSION_INJECT 已刷新到 daemon
   * SessionState），取不到则用 entry 原值重试、由 backend dedup/终态规则兜底。
   */
  pending_token?: boolean;
}

/**
 * Outbox 抽象接口（task-08 ResilienceService 依赖此接口，可注入 no-op/mock）。
 * task-15 FileOutbox 是其文件实现。
 */
export interface Outbox {
  enqueue(entry: OutboxEntry): Promise<void>;
  markDelivered(runId: string, dedupKeys: string[]): Promise<void>;
  pendingByRun(runId: string): OutboxEntry[];
  /** 所有有 pending 的 runId 列表（drainOutbox 遍历用）。 */
  runs(): string[];
  load(): Promise<void>;
}

/** Outbox 配置。 */
export interface OutboxConfig {
  maxPerRun: number;
  maxTotal: number;
}

/** 最小 Logger 接口（与 ResilienceLogger 对齐）。 */
export interface OutboxLogger {
  warn(event: string, kv?: Record<string, unknown>): void;
  info(event: string, kv?: Record<string, unknown>): void;
}

/**
 * 基于文件 JSONL 的 outbox 实现。
 *
 * 内存态：_pending: Map<dedupId, OutboxEntry[]>（load 后填充，enqueue/markDelivered 维护）；
 * dedupId = entry.runId（task-07 泛化：messages/run_result 为 runId、session_end 为 sessionId）。
 * 落盘：每 dedupId 一个 .jsonl，enqueue append 一行，markDelivered 重写文件。
 */
export class FileOutbox implements Outbox {
  private readonly _pending = new Map<string, OutboxEntry[]>();

  constructor(
    private readonly _dir: string,
    private readonly _cfg: OutboxConfig,
    private readonly _logger: OutboxLogger,
  ) {}

  /**
   * 落盘一条 entry（FR-06）。
   *
   * 容量上限：per-run 超 maxPerRun 或 total 超 maxTotal → 丢最旧 entry（跨 run 全局最旧）+ warn。
   * 落盘前 ensureDir；append 一行 JSON。
   */
  async enqueue(entry: OutboxEntry): Promise<void> {
    await mkdir(this._dir, { recursive: true });
    // 容量上限 eviction 同步落盘（await），保证内存态与文件态一致——
    // 否则 fire-and-forget 重写会与外部清理（rm -rf）在 Windows 上竞态致 EBUSY。
    await this._evictIfNeeded(entry.runId);
    const list = this._pending.get(entry.runId) ?? [];
    list.push(entry);
    this._pending.set(entry.runId, list);
    await appendFile(this._path(entry.runId), JSON.stringify(entry) + '\n', 'utf-8');
  }

  /**
   * 移除某 run 匹配 dedup_key 的 entry（FR-06 成功补发后调用，幂等）。
   *
   * 原子：读全→过滤→写临时→rename。空文件 → unlink。
   * 无匹配 → no-op。
   */
  async markDelivered(runId: string, dedupKeys: string[]): Promise<void> {
    if (dedupKeys.length === 0) return;
    const keySet = new Set(dedupKeys);
    const list = this._pending.get(runId);
    if (!list || list.length === 0) return;
    const kept = list.filter(
      (e) => !e.envelopes.every((env) => keySet.has(env.dedup_key)),
    );
    this._pending.set(runId, kept);
    // 重写文件：kept 全部 entry 重新序列化（每行一个）。
    const p = this._path(runId);
    try {
      if (kept.length === 0) {
        this._pending.delete(runId);
        await unlink(p).catch(() => undefined);
      } else {
        const tmp = p + '.tmp';
        const content = kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
        await writeFile(tmp, content, 'utf-8');
        await rename(tmp, p);
      }
    } catch (e) {
      this._logger.warn('outbox_mark_delivered_failed', {
        run_id: runId,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  /** 某 run 的 pending entries（drainOutbox 补发用）。返回副本，外部修改不影响内部。 */
  pendingByRun(runId: string): OutboxEntry[] {
    return [...(this._pending.get(runId) ?? [])];
  }

  /** 所有有 pending 的 runId（drainOutbox 遍历）。 */
  runs(): string[] {
    return [...this._pending.keys()];
  }

  /**
   * 启动恢复（FR-09）：glob `<dir>/*.jsonl`，逐文件读入 pending map。
   *
   * 文件损坏/非法 JSON 行 → 跳过该行 + warn，不整体崩。
   * task-07（D-007 兼容）：旧文件 entry 缺 `kind` 字段 → 按 'messages' 解析。
   */
  async load(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this._dir);
    } catch {
      // 目录不存在 → 空 outbox，正常。
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const dedupId = f.slice(0, -'.jsonl'.length);
      const content = await readFile(join(this._dir, f), 'utf-8').catch(() => '');
      const entries: OutboxEntry[] = [];
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as OutboxEntry;
          // task-07：旧文件缺 kind 按 messages 兼容（写入端新 entry 恒带 kind）。
          if (parsed.kind === undefined) {
            parsed.kind = 'messages';
          }
          entries.push(parsed);
        } catch {
          this._logger.warn('outbox_load_skip_bad_line', { run_id: dedupId });
        }
      }
      if (entries.length > 0) {
        this._pending.set(dedupId, entries);
      }
    }
  }

  /** 容量上限检查：超 per-run 或 total → 丢最旧（R-04）。同步落盘保证一致性。 */
  private async _evictIfNeeded(runId: string): Promise<void> {
    const perRun = this._pending.get(runId)?.length ?? 0;
    if (perRun >= this._cfg.maxPerRun) {
      await this._dropOldest(runId);
    }
    if (this._totalCount() >= this._cfg.maxTotal) {
      await this._dropOldestGlobal();
    }
  }

  private async _dropOldest(runId: string): Promise<void> {
    const list = this._pending.get(runId);
    if (list && list.length > 0) {
      list.shift();
      this._logger.warn('outbox_evicted_per_run', { run_id: runId });
      await this._rewriteFile(runId, list);
    }
  }

  private async _dropOldestGlobal(): Promise<void> {
    // 找全局最早的 entry（按 ts 字符串字典序近似时间序）所在 run。
    let oldestRun: string | null = null;
    let oldestTs = '';
    for (const [rid, list] of this._pending) {
      const first = list[0];
      if (first && (oldestRun === null || first.ts < oldestTs)) {
        oldestTs = first.ts;
        oldestRun = rid;
      }
    }
    if (oldestRun) {
      await this._dropOldest(oldestRun);
    }
  }

  private async _rewriteFile(runId: string, list: OutboxEntry[]): Promise<void> {
    const p = this._path(runId);
    try {
      if (list.length === 0) {
        await unlink(p).catch(() => undefined);
      } else {
        const tmp = p + '.tmp';
        await writeFile(tmp, list.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
        await rename(tmp, p);
      }
    } catch {
      // 落盘失败不阻断内存态；下次 enqueue/load 再对齐。
    }
  }

  private _totalCount(): number {
    let n = 0;
    for (const list of this._pending.values()) n += list.length;
    return n;
  }

  private _path(dedupId: string): string {
    // dedupId（task-07 泛化：messages/run_result=runId、session_end=sessionId）
    // 可能含路径分隔符风险，用 encodeURIComponent 规范化文件名。
    return join(this._dir, `${encodeURIComponent(dedupId)}.jsonl`);
  }
}
