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
function isSillyspecCommand(cmd: string): boolean {
  // ql-20260705-006 (C3)：与 Python _is_sillyspec_command 同逻辑（R-05 防漂移）。
  // command 任一段（&&/;/|）主命令是 sillyspec 才归，排除脚本内容/grep 含字样误归
  // （推翻 D-001 子串语义——DB 实测 41 条 sillyspec 里 34 条 83% 误归）。
  let seg = cmd;
  for (const sep of ['&&', ';', '|']) {
    seg = seg.split(sep).join('\n');
  }
  for (const line of seg.split('\n')) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    let idx = 0;
    while (
      idx < parts.length - 1
      && ['pnpm', 'npx', 'yarn', 'sudo', 'node'].includes(parts[idx]!)
    ) {
      idx++;
    }
    if (parts[idx] === 'sillyspec') return true;
  }
  return false;
}

export function classifyToolKind(
  toolName: string | undefined | null,
  args: Record<string, unknown> | undefined,
): ToolKind | null {
  if (!toolName) return null;
  const name = toolName.toLowerCase();
  if (name === 'bash') {
    const rawCmd = (args as { command?: unknown } | undefined)?.command;
    const cmd = typeof rawCmd === 'string' ? rawCmd : '';
    return isSillyspecCommand(cmd) ? 'sillyspec' : 'bash';
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
