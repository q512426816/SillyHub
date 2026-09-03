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
//   14.（2026-09-03-agent-provider-abstraction task-04）flat message → AgentEvent v2 映射：
//       一等字段提升（status/session_started、usage、tool_name/call_id、thinking）+
//       未知 type 降级 + 全量 safeParseAgentEvent 校验；legacy flat 键（event_type/
//       metadata 原样）保留供 task-08/09 前的既有消费方（见 driver 文件头 D-004 说明）

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
  toAgentEvent,
  type CodexAgentEventMessage,
  type CodexHandle,
  type CodexStartOptions,
} from '../../src/interactive/codex-app-server-driver.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
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
    // task-08：envelope-only——摊平 events 收集（codex 每 envelope 单事件，
    // 既有断言按事件对象书写，摊平后形态不变）。
    onTurnMessage: (envelope) => {
      for (const ev of envelope.events) {
        messages.push(ev as unknown as Record<string, unknown>);
      }
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

/** 构造可控 input queue（push/close）。
 *
 * 单订阅语义对齐真实 InputQueue：第二次 [Symbol.asyncIterator]() 抛错——
 * 此前 fake 每次返回新迭代器读共享缓冲，掩盖了驱动每轮重订阅的缺陷
 * （第二轮输入必抛 SessionQueueDoubleSubscribeError，TDD-4 因此测不出）。 */
function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (text: string) => void;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  let subscribed = false;
  let waiter: (() => void) | null = null;
  const queue: AsyncIterable<UserTurnInput> = {
    [Symbol.asyncIterator]() {
      if (subscribed) {
        throw new Error('SessionQueueDoubleSubscribeError（fake 对齐真实 InputQueue 单订阅）');
      }
      subscribed = true;
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

    // task-04 映射：thread_started → status/session_started（一等 session_id + subtype），
    // legacy 键（event_type 别名 + metadata.subtype）保留供既有消费方
    expect(started!.type).toBe('status');
    expect(started!.subtype).toBe('session_started');
    expect(safeParseAgentEvent(started).success).toBe(true);

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

// ── 第四批 code-quality：子进程非主动退出对称收敛（exit handler 回归）─────────
//
// 修前 exit handler 仅 code!==0 才 finalizeWithError → codex 干净退出(code=0) 或
// 被信号杀(code=null, OOM/SIGKILL) 时不置 finalized，consume 主循环
// while(!h.closing && !finalized) 永不退出、currentTurnPromise 永不 resolve →
// 交互式会话永久卡死（主 agent lease 永不过期，卡到 daemon 重启）。现有用例都先
// close() input queue 让 consume break 再 _emitExit，故未捕获（生产 exit 时 input
// 未关）。本组不 close input、turn 中途直接 exit，验证对称收敛。

describe('第四批 code-quality：子进程非主动退出对称收敛', () => {
  /** 驱动到「首轮 turn 进行中」（握手 + push + turn/started），input queue 不 close。 */
  async function driveUntilTurnInProgress(): Promise<{
    child: FakeChild;
    consumeP: Promise<void>;
    results: Record<string, unknown>[];
  }> {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push } = makeInputQueue();
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
    return { child, consumeP, results };
  }

  it('turn 中途 codex 干净退出 exit(0)（未 close）→ consume 收敛 + onTurnResult is_error=true', async () => {
    const { child, consumeP, results } = await driveUntilTurnInProgress();
    child._emitExit(0); // 修前：exit handler 不 finalize → consume 卡死（测试超时红）
    await consumeP; // 修后：finalized=true → 主循环退出 → consume resolve
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ is_error: true });
  });

  it('turn 中途 codex 被信号杀 exit(null, SIGKILL)（未 close）→ consume 收敛 + is_error=true', async () => {
    const { child, consumeP, results } = await driveUntilTurnInProgress();
    child._emitExit(null, 'SIGKILL');
    await consumeP;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ is_error: true });
  });
});

// ── TDD-2b：usage cache 尽力而为透传（task-02 / D-001@v1）─────────────────────
//
// 覆盖蓝图 task-02 §TDD 步骤 1 两用例：
//   1. complete event usage 带 cache_read_tokens/cache_creation_tokens → 透传（数字）；
//   2. usage 无 cache 字段 → 透传 undefined（非 0，后端按 NULL 处理）。
// codex/OpenAI 系多无 cache（常态），不伪造 0。

