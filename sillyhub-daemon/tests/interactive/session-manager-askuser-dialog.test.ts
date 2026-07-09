// tests/interactive/session-manager-askuser-dialog.test.ts
// task-07 / FR-006：验证 AskUserQuestion 人审入口 + 5min 超时消除 + 非 AskUserQuestion allow-through。
//
// 2026-07-08-daemon-permission-verify-fix 的 daemon 侧钉死测试：
//   1. AskUserQuestion 走 dialog（resolver.register 带 dialogKind），不启 5min
//      兜底定时器——推进超过 PERMISSION_FALLBACK_TIMEOUT_MS 仍 pending（不超时，
//      等前端用户回答）。5min 超时根因是 ask_user_only=false（task-01 修），
//      非 bypassPermissions（task-02 撤回）。
//   2. 非 AskUserQuestion 工具（askUserOnly=true 下）立即 allow-through，不调
//      resolver.register、不发 PERMISSION_REQUEST（FR-006，scan 自动推进）。
//   3. permissionMode='default'（task-02 撤回 635c0d4a bypassPermissions 验证）。
//
// 依据：
//   - design：changes/2026-07-08-daemon-permission-verify-fix/design.md（D-002 撤回 bypass）
//   - 源码：src/interactive/session-manager.ts:799（permissionMode='default'）
//           src/interactive/session-manager.ts:1107-1164（AskUserQuestion 拦截走 dialog）
//           src/interactive/session-manager.ts:1169-1173（askUserOnly allow-through）
//           src/interactive/permission-resolver.ts:194-210（dialog 不启 fallback timer）
//
// 测试风格参考 session-manager-permission.test.ts（makeDriverCapturingOpts helper）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PERMISSION_FALLBACK_TIMEOUT_MS } from '../../src/interactive/permission-resolver.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ───────────────────────────────────────────────────────────────────

/** mock driver：捕获 start 的 options（验证 permissionMode / canUseTool）。 */
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
  sessionId: 'sess-askuser',
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

/** 构造 manualApproval=true + askUserOnly=true 的 scan session，返回 canUseTool 回调 +
 * wsClient.send mock + SessionManager 句柄。 */
async function makeScanApprovalSession() {
  const { driver, getOpts } = makeDriverCapturingOpts();
  const sendMock = vi.fn(() => true);
  const sm = new SessionManager(
    { driver, ...noopDeps },
    {
      manualApproval: true,
      permissionWsClient: { send: sendMock },
    },
  );
  // scan 真阻塞：manualApproval=true 注入 canUseTool + askUserOnly=true 让
  // 只有 AskUserQuestion 走人审（其他工具 allow-through）。
  await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: true });
  const canUseTool = getOpts()?.canUseTool;
  expect(canUseTool).toBeTypeOf('function');
  return { canUseTool: canUseTool!, sendMock, sm, getOpts };
}

// ── 用例 1：AskUserQuestion 走 dialog 不触发 5min 超时 ──────────────────────────

describe('AskUserQuestion 走 dialog 不触发 5min 超时（FR-006 根因 1 消除）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AskUserQuestion → register 带 dialogKind，推进超 PERMISSION_FALLBACK_TIMEOUT_MS 仍 pending', async () => {
    const { canUseTool, sendMock } = await makeScanApprovalSession();

    // canUseTool 是 async 函数，先同步调用拿到 promise，再推进假时钟。
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

    // 发出 PERMISSION_REQUEST（dialog_kind=AskUserQuestion）。
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(sentMsg.type).toBe('daemon:permission_request');
    expect(sentMsg.payload.tool_name).toBe('AskUserQuestion');
    // dialog_kind 标记 → backend 走对话路径不 arm 5min 超时 + resolver 不启 fallback timer。
    expect(sentMsg.payload.dialog_kind).toBe('AskUserQuestion');

    // 推进超过 5min 兜底定时器（PERMISSION_FALLBACK_TIMEOUT_MS = 5min + 5s）。
    // dialog 请求不启 fallback timer → 推进后 promise 仍 pending（不超时 deny）。
    vi.advanceTimersByTime(PERMISSION_FALLBACK_TIMEOUT_MS + 10_000);

    // 用 isPending 检测（需切回 real timers 让 setTimeout(30) 跑）。
    vi.useRealTimers();
    expect(await isPending(p)).toBe(true);
  });

  it('普通审批（非 dialog）推进超 PERMISSION_FALLBACK_TIMEOUT_MS → deny（对照：兜底定时器仅普通审批启）', async () => {
    // 对照用例：askUserOnly=false 下，非 AskUserQuestion 工具走 register（无 dialogKind）
    // → 启 5min 兜底定时器 → 推进后 deny。证明 fallback timer 仅普通审批生效，
    // AskUserQuestion（dialog）确实不启，故不超时。
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionWsClient: { send: sendMock },
      },
    );
    // askUserOnly=false：非 AskUserQuestion 工具走 register（普通审批，启 fallback timer）。
    await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: false });
    const canUseTool = getOpts()?.canUseTool!;
    expect(canUseTool).toBeTypeOf('function');

    const p = canUseTool('Bash', { command: 'rm -rf /' }, { signal: undefined });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    // 普通审批无 dialog_kind。
    expect(sentMsg.payload.dialog_kind).toBeUndefined();

    // 推进超过 5min 兜底 → deny（普通审批启了 fallback timer）。
    vi.advanceTimersByTime(PERMISSION_FALLBACK_TIMEOUT_MS + 10_000);
    vi.useRealTimers();
    const decision = (await p) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('timeout');
  });
});

