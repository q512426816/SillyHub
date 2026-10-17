// tests/interactive/zcode-app-server-driver.test.ts
// 2026-10-15-zcode-engine-appserver task-04：驱动单测。
// 策略：vi.mock spawn → FakeChild；FakeZcodeServer 按脚本驱动就绪门/create/
// subscribe/send/权限请求/turn 通知（帧形状 = 2026-10-15 实测钉板）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});
vi.mock('../../src/cmd-shim.js', () => ({
  resolveWindowsCmdShim: vi.fn().mockReturnValue(null),
}));

import { spawn } from 'node:child_process';
import {
  ZcodeAppServerDriver,
  ZcodeExecutableNotFoundError,
  type ZcodeHandle,
  type ZcodeStartOptions,
  type ZcodeSessionPermissionHooks,
} from '../../src/interactive/zcode-app-server-driver.js';
import type {
  InteractiveDriverCallbacks,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import { createFakeChild, readStdin, type FakeChild } from '../helpers/fake-child.js';
import { resolveWindowsCmdShim } from '../../src/cmd-shim.js';
import { buildZcodeProviderConfig } from '../../src/zcode-settings.js';
import type { ProviderConfig } from '../../src/types.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (text: string) => void;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  const queue: AsyncIterable<UserTurnInput> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<UserTurnInput>> {
          // 队列空且未关闭 → 持续等待（真实 InputQueue 语义：close 前 next 挂起）
          while (pending.length === 0 && !closed) {
            await new Promise<void>((r) => setTimeout(r, 5));
          }
          if (pending.length > 0) return { value: pending.shift()!, done: false };
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    queue,
    push: (text: string) => pending.push({ type: 'user', text }),
    close: () => {
      closed = true;
    },
  };
}

function makeOpts(overrides: Partial<ZcodeStartOptions> = {}): ZcodeStartOptions {
  return {
    cwd: 'C:/tmp/zcode-ws',
    pathToAgentExecutable: 'C:/Users/x/AppData/Local/Programs/ZCode/resources/glm/zcode.cjs',
    ...overrides,
  };
}

function makeCallbacks(): {
  cb: InteractiveDriverCallbacks;
  envelopes: Array<{ events: unknown[] }>;
  results: unknown[];
  errors: unknown[];
} {
  const envelopes: Array<{ events: unknown[] }> = [];
  const results: unknown[] = [];
  const errors: unknown[] = [];
  return {
    cb: {
      onTurnMessage: (env) => {
        envelopes.push(env as { events: unknown[] });
      },
      onTurnResult: (r) => {
        results.push(r);
      },
      onTurnError: (e) => {
        errors.push(e);
      },
    },
    envelopes,
    results,
    errors,
  };
}

const WS = 'C:/tmp/zcode-ws';
const ZSID = 'sess_test-zcode-0001';

/**
 * Fake ZCode app-server：watch stdin 请求行，按路由脚本回响应 + 主动通知。
 * 脚本钩子（onSend 等）可定制每方法行为。
 */
class FakeZcodeServer {
  private serverReqId = 0;
  readonly lines: string[] = [];
  /** 轮询游标（FakeChild stdin 是 Writable，不发 'data' 事件——按累积内容增量解析）。 */
  private consumedChars = 0;
  constructor(
    readonly child: FakeChild,
    private readonly hooks: {
      /** manual = 不回 send 应答/不回放轮（测试自行接管）；缺省 auto 全回放 */
      sendMode?: 'auto' | 'manual';
      permissionMode?: 'ask' | 'none';
    } = {},
  ) {
    const timer = setInterval(() => this.poll(), 5);
    timer.unref?.();
    child.on('exit', () => clearInterval(timer));
  }

