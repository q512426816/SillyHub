/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004: 共享日志内容过滤纯函数。
 *
 * 独立模块避免 runtime-session-helpers ↔ interactive-session-panel 循环依赖
 *（helpers 已 import panel 的 InteractiveSessionPanel；若 panel 反向 import
 * helpers 会成环，故共享纯函数下沉到此独立文件）。
 *
 * attach 历史预填（logsToTurns）与实时 SSE（onLog）共用同一过滤，
 * 避免 thinking/SYSTEM/AskUserQuestion 等原始标记泄漏到正文（修复 attach 历史
 * 消息渲染 BUG：[SYSTEM:thinking_tokens]/[THINKING] 不再显示）。
 *
 * 过滤规则（与原 interactive-session-panel.tsx:894 renderLogContent 完全一致）：
 *   - 含 AskUserQuestion / [TOOL_RESULT] User answered / [SYSTEM…]/[RESULT…] → 丢弃
 *   - channel=stderr → 加 ⚠️ 前缀
 *   - channel=tool_call → 不加 🔧 前缀（ql-20260730-001：tool 内容走 classifySessionLog
 *     分流到工具卡片，卡片自带图标；保留正文不再加 emoji 前缀）
 *   - 剥 [ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT] 前缀
 */
export function sanitizeSessionLogContent(content: string, channel?: string | null): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("AskUserQuestion")) return "";
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return "";
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return "";
  if (channel === "stderr") return `⚠️ ${trimmed}`;
  return trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT)\]\s?/, "");
}

/**
 * ql-20260729-005：会话日志分类（对话 / 过程信息分流）。
 *
 * 与 sanitizeSessionLogContent 同一套丢弃规则，但返回结构化分类而非拼接字符串，
 * 供会话面板把「答复正文（reply）」与「过程信息（thinking/tool/stderr）」分流：
 * 默认对话视图只渲染 reply，过程信息经「对话/全部」切换后再展示。
 *
 * 分类规则：
 *   - 丢弃（返回 null）：AskUserQuestion 卡片协议行 / [TOOL_RESULT] User answered /
 *     [SYSTEM…] / [RESULT…] 与空内容（与原函数完全一致；丢弃优先于 channel 分流）
 *   - kind=thinking：[THINKING] 前缀行（剥前缀）
 *   - kind=tool：channel=tool_call（daemon 上报的工具 JSON），或
 *     内容以 [TOOL_USE] / [TOOL_RESULT] 前缀的 stdout 文本行（ql-20260729-005 补：
 *     daemon 会把工具调用同时发 channel=stdout 的 [TOOL_USE] 文本行与 channel=tool_call
 *     的 JSON，之前只拦了 JSON，[TOOL_USE]/[TOOL_RESULT] 文本行漏判成 reply 混进对话）
 *   - kind=stderr：channel=stderr
 *   - kind=reply：其余（剥 [ASSISTANT]/[LOG:\w+] 前缀）
 */
export type SessionLogSegmentKind = "reply" | "thinking" | "tool" | "stderr";

export interface SessionLogSegment {
  kind: SessionLogSegmentKind;
  text: string;
}

export function classifySessionLog(
  content: string,
  channel?: string | null,
): SessionLogSegment | null {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("AskUserQuestion")) return null;
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return null;
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return null;
  if (channel === "stderr") return { kind: "stderr", text: trimmed };
  if (channel === "tool_call") return { kind: "tool", text: trimmed };
  // ql-20260729-005：stdout 里的工具文本行也归 tool（[TOOL_USE] 调用 / [TOOL_RESULT] 结果）。
  // 剥掉前缀保留正文，过程项渲染更干净（如 "Read: {…}" / 文件内容）。
  const toolTextMatch = trimmed.match(/^\[(TOOL_USE|TOOL_RESULT)\]\s?/);
  if (toolTextMatch) {
    return { kind: "tool", text: trimmed.replace(/^\[(TOOL_USE|TOOL_RESULT)\]\s?/, "") };
  }
  if (/^\[THINKING\]\s?/.test(trimmed)) {
    return { kind: "thinking", text: trimmed.replace(/^\[THINKING\]\s?/, "") };
  }
  return {
    kind: "reply",
    text: trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/, ""),
  };
}
