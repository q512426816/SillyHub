/**
 * session-completed-unread —— 会话「执行完成」通知标记存储（2026-10-15-
 * session-turn-completion-semantics）。
 *
 * 两个标记来源共用同一落盘键与同一展示（行首绿色完成角标，点击进入后消失）：
 *   ① 会话终态转移：非终态 → ended（面板检测，2026-10-15-session-status-dot-
 *      semantics FR-06 迁入）；
 *   ② 轮次完成转移：活性 working/blocked → idle（use-session-liveness 检测，
 *      取代原红色「空闲未读」角标——「这轮跑完了回来看看」统一为执行完成语义）。
 *
 * 键名风格对齐 `sillyhub:liveness-unread:` 前缀惯例；全 try/catch 降级（存储
 * 不可用不误亮不崩溃；SSR 下 ReferenceError 同样被 catch 兜住返回 false）。
 */

/** localStorage 键前缀（仅本地 UI 状态，不上行）。 */
const COMPLETED_UNREAD_KEY_PREFIX = "sillyhub:session-completed-unread:";

/** 完成通知角标判定（渲染期直读存储；不可用恒 false——fail-open 不误亮）。 */
export function isCompletedUnread(sessionId: string): boolean {
  try {
    return (
      window.localStorage.getItem(COMPLETED_UNREAD_KEY_PREFIX + sessionId) !==
      null
    );
  } catch {
    return false;
  }
}

/** 写完成通知标记（值为发现完成的时刻，仅存在性语义）。 */
export function markCompletedUnread(sessionId: string): void {
  try {
    window.localStorage.setItem(
      COMPLETED_UNREAD_KEY_PREFIX + sessionId,
      String(Date.now()),
    );
  } catch {
    // 存储不可用：通知不亮，不崩。
  }
}

/** 清除完成通知标记（selected 置真时由 SessionRow 调，覆盖点击/Enter/深链）。 */
export function clearCompletedUnread(sessionId: string): void {
  try {
    window.localStorage.removeItem(COMPLETED_UNREAD_KEY_PREFIX + sessionId);
  } catch {
    // 同上降级。
  }
}
