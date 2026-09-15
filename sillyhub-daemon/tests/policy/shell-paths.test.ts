/**
 * tests/policy/shell-paths.test.ts —— Shell 写路径提取器单测（task-03）。
 *
 * 覆盖：
 *   - extractBashWritePaths（迁自 write-guard.ts：>/>>/cp/mv/install/tee/mkdir/touch
 *     + normalizeBashWritePath 引号剥离 / git bash `/x/`→`X:/`）
 *   - extractPowerShellWritePaths（Set-Content/Add-Content/Out-File/New-Item
 *     -ItemType File/Copy-Item/Move-Item/Rename-Item/Remove-Item，
 *     取 -Path/-Destination/-Target 或位置参数）
 *   - extractCmdWritePaths（copy/move/mkdir/echo >/type >/del）
 *   - extractShellWritePaths 分派入口
 *   - 纯读命令返回空数组
 */

import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';
import {
  extractBashWritePaths,
  extractPowerShellWritePaths,
  extractCmdWritePaths,
  extractShellWritePaths,
} from '../../src/policy/shell-paths.js';

const isWin = sep === '\\';

// ── Bash ────────────────────────────────────────────────────────────────────
describe('extractBashWritePaths', () => {
  it('重定向 > 提取目标', () => {
    expect(extractBashWritePaths('echo test > E:\\a.txt')).toEqual(['E:\\a.txt']);
  });

  it('重定向 >> 追加也提取', () => {
    expect(extractBashWritePaths('echo hi >> /tmp/log.txt')).toEqual(['/tmp/log.txt']);
  });

  it('排除文件描述符重定向 2>&1 / >&2', () => {
    expect(extractBashWritePaths('node foo.js 2>&1 > out.txt')).toEqual(['out.txt']);
  });

  it('cp/mv/install 取最后位置参数为目标', () => {
    expect(extractBashWritePaths('cp src.txt dst.txt')).toEqual(['dst.txt']);
    expect(extractBashWritePaths('mv a b c')).toEqual(['c']);
    expect(extractBashWritePaths('install -m 755 src bin')).toEqual(['bin']);
  });

  it('tee 取位置参数', () => {
    expect(extractBashWritePaths('echo hi | tee out.txt')).toEqual(['out.txt']);
  });

  it('mkdir/touch 取位置参数', () => {
    expect(extractBashWritePaths('mkdir E:\\abc')).toEqual(['E:\\abc']);
    expect(extractBashWritePaths('touch -m file.txt')).toEqual(['file.txt']);
  });

  it('git bash /x/ 路径在 Windows 归一为 X:/', () => {
    const out = extractBashWritePaths('echo x > /e/file.txt');
    expect(out).toEqual(isWin ? ['E:/file.txt'] : ['/e/file.txt']);
  });

  it('剥离重定向目标外层引号', () => {
    expect(extractBashWritePaths('echo x > "E:\\my file.txt"')).toEqual(['E:\\my file.txt']);
  });

  // 2026-09-15 quick-f2c10985：重定向目标吞命令分隔符尾巴（线上审计抖动根因——
  // `> /dev/null; sleep 1` 提取出 `/dev/null;` 匹配不上 C:/dev/null 白名单，
  // 同一目录一会放行一会拒绝；runtime 2f0467a6 policy_audit_log 实证）。
  it('重定向目标剥尾部命令分隔符（; / && / || 混合形态）', () => {
    expect(extractBashWritePaths('echo x > /dev/null; sleep 1')).toEqual(['/dev/null']);
    expect(extractBashWritePaths('echo x >/dev/null&& do_thing')).toEqual(['/dev/null']);
    expect(extractBashWritePaths('foo 2>/dev/null || bar')).toEqual(['/dev/null']);
    expect(extractBashWritePaths('echo x > E:\a.txt;; ls')).toEqual(['E:\a.txt']);
    // 引号目标不吞引号内的合法字符（外层引号整体捕获，尾分隔符在引号外才剥）。
    expect(extractBashWritePaths('echo x > "E:\a; b.txt"')).toEqual(['E:\a; b.txt']);
  });

  it('tee/mkdir/touch 目标也剥尾部命令分隔符', () => {
    expect(extractBashWritePaths('echo hi | tee out.txt; grep x')).toEqual(['out.txt']);
    expect(extractBashWritePaths('mkdir /tmp/d; cd /tmp/d')).toEqual(['/tmp/d']);
  });

  it('纯读命令返回空', () => {
    expect(extractBashWritePaths('ls -la')).toEqual([]);
    expect(extractBashWritePaths('cat a.txt')).toEqual([]);
    expect(extractBashWritePaths('grep foo *.ts')).toEqual([]);
  });
});

