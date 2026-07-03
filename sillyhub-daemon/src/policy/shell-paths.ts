/**
 * policy/shell-paths.ts —— Shell 命令写路径提取器（task-03 / FR-04）。
 *
 * 从 Bash / PowerShell / CMD 命令字符串中尽力提取写操作目标路径，返回 `string[]`，
 * 交 PolicyEngine 逐条 `canWrite` 校验。
 *
 * 设计原则（D-001 尽力而为）：
 *   - 仅正则覆盖常见写模式，不做完整 shell AST；
 *   - `eval` / 变量展开 / 反引号等无法静态解析的复杂命令，提取结果可能为空，
 *     靠 audit 追溯兜底（D-001），不抛错；
 *   - 路径提取为纯字符串解析，不碰 fs。
 *
 * 来源：
 *   - Bash 部分迁自 interactive/write-guard.ts 的 `extractBashWritePaths`
 *     + `normalizeBashWritePath`（task-15 才删 write-guard.ts，本文件不修改它）；
 *   - PowerShell / CMD 为 task-03 新增。
 *
 * @module policy/shell-paths
 */

import { sep } from 'node:path';

/** 支持的 shell 类型。 */
export type ShellKind = 'bash' | 'powershell' | 'cmd';

/** 去外层引号（`'...'` / `"..."`），shell 通用。 */
function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 简易 Bash 分词：考虑单/双引号；返回 token 数组（保留引号，
 * 由调用方按需 strip）。开关 token（`-x`）会被吞掉且不进入位置参数列表。
 */
function tokenizeShell(rest: string): string[] {
  return rest.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
}

/**
 * 取 Bash 命令尾段的最后一个位置参数（跳过 `-x` 开关）。
 * 用于 cp/mv/install 的多源 → 单 dst 取目标。
 */
function lastBashPositional(rest: string): string | undefined {
  const tokens = tokenizeShell(rest);
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    if (tok.startsWith('-')) continue; // 开关跳过
    positional.push(tok);
  }
  const last = positional[positional.length - 1];
  return last !== undefined ? stripQuotes(last) : undefined;
}

/**
 * ql-20260702-009（迁自 write-guard.ts）：归一化 Bash 命令提取的写路径。
 *
 * - 剥离外层引号（重定向目标可能带 `'...'` / `"..."`）；
 * - Windows：git bash `/x/...` → `X:/...`（修正 Node pathResolve 的盘符映射，
 *   避免 `/e/file` 被 resolve 成 `F:\e\file` 误判 allow 而实际写 `E:\file` 越界）；
 * - Linux：`/x/` 是真 Unix 路径，不动。
 */
function normalizeBashWritePath(raw: string): string {
  const p = stripQuotes(raw);
  // Windows：git bash /x/... → X:/...（修正盘符映射）
  if (sep === '\\') {
    const m = /^\/([a-zA-Z])\//.exec(p);
    const slash = m?.[0];
    const drive = m?.[1];
    if (slash && drive) {
      return `${drive.toUpperCase()}:/${p.slice(slash.length)}`;
    }
  }
  return p;
}

/**
 * 从 Bash 命令提取写操作目标路径（迁自 write-guard.ts）。
 *
 * 覆盖：重定向 `>`/`>>`（排除 `2>&1`/`>&2` 等文件描述符）、`cp`/`mv`/`install`
 * 目标（取最后位置参数）、`tee`、`mkdir`、`touch`。
 */
