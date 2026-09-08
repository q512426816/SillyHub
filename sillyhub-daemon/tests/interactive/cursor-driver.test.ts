// tests/interactive/cursor-driver.test.ts
// 2026-09-08-cursor-interactive-session task-04：CursorDriver 生命周期 /
// 多轮 --resume / interrupt / envelope-only / E3 / E5 / 异常收敛 / Windows shim。
//
// 依据：tasks/task-04.md acceptance ①-⑧、design.md L85-97 / L184 生命周期表、
// D-003@v2 恒带 --force --trust + model 缺省 auto。
// spawn 桩注入 FakeChild（tests/helpers/fake-child.ts），不依赖真实 cursor-agent。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../../src/cmd-shim.js', () => ({
  resolveWindowsCmdShim: vi.fn(() => null),
}));

import { spawn } from 'node:child_process';
import { resolveWindowsCmdShim } from '../../src/cmd-shim.js';
import {
  CursorDriver,
  CursorExecutableNotFoundError,
  type CursorDriverStartOptions,
} from '../../src/interactive/cursor-driver.js';
import type {
  InteractiveDriverCallbacks,
  InteractiveDriverResult,
  TurnMessageEnvelope,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import {
  createFakeChild,
  type FakeChild,
} from '../helpers/fake-child.js';

const EXE = '/usr/local/bin/cursor-agent';
const CWD = '/tmp/cursor-ws';
const SESSION_ID = 'c482aaa1-d2c7-4ec8-816b-6157ef58800f';

function isKillerCommand(command: unknown): boolean {
  const cmd = String(command);
  return cmd === 'taskkill' || cmd.endsWith('taskkill.exe');
}

/** 收集 agent spawn（排除 interrupt/close 的 taskkill）。 */
function agentSpawnCalls(): unknown[][] {
  return vi.mocked(spawn).mock.calls.filter((c) => !isKillerCommand(c[0]));
}

function makeOpts(
  overrides: Partial<CursorDriverStartOptions> = {},
): CursorDriverStartOptions {
  return {
    cwd: CWD,
    pathToAgentExecutable: EXE,
    ...overrides,
  };
}

function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  envelopes: TurnMessageEnvelope[];
  results: InteractiveDriverResult[];
  errors: unknown[];
} {
  const envelopes: TurnMessageEnvelope[] = [];
  const results: InteractiveDriverResult[] = [];
  const errors: unknown[] = [];
  const cb: InteractiveDriverCallbacks = {
    onTurnMessage: (envelope) => {
      envelopes.push(envelope);
    },
    onTurnResult: (r) => {
      results.push(r);
    },
    onTurnError: (e) => {
      errors.push(e);
    },
  };
  return { cb, envelopes, results, errors };
}

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

function createKillerChild(): FakeChild {
  const child = createFakeChild();
  queueMicrotask(() => child._emitExit(0));
  return child;
}

let agentChildren: FakeChild[] = [];
let nextPid = 20000;

function installSpawnMock(): void {
  agentChildren = [];
  nextPid = 20000;
  vi.mocked(spawn).mockImplementation((command: string) => {
    if (isKillerCommand(command)) {
      return createKillerChild() as never;
    }
    const child = createFakeChild();
    child.pid = nextPid++;
    agentChildren.push(child);
    return child as never;
  });
}

async function waitForAgentSpawnCount(n: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (agentChildren.length >= n) {
      await new Promise<void>((r) => setImmediate(r));
      return;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error(`waitForAgentSpawnCount: ${timeoutMs}ms 内 agent spawn 未达 ${n} 次`);
}

async function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error('waitUntil timeout');
}

function systemInitLine(sessionId = SESSION_ID): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'Auto',
    permissionMode: 'default',
  });
}

function assistantLine(text: string, sessionId = SESSION_ID): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: sessionId,
  });
}

function resultLine(
  sessionId = SESSION_ID,
  usage: Record<string, number> = {
    inputTokens: 10,
    outputTokens: 4,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
  },
): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'OK.',
    session_id: sessionId,
    usage,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
  installSpawnMock();
  delete process.env.SILLYHUB_DEBUG_RAW_EVENTS;
});

