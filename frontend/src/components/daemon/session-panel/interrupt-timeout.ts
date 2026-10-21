/**
 * 2026-10-21-daemon-zombie-turn FR-04：打断 15s 超时回退定时器簿记。
 *
 * 背景（生产会话 49d893ab）：打断信号送达且 HTTP 200，但 daemon 侧对僵尸轮
 * 空转——终态 SSE 永不到达，前端永久停在「打断中」。本 hook 只管定时器
 * 簿记（arm/clear/换防/卸载清理），到点后的 UI 回退（interrupting→running
 * + 提示）由调用方回调完成；回调里自查轮状态，终态已到则 no-op，天然免除
 * 对终态事件的显式清定时器依赖。
 */
import { useCallback, useEffect, useRef } from "react";

/** 超时窗口（ms）。 */
export const INTERRUPT_FEEDBACK_TIMEOUT_MS = 15_000;

/** hook 返回面：arm 单槽换防（同轮重按换新 timer），clear 幂等。 */
export interface InterruptFeedbackTimeoutHandle {
  arm: (_runId: string) => void;
  clear: () => void;
}

export function useInterruptFeedbackTimeout(
  onTimeout: (_runId: string) => void,
): InterruptFeedbackTimeoutHandle {
  // 最新回调经 ref 透传：arm/clear 身份稳定（空依赖 useCallback），调用方
  // 的 useCallback 依赖面不因本 hook 膨胀。
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const entryRef = useRef<{ runId: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const clear = useCallback(() => {
    if (entryRef.current) {
      clearTimeout(entryRef.current.timer);
      entryRef.current = null;
    }
  }, []);

  const arm = useCallback(
    (runId: string) => {
      clear();
      const timer = setTimeout(() => {
        entryRef.current = null;
        onTimeoutRef.current(runId);
      }, INTERRUPT_FEEDBACK_TIMEOUT_MS);
      entryRef.current = { runId, timer };
    },
    [clear],
  );

  // 卸载清理：防定时器泄漏/卸载后触发状态更新。
  useEffect(() => clear, [clear]);

  return { arm, clear };
}
