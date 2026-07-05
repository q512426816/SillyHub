// src/tool-kind.ts
// 与 backend/app/modules/agent/tool_kind.py 保持同逻辑，单测用例共享，修改须同步（R-05 防漂移）。
// design.md §7 TypeScript classifyToolKind 逐字参照；判定顺序与 Python 版完全一致。

export const TOOL_KIND_VALUES = [
  'sillyspec', 'skill', 'bash', 'read', 'write',
  'search', 'task', 'web', 'todo', 'plan',
  'ask', 'schedule', 'mcp', 'other',
] as const;
export type ToolKind = typeof TOOL_KIND_VALUES[number];

/**
 * 从 toolName + args 推导 tool_kind。
 *
 * Returns:
 *   TOOL_KIND_VALUES 之一，或 null（非工具调用 / toolName 缺失）。
 */
export function classifyToolKind(
  toolName: string | undefined | null,
  args: Record<string, unknown> | undefined,
): ToolKind | null {
  if (!toolName) return null;
  const name = toolName.toLowerCase();
  if (name === 'bash') {
    const cmd = String((args as { command?: unknown } | undefined)?.command ?? '');
    return cmd.includes('sillyspec') ? 'sillyspec' : 'bash';
  }
  if (name === 'skill') return 'skill';
  if (name === 'read') return 'read';
  if (['write', 'edit', 'multiedit', 'notebookedit'].includes(name)) return 'write';
  if (['grep', 'glob'].includes(name)) return 'search';
  if (['task', 'agent'].includes(name)) return 'task';
  if (['websearch', 'webfetch'].includes(name)) return 'web';
  if (['todowrite', 'taskcreate', 'taskupdate', 'taskget', 'tasklist'].includes(name)) return 'todo';
  if (name === 'exitplanmode') return 'plan';
  if (name === 'askuserquestion') return 'ask';
  if (name.startsWith('cron') || name === 'schedulewakeup') return 'schedule';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}
