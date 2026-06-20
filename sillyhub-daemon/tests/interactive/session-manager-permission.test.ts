// tests/interactive/session-manager-permission.test.ts
// scan 真阻塞（generic-wibbling-whisper.md 改造点 C+D daemon 侧）：
//   - per-session manualApproval：create input.manualApproval 决定是否注入 canUseTool
//     （实例级 manualApproval=true 仅表示"能力就绪"，chat session input.manualApproval=false 不注入，
//      避免 chat 的 AskUserQuestion 被 backend drop → 5min 超时 deny）
//   - canUseTool 分流：AskUserQuestion → register（发 PERMISSION_REQUEST，真阻塞）；
//     其他工具（Bash/Read/...）→ 立即 allow（scan 自动跑）
//
// 依据文档：C:\Users\qinyi\.claude\plans\generic-wibbling-whisper.md 改造点 C/D

import { describe, it, expect, vi } from 'vitest';
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

// ── 辅助构造 ───────────────────────────────────────────────────────────────────

/** mock driver：捕获 start 的 options（验证 canUseTool 是否注入）；提供 consume 手柄。 */
function makeDriverCapturingOpts() {
  let capturedOpts: StartOptions | null = null;
  let capturedCb: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedOpts = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCb = cb;
    }),
    interrupt: vi.fn(async (): Promise<boolean> => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    getOpts: (): StartOptions | null => capturedOpts,
    emitResult: (r: SDKResultMessage) => capturedCb?.onResult(r),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

const noopDeps = {
  onTurnResult: vi.fn(
    async (_s: string, _r: string, _res: SDKResultMessage) => {},
  ),
  onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
  onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
};

/** 检测 promise 是否在 tick 内仍 pending（未 settle）。 */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const settled = await Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  return !settled;
}

// ── per-session manualApproval ────────────────────────────────────────────────

describe('per-session manualApproval（scan 真阻塞）', () => {
  it('实例级能力就绪 + create input.manualApproval=true → 注入 canUseTool', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create({ ...BASE_INPUT, manualApproval: true });

    expect(getOpts()?.canUseTool).toBeTypeOf('function');
  });

  it('实例级能力就绪 + create input.manualApproval=false → 不注入 canUseTool', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create({ ...BASE_INPUT, manualApproval: false });

    expect(getOpts()?.canUseTool).toBeUndefined();
  });

  it('create input 不带 manualApproval → 回退实例级 true（兼容现有调用 / cli.ts 能力就绪）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: vi.fn(() => true) },
    });
    await sm.create(BASE_INPUT); // 无 manualApproval 字段 → 回退实例级 true

    expect(getOpts()?.canUseTool).toBeTypeOf('function');
  });

  it('实例级 manualApproval=false（能力未启用）+ input 不带 → 不注入（安全 fail-closed）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    // 不传 opts：实例级 manualApproval 默认 false（cli.ts 未接通时的旧行为）。
    const sm = new SessionManager({ driver, ...noopDeps });
    await sm.create(BASE_INPUT);

    expect(getOpts()?.canUseTool).toBeUndefined();
  });
});

// ── canUseTool AskUserQuestion 分流 ───────────────────────────────────────────

describe('canUseTool AskUserQuestion 分流（scan 歧义阻塞）', () => {
  /**
   * 构造一个 manualApproval=true 的 session，返回注入的 canUseTool 回调 +
   * wsClient.send mock（验证 PERMISSION_REQUEST 是否发出）。
   */
  async function makeApprovalSession() {
    const { driver, getOpts, emitResult } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager({ driver, ...noopDeps }, {
      manualApproval: true,
      permissionWsClient: { send: sendMock },
    });
    // scan 真阻塞：manualApproval=true 注入 canUseTool + askUserOnly=true 让
    // 只有 AskUserQuestion 走人审（其他工具 allow-through）。
    await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: true });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sendMock, emitResult, sm };
  }

  it('AskUserQuestion → register 发 PERMISSION_REQUEST，promise pending（真阻塞）', async () => {
    const { canUseTool, sendMock } = await makeApprovalSession();

    const p = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: '发现 3 个子项目，请选择扫描策略',
            header: '扫描策略',
            options: [
              { label: 'A', description: '逐个独立扫描' },
              { label: 'B', description: '合并为单仓库扫描' },
            ],
          },
        ],
      },
      { signal: undefined },
    );

    // 真阻塞：没有 PERMISSION_RESPONSE 时，promise 保持 pending。
    expect(await isPending(p)).toBe(true);
    // PERMISSION_REQUEST 已发出（backend 据此 publish 审批卡 SSE）。
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
    expect(sentMsg.type).toBe('daemon:permission_request');
    expect(sentMsg.payload.tool_name).toBe('AskUserQuestion');
    // AskUserQuestion 的 input（questions）原样透传到前端渲染。
    expect(sentMsg.payload.input).toMatchObject({
      questions: expect.any(Array),
    });
  });

  it('其他工具（Bash/Read）→ 立即 allow，不发 PERMISSION_REQUEST', async () => {
    const { canUseTool, sendMock } = await makeApprovalSession();

    const decision = await canUseTool('Bash', { command: 'ls -la' }, { signal: undefined });

    expect(decision).toEqual({ behavior: 'allow' });
    // scan 自动跑：Read/Bash/sillyspec 等不阻塞、不发审批请求。
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('PERMISSION_RESPONSE(allow) → resolve pending promise 为 allow，agent 同 turn 继续', async () => {
    const { canUseTool, sendMock, sm } = await makeApprovalSession();

    const p = canUseTool('AskUserQuestion', { questions: [{ question: 'q' }] }, { signal: undefined });
    expect(await isPending(p)).toBe(true);

    // 从发出的 PERMISSION_REQUEST 拿到 request_id，模拟 backend 回 allow。
    const sentMsg = sendMock.mock.calls[0]![0] as { payload: { request_id: string; session_id: string } };
    const resolver = sm.getPermissionResolver(BASE_INPUT.sessionId);
    expect(resolver).toBeDefined();
    resolver!.resolve(
      {
        session_id: sentMsg.payload.session_id,
        request_id: sentMsg.payload.request_id,
        decision: 'allow',
      },
      BASE_INPUT.sessionId,
    );

    expect(await p).toEqual({ behavior: 'allow' });
  });
});
