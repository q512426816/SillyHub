// tests/interactive/session-manager-idle-disabled.test.ts
// 2026-06-25-interactive-idle-timeout-fix task-04（D-001@v1）/ SC-2, SC-4。
//
// 覆盖：
//   - 默认配置（无 opts / 无 env）→ idle 定时器不启动（_idleTimeoutSec=0）
//   - 长 turn（running 持续不回 result）推进远超旧 1800s 阈值 → 不触发 end
//     （scan 场景：agent 单 turn 跑 30min 不被误杀）
//   - env SESSION_IDLE_TIMEOUT_SEC=1800 逃生口 → 恢复旧行为（定时器启动）
//
// 测试策略：scanOnce() 直接驱动单轮（避免 setInterval fake timer 嵌套）；start/stop
// 用真实短周期定时器 + 真实 sleep（对齐 session-idle-scanner.test.ts AC-12）。

import { describe, it, expect, afterEach, vi } from 'vitest';
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

function makeMockDriver() {
  const fakeQuery = {
    interrupt: vi.fn(async () => {}),
  } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => fakeQuery,
    ),
    consume: vi.fn(async (_q: Query, _cb: ConsumeCallbacks): Promise<void> => {}),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      return true;
    }),
  } as unknown as ClaudeSdkDriver;
  return { driver, fakeQuery };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async (_s: string, _r: string, _res: SDKResultMessage) => {}),
    onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-idle-1',
  leaseId: 'lease-idle-1',
  firstPrompt: 'hi',
  firstRunId: 'run-idle-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ── D-001@v1：默认禁用 ──────────────────────────────────────────────────────

describe('D-001@v1 idle 默认禁用', () => {
  it('无 opts / 无 env → getIdleTimeoutSec()=0（禁用）', () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getIdleTimeoutSec()).toBe(0);
  });

  it('默认配置 start() → 定时器不启动（长跑不触发 end）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    sm.start();
    // 真实等待 250ms（远超任何短周期扫描窗口）；定时器未启动 → 不 end
    await new Promise((r) => setTimeout(r, 250));
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    expect(sm.get('sess-idle-1')!.status).toBe('running');
    sm.stop();
  });
});

// ── SC-2：长 turn 不被误杀 ──────────────────────────────────────────────────

describe('SC-2 长 turn（running 持续不回 result）不被 idle 误杀', () => {
  it('running session 推进远超旧 1800s 阈值 → scanOnce 不 end（idle 禁用）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    // status=running（无 result 收尾）
    expect(sm.get('sess-idle-1')!.status).toBe('running');
    vi.useFakeTimers();
    // 推进 3600s（远超旧 1800s 阈值，模拟 scan 单 turn 跑 1 小时）
    vi.advanceTimersByTime(3_600_000);
    await sm.scanOnce();
    // idle 禁用 → 即使 scanOnce 被显式调用，_idleTimeoutSec=0 → idleSec > 0 不成立
    // （0 > 0 false）→ 不 end
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    expect(sm.get('sess-idle-1')!.status).toBe('running');
    vi.useRealTimers();
  });
});

// ── SC-4 / FR-2：env 逃生口恢复旧行为 ───────────────────────────────────────

describe('SC-4 env SESSION_IDLE_TIMEOUT_SEC 逃生口', () => {
  it('env=1800 → getIdleTimeoutSec()=1800（旧行为恢复）', () => {
    const { driver } = makeMockDriver();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', '1800');
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getIdleTimeoutSec()).toBe(1800);
  });

  it('env=1800 + start → 定时器启动，超时 session 被 end（旧行为）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    vi.stubEnv('SESSION_IDLE_TIMEOUT_SEC', '1800');
    // 真实短周期：scan 50ms，timeout 20ms，让 100ms 内必命中
    const sm = new SessionManager(
      { driver, ...deps },
      { idleTimeoutSec: 0.02, idleScanSec: 0.05 },
    );
    await sm.create(BASE_INPUT);
    sm.start();
    await new Promise((r) => setTimeout(r, 150));
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-idle-1', 'ended');
    sm.stop();
  });
});
