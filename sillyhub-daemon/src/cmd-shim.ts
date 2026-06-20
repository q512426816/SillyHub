/**
 * ql-20260618-007：Windows npm/cmd-shim .cmd 包装解析器。
 *
 * 背景：codex.cmd / claude.cmd 等 npm 全局 bin 在 Windows 上由 cmd-shim 包生成，
 * 内容形如：
 *   - codex.cmd（node + js）：`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`
 *   - claude.cmd（原生 exe）：`"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`
 *
 * Node child_process.spawn(cmd.cmd, args, {shell:true}) 在不同 shell 环境下行为不一致：
 *   - git-bash 启动 node 时 → spawn C:\WINDOWS\system32\cmd.exe ENOENT
 *   - PowerShell 启动 → 可能启动但 stdout 被包装层吞掉
 *
 * 解决：daemon 直接 read .cmd 文件，提取真实 exe + target，用 spawn(exe, [target, ...args])
 * 不依赖 shell。%_prog% 变量在 cmd-shim 里运行时设为 node 或 %dp0%\node.exe，这里
 * 静态解析时优先用 %dp0%\node.exe（nvm4w 全局目录通常带 node.exe），fallback 到
 * process.execPath。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveCursorVersionEntry } from './cursor-version.js';

/**
 * 解析 Windows .cmd 包装文件，返回真实可执行命令。
 *
 * @param cmdPath .cmd 文件绝对路径
 * @returns 解析成功 { exe, prependArgs }；非 Windows / 读失败 / 无匹配 → null
 *          - exe: 真实可执行文件路径（node.exe 或 claude.exe 等）
 *          - prependArgs: exe 后续固定的位置参数（codex.js 路径等），调用方需把
 *            adapter.buildArgs() 的结果追加在 prependArgs 之后
 */
export function resolveWindowsCmdShim(cmdPath: string): {
  exe: string;
  prependArgs: string[];
} | null {
  if (process.platform !== 'win32') return null;

  let content: string;
  try {
    content = readFileSync(cmdPath, 'utf-8');
  } catch {
    return null;
  }

  const dp0 = dirname(cmdPath);
  const scriptDir = dp0.replace(/[\\/]+$/, '');
  const expand = (s: string): string =>
    s
      .replace(/%dp0%/gi, dp0)
      .replace(/%SCRIPT_DIR%/gi, scriptDir);

  const flat = content.replace(/\r?\n/g, ' ');

  // 模式 0：PowerShell -File 包装（cursor-agent.cmd 等自定义安装脚本）。
  // 例：powershell.exe ... -File "%SCRIPT_DIR%\cursor-agent.ps1" %*
  const m0 =
    /powershell(?:\.exe)?[^%]*-File\s+"([^"]+)"\s+%\*/i.exec(flat) ??
    /-File\s+"([^"]+)"\s+%\*/i.exec(flat);
  if (m0) {
    const ps1 = expand(m0[1]!);
    // ql-20260620-002-f8c1：cursor-agent.cmd 调用的 cursor-agent.ps1 因版本目录正则
    // （^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$）不匹配新版目录命名 YYYY.MM.DD-HH-MM-SS-commit
    // 而整体 exit 1，spawn ps1 必崩 → cursor task 启动即失败。若 ps1 同目录存在
    // versions/<latest>/（cursor 自更新结构），直接绕过 ps1 返回 version 目录的 node.exe +
    // index.js 入口，让 task-runner spawn `node.exe index.js <args>`（ps1 本就这么调，只是
    // 它自己找不到目录）。无 versions/ 或缺 node.exe/index.js → 回落原 powershell 行为。
    const cursorEntry = resolveCursorVersionEntry(ps1);
    if (cursorEntry) {
      return {
        exe: cursorEntry.nodeExe,
        prependArgs: [cursorEntry.indexJs],
      };
    }
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const exe = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return {
      exe,
      prependArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    };
  }

  // cmd-shim 的 codex.cmd 用 `endLocal & goto ... & "%_prog%" "..." %*` 单行混合模式，
  // 不能简单按行首关键字跳过。改为：在全文里全局搜索包含 %* 的双引号命令模式。
  //
  // 模式 1：node + js 模式（codex.cmd）—— "%_prog%"  "...\codex.js" %*
  const m1 = /"%_prog%"\s+"([^"]+)"\s+%\*/.exec(content)
    ?? /"([^"]+)"\s+"([^"]+)"\s+%\*/.exec(content);
  if (m1) {
    const target = expand(m1[1]!);
    const localNode = `${dp0}\\node.exe`;
    const exe = existsSync(localNode) ? localNode : process.execPath;
    return { exe, prependArgs: [target] };
  }

  // 模式 2：原生 exe 模式（claude.cmd）—— "%dp0%\...\claude.exe"   %*
  const m2 = /"([^"]+)"\s+%\*/.exec(content);
  if (m2) {
    const exe = expand(m2[1]!);
    if (!/%[A-Za-z0-9_]+%/.test(exe)) {
      return { exe, prependArgs: [] };
    }
  }

  return null;
}
