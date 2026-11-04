/**
 * lib/model-memory.ts —— 供应商→模型本地记忆（2026-11-04-model-provider-cascade FR-03）。
 *
 * 职责：记住「用户上次在页面上为某供应商显式选择的模型」，供应商级联时自动
 * 选中（FR-01）。浏览器本地 localStorage，不入库不上报——跨会话的用户偏好
 * 启发式缓存，非权威数据（记忆越界/丢失回退候选第一个，无正确性影响）。
 *
 * 容错口径：JSON.parse 坏值/QuotaExceeded/隐私模式 localStorage 不可用 →
 * 静默忽略返回 null / 不阻塞交互（FR-03 行为句）。SSR 无 window 同静默。
 *
 * @module lib/model-memory
 */

const KEY_PREFIX = "sh:last-model:";

/**
 * 记录「供应商 → 上次显式选择的模型」。
 * 写入失败（隐私模式/容量/SSR）静默忽略——记忆是启发式缓存，不阻塞交互。
 */
export function rememberLastModel(providerId: string, model: string): void {
  if (!providerId || !model) return;
  try {
    window.localStorage.setItem(
      `${KEY_PREFIX}${providerId}`,
      JSON.stringify(model),
    );
  } catch {
    // 隐私模式/容量超限/SSR：静默忽略（FR-03 行为句）。
  }
}

/**
 * 读取供应商的上次显式模型。坏 JSON/缺键/SSR 返回 null（调用方回退候选第一个）。
 */
export function getLastModel(providerId: string): string | null {
  if (!providerId) return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${providerId}`);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed ? parsed : null;
  } catch {
    // 坏 JSON / localStorage 不可用：容错返回 null（FR-03 行为句）。
    return null;
  }
}
