// tests/interactive/session-manager-inject-attachment.test.ts
// ql-20260825-f6#3：inject 附件下载超时 + 下载窗口内 end 的错误转译。
//
// 修复前：
//   - downloadAttachment 无超时——backend / 网络挂起时 inject 永久卡在 await；
//   - 下载 await 窗口内 end() 收口（inputQueue.close）后 push 抛
//     SessionQueueClosedError 原样冒泡给 WS 调用方，错误语义含混。
// 修复后：
//   - 下载 60s 超时 → SessionAttachmentTimeoutError（带会话 id）→ 单附件 catch
//     降级「下载失败: <name>」标注（不中断 turn）；
//   - push 撞 closed queue → 转译 SessionNotActiveError（不泄漏队列内部错误类）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import {
  SessionAttachmentTimeoutError,
  SessionNotActiveError,
} from '../../src/interactive/types.js';
import type { SessionInjectAttachment } from '../../src/protocol.js';
import { SessionQueueClosedError } from '../../src/interactive/input-queue.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MS = 60_000;

function makeMockDriver() {
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query =>
        fakeQuery,
    ),
    consume: vi.fn(async (_q: Query, _cb: ConsumeCallbacks): Promise<void> => {
      // 不自动 yield；测试按需注入消息。
    }),
    interrupt: vi.fn(async (_q: Query | null): Promise<boolean> => true),
  } as unknown as ClaudeSdkDriver;
  return { driver, fakeQuery };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(
      async (_s: string, _r: string, _res: SDKResultMessage) => {},
    ),
    onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-att',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

function att(over: Partial<SessionInjectAttachment> = {}): SessionInjectAttachment {
  return {
    id: 'att-1',
    kind: 'image',
    media_type: 'image/png',
    name: 'pic.png',
    bytes: 4,
    deliver: 'block',
    ...over,
  };
}

/** 手动受控的下载闭包（never settle / 延迟 resolve 由测试驱动）。 */
function makeDeferredDownload() {
  let resolve!: (b: Buffer) => void;
  const promise = new Promise<Buffer>((r) => {
    resolve = r;
  });
  const fn = vi.fn((_id: string) => promise);
  return { fn, resolve };
}

// 白盒桥接私有字段/方法。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (sm: SessionManager): any => sm as any;

/** 读真实 InputQueue 的未消费 buffer 首条（白盒观察 push 结果）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstQueuedTurn(sm: SessionManager): any {
  const state = priv(sm)._store.get('sess-att');
  // 首条 firstPrompt 已被 mock consume 之外无人消费？——mock driver.start 订阅真实
  // InputQueue，create 后 firstPrompt 可能仍在 buffer。取最后一条（最新 push）。
  const buf = state.inputQueue._buffer as unknown[];
  return buf[buf.length - 1];
}

// ── 下载超时 ──────────────────────────────────────────────────────────────────

describe('inject 附件下载超时（ql-20260825-f6#3）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('挂起下载 60s 后：_downloadAttachmentWithTimeout 抛 SessionAttachmentTimeoutError（带会话 id）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const never = () => new Promise<Buffer>(() => {});
    const p = priv(sm)._downloadAttachmentWithTimeout(
      'sess-att',
      never,
      'att-1',
    );
    const assertion = expect(p).rejects.toBeInstanceOf(
      SessionAttachmentTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1);
    await assertion;
    await expect(p).rejects.toMatchObject({
      name: 'SessionAttachmentTimeoutError',
      code: 'SESSION_ATTACHMENT_TIMEOUT',
    });
    // 错误 message 带会话 id 与附件 id。
    await p.catch((e: Error) => {
      expect(e.message).toContain('sess-att');
      expect(e.message).toContain('att-1');
    });
  });

  it('下载先成功：超时定时器被清（推进 60s+ 不触发误超时）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const dl = vi.fn(async () => Buffer.from('ok'));
    const buf = await priv(sm)._downloadAttachmentWithTimeout(
      'sess-att',
      dl,
      'att-1',
    );
    expect(buf.toString()).toBe('ok');
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1);
    // 已完成：无后续 reject（promise 已 settled 为成功）。
    expect(dl).toHaveBeenCalledWith('att-1');
  });

  it('inject 行为路径：挂起下载 60s 后降级标注（下载失败: pic.png），turn 不中断', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const never = () => new Promise<Buffer>(() => {});
    const pending = sm.inject('sess-att', '看图', 'run-2', [att()], never);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1);
    const res = await pending;
    expect(res.runId).toBe('run-2');
    // push 已发生（turn 未被卡死）：最新排队消息带降级标注。
    const turn = firstQueuedTurn(sm);
    expect(turn.text).toContain('看图');
    expect(turn.text).toContain('(下载失败: pic.png)');
    expect(sm.get('sess-att')!.status).toBe('running');
    expect(sm.get('sess-att')!.currentRunId).toBe('run-2');
  });
});

// ── 下载窗口内 end：SessionQueueClosedError 转译 ──────────────────────────────

describe('inject 下载期间 end() 的错误转译（ql-20260825-f6#3）', () => {
  it('下载期间 end() → push 撞 closed queue → 转 SessionNotActiveError（不泄漏队列内部错误）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const dl = makeDeferredDownload();
    const pending = sm.inject('sess-att', '看图', 'run-2', [att()], dl.fn);

    // 下载在飞时 end()：inputQueue.close + status=ended + onSessionEnd。
    await sm.end('sess-att');
    expect(sm.get('sess-att')!.status).toBe('ended');

    // 下载随后（成功）返回 → inject 继续走到 push → queue 已 close。
    dl.resolve(Buffer.from('late'));
    const err = await pending.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionNotActiveError);
    expect(err).not.toBeInstanceOf(SessionQueueClosedError);
    expect((err as SessionNotActiveError).code).toBe('SESSION_NOT_ACTIVE');
    expect((err as Error).message).toContain('status=ended');
  });

  it('下载期间 fail() → 同样转译（status=failed）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const dl = makeDeferredDownload();
    const pending = sm.inject('sess-att', '看图', 'run-2', [att()], dl.fn);
    await sm.fail('sess-att');
    dl.resolve(Buffer.from('late'));
    const err: unknown = await pending.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionNotActiveError);
    expect((err as Error).message).toContain('status=failed');
  });
});

// ── 回归：正常下载路径不受超时包装影响 ────────────────────────────────────────

describe('inject 附件正常下载回归（ql-20260825-f6#3）', () => {
  it('下载即时成功 → 多模态 block 生成，无失败标注', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const dl = vi.fn(async () => Buffer.from('pngbytes'));
    const res = await sm.inject('sess-att', '看图', 'run-2', [att()], dl);
    expect(res.runId).toBe('run-2');
    const turn = firstQueuedTurn(sm);
    expect(turn.text).toBe('看图');
    expect(turn.text).not.toContain('下载失败');
    const blocks = turn.blocks as Array<{ type: string; base64: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('image');
    expect(blocks[0]!.base64).toBe(Buffer.from('pngbytes').toString('base64'));
  });
});