  private poll(): void {
    const all = readStdin(this.child);
    if (all.length <= this.consumedChars) return;
    const fresh = all.slice(this.consumedChars);
    this.consumedChars = all.length;
    for (const line of fresh.split('\n')) {
      if (!line.trim()) continue;
      this.lines.push(line);
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; /* 半行（等后续增量）*/
      }
      // 服务端请求的应答帧：{id:"server-N", result} → 触发 onReply（权限流回放链）
      if (typeof frame.id === 'string' && frame.id.startsWith('server-') && 'result' in frame) {
        const cb = this.serverReplies.get(frame.id);
        this.serverReplies.delete(frame.id);
        cb?.();
        continue;
      }
      this.route(frame);
    }
  }

  /** 取已发出的指定方法请求（客户端→服务端）。 */
  requestsOf(method: string): Array<Record<string, unknown>> {
    return this.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((f) => f.method === method);
  }

  private route(frame: Record<string, unknown>): void {
    if (typeof frame.method === 'string' && frame.id !== undefined) {
      this.handleClientRequest(frame as { id: number; method: string; params?: unknown });
    }
    // 通知/应答帧不需要路由
  }

  private handleClientRequest(req: { id: number; method: string; params?: unknown }): void {
    switch (req.method) {
      case 'session/create':
        // create 前先发一道 runtimePreferences 服务端请求（实测语义）
        this.emitServerRequest('session/requestRuntimePreferences', {
          sessionId: ZSID,
          scope: 'runtime-materialization',
        });
        // 真实回包形状（2026-10-15 实测钉板）：sessionId 只在 result.session.sessionId，
        // 无顶层直挂——驱动必须读嵌套路径（e2e 冒烟抓出的形状偏差回归钉）
        this.reply(req.id, {
          session: { sessionId: ZSID, status: 'idle' },
          messages: [],
          settings: {},
        });
        // 真机行为：create 后服务端推 state.updated 模型目录（驱动 setModel 前置等待）
        // reasoning 形状 = 2026-10-17 探针钉板：levels 对象数组 + defaultLevel 末档
        this.emitNotification('state.updated', {
          sessionId: ZSID,
          patch: { model: { current: { providerId: 'sillyhub', modelId: 'glm-5.3' }, available: [{ ref: { providerId: 'sillyhub', modelId: 'glm-5.3' }, label: 'glm-5.3', contextWindow: 200000, maxOutputTokens: 128000, reasoning: { levels: [{ value: 'low' }, { value: 'high' }, { value: 'max' }], defaultLevel: 'max' } }] } },
        });
        return;
      case 'session/subscribe':
        this.reply(req.id, {});
        return;
        // 模型目录就绪信号（驱动 setModel 前等待 state.updated）
        this.emitNotification('state.updated', { sessionId: ZSID, patch: { model: { current: { providerId: 'sillyhub', modelId: 'glm-5.3' }, available: [{ ref: { providerId: 'sillyhub', modelId: 'glm-5.3' }, label: 'glm-5.3', contextWindow: 200000, maxOutputTokens: 128000, reasoning: { levels: [] } }] } } });
        return;
      case 'session/setModel':
        this.reply(req.id, {});
        return;
      case 'session/setThoughtLevel':
        this.reply(req.id, {});
        return;
      case 'session/compact':
        this.reply(req.id, {});
        return;
      case 'session/stop':
        this.reply(req.id, {});
        return;
      case 'session/close':
        this.reply(req.id, { closed: true });
        return;
      case 'session/send': {
        const content = String((req.params as { content?: string })?.content ?? '');
        if (this.hooks.sendMode === 'manual') return; // 测试自行回帧
        this.reply(req.id, { accepted: true, sessionId: ZSID });
        // 默认回放一轮：turn.started → text delta → turn.completed
        this.emitNotification('session/event', {
          sessionId: ZSID,
          turnId: 'turn_t1',
          seq: 1,
          type: 'turn.started',
          payload: { input: content },
        });
        this.emitNotification('session/event', {
          sessionId: ZSID,
          turnId: 'turn_t1',
          seq: 2,
          type: 'model.streaming',
          payload: { assistantMessageId: 'msg_a1', delta: '乒乓', done: false, kind: 'text_delta' },
        });
        if (this.hooks.permissionMode === 'ask') {
          // 发权限请求并等待应答（应答回来后在 onServerReply 继续）
          this.emitServerRequest(
            'interaction/requestPermission',
            {
              sessionId: ZSID,
              toolCallId: 'tc_1',
              toolName: 'Bash',
              options: [
                { optionId: 'allow_once', kind: 'allowOnce', response: { decision: 'allow' } },
                { optionId: 'deny', kind: 'deny', response: { decision: 'deny' } },
              ],
            },
            () => {
              this.finishTurn();
            },
          );
          return;
        }
        this.finishTurn();
        return;
      }
      default:
        this.reply(req.id, {});
    }
  }

  private turnFinished = false;
  private finishTurn(): void {
    if (this.turnFinished) return;
    this.turnFinished = true;
    this.emitNotification('session/event', {
      sessionId: ZSID,
      turnId: 'turn_t1',
      seq: 99,
      type: 'turn.completed',
      payload: {
        response: '乒乓',
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105, cacheReadTokens: 95, cacheWriteTokens: 0 },
        duration: 800,
        resultType: 'success',
      },
    });
  }

  /** 发 startup 就绪序列（测试在 spawn 后调用）。 */
  startReady(): void {
    this.child._emitLines([
      JSON.stringify({ method: 'startup/storageState', params: { phase: 'checking', sequence: 1 } }),
      JSON.stringify({ method: 'startup/storageState', params: { phase: 'ready', sequence: 2 } }),
    ]);
  }

  emitNotification(method: string, params: unknown): void {
    this.child._emitLines([JSON.stringify({ method, params })]);
  }

  private serverReplies = new Map<string, () => void>();
  emitServerRequest(method: string, params: unknown, onReply?: () => void): void {
    this.serverReqId += 1;
    const id = `server-${this.serverReqId}`;
    if (onReply) this.serverReplies.set(id, onReply);
    this.child._emitLines([JSON.stringify({ id, method, params })]);
  }

  private reply(id: number, result: unknown): void {
    this.child._emitLines([JSON.stringify({ id, result })]);
  }
}

