/**
 * 跨平台「弹独立终端窗口」工具。
 *
 * 用于 ql-20260616-003：daemon 启动 agent run 时，可选弹一个本地终端 tail
 * 观察日志（`~/.sillyhub/daemon/runs/<leaseId>/terminal.log`），让用户在
 * 独立窗口里实时看 Claude 执行过程，主 daemon 进程保持管道化（平台事件
 * 流不变）。
 *
 * 设计要点：
 *   - 失败不抛错：弹窗是辅助能力，绝不能让任务执行受影响。所有 spawn 错误
 *     都吞掉（child.on('error') + try/catch），调用方只需知道「弹没弹出」
 *     不影响业务。
 *   - detached + unref：子终端进程与 daemon 解耦，daemon 退出后终端继续。
 *   - 平台默认 + 自定义命令兜底：默认按平台调系统终端（Windows wt.exe /
 *     macOS Terminal.app / Linux x-terminal-emulator 等），用户可用
 *     `--terminal-command` 给一个完全自定义命令模板（支持 {log} {title}）。
 *
 * @module terminal-launcher
 */

import { spawn } from 'node:child_process';

/** 弹终端参数。 */
export interface LaunchTerminalOptions {
  /** 终端窗口标题（部分平台/终端支持，wt.exe/osascript 支持）。 */
  title: string;
  /** 要 tail 的日志文件绝对路径。 */
  logPath: string;
  /** 任务结束后是否关闭终端窗口（false=保留窗口方便查看）。 */
  closeOnExit?: boolean;
  /** 自定义命令模板，支持 {log} 和 {title} 占位符。null 走平台默认。 */
  customCommand?: string | null;
}

/**
 * 弹一个独立终端窗口 tail 指定日志文件。
 *
 * 平台分支：
 *   - win32：wt.exe new-tab powershell Get-Content -Wait（wt 不可用时 fallback
 *     cmd /c start powershell）
 *   - darwin：osascript 让 Terminal.app do script "tail -f <log>"
 *   - linux：x-terminal-emulator / gnome-terminal / konsole / xterm 候选
 *
 * customCommand 优先级最高：replaceAll({log}, {title}) 后 shell:true 执行。
 */
export function launchTerminal(opts: LaunchTerminalOptions): void {
  if (opts.customCommand) {
    launchCustom(opts);
    return;
  }

  if (process.platform === 'win32') {
    launchWindows(opts);
    return;
  }

  if (process.platform === 'darwin') {
    launchMac(opts);
    return;
  }

  launchLinux(opts);
}

// ── Windows：wt.exe 优先，cmd start powershell 兜底 ──────────────────────────

function launchWindows(opts: LaunchTerminalOptions): void {
  const safePath = opts.logPath.replace(/'/g, "''");
  // closeOnExit=true 时让 PowerShell 自行退出（去掉 -NoExit）；但 tail -Wait 是
  // 阻塞的，需要先 tail 结束才能退出，等同于 closeOnExit 行为。
  // 这里简化：closeOnExit 不影响 Windows 实现（wt 没法精准控制 close 时机），
  // 保持 -NoExit 让用户能看完整日志，符合默认 false 的预期。
  const ps = `Get-Content -LiteralPath '${safePath}' -Wait`;

  const child = spawn(
    'wt.exe',
    ['new-tab', '--title', opts.title, 'powershell', '-NoExit', '-Command', ps],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  );

  child.on('error', () => {
    // wt.exe 不存在（旧版 Windows / 未装 Windows Terminal）→ fallback cmd start
    const fallback = spawn(
      'cmd.exe',
      ['/c', 'start', '', 'powershell', '-NoExit', '-Command', ps],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    fallback.unref();
  });

  child.unref();
}

// ── macOS：osascript 让 Terminal.app 执行 tail ──────────────────────────────

function launchMac(opts: LaunchTerminalOptions): void {
  const cmd = `tail -f ${shellQuote(opts.logPath)}`;
  // do script 会打开新 Terminal 窗口；activate 把 Terminal 拉到前台。
  const script = [
    `tell application "Terminal"`,
    `  do script ${JSON.stringify(cmd)}`,
    `  activate`,
    `end tell`,
  ].join('\n');

  const child = spawn('osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', () => {
    // ignore：用户机器没装 osascript 等极端情况，仅吞错（业务不受影响）
  });
  child.unref();
}

// ── Linux：候选终端 emulator，第一个能 spawn 的就用 ─────────────────────────

function launchLinux(opts: LaunchTerminalOptions): void {
  const cmd = `tail -f ${shellQuote(opts.logPath)}`;

  // 候选顺序：debian 系默认 → gnome → kde → 古董 xterm
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', cmd]],
    ['gnome-terminal', ['--', 'bash', '-lc', cmd]],
    ['konsole', ['-e', 'bash', '-lc', cmd]],
    ['xterm', ['-e', 'bash', '-lc', cmd]],
  ];

  for (const [bin, args] of candidates) {
    try {
      const child = spawn(bin, [...args], {
        detached: true,
        stdio: 'ignore',
      });

      // spawn 同步成功（ENOENT 才会同步抛 / 触发 error 事件）：
      // 异步 error（终端启动后失败）不阻塞下一次尝试，但既然 PID 拿到了
      // 就认为弹窗成功，直接返回。
      child.on('error', () => {
        // ignore：当前候选失败也不试下一个（避免重复弹窗）
      });
      child.unref();
      return;
    } catch {
      // 同步抛错（ENOENT 等）→ 试下一个候选
    }
  }
  // 所有候选都失败：静默返回，调用方在观察日志里能看出没弹成功
}

// ── 自定义命令模板：shell 执行，支持 {log} {title} 占位符 ─────────────────────

function launchCustom(opts: LaunchTerminalOptions): void {
  const raw = opts.customCommand ?? '';
  const cmd = raw.replaceAll('{log}', opts.logPath).replaceAll('{title}', opts.title);

  const child = spawn(cmd, {
    shell: true,
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', () => {
    // ignore
  });
  child.unref();
}

// ── 单引号 shell quote（tail -f '<path>'）──────────────────────────────────

/**
 * POSIX 单引号包裹：path 含单引号时用 '\'' 转义。
 * Windows 路径含反斜杠，但 launchWindows 用 PowerShell 单引号 + '' 转义，
 * 不走本函数（本函数只给 mac/linux bash 用）。
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