afterEach(() => {
  delete process.env.SILLYHUB_DEBUG_RAW_EVENTS;
});

describe('CursorDriver start 边界', () => {
  it('空 pathToAgentExecutable 抛 CursorExecutableNotFoundError（code=CURSOR_EXECUTABLE_NOT_FOUND）', async () => {
    const driver = new CursorDriver();
    await expect(
      driver.start(makeInputQueue().queue, makeOpts({ pathToAgentExecutable: '' })),
    ).rejects.toMatchObject({
      name: 'CursorExecutableNotFoundError',
      code: 'CURSOR_EXECUTABLE_NOT_FOUND',
    });
    await expect(
      driver.start(makeInputQueue().queue, makeOpts({ pathToAgentExecutable: '   ' })),
    ).rejects.toBeInstanceOf(CursorExecutableNotFoundError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('start() 不 spawn；handle.provider=cursor 且 processId 为 undefined（E5）', async () => {
    const driver = new CursorDriver();
    const handle = await driver.start(makeInputQueue().queue, makeOpts());
    expect(spawn).not.toHaveBeenCalled();
    expect(handle.provider).toBe('cursor');
    expect(handle.processId).toBeUndefined();
  });
});

describe('① 生命周期：首轮 spawn 参数序 + 空文本跳过 + stdin 不写', () => {
  it('首轮参数为 -p / --output-format stream-json / --trust / --force / --model auto / prompt；stdin 空', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('hello world');
    await waitForAgentSpawnCount(1);
    expect(handle.processId).toBe(agentChildren[0]!.pid);
    expect(handle.provider).toBe('cursor');

    const [command, args, spawnOpts] = agentSpawnCalls()[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe(EXE);
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--force',
      '--model',
      'auto',
      'hello world',
    ]);
    expect(spawnOpts).toEqual(
      expect.objectContaining({
        cwd: CWD,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      }),
    );

    const child = agentChildren[0]!;
    child._emitLines([systemInitLine(), assistantLine('OK.'), resultLine()]);
    child._emitExit(0);
    await waitUntil(() => results.length === 1);
    const stdinChunks = (child as unknown as { _stdinChunks?: Buffer[] })._stdinChunks ?? [];
    expect(Buffer.concat(stdinChunks).toString('utf-8')).toBe('');

    close();
    await consumeP;
    expect(handle.processId).toBeUndefined();
  });

  it('options.model 有值时用该模型，不追加 auto', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts({ model: 'gpt-5' }));
    const consumeP = driver.consume(handle, cb);
    push('ping');
    await waitForAgentSpawnCount(1);
    const args = agentSpawnCalls()[0]![1] as string[];
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--force',
      '--model',
      'gpt-5',
      'ping',
    ]);
    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    close();
    await consumeP;
  });

  it('空文本 turn 跳过不 spawn（E1）', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('');
    push('   ');
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(agentSpawnCalls()).toHaveLength(0);

    push('real');
    await waitForAgentSpawnCount(1);
    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    close();
    await consumeP;
    expect(agentSpawnCalls()).toHaveLength(1);
  });
});

describe('② 多轮 + chatId：第二轮 --resume；result+exit0 携 usage/session_id', () => {
  it('第二轮含 --resume <首轮捕获 chatId>；onTurnResult 携 usage 短名 + session_id', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('remember Zebra-42');
    await waitForAgentSpawnCount(1);
    agentChildren[0]!._emitLines([
      systemInitLine(SESSION_ID),
      assistantLine('OK.'),
      resultLine(SESSION_ID),
    ]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        subtype: 'success',
        is_error: false,
        session_id: SESSION_ID,
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cache_read_tokens: 2,
          cache_creation_tokens: 1,
        },
      }),
    );
    expect(results[0]!.usage).not.toHaveProperty('ctx_tokens');
    expect(handle.processId).toBeUndefined();

    push('what is the code?');
    await waitForAgentSpawnCount(2);
    const args2 = agentSpawnCalls()[1]![1] as string[];
    const resumeAt = args2.indexOf('--resume');
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(args2[resumeAt + 1]).toBe(SESSION_ID);
    expect(args2).toContain('what is the code?');

    agentChildren[1]!._emitLines([
      assistantLine('Zebra-42'),
      resultLine(SESSION_ID, {
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ]);
    agentChildren[1]!._emitExit(0);
    await waitUntil(() => results.length === 2);
    expect(results[1]).toEqual(
      expect.objectContaining({
        subtype: 'success',
        is_error: false,
        session_id: SESSION_ID,
      }),
    );
    close();
    await consumeP;
  });
});