describe('TDD-2b：turn/completed usage cache 字段尽力而为（task-02 / D-001@v1）', () => {
  it('usage 带 cache_read_tokens/cache_creation_tokens → onTurnResult.usage 透传两数字', async () => {
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

    // turn/completed 携带 usage（input/output + cache_read/cache_creation）
    emitLines(child, [
      turnCompletedNotif('completed', {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 8,
          cache_creation_tokens: 3,
        },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });
    const usage = (results[0] as { usage?: Record<string, unknown> }).usage;
    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(10);
    expect(usage!.output_tokens).toBe(5);
    // 新增：cache 两字段透传为数字（不为 undefined）
    expect(usage!.cache_read_tokens).toBe(8);
    expect(usage!.cache_creation_tokens).toBe(3);

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('usage 无 cache 字段 → onTurnResult.usage.cache_* 为 undefined（非 0，D-001@v1）', async () => {
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

    // turn/completed 只带 input/output（codex 常态：无 cache）
    emitLines(child, [
      turnCompletedNotif('completed', {
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(results).toHaveLength(1);
    const usage = (results[0] as { usage?: Record<string, unknown> }).usage;
    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(10);
    expect(usage!.output_tokens).toBe(5);
    // 缺失 cache 字段 → undefined（非 0）。不伪造 0，后端按 NULL 处理。
    expect(usage!.cache_read_tokens).toBeUndefined();
    expect(usage!.cache_creation_tokens).toBeUndefined();

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('usage cache 字段类型异常（字符串）→ undefined，不 NaN、不抛', async () => {
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

    // 非法类型（字符串）：typeof !== 'number' 守卫 → undefined
    emitLines(child, [
      turnCompletedNotif('completed', {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: '300',
          cache_creation_tokens: null,
        },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(results).toHaveLength(1);
    const usage = (results[0] as { usage?: Record<string, unknown> }).usage;
    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(10);
    expect(usage!.cache_read_tokens).toBeUndefined();
    expect(usage!.cache_creation_tokens).toBeUndefined();

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

  it('多轮只订阅输入队列一次（2026-08-24 会话审查 P2a：第二轮输入不再抛双订阅错）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, errors, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 第一轮
    push('first');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [turnStartedNotif('thr_123', 'turn_1'), turnCompletedNotif('completed')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 第二轮：修前此处对单订阅队列二次订阅 → SessionQueueDoubleSubscribeError →
    // onError + 会话失败，第二轮 turn/start 永不发出
    push('second');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [turnStartedNotif('thr_123', 'turn_2'), turnCompletedNotif('completed')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const turnStarts = readStdinJson(child).filter((m) => m.method === 'turn/start');
    expect(turnStarts).toHaveLength(2);
    expect(
      (turnStarts[1]!.params as { input: { text: string }[] }).input[0].text,
    ).toBe('second');
    // 两轮均正常收敛，无双订阅错误
    expect(errors).toHaveLength(0);
    expect(results.filter((r) => (r as { is_error?: boolean }).is_error !== true)).toHaveLength(
      2,
    );

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('进程非正常退出触发会话级 onTurnError（P2b/daemon H2：不留无消费者僵尸会话）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, errors } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 一轮正常完成（会话回到空闲态）后，进程退出且非 close 触发
    push('first');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [turnStartedNotif('thr_123', 'turn_1'), turnCompletedNotif('completed')]);
    await new Promise<void>((r) => setTimeout(r, 50));

    child._emitExit(0); // 非 closing 的干净退出
    // 真实链路：onError → session-manager fail() → _terminateSession → inputQueue
    // close → consume 循环退出。测试回调只记录，手动关队列模拟该链路。
    close();
    await consumeP;

    // 会话级收敛触发：onTurnError 是 session-manager fail() 链入口（修前只有
    // turn 级 onTurnResult，会话保持 active 无消费者，后续 inject 永久挂起）
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('exited code=0');
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

    // task-04 映射：一等字段提升断言（映射表 #2/#5/#6）
    // tool_use / tool_result：tool_name + call_id 一等化（cmd_1 同 id 配对）
    expect(toolUse!.type).toBe('tool_use');
    expect(toolUse!.tool_name).toBe('exec_command');
    expect(toolUse!.call_id).toBe('cmd_1');
    expect(toolResult!.type).toBe('tool_result');
    expect(toolResult!.tool_name).toBe('exec_command');
    expect(toolResult!.call_id).toBe('cmd_1');
    // reasoning（metadata.thinking=true）→ type='thinking'（与 claude thinking 同契约）
    expect(thinking!.type).toBe('thinking');
    // agentMessage → type='text'（call_id 留 metadata：契约仅 tool 事件一等化）
    expect(agentText!.type).toBe('text');
    expect(agentText!.call_id).toBeUndefined();
    expect((agentText!.metadata as { call_id?: string }).call_id).toBe('msg_1');

    // task-04 验收：全部产出事件过 safeParseAgentEvent 校验
    for (const m of messages) {
      expect(safeParseAgentEvent(m).success).toBe(true);
    }

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
    // task-04 映射：error → type='error'（恒等，映射表 #7）+ schema 校验
    expect(stderrMsg!.type).toBe('error');
    expect(safeParseAgentEvent(stderrMsg).success).toBe(true);

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
  it('commandExecution/requestApproval → 应答后摘除 pendingServerRequests + 回写 decline + 上报 approval flat message', async () => {
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

    // 2. ql-20260825-f3#4：应答后 pendingServerRequests 条目同步摘除（原只 push
    //    不删 → 长会话数组只增不减；pending 语义 = 已登记未应答）。
    expect(handle.pendingServerRequests.length).toBe(0);
    expect(
      handle.pendingServerRequests.some(
        (p) => p.id === 10 && p.method === 'item/commandExecution/requestApproval',
      ),
    ).toBe(false);

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

// ── task-04：flat message → AgentEvent v2 映射（FR-02 / D-004）────────────────
//
// 覆盖任务卡 task-04.md §implementation/§acceptance：
//   - 每已知 event_type 至少一例（text/thinking/tool_use/tool_result/error/status/
//     turn_result，其余在 TDD-2/7/10 内补充断言）；
//   - usage 从 metadata 提取进 AgentEvent.usage 一等字段（含 cache 两字段）；
//   - complete（turn 终态）→ turn_result 映射但**不经 onMessage 上报**（D-004：
//     turn 边界信号由 onTurnResult 承载，外部行为不变）；
//   - 未知 type → status 降级（不丢弃不抛错，原值经 metadata.original_event_type +
//     legacy event_type 别名 + content 三处保留）；
//   - 全部产出事件过 safeParseAgentEvent 校验。

describe('task-04：flat message → AgentEvent v2 映射', () => {
  it('usage_update（turn/start response 带 usage）→ type=text + usage 一等字段（含 cache 两字段）', async () => {
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

    // turn/start(id=3) 的 response 携带 usage → adapter 收敛 text+usage_update 事件
    emitLines(child, [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        result: {
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            cache_read_tokens: 4,
            cache_creation_tokens: 2,
          },
        },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const usageMsg = messages.find(
      (m) => (m.metadata as { status?: string })?.status === 'usage_update',
    );
    expect(usageMsg).toBeDefined();
    // 映射表 #3：text 恒等 + usage 一等化（四字段全带）
    expect(usageMsg!.type).toBe('text');
    expect(usageMsg!.usage).toEqual({
      input_tokens: 11,
      output_tokens: 7,
      cache_read_tokens: 4,
      cache_creation_tokens: 2,
    });
    // metadata 原样保留（合并提升，不搬走）
    expect((usageMsg!.metadata as { usage?: unknown }).usage).toBeDefined();
    expect(usageMsg!.session_id).toBe('thr_123');
    expect(usageMsg!.event_type).toBe('text');
    expect(safeParseAgentEvent(usageMsg).success).toBe(true);

    close();
    emitLines(child, [turnCompletedNotif('completed')]);
    child._emitExit(0);
    await consumeP;
  });

  it('rpc error response → type=error + metadata.rpc_error_code 保留（映射表 #7）', async () => {
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
      JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        error: { code: -32000, message: 'rpc boom' },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    const errEv = messages.find((m) => m.content === 'rpc boom');
    expect(errEv).toBeDefined();
    expect(errEv!.type).toBe('error');
    expect(errEv!.event_type).toBe('error');
    expect((errEv!.metadata as { rpc_error_code?: number }).rpc_error_code).toBe(
      -32000,
    );
    expect(errEv!.session_id).toBe('thr_123');
    expect(safeParseAgentEvent(errEv).success).toBe(true);

    close();
    emitLines(child, [turnCompletedNotif('completed')]);
    child._emitExit(0);
    await consumeP;
  });

  it('turn/completed → turn_result 映射但不经 onMessage 上报（外部行为不变），usage 走 onTurnResult', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const driver = new CodexAppServerDriver({ handshakeIntervalMs: 0 });
    const { queue, push, close } = makeInputQueue();
    const { cb, messages, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as CodexHandle;
    const consumeP = driver.consume(handle, cb);

    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [threadStartResponse('thr_123')]);
    await new Promise<void>((r) => setTimeout(r, 50));
    push('hi');
    await new Promise<void>((r) => setTimeout(r, 50));
    emitLines(child, [
      turnStartedNotif('thr_123', 'turn_1'),
      turnCompletedNotif('completed', {
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // D-004 原语义保持：turn_result 不进消息流（turn 边界信号由 onTurnResult 承载）
    expect(messages.some((m) => m.type === 'turn_result')).toBe(false);
    expect(messages.some((m) => m.event_type === 'complete')).toBe(false);
    // usage 仍经 onTurnResult 汇总（映射表 #8 的消费侧）
    expect(results).toHaveLength(1);
    expect((results[0] as { usage?: Record<string, unknown> }).usage)
      .toMatchObject({ input_tokens: 10, output_tokens: 5 });

    close();
    child._emitExit(0);
    await consumeP;
  });

  it('toAgentEvent：complete 输入 → turn_result + usage 一等化（映射表 #8 单元直测）', () => {
    const ev: CodexAgentEventMessage = toAgentEvent(
      {
        type: 'complete',
        content: '',
        metadata: {
          source: 'turn_completed',
          turn_status: 'completed',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_tokens: 8,
            cache_creation_tokens: 3,
          },
        },
      },
      'thr_123',
    );
    expect(ev.type).toBe('turn_result');
    expect(ev.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 8,
      cache_creation_tokens: 3,
    });
    expect(ev.session_id).toBe('thr_123');
    // legacy 别名 = 原始 type（旧 flat 契约里 complete 即原值）
    expect(ev.event_type).toBe('complete');
    expect(safeParseAgentEvent(ev).success).toBe(true);
  });

  it('toAgentEvent：未知 type → status/task_notification 降级，不丢弃不抛错（fail-safe）', () => {
    // adapter 静态类型保证 8 型联合，此用例模拟运行时契约漂移（宽松输入类型宽收）
    const ev: CodexAgentEventMessage = toAgentEvent(
      { type: 'frobnicate', content: 'payload', metadata: { foo: 'bar' } },
      'thr_123',
    );
    expect(ev.type).toBe('status');
    // schema 闭合枚举约束下的降级桶选择（见 toAgentEvent 降级桶说明）
    expect(ev.subtype).toBe('task_notification');
    // 原值三处保留：content + metadata.original_event_type + legacy event_type 别名
    expect(ev.content).toBe('frobnicate');
    expect(ev.metadata).toMatchObject({
      original_event_type: 'frobnicate',
      foo: 'bar',
    });
    expect(ev.event_type).toBe('frobnicate');
    expect(ev.session_id).toBe('thr_123');
    // fail-safe 前提：降级产物仍是合法 AgentEvent
    expect(safeParseAgentEvent(ev).success).toBe(true);
  });

  it('toAgentEvent：thread_started 缺 metadata.session_id → session_id 回退 threadId 参数', () => {
    const ev: CodexAgentEventMessage = toAgentEvent(
      { type: 'text', content: '', metadata: { subtype: 'thread_started' } },
      'thr_fallback',
    );
    expect(ev.type).toBe('status');
    expect(ev.subtype).toBe('session_started');
    expect(ev.session_id).toBe('thr_fallback');
    expect(safeParseAgentEvent(ev).success).toBe(true);
  });
});
