// tests/interactive/pi-rpc-driver-turn-result.test.ts
// 2026-09-10-review-dispatch-platform-fixes task-01（FR-02 / D-001@v1）：
// PI driver 成功轮 turn result 补 ``result`` 字段——轮终 assistant 全文
// turnFinalText（事件循环截获 message_end 的 override text）→ success
// reportTurnResult 携带；为 backend result_summary / AgentRun.output_redacted
// 与 task-03 mission_worker 代报（workerDone summary）提供全文数据源
//（design §5.1 数据流前三跳）。
//
// 依据：tasks/task-01.md、design.md §5.1、pi-events.ts handleMessageEnd
//（assistant message_end 的 text part → ``{type:'text', content, override:true}``
// 终态全文事件；text_delta 流式 partial 不带 override）。测试手法与
// pi-rpc-driver.test.ts 同款（fake 子进程 + get_state 握手 + 可控 input queue）。
//
// 覆盖点（与任务卡 acceptance 对齐）：
//   1. 单条 override 全文 → success 轮 result=全文（流式 delta 不拼入）；
//   2. 轮内多条 override（工具循环多段 message_end / 单 message_end 多 text
//      part）→ 最后一条胜出；
//   3. 无 override 的成功轮（仅 text_delta partial）→ result 键缺失；
//   4. error 轮 → result 仍为错误信息（不掺 override 全文）；
//   5. 跨轮重置 → 上轮全文不泄漏进下轮 result（无 override 轮缺键）。

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

// mock cmd-shim：默认 null（非 .cmd 路径不触发），本测试不覆盖 .cmd 分支。
vi.mock('../../src/cmd-shim.js', () => ({
  resolveWindowsCmdShim: vi.fn(() => null),
}));

import { spawn } from 'node:child_process';
import {
  PI_SUBAGENT_EXTENSION_ENV,
  PiRpcDriver,
  type PiRpcHandle,
  type PiStartOptions,
} from '../../src/interactive/pi-rpc-driver.js';
import type { AgentEvent } from '../../src/types.js';
import type {
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import {
  createFakeChild,
  type FakeChild,
} from '../helpers/fake-child.js';

// ── 测试工具（与 pi-rpc-driver.test.ts 同款手法的最小子集） ───────────────────

/** 共享 tmp session-dir（构造注入，避免写真 daemon 状态目录）。 */
let tmpSessionDir: string;

/** vendored 扩展装载 env 原值（beforeEach 统一 off，spawn 参数面与本测试无关）。 */
let prevSubagentExtEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
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

/** 构造 callbacks 收集器：onTurnMessage/onTurnResult 全记录。 */
function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  events: AgentEvent[];
  results: Record<string, unknown>[];
} {
  const events: AgentEvent[] = [];
  const results: Record<string, unknown>[] = [];
  const cb: InteractiveDriverCallbacks = {
    onTurnMessage: (envelope) => {
      for (const ev of envelope.events) events.push(ev);
    },
    onTurnResult: (r) => {
      results.push(r as unknown as Record<string, unknown>);
    },
  };
  return { cb, events, results };
}

/** 构造可控 input queue（push/close；单订阅语义对齐真实 InputQueue）。 */
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
    push(text) {
      pending.push({ type: 'user', text });
      if (waiter) waiter();
    },
    close() {
      closed = true;
      if (waiter) waiter();
    },
  };
}

/** 让出若干 ms（fake child 事件时序用，既有测试同款手法）。 */
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

/** 应答 stdin 里最新一条指定 type 的命令（response 按 id 回关联）。 */
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

/** get_state 成功应答（握手）。 */
function handshakeOk(child: FakeChild): void {
  respond(child, 'get_state', {
    data: { sessionId: 'sess_pi_1', isStreaming: false },
  });
}

/**
 * 驱动完整一轮：push 输入 → prompt 应答 → agent_start →（可选 text_delta
 * partial）→（可选多条 message_end，每条 text part 数组）→ turn_end →
 * agent_settled。事件序列按 pi 真实 wire 序（rpc.md）。
 */
async function driveTurn(
  child: FakeChild,
  push: (text: string) => void,
  script: {
    input: string;
    /** message_update text_delta 增量（partial，无 override）。 */
    deltas?: string[];
    /** message_end 帧（assistant）：texts=text part 全文数组（每 part 一条 override）。 */
    messageEnds?: Array<{ texts: string[]; usage?: Record<string, number> }>;
    /** turn_end stopReason；error 时须给 errorMessage。 */
    stopReason?: 'stop' | 'error';
    errorMessage?: string;
    turnEndUsage?: Record<string, number>;
  },
): Promise<void> {
  script.stopReason ??= 'stop';
  push(script.input);
  await tick();
  respond(child, 'prompt');
  emitEvent(child, { type: 'agent_start' });
  for (const delta of script.deltas ?? []) {
    emitEvent(child, {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    });
  }
  for (const me of script.messageEnds ?? []) {
    emitEvent(child, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: me.texts.map((t) => ({ type: 'text', text: t })),
        stopReason: 'stop',
        ...(me.usage ? { usage: me.usage } : {}),
      },
    });
  }
  emitEvent(child, {
    type: 'turn_end',
    message: {
      role: 'assistant',
      content: [],
      stopReason: script.stopReason,
      ...(script.errorMessage ? { errorMessage: script.errorMessage } : {}),
      ...(script.turnEndUsage ? { usage: script.turnEndUsage } : {}),
    },
  });
  emitEvent(child, { type: 'agent_settled' });
  await tick();
}

