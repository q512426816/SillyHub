/**
 * 客户端路径规范化（daemon 机器上的绝对路径）。
 * Windows 盘符路径统一为反斜杠；POSIX 路径统一为正斜杠。
 */

function isWindowsAbsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * 将混用斜杠的路径规范为平台一致的分隔符。
 */
export function normalizeClientPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (isWindowsAbsPath(trimmed)) {
    const collapsed = trimmed.replace(/\//g, "\\");
    return collapsed.replace(/\\+/g, "\\");
  }
  return trimmed.replace(/\\/g, "/");
}