export function extractBashWritePaths(command: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;

  // 1. 重定向 > / >>（排除 2>&1 / >&2 等文件描述符）。目标支持带引号路径（含空格）。
  const redirRe = /(?:>>|>)\s*("[^"]*"|'[^']*'|\S+)/g;
  while ((m = redirRe.exec(command)) !== null) {
    const target = m[1];
    if (target && !/^&\d/.test(target)) paths.push(stripQuotes(target));
  }
  // 2. cp/mv/install src... dst（支持多源参数；跳过开关；取最后位置参数为目标）
  //    先吞掉所有形如 `-x` 的开关与普通 token，最后剩下的位置参数即 dst。
  const cpRe = /\b(?:cp|mv|install)\b\s+([^|;&]*)/g;
  while ((m = cpRe.exec(command)) !== null) {
    const rest = m[1];
    if (!rest) continue;
    const dst = lastBashPositional(rest);
    if (dst) paths.push(dst);
  }
  // 3. tee [-options] path（支持带引号路径）
  const teeRe = /\btee\s+(?:-[^\s]+\s+)*("[^"]*"|'[^']*'|\S+)/g;
  while ((m = teeRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(stripQuotes(target));
  }
  // 4. mkdir/touch [-options] path（支持带引号路径）
  const mkRe = /\b(?:mkdir|touch)\s+(?:-[^\s]+\s+)*("[^"]*"|'[^']*'|\S+)/g;
  while ((m = mkRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(stripQuotes(target));
  }
  // 归一化（git bash /x/ → X:/ + strip 引号）
  return paths.map(normalizeBashWritePath);
}

/**
 * 从 PowerShell 命令提取写操作目标路径（task-03 新增）。
 *
 * 覆盖 cmdlet：`Set-Content` / `Add-Content` / `Out-File` /
 * `New-Item -ItemType File` / `Copy-Item` / `Move-Item` / `Rename-Item` /
 * `Remove-Item`。优先取 `-Path`/`-FilePath`/`-Destination`/`-Target`/
 * `-NewName` 命名参数，否则取第一个位置参数。
 */
export function extractPowerShellWritePaths(command: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;

  // 重定向 > / >>（PowerShell 也支持，且可与管道叠加）
  const redirRe = /(?:>>|>)\s*("[^"]*"|'[^']*'|\S+)/g;
  while ((m = redirRe.exec(command)) !== null) {
    const target = m[1];
    if (target && !/^&\d/.test(target)) paths.push(stripQuotes(target));
  }

  // Set-Content / Add-Content / Out-File：取 -Path/-FilePath，否则首个位置参数
  const contentRe = /\b(Set-Content|Add-Content|Out-File)\b([^|;]*)/gi;
  while ((m = contentRe.exec(command)) !== null) {
    const rest = m[2] ?? '';
    const named = parsePsNamedArgs(rest);
    const picked = named['path'] ?? named['filepath'] ?? firstPositional(rest);
    if (picked) paths.push(picked);
  }

  // New-Item：-ItemType 为 File/Directory（或缺省保守按文件写）时取 -Path/位置参数
  const newRe = /\bNew-Item\b([^|;]*)/gi;
  while ((m = newRe.exec(command)) !== null) {
    const rest = m[1] ?? '';
    const named = parsePsNamedArgs(rest);
    const type = named['itemtype'];
    if (!type || /file|directory/i.test(type)) {
      const picked = named['path'] ?? firstPositional(rest);
      if (picked) paths.push(picked);
    }
  }

  // Copy-Item / Move-Item：取 -Destination，否则末位置参数
  const cmRe = /\b(Copy-Item|Move-Item)\b([^|;]*)/gi;
  while ((m = cmRe.exec(command)) !== null) {
    const rest = m[2] ?? '';
    const named = parsePsNamedArgs(rest);
    const dst = named['destination'] ?? lastPositional(rest);
    if (dst) paths.push(dst);
  }

  // Rename-Item：取 -Target 或 -NewName，否则末位置参数
  const rnRe = /\bRename-Item\b([^|;]*)/gi;
  while ((m = rnRe.exec(command)) !== null) {
    const rest = m[1] ?? '';
    const named = parsePsNamedArgs(rest);
    const picked = named['target'] ?? named['newname'] ?? lastPositional(rest);
    if (picked) paths.push(picked);
  }

  // Remove-Item：取 -Path，否则首个位置参数
  const rmRe = /\bRemove-Item\b([^|;]*)/gi;
  while ((m = rmRe.exec(command)) !== null) {
    const rest = m[1] ?? '';
    const named = parsePsNamedArgs(rest);
    const picked = named['path'] ?? firstPositional(rest);
    if (picked) paths.push(picked);
  }

  return dedupe(paths);
}

/**
 * 解析 PowerShell 命令尾段中的命名参数值（`-Name value` / `-Name:value`）。
 * 覆盖 Path/FilePath/Destination/Target/NewName/ItemType。值已去外层引号。
 */
function parsePsNamedArgs(
  rest: string,
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  const names = ['Path', 'FilePath', 'Destination', 'Target', 'NewName', 'ItemType'];
  for (const name of names) {
    const re = new RegExp(
      `-${name}(?::|\\s)+("([^"]*)"|'([^']*)'|([^\\s'"|;]+))`,
      'i',
    );
    const m = re.exec(rest);
    if (!m) continue;
    const val = m[2] ?? m[3] ?? m[4];
    if (val) out[name.toLowerCase()] = stripQuotes(val);
  }
  return out;
}

/** 取首个位置参数（跳过 `-Name value` 形参与裸开关）。 */
function firstPositional(rest: string): string | undefined {
  const tokens = tokenizeSkippingNamed(rest);
  return tokens[0];
}

/** 取最后一个位置参数（跳过 `-Name value` 形参与裸开关）。 */
function lastPositional(rest: string): string | undefined {
  const tokens = tokenizeSkippingNamed(rest);
  return tokens[tokens.length - 1];
}

/**
 * 分词并丢弃命名参数（`-Name value`）与裸开关（`-Force`），仅保留位置参数。
 * 通用，Bash/PowerShell/CMD 均可用（值已去外层引号）。
 */
function tokenizeSkippingNamed(rest: string): string[] {
  const raw = rest.match(/"[^"]*"|'[^']*'|[^\s'"|;]+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    if (tok === undefined) continue;
    if (/^-[A-Za-z]/.test(tok)) {
      // 命名参数；若下一 token 不是新参数，视为该参数的值并跳过
      const nxt = raw[i + 1];
      if (nxt !== undefined && !nxt.startsWith('-')) {
        i++;
      }
      continue;
    }
    out.push(stripQuotes(tok));
  }
  return out;
}

