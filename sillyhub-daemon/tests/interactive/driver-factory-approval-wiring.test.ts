// tests/interactive/driver-factory-approval-wiring.test.ts
// 2026-10-16-driver-audit-fixes：审批三态旗标接线回归钉——
//   spec.enableApproval / effectiveAskUserOnly 必须映射为 codex 族的
//   driverOpts.manualApproval / askUserOnly，且 sessionPermission 注入名单含 zcode。
//   旧实现缺陷：manualApproval/askUserOnly 从未赋值 → 驱动侧
//   `!opts.manualApproval || opts.askUserOnly` 恒真 → 权限请求恒 allow-through
//   （fail-open），已注入的 sessionPermission 成死代码；zcode 亦漏在名单外。
//   基类 InteractiveDriverStartOptions 对两字段的契约（"driver 读取并据此决定
//   审批行为"）即本接线的设计依据。

import { beforeEach, describe, it, expect, vi } from 'vitest';

// git 审批接线测试（2026-11-06-session-git-approval task-04）：mock 采集器
//（采集面在 git-approval-collector.test.ts 覆盖，这里测接线可达性）。
vi.mock('../../src/interactive/git-approval-collector.js', () => ({
  collectGitApprovalPayload: vi.fn(),
}));
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
} from '../../src/interactive/driver.js';
import type { InteractiveProvider } from '../../src/interactive/providers.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

function makeCapturingDriver(provider: InteractiveProvider) {
  let capturedOpts: InteractiveDriverStartOptions | null = null;
  const driver = {
    provider,
    start: vi.fn(async (_input: AsyncIterable<unknown>, opts: InteractiveDriverStartOptions) => {
      capturedOpts = opts;
      return {
        provider,
        processId: 4242,
        close: async (): Promise<void> => {},
      } as unknown as InteractiveDriverHandle;
    }),
    consume: vi.fn(async (): Promise<void> => {}),
    interrupt: vi.fn(async (): Promise<boolean> => true),
  } as unknown as InteractiveDriver;
  return { driver, getOpts: (): InteractiveDriverStartOptions | null => capturedOpts };
}

const noopDeps = {
  onTurnResult: vi.fn(async () => {}),
  onTurnMessage: vi.fn(async () => {}),
  onSessionEnd: vi.fn(async () => {}),
};

const permissionWsClient = { send: vi.fn(() => true) };

function baseInput(provider: InteractiveProvider) {
  return {
    sessionId: `sess-${provider}`,
    leaseId: 'lease-1',
    firstPrompt: 'hi',
    firstRunId: 'run-1',
    cwd: 'C:\\work',
    provider,
    pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
    pathToAgentExecutable: `C:\\bin\\${provider}.cjs`,
  };
}

// ── 用例 ─────────────────────────────────────────────────────────────────────

describe('审批三态接线（driver-factory → codex 族 driverOpts）', () => {
  it('zcode + manualApproval=true → opts.manualApproval=true / askUserOnly=false / sessionPermission 注入', async () => {
    const { driver, getOpts } = makeCapturingDriver('zcode');
    const sm = new SessionManager(
      { drivers: { zcode: driver }, ...noopDeps },
      { manualApproval: true, permissionWsClient },
    );
    await sm.create({ ...baseInput('zcode'), manualApproval: true });

    const opts = getOpts() as unknown as Record<string, unknown>;
    expect(opts).not.toBeNull();
    expect(opts.manualApproval).toBe(true);
    expect(opts.askUserOnly).toBe(false);
    const hooks = opts.sessionPermission as
      | { requestPermission?: unknown; requestUserDialog?: unknown }
      | undefined;
    expect(typeof hooks?.requestPermission).toBe('function');
    expect(typeof hooks?.requestUserDialog).toBe('function');
  }, 15_000);

  it('codex + manualApproval=true → 同款映射（旧实现恒 allow-through 的回归钉）', async () => {
    const { driver, getOpts } = makeCapturingDriver('codex');
    const sm = new SessionManager(
      { drivers: { codex: driver }, ...noopDeps },
      { manualApproval: true, permissionWsClient },
    );
    await sm.create({ ...baseInput('codex'), manualApproval: true });

    const opts = getOpts() as unknown as Record<string, unknown>;
    expect(opts.manualApproval).toBe(true);
    expect(opts.askUserOnly).toBe(false);
    expect(opts.sessionPermission).toBeDefined();
  }, 15_000);

  it('askUserOnly=true 透传（驱动侧 allow-through 语义输入面）', async () => {
    const { driver, getOpts } = makeCapturingDriver('zcode');
    const sm = new SessionManager(
      { drivers: { zcode: driver }, ...noopDeps },
      { manualApproval: true, permissionWsClient },
    );
    await sm.create({ ...baseInput('zcode'), manualApproval: true, askUserOnly: true });

    const opts = getOpts() as unknown as Record<string, unknown>;
    expect(opts.manualApproval).toBe(true);
    expect(opts.askUserOnly).toBe(true);
  }, 15_000);

  it('manualApproval=false（chat）→ 映射块整体不进：opts 无 manualApproval 键、不注入 sessionPermission', async () => {
    const { driver, getOpts } = makeCapturingDriver('zcode');
    const sm = new SessionManager(
      { drivers: { zcode: driver }, ...noopDeps },
      { manualApproval: true, permissionWsClient },
    );
    await sm.create({ ...baseInput('zcode'), manualApproval: false });

    const opts = getOpts() as unknown as Record<string, unknown>;
    // enableApproval=false → approvalReady=false → 注入块整体跳过：键缺省
    //（undefined）。驱动侧 `!opts.manualApproval` 恒真 → allow-through，与
    // chat「无人审」既有语义等价；映射只在审批就绪面生效。
    expect(opts.manualApproval).toBeUndefined();
    expect(opts.sessionPermission).toBeUndefined();
  }, 15_000);
});