/** 等待条件真或超时（轮询 10ms）。 */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('until 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveWindowsCmdShim).mockReturnValue(null);
});

// ── 用例 ────────────────────────────────────────────────────────────────────

describe('start 边界', () => {
  it('executable 缺失 → ZcodeExecutableNotFoundError', async () => {
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    await expect(
      driver.start(iq.queue, makeOpts({ pathToAgentExecutable: '' })),
    ).rejects.toBeInstanceOf(ZcodeExecutableNotFoundError);
  });

  it('.cjs 目标 → spawn(process.execPath, [zcode.cjs, app-server, --cwd, dir])', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    await driver.start(iq.queue, makeOpts());
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [makeOpts().pathToAgentExecutable, 'app-server', '--cwd', WS],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
    );
  });
});

describe('consume 全链路（ready → create/subscribe → send → 流式 → 收敛）', () => {
  it('一轮对话：session_started 上报 + text 流事件 + turn_result usage 收敛 + 控制面帧形状', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = (await driver.start(iq.queue, makeOpts({ model: 'GLM-5.3' }))) as ZcodeHandle;
    const { cb, envelopes, results, errors } = makeCallbacks();

    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    // 等会话建立 + 订阅 + setModel 全部完成
    await until(() => server.requestsOf('session/subscribe').length > 0 && server.requestsOf('session/setModel').length > 0);

    // create 期间的 runtimePreferences 服务端请求被自动应答（空偏好帧已回写 stdin）
    await until(() =>
      readStdin(child).includes('"askUserQuestionAutoResolutionEnabled"'),
    );

    iq.push('只回复两个字：乒乓');
    await until(() => results.length > 0);
    iq.close();
    await consumePromise;

    // 控制面帧形状钉板
    const send = server.requestsOf('session/send');
    expect(send).toHaveLength(1);
    expect(send[0]?.params).toEqual({ sessionId: ZSID, content: '只回复两个字：乒乓' });
    expect(server.requestsOf('session/subscribe')[0]?.params).toEqual({
      sessionId: ZSID,
      deliveryKind: 'desktop-continuous',
    });
    // setModel 带引擎自报默认 reasoningLevel（JSON-RPC 对象路径严格校验必需——
    // 缺失即「Reasoning level is required」，2026-10-17 探针 + 真机双实证）
    expect(server.requestsOf('session/setModel')[0]?.params).toEqual({
      sessionId: ZSID,
      model: { providerId: 'sillyhub', modelId: 'glm-5.3', options: { reasoningLevel: 'max' } },
    });

    // 事件流：session_started + text delta
    const allEvents = envelopes.flatMap((e) => e.events as Array<Record<string, unknown>>);
    const sessionStarted = allEvents.find((e) => e.type === 'status' && e.subtype === 'session_started');
    expect(sessionStarted?.session_id).toBe(ZSID);
    const textEv = allEvents.find((e) => e.type === 'text');
    expect(textEv?.content).toBe('乒乓');

    // turn 结果
    expect(results).toHaveLength(1);
    const result = results[0] as Record<string, unknown>;
    expect(result.subtype).toBe('success');
    expect(result.is_error).toBeFalsy();
    expect(result.session_id).toBe(ZSID);
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 5,
      cache_read_tokens: 95,
      cache_creation_tokens: 0,
      ctx_tokens: 105,
      api_duration_ms: 800,
    });
    expect(errors).toHaveLength(0);
  }, 15_000);

  it('consume 自然退出（iq.close）→ finally 对齐 codex：清 _finishTurnOnClose 槽位 + 兜底 close（幂等单次）（2026-10-17-audit-risk-followup）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = (await driver.start(iq.queue, makeOpts({ model: 'GLM-5.3' }))) as ZcodeHandle;
    const { cb, results } = makeCallbacks();

    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/setModel').length > 0);
    iq.push('只回复两个字：乒乓');
    await until(() => results.length > 0);

    // 自然退出路径（非 terminateSession 发起 close）：finally 必须自清槽位并
    // 兜底 close 子进程——旧实现两步全缺，槽位闭包滞留到 GC、子进程回收完全
    // 依赖外部 close 链（codex 同位有 delete + await close，zcode 缺席）。
    const closeSpy = vi.spyOn(handle, 'close');
    iq.close();
    await consumePromise;

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(
      (handle as { _finishTurnOnClose?: () => void })._finishTurnOnClose,
    ).toBeUndefined();
  }, 15_000);

  it('ready 门超时 → 结构化 error result（failed）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = new ZcodeAppServerDriver({ readyTimeoutMs: 80 });
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb, results, errors } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    // 不发 startup ready → 超时
    await consumePromise;
    expect(results).toHaveLength(1);
    const result = results[0] as Record<string, unknown>;
    expect(result.is_error).toBe(true);
    expect(String(result.result)).toContain('ready');
    expect(errors).toHaveLength(1);
  }, 10_000);

  it('session/send 结构化拒绝 → 该轮 error result，不重试', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child, {
      sendMode: 'manual',
    });
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb, results } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);
    iq.push('x');
    await until(() => server.requestsOf('session/send').length > 0);
    const req = server.requestsOf('session/send')[0] as { id: number };
    child._emitLines([
      JSON.stringify({ id: req.id, error: { code: -32602, message: 'Invalid params' } }),
    ]);
    await until(() => results.length > 0);
    iq.close();
    await consumePromise;
    const result = results[0] as Record<string, unknown>;
    expect(result.is_error).toBe(true);
    expect(String(result.result)).toContain('Invalid params');
    // 不重试：send 帧只出现一次
    expect(server.requestsOf('session/send')).toHaveLength(1);
  }, 15_000);
});

