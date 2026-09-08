/**
 * task-runner/payload.ts —— lease payload 鸭子读取器簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * pickStr / pickNum / pickStrList / intersectAllowedRoots / pickBudgetUsageSnapshot
 * 模块级纯函数原样搬移（零改写；包内导出供 facade 引用，不进 index 公共面）。
 *
 * task-04 轻重构①（同变更）：pickStr / pickNum / pickStrList /
 * pickBudgetUsageSnapshot 实现收敛至 src/payload-utils.ts（与 session-manager
 * 包 helpers.ts 的 strOf/numOf 统一为单一实现源）；本模块保留同名导出转发
 * （对外导出面不变，行为零变化——tests/payload-utils.test.ts 断言实现同一）。
 * intersectAllowedRoots 是集合求交逻辑（session-manager 侧无平行实现，不同构），
 * 不收敛，仍由本模块自持。
 *
 * @module task-runner/payload
 */

export {
  pickStr,
  pickNum,
  pickStrList,
  pickBudgetUsageSnapshot,
} from '../payload-utils.js';

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
