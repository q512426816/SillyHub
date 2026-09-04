// tests/interactive/pi-rpc-driver.test.ts
// 2026-09-04-provider-pi-onboarding task-02：PiRpcDriver 核心生命周期测试。
//
// 依据：tasks/task-02.md（LF 分帧/命令收发/契约/get_state 握手/退出收敛）、
// design.md §5.1（B-03 session_started 合成 / B-05 agent_settled 边界）、
// pi 包 docs/rpc.md（分帧:30-37 / get_state:162-190 / 命令面）。
// 用 tests/helpers/fake-child.ts 驱动 spawn 的 stdin/stdout，不依赖真实 pi 二进制。
//
// 收尾约定：consume 主循环阻塞在 inputIt.next() 上，只有 close 输入队列才能
// 让循环自然退出（codex 测试同款手法）；driver.handle.close 由 consume finally
// 自行调用，测试不抢跑。
//
// 覆盖点（与任务卡 implementation/acceptance 对齐）：
//   1. LF 分帧器（LfLineFramer 单元）：多行切分 / 尾部 \r 剥离 / 跨 chunk 多字节
//      UTF-8 / **U+2028+U+2029 在 JSON 字符串内不切分**（readline 不合规锚点）/
//      end() 冲刷无换行残行；
//   2. spawn 参数面：--mode rpc --session-dir 隔离目录 / --model / resume --session /
//      Windows pi.cmd shim 解析与 shell 兜底（R-05）/ executable 缺失；
//   3. get_state 握手：session_started 合成（status/session_started + session_id，
//      过 safeParseAgentEvent）/ handle.sessionId 回填 / isStreaming 初始值；
//   4. 命令关联：prompt id 关联 resolve / success:false reject → error 事件 +
//      turn error 收敛（不挂死，后续输入继续）；
//   5. turn 生命周期：agent_start/message_update/turn_end usage/agent_settled →
//      事件流上报 + onTurnResult(success + session_id + usage)；多轮串行；
//   6. isStreaming 维护 + streaming 态 prompt 带 streamingBehavior:'steer'；
//   7. 子进程非正常退出 → onError 会话级 fail + turn error 收敛（不挂死）；
//   8. 握手超时 → error 事件，会话通道仍可用；
//   9. 容错：坏 JSON 行 / 无主 response 不崩不产事件；空输入跳过（E1）；
//  10. interrupt：streaming 态发 abort 返回 true / 非 streaming 返回 false；
//  11. U+2028 全链路（分帧 + 归一化）：含 U+2028 的 text_delta → 单条 text 事件。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// mock node:child_process.spawn —— driver 内部用 spawn，注入 FakeChild。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

// mock cmd-shim：driver 仅对 .cmd 调 resolveWindowsCmdShim；默认 null（非 .cmd
// 路径不触发），wrapper 用例内 override。
vi.mock('../../src/cmd-shim.js', () => ({
  resolveWindowsCmdShim: vi.fn(() => null),
}));

import { spawn } from 'node:child_process';
import { resolveWindowsCmdShim } from '../../src/cmd-shim.js';
import {
  LfLineFramer,
  PiExecutableNotFoundError,
  PiRpcDriver,
  piRpcSessionDir,
  type PiRpcHandle,
  type PiStartOptions,
} from '../../src/interactive/pi-rpc-driver.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import type { AgentEvent } from '../../src/types.js';
import type {
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import {
  createFakeChild,
  waitForSpawn,
  type FakeChild,
} from '../helpers/fake-child.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

/** 共享 tmp session-dir（构造注入，避免写真 daemon 状态目录）。 */
let tmpSessionDir: string;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (tmpSessionDir) {
    await rm(tmpSessionDir, { recursive: true, force: true }).catch(() => {});
    tmpSessionDir = '';
  }
});

/** 最小 PiStartOptions（spawn 已 mock，不产真进程）。 */
function makeOpts(overrides: Partial<PiStartOptions> = {}): PiStartOptions {
  return {
    cwd: '/tmp/pi-ws',
    pathToAgentExecutable: '/usr/local/bin/pi',
    ...overrides,
  };
}