describe('③ interrupt：进行中 kill → error_during_execution；无 child → false', () => {
  it('进行中 interrupt 杀进程树并以 error_during_execution / is_error=true 收敛，返回 true', async () => {
    const driver = new CursorDriver({ killGraceMs: 5 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('long turn');
    await waitForAgentSpawnCount(1);
    const child = agentChildren[0]!;
    expect(handle.processId).toBe(child.pid);

    const ok = await driver.interrupt(handle);
    expect(ok).toBe(true);
    await waitUntil(() => results.length === 1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        subtype: 'error_during_execution',
        is_error: true,
      }),
    );

    if (process.platform === 'win32') {
      expect(vi.mocked(spawn).mock.calls.some((c) => (
        c[0] === 'taskkill'
        && Array.isArray(c[1])
        && c[1][0] === '/PID'
        && c[1][1] === String(child.pid)
        && c[1][2] === '/T'
        && c[1][3] === '/F'
      ))).toBe(true);
    }

    child._emitExit(1);
    await waitUntil(() => handle.processId === undefined);
    expect(results).toHaveLength(1);

    close();
    await consumeP;
  });

  it('无 child / null handle → false 不冒泡（E3）', async () => {
    const driver = new CursorDriver();
    expect(await driver.interrupt(null)).toBe(false);
    const handle = await driver.start(makeInputQueue().queue, makeOpts());
    expect(await driver.interrupt(handle)).toBe(false);
  });
});

describe('④ envelope-only：onTurnMessage 恒 events 数组、默认不带 raw', () => {
  it('每帧 envelope.events 为数组且默认无 raw', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, envelopes, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('hi');
    await waitForAgentSpawnCount(1);
    agentChildren[0]!._emitLines([
      systemInitLine(),
      assistantLine('OK.'),
      resultLine(),
    ]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);

    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) {
      expect(Array.isArray(env.events)).toBe(true);
      expect(env).not.toHaveProperty('raw');
    }
    const types = envelopes.flatMap((e) => e.events.map((ev) => ev.type));
    expect(types).toContain('status');
    expect(types).toContain('text');
    expect(types).toContain('turn_result');

    close();
    await consumeP;
  });
});

describe('⑤ E3：spawn error → onTurnError 不吞', () => {
  it('子进程 error 事件上报 onTurnError 并以 error result 收敛', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results, errors } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);

    push('boom');
    await waitForAgentSpawnCount(1);
    const err = new Error('spawn ENOENT');
    agentChildren[0]!._emitError(err);
    await waitUntil(() => errors.length >= 1);
    expect(errors[0]).toBe(err);
    await waitUntil(() => results.length === 1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        subtype: 'error_during_execution',
        is_error: true,
      }),
    );
    expect(handle.processId).toBeUndefined();
    close();
    await consumeP;
  });
});

describe('⑥ E5：provider 恒 cursor；processId spawn 后更新、收敛后 undefined', () => {
  it('spawn 后 processId=child.pid，收敛后 undefined，provider 始终 cursor', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    expect(handle.provider).toBe('cursor');
    expect(handle.processId).toBeUndefined();

    const consumeP = driver.consume(handle, cb);
    push('one');
    await waitForAgentSpawnCount(1);
    expect(handle.provider).toBe('cursor');
    expect(handle.processId).toBe(agentChildren[0]!.pid);

    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    expect(handle.processId).toBeUndefined();
    expect(handle.provider).toBe('cursor');

    close();
    await consumeP;
  });
});

