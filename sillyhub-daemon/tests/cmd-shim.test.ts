// tests/cmd-shim.test.ts
// ql-20260618-007：Windows .cmd 包装解析器测试。
// fixture：直接 inline 模拟 cmd-shim 生成的 .cmd 文件内容（codex / claude 两种格式）。

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWindowsCmdShim } from '../src/cmd-shim';

/** 在临时目录创建一个 .cmd 文件，返回完整路径。 */
function makeCmd(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cmd-shim-test-'));
  const full = join(dir, name);
  writeFileSync(full, content, 'utf-8');
  return full;
}

/** codex.cmd 格式（cmd-shim 标准 node+js 模式）。 */
const CODEX_CMD = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

/** claude.cmd 格式（cmd-shim 原生 exe 模式）。 */
const CLAUDE_CMD = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
`;

/** cursor-agent.cmd 格式（PowerShell -File 包装）。 */
const CURSOR_CMD = `@echo off
setlocal enabledelayedexpansion
set "CURSOR_INVOKED_AS=%~nx0"
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*
`;

describe('resolveWindowsCmdShim', () => {
  it('codex.cmd 格式 → 提取 codex.js 路径 + prependArgs=[js_path]', () => {
    const cmdPath = makeCmd('codex.cmd', CODEX_CMD);
    try {
      // 非 Windows 平台返回 null（CI Linux 跳过断言）
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (process.platform !== 'win32') {
        expect(resolved).toBeNull();
        return;
      }
      expect(resolved).not.toBeNull();
      expect(resolved!.prependArgs).toHaveLength(1);
      expect(resolved!.prependArgs[0]).toMatch(/codex[\\/]+bin[\\/]+codex\.js$/);
      // exe 是 node（%dp0%\node.exe 不存在时 fallback process.execPath）
      expect(resolved!.exe).toMatch(/node(\.exe)?$/);
    } finally {
      rmSync(cmdPath, { recursive: true, force: true });
    }
  });

  it('claude.cmd 格式 → 提取 claude.exe 路径 + 空 prependArgs', () => {
    const cmdPath = makeCmd('claude.cmd', CLAUDE_CMD);
    try {
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (process.platform !== 'win32') {
        expect(resolved).toBeNull();
        return;
      }
      expect(resolved).not.toBeNull();
      expect(resolved!.prependArgs).toEqual([]);
      expect(resolved!.exe).toMatch(/claude\.exe$/);
    } finally {
      rmSync(cmdPath, { recursive: true, force: true });
    }
  });

  it('cursor-agent.cmd 格式 → 解析 powershell -File cursor-agent.ps1', () => {
    const cmdPath = makeCmd('cursor-agent.cmd', CURSOR_CMD);
    try {
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (process.platform !== 'win32') {
        expect(resolved).toBeNull();
        return;
      }
      expect(resolved).not.toBeNull();
      expect(resolved!.exe).toMatch(/powershell\.exe$/i);
      expect(resolved!.prependArgs).toEqual(
        expect.arrayContaining([
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
        ]),
      );
      const ps1 = resolved!.prependArgs[resolved!.prependArgs.length - 1]!;
      expect(ps1).toMatch(/cursor-agent\.ps1$/i);
      expect(ps1).not.toContain('%SCRIPT_DIR%');
    } finally {
      rmSync(cmdPath, { recursive: true, force: true });
    }
  });

  it('%dp0% 宏展开到 .cmd 所在目录', () => {
    const cmdPath = makeCmd('codex.cmd', CODEX_CMD);
    try {
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (process.platform !== 'win32') return;
      // codex.js 路径必须以 .cmd 所在目录开头
      const expectedDir = cmdPath.replace(/[\\/]+codex\.cmd$/i, '');
      expect(resolved!.prependArgs[0]!).toContain(expectedDir);
    } finally {
      rmSync(cmdPath, { recursive: true, force: true });
    }
  });

  it('读取失败（文件不存在）→ null', () => {
    expect(resolveWindowsCmdShim('Z:\\nonexistent\\foo.cmd')).toBeNull();
  });

  it('非 .cmd 内容（无 %* 命令行）→ null', () => {
    const cmdPath = makeCmd('empty.cmd', '@ECHO off\nREM no real command\n');
    try {
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (process.platform !== 'win32') return;
      expect(resolved).toBeNull();
    } finally {
      rmSync(cmdPath, { recursive: true, force: true });
    }
  });
});
