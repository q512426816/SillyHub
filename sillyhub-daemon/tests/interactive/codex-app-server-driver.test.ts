// tests/interactive/codex-app-server-driver.test.ts
// task-04 TDD：CodexAppServerDriver 核心生命周期 / flat message / interrupt / fail-closed。
//
// 依据：tasks/task-04.md §TDD（1-13）、design.md §5.3 八点职责、§5.5 一致性矩阵、
// §7 错误处理。用 tests/helpers/fake-child.ts 驱动 spawn 的 stdin/stdout/stderr，
// 不依赖真实 codex 二进制。
//
// 覆盖点（与 task-04.md §TDD 步骤 1-13 对齐）：
//   1. executable 缺失 → CodexExecutableNotFoundError
//   2. 握手 initialize→initialized→thread/start + onTurnMessage(thread_started) + threadId 回传
//   3. turn/start + turn/started→turnId + turn/completed→onTurnResult(success)
//   4. 多轮串行（第二条 turn/start 仅在第一条 turn/completed 后）
//   5/6. interrupt 有/无 turnId
//   7. flat message 映射（text/tool_use/tool_result/reasoning）
//   8. resume 路径 thread/resume + 不主动首轮 turn/start
//   9. close idempotent
//   10. stderr 上报 error flat message
//   11. 未知 event/坏 JSON 不崩
//   12. turn/completed failed status
//   13. server request fail-closed（decline，不 accept）

import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock node:child_process.spawn —— driver 内部用 spawn，注入 FakeChild。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

// mock cmd-shim：driver 仅对 .cmd 调 resolveWindowsCmdShim（现有用例 path 非 .cmd 不触发）。
// 默认返回 null；ql-20260624-002 wrapper 用例内 vi.mocked(...).mockReturnValue override。
vi.mock('../../src/cmd-shim.js', () => ({
  resolveWindowsCmdShim: vi.fn(() => null),
}));

import { spawn } from 'node:child_process';
import { resolveWindowsCmdShim } from '../../src/cmd-shim.js';
import {
  CodexAppServerDriver,
  CodexExecutableNotFoundError,
  type CodexHandle,
  type CodexStartOptions,
} from '../../src/interactive/codex-app-server-driver.js';
import type {
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import {
  createFakeChild,
  readStdin,
  type FakeChild,
} from '../helpers/fake-child.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

/** 最小 CodexStartOptions。executable 指向 fake（不 spawn 真进程，spawn 已 mock）。 */
function makeOpts(overrides: Partial<CodexStartOptions> = {}): CodexStartOptions {
  return {
    cwd: '/tmp/codex-ws',
    pathToAgentExecutable: '/usr/local/bin/codex',
    ...overrides,
  };
}

/** 构造 callbacks 收集器：onTurnMessage/onTurnResult/onTurnError 全记录。 */
function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  messages: Record<string, unknown>[];
  results: Record<string, unknown>[];
  errors: unknown[];
} {
  const messages: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const cb: InteractiveDriverCallbacks = {
    onTurnMessage: (m) => {
      messages.push(m);
    },
    onTurnResult: (r) => {
      results.push(r);
    },
    onTurnError: (e) => {
      errors.push(e);
    },
  };
  return { cb, messages, results, errors };
}

/** 构造可控 input queue（push/close）。 */
function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (text: string) => void;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  let waiter: (() => void) | null = null;
  const queue: AsyncIterable<UserTurnInput> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<UserTurnInput>> {
          if (pending.length > 0) {
            return { value: pending.shift()!, done: false };
          }
          if (closed) {
            return { value: undefined, done: true };
          }
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
          waiter = null;
          if (pending.length > 0) {
            return { value: pending.shift()!, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    queue,
    push(text: string) {
      pending.push({ type: 'user', text });
      if (waiter) waiter();
    },
    close() {
      closed = true;
      if (waiter) waiter();
    },
  };
}

/** 让出控制流直到 spawn 被调用。 */
async function waitForSpawn(): Promise<void> {
  const mocked = spawn as unknown as { mock?: { calls: unknown[] } };
  for (let i = 0; i < 1000; i++) {
    if (mocked.mock && mocked.mock.calls.length > 0) {
      await new Promise<void>((r) => setImmediate(r));
      return;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
}

/** 从 FakeChild stdin 解析出所有已写入的 JSON-RPC 行。 */
function readStdinJson(child: FakeChild): Record<string, unknown>[] {
  const text = readStdin(child);
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 给 FakeChild 的 stdout 喂若干行（自动加 \n）。 */
function emitLines(child: FakeChild, lines: string[]): void {
  for (const l of lines) child.stdout.push(l + '\n');
}

/** 解析出的 thread/start response 行（喂回 fake）。 */
function threadStartResponse(threadId: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 2, result: { thread: { id: threadId } } });
}

/** turn/started notification 行。 */
function turnStartedNotif(threadId: string, turnId: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'turn/started',
    params: { threadId, turnId },
  });
}