describe('⑦ 异常收敛：exit≠0 无 result → is_error；exit=0 无 result → 正常缺省 usage', () => {
  it('exit≠0 且无 result 帧 → subtype=error_during_execution 且 is_error=true', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);
    push('fail');
    await waitForAgentSpawnCount(1);
    agentChildren[0]!._emitStderr('boom');
    agentChildren[0]!._emitExit(2);
    await waitUntil(() => results.length === 1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        subtype: 'error_during_execution',
        is_error: true,
      }),
    );
    close();
    await consumeP;
  });

  it('exit=0 且无 result 帧 → 正常收敛，usage 缺省', async () => {
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);
    push('ok-no-result');
    await waitForAgentSpawnCount(1);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    expect(results[0]?.subtype).toBe('success');
    expect(results[0]?.is_error).toBe(false);
    expect(results[0]?.usage).toBeUndefined();
    close();
    await consumeP;
  });
});

describe('⑧ Windows shim：.cmd prependArgs / .ps1 powershell 包装 / 解析失败 shell=true', () => {
  it('.cmd 解析后 shell=false 且 prependArgs 前置', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(resolveWindowsCmdShim).mockReturnValue({
      exe: 'C:\\nvm4w\\nodejs\\node.exe',
      prependArgs: ['C:\\cursor\\index.js'],
    });
    const cmdPath = 'C:\\nvm4w\\nodejs\\cursor-agent.cmd';
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts({ pathToAgentExecutable: cmdPath }));
    const consumeP = driver.consume(handle, cb);
    push('shim-cmd');
    await waitForAgentSpawnCount(1);

    expect(resolveWindowsCmdShim).toHaveBeenCalledWith(cmdPath);
    const [command, args, spawnOpts] = agentSpawnCalls()[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe('C:\\nvm4w\\nodejs\\node.exe');
    expect(args.slice(0, 2)).toEqual(['C:\\cursor\\index.js', '-p']);
    expect(args.at(-1)).toBe('shim-cmd');
    expect(spawnOpts).toEqual(expect.objectContaining({ shell: false, windowsHide: true }));

    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    close();
    await consumeP;
    platformSpy.mockRestore();
  });

  it('.ps1 显式 powershell -NoProfile -ExecutionPolicy Bypass -File 包装', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const ps1 = 'C:\\Users\\qinyi\\cursor-agent.ps1';
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts({ pathToAgentExecutable: ps1 }));
    const consumeP = driver.consume(handle, cb);
    push('shim-ps1');
    await waitForAgentSpawnCount(1);

    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const expectedExe = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const [command, args, spawnOpts] = agentSpawnCalls()[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe(expectedExe);
    expect(args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
    ]);
    expect(args).toContain('shim-ps1');
    expect(spawnOpts).toEqual(expect.objectContaining({ shell: false }));
    expect(resolveWindowsCmdShim).not.toHaveBeenCalled();

    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    close();
    await consumeP;
    platformSpy.mockRestore();
  });

  it('.cmd 解析失败回退 shell=true', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
    const cmdPath = 'C:\\nvm4w\\nodejs\\cursor-agent.cmd';
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts({ pathToAgentExecutable: cmdPath }));
    const consumeP = driver.consume(handle, cb);
    push('shim-fallback');
    await waitForAgentSpawnCount(1);

    const [command, args, spawnOpts] = agentSpawnCalls()[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe(cmdPath);
    expect(args.at(-1)).toBe('shim-fallback');
    expect(spawnOpts).toEqual(expect.objectContaining({ shell: true }));

    agentChildren[0]!._emitLines([resultLine()]);
    agentChildren[0]!._emitExit(0);
    await waitUntil(() => results.length === 1);
    close();
    await consumeP;
    platformSpy.mockRestore();
  });

  it('DA-1（ql-20260908-006）：shim 失败回退 shell=true 且 prompt 含元字符 → 拒绝 spawn、按轮次 error 收敛', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
    const cmdPath = 'C:\\nvm4w\\nodejs\\cursor-agent.cmd';
    const driver = new CursorDriver();
    const { queue, push, close } = makeInputQueue();
    const { cb, results, errors } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts({ pathToAgentExecutable: cmdPath }));
    const consumeP = driver.consume(handle, cb);
    push('echo hi & del /s C:\\');
    await waitUntil(() => results.length === 1);

    expect(agentSpawnCalls()).toHaveLength(0); // 未进入 spawn
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('DA-1');
    expect(results[0]).toMatchObject({ subtype: 'error_during_execution', is_error: true });
    close();
    await consumeP;
    platformSpy.mockRestore();
  });
});