describe('审批代答桥三态', () => {
  function setup(hooks: ConstructorParameters<typeof FakeZcodeServer>[1]) {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child, hooks);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    return { child, server, driver, iq };
  }

  async function runToPermission(
    opts: Partial<ZcodeStartOptions>,
  ): Promise<{ child: FakeChild; server: FakeZcodeServer; results: unknown[]; envelopes: Array<{ events: unknown[] }> }> {
    const { child, server, driver, iq } = setup({ permissionMode: 'ask' });
    const handle = await driver.start(iq.queue, makeOpts(opts));
    const { cb, envelopes, results } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);
    iq.push('do it');
    // 等权限请求的应答已回写 stdin（桥完成）
    await until(() => /server-\d/.test(readStdin(child)) && readStdin(child).includes('outcome'));
    await until(() => results.length > 0);
    iq.close();
    await consumePromise;
    return { child, server, results, envelopes };
  }

  it('manualApproval=false → 自动放行（选 allow_once）', async () => {
    const { child } = await runToPermission({ manualApproval: false });
    const stdin = readStdin(child);
    const reply = JSON.parse(
      stdin.slice(stdin.lastIndexOf('{"id":"server-')).split('\n').find((l) => l.startsWith('{"id":"server-'))!,
    ) as { id: string; result: { outcome: { outcome: string; optionId: string } } };
    expect(reply.result.outcome).toEqual({ outcome: 'selected', optionId: 'allow_once' });
  }, 15_000);

  it('manualApproval=true 无 sessionPermission → fail-closed（选 deny）', async () => {
    const { child } = await runToPermission({ manualApproval: true });
    const stdin = readStdin(child);
    const reply = JSON.parse(
      stdin.slice(stdin.lastIndexOf('{"id":"server-')).split('\n').find((l) => l.startsWith('{"id":"server-'))!,
    ) as { result: { outcome: { optionId: string } } };
    expect(reply.result.outcome.optionId).toBe('deny');
  }, 15_000);

  it('manualApproval=true + 用户 allow → allow_once；deny → deny', async () => {
    const allow: ZcodeSessionPermissionHooks = {
      requestPermission: async () => ({ behavior: 'allow' }),
    };
    const { child } = await runToPermission({ manualApproval: true, sessionPermission: allow });
    const stdin = readStdin(child);
    const reply = JSON.parse(
      stdin.slice(stdin.lastIndexOf('{"id":"server-')).split('\n').find((l) => l.startsWith('{"id":"server-'))!,
    ) as { result: { outcome: { optionId: string } } };
    expect(reply.result.outcome.optionId).toBe('allow_once');

    const deny: ZcodeSessionPermissionHooks = {
      requestPermission: async () => ({ behavior: 'deny' }),
    };
    const r2 = await runToPermission({ manualApproval: true, sessionPermission: deny });
    const stdin2 = readStdin(r2.child);
    const reply2 = JSON.parse(
      stdin2.slice(stdin2.lastIndexOf('{"id":"server-')).split('\n').find((l) => l.startsWith('{"id":"server-'))!,
    ) as { result: { outcome: { optionId: string } } };
    expect(reply2.result.outcome.optionId).toBe('deny');
  }, 25_000);
});

