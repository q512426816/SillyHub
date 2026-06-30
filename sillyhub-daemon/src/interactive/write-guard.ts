/**
 * interactive/write-guard.ts —— interactive CC 写工具白名单校验（2026-06-29）。
 *
 * 背景：claude-agent-sdk 不支持 settings JSON，但支持 canUseTool 回调拦截工具。
 * 默认 chat（enableApproval=false）原先不注入 canUseTool，CC 走 bypassPermissions
 * 写文件不受限。本模块提供纯函数 isWriteWithinAllowedRoots，被 SessionManager
 * 的 canUseTool 包装器（_wrapWithWriteGuard）调用，把写工具（Write/Edit/MultiEdit）
 * 限制在 daemon config.allowed_roots 白名单内；读工具（Read/Grep/Bash/Glob 等）不拦。
 *
 * 防穿越策略对齐 file-rpc.ts assertWithinAllowedRoots（D-002@v1）：
 *   1. pathResolve(path) 折叠 `..` / 相对段；
 *   2. 边界敏感前缀比较（`resolved === root` 或 `resolved.startsWith(root + sep)`），
 *      杜绝 /home/user 误匹配 /home/user-evil；
 *   3. Windows 盘符大小写归一（NTFS 不区分大小写）。
 *
 * 与 file-rpc.ts 的差异：本模块返回 boolean（不抛 RpcError），便于 canUseTool
 * 直接 deny；且只对「写工具」生效，读/其他工具直接 true（读自由）。
 *
 * @module interactive/write-guard
 */

import { resolve as pathResolve, sep } from 'node:path';

/**
 * Claude Code 写文件工具集合。仅这些工具的 toolInput 取 file_path/path 做白名单校验。
 * 注意：命名严格匹配 Claude CLI 工具名（Write/Edit/MultiEdit）。
 */
const WRITE_TOOLS = new Set<string>(['Write', 'Edit', 'MultiEdit']);

/**
 * 从写工具的 toolInput 提取目标路径。
 *
 * Claude CLI 工具约定：Write/Edit/MultiEdit 用 `file_path`；少数工具用 `path`。
 * 两者都读（file_path 优先），都缺失返回 null（视为无法校验 → 放行，交给内层）。
 */
function extractWritePath(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const rec = toolInput as Record<string, unknown>;
  const fp = rec['file_path'];
  if (typeof fp === 'string' && fp.length > 0) return fp;
  const p = rec['path'];
  if (typeof p === 'string' && p.length > 0) return p;
  return null;
}

/**
 * 校验一次写工具调用是否落在 allowed_roots 白名单内。
 *
 * @param toolName     Claude 工具名（Write/Edit/MultiEdit 为写工具）。
 * @param toolInput    工具入参（取 file_path / path）。
 * @param allowedRoots 白名单根目录（绝对路径数组，daemon config.allowed_roots）。
 * @returns
 *   - 非写工具（读/Bash/Grep/...）→ true（读自由，不拦）；
 *   - 写工具但取不到 path → true（无法校验，放行交内层；防御性不 deny）；
 *   - 写工具 path 落在某 root 之下（含等于 root）→ true（白名单内，allow）；
 *   - 写工具 path 越界 → false（白名单外，deny）。
 *
 * allowedRoots 为空数组 → true（视为未启用，避免配置缺失全 deny 卡死 chat；
 * SessionManager._wrapWithWriteGuard 在 roots.length===0 时已短路，这里二次兜底）。
 */
export function isWriteWithinAllowedRoots(
  toolName: string,
  toolInput: unknown,
  allowedRoots: string[],
): boolean {
  // 非写工具：读 / Bash / Grep / Glob / WebFetch ... 一律放行（读自由）。
  if (!WRITE_TOOLS.has(toolName)) return true;
  // 白名单为空：视为未启用（不 deny）。
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return true;
  const target = extractWritePath(toolInput);
  // 写工具但拿不到 path：无法校验 → 放行（交内层；防御性，正常 Claude 不会缺字段）。
  if (target === null) return true;

  const resolved = pathResolve(target);
  // Windows 平台判定：sep==='\\'（Node win32）；额外兜底盘符前缀形态。
  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(resolved);
  /** 大小写归一比较（仅 Windows；POSIX 大小写敏感不归一，与 file-rpc.ts 一致）。 */
  const under = (root: string): boolean => {
    const r = pathResolve(root);
    if (isWin) {
      const rl = r.toLowerCase();
      const dl = resolved.toLowerCase();
      if (dl === rl) return true;
      return dl.startsWith(rl + sep);
    }
    if (resolved === r) return true;
    return resolved.startsWith(r + sep);
  };
  return allowedRoots.some(under);
}
