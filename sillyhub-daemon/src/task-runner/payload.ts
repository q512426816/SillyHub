/**
 * task-runner/payload.ts —— lease payload 鸭子读取器簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * pickStr / pickNum / pickStrList / intersectAllowedRoots / pickBudgetUsageSnapshot
 * 模块级纯函数原样搬移（零改写；包内导出供 facade 引用，不进 index 公共面）。
 *
 * @module task-runner/payload
 */

import type { LeaseCtx } from '../types.js';

/**
 * task-07：从 lease payload 鸭子类型 Record 安全取 string / number 字段（多键名兜底）。
 *
 * init lease 的 platform_config 由 backend task-06 下发，字段名 camelCase / snake_case
 * 兼容；直接 `(typeof x === 'string' && x)` 会产出 `string | false` 污染类型，本辅助函数
 * 收敛为 `string | undefined` / `number | undefined`，避免 `||` 回退链的类型 widen。
 */
export function pickStr(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export function pickNum(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * task-09：从 lease ctx 鸭子类型读 string[] 字段（camelCase + snake_case 兼容）。
 *
 * claim payload 经 context.py（task-07）透传 profile 字段（mcp_refs / skill_refs /
 * effective_allowed_roots），types.ts LeaseCtx 未声明这些字段，用 duck-typing 读取
 * （与 stage_meta / mode / platformConfig 等既有字段同模式）。非数组 / 空 → undefined。
 *
 * 纯函数，不修改入参。
 */
export function pickStrList(
  ctx: LeaseCtx,
  camel: string,
  snake: string,
): string[] | undefined {
  const obj = ctx as unknown as Record<string, unknown>;
  const raw = obj[camel] ?? obj[snake];
  if (!Array.isArray(raw)) return undefined;
  const arr = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return arr.length > 0 ? arr : undefined;
}

/**
 * task-09（D-013）：物理沙箱 ∩ profile effective 下推值（只能收紧）。
 *
 * effective 已是 daemon.allowed_roots ∩ agent.overlay（backend 算好），此处再 ∩ 物理
 * 上限是防御性兜底——backend 误算把 overlay 放宽出 daemon 范围时，交集仍不超物理。
 * physical 缺省（无 policyCache + 无 config.allowed_roots）→ 直接用 effective（已是
 * 可得的最严上界，无法与未知物理值取交集，保持收紧语义）。
 *
 * 结果 = physical 中同时出现在 effective 的路径（真交集，result ⊆ physical 且 ⊆ effective）。
 *
 * 纯函数，不修改入参。
 */
export function intersectAllowedRoots(
  physical: string[] | undefined,
  effective: string[],
): string[] {
  if (!physical || physical.length === 0) return effective;
  const effSet = new Set(effective);
  return physical.filter((p) => effSet.has(p));
}

/**
 * task-08（D-009）：从 stats 拆出 budget 事件回传用的 usage 快照（仅 input+output，
 * 不含 cache，对齐累计口径）。
 */
export function pickBudgetUsageSnapshot(
  stats: Record<string, unknown> | undefined,
): { input_tokens: number; output_tokens: number } {
  if (!stats) return { input_tokens: 0, output_tokens: 0 };
  const inp =
    typeof stats.input_tokens === 'number' && Number.isFinite(stats.input_tokens)
      ? stats.input_tokens
      : 0;
  const out =
    typeof stats.output_tokens === 'number' && Number.isFinite(stats.output_tokens)
      ? stats.output_tokens
      : 0;
  return { input_tokens: inp, output_tokens: out };
}
