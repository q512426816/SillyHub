"use client";

/**
 * quick 会话内搜索纯函数（自 session-panel.tsx 拆出，task-14 /
 * 2026-09-07-arch-large-file-split design §5 Wave 3；原样搬移零行为变化）。
 */

import { type ReactNode } from "react";
import { classifySessionLog } from "@/components/daemon/session-log-assembler";
import { type AgentRunLogEntry } from "@/lib/agent";


/** quick 会话内搜索：结果行展示文本（user_input 原文 / stdout 剥前缀取回复段）。 */
export function searchResultText(log: AgentRunLogEntry): string {
  const content = log.content_redacted ?? "";
  if (log.channel === "user_input") return content;
  const seg = classifySessionLog(content, log.channel, log.tool_kind);
  return seg?.kind === "reply" ? seg.text : content;
}

/** quick 会话内搜索：结果行渠道标签。 */
export function searchResultLabel(log: AgentRunLogEntry): string {
  if (log.channel === "user_input") return "用户";
  if (log.channel === "stdout") return "回复";
  return "日志";
}

/** quick 会话内搜索：命中高亮（简单 <mark>，首次出现、大小写不敏感）。 */
export function highlightSearchHit(text: string, term: string): ReactNode {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark data-testid="session-search-hit">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}