describe('interrupt / compact / setThinkingLevel', () => {
  it('无 active turn → false；有轮 → session/stop 帧发出', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child, {
      sendMode: 'manual', // 不回放 turn——保持 in-flight
    });
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);

    // 未发轮：interrupt false
    expect(await driver.interrupt(handle)).toBe(false);

    // in-flight 轮：interrupt true + stop 帧形状
    iq.push('long task');
    await until(() => server.requestsOf('session/send').length > 0);
    expect(await driver.interrupt(handle)).toBe(true);
    const stop = server.requestsOf('session/stop');
    expect(stop).toHaveLength(1);
    expect(stop[0]?.params).toEqual({ sessionId: ZSID });

    iq.close();
    handle.close();
    await consumePromise.catch(() => {});
  }, 15_000);

  it('compact → session/compact 帧 + ok:true', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);
    const r = await driver.compact(handle);
    expect(r.ok).toBe(true);
    expect(server.requestsOf('session/compact')).toHaveLength(1);
    iq.close();
    await consumePromise;
  }, 15_000);

  it('setThinkingLevel：平台档 → 引擎档映射 + 帧；非法档拒绝', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);

    const ok = await driver.setThinkingLevel(handle, 'high');
    expect(ok.ok).toBe(true);
    expect(server.requestsOf('session/setThoughtLevel')[0]?.params).toEqual({
      sessionId: ZSID,
      level: 'high',
    });
    // xhigh 降级 high（矩阵）
    const ok2 = await driver.setThinkingLevel(handle, 'xhigh');
    expect(ok2.ok).toBe(true);
    expect(server.requestsOf('session/setThoughtLevel')[1]?.params).toEqual({
      sessionId: ZSID,
      level: 'high',
    });
    // off = 不携带 → 驱动拒绝（undefined 映射）
    const off = await driver.setThinkingLevel(handle, 'off');
    expect(off.ok).toBe(false);
    iq.close();
    await consumePromise;
  }, 15_000);
});

