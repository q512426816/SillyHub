// tests/interactive/pi-rpc-driver.test.ts
// 2026-09-04-provider-pi-onboarding task-02（核心生命周期）+ task-03（高级语义）
// + task-06（vendored subagent 扩展装载 / R-02）。
//
// 依据：tasks/task-02.md / tasks/task-03.md、design.md §5.1（B-03/B-05）、
// pi 包 docs/rpc.md（分帧:30-37 / prompt:43-78 / steer:80-100 / follow_up:102-122
// / abort:124-135 / get_state:162-190 / extension UI:1126-1335）与
// dist/modes/rpc/rpc-client.js（waitForIdle 事件先订阅:356-370）、
// dist/core/agent-session.js（streaming 拒收文案:830 / _emitAgentSettled
// finally 必发:744-756）。
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
//   2. spawn 参数面：--mode rpc --session-dir 隔离目录 / --model / resume --session
//      （到达链：CreateSessionInput.resume → driverOpts.resume → spawn 旗标）/
//      Windows pi.cmd shim 解析与 shell 兜底（R-05）/ executable 缺失；
//   3. get_state 握手：session_started 合成（status/session_started + session_id，
//      过 safeParseAgentEvent）/ handle.sessionId 回填 / isStreaming 初始值；
//   4. 命令关联：prompt id 关联 resolve / success:false reject → error 事件 +
//      turn error 收敛（不挂死，后续输入继续）；
//   5. turn 生命周期：agent_start/message_update/turn_end usage/agent_settled →
//      事件流上报 + onTurnResult(success + session_id + usage)；多轮串行；
//   6. task-03 inject 三模式：非 streaming→prompt / streaming→steer（含 images）；
//      被拒降级链（prompt↔steer / steer→follow_up / steer→prompt[extension cmd]）；
//      无降级路径被拒 → error 事件含 command 名；
//   7. task-03 settled 复核：response 后 agent_start 跨 chunk → get_state 复核
//      true 等事件流 / 复核 false 直接收敛 / 复核往返期间 settled 已到（同 chunk
//      wire 序）不死锁；
//   8. task-03 extension_ui_request：dialog 自动回 cancelled:true；fire-and-forget
//      warn 降级不回话；均不阻塞事件流；
//   9. task-03 interrupt：等 abort response——成功 true / 被拒 false；abort 后
//      settled 到达 → waiter 释放 result 上报；非 streaming false；
//  10. 子进程非正常退出 → onError 会话级 fail + turn error 收敛（不挂死）；
//  11. 握手超时 → error 事件，会话通道仍可用；
//  12. 容错：坏 JSON 行 / 无主 response 不崩不产事件；空输入跳过（E1）；
//  13. U+2028 全链路（分帧 + 归一化）：含 U+2028 的 text_delta → 单条 text 事件；
//  14. task-06 vendored subagent 扩展装载：默认候选命中 → --extension 绝对路径；
//       env off → 不装载；env 显式路径 → 透传（解析器单元 + spawn 参数面）。

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
  PI_SUBAGENT_EXTENSION_ENV,
  PiExecutableNotFoundError,
  PiRpcDriver,
  piRpcSessionDir,
  piVendoredSubagentExtensionPath,
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

/** task-06：保存 env 原值（beforeEach 统一 off，扩展专测内自行改写）。 */
let prevSubagentExtEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  // task-06：默认关闭 vendored subagent 扩展装载——既有 spawn 参数面断言是
  // 精确匹配（不含 --extension）；扩展装载行为在专属 describe 内定点打开。
  prevSubagentExtEnv = process.env[PI_SUBAGENT_EXTENSION_ENV];
  process.env[PI_SUBAGENT_EXTENSION_ENV] = 'off';
});

