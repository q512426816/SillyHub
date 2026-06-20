/**
 * cursor-version.ts —— cursor-agent 版本目录解析器（绕过坏掉的官方 ps1）。
 *
 * 背景：cursor-agent 官方安装在 %LOCALAPPDATA%\cursor-agent\，目录结构：
 *   cursor-agent.cmd / cursor-agent.ps1           ← 启动包装（.cmd 调 .ps1）
 *   versions/<ver>/node.exe + index.js + ...      ← 各版本运行时（自更新机制）
 *
 * 官方 cursor-agent.ps1:48 用正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找最新版本目录，
 * 但新版 cursor 的目录名是 `YYYY.MM.DD-HH-MM-SS-commit`（含时分秒、多段 `-`），
 * `-` 后并非纯十六进制 → 不匹配 → ps1 `Write-Error "No version directories found"` + exit 1。
 * 该查找在 `$args` 之前执行、与参数无关，导致 cursor-agent 任何调用都崩：
 *   - 版本探测：daemon 跑 `cursor-agent --version` → exit 1 → version=null → 注册 'unknown'
 *     → 前端版本「待识别」。
 *   - task 执行：task-runner 经 resolveWindowsCmdShim 落到 spawn(powershell cursor-agent.ps1)
 *     → 同样 exit 1 → cursor task 启动即崩。
 *
 * 本模块绕过坏掉的 ps1：直接扫描 versions/ 目录取最新版本目录，返回其 node.exe + index.js
 * 入口 + 版本号，供
 *   - agent-detector（cursor 版本探测 fallback，见 detectVersion）
 *   - cmd-shim（resolveWindowsCmdShim 模式0 增强：cursor-agent.ps1 → 直接返回 version 目录的
 *     node 入口，让 task-runner spawn `node.exe index.js <args>` 绕过 ps1）
 * 共用。ps1 的 `node.exe index.js $args` 调法本身正确，只是它自己找不到目录。
 *
 * 兼容两种目录命名：
 *   - 新格式：YYYY.MM.DD-HH-MM-SS-commit（如 2026.06.16-20-30-07-a07d3ac）
 *   - 旧格式：YYYY.MM.DD-commit            （如 2026.06.15-6f5a2cf）
 * 排序：YYYY.MM.DD 前缀转 yyyymmdd 数值降序；同日按完整目录名字典序降序（时分秒字典序=时间序），
 * 取第一个即最新。
 *
 * @see ql-20260620-002-f8c1
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** cursor 版本目录解析结果。 */
export interface CursorVersionEntry {
  /** 版本目录绝对路径（versions/<version>）。 */
  readonly versionDir: string;
  /** 版本目录内打包的 node 运行时（<versionDir>/node.exe）。 */
  readonly nodeExe: string;
  /** 版本目录内入口脚本（<versionDir>/index.js）。 */
  readonly indexJs: string;
  /** 版本号（目录名原样，如 2026.06.16-20-30-07-a07d3ac）。 */
  readonly version: string;
}

/**
 * 版本目录名前缀正则：YYYY.MM.DD（仅匹配前缀，兼容新旧 `-xxx` 后缀格式）。
 * 不校验后缀（旧 commit / 新时分秒+commit 都允许），靠后续排序取最新。
 */
const VERSION_PREFIX_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/;

/**
 * 把版本目录名转成可比较的排序键 `[yyyymmdd 数值, 完整目录名]`。
 * 日期相同（同日多版本）时用完整目录名字典序，时分秒部分字典序即时间序。
 */
function versionSortKey(name: string): [number, string] {
  const m = VERSION_PREFIX_RE.exec(name);
  if (!m) return [0, name];
  const y = m[1]!;
  const mo = m[2]!.padStart(2, '0');
  const d = m[3]!.padStart(2, '0');
  return [Number(`${y}${mo}${d}`), name];
}

/**
 * 解析 cursor-agent 的版本目录，返回最新版本的 node 入口。
 *
 * @param cmdOrDir cursor-agent.cmd / cursor-agent.ps1 路径，或其所在目录；
 *                 函数自动定位该目录下的 `versions/` 子目录。
 * @returns 最新版本入口；任一环节缺失（无 versions/ / 无匹配目录 / 缺 node.exe 或 index.js）
 *          → 返回 null，调用方回落原行为（如 cmd-shim 回落 spawn powershell ps1）。
 *          任何 fs 异常（权限/符号链接断裂）也返回 null，不抛错。
 */
export function resolveCursorVersionEntry(cmdOrDir: string): CursorVersionEntry | null {
  // 输入可能是 .cmd/.ps1 文件路径，也可能是目录；统一取到 baseDir。
  let baseDir: string;
  try {
    const st = statSync(cmdOrDir);
    baseDir = st.isDirectory() ? cmdOrDir : dirname(cmdOrDir);
  } catch {
    // 路径不可 stat（不存在/无权限）：当目录路径处理，dirname 兜底。
    baseDir = dirname(cmdOrDir);
  }

  const versionsDir = join(baseDir, 'versions');
  if (!existsSync(versionsDir)) return null;

  let names: string[];
  try {
    names = readdirSync(versionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && VERSION_PREFIX_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  // 降序排序：最新在前。日期不同按日期；同日按完整名（时分秒）字典序。
  names.sort((a, b) => {
    const [ka, na] = versionSortKey(a);
    const [kb, nb] = versionSortKey(b);
    if (ka !== kb) return kb - ka;
    return nb.localeCompare(na);
  });

  const version = names[0]!;
  const versionDir = join(versionsDir, version);
  const nodeExe = join(versionDir, 'node.exe');
  const indexJs = join(versionDir, 'index.js');
  // 缺关键入口文件 → 视为不完整，返回 null（回落原 ps1 行为，比 spawn 半残入口更安全）。
  if (!existsSync(nodeExe) || !existsSync(indexJs)) return null;

  return { versionDir, nodeExe, indexJs, version };
}
