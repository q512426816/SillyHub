// src/knowledge-hits-periodic.ts
// 2026-09-26-daemon-hits-periodic-upload：知识命中遥测周期上行器（解耦 postSpecSync）。
//
// 背景（2026-09-25 生产实证）：hits 上行钩子只挂在 postSpecSync 成功汇聚点——spec 同步
// 一失败遥测就全断（两工作区各断 4-5 天无人察觉）。服务端 (workspace_id, line_hash) 行级
// 唯一约束幂等、重报免费，上行没有理由与同步成败耦合。
//
// 通道形态：daemon 主循环每 intervalMs 对 specs/ 目录下每个绑定工作区触发一次
// uploadKnowledgeHitsIfNeeded（best-effort 语义与 postSpecSync 挂点完全一致：失败只 warn
// 不抛、断点不进——服务端 hash 去重兜底）。mtime/size 短路：hits 文件与上次触发时相同则
// 跳过整轮（避免每 5 分钟无谓全量读 2MB+ 大文件）。
//
// 双通道幂等：postSpecSync 挂点保留（同步后即时上行）+ 本周期兜底，两路重报由服务端
// hash 去重吸收，零重复入库。

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
// 结构面放宽到 unknown（duck-type）：真实 HubClient（ClientLike）与测试替身都可
// 注入——uploadKnowledgeHitsIfNeeded 自身按方法存在性探测，此处无需收紧类型。
type HitsPosterClient = unknown;
import { daemonStateDir } from './config.js';
import { uploadKnowledgeHitsIfNeeded } from './knowledge-hits-upload.js';

export const HITS_PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

/** 周期上行器（start 返回 stop；幂等：重复 start 先停旧）。纯函数式 round 便于单测。 */
export class KnowledgeHitsPeriodicUploader {
  private _timer: ReturnType<typeof setInterval> | null = null;
  /** wsId → 上次触发时 hits 文件的 mtime+size（短路键；null = 从未见过）。 */
  private _lastStamp = new Map<string, string>();

  constructor(
    private readonly _client: HitsPosterClient,
    private readonly _intervalMs: number = HITS_PERIODIC_INTERVAL_MS,
    private readonly _stateDir: string = daemonStateDir(),
  ) {}

  /** 单轮：枚举 specs/ 下绑定工作区，mtime 短路后逐个 best-effort 上行。导出供测试直调。 */
  async roundOnce(): Promise<{ attempted: string[]; skippedUnchanged: string[] }> {
    const attempted: string[] = [];
    const skippedUnchanged: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(join(this._stateDir, 'specs'), { withFileTypes: true })
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .map((e) => e.name)
        // junction 指向源项目；.pre-junction-backup-* 缓存目录不是绑定工作区
        .filter((n) => !n.includes('.pre-junction-backup'));
    } catch {
      return { attempted, skippedUnchanged }; // specs/ 不存在=零绑定，常态静默
    }
    for (const wsId of entries) {
      if (!/^[0-9a-f-]{36}$/i.test(wsId)) continue; // UUID 形态守卫（防杂名进端点）
      let stamp: string | null = null;
      try {
        const st = statSync(join(this._stateDir, 'specs', wsId, '.runtime', 'knowledge-hits.jsonl'));
        stamp = `${st.mtimeMs}:${st.size}`;
      } catch {
        stamp = null; // 无 hits 文件：记空印（下轮文件出现即变化触发）
      }
      // 短路键统一归一（无文件 = 'none' 印）：空印第二轮同样短路，不空转。
      const stampKey = stamp ?? 'none';
      if (this._lastStamp.get(wsId) === stampKey) {
        skippedUnchanged.push(wsId);
        continue;
      }
      if (stamp === null) {
        this._lastStamp.set(wsId, stampKey); // 无文件：空印短路
        continue;
      }
      // uploadKnowledgeHitsIfNeeded 自身全程 try/catch 不抛；再包一层防定时器冒泡。
      // stamp **成功后才记**（评审 P2 收口）：失败轮不记印，下轮同 mtime 也会重试
      // ——「失败后文件未变则永久短路」的漏重试口子由后移记录堵死。
      try {
        const ok = await uploadKnowledgeHitsIfNeeded(
          this._client as never,
          wsId,
          join(this._stateDir, 'specs', wsId),
        );
        if (ok === false) continue; // uploader 内部吞错但回执 false：不记印，同 mtime 下轮重试
        this._lastStamp.set(wsId, stampKey);
        attempted.push(wsId);
      } catch (e) {
        console.warn('knowledge_hits_periodic: round_failed_will_retry_next_round', wsId, e);
      }
    }
    return { attempted, skippedUnchanged };
  }

  start(): void {
    this.stop();
    this._timer = setInterval(() => {
      void this.roundOnce().catch((e) => {
        console.warn('knowledge_hits_periodic: round_error', e);
      });
    }, this._intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
