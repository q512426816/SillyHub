// tests/interactive/driver-factory-approval-wiring.test.ts
// 2026-10-16-driver-audit-fixes：审批三态旗标接线回归钉——
//   spec.enableApproval / effectiveAskUserOnly 必须映射为 codex 族的
//   driverOpts.manualApproval / askUserOnly，且 sessionPermission 注入名单含 zcode。
//   旧实现缺陷：manualApproval/askUserOnly 从未赋值 → 驱动侧
//   `!opts.manualApproval || opts.askUserOnly` 恒真 → 权限请求恒 allow-through
//   （fail-open），已注入的 sessionPermission 成死代码；zcode 亦漏在名单外。
//   基类 InteractiveDriverStartOptions 对两字段的契约（"driver 读取并据此决定
//   审批行为"）即本接线的设计依据。

import { describe, it, expect, vi } from 'vitest';
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
