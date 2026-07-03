/**
 * policy/runtime-policy.ts —— RuntimePolicy + PolicyCache（task-02 / D-002 D-007）。
 *
 * 按 runtime_id 隔离的内存策略缓存，替代 daemon.ts:1682 的「取并集」语义：
 *   - 每个 runtime（=agent 种类/provider）独立存自己的 allowedRoots，互不串扰；
 *   - **不偷偷加 homedir**（D-007）：严格按 admin 配置存，未命中由调用方 fallback；
 *   - 纯内存，不持久化，靠 backend 心跳 + WS POLICY_UPDATE 重建；
 *   - version 单调递增，用于 WS push 去重（POLICY_UPDATE 带 version）。
 *
 * @module policy/runtime-policy
 */

import { resolveRealPath } from './path-utils.js';

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 单个 runtime 的文件系统策略（已规范化）。 */
export interface RuntimePolicy {
  /** 已规范化的 allowed_roots（每个经 path-utils.resolveRealPath：realpath + 大小写归一）。 */
  allowedRoots: string[];
  /** 版本号，单调递增，用于 WS push 去重。 */
  version: number;
}

// ── PolicyCache ──────────────────────────────────────────────────────────────

/**
 * 按 runtime_id 隔离的策略缓存。
 *
 * 内部 `Map<runtime_id, RuntimePolicy>`：
 *   - set/reload：每个 root 经 resolveRealPath 规范化后存，version 续递增；
 *   - reloadAll：心跳全量刷新，替换整个 map（version 重置为 1，视为重建）。
 */
export class PolicyCache {
  private readonly map = new Map<string, RuntimePolicy>();

  /**
   * 读取某 runtime 的策略。
   *
   * @returns 命中返回 RuntimePolicy；未命中返回 undefined（调用方决定 fallback，如 homedir 兜底）。
   */
  get(rid: string): RuntimePolicy | undefined {
    return this.map.get(rid);
  }

  /**
   * 写入 / 更新某 runtime 的策略。
   *
   * - 每个 root 经 path-utils.resolveRealPath 规范化后存（防 `..`/symlink/junction/UNC 绕过）；
   * - **不补任何兜底目录**（D-007 严格按 admin 配置）；
   * - version 单调递增（新 rid 从 1，已存在则 +1）。
   *
   * @param rid    runtime_id
   * @param roots  原始 allowed_roots（字符串数组，未规范化亦可）
   */
  set(rid: string, roots: string[]): void {
    const allowedRoots = roots.map((r) => resolveRealPath(r));
    const prev = this.map.get(rid);
    this.map.set(rid, {
      allowedRoots,
      version: prev ? prev.version + 1 : 1,
    });
  }

  /**
   * 重载某 runtime 的策略（语义同 {@link set}）。
   *
   * 用于 WS POLICY_UPDATE 推送的 sub-second 热更新。
   */
  reload(rid: string, roots: string[]): void {
    this.set(rid, roots);
  }

  /**
   * 心跳全量刷新：用 backend 下发的全量 entries 替换内部 map。
   *
   * - 旧的 runtime（不在 entries 中）被清除；
   * - 所有 runtime version 重置为 1（视为全新一批重建）。
   *
   * @param entries `Array<[runtime_id, allowed_roots]>`
   */
  reloadAll(entries: Array<[string, string[]]>): void {
    this.map.clear();
    for (const [rid, roots] of entries) {
      // 全量重建：直接 set 即可（prev 必为 undefined → version=1）
      this.set(rid, roots);
    }
  }
}
