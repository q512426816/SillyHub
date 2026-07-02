/**
 * interactive/write-guard.ts —— interactive CC 写工具白名单校验（2026-06-29）。
 *
 * 背景：claude-agent-sdk 不支持 settings JSON，但支持 canUseTool 回调拦截工具。
 * 默认 chat（enableApproval=false）原先不注入 canUseTool，CC 走 bypassPermissions
 * 写文件不受限。本模块提供纯函数 isWriteWithinAllowedRoots，被 SessionManager
 * 的 canUseTool 包装器（_wrapWithWriteGuard）调用，把写工具（Write/Edit/MultiEdit
 * + Bash 间接写）限制在 daemon config.allowed_roots 白名单内；读工具不拦。
 *
 * ql-20260702-006：补 Bash 写检测——CC 用 `echo > D:\file` / `cp` / `tee` 等
 * 间接写文件完全绕过白名单（原 WRITE_TOOLS 只有 Write/Edit/MultiEdit）。
 *
 * 防穿越策略对齐 file-rpc.ts assertWithinAllowedRoots（D-002@v1）：
 *   1. pathResolve(path) 折叠 `..` / 相对段；
 *   2. 边界敏感前缀比较（`resolved === root` 或 `resolved.startsWith(root + sep)`）；
 *   3. Windows 盘符大小写归一（NTFS 不区分大小写）。
 *
 * @module interactive/write-guard
 */

import { resolve as pathResolve, sep } from 'node:path';

/**
 * Claude Code 显式写文件工具集合。Bash 单独处理（间接写）。
 */
const WRITE_TOOLS = new Set<string>(['Write', 'Edit', 'MultiEdit']);

/**
 * 从写工具的 toolInput 提取目标路径（file_path / path）。
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
 * 校验单个路径是否落在任一 allowed_root 下（边界敏感 + Windows 大小写归一）。
 */
function isPathUnderAnyRoot(target: string, allowedRoots: string[]): boolean {
  const resolved = pathResolve(target);
  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(resolved);
  return allowedRoots.some((root) => {
    const r = pathResolve(root);
    if (isWin) {
      const rl = r.toLowerCase();
      const dl = resolved.toLowerCase();
      return dl === rl || dl.startsWith(rl + sep);
    }
    return resolved === r || resolved.startsWith(r + sep);
  });
}

/**
 * ql-20260702-006：从 Bash 命令提取写操作的目标路径。
 *
 * 覆盖常见写模式：重定向（>/>>）、cp/mv/install 目标、tee、mkdir、touch。
 * 不做完整 shell AST（正则覆盖常见模式，足够拦截绝大多数间接写）。
 */
function extractBashWritePaths(command: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;

  // 1. 重定向 > / >>（排除 2>&1 / >&2 等文件描述符）
  const redirRe = /(?:>>|>)\s*(\S+)/g;
  while ((m = redirRe.exec(command)) !== null) {
    const target = m[1];
    if (target && !/^&\d/.test(target)) paths.push(target);
  }
  // 2. cp/mv/install src... dst（取最后参数为目标）
  const cpRe = /\b(?:cp|mv|install)\s+(?:-[^\s]+\s+)*(\S+)\s+(\S+)/g;
  while ((m = cpRe.exec(command)) !== null) {
    const dst = m[2];
    if (dst) paths.push(dst);
  }
  // 3. tee [-options] path
  const teeRe = /\btee\s+(?:-[^\s]+\s+)*(\S+)/g;
  while ((m = teeRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(target);
  }
  // 4. mkdir/touch [-options] path
  const mkRe = /\b(?:mkdir|touch)\s+(?:-[^\s]+\s+)*(\S+)/g;
  while ((m = mkRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(target);
  }
  return paths;
}

/**
 * 校验一次工具调用是否落在 allowed_roots 白名单内。
 *
 * @param toolName     Claude 工具名。
 * @param toolInput    工具入参。
 * @param allowedRoots 白名单根目录（绝对路径数组）。
 * @returns
 *   - 非写工具（读/Grep/Glob/...）→ true（读自由）；
 *   - Bash 纯读命令 → true；Bash 含写但目标全在白名单 → true；否则 false；
 *   - Write/Edit/MultiEdit 路径在白名单 → true，否则 false；
 *   - allowedRoots 空 → true（未启用）。
 */
export function isWriteWithinAllowedRoots(
  toolName: string,
  toolInput: unknown,
  allowedRoots: string[],
): boolean {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return true;

  // ql-20260702-006：Bash 间接写检测
  if (toolName === 'Bash') {
    const command = (toolInput as { command?: unknown })?.command;
    if (typeof command !== 'string' || command.length === 0) return true;
    const writePaths = extractBashWritePaths(command);
    if (writePaths.length === 0) return true; // 纯读命令，放行
    // 有写操作 → 每个目标路径都必须在白名单内
    return writePaths.every((p) => isPathUnderAnyRoot(p, allowedRoots));
  }

  // Write/Edit/MultiEdit：取 file_path/path 校验
  if (!WRITE_TOOLS.has(toolName)) return true;
  const target = extractWritePath(toolInput);
  if (target === null) return true;
  return isPathUnderAnyRoot(target, allowedRoots);
}
