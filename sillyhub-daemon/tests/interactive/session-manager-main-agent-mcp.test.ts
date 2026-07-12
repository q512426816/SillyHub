// tests/interactive/session-manager-main-agent-mcp.test.ts
// task-06（D-007@v2）：主 agent（role=orchestrator）MCP tool 注入测试。
//
// 覆盖：
//   - 主 agent session（stage='orchestrator'）create 时 driver.start 收到 mcpServers
//     （含 daemon MCP server，主 agent discover 5 tool）
//   - 普通会话（stage 未传 / 非 'orchestrator'）create 时 driver.start 不收到 mcpServers
//     （零回归）
//   - 主 agent session restoreAndReconnect 时 driver.start 也收到 mcpServers
//     （daemon 重启后主 agent 恢复 MCP tool）
//   - isMainAgentSession 未注入时所有 session 都不注入 MCP（向后兼容）
//   - mainAgentMcpConfigProvider 返回 undefined 时不注入（容错）

import { describe, it, expect, vi } from 'vitest';
import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { ClaudeSdkDriver, ConsumeCallbacks, StartOptions } from '../../src/interactive/claude-sdk-driver.js';
import type { McpServerConfigForDriver } from '../../src/interactive/driver.js';

// ── mock driver（捕获 start opts，断言 mcpServers）─────────────────────────────

function makeMockDriver() {
  let capturedStartOpts: StartOptions | null = null;
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn((_input: AsyncIterable<unknown>, opts: StartOptions): Query => {
      capturedStartOpts = opts;
      return fakeQuery;
    }),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    getStartOpts: () => capturedStartOpts,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  claimToken: 'claim-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// 主 agent MCP 配置 provider（模拟 cli.ts 注入的闭包）
const FAKE_DAEMON_MCP: Record<string, McpServerConfigForDriver> = {
  'sillyhub-daemon': {
    command: 'node',
    args: ['dist/mcp-server.js'],
    env: { MCP_SERVER_BACKEND_URL: 'http://localhost:8000', MCP_SERVER_DAEMON_TOKEN: 'token-x' },
  },
};

describe('task-06: 主 agent MCP tool 注入', () => {
  it('主 agent session（stage=orchestrator）create 时注入 mcpServers', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-daemon']).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-daemon'].command).toBe('node');
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SERVER_DAEMON_TOKEN).toBe('token-x');
  });

  it('普通会话（stage 未传）create 时不注入 mcpServers', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT }); // stage 未传

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('普通 stage（scan）create 时不注入 mcpServers', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'scan' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('isMainAgentSession 未注入时主 agent session 也不注入（向后兼容）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    // 不注入 isMainAgentSession / mainAgentMcpConfigProvider
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT, stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('mainAgentMcpConfigProvider 返回 undefined 时不注入（容错）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => undefined,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('主 agent session restoreAndReconnect 时也注入 mcpServers（daemon 重启恢复）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-restore',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-1',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
      stage: 'orchestrator',
    });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-daemon']).toBeDefined();
    // resume 也应透传（恢复跨进程 SDK 会话）
    expect(opts!.resume).toBe('sdk-sess-1');
  });

  it('普通 session restoreAndReconnect 时不注入 mcpServers', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-restore-2',
      leaseId: 'lease-restore-2',
      agentSessionId: 'sdk-sess-2',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
      // stage 未传（普通 session）
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('主 agent session snapshotPersistable 输出 stage（持久化恢复用）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'orchestrator' });

    // 模拟 system/init 写 agentSessionId（snapshotPersistable 要求非空才输出）
    const state = sm.get(BASE_INPUT.sessionId);
    expect(state).toBeDefined();
    // 直接 cast 写 agentSessionId（模拟 SDK init 事件）
    (state as { agentSessionId?: string }).agentSessionId = 'sdk-sess-init';

    const records = sm.snapshotPersistable();
    expect(records).toHaveLength(1);
    expect(records[0].stage).toBe('orchestrator');
  });
});