// ── git 审批接线（2026-11-06-session-git-approval task-04 / D-016 / R-12）────────

import { collectGitApprovalPayload as collectGitApprovalPayloadRef } from '../../src/interactive/git-approval-collector.js';

describe('git 审批接线（enableApproval=false + writeGuardEnabled 分支）', () => {
  const collectMock = vi.mocked(collectGitApprovalPayloadRef);

  beforeEach(() => {
    collectMock.mockReset();
    delete process.env.SILLYHUB_GIT_APPROVAL;
  });

  function okPayload() {
    return {
      operation: 'commit',
      command: 'git commit -m x',
      worktree: 'C:\\work',
      branch: 'main',
      message: 'x',
      files: [],
      defaultSelected: [],
    };
  }

  /** chat 会话（manualApproval=false）+ 写守卫（allowedRootsProvider）+ 通道就绪。 */
  async function makeChatSession(over?: { wsClient?: unknown }) {
    const { driver, getOpts } = makeCapturingDriver('claude' as never);
    const sm = new SessionManager(
      { drivers: { claude: driver }, ...noopDeps } as never,
      {
        manualApproval: true,
        permissionWsClient: (over?.wsClient ?? permissionWsClient) as never,
        allowedRootsProvider: () => ['C:\\work'],
      } as never,
    );
    await sm.create({ ...baseInput('claude' as never), manualApproval: false } as never);
    const opts = getOpts() as unknown as {
      canUseTool?: (n: string, i: unknown, o?: { signal?: AbortSignal }) => Promise<unknown>;
    };
    return { canUseTool: opts.canUseTool, sm };
  }

  it('R-12：会话启动即拦截可达——首个 Bash git commit 即 resolver.register（dialog_kind=git_approval）', async () => {
    collectMock.mockResolvedValueOnce(okPayload() as never);
    const send = vi.fn(() => true);
    const { canUseTool, sm } = await makeChatSession({ wsClient: { send } });
    expect(typeof canUseTool).toBe('function');
    const p = canUseTool!('Bash', { command: 'git commit -m x' }, { signal: undefined });
    // 等 collect（mock）→ register → send；包对象防 async 展开陷阱（同 task-03 教训）。
    await new Promise((r) => setTimeout(r, 200));
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0] as { payload: Record<string, unknown> };
    expect(sent.payload.dialog_kind).toBe('git_approval');
    // resolver 已随会话启动构造（D-016 与 approvalReady 分支同时机）。
    expect(sm.getPermissionResolver('sess-claude')).toBeDefined();
    // deny 收口（不留 pending promise）。
    sm.getPermissionResolver('sess-claude')!.resolve(
      {
        session_id: 'sess-claude',
        request_id: sent.payload.request_id as string,
        decision: 'deny',
        message: '先不提交',
      },
      'sess-claude',
    );
    const decision = (await p) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('用户拒绝了本次提交');
  }, 15_000);

  it('SILLYHUB_GIT_APPROVAL=off → 不拦（逃生阀与现状一致）', async () => {
    process.env.SILLYHUB_GIT_APPROVAL = 'off';
    const send = vi.fn(() => true);
    const { canUseTool } = await makeChatSession({ wsClient: { send } });
    const decision = (await canUseTool!('Bash', { command: 'git commit -m x' }, {
      signal: undefined,
    })) as { behavior: string };
    expect(decision.behavior).toBe('allow');
    expect(send).not.toHaveBeenCalled();
  }, 15_000);

  it('通道缺失（无 wsClient）→ 不接线不抛错（fail-soft 走现状写校验）', async () => {
    collectMock.mockResolvedValueOnce(okPayload() as never);
    const { driver, getOpts } = makeCapturingDriver('claude' as never);
    const sm = new SessionManager(
      { drivers: { claude: driver }, ...noopDeps } as never,
      {
        // 实例级 manualApproval=false（构造校验：true 必配 wsClient）——
        // 不传 permissionWsClient → 通道缺失 → git 接线 fail-soft 走现状写校验。
        manualApproval: false,
        allowedRootsProvider: () => ['C:\\work'],
      } as never,
    );
    await sm.create({ ...baseInput('claude' as never), manualApproval: false } as never);
    const opts = getOpts() as unknown as {
      canUseTool?: (n: string, i: unknown, o?: { signal?: AbortSignal }) => Promise<unknown>;
    };
    const decision = (await opts.canUseTool!('Bash', { command: 'git commit -m x' }, {
      signal: undefined,
    })) as { behavior: string };
    // git 命令提取不到写路径 → 写校验放行（与现状一致）；未弹卡。
    expect(decision.behavior).toBe('allow');
    expect(collectMock).not.toHaveBeenCalled();
    expect(sm.getPermissionResolver('sess-claude')).toBeUndefined();
  }, 15_000);

  it('普通命令行为不变：git status 未命中 → allow（写校验现状语义）', async () => {
    const { canUseTool } = await makeChatSession();
    const decision = (await canUseTool!('Bash', { command: 'git status' }, {
      signal: undefined,
    })) as { behavior: string };
    expect(decision.behavior).toBe('allow');
    expect(collectMock).not.toHaveBeenCalled();
  }, 15_000);
});
