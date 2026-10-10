/**
 * 轮级 token 生成速度（tok/s）纯函数——2026-10-10-session-turn-token-speed。
 *
 * 口径对齐 deepseek-harness（packages/client/ui-chat message-chrome.ts 的
 * formatTokensPerSecond）：提供方报告的输出词元 ÷ 模型生成时长，**不含**工具
 * 执行时间——本平台分母用 AgentRun.duration_api_ms（daemon 结果元数据的轮内
 * API 调用总时长）。数据不可得（运行中 / 旧数据 / 无时长引擎）一律返回 null
 * 不显示，禁止用墙钟估速充数（含工具等待的墙钟会把真实速度稀释数倍，多供应
 * 商对比场景下误导性强）。
 *
 * 纯函数：零 React / 渲染依赖，turn-timeline 与测试共用。
 *
 * @module components/daemon/turn-speed
 */

import type { TurnUiStatus } from "@/components/daemon/turn-timeline";

/** 终态轮集合（速度只在轮收尾、duration_api_ms 落定后显示）。 */
const TERMINAL_SPEED_STATUSES: ReadonlySet<TurnUiStatus> = new Set([
  "completed",
  "failed",
  "killed",
]);

/**
 * 速度数值格式化：≥10 四舍五入取整、<10 保留 1 位小数、负值钳 0
 * （deepseek-harness formatTokensPerSecond 同口径——药丸级辅助信息，
 * 高速时整数位足够，低速时一位小数可辨）。
 */
export function formatTokensPerSecond(tps: number): string {
  if (!Number.isFinite(tps)) return "0";
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : clamped.toFixed(1);
}

/**
 * 轮尾速度段文本：终态轮且输出词元与 API 时长均可得（时长 > 0）时返回
 * `"N tok/s"`，否则 null（调用方不渲染速度段）。失败/中止轮只要数据齐同样
 * 显示——速度是模型侧事实，与轮业务成败正交。
 */
export function turnTokenSpeedText(
  outputTokens: number | null | undefined,
  apiDurationMs: number | null | undefined,
  status: TurnUiStatus,
): string | null {
  if (!TERMINAL_SPEED_STATUSES.has(status)) return null;
  if (outputTokens == null || apiDurationMs == null || apiDurationMs <= 0) {
    return null;
  }
  return `${formatTokensPerSecond(outputTokens / (apiDurationMs / 1_000))} tok/s`;
}