/** turn/completed notification 行。 */
function turnCompletedNotif(
  status: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'turn/completed',
    params: { turn: { status, ...extra } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── TDD-1：executable 缺失 ──────────────────────────────────────────────────

describe('ql-20260624-002：Windows codex.cmd wrapper 解析（R-exe，规避 spawn EINVAL）', () => {
  // clearAllMocks 不重置 mockReturnValue，显式归零防上一用例 override 跨用例继承。
  beforeEach(() => {
    vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
  });

  it.skipIf(process.platform !== 'win32')(
    'codex.cmd 经 resolveWindowsCmdShim 解析 → spawn(node.exe, [codex.js, app-server...]) shell=false',
    async () => {
      vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
      vi.mocked(resolveWindowsCmdShim).mockReturnValue({
        exe: 'C:\\nvm4w\\nodejs\\node.exe',
        prependArgs: [
          'C:\\nvm4w\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js',
        ],
      });

      const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
      await driver.start(makeInputQueue().queue, makeOpts({
        pathToAgentExecutable: 'C:\\nvm4w\\nodejs\\codex.cmd',
      }));
      await waitForSpawn();

      expect(resolveWindowsCmdShim).toHaveBeenCalledWith('C:\\nvm4w\\nodejs\\codex.cmd');
      expect(spawn).toHaveBeenCalledWith(
        'C:\\nvm4w\\nodejs\\node.exe',
        [
          'C:\\nvm4w\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js',
          'app-server',
          '--listen',
          'stdio://',
        ],
        expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'codex.cmd 解析失败(null) → 回退 spawn(codex.cmd, [app-server...], {shell:true})',
    async () => {
      vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
      vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);

      const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
      await driver.start(makeInputQueue().queue, makeOpts({
        pathToAgentExecutable: 'C:\\nvm4w\\nodejs\\codex.cmd',
      }));
      await waitForSpawn();

      expect(spawn).toHaveBeenCalledWith(
        'C:\\nvm4w\\nodejs\\codex.cmd',
        ['app-server', '--listen', 'stdio://'],
        expect.objectContaining({ shell: true }),
      );
    },
  );

  it('非 .cmd（POSIX/exe）→ 不调 resolveWindowsCmdShim，spawn(path, [app-server...], {shell:false})', async () => {
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    await driver.start(makeInputQueue().queue, makeOpts());
    await waitForSpawn();

    expect(resolveWindowsCmdShim).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({ shell: false }),
    );
  });
});

describe('TDD-1：executable 缺失抛 CodexExecutableNotFoundError', () => {
  it('空 pathToAgentExecutable → start 抛错，不 spawn', async () => {
    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue } = makeInputQueue();
    await expect(
      driver.start(queue, makeOpts({ pathToAgentExecutable: '' })),
    ).rejects.toThrow(/CODEX_EXECUTABLE_NOT_FOUND/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('错误带 code=CODEX_EXECUTABLE_NOT_FOUND', async () => {
    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue } = makeInputQueue();
    try {
      await driver.start(queue, makeOpts({ pathToAgentExecutable: '   ' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CodexExecutableNotFoundError);
      expect((e as CodexExecutableNotFoundError).code).toBe(
        'CODEX_EXECUTABLE_NOT_FOUND',
      );
    }
  });
});

// ── TDD-2：握手 + thread_started flat message ────────────────────────────────

describe('TDD-2：新建握手 initialize→initialized→thread/start', () => {
  it('按序写三条握手，喂回 thread/start response 后发 thread_started flat message', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages } = makeCallbacks();
    const handleP = driver.start(queue, makeOpts());
    await waitForSpawn();
    const handle = (await handleP) as CodexHandle;

    // 启动 consume（异步，不 await）
    const consumeP = driver.consume(handle, cb);

    // 让握手写入完成
    await new Promise<void>((r) => setTimeout(r, 50));

    // 喂回 thread/start response
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const written = readStdinJson(child).map((m) => m.method);
    expect(written).toEqual([
      'initialize',
      'notifications/initialized',
      'thread/start',
    ]);

    // initialize.params.clientInfo.name = sillyhub-daemon
    const init = readStdinJson(child)[0]!;
    expect((init.params as { clientInfo: { name: string } }).clientInfo.name).toBe(
      'sillyhub-daemon',
    );
    // thread/start.params.cwd = opts.cwd
    const threadStart = readStdinJson(child)[2]!;
    expect((threadStart.params as { cwd: string }).cwd).toBe('/tmp/codex-ws');

    // thread_started flat message
    const started = messages.find(
      (m) =>
        (m.metadata as { subtype?: string })?.subtype === 'thread_started',
    );
    expect(started).toBeDefined();
    expect(started!.event_type).toBe('text');
    expect(started!.session_id).toBe('thr_123');

    expect(handle.threadId).toBe('thr_123');

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-3：turn/start + turn/started + turn/completed ─────────────────────────

describe('TDD-3：首轮 turn 生命周期', () => {
  it('turn/start(id=3) 带 threadId+input，turn/started 存 turnId，turn/completed success', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // push 首轮
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));

    // 断言 turn/start(id=3)
    const turnStart = readStdinJson(child).find(
      (m) => m.method === 'turn/start',
    )!;
    expect(turnStart.id).toBe(3);
    expect((turnStart.params as { threadId: string }).threadId).toBe('thr_123');
    expect((turnStart.params as { input: unknown[] }).input).toEqual([
      { type: 'text', text: 'hi' },
    ]);

    // 喂 turn/started
    emitLines(child, [turnStartedNotif('thr_123', 'turn_1')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(handle.currentTurnId).toBe('turn_1');

    // 喂 turn/completed(success)
    emitLines(child, [turnCompletedNotif('completed')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'success',
      is_error: false,
    });
    // turn/completed 后 turnId 清空
    expect(handle.currentTurnId).toBeNull();

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-4：多轮串行 ──────────────────────────────────────────────────────────

describe('TDD-4：多轮串行（无并发 turn）', () => {
  it('第二条 turn/start 仅在第一条 turn/completed 之后发出', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 同时 push 两条
    push('first');
    push('second');
    await new Promise<void>((r) => setTimeout(r, 50));

    // 此时只有一条 turn/start（第一条），第二条必须等 turn/completed
    const firstBatch = readStdinJson(child).filter(
      (m) => m.method === 'turn/start',
    );
    expect(firstBatch).toHaveLength(1);
    expect(
      (firstBatch[0]!.params as { input: { text: string }[] }).input[0].text,
    ).toBe('first');

    // 完成第一条
    emitLines(child, [
      turnStartedNotif('thr_123', 'turn_1'),
      turnCompletedNotif('completed'),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 现在第二条 turn/start 才发
    const allTurnStarts = readStdinJson(child).filter(
      (m) => m.method === 'turn/start',
    );
    expect(allTurnStarts).toHaveLength(2);
    expect(allTurnStarts[1]!.id).toBe(4);
    expect(
      (allTurnStarts[1]!.params as { input: { text: string }[] }).input[0].text,
    ).toBe('second');

    // 完成第二条
    emitLines(child, [
      turnStartedNotif('thr_123', 'turn_2'),
      turnCompletedNotif('completed'),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-5/6：interrupt ───────────────────────────────────────────────────────

describe('TDD-5/6：interrupt', () => {
  it('有 turnId 时发 turn/interrupt 返回 true', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [turnStartedNotif('thr_123', 'turn_1')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const ok = await driver.interrupt(handle);
    expect(ok).toBe(true);

    const interruptReq = readStdinJson(child).find(
      (m) => m.method === 'turn/interrupt',
    )!;
    expect(interruptReq).toBeDefined();
    expect((interruptReq.params as { threadId: string }).threadId).toBe(
      'thr_123',
    );
    expect((interruptReq.params as { turnId: string }).turnId).toBe('turn_1');

    // 喂 cancelled → error result
    emitLines(child, [turnCompletedNotif('cancelled')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
    });
    expect(handle.currentTurnId).toBeNull();

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('无 turnId（turn/started 未到）→ 返回 false，不发 JSON-RPC', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const writtenBefore = readStdin(child);
    const ok = await driver.interrupt(handle);
    expect(ok).toBe(false);
    // 无新增写入
    expect(readStdin(child)).toBe(writtenBefore);

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('interrupt(null) → false', async () => {
    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    expect(await driver.interrupt(null)).toBe(false);
  });
});

// ── TDD-7：flat message 映射 ─────────────────────────────────────────────────

describe('TDD-7：flat message 映射（text/tool_use/tool_result/reasoning）', () => {
  it('agentMessage delta/completed、commandExecution started/completed、reasoning 均产出对应 flat message，带 session_id', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));

    emitLines(child, [
      // commandExecution started → tool_use
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: { type: 'commandExecution', id: 'cmd_1', command: 'ls -la' },
        },
      }),
      // commandExecution completed → tool_result
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          item: {
            type: 'commandExecution',
            id: 'cmd_1',
            aggregatedOutput: 'file1\nfile2',
          },
        },
      }),
      // reasoning started → text(thinking)
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          item: {
            type: 'reasoning',
            id: 'r_1',
            summary: [{ type: 'summary_text', text: 'thinking...' }],
          },
        },
      }),
      // agentMessage completed → text
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          item: { type: 'agentMessage', id: 'msg_1', text: 'hello world' },
        },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 所有 flat message（除 thread_started）都带 session_id=thr_123
    const runtimeMsgs = messages.filter(
      (m) =>
        (m.metadata as { subtype?: string })?.subtype !== 'thread_started',
    );
    for (const m of runtimeMsgs) {
      expect(m.session_id).toBe('thr_123');
    }

    // tool_use（commandExecution started）
    const toolUse = runtimeMsgs.find((m) => m.event_type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse!.content).toBe('ls -la');
    expect(
      (toolUse!.metadata as { tool_name: string }).tool_name,
    ).toBe('exec_command');

    // tool_result（commandExecution completed）
    const toolResult = runtimeMsgs.find((m) => m.event_type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toBe('file1\nfile2');

    // reasoning thinking text
    const thinking = runtimeMsgs.find(
      (m) => (m.metadata as { thinking?: boolean })?.thinking === true,
    );
    expect(thinking).toBeDefined();
    expect(thinking!.content).toBe('thinking...');

    // agentMessage text
    const agentText = runtimeMsgs.find(
      (m) =>
        m.event_type === 'text' &&
        typeof m.content === 'string' &&
        m.content === 'hello world',
    );
    expect(agentText).toBeDefined();

    close();
    emitLines(child, [turnCompletedNotif('completed')]);
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-8：resume 路径 ───────────────────────────────────────────────────────

describe('TDD-8：resume 路径 thread/resume', () => {
  it('resume 非空 → 发 thread/resume(id=2, threadId=resume)，不主动首轮 turn/start', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(
      queue,
      makeOpts({ resume: 'thr_999' }),
    )) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));

    const written = readStdinJson(child);
    // initialize → initialized → thread/resume（不是 thread/start）
    expect(written.map((m) => m.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'thread/resume',
    ]);
    const resumeReq = written[2]!;
    expect(resumeReq.id).toBe(2);
    expect((resumeReq.params as { threadId: string }).threadId).toBe('thr_999');

    // 喂回 thread/resume response
    emitLines(child, [threadStartResponse('thr_999')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(handle.threadId).toBe('thr_999');

    // 此时尚未 push 任何 turn → 不应有 turn/start
    expect(
      readStdinJson(child).some((m) => m.method === 'turn/start'),
    ).toBe(false);

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-9：close idempotent ──────────────────────────────────────────────────

describe('TDD-9：close 释放 child + idempotent', () => {
  it('close 调 stdin.end + kill；二次调用不重复 kill', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue } = makeInputQueue();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;

    const endSpy = vi.spyOn(child.stdin, 'end');
    await handle.close();
    expect(endSpy).toHaveBeenCalled();
    expect(child.killed).toBe(true);

    const killCountBefore = (child as unknown as { _lastKillSignal?: string })
      ._lastKillSignal;
    await handle.close(); // idempotent
    // 二次 close 不重复 kill（标志位守卫）
    expect((handle as CodexHandle).closing).toBe(true);
    // kill 仍只被调一次（FakeChild.kill 记 killed=true，二次 close 不改）
    void killCountBefore;
  });
});

// ── TDD-10：stderr 上报 ──────────────────────────────────────────────────────

describe('TDD-10：stderr 作 error flat message 上报', () => {
  it('emit stderr 行 → error flat message，metadata.level=stderr，session_id=threadId', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    child._emitStderr('boom\n');
    await new Promise<void>((r) => setTimeout(r, 50));

    const stderrMsg = messages.find(
      (m) => (m.metadata as { level?: string })?.level === 'stderr',
    );
    expect(stderrMsg).toBeDefined();
    expect(stderrMsg!.event_type).toBe('error');
    expect(stderrMsg!.content).toBe('boom');
    expect(stderrMsg!.session_id).toBe('thr_123');

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-11：未知 event / 坏 JSON 不崩 ────────────────────────────────────────

describe('TDD-11：未知 event / 坏 JSON 不崩不阻断', () => {
  it('未知 method notification + 坏 JSON 行 → 不抛、继续处理后续正常行', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages, errors } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));

    emitLines(child, [
      'this is not json',
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'unknownFuture/method',
        params: {},
      }),
      // 后续正常行仍能产出
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: { item: { type: 'agentMessage', id: 'm1', text: 'ok' } },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // consume 未抛（errors 空）
    expect(errors).toHaveLength(0);
    // 正常 agentMessage 仍被映射
    expect(
      messages.some(
        (m) => m.content === 'ok' && m.event_type === 'text',
      ),
    ).toBe(true);

    close();
    emitLines(child, [turnCompletedNotif('completed')]);
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-12：turn/completed failed status ─────────────────────────────────────

describe('TDD-12：turn/completed failed → error result', () => {
  it('status=failed + error.message → onTurnResult error_during_execution, result=错误信息', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [
      turnStartedNotif('thr_123', 'turn_1'),
      turnCompletedNotif('failed', { error: { message: 'kaboom' } }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
      result: 'kaboom',
    });

    close();
    child._emitExit(0);
    await consumeP;
  });
});

// ── TDD-13：server request fail-closed（task-05 真实策略占位兼容）─────────────
//
// task-05 用真实策略映射替换了 task-04 的同步 fail-closed 占位。本用例验证
// task-06 daemon 接线前的过渡态：manualApproval=true 但未注入 sessionPermission
// hook 时，普通 approval 走 fail-closed decline（绝不 accept），保留 task-04
// 核心安全断言。完整策略矩阵（ask-only / full-review allow/deny）由
// codex-app-server-driver-approval.test.ts 覆盖。

describe('TDD-13：server request fail-closed（manualApproval=true 未注入 hook → decline）', () => {
  it('commandExecution/requestApproval → 登记 pendingServerRequests + 回写 decline + 上报 approval flat message', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages } = makeCallbacks();
    // manualApproval=true 但不注入 sessionPermission（task-06 接线前）→ fail-closed。
    const handle = (await driver.start(
      queue,
      makeOpts({ manualApproval: true, askUserOnly: false }),
    )) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));

    // 喂 server request（commandExecution requestApproval，id=10）
    emitLines(child, [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'rm -rf /' },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 1. 回写的 response 必须 decline（绝不 accept）
    const response = readStdinJson(child).find(
      (m) => m.id === 10 && !m.method,
    );
    expect(response).toBeDefined();
    expect((response!.result as { decision?: string }).decision).toBe('decline');
    expect(
      (response!.result as { decision?: string }).decision,
    ).not.toBe('accept');

    // 2. 登记到 pendingServerRequests
    expect(handle.pendingServerRequests.length).toBeGreaterThanOrEqual(1);
    expect(
      handle.pendingServerRequests.some(
        (p) => p.id === 10 && p.method === 'item/commandExecution/requestApproval',
      ),
    ).toBe(true);

    // 3. 上报 approval flat message（kind=approval）
    const approvalMsg = messages.find(
      (m) => (m.metadata as { kind?: string })?.kind === 'approval',
    );
    expect(approvalMsg).toBeDefined();

    close();
    emitLines(child, [turnCompletedNotif('cancelled')]);
    child._emitExit(0);
    await consumeP;
  });
});
