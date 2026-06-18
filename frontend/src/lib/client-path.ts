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

/**
 * 在 base 下拼接子路径名，并规范化结果。
 */
export function joinClientPath(base: string, name: string): string {
  if (!base) return normalizeClientPath(name);
  const norm = normalizeClientPath(base);
  const sep = isWindowsAbsPath(norm) ? "\\" : "/";
  const suffix = norm.endsWith(sep) ? "" : sep;
  return normalizeClientPath(`${norm}${suffix}${name}`);
}

/**
 * 返回父目录路径；已是根时返回原路径。
 */
export function parentClientPath(path: string): string {
  const norm = normalizeClientPath(path);
  if (!norm) return norm;
  if (isWindowsAbsPath(norm)) {
    const m = /^([A-Za-z]:)(\\.*)?$/.exec(norm);
    if (!m) return norm;
    const drive = m[1]!;
    const rest = (m[2] ?? "").replace(/^\\/, "");
    if (!rest) return `${drive}\\`;
    const parts = rest.split("\\").filter(Boolean);
    parts.pop();
    return parts.length ? `${drive}\\${parts.join("\\")}` : `${drive}\\`;
  }
  const leading = norm.startsWith("/");
  const parts = norm.split("/").filter(Boolean);
  parts.pop();
  if (!parts.length) return leading ? "/" : norm;
  return (leading ? "/" : "") + parts.join("/");
}
