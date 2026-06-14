// tests/helpers/fake-child.ts
// task-19 测试辅助：mock node:child_process.spawn 返回的伪子进程。
//
// 用 Node 原生 Readable/Writable/EventEmitter 模拟子进程三流（stdin/stdout/stderr）
// + exit/error 事件，让测试可以驱动 spawn 后的交互时序（推 stdout 行、发 exit 信号）。
//
// 对照蓝图 task-19.md §TDD 步骤 2。
//
// 使用约定：
//   spawn 是 async（实现层 await prepareWorkspace 等步骤后才调 spawn），因此测试
//   在 `runner.runLease(lease)` 之后**不能立即**同步 emit exit/error；应先 await
//   一拍（如 `await new Promise(r => setImmediate(r))`）让 spawn 完成、listener 注册，
//   再 _emitLines / _emitExit。这与真实子进程语义一致（spawn 返回 ≠ 立即退出）。

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

/**
 * 测试用的伪子进程（实现 ChildProcess 子集 + 测试驱动方法）。
 * 通过 EventEmitter 转发 'exit' / 'error' 事件，stdin/stdout/stderr 用真实 stream。
 */
export interface FakeChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  killed: boolean;
  pid: number;
  kill(signal?: string): boolean;
  /** 测试驱动：向 stdout 推若干行（自动加 \n），然后不结束流（除非调 _endStdout）。 */
  _emitLines(lines: string[]): void;
  /** 测试驱动：结束 stdout 流（push null）。 */
  _endStdout(): void;
  /** 测试驱动：触发 'exit' 事件并设 exitCode。 */
  _emitExit(code: number | null, signal?: string | null): void;
  /** 测试驱动：触发 'error' 事件（模拟 ENOENT）。 */
  _emitError(err: Error): void;
  /** 测试驱动：向 stderr 推文本（触发 'data' 事件）。 */
  _emitStderr(text: string): void;
}

/**
 * 创建伪子进程。stdout/stderr 是 Readable（read 是 no-op，靠 push 注入），
 * stdin 是 Writable（write 吞掉但可 spy）。
 *
 * exit/error 事件按 EventEmitter 原生语义：emit 时同步通知所有已注册 listener。
 * 因此测试必须在 emit 前 await 一拍让实现层注册完 listener（见文件头注释）。
 */
export function createFakeChild(): FakeChild {
  const stdout = new Readable({ read() { /* no-op */ } });
  const stderr = new Readable({ read() { /* no-op */ } });
  // stdin 的 write 回调必须立即 cb，否则 TaskRunner 的 stdin.write 会卡住。
  // 记录写入内容供测试断言（写入数据通过 chunks 数组暴露）。
  const stdinChunks: Buffer[] = [];
  const stdin = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      stdinChunks.push(chunk);
      cb();
    },
    final(cb: () => void) {
      cb();
    },
  });

  const ee = new EventEmitter() as FakeChild;
  ee.stdin = stdin;
  ee.stdout = stdout;
  ee.stderr = stderr;
  ee.exitCode = null;
  ee.killed = false;
  ee.pid = 12345;

  ee.kill = (signal?: string): boolean => {
    ee.killed = true;
    // 模拟真实 kill 后子进程会退出（Node 真实行为：kill 后 child 触发 exit）。
    // 但我们让测试自己 _emitExit，避免 kill 直接结束流（保留测试对时序的控制）。
    // 记录最后用的 signal 便于断言。
    (ee as unknown as { _lastKillSignal?: string })._lastKillSignal = signal ?? 'SIGTERM';
    return true;
  };

  ee._emitLines = (lines: string[]): void => {
    for (const line of lines) {
      ee.stdout.push(line + '\n');
    }
  };

  ee._endStdout = (): void => {
    ee.stdout.push(null);
  };

  ee._emitExit = (code: number | null, signal?: string | null): void => {
    ee.exitCode = code;
    // 先 end stdout（子进程退出意味着流关闭），再发 exit 事件。
    // 防止 readline 在 exit 后还尝试读。
    try { ee.stdout.push(null); } catch { /* already ended */ }
    ee.emit('exit', code, signal ?? null);
  };

  ee._emitError = (err: Error): void => {
    // EventEmitter 对 'error' 默认无 listener 会 throw；测试约定 emit 前先 await
    // 一拍让 listener 注册，因此此处应已有 listener。
    ee.emit('error', err);
  };

  ee._emitStderr = (text: string): void => {
    ee.stderr.push(Buffer.from(text, 'utf-8'));
  };

  // 暴露 stdin 写入记录供测试 spy（不以 enumerable 形式暴露，避免污染 stream）。
  Object.defineProperty(ee, '_stdinChunks', { value: stdinChunks });

  return ee;
}

/** 读取 FakeChild stdin 累积的所有写入内容（拼接成字符串）。 */
export function readStdin(child: FakeChild): string {
  const chunks = (child as unknown as { _stdinChunks?: Buffer[] })._stdinChunks ?? [];
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * 让出控制流直到 spawn 被实际调用（监听 spawn mock 调用）。
 * 比 setImmediate 等固定 tick 更可靠 —— 真实等待实现层完成 workspace 准备、
 * credential 渲染、getBackend、startLease 等所有 await 步骤后到达 spawn。
 *
 * 测试在 runner.runLease(lease) 之后、_emitExit/_emitError 之前调此函数。
 */
export async function waitForSpawn(): Promise<void> {
  // 轮询：每微任务让出一次，最多等 1000 次（约 1s 上限）
  const { spawn } = await import('node:child_process');
  const mocked = spawn as unknown as { mock?: { calls: unknown[] } };
  for (let i = 0; i < 1000; i++) {
    if (mocked.mock && mocked.mock.calls.length > 0) {
      // spawn 已调；再多让一拍让 listener 注册完成
      await new Promise<void>((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  // 超时兜底
  await new Promise<void>((resolve) => setImmediate(resolve));
}
