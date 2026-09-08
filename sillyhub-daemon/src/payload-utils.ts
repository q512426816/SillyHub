/**
 * payload-utils.ts —— 跨包统一的鸭子类型字段读取器（单一实现源）。
 *
 * task-04 轻重构①（2026-09-07-arch-large-file-split / design §5 Wave 1 / FR-05 /
 * D-005@v3）：session-manager 包 helpers.ts 的 strOf/numOf 与 task-runner 包
 * payload.ts 的 pickStr/pickNum/pickStrList/pickBudgetUsageSnapshot 两套平行
 * 维护的鸭子读取实现收敛到本模块。原模块保留同名导出一行转发（对外导出面
 * 不变，内部实现收敛，行为零变化——tests/payload-utils.test.ts 断言边界语义）。
 *
 * 两种口径差异（参数化保留，互不吞并）：
 *   - 单值守卫（numOf）：直接判定值本身，bool 排除；非 number → undefined
 *     （NaN/Infinity 是 number 原样返回——typeof 守卫不做有限性过滤）；
 *   - 多键挑选（pickStr/pickNum）：camelCase/snake_case 多键名兜底，且
 *     pickStr 非空 string 才命中、pickNum 有限 number（Number.isFinite）才命中，
 *     全 miss → undefined；
 *   - 单值 string 化（strWithDefault）：非 string → 调用方给定默认值
 *     （helpers.strOf 固定 ''；与 pickStr 的「非空才命中」不同，空串是合法值）。
 *
 * 注：task-runner 的 intersectAllowedRoots 是集合求交逻辑（无 session-manager
 * 侧平行实现，不同构），按任务卡约定不收敛，仍由 task-runner/payload.ts 自持。
 *
 * @module payload-utils
 */

import type { LeaseCtx } from './types.js';

/**
 * 单值 string 化读取（null/undefined/非 string → defaultValue）。
 *
 * session-manager helpers.strOf 的参数化默认值核心（strOf 固定 ''）。
 */
export function strWithDefault(v: unknown, defaultValue: string): string {
  return typeof v === 'string' ? v : defaultValue;
}

/**
 * 单值 number 守卫读取（bool 排除；非 number → undefined）。
 *
 * 对齐 claude-events.ts 同款口径（原 session-manager/helpers.ts numOf 原样收敛）。
 */
export function numOf(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

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