// ── 审计修复回归（2026-10-16-driver-audit-fixes）────────────────────────────
// 对照先例：codex-app-server-driver ql-20260906-004 审计 #9（close 释放轮次）、
// pi-rpc-driver ql-20260915-005（跨 chunk 多字节 UTF-8）。

describe('审计修复：close 释放轮次 / UTF-8 跨 chunk / kill 升级 / stdin error 兜底', () => {
  it('轮次进行中 close → consume 收敛返回，不上报幽灵 result（旧实现永挂）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child, { sendMode: 'manual' });
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb, results } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);
    iq.push('long task');
    await until(() => server.requestsOf('session/send').length > 0);
    // 轮 in-flight（sendMode=manual 不回 turn_result）时 close：exit handler 因
    // closing 早退且无人释放 currentTurnPromise → 旧实现 await 永挂（测试超时即红）
    const closePromise = handle.close();
    await expect(consumePromise).resolves.toBeUndefined();
    // cancelled 终态归 close 链收敛，不报幽灵 result（对齐 codex closing 守卫）
    expect(results).toHaveLength(0);
    iq.close();
    await closePromise;
  }, 15_000);

  it('stdout 跨 chunk 多字节 UTF-8：中文字符不再被切烂成 U+FFFD', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb, envelopes } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);

    // 手工构造跨 chunk 帧：从首个多字节字符的引导字节后切开（真实管道 chunk
    // 边界任意，旧实现逐 chunk toString 会把跨边界序列变 U+FFFD）
    const frame = JSON.stringify({
      method: 'session/event',
      params: {
        sessionId: ZSID,
        turnId: 'turn_utf8',
        seq: 1,
        type: 'model.streaming',
        payload: {
          assistantMessageId: 'msg_u1',
          delta: '知识库审计修复',
          done: false,
          kind: 'text_delta',
        },
      },
    });
    const bytes = Buffer.from(frame, 'utf8');
    let cut = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i]! >= 0x80) {
        cut = i + 1; // 引导字节与其延续字节之间
        break;
      }
    }
    expect(cut).toBeGreaterThan(0);
    child.stdout.push(bytes.subarray(0, cut));
    child.stdout.push(bytes.subarray(cut));
    child.stdout.push(Buffer.from('\n', 'utf8'));

    await until(() =>
      envelopes
        .flatMap((e) => e.events as Array<Record<string, unknown>>)
        .some((e) => e.type === 'text'),
    );
    const textEv = envelopes
      .flatMap((e) => e.events as Array<Record<string, unknown>>)
      .find((e) => e.type === 'text');
    expect(textEv?.content).toBe('知识库审计修复');
    expect((textEv?.content as string).includes('\uFFFD')).toBe(false);
    iq.close();
    await consumePromise;
  }, 15_000);

  it('close 阶梯：SIGTERM 后到期无条件升级 SIGKILL（killed 置位不再短路）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const server = new FakeZcodeServer(child);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, makeOpts());
    const { cb } = makeCallbacks();
    const consumePromise = driver.consume(handle, cb);
    await until(() => vi.mocked(spawn).mock.calls.length > 0);
    server.startReady();
    await until(() => server.requestsOf('session/subscribe').length > 0);
    iq.close();
    await consumePromise;
    await handle.close();
    // ~2s SIGTERM；FakeChild.kill 置 killed=true（真实 Node 语义：信号发出即置位，
    // 不代表进程已终止）——旧实现此后 !killed 恒 false，SIGKILL 永不可达
    const lastSignal = () =>
      (child as unknown as { _lastKillSignal?: string })._lastKillSignal;
    await until(() => lastSignal() === 'SIGTERM', 4_000);
    await until(() => lastSignal() === 'SIGKILL', 4_000);
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(true);
  }, 20_000);

  it('stdin 常驻 error 监听：destroy 后迟到写入不炸 uncaughtException', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    await driver.start(iq.queue, makeOpts());
    // 引擎退出后 stdin 被 destroy，审批桥应答/close 迟到写入会触发 'error'；
    // 无监听 → uncaughtException（vitest worker 直接判红），有监听 → 吞掉
    expect(child.stdin.listenerCount('error')).toBeGreaterThan(0);
    child.stdin.destroy(new Error('EPIPE simulate'));
    await new Promise((r) => setImmediate(r));
    child.stdin.write('{"late":1}\n');
    await new Promise((r) => setImmediate(r));
  });
});