/**
 * 从 CMD 命令提取写操作目标路径（task-03 新增）。
 *
 * 覆盖：`copy src dst` / `move src dst` / `mkdir dir` / `echo ... > file` /
 * `type src > file` / `del file`。
 */
export function extractCmdWritePaths(command: string): string[] {
  const paths: string[] = [];

  // 重定向 > / >>（排除文件描述符）；目标支持带引号路径
  const redirRe = /(?:>>|>)\s*("[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = redirRe.exec(command)) !== null) {
    const target = m[1];
    if (target && !/^&\d/.test(target)) paths.push(stripQuotes(target));
  }

  // copy/move src dst（取最后位置参数，跳过开关）
  const cmRe =
    /\b(?:copy|move)\s+(?:\/[^\s]+\s+)*("[^"]*"|'[^']*'|\S+)\s+("[^"]*"|'[^']*'|\S+)/gi;
  while ((m = cmRe.exec(command)) !== null) {
    const dst = m[2];
    if (dst) paths.push(stripQuotes(dst));
  }

  // mkdir dir
  const mkRe = /\bmkdir\s+(?:\/[^\s]+\s+)*("[^"]*"|'[^']*'|\S+)/gi;
  while ((m = mkRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(stripQuotes(target));
  }

  // del file
  const delRe = /\bdel\s+(?:\/[^\s]+\s+)*("[^"]*"|'[^']*'|\S+)/gi;
  while ((m = delRe.exec(command)) !== null) {
    const target = m[1];
    if (target) paths.push(stripQuotes(target));
  }

  return dedupe(paths);
}

/** 保序去重。 */
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * 统一入口：按 shell 类型分派到对应提取器。
 *
 * @param command 命令字符串。
 * @param shell   shell 类型。
 * @returns 写目标路径数组（纯读命令或不可解析时为空数组，不抛错）。
 */
export function extractShellWritePaths(
  command: string,
  shell: ShellKind,
): string[] {
  switch (shell) {
    case 'bash':
      return extractBashWritePaths(command);
    case 'powershell':
      return extractPowerShellWritePaths(command);
    case 'cmd':
      return extractCmdWritePaths(command);
  }
}