// ── 用例 2：非 AskUserQuestion 工具 allow-through ──────────────────────────────

describe('非 AskUserQuestion 工具 allow-through（FR-006，scan 自动推进）', () => {
  it('askUserOnly=true 下 Bash → 立即 allow，不调 resolver.register / 不发 PERMISSION_REQUEST', async () => {
    const { canUseTool, sendMock } = await makeScanApprovalSession();

    const decision = await canUseTool('Bash', { command: 'ls -la' }, {
      signal: undefined,
    });

    // allow-through：透传归一化 updatedInput。
    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
    });
    // scan 自动跑：不阻塞、不发审批请求（pendingCount 保持 0）。
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('askUserOnly=true 下 Read → 立即 allow（读工具不阻塞 scan）', async () => {
    const { canUseTool, sendMock } = await makeScanApprovalSession();

    const decision = await canUseTool(
      'Read',
      { file_path: '/data/specs/ws/proposal.md' },
      { signal: undefined },
    );

    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/data/specs/ws/proposal.md' },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('mcp__ 前缀工具不误判为 AskUserQuestion（识别靠 toolName === "AskUserQuestion"）', async () => {
    // 约束：AskUserQuestion 识别靠精确匹配，mcp__ 前缀工具不当 AskUserQuestion。
    // askUserOnly=true 下 mcp__ 工具走 allow-through（非 AskUserQuestion 分支）。
    const { canUseTool, sendMock } = await makeScanApprovalSession();

    const decision = await canUseTool(
      'mcp__playwright__browser_navigate',
      { url: 'http://localhost:3001' },
      { signal: undefined },
    );

    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { url: 'http://localhost:3001' },
    });
    // 未发 PERMISSION_REQUEST（未误判走 AskUserQuestion dialog 分支）。
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// ── 用例 3：permissionMode=default（task-02 撤回 bypassPermissions）────────────

describe('permissionMode=default（task-02 撤回 635c0d4a bypassPermissions）', () => {
  it('scan session（manualApproval=true + askUserOnly=true）→ driverOpts.permissionMode="default"', async () => {
    const { getOpts } = await makeScanApprovalSession();
    const opts = getOpts()!;
    // task-02 撤回：permissionMode 必须是 'default'，不是 'bypassPermissions'。
    // ClaudeStartOptions 未声明 permissionMode 字段（动态设置），用 record 访问。
    const permissionMode = (opts as unknown as Record<string, unknown>)
      .permissionMode;
    expect(permissionMode).toBe('default');
    expect(permissionMode).not.toBe('bypassPermissions');
  });

  it('canUseTool 注入仍生效（permissionMode=default 下 SDK 仍调 canUseTool）', async () => {
    // task-02 注释：bypassPermissions 下 SDK 仍调 canUseTool（未生效且语义混淆），
    // 故撤回改 default。本用例钉死 default 模式下 canUseTool 仍注入（写守卫 + 人审不失效）。
    const { getOpts } = await makeScanApprovalSession();
    const opts = getOpts()!;
    expect(typeof opts.canUseTool).toBe('function');
    expect(
      (opts as unknown as Record<string, unknown>).permissionMode,
    ).toBe('default');
  });
});