// ── 写盘器 api_format 词表映射（provider-adapter-registry 守护③ smokeSuite 判据）──
// zcode 写盘器按 provider.api_format 二值映射 api.type（zcode-settings.ts zcodeApiType）：
// 'openai_chat' → 'openai-chat-completions'（LiteLLM/hub 代理 baseUrl + daemon key）；
// 'anthropic'/缺省 → 'anthropic-messages'（直连 baseUrl + provider key）。
// API_FORMAT_VOCAB（'anthropic' | 'openai_chat'）加值时本组用例同步扩展。

describe('写盘器 api_format 词表映射（buildZcodeProviderConfig）', () => {
  function ruleOf(provider: ProviderConfig, daemonApiKey?: string | null) {
    const content = buildZcodeProviderConfig({
      zcodeDir: 'C:/tmp/zcode-ws',
      provider,
      daemonApiKey,
    });
    const config = (
      content as {
        config: {
          providerConfigRules: {
            providerRules: Array<{ config: { api: { type: string; baseUrl: string } } }>;
          };
        };
      }
    ).config.providerConfigRules.providerRules[0]!.config;
    return config.api;
  }

  it("api_format 'openai_chat' → api.type 'openai-chat-completions'（hub 代理 baseUrl + daemon key）", () => {
    const api = ruleOf(
      {
        api_format: 'openai_chat',
        litellm_base_url: 'http://hub/api/daemon/llm-proxy',
        litellm_proxy: true,
        model: 'usr-u1-p1',
      },
      'dh-live-key',
    );
    expect(api.type).toBe('openai-chat-completions');
    expect(api.baseUrl).toBe('http://hub/api/daemon/llm-proxy');
  });

  it("api_format 'anthropic' 与缺省 → api.type 'anthropic-messages'（直连 baseUrl + provider key）", () => {
    for (const api_format of ['anthropic', undefined] as const) {
      const api = ruleOf({
        api_format,
        base_url: 'https://api.upstream.example',
        api_key: 'sk-upstream',
        model: 'GLM-5.3',
      });
      expect(api.type).toBe('anthropic-messages');
      expect(api.baseUrl).toBe('https://api.upstream.example');
    }
  });
});
