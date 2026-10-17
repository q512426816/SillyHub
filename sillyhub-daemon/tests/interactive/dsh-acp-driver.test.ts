// tests/interactive/dsh-acp-driver.test.ts
// 2026-10-15-dsh-engine-acp task-03：DshAcpDriver 生命周期 / 握手 / turn 收敛 /
// 打断 / 审批代答三态 / 握手失败结构化错误。spawn 用 tests/helpers/fake-child.ts
// 驱动（codex driver test 同款机制），不依赖真实 dsh。
//
// 驱动内 JSON-RPC id 顺序（_nextId 递增）：1=initialize、2=session/new|resume、
// 3=set_config_option(model)、4=set_config_option(reasoning_effort)、5+=session/prompt
// / session/cancel。用例必须喂齐驱动会 await 的全部响应（缺一个 → 30s 请求超时
// 挂起，2026-10-15 实测教训）；断言一律走 waitFor 条件等待（固定 sleep 有竞态）。

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import {
  DshAcpDriver,
  DshExecutableNotFoundError,
  mapThinkingLevel,
  type DshAcpHandle,
  type DshAcpStartOptions,
} from '../../src/interactive/dsh-acp-driver.js';
import type {
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import { createFakeChild, readStdin, type FakeChild } from '../helpers/fake-child.js';

// ── 工具 ────────────────────────────────────────────────────────────────────

let fake: FakeChild;

beforeEach(() => {
  fake = createFakeChild();
  vi.mocked(spawn).mockReturnValue(fake as unknown as ReturnType<typeof spawn>);
});

/** 条件等待：轮询断言函数直到为真（默认 2s 上限），消除固定 sleep 竞态。 */
async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor 超时：条件在 ${timeoutMs}ms 内未满足`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeOpts(overrides: Partial<DshAcpStartOptions> = {}): DshAcpStartOptions {
  return {
    cwd: '/tmp/dsh-ws',
    pathToAgentExecutable: '/usr/local/bin/dsh',
    ...overrides,
  };
}

function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  messages: Record<string, unknown>[];
  results: Record<string, unknown>[];
  errors: unknown[];
} {
  const messages: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  return {
    cb: {
      onTurnMessage: (envelope) => {
        for (const ev of envelope.events) {
          messages.push(ev as unknown as Record<string, unknown>);
        }
      },
      onTurnResult: (r) => results.push(r as unknown as Record<string, unknown>),
      onTurnError: (e) => errors.push(e),
    },
    messages,
    results,
    errors,
  };
}

/** 可控输入队列（push/close；对齐真实 InputQueue 单订阅语义）。 */
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
          for (;;) {
            if (pending.length > 0) return { value: pending.shift()!, done: false };
            if (closed) return { value: undefined, done: true };
            await new Promise<void>((resolve) => {
              waiter = resolve;
            });
            waiter = null;
          }
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

/** JSON-RPC 响应行（喂回 fake stdout）。 */
function resp(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
}

/** session/update 通知行。 */
function updateLine(update: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: update }) + '\n';
}

/** 服务端权限请求行（id 由服务端分配，此处用 100+）。 */
function permissionRequestLine(
  id: number,
  options: Array<{ optionId: string; kind: string }>,
): string {
  return (
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: { sessionId: 'acp-s1', toolCall: { toolCallId: 'tc-1' }, options },
    }) + '\n'
  );
}

/**
 * 喂完整握手（initialize=1 / session/new=2）；waitEach 后驱动就绪进入 turn 循环。
 * useModel 时额外喂 set_config_option(model)=3。
 */
async function feedHandshake(useModel = false): Promise<void> {
  fake.stdout.push(resp(1, { protocolVersion: 1, agentInfo: { name: 'x' } }));
  fake.stdout.push(resp(2, { sessionId: 'acp-s1' }));
  if (useModel) {
    fake.stdout.push(resp(3, {}));
    await waitFor(() => readStdin(fake).includes('"optionId":"model"'));
  }
  await waitFor(() => readStdin(fake).includes('"method":"session/new"'));
}

// ── 用例 ────────────────────────────────────────────────────────────────────

describe('DshAcpDriver：启动与握手', () => {
  it('pathToAgentExecutable 缺失 → DshExecutableNotFoundError', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    q.close();
    await expect(
      driver.start(q.queue, makeOpts({ pathToAgentExecutable: '' })),
    ).rejects.toBeInstanceOf(DshExecutableNotFoundError);
  });

  it('spawn 参数 = dsh --profile acp + cwd + windowsHide；握手 initialize → session/new（cwd）→ acpSessionId 回传', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await waitFor(() => readStdin(fake).includes('"method":"initialize"'));
    const [cmd, args, spawnOpts] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; windowsHide: boolean },
    ];
    expect(cmd).toBe('/usr/local/bin/dsh');
    expect(args).toEqual(['--profile', 'acp']);
    expect(spawnOpts.cwd).toBe('/tmp/dsh-ws');
    expect(spawnOpts.windowsHide).toBe(true);
    await feedHandshake();
    q.close();
    await consuming;
    expect((handle as DshAcpHandle).acpSessionId).toBe('acp-s1');
  });

  it('resume 选项 → session/resume（带 sessionId），不调 session/new', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts({ resume: 'acp-old' }));
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await waitFor(() => readStdin(fake).includes('"method":"initialize"'));
    fake.stdout.push(resp(1, { protocolVersion: 1 }));
    fake.stdout.push(resp(2, { sessionId: 'acp-old' }));
    await waitFor(() => readStdin(fake).includes('"method":"session/resume"'));
    const stdinText = readStdin(fake);
    expect(stdinText).toContain('"sessionId":"acp-old"');
    expect(stdinText).not.toContain('"method":"session/new"');
    q.close();
    await consuming;
  });

  it('model + thinkingLevel=medium → set_config_option 扁平形状(configId=model/reasoning_effort)；off → 不发档位', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(
      q.queue,
      makeOpts({ model: 'deepseek-v4', thinkingLevel: 'medium' }),
    );
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await waitFor(() => readStdin(fake).includes('"method":"initialize"'));
    fake.stdout.push(resp(1, { protocolVersion: 1 }));
    fake.stdout.push(resp(2, { sessionId: 'acp-s1' }));
    fake.stdout.push(resp(3, {})); // model
    fake.stdout.push(resp(4, {})); // reasoning_effort
    // dsh 0.2.0-rc.2（官方 ACP SDK v2 schema）：扁平 {sessionId, configId, value}——
    // 旧嵌套 {option:{optionId,value}} 回 Invalid params（真机实证 2026-10-17）
    await waitFor(() => readStdin(fake).includes('"configId":"reasoning_effort"'));
    const stdinText = readStdin(fake);
    expect(stdinText).toContain('"configId":"model"');
    expect(stdinText).toContain('"value":"deepseek-v4"');
    expect(stdinText).toContain('"value":"medium"');
    expect(stdinText).not.toContain('"optionId"');
    q.close();
    await consuming;
  });
});

describe('DshAcpDriver：turn 循环与打断', () => {
  it('一轮对话：prompt → session/update 事件批次 → stopReason=end_turn → onTurnResult(success)', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb, messages, results } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    q.push('你好');
    await waitFor(() => readStdin(fake).includes('"method":"session/prompt"'));
    fake.stdout.push(
      updateLine({
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'm1',
        content: { type: 'text', text: '想' },
      }),
    );
    fake.stdout.push(
      updateLine({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: '答' },
      }),
    );
    fake.stdout.push(resp(3, { stopReason: 'end_turn' }));
    await waitFor(() => results.length === 1);
    expect(messages.map((m) => m.type)).toEqual(['thinking', 'text']);
    expect(results[0]).toMatchObject({
      subtype: 'success',
      is_error: false,
      session_id: 'acp-s1',
    });
    q.close();
    await consuming;
  });

  it('空文本 turn 跳过（不发 session/prompt），后续正常轮继续', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb, results } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    q.push('');
    await new Promise((r) => setTimeout(r, 80));
    expect(readStdin(fake)).not.toContain('"method":"session/prompt"');
    // 正常轮收尾（喂齐响应避免挂起）
    q.push('第二轮');
    await waitFor(() => readStdin(fake).includes('"method":"session/prompt"'));
    fake.stdout.push(resp(3, { stopReason: 'end_turn' }));
    await waitFor(() => results.length === 1);
    q.close();
    await consuming;
    expect(results).toHaveLength(1);
  });

  it('stopReason=cancelled → is_error=true 且 subtype=acp_cancelled', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb, results } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    q.push('干活');
    await waitFor(() => readStdin(fake).includes('"method":"session/prompt"'));
    fake.stdout.push(resp(3, { stopReason: 'cancelled' }));
    await waitFor(() => results.length === 1);
    expect(results[0]).toMatchObject({ subtype: 'acp_cancelled', is_error: true });
    q.close();
    await consuming;
  });

  it('interrupt：active prompt 时发 session/cancel → true；空闲 → false', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb, results } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    // 空闲（无 prompt 在飞）→ false
    await expect(driver.interrupt(handle)).resolves.toBe(false);
    q.push('长任务');
    await waitFor(() => readStdin(fake).includes('"method":"session/prompt"'));
    // id 分配：prompt=3、cancel=4（interrupt 在 prompt 之后请求）
    const ok = driver.interrupt(handle);
    await waitFor(() => readStdin(fake).includes('"method":"session/cancel"'));
    // 先喂响应（cancel=4 / prompt=3 以 cancelled 收敛）再断言——ok 依赖 resp(4)
    fake.stdout.push(resp(4, {})); // cancel 响应
    fake.stdout.push(resp(3, { stopReason: 'cancelled' })); // prompt 收敛
    await expect(ok).resolves.toBe(true);
    await waitFor(() => results.length === 1);
    expect(results[0]).toMatchObject({ subtype: 'acp_cancelled', is_error: true });
    q.close();
    await consuming;
  });
});

describe('DshAcpDriver：审批代答三态（FR-04）', () => {
  const OPTIONS = [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ];

  /** 跑一个权限用例并取服务端请求的应答行。 */
  async function runPermissionCase(opts: {
    manualApproval?: boolean;
    askUserOnly?: boolean;
    hooks?: { requestPermission: () => Promise<{ behavior: string }> };
  }): Promise<string> {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(
      q.queue,
      makeOpts({
        manualApproval: opts.manualApproval,
        askUserOnly: opts.askUserOnly,
        sessionPermission: opts.hooks as never,
      }),
    );
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    fake.stdout.push(permissionRequestLine(100, OPTIONS));
    await waitFor(() =>
      readStdin(fake).split('\n').some((l) => l.includes('"id":100')),
    );
    q.close();
    await consuming;
    const lines = readStdin(fake)
      .split('\n')
      .filter((l) => l.includes('"id":100'));
    return lines[lines.length - 1] ?? '';
  }

  it('manualApproval=false → 自动 allow（selected allow-once，不弹卡）', async () => {
    const respLine = await runPermissionCase({ manualApproval: false });
    expect(respLine).toContain('"outcome":"selected"');
    expect(respLine).toContain('"optionId":"allow-once"');
  });

  it('manualApproval=true + hooks=allow → selected allow-once', async () => {
    const respLine = await runPermissionCase({
      manualApproval: true,
      hooks: { requestPermission: async () => ({ behavior: 'allow' }) },
    });
    expect(respLine).toContain('"optionId":"allow-once"');
  });

  it('manualApproval=true + hooks=deny / 无 hooks → cancelled（fail-closed）', async () => {
    const deny = await runPermissionCase({
      manualApproval: true,
      hooks: { requestPermission: async () => ({ behavior: 'deny' }) },
    });
    expect(deny).toContain('"outcome":"cancelled"');
    const noHooks = await runPermissionCase({ manualApproval: true });
    expect(noHooks).toContain('"outcome":"cancelled"');
  });
});

describe('DshAcpDriver：失败与清理', () => {
  it('握手失败（initialize 返回 error）→ onTurnError + 结构化 is_error turn_result（不重试）', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb, results, errors } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await waitFor(() => readStdin(fake).includes('"method":"initialize"'));
    fake.stdout.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'version mismatch' },
      }) + '\n',
    );
    await waitFor(() => results.length === 1);
    expect(errors).toHaveLength(1);
    expect(results[0]).toMatchObject({ subtype: 'error_during_execution', is_error: true });
    expect(String((results[0] as { result?: unknown }).result)).toContain('version mismatch');
    // consume 已自行收敛（不重试）——await 不挂
    await consuming;
  });

  it('close 幂等（二次调用不重复杀）且优雅窗口内不强杀', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await feedHandshake();
    await handle.close?.();
    await handle.close?.(); // 幂等
    expect(fake.killed).toBe(false); // 优雅退出窗口（stdin.end）内不强杀
    q.close();
    await consuming;
  });
});

describe('mapThinkingLevel（ACP 三档本地映射）', () => {
  it('off/undefined → 不携带；minimal/low→low；medium→medium；high/xhigh/max→high；未知 → undefined', () => {
    expect(mapThinkingLevel(undefined)).toBeUndefined();
    expect(mapThinkingLevel('off')).toBeUndefined();
    expect(mapThinkingLevel('minimal')).toBe('low');
    expect(mapThinkingLevel('low')).toBe('low');
    expect(mapThinkingLevel('medium')).toBe('medium');
    expect(mapThinkingLevel('high')).toBe('high');
    expect(mapThinkingLevel('xhigh')).toBe('high');
    expect(mapThinkingLevel('max')).toBe('high');
    expect(mapThinkingLevel('turbo')).toBeUndefined();
  });
});

describe('stderr 消费（2026-10-16-driver-audit-fixes）', () => {
  it('引擎 stderr 诊断行进 console.warn（流被消费，管道不再可被子进程写满阻塞）', async () => {
    const driver = new DshAcpDriver();
    const q = makeInputQueue();
    const handle = await driver.start(q.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consuming = driver.consume(handle, cb);
    await waitFor(() => readStdin(fake).includes('"method":"initialize"'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fake._emitStderr('dsh bootstrap diagnostic line');
      await waitFor(() =>
        warnSpy.mock.calls.some((c) => String(c[0]).includes('[dsh-driver] stderr')),
      );
      const line = warnSpy.mock.calls.find((c) =>
        String(c[0]).includes('[dsh-driver] stderr'),
      ) as unknown as [string, string];
      expect(line[1]).toContain('dsh bootstrap diagnostic line');
    } finally {
      warnSpy.mockRestore();
    }
    await feedHandshake();
    q.close();
    await consuming;
  }, 10_000);
});
