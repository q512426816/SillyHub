/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004: 共享日志内容过滤纯函数。
 *
 * 独立模块避免 runtime-session-helpers ↔ interactive-session-panel 循环依赖
 *（helpers 已 import panel 的 InteractiveSessionPanel；若 panel 反向 import
 * helpers 会成环，故共享纯函数下沉到此独立文件）。
 *
 * attach 历史预填（logsToTurns）与实时 SSE（renderLogContent）共用同一过滤，
 * 避免 thinking/SYSTEM/AskUserQuestion 等原始标记泄漏到正文（修复 attach 历史
 * 消息渲染 BUG：[SYSTEM:thinking_tokens]/[THINKING] 不再显示）。
 *
 * 过滤规则（与原 interactive-session-panel.tsx:894 renderLogContent 完全一致）：
 *   - 含 AskUserQuestion / [TOOL_RESULT] User answered / [SYSTEM…]/[RESULT…] → 丢弃
 *   - channel=stderr → 加 ⚠️ 前缀
 *   - channel=tool_call → 加 🔧 前缀
 *   - 剥 [ASSISTANT|THINKING|LOG:\w+] 前缀
 */
export function sanitizeSessionLogContent(content: string, channel?: string | null): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("AskUserQuestion")) return "";
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return "";
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return "";
  if (channel === "stderr") return `⚠️ ${trimmed}`;
  if (channel === "tool_call") return `🔧 ${trimmed}`;
  return trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/, "");
}
