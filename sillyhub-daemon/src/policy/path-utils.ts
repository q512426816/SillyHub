/**
 * policy/path-utils.ts —— 路径规范化纯函数（D-005）。
 *
 * Filesystem Policy Engine 的路径层。所有路径判断必须经过此模块：
 *   1. normalizePath — strip 引号 + git bash `/x/`→`X:/` + resolve 折叠 `..`
 *   2. resolveRealPath — realpath 解析 symlink/junction（存在）/ 父目录 fallback（不存在）
 *   3. isPathUnderAnyRoot — 边界敏感前缀比较（迁移自 write-guard.ts:44）
 *
 * @module policy/path-utils
 */

import { resolve as pathResolve, sep, dirname, basename, join } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

// ── 导出常量 ────────────────────────────────────────────────────────────────

/** UNC 路径前缀（Windows `\\server\share`）。 */
const UNC_PREFIX = '\\\\';

/** isPathUnderAnyRoot 返回 sentinel 常量用的特殊 UNC 标记。 */
export const UNC_REJECTED = '@@UNC_REJECTED@@';

// ── normalizePath ───────────────────────────────────────────────────────────

/**
 * 原始路径规范化。
 *
 * 步骤：
 *   1. strip 外层引号（`'...'` / `"..."`）；
 *   2. Windows git bash `/x/...` → `X:/...`（修正盘符映射）；
 *   3. `pathResolve` 折叠 `..` 段。
 *
 * @param raw 路径字符串（含可能的前导引号、git bash 斜杠等）
 * @returns 规范化后的路径
 */
export function normalizePath(raw: string): string {
  let p = raw;
  // strip 外层引号
  if (
    (p.startsWith("'") && p.endsWith("'")) ||
    (p.startsWith('"') && p.endsWith('"'))
  ) {
    p = p.slice(1, -1);
  }
  // Windows：git bash /x/... → X:/...
  if (sep === '\\') {
    const m = /^\/([a-zA-Z])\//.exec(p);
    const slash = m?.[0];
    const drive = m?.[1];
    if (slash && drive) {
      p = `${drive.toUpperCase()}:/${p.slice(slash.length)}`;
    }
  }
  return pathResolve(p);
}

// ── resolveRealPath ─────────────────────────────────────────────────────────

/**
 * 解析路径的实际文件系统位置（防 symlink/junction 绕过）。
 *
 * - 路径存在 → `fs.realpathSync.native` 解析 symlink/junction；
 * - 路径不存在 → 递归 realpath 最近存在的祖先 + 拼剩余段；
 * - Windows 盘符统一为小写（case-insensitive FS）；
 * - UNC 路径（`\\server\share`）返回 `UNC_REJECTED` 特殊标记。
 *
 * @param p 目标路径（字符串）
 * @returns 解析后的真实路径，或 UNC_REJECTED
 */
export function resolveRealPath(p: string): string {
  const normalized = normalizePath(p);

  // 拒 UNC（\\server\share）
  if (normalized.startsWith(UNC_PREFIX)) {
    return UNC_REJECTED;
  }

  try {
    // 路径存在 → realpath
    if (existsSync(normalized)) {
      const real = realpathSync.native(normalized);
      return normalizeCase(real);
    }
    // 路径不存在 → realpath 父目录 fallback
    return resolveNonExistingPath(normalized);
  } catch {
    // realpath 失败（如权限不足）→ 返回规范化路径（保守 fallback）
    return normalizeCase(normalized);
  }
}

/**
 * 对不存在的路径，逐级向上查找最近存在的祖先并 realpath。
 *
 * 示例：
 *   输入 `D:\a\b\c\new.txt`（b/c 存在，new.txt 不存在）
 *   → 祖先 `D:\a\b\c` 存在 → realpath → 拼 `new.txt`
 */
function resolveNonExistingPath(p: string): string {
  const parts: string[] = [];
  let current = p;

  // 逐级向上，直到找到一个存在的路径或到根
  while (!existsSync(current)) {
    const parent = dirname(current);
    const base = basename(current);
    if (parent === current) {
      // 到根了（Windows: D:\ → drive root; Unix: /）
      return normalizeCase(current);
    }
    parts.unshift(base);
    current = parent;
  }

  // current 是最近存在的祖先
  try {
    const realAncestor = realpathSync.native(current);
    const result = parts.length > 0 ? join(realAncestor, ...parts) : realAncestor;
    return normalizeCase(result);
  } catch {
    return normalizeCase(current);
  }
}

/**
 * Windows 盘符归一为小写（NTFS case-insensitive）。
 * Unix 不动。
 */
function normalizeCase(p: string): string {
  if (sep === '\\' && /^[A-Za-z]:/.test(p)) {
    // 用 charAt 避免 noUncheckedIndexedAccess 下 p[0] 为 string|undefined 的类型错误；
    // regex 已保证 p[0] 为字母，charAt 空串返回 "" 不影响正确性。
    return p.charAt(0).toLowerCase() + p.slice(1);
  }
  return p;
}

// ── isPathUnderAnyRoot ──────────────────────────────────────────────────────

/**
 * 校验单个路径是否落在任一 allowed_root 下（边界敏感 + Windows 大小写归一）。
 *
 * 迁移自 `write-guard.ts:44`（含 ql-20260702-007 盘符根不补 sep 修复）。
 *
 * @param target  目标路径（字符串，未规范化亦可，函数内部将规范化）
 * @param allowedRoots 白名单根目录数组（绝对路径）
 * @returns true 当目标路径在任一 allowedRoot 下
 */
export function isPathUnderAnyRoot(target: string, allowedRoots: string[]): boolean {
  // D-001@v1 / task-02：比较前对 target 与每个 root 调 resolveRealPath（realpath + 盘符小写），
  // 下沉到判定层防 symlink/junction/borrow root 绕过；不在 PolicyCache.set 存（与 task-01 配合）。
  // resolveRealPath 内部已 normalizePath + normalizeCase + UNC 标记 + 不存在 fallback。
  const resolved = resolveRealPath(target);

  // 若 target 是 UNC（resolveRealPath 返回 UNC_REJECTED）→ 拒（不落在任何 root 下）
  if (resolved === UNC_REJECTED) return false;

  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(resolved);
  return allowedRoots.some((root) => {
    const r = resolveRealPath(root);
    // root 经 resolveRealPath 后若为 UNC_REJECTED，此 root 无法匹配任何 target
    if (r === UNC_REJECTED) return false;
    if (isWin) {
      const rl = r.toLowerCase();
      const dl = resolved.toLowerCase();
      // ql-20260702-007：root 已含尾部 sep（盘符根 D:\ / Unix 根 /）时不再补 sep，
      // 否则 rl+sep 产生 "D:\\" 或 "//" 双分隔符前缀，dl.startsWith 永远 false → 误 deny。
      // realpath 后同样的值走同样的 prefix 比较逻辑，未破坏尾 sep 不变量。
      const prefix = rl.endsWith(sep) ? rl : rl + sep;
      return dl === rl || dl.startsWith(prefix);
    }
    const prefix = r.endsWith(sep) ? r : r + sep;
    return resolved === r || resolved.startsWith(prefix);
  });
}