describe('close() 幂等且不动 input 队列（E4 / E7）', () => {
  it('连续 close 不抛；队列仍可继续 push', async () => {
    const driver = new CursorDriver({ killGraceMs: 5 });
    const { queue, push, close } = makeInputQueue();
    const handle = await driver.start(queue, makeOpts());
    await handle.close?.();
    await handle.close?.();
    push('still-open');
    close();
  });
});

describe('⑨ stdout/exit 竞态（ql-20260908-007）：exit 先到时等 stdout 排空再收敛', () => {
  it('exit 先于数据到达：迟到 result 帧不丢（result/usage 完整上报）', async () => {
    const driver = new CursorDriver({ killGraceMs: 2000 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);
    push('race-turn');
    await waitForAgentSpawnCount(1);

    const child = agentChildren[0]!;
    // 绕过 _emitExit（它先 push(null) 结束流，模拟的是理想时序）——直接发 exit
    // 事件且保持流打开，复现「exit 到达时 stdout 尚有未送达字节」的乱序形态
    //（Node 文档行为：exit 不保证 stdio 已排空，Windows 管道/大输出下可发生）。
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await new Promise<void>((r) => setImmediate(r)); // 让实现层 race 解析到 exit outcome
    child._emitLines([resultLine()]); // 迟到的 result 帧（真实场景为管道残余字节）
    child._endStdout(); // 流排空结束

    await waitUntil(() => results.length === 1);
    expect(results[0]).toMatchObject({
      subtype: 'success',
      is_error: false,
      result: 'OK.',
    });
    expect(results[0].usage).toMatchObject({ input_tokens: 10, output_tokens: 4 });
    close();
    await consumeP;
  });

  it('宽限兜底：exit 后流迟迟不 end，超时按已解析内容收敛不挂死整轮', async () => {
    const driver = new CursorDriver({ killGraceMs: 60 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);
    push('grace-turn');
    await waitForAgentSpawnCount(1);

    const child = agentChildren[0]!;
    child.exitCode = 0;
    child.emit('exit', 0, null);
    // 不 _endStdout——流保持打开（僵流形态），宽限超时后按已解析内容收敛。
    await waitUntil(() => results.length === 1, 3000);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });
    close();
    await consumeP;
  });

  it('ql-20260909-002 排空超时收敛：迟到帧不再外发（监听摘除+流销毁），不错轮归因', async () => {
    const driver = new CursorDriver({ killGraceMs: 40 });
    const { queue, push, close } = makeInputQueue();
    const { cb, results, envelopes } = makeCallbacks();
    const handle = await driver.start(queue, makeOpts());
    const consumeP = driver.consume(handle, cb);
    push('late-frame-turn');
    await waitForAgentSpawnCount(1);

    const child = agentChildren[0]!;
    child._emitLines([assistantLine('partial')]); // 收敛前已解析内容
    child.exitCode = 0;
    child.emit('exit', 0, null);
    // 不 _endStdout——僵流形态，宽限超时后按已解析内容收敛
    await waitUntil(() => results.length === 1, 3000);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    // 收敛后旧流再推帧（孙进程持有管道写端、迟到字节形态）——监听已摘除+流已
    // 销毁：迟到帧不得经 onTurnMessage/onTurnResult 外发（否则会记到下一轮名下）
    expect(child.stdout.destroyed).toBe(true);
    const envelopesBefore = envelopes.length;
    child._emitLines([resultLine()]);
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    expect(envelopes.length).toBe(envelopesBefore);
    expect(results.length).toBe(1);
    close();
    await consumeP;
  });
});
