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
  // ql-20260730-001：剥 [TOOL_USE]/[TOOL_RESULT] 前缀(tool 内容分流到 toolEvents 卡片,
  // 不再加 🔧 前缀,tool 卡片自带图标);原 tool_call 🔧 分支移除(由 classify 分流)。
  return trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT)\]\s?/, "");
}

/**
 * ql-20260730-001：会话日志分类(思考/工具/回复)，供 turn 组装按类型分流到
 * thinking / toolEvents / output 三层渲染(原型 prototype-session-turn.html)。
 *
 * 在 sanitize 剥前缀前按原始 [THINKING]/[TOOL_USE]/[TOOL_RESULT] 标记判断；
 * channel=tool_call 也归 tool_use(无前缀的 tool 日志)。
 */
export type SessionLogKind =
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "assistant"
  | "skip";

export function classifySessionLog(
  content: string,
  channel?: string | null,
): SessionLogKind {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "skip";
  if (trimmed.includes("AskUserQuestion")) return "skip";
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return "skip";
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return "skip";
  if (/^\[THINKING\]/.test(trimmed)) return "thinking";
  if (/^\[TOOL_USE\]/.test(trimmed)) return "tool_use";
  if (/^\[TOOL_RESULT\]/.test(trimmed)) return "tool_result";
  if (channel === "tool_call") return "tool_use";
  return "assistant";
}