/** 建 driver + fake child + 握手完成的会话三件套（各用例共用起手式）。 */
async function makeSession(): Promise<{
  child: FakeChild;
  driver: PiRpcDriver;
  push: (text: string) => void;
  closeQueue: () => void;
  consumeP: Promise<void>;
  results: Record<string, unknown>[];
  events: AgentEvent[];
}> {
  const child = createFakeChild();
  vi.mocked(spawn).mockReturnValue(child as never);
  tmpSessionDir = await mkdtemp(join(tmpdir(), 'pi-turn-result-'));
  const driver = new PiRpcDriver({ sessionDir: tmpSessionDir });
  const { queue, push, close: closeQueue } = makeInputQueue();
  const { cb, events, results } = makeCallbacks();
  const handle = (await driver.start(queue, makeOpts())) as PiRpcHandle;
  const consumeP = driver.consume(handle, cb);
  await tick();
  handshakeOk(child);
  await tick();
  return { child, driver, push, closeQueue, consumeP, results, events };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PI driver 轮终 assistant 全文 → success result 字段（task-01 / FR-02）', () => {
  it('单条 override 全文：message_end 后 success 轮 result=全文（流式 delta 不拼入）', async () => {
    const s = await makeSession();
    await driveTurn(s.child, s.push, {
      input: '查一下',
      deltas: ['流式片段A', '流式片段B'],
      messageEnds: [{ texts: ['完整答案全文'] }],
    });

    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({
      subtype: 'success',
      is_error: false,
      session_id: 'sess_pi_1',
      result: '完整答案全文',
    });

    s.closeQueue();
    await s.consumeP;
  });

  it('轮内多条 override 取末条：工具循环多段 message_end（中间产物不进 result）', async () => {
    const s = await makeSession();
    await driveTurn(s.child, s.push, {
      input: '跑两轮工具',
      messageEnds: [
        { texts: ['先查一下'], usage: { input: 100, output: 20 } },
        { texts: ['最终答案'], usage: { input: 50, output: 10 } },
      ],
    });

    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ subtype: 'success' });
    // 最后一条 override 全文胜出（中间 message_end 的 '先查一下' 不覆盖终值）
    expect(s.results[0]!.result).toBe('最终答案');

    s.closeQueue();
    await s.consumeP;
  });

  it('轮内多条 override 取末条：单 message_end 多 text part（末 part 胜出）', async () => {
    const s = await makeSession();
    await driveTurn(s.child, s.push, {
      input: '多段产出',
      messageEnds: [{ texts: ['第一段全文', '第二段全文'] }],
    });

    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ subtype: 'success' });
    expect(s.results[0]!.result).toBe('第二段全文');

    s.closeQueue();
    await s.consumeP;
  });

  it('partial 不计入：仅 text_delta（无 message_end）的成功轮不带 result 键', async () => {
    const s = await makeSession();
    await driveTurn(s.child, s.push, {
      input: '流式不落终态',
      deltas: ['partial 一', 'partial 二'],
      turnEndUsage: { input: 11, output: 7 },
    });

    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ subtype: 'success', is_error: false });
    // 无 override 全文 → result 键完全不出现（不是空串/null）
    expect('result' in s.results[0]!).toBe(false);

    s.closeQueue();
    await s.consumeP;
  });

  it('error 轮：result 仍为错误信息，不掺 override 全文（轮终真失败场景）', async () => {
    const s = await makeSession();
    await driveTurn(s.child, s.push, {
      input: '先答一半再挂',
      messageEnds: [{ texts: ['部分产出'] }],
      stopReason: 'error',
      errorMessage: 'final call failed',
    });

    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
      // error 轮语义不变：result=错误信息，override 全文不掺入
      result: 'final call failed',
    });

    s.closeQueue();
    await s.consumeP;
  });

  it('跨轮重置：上轮 override 全文不泄漏进下轮（第二轮无 override 缺 result 键）', async () => {
    const s = await makeSession();
    // 第一轮：带 override 全文
    await driveTurn(s.child, s.push, {
      input: '第一轮',
      messageEnds: [{ texts: ['第一轮全文'] }],
    });
    // 第二轮：仅流式 partial（无 message_end）——若无重置，上轮 '第一轮全文'
    // 会粘滞进本轮 result
    await driveTurn(s.child, s.push, {
      input: '第二轮',
      deltas: ['只有流式'],
    });

    expect(s.results).toHaveLength(2);
    expect(s.results[0]).toMatchObject({ subtype: 'success', result: '第一轮全文' });
    expect(s.results[1]).toMatchObject({ subtype: 'success', is_error: false });
    expect('result' in s.results[1]!).toBe(false);

    s.closeQueue();
    await s.consumeP;
  });
});