afterEach(async () => {
  if (prevSubagentExtEnv === undefined) delete process.env[PI_SUBAGENT_EXTENSION_ENV];
  else process.env[PI_SUBAGENT_EXTENSION_ENV] = prevSubagentExtEnv;
  prevSubagentExtEnv = undefined;
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
// 2.5 task-06：vendored subagent 扩展装载（R-02 / D-002@v1）
// ─────────────────────────────────────────────────────────────────────────────

describe('vendored subagent 扩展装载（task-06 / R-02）', () => {
  it('piVendoredSubagentExtensionPath 默认候选命中 vendored 拷贝（dev 布局）', () => {
    delete process.env[PI_SUBAGENT_EXTENSION_ENV];
    // worktree 内 vendor/pi-extensions/subagent/index.ts 真实存在（task-06 拷入），
    // vitest 直跑 src/ → ../../vendor 候选命中；endsWith 断言跨平台（分隔符差异）。
    const p = piVendoredSubagentExtensionPath();
    expect(p).not.toBeNull();
    expect(p!.endsWith(join('vendor', 'pi-extensions', 'subagent', 'index.ts'))).toBe(true);
  });

  it('env off/0/false/disabled/空串 → null（版本脆弱性降级开关）', () => {
    for (const v of ['off', '0', 'false', 'disabled', 'OFF', '']) {
      process.env[PI_SUBAGENT_EXTENSION_ENV] = v;
      expect(piVendoredSubagentExtensionPath()).toBeNull();
    }
  });

  it('env 显式路径 → 原样透传（不做存在性校验，最高优先级）', () => {
    process.env[PI_SUBAGENT_EXTENSION_ENV] = join(tmpdir(), 'custom-subagent', 'index.ts');
    expect(piVendoredSubagentExtensionPath()).toBe(
      join(tmpdir(), 'custom-subagent', 'index.ts'),
    );
  });

  it('spawn 参数面：默认解析命中 → --extension <绝对路径> 追加在基础参数后', async () => {
    delete process.env[PI_SUBAGENT_EXTENSION_ENV];
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(makeInputQueue().queue, makeOpts());
    await waitForSpawn();

    const extPath = piVendoredSubagentExtensionPath();
    expect(extPath).not.toBeNull();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      ['--mode', 'rpc', '--session-dir', tmpSessionDir, '--extension', extPath!],
      expect.objectContaining({ shell: false }),
    );
  });

  it('spawn 参数面：env off → 不带 --extension（beforeEach 默认态）', async () => {
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(makeInputQueue().queue, makeOpts());
    await waitForSpawn();

    const [, args] = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(args).toEqual(['--mode', 'rpc', '--session-dir', tmpSessionDir]);
  });

  it('spawn 参数面：env 显式路径 → --extension 透传该路径', async () => {
    const custom = join(tmpdir(), 'my-subagent-ext', 'index.ts');
    process.env[PI_SUBAGENT_EXTENSION_ENV] = custom;
    vi.mocked(spawn).mockReturnValue(createFakeChild() as never);
    const driver = await makeDriver();
    await driver.start(makeInputQueue().queue, makeOpts());
    await waitForSpawn();

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      ['--mode', 'rpc', '--session-dir', tmpSessionDir, '--extension', custom],
      expect.anything(),
    );
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

  it('prompt 被 success:false 拒收（无降级文案）→ error 事件（含 command 名）+ turn error 收敛，循环继续', async () => {
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
    // 错误文案不含 already processing/streamingBehavior/followUp/cannot be
    // queued——命中降级正则的拒收见「inject 三模式降级」describe。
    respond(child, 'prompt', {
      success: false,
      error: 'pi rpc: model not configured',
    });
    await tick();

    const errEv = events.find(
      (e) => e.type === 'error' && e.content.includes('model not configured'),
    );
    expect(errEv).toBeDefined();
    expect(safeParseAgentEvent(errEv!).success).toBe(true);
    // task-03：被拒命令名随 error 事件上报（PiCommandError.command）
    expect(errEv!.metadata).toMatchObject({
      kind: 'pi_command_rejected',
      command: 'prompt',
    });
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

  it('image blocks → prompt images（ImageContent）；document 无通道 → 文本降级注明', async () => {
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
    // task-03：document（deliver='block' 的 PDF 不走 SessionManager 落盘清单链，
    // session-manager.ts:2924-2961 仅 disk 投递追加 text 路径）→ 驱动侧文本降级
    // 注明追加在原文后，不静默丢内容（design §5.1 multimodal 桥接口径）
    expect(String(prompt.message)).toBe(
      '看图\n（已收到 application/pdf document 附件，但 pi rpc 通道不支持 document 内容投递，原文未送达模型）',
    );
    expect(prompt.images).toHaveLength(1);

    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();

    // document-only turn：文本空但带 document 块 → 注记成为 message（E1 不跳过）
    push('', [{ type: 'document', mediaType: 'application/pdf', base64: 'cGRm' }]);
    await tick();
    const prompts = readStdinJson(child).filter((l) => l.type === 'prompt');
    expect(prompts).toHaveLength(2);
    expect(String(prompts[1]!.message)).toContain('application/pdf document 附件');
    expect(String(prompts[1]!.message)).toContain('未送达模型');
    expect(prompts[1]!.images).toBeUndefined();

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
// 5. isStreaming 维护 / inject 三模式主通道（streaming→steer）/ interrupt
// ─────────────────────────────────────────────────────────────────────────────

describe('isStreaming 维护、steer 主通道与 interrupt', () => {
  it('agent_start/agent_settled 维护 handle.isStreaming；interrupt 等 abort 应答成功 → true；settled 释放 waiter 上报 result', async () => {
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
    expect(handle.isStreaming).toBe(false);

    // 非 streaming interrupt → false（无 active turn）
    await expect(driver.interrupt(handle)).resolves.toBe(false);

    push('跑起来');
    await tick();
    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_start' });
    await tick();
    expect(handle.isStreaming).toBe(true);

    // task-03：interrupt 等 abort response 成功与否（rpc.md:124-135）
    const interruptP = driver.interrupt(handle);
    await tick();
    const abort = readStdinJson(child).find((l) => l.type === 'abort');
    expect(abort).toBeDefined();
    respond(child, 'abort');
    await expect(interruptP).resolves.toBe(true);

    // abort 后 agent_settled 到达（pi 在 run finally 必发）→ waiter 释放 → result
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(handle.isStreaming).toBe(false);
    expect(results).toHaveLength(1);
    await expect(driver.interrupt(handle)).resolves.toBe(false);

    closeQueue();
    await consumeP;
  });

  it('interrupt abort 应答 success:false → false（不抛不挂）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, close: closeQueue } = makeInputQueue();
    const { cb } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child, { isStreaming: true });
    await tick();

    const interruptP = driver.interrupt(handle);
    await tick();
    respond(child, 'abort', { success: false, error: 'no active run' });
    await expect(interruptP).resolves.toBe(false);

    // 收尾：释放 streaming 镜像让 consume 自然退出
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    closeQueue();
    await consumeP;
  });

  it('streaming 态注入 → steer 命令（默认通道，含 images；非 prompt+streamingBehavior）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child, { isStreaming: true });
    await tick();
    expect(handle.isStreaming).toBe(true);

    push('streaming 中追加', [
      { type: 'image', mediaType: 'image/png', base64: 'aW1n' },
    ]);
    await tick();

    // task-03 三模式：streaming → type:'steer'（rpc.md:80-100，message+images），
    // 不再走 prompt+streamingBehavior（task-02 的兜底形状）
    const steer = readStdinJson(child).find((l) => l.type === 'steer')!;
    expect(steer).toBeDefined();
    expect(steer.message).toBe('streaming 中追加');
    expect(steer.images).toEqual([
      { type: 'image', data: 'aW1n', mimeType: 'image/png' },
    ]);
    expect(steer.streamingBehavior).toBeUndefined();
    expect(readStdinJson(child).filter((l) => l.type === 'prompt')).toHaveLength(0);

    respond(child, 'steer');
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);

    closeQueue();
    await consumeP;
  });

  it('interrupt(null) → false（E3 no-op 不冒泡）', async () => {
    const driver = await makeDriver();
    await expect(driver.interrupt(null)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5b. task-03 inject 三模式降级链
// ─────────────────────────────────────────────────────────────────────────────

describe('inject 三模式降级链（被拒单次重试）', () => {
  it('prompt 被拒（already processing 文案）→ 降级重试 steer（isStreaming 镜像滞后竞态）', async () => {
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

    push('竞态注入');
    await tick();
    // agent-session.js:830 拒收文案原文
    respond(child, 'prompt', {
      success: false,
      error:
        "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    });
    await tick();

    const steer = readStdinJson(child).find((l) => l.type === 'steer');
    expect(steer).toBeDefined();
    expect(steer!.message).toBe('竞态注入');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);

    respond(child, 'steer');
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });

  it('steer 被拒（followUp 提示文案）→ 降级重试 follow_up', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child, { isStreaming: true });
    await tick();

    push('稍后处理');
    await tick();
    respond(child, 'steer', {
      success: false,
      error: 'steering queue unavailable, use followUp',
    });
    await tick();

    const followUp = readStdinJson(child).find((l) => l.type === 'follow_up');
    expect(followUp).toBeDefined();
    expect(followUp!.message).toBe('稍后处理');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);

    respond(child, 'follow_up');
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });

  it('steer 被拒（extension command 文案）→ 降级重试 prompt（rpc.md:67 立即执行通道）', async () => {
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

    push('/mycommand 跑一下');
    await tick();
    // agent-session.js _throwIfExtensionCommand 文案原文
    respond(child, 'steer', {
      success: false,
      error:
        'Extension command "/mycommand" cannot be queued. Use prompt() or execute the command when not streaming.',
    });
    await tick();

    const prompt = readStdinJson(child).find((l) => l.type === 'prompt');
    expect(prompt).toBeDefined();
    expect(prompt!.message).toBe('/mycommand 跑一下');
    // extension command 经 prompt 立即执行，无需 streamingBehavior 排队字段
    expect(prompt!.streamingBehavior).toBeUndefined();

    respond(child, 'prompt');
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });

  it('steer 被拒（无降级文案）→ error 事件含 command=steer + turn error，循环继续', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = await makeDriver();
    const { queue, push, close: closeQueue } = makeInputQueue();
    const { cb, events, results } = makeCallbacks();
    const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
    const consumeP = driver.consume(handle, cb);
    await tick();
    handshakeOk(child, { isStreaming: true });
    await tick();

    push('会失败的');
    await tick();
    respond(child, 'steer', { success: false, error: 'pi exploded' });
    await tick();

    const errEv = events.find((e) => e.type === 'error' && e.content.includes('pi exploded'));
    expect(errEv).toBeDefined();
    expect(errEv!.metadata).toMatchObject({
      kind: 'pi_command_rejected',
      command: 'steer',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
    });

    // 不挂死：下一条继续（仍 streaming → steer）
    push('再来');
    await tick();
    expect(readStdinJson(child).filter((l) => l.type === 'steer')).toHaveLength(2);

    respond(child, 'steer');
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(2);

    closeQueue();
    await consumeP;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5c. task-03 agent_settled 收敛细化（get_state 复核）
// ─────────────────────────────────────────────────────────────────────────────

describe('agent_settled 收敛细化（response→agent_start 跨 chunk 竞态）', () => {
  it('agent_start 延迟未达 → get_state 复核 isStreaming=true → 等事件流 settled 才收敛', async () => {
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

    push('慢启动');
    await tick();
    // 仅应答 prompt，不发任何 agent 事件（模拟 agent_start 跨 chunk 延迟）
    respond(child, 'prompt');
    await tick(60);

    // 复核 get_state 已发出（握手 1 次 + 复核 1 次）
    expect(readStdinJson(child).filter((l) => l.type === 'get_state')).toHaveLength(2);
    respond(child, 'get_state', {
      data: { sessionId: 'sess_pi_1', isStreaming: true },
    });
    await tick();

    // 服务端真值 streaming：未收敛（等事件流 agent_settled）
    expect(results).toHaveLength(0);
    expect(handle.isStreaming).toBe(true);

    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, { type: 'agent_settled' });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });

  it('复核 isStreaming=false（extension command 等无 run 语义）→ 直接收敛不挂死', async () => {
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

    push('/cmd 立即执行');
    await tick();
    respond(child, 'prompt'); // extension command：response success 后无 agent run
    await tick(60);
    respond(child, 'get_state', {
      data: { sessionId: 'sess_pi_1', isStreaming: false },
    });
    await tick();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });

  it('复核往返期间 settled 已到（同 chunk wire 序 [get_state resp=true, agent_settled]）→ 事件计数守卫不死锁', async () => {
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

    push('竞态轮');
    await tick();
    respond(child, 'prompt');
    await tick(60);

    // 手工构造单 chunk 两行：复核应答（isStreaming=true，读取时刻 run 未完）+
    // 随后落地的 agent_settled——data 已过期，事件计数守卫应只信事件流（本地
    // isStreaming 已回落）直接收敛。无守卫则 markStreaming+waiter 永挂（本用例
    // 会以 vitest 超时失败暴露回归）。
    const req = [...readStdinJson(child)]
      .reverse()
      .find((l) => l.type === 'get_state' && typeof l.id === 'string')!;
    child.stdout.push(
      JSON.stringify({
        id: req.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: { sessionId: 'sess_pi_1', isStreaming: true },
      }) +
        '\n' +
        JSON.stringify({ type: 'agent_settled' }) +
        '\n',
    );
    await tick(60);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'success', is_error: false });

    closeQueue();
    await consumeP;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5d. task-03 extension_ui_request 子协议（dialog 自动取消）
// ─────────────────────────────────────────────────────────────────────────────

describe('extension_ui_request 自动取消（rpc.md:1126-1335）', () => {
  it('dialog（select）→ 自动回 extension_ui_response cancelled:true，事件流不被阻塞', async () => {
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
    const baseline = events.length; // 握手 session_started 已占位

    // dialog 类 ui_request（select，阻塞至应答——不答会死锁 pi 侧 await）
    emitEvent(child, {
      type: 'extension_ui_request',
      id: 'ui-dialog-1',
      method: 'select',
      title: 'Allow dangerous command?',
      options: ['Allow', 'Block'],
    });
    await tick();

    const uiResp = readStdinJson(child).find((l) => l.type === 'extension_ui_response');
    expect(uiResp).toBeDefined();
    expect(uiResp).toMatchObject({
      type: 'extension_ui_response',
      id: 'ui-dialog-1',
      cancelled: true,
    });
    // 子协议不进事件流（不污染 AgentEvent 通道；排除握手 session_started 基线）
    expect(events.slice(baseline)).toHaveLength(0);

    // 事件流继续：后续 agent 事件正常归一化上报
    emitEvent(child, {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '继续' },
    });
    await tick();
    expect(events.find((e) => e.type === 'text' && e.content === '继续')).toBeDefined();

    closeQueue();
    await consumeP;
  });

  it('fire-and-forget（notify）→ 不回应答（协议无应答期望），事件流不受影响', async () => {
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
    const baseline = events.length;

    emitEvent(child, {
      type: 'extension_ui_request',
      id: 'ui-notify-1',
      method: 'notify',
      message: 'Command blocked by user',
      notifyType: 'warning',
    });
    await tick();

    expect(
      readStdinJson(child).filter((l) => l.type === 'extension_ui_response'),
    ).toHaveLength(0);
    expect(events.slice(baseline)).toHaveLength(0);

    emitEvent(child, {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '流' },
    });
    await tick();
    expect(events.find((e) => e.type === 'text' && e.content === '流')).toBeDefined();

    closeQueue();
    await consumeP;
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
