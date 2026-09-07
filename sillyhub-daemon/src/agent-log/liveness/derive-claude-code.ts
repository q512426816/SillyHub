/**
 * `agent-log/liveness/derive-claude-code.ts` —— claude-code transcript L1 推导器。
 *
 * task-11（2026-09-07-agent-liveness-states / FR-04 + D-002@v1）：**E-01 已证伪
 * 定稿（2026-09-07 spike-02，160 个最近 transcript 扫描）**——claude transcript
 * 顶层记录类型清单（assistant/user/attachment/queue-operation/last-prompt/mode/
 * ai-title/file-history-snapshot/system/permission-mode/file-history-delta）无
 * 「等待审批」事件类型（`permission-mode` 仅模式切换；审批结果/拒绝零记录），
 * 等人瞬间不落 transcript（与 zcode E-03 同构）→ **只实现 working/idle，blocked
 * 分支关闭**（D-002@v1 处置；blocked 唯一来源是 daemon 第一方 PERMISSION_REQUEST，
 * D-012，由 task-06 推送侧覆写——日志推导侧全线不承诺 blocked）。
 *
 * 规则：末 assistant 含 `tool_use` 无配对 `tool_result`（user 行 tool_use_id
 * 差分）→ working；末 assistant 纯文本（无未配对 tool_use）→ idle；无 assistant
 * 事件（attachment/system 等辅助行）→ unknown。纯函数约束同 types.ts。
 *
 * @module agent-log/liveness/derive-claude-code
 */

import type { LivenessDeriver } from './types.js';

/** transcript 行的最小解析视图（顶层 type + message.content 数组）。 */
interface TranscriptLine {
  type?: unknown;
  content?: unknown;
}

function parseLine(raw: string): TranscriptLine | null {
  try {
    const r = JSON.parse(raw) as { type?: unknown; message?: { content?: unknown } };
    if (r?.type !== 'assistant' && r?.type !== 'user') return null;
    return { type: r.type, content: (r as { message?: { content?: unknown } }).message?.content };
  } catch {
    return null;
  }
}

/** content 数组提取（字符串 content 视为纯文本无块）。 */
function contentBlocks(content: unknown): Array<Record<string, unknown>> {
  return Array.isArray(content) ? (content.filter((c) => c && typeof c === 'object') as Array<Record<string, unknown>>) : [];
}

/** claude L1 推导：tool_use 未配对 → working；纯文本回合结束 → idle；其余 unknown。 */
export const deriveClaudeCode: LivenessDeriver = ({ tail }) => {
  const lines = tail.split('\n');
  /** 更末位置已消解的 tool_use id（user 行 tool_result.tool_use_id）。 */
  const resolvedIds = new Set<string>();
  let lastAssistantText = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    const line = parseLine(trimmed);
    if (!line) continue;
    const blocks = contentBlocks(line.content);
    if (line.type === 'user') {
      for (const b of blocks) {
        if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') {
          resolvedIds.add(b['tool_use_id']);
        }
      }
      continue;
    }
    // assistant 行：自尾向首遇到的第一条即判定依据
    const toolUses = blocks.filter((b) => b['type'] === 'tool_use');
    const unresolved = toolUses.filter(
      (b) => typeof b['id'] !== 'string' || !resolvedIds.has(b['id'] as string),
    );
    if (unresolved.length > 0) {
      return { state: 'working', evidence: 'tooluse_pending' };
    }
    lastAssistantText = blocks.some((b) => b['type'] === 'text') || blocks.length === 0;
    if (lastAssistantText) {
      return { state: 'idle', evidence: 'assistant_text' };
    }
    return { state: 'unknown', evidence: 'assistant_other' };
  }
  return { state: 'unknown', evidence: 'empty_tail' };
};