/** 构造 callbacks 收集器：onTurnMessage/onTurnResult/onTurnError 全记录。 */
function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  events: AgentEvent[];
  results: Record<string, unknown>[];
  errors: unknown[];
} {
  const events: AgentEvent[] = [];
  const results: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const cb: InteractiveDriverCallbacks = {
    onTurnMessage: (envelope) => {
      for (const ev of envelope.events) events.push(ev);
    },
    onTurnResult: (r) => {
      results.push(r as unknown as Record<string, unknown>);
    },
    onTurnError: (e) => {
      errors.push(e);
    },
  };
  return { cb, events, results, errors };
}

/** 构造可控 input queue（push/close；单订阅语义对齐真实 InputQueue）。 */
function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (text: string, blocks?: UserTurnInput['blocks']) => void;
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
    push(text, blocks) {
      pending.push(blocks ? { type: 'user', text, blocks } : { type: 'user', text });
      if (waiter) waiter();
    },
    close() {
      closed = true;
      if (waiter) waiter();
    },
  };
}

/** 让出若干 ms（fake child 事件时序用，codex 测试同款手法）。 */
async function tick(ms = 30): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

/** 从 FakeChild stdin 解析出所有已写入的 JSON 行。 */
function readStdinJson(child: FakeChild): Record<string, unknown>[] {
  const text = (child as unknown as { _stdinChunks?: Buffer[] })._stdinChunks ?? [];
  return Buffer.concat(text)
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 给 FakeChild stdout 推一个 pi 事件行。 */
function emitEvent(child: FakeChild, evt: Record<string, unknown>): void {
  child.stdout.push(JSON.stringify(evt) + '\n');
}

/** 给 stdout 推一个原始行（不 JSON 化——坏行用例需控制字节面）。 */
function emitRaw(child: FakeChild, line: string): void {
  child.stdout.push(line + '\n');
}

/**
 * 应答 stdin 里最新一条指定 type 的命令（response 按 id 回关联）。
 * rpc.md:23-26——response 带 id，事件不带。
 */
function respond(
  child: FakeChild,
  cmdType: string,
  resp: { success?: boolean; data?: unknown; error?: string } = {},
): void {
  const lines = readStdinJson(child);
  const req = [...lines]
    .reverse()
    .find((l) => l.type === cmdType && typeof l.id === 'string');
  if (!req) throw new Error(`respond: stdin 无待应答 ${cmdType} 命令`);
  child.stdout.push(
    JSON.stringify({
      id: req.id,
      type: 'response',
      command: cmdType,
      success: resp.success !== false,
      ...(resp.data !== undefined ? { data: resp.data } : {}),
      ...(resp.error !== undefined ? { error: resp.error } : {}),
    }) + '\n',
  );
}

/** 建临时 session-dir 并返回带注入的 driver。 */
async function makeDriver(
  opts: { handshakeTimeoutMs?: number; requestTimeoutMs?: number } = {},
): Promise<PiRpcDriver> {
  tmpSessionDir = await mkdtemp(join(tmpdir(), 'pi-rpc-test-'));
  return new PiRpcDriver({ sessionDir: tmpSessionDir, ...opts });
}

/** get_state 成功应答（握手）。 */
function handshakeOk(child: FakeChild, extra: Record<string, unknown> = {}): void {
  respond(child, 'get_state', {
    data: { sessionId: 'sess_pi_1', isStreaming: false, ...extra },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LF 分帧器（LfLineFramer 单元）
// ─────────────────────────────────────────────────────────────────────────────

describe('LfLineFramer：LF 严格分帧（rpc.md:30-37）', () => {
  it('多行切分 + 尾部 \\r 剥离', () => {
    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    f.push('{"a":1}\r\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('跨 chunk 多字节 UTF-8 不烂（半个中文字符分属两个 Buffer）', () => {
    const full = Buffer.from('{"msg":"你好"}\n', 'utf8');
    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    f.push(full.subarray(0, 10));
    f.push(full.subarray(10));
    expect(lines).toEqual(['{"msg":"你好"}']);
  });

  it('U+2028/U+2029 在 JSON 字符串内不切分（readline 不合规锚点）', () => {
    // JSON.stringify 不转义 U+2028/29（JSON 语法内合法），线上是字面多字节序列
    const content = 'abc\u2028def\u2029ghi';
    const wire = JSON.stringify({ type: 'text', content });
    expect(wire).toContain('\u2028');
    expect(wire).toContain('\u2029');

    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    f.push(Buffer.from(wire + '\n', 'utf8'));
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as { content: string }).content).toBe(content);
  });

  it('U+2028 前后各有正常 LF 行时边界精确', () => {
    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    const mid = JSON.stringify({ c: 'x\u2028y' });
    f.push('{"n":1}\n' + mid + '\n{"n":2}\n');
    expect(lines).toEqual(['{"n":1}', mid, '{"n":2}']);
  });

  it('end() 冲刷无换行残行（decoder 尾字节一并冲）', () => {
    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    const full = Buffer.from('{"n":1}\n{"tail":"尾"', 'utf8');
    f.push(full.subarray(0, 8));
    f.push(full.subarray(8));
    f.end();
    expect(lines).toEqual(['{"n":1}', '{"tail":"尾"']);
  });

  it('空行原样回调（归一化器自会 trim 跳过）', () => {
    const lines: string[] = [];
    const f = new LfLineFramer((l) => lines.push(l));
    f.push('\n{"a":1}\n\n');
    expect(lines).toEqual(['', '{"a":1}', '']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. spawn 参数面 / executable 校验 / session-dir 隔离
// ─────────────────────────────────────────────────────────────────────────────

describe('spawn 参数面（design §5.1）', () => {
  it('--mode rpc + --session-dir 隔离目录，非 .cmd 不调 resolveWindowsCmdShim', async () => {
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(makeInputQueue().queue, makeOpts());
    await waitForSpawn();

    expect(resolveWindowsCmdShim).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      ['--mode', 'rpc', '--session-dir', tmpSessionDir],
      expect.objectContaining({
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/tmp/pi-ws',
      }),
    );
  });

  it('model/resume 透传：--model <m> + --session <id>（pi 实读 CLI 修正 design 笔误）', async () => {
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(
      makeInputQueue().queue,
      makeOpts({ model: 'anthropic/claude-sonnet-4', resume: 'sess_old' }),
    );
    await waitForSpawn();

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      [
        '--mode', 'rpc',
        '--session-dir', tmpSessionDir,
        '--model', 'anthropic/claude-sonnet-4',
        '--session', 'sess_old',
      ],
      expect.anything(),
    );
  });

  it('env 透传（凭证走既有 spawn-env 链：opts.env 优先，缺省 process.env）', async () => {
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(makeInputQueue().queue, makeOpts({ env: { PI_TEST: '1' } }));
    await waitForSpawn();
    expect(spawn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ env: { PI_TEST: '1' } }),
    );
  });

  it.skipIf(process.platform !== 'win32')(
    'Windows pi.cmd → resolveWindowsCmdShim 解析为 node + pi.js，shell=false（R-05）',
    async () => {
      vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
      vi.mocked(resolveWindowsCmdShim).mockReturnValue({
        exe: 'C:\\nvm4w\\nodejs\\node.exe',
        prependArgs: [
          'C:\\nvm4w\\nodejs\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js',
        ],
      });
      const driver = await makeDriver();
      await driver.start(
        makeInputQueue().queue,
        makeOpts({ pathToAgentExecutable: 'C:\\nvm4w\\nodejs\\pi.cmd' }),
      );
      await waitForSpawn();

      expect(resolveWindowsCmdShim).toHaveBeenCalledWith('C:\\nvm4w\\nodejs\\pi.cmd');
      expect(spawn).toHaveBeenCalledWith(
        'C:\\nvm4w\\nodejs\\node.exe',
        [
          'C:\\nvm4w\\nodejs\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js',
          '--mode', 'rpc',
          '--session-dir', tmpSessionDir,
        ],
        expect.objectContaining({ shell: false }),
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'pi.cmd 解析失败(null) → 回退 shell:true 兜底',
    async () => {
      vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
      vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
      const driver = await makeDriver();
      await driver.start(
        makeInputQueue().queue,
        makeOpts({ pathToAgentExecutable: 'C:\\nvm4w\\nodejs\\pi.cmd' }),
      );
      await waitForSpawn();
      expect(spawn).toHaveBeenCalledWith(
        'C:\\nvm4w\\nodejs\\pi.cmd',
        expect.arrayContaining(['--mode', 'rpc']),
        expect.objectContaining({ shell: true }),
      );
    },
  );

  it('executable 缺失 → PiExecutableNotFoundError，不 spawn', async () => {
    const driver = await makeDriver();
    await expect(
      driver.start(makeInputQueue().queue, makeOpts({ pathToAgentExecutable: '' })),
    ).rejects.toThrow(/PI_EXECUTABLE_NOT_FOUND/);
    expect((spawn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('executable 缺失错误带 code=PI_EXECUTABLE_NOT_FOUND 且为具名类型', async () => {
    const driver = await makeDriver();
    try {
      await driver.start(makeInputQueue().queue, makeOpts({ pathToAgentExecutable: '   ' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PiExecutableNotFoundError);
      expect((e as PiExecutableNotFoundError).code).toBe('PI_EXECUTABLE_NOT_FOUND');
    }
  });

  it('piRpcSessionDir：SILLYHUB_DAEMON_DIR 隔离覆盖生效（daemon 状态目录收口锚）', () => {
    const prev = process.env.SILLYHUB_DAEMON_DIR;
    const isoDir = join(tmpdir(), 'pi-iso-check');
    process.env.SILLYHUB_DAEMON_DIR = isoDir;
    try {
      expect(piRpcSessionDir()).toBe(join(isoDir, 'runs', 'pi-sessions'));
    } finally {
      if (prev === undefined) delete process.env.SILLYHUB_DAEMON_DIR;
      else process.env.SILLYHUB_DAEMON_DIR = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. get_state 握手（B-03 session_started 合成）
// ─────────────────────────────────────────────────────────────────────────────

describe('get_state 握手 → session_started 合成', () => {
  it('首条命令是 get_state；应答后合成 status/session_started（含 session_id，过 schema）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, close: closeQueue } = makeInputQueue();
    const { cb, events } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();

    // 首条 stdin 命令 = get_state（带 id，供 response 关联）
    const first = readStdinJson(child)[0]!;
    expect(first.type).toBe('get_state');
    expect(typeof first.id).toBe('string');

    handshakeOk(child);
    await tick();

    const started = events.find(
      (e) => e.type === 'status' && e.subtype === 'session_started',
    );
    expect(started).toBeDefined();
    expect(started!.session_id).toBe('sess_pi_1');
    expect(safeParseAgentEvent(started!).success).toBe(true);
    expect(handle.sessionId).toBe('sess_pi_1');
    expect(handle.provider).toBe('pi'); // E5：handle 归属标识

    closeQueue();
    await consumeP;
  });

  it('握手超时 → error 事件上报，通道不挂死（后续 prompt 正常走）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver({ handshakeTimeoutMs: 60 });
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);

    await tick(150); // 等握手超时触发
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
    expect(errEv!.content).toContain('get_state');
    expect(handle.sessionId).toBeNull();

    // 通道仍活：push 一条输入 → prompt 正常发出并收敛
    push('hi');
    await tick();
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    const prompts = readStdinJson(child).filter((l) => l.type === 'prompt');
    expect(prompts).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. turn 生命周期（命令关联 resolve / 事件流 / agent_settled 收敛）
// ─────────────────────────────────────────────────────────────────────────────

describe('turn 生命周期', () => {
  it('prompt id 关联 + 事件流上报 + agent_settled 收敛 onTurnResult(success)', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('你好 pi');
    await tick();
    const prompt = readStdinJson(child).find((l) => l.type === 'prompt')!;
    expect(prompt.message).toBe('你好 pi');
    expect(typeof prompt.id).toBe('string');

    // 应答 + 完整事件流（agent_start → text_delta → turn_end usage → agent_settled）
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'pi 回复' },
    });
    emitEvent(child, {
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: [],
        usage: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2 },
      },
    });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    // 归一化事件：text 直通 + usage 快照（均过 schema）
    const text = events.find((e) => e.type === 'text' && e.content === 'pi 回复');
    expect(text).toBeDefined();
    expect(safeParseAgentEvent(text!).success).toBe(true);
    const usageEv = events.find((e) => e.type === 'text' && e.usage !== undefined);
    expect(usageEv?.usage).toEqual({
      input_tokens: 11,
      output_tokens: 7,
      cache_read_tokens: 3,
      cache_creation_tokens: 2,
    });

    // turn 收敛：success + session_id + usage
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'success',
      is_error: false,
      session_id: 'sess_pi_1',
    });
    expect(results[0]!.usage).toEqual({
      input_tokens: 11,
      output_tokens: 7,
      cache_read_tokens: 3,
      cache_creation_tokens: 2,
    });

    closeQueue();
    await consumeP;
  });

  it('多轮串行：第二条 prompt 仅在第一轮 agent_settled 后发出', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('第一轮');
    await tick();
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    await tick();

    // 未 settled：推第二条也不该发第二条 prompt（串行，FR-02）
    push('第二轮');
    await tick(50);
    expect(readStdinJson(child).filter((l) => l.type === 'prompt')).toHaveLength(1);
    expect(results).toHaveLength(0);

    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);

    // 第二轮 prompt 发出（不带 streamingBehavior——已停稳）
    await tick();
    const prompts = readStdinJson(child).filter((l) => l.type === 'prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.message).toBe('第二轮');
    expect(prompts[1]!.streamingBehavior).toBeUndefined();

    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(2);

    closeQueue();
    await consumeP;
  });

  it('prompt 被 success:false 拒收 → error 事件 + turn error 收敛，循环继续', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('被拒的');
    await tick();
    respond(child, 'prompt', {
      success: false,
      error: 'Agent is streaming and no streamingBehavior was specified',
    });
    await tick();

    const errEv = events.find(
      (e) => e.type === 'error' && e.content.includes('Agent is streaming'),
    );
    expect(errEv).toBeDefined();
    expect(safeParseAgentEvent(errEv!).success).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
    });

    // 不挂死：下一条输入继续走通道
    push('第二条');
    await tick();
    expect(
      readStdinJson(child).filter((l) => l.type === 'prompt'),
    ).toHaveLength(2);

    // 收尾：应答第二条 prompt 并收敛（避免挂 30s 请求超时拖慢测试）
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    closeQueue();
    await consumeP;
  });

  it('image blocks → prompt images（ImageContent：data/mimeType）；document 无通道跳过', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('看图', [
      { type: 'image', mediaType: 'image/png', base64: 'aGVsbG8=' },
      { type: 'document', mediaType: 'application/pdf', base64: 'cGRm' },
    ]);
    await tick();
    const prompt = readStdinJson(child).find((l) => l.type === 'prompt')!;
    expect(prompt.images).toEqual([
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
    // document 无 rpc 通道：不进 images（文本降级由 SessionManager filesToFetch 链承担）

    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    closeQueue();
    await consumeP;
  });

  it('turn 内 error 事件（turn_end stopReason=error）→ onTurnResult is_error', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('boom');
    await tick();
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, {
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '429 quota',
      },
    });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
      result: '429 quota',
    });

    closeQueue();
    await consumeP;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. isStreaming 维护 / steer 兜底 / interrupt
// ─────────────────────────────────────────────────────────────────────────────

describe('isStreaming 骨架与 interrupt', () => {
  it('agent_start/agent_settled 维护 handle.isStreaming；interrupt 发 abort 返回 true', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, close: closeQueue } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();
    expect(handle.isStreaming).toBe(false);

    // 非 streaming interrupt → false（无 active turn）
    await expect(driver.interrupt(handle)).resolves.toBe(false);

    emitEvent(child, { type: 'agent_start' });
    await tick();
    expect(handle.isStreaming).toBe(true);

    await expect(driver.interrupt(handle)).resolves.toBe(true);
    await tick();
    const abort = readStdinJson(child).find((l) => l.type === 'abort');
    expect(abort).toBeDefined();
    respond(child, 'abort');
    await tick();

    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(handle.isStreaming).toBe(false);
    await expect(driver.interrupt(handle)).resolves.toBe(false);

    closeQueue();
    await consumeP;
  });

  it('握手回 isStreaming=true → 首条 prompt 带 streamingBehavior:steer（task-03 三模式基础兜底）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child, { isStreaming: true });
    await tick();
    expect(handle.isStreaming).toBe(true);

    push('streaming 中追加');
    await tick();
    const prompt = readStdinJson(child).find((l) => l.type === 'prompt')!;
    expect(prompt.streamingBehavior).toBe('steer');

    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);

    closeQueue();
    await consumeP;
  });

  it('interrupt(null) → false（E3 no-op 不冒泡）', async () => {
    const driver = await makeDriver();
    await expect(driver.interrupt(null)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 退出收敛 / 容错
// ─────────────────────────────────────────────────────────────────────────────

describe('退出收敛与容错', () => {
  it('子进程非正常退出 → onError 会话级 fail + turn error 收敛，consume 不挂死', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push } = makeInputQueue();
    const { cb, results, errors } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    // 正在等 agent_settled 时进程退出
    push('进行中');
    await tick();
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    await tick();

    child.stderr.push(Buffer.from('pi crashed: OOM', 'utf8'));
    await tick(); // 让 stderr data 事件先入缓冲
    child._emitExit(1);
    await consumeP; // 必须自然 resolve（settled waiter 已释放，不挂死）

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
    });
    expect(String(results[0]!.result)).toContain('pi exited code=1');
    expect(String(results[0]!.result)).toContain('OOM');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it('坏 JSON 行 / 无主 response / 未知事件 → 不崩不丢（降级桶/警告路径）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, close: closeQueue } = makeInputQueue();
    const { cb, events } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child); // 正常握手完成（get_state 应答被关联消费掉）
    await tick();

    emitRaw(child, 'not-a-json-line');
    emitRaw(
      child,
      JSON.stringify({ id: 'pi_999', type: 'response', command: 'get_state', success: true }),
    );
    emitEvent(child, { type: 'some_future_event', custom: 1 });
    await tick();

    // 未知事件走降级桶；坏行/无主 response 零产出
    const degraded = events.find(
      (e) => e.type === 'status' && e.subtype === 'task_notification',
    );
    expect(degraded).toBeDefined();
    expect(degraded!.content).toBe('some_future_event');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);

    closeQueue();
    await consumeP;
  });

  it('空文本且无 blocks 的输入跳过（E1），非空照常发出', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    push('');
    await tick();
    expect(readStdinJson(child).filter((l) => l.type === 'prompt')).toHaveLength(0);

    push('x');
    await tick();
    expect(readStdinJson(child).filter((l) => l.type === 'prompt')).toHaveLength(1);

    // 收尾：应答该 prompt 并收敛（避免挂 30s 请求超时拖慢测试）
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    closeQueue();
    await consumeP;
  });

  it('U+2028 全链路：含行分隔符的 text_delta → 单条 text 事件内容原样', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, close: closeQueue } = makeInputQueue();
    const { cb, events } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child);
    await tick();

    emitEvent(child, {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '前\u2028后' },
    });
    await tick();

    const texts = events.filter(
      (e) => e.type === 'text' && e.content.includes('\u2028'),
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]!.content).toBe('前\u2028后');
    expect(safeParseAgentEvent(texts[0]!).success).toBe(true);

    closeQueue();
    await consumeP;
  });
});
