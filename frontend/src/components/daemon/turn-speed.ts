/**
 * 轮级 token 生成速度（tok/s）纯函数——2026-10-10-session-turn-token-speed
 * （初版：终态显示）+ 2026-10-10-live-token-speed-daemon-timing（门控放宽：
 * 运行中实时显示）。
 *
 * 口径对齐 deepseek-harness（packages/client/ui-chat message-chrome.ts 的
 * formatTokensPerSecond）：提供方报告的输出词元 ÷ 模型生成时长，**不含**工具
 * 执行时间——分母是轮内累计 API 调用时长（daemon 逐调用计时经 usage 管线实时
 * 上报，Claude 终态由 SDK 结果元数据权威覆盖）。数据不可得（旧数据 / 未计时
 * 引擎）一律返回 null 不显示，禁止用墙钟估速充数（含工具等待的墙钟会把真实
 * 速度稀释数倍，多供应商对比场景下误导性强）。
 *
 * 门控语义（本变更取代上变更「仅终态」）：**双值可得即显示（任意轮状态）**——
 * tokens 事件实时携带 api_duration_ms，运行中即可算速度；pending 队列态无数据
 * 自然不显示。不伪造原则不变。
 *
 * 纯函数：零 React / 渲染依赖，turn-timeline 与测试共用。
 *
 * @module components/daemon/turn-speed
 */

import type { TurnUiStatus } from "@/components/daemon/turn-timeline";

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
 * 轮尾速度段文本：输出词元与 API 时长双值可得（时长 > 0）即返回 `"N tok/s"`
 * （任意轮状态——运行中实时 + 终态统一），否则 null（调用方不渲染速度段）。
 * `status` 参数保留（签名兼容）但不再参与门控。失败/中止轮只要数据齐同样
 * 显示——速度是模型侧事实，与轮业务成败正交。
 */
export function turnTokenSpeedText(
  outputTokens: number | null | undefined,
  apiDurationMs: number | null | undefined,
  status: TurnUiStatus,
): string | null {
  void status;
  if (outputTokens == null || apiDurationMs == null || apiDurationMs <= 0) {
    return null;
  }
  return `${formatTokensPerSecond(outputTokens / (apiDurationMs / 1_000))} tok/s`;
}
