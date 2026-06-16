/**
 * 单任务终端观察日志写入器。
 *
 * 用于 ql-20260616-003：每个 agent run 一个独立日志文件
 * `~/.sillyhub/daemon/runs/<leaseId>/terminal.log`，TaskRunner 在 spawn 全
 * 程往里写：
 *   - header（lease/cwd/cmd/mode）
 *   - parsed 事件文本（与本地 echo 同源，由 task-runner 的 renderAgentEvent
 *     / renderTaskBoundary 渲染）
 *   - raw stdout/stderr（mode=raw|both 时）
 *   - close 收尾行
 *
 * daemon 启动时若 `terminal_observer_enabled=true`，会调 launchTerminal 弹
 * 一个独立终端 tail 这个日志。终端弹窗失败不影响任务，只把 warning 写进
 * 日志文件本身（用户 tail 时能看到）。
 *
 * 设计要点：
 *   - fire-and-forget 写入：appendFile 异步、catch 静默吞错，绝不阻塞
 *     stdout 主循环或抛错给业务。
 *   - mode 控制：parsed 只写事件文本；raw 只写原始 stdout/stderr；both 都写。
 *   - 不写入敏感字段：observer 只接收「业务事件渲染文本」+「子进程 stdout/
 *     stderr」两类输入。Token/API key 由 spawn-env.ts 注入到子进程 env，不
 *     会出现在 stdout/stderr 里（Claude Code 不会打印 token）。
 *
 * @module terminal-observer
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_CONFIG_DIR, type DaemonConfig } from './config.js';
import { launchTerminal } from './terminal-launcher.js';

/** observer 实例接口：写完日志后由调用方持有，逐行写、最后 close。 */
export interface TerminalObserver {
  /** 写一条 parsed 事件文本（已渲染好的可读行，不含换行符）。 */
  writeParsed(line: string): void;
  /** 写一条 raw stdout 行（不含换行符）。 */
  writeRawStdout(line: string): void;
  /** 写一条 raw stderr 行（不含换行符）。 */
  writeRawStderr(line: string): void;
  /** 收尾：写入 summary 行 + 关闭提示。幂等（多次调用安全）。 */
  close(summary?: string): void;
}

/** 创建 observer 的入参。 */
export interface CreateTerminalObserverOptions {
  /** lease ID，用作日志目录名。 */
  leaseId: string;
  /** 子进程 cwd，写入 header 方便排查。 */
  cwd: string;
  /** 子进程 cmd 路径，写入 header。 */
  cmdPath: string;
  /** 子进程 args，写入 header。 */
  args: string[];
  /** daemon 配置（取 mode/enabled/close_on_exit/command）。可选。 */
  config?: DaemonConfig;
}

/**
 * 创建并初始化一个观察日志：
 *   1. 建 `runs/<leaseId>/` 目录
 *   2. 写 header（lease/cwd/cmd/mode）
 *   3. enabled=true 时调 launchTerminal 弹独立终端 tail 这个日志
 *
 * 返回 TerminalObserver 实例。即使弹窗失败/写文件失败也返回可用 observer
 * （内部全部 catch），保证 task-runner 调用链不中断。
 */
export async function createTerminalObserver(
  opts: CreateTerminalObserverOptions,
): Promise<TerminalObserver> {
  const mode = normalizeMode(opts.config?.terminal_observer_mode);
  const enabled = opts.config?.terminal_observer_enabled === true;
  const closeOnExit = opts.config?.terminal_observer_close_on_exit === true;
  const customCommand = opts.config?.terminal_observer_command ?? null;

  const shortId = shortLeaseId(opts.leaseId);
  const dir = join(DEFAULT_CONFIG_DIR, 'runs', opts.leaseId);
  const logPath = join(dir, 'terminal.log');

  // 建目录 + 写 header（这两个失败只能警告，不能让 task 失败）
  try {
    await mkdir(dir, { recursive: true });
    const header = [
      `[SillyHub] lease=${opts.leaseId}`,
      `cwd=${opts.cwd}`,
      `cmd=${opts.cmdPath} ${opts.args.join(' ')}`,
      `mode=${mode}`,
      `observer_enabled=${enabled}`,
      '',
      '----- agent output -----',
      '',
    ].join('\n');
    await writeFile(logPath, header, 'utf-8');
  } catch (e) {
    // 极端情况（磁盘满 / 权限）：observer 接口仍要返回，但后续写入也都会
    // 失败（catch 静默）。
  }

  // 弹终端（仅 enabled 时）。失败只往日志追加 warning，不抛错。
  if (enabled) {
    try {
      launchTerminal({
        title: `SillyHub ${shortId}`,
        logPath,
        closeOnExit,
        customCommand,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await appendFile(
        logPath,
        `[observer] open terminal failed: ${msg}\n`,
        'utf-8',
      ).catch(() => {
        // 静默吞错：弹窗失败不影响业务
      });
    }
  }

  // ── 写入实现：全部异步 + catch 静默 ──

  const append = (line: string): void => {
    const text = line.endsWith('\n') ? line : line + '\n';
    // void：明确告诉 lint/reader 我们不 await，写入是 fire-and-forget
    void appendFile(logPath, text, 'utf-8').catch(() => {
      // 写日志失败不影响 agent run
    });
  };

  let closed = false;

  return {
    writeParsed(line: string): void {
      if (mode === 'parsed' || mode === 'both') {
        append(line);
      }
    },
    writeRawStdout(line: string): void {
      if (mode === 'raw' || mode === 'both') {
        append(`[raw stdout] ${line}`);
      }
    },
    writeRawStderr(line: string): void {
      if (mode === 'raw' || mode === 'both') {
        append(`[stderr] ${line}`);
      }
    },
    close(summary?: string): void {
      if (closed) return;
      closed = true;
      const summaryLine = summary ? summary : '[observer] closed';
      append(`\n${summaryLine}\n`);
    },
  };
}

// ── 工具函数 ───────────────────────────────────────────────────────────────

/** 把 unknown 归一到合法 mode（默认 parsed）。 */
function normalizeMode(mode: unknown): 'parsed' | 'raw' | 'both' {
  if (mode === 'raw' || mode === 'both' || mode === 'parsed') {
    return mode;
  }
  return 'parsed';
}

/** leaseId 取短显示（前 8 位），与 task-runner 的 shortLeaseId 行为一致。 */
function shortLeaseId(leaseId: string): string {
  return leaseId.length > 12 ? leaseId.slice(0, 8) : leaseId;
}

// ── NOOP observer：disabled 模式下复用，避免 task-runner 大量判空 ──────────

/**
 * 空实现 observer：所有 write 都是 no-op，close 幂等。
 * task-runner 可以无脑调 `observer.writeParsed(...)`，不关心 enabled 状态。
 */
export const NOOP_TERMINAL_OBSERVER: TerminalObserver = {
  writeParsed() {},
  writeRawStdout() {},
  writeRawStderr() {},
  close() {},
};