// ── PowerShell ──────────────────────────────────────────────────────────────
describe('extractPowerShellWritePaths', () => {
  // quick-f2c10985：PowerShell/cmd 提取目标同样剥尾部命令分隔符。
  it('PowerShell 重定向/cmdlet 目标剥尾部 ; 与 & 链', () => {
    expect(extractPowerShellWritePaths('echo x > C:\z.log; Get-Date')).toEqual(['C:\z.log']);
    expect(extractPowerShellWritePaths('Set-Content C:\a.txt hi&& whoami')).toEqual(['C:\a.txt']);
  });

  it('Set-Content -Path 提取目标', () => {
    expect(extractPowerShellWritePaths('Set-Content -Path E:\\a.txt -Value hi')).toEqual([
      'E:\\a.txt',
    ]);
  });

  it('Set-Content 位置参数提取', () => {
    expect(extractPowerShellWritePaths('Set-Content E:\\a.txt hi')).toEqual(['E:\\a.txt']);
  });

  it('Add-Content -Path 提取', () => {
    expect(extractPowerShellWritePaths('Add-Content -Path log.txt "x"')).toEqual(['log.txt']);
  });

  it('Out-File -FilePath 提取', () => {
    expect(extractPowerShellWritePaths('Get-Process | Out-File -FilePath proc.txt')).toEqual([
      'proc.txt',
    ]);
  });

  it('New-Item -ItemType File -Path 提取', () => {
    expect(
      extractPowerShellWritePaths('New-Item -ItemType File -Path new.txt'),
    ).toEqual(['new.txt']);
  });

  it('Copy-Item -Destination 提取', () => {
    expect(
      extractPowerShellWritePaths('Copy-Item src.txt -Destination dst.txt'),
    ).toEqual(['dst.txt']);
  });

  it('Move-Item -Destination 提取', () => {
    expect(extractPowerShellWritePaths('Move-Item a.txt -Destination b.txt')).toEqual([
      'b.txt',
    ]);
  });

  it('Rename-Item -NewName / -Target 提取', () => {
    expect(extractPowerShellWritePaths('Rename-Item a.txt -Target b.txt')).toEqual(['b.txt']);
  });

  it('Remove-Item -Path 提取', () => {
    expect(extractPowerShellWritePaths('Remove-Item -Path junk.txt')).toEqual(['junk.txt']);
  });

  it('纯读命令返回空', () => {
    expect(extractPowerShellWritePaths('Get-Content a.txt')).toEqual([]);
    expect(extractPowerShellWritePaths('Get-ChildItem')).toEqual([]);
  });
});

// ── CMD ─────────────────────────────────────────────────────────────────────
describe('extractCmdWritePaths', () => {
  it('cmd 重定向目标剥尾部 & 链', () => {
    expect(extractCmdWritePaths('echo x > D:\b.txt&& dir')).toEqual(['D:\b.txt']);
  });

  it('copy src dst 提取 dst', () => {
    expect(extractCmdWritePaths('copy a.txt b.txt')).toEqual(['b.txt']);
  });

  it('move src dst 提取 dst', () => {
    expect(extractCmdWritePaths('move a.txt b.txt')).toEqual(['b.txt']);
  });

  it('mkdir 提取目录', () => {
    expect(extractCmdWritePaths('mkdir E:\\abc')).toEqual(['E:\\abc']);
  });

  it('echo > file 提取目标', () => {
    expect(extractCmdWritePaths('echo hi > E:\\a.txt')).toEqual(['E:\\a.txt']);
  });

  it('type > file 提取目标', () => {
    expect(extractCmdWritePaths('type in.txt > out.txt')).toEqual(['out.txt']);
  });

  it('del 提取目标', () => {
    expect(extractCmdWritePaths('del junk.txt')).toEqual(['junk.txt']);
  });

  it('纯读命令返回空', () => {
    expect(extractCmdWritePaths('dir')).toEqual([]);
    expect(extractCmdWritePaths('type in.txt')).toEqual([]);
  });
});

// ── 统一分派入口 ────────────────────────────────────────────────────────────
describe('extractShellWritePaths', () => {
  it('bash 分派到 Bash 提取器', () => {
    expect(extractShellWritePaths('echo x > /tmp/a', 'bash')).toEqual(['/tmp/a']);
  });

  it('powershell 分派到 PowerShell 提取器', () => {
    expect(extractShellWritePaths('Set-Content -Path b.txt', 'powershell')).toEqual([
      'b.txt',
    ]);
  });

  it('cmd 分派到 CMD 提取器', () => {
    expect(extractShellWritePaths('copy a b', 'cmd')).toEqual(['b']);
  });

  it('纯读命令返回空数组', () => {
    expect(extractShellWritePaths('ls', 'bash')).toEqual([]);
  });
});
