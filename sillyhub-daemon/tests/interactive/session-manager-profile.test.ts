// tests/interactive/session-manager-profile.test.ts
// task-10（C-12 / FR-10 / FR-11 / D-013）：interactive 路径消费 claim payload 的 profile 字段。
//
// 覆盖两条路径（带 profile vs 不带 profile）：
//   1. MCP 子集过滤（主 agent session）：
//      - 带 mcpRefs → mainAgentMcpConfigProvider 返回的配置按 mcpRefs ∩ 过滤，driver.start
//        只收到 profile 引用的 server 子集；
//      - 不带 mcpRefs（undefined/空）→ provider 返回全量，driver.start 收到完整配置（FR-15）。
//   2. allowedRoots 收紧（fallback 路径，无 policyEngine）：
//      - 带 effectiveAllowedRoots → 写守卫用 effective 子集（替代 provider 全量），
//        落 effective 内 allow、落 provider 内但 effective 外 deny；
//      - 不带 effectiveAllowedRoots → 用原 allowedRootsProvider 值（FR-15）。
//   3. 恢复路径（restoreAndReconnect）：mcpRefs 过滤在恢复时同样生效。
//   4. 持久化（snapshotPersistable）：profile 字段输出到 record。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { winPath as P } from '../helpers.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  InteractiveDriverCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { McpServerConfigForDriver } from '../../src/interactive/driver.js';

// ── mock driver（捕获 start opts，断言 mcpServers 子集）─────────────────────────

function makeMockDriver() {
  let capturedStartOpts: StartOptions | null = null;
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn((_input: AsyncIterable<unknown>, opts: StartOptions): Query => {
      capturedStartOpts = opts;
      return fakeQuery;
    }),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    getStartOpts: () => capturedStartOpts,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onTurnResult?.(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onTurnMessage?.(m),
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
  sessionId: 'sess-profile-1',
  leaseId: 'lease-1',
  claimToken: 'claim-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: P('C:\\work'),
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// 模拟 cli.ts mainAgentMcpConfigProvider 返回的多 server 配置（daemon 内置 + workspace）
const MULTI_SERVER_MCP: Record<string, McpServerConfigForDriver> = {
  'sillyhub-daemon': {
    command: 'node',
    args: ['dist/mcp-server.js'],
    env: { MCP_SERVER_BACKEND_URL: 'http://localhost:8000' },
  },
  'workspace-mcp': {
    command: 'node',
    args: ['dist/ws-mcp.js'],
    env: { WS_TOKEN: 'ws-tok' },
  },
  'platform-mcp': {
    command: 'node',
    args: ['dist/platform-mcp.js'],
  },
};

// ── task-10 / C-12：MCP 子集过滤（主 agent session）──────────────────────────────

describe('task-10: 主 agent MCP 按 profile.mcpRefs 子集过滤', () => {
  it('带 mcpRefs → driver.start 只收到 profile 引用的 server 子集', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    // profile 只允许 sillyhub-daemon + workspace-mcp（排除 platform-mcp）
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-1',
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon', 'workspace-mcp'],
    });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeDefined();
    const gotKeys = Object.keys(opts!.mcpServers!).sort();
    expect(gotKeys).toEqual(['sillyhub-daemon', 'workspace-mcp']);
    // 被排除的 platform-mcp 不应出现
    expect(opts!.mcpServers!['platform-mcp']).toBeUndefined();
  });

  it('mcpRefs 只列单 server → driver.start 只收到该 server', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-2',
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon'],
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeDefined();
    expect(Object.keys(opts!.mcpServers!)).toEqual(['sillyhub-daemon']);
  });

  it('不带 mcpRefs（undefined）→ driver.start 收到 provider 全量（FR-15）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-3',
      stage: 'orchestrator',
      // mcpRefs 未传
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeDefined();
    const gotKeys = Object.keys(opts!.mcpServers!).sort();
    expect(gotKeys).toEqual(['platform-mcp', 'sillyhub-daemon', 'workspace-mcp']);
  });

  it('mcpRefs 空数组 → 不过滤，driver.start 收到全量（FR-15）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-4',
      stage: 'orchestrator',
      mcpRefs: [],
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeDefined();
    expect(Object.keys(opts!.mcpServers!).length).toBe(3);
  });

  it('mcpRefs 引用不存在的 server → 过滤后为空 → 不注入 mcpServers', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-5',
      stage: 'orchestrator',
      mcpRefs: ['nonexistent-server'],
    });

    const opts = getStartOpts();
    // 过滤后空 → _resolveMainAgentMcp 返回 undefined → driverOpts 不设 mcpServers
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('mcpRefs 过滤也剔除 daemon 内置 MCP server（profile 未列即排除，收紧语义）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    // profile 只列 workspace-mcp（不列 sillyhub-daemon）→ daemon 内置 server 也被排除
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-mcp-6',
      stage: 'orchestrator',
      mcpRefs: ['workspace-mcp'],
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeDefined();
    expect(Object.keys(opts!.mcpServers!)).toEqual(['workspace-mcp']);
    expect(opts!.mcpServers!['sillyhub-daemon']).toBeUndefined();
  });

  it('restoreAndReconnect 时 mcpRefs 过滤同样生效（daemon 重启恢复）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-restore-profile',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-1',
      cwd: P('C:\\work'),
      provider: 'claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon'],
    });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeDefined();
    expect(Object.keys(opts!.mcpServers!)).toEqual(['sillyhub-daemon']);
    expect(opts!.resume).toBe('sdk-sess-1');
  });

  it('snapshotPersistable 输出 mcpRefs/skillRefs/effectiveAllowedRoots（持久化）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-persist-profile',
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon'],
      skillRefs: ['sillyspec', 'custom-skill'],
      effectiveAllowedRoots: [P('C:\\work\\project1')],
    });

    // 模拟 system/init 写 agentSessionId（snapshotPersistable 要求非空才输出）
    const state = sm.get('sess-persist-profile');
    expect(state).toBeDefined();
    (state as { agentSessionId?: string }).agentSessionId = 'sdk-init';

    const records = sm.snapshotPersistable();
    expect(records).toHaveLength(1);
    expect(records[0].mcpRefs).toEqual(['sillyhub-daemon']);
    expect(records[0].skillRefs).toEqual(['sillyspec', 'custom-skill']);
    expect(records[0].effectiveAllowedRoots).toEqual([P('C:\\work\\project1')]);
  });

  it('不带 profile 的 session snapshotPersistable 不输出 profile 字段（FR-15）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => MULTI_SERVER_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-no-profile',
      stage: 'orchestrator',
    });

    const state = sm.get('sess-no-profile');
    (state as { agentSessionId?: string }).agentSessionId = 'sdk-init-2';

    const records = sm.snapshotPersistable();
    expect(records).toHaveLength(1);
    expect(records[0].mcpRefs).toBeUndefined();
    expect(records[0].skillRefs).toBeUndefined();
    expect(records[0].effectiveAllowedRoots).toBeUndefined();
  });
});

// ── task-10 / C-12 / D-013：effectiveAllowedRoots 写守卫收紧（fallback 路径）──────

describe('task-10: effectiveAllowedRoots 收紧写守卫（fallback 无 policyEngine）', () => {
  /**
   * 构造一个「注入 allowedRootsProvider（无 policyEngine）+ 可选 effectiveAllowedRoots」
   * 的 chat session，返回注入的 canUseTool 回调。模拟默认对话场景的写拦截 fallback。
   */
  async function makeChatSession(opts: {
    providerRoots: string[];
    effectiveRoots?: string[];
  }) {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        allowedRootsProvider: () => opts.providerRoots,
      },
    );
    await sm.create({
      ...BASE_INPUT,
      sessionId: `sess-roots-${Math.random().toString(36).slice(2, 8)}`,
      manualApproval: false,
      ...(opts.effectiveRoots !== undefined
        ? { effectiveAllowedRoots: opts.effectiveRoots }
        : {}),
    });
    const canUseTool = getStartOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sm };
  }

  it('带 effectiveAllowedRoots → 写落 effective 内 allow', async () => {
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      effectiveRoots: [P('C:\\work\\project1')],
    });
    // 写落 effective 子目录内 → allow
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\project1\\a.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('带 effectiveAllowedRoots → 写落 provider 内但 effective 外 deny（收紧）', async () => {
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      effectiveRoots: [P('C:\\work\\project1')],
    });
    // C:\work\other 在 provider 内但 effective 外 → deny（profile 收紧）
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\other\\b.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'path outside allowed_roots',
    );
  });

  it('带 effectiveAllowedRoots → 写落 provider 完全外 deny', async () => {
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      effectiveRoots: [P('C:\\work\\project1')],
    });
    // D:\evil 完全在 provider 外 → deny
    const res = await canUseTool(
      'Write',
      { file_path: P('D:\\evil\\c.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('不带 effectiveAllowedRoots → 用 provider 全量（FR-15）', async () => {
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      // effectiveRoots 未传
    });
    // C:\work\anywhere 在 provider 内 → allow（未收紧）
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\anywhere\\d.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('effectiveAllowedRoots 空数组 → 用 provider 全量（FR-15，空数组视为未启用）', async () => {
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      effectiveRoots: [],
    });
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\x.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('effectiveAllowedRoots 含 provider 外路径 → 被 ∩ 物理兜底剔除（deny）', async () => {
    // backend 算 effective 时已保证 ⊆ daemon_roots，但防御 stale：effective 含 D:\stale
    //（不在 provider [C:\work] 内）→ ∩ 后被剔除 → 写 D:\stale deny。
    const { canUseTool } = await makeChatSession({
      providerRoots: [P('C:\\work')],
      effectiveRoots: [P('C:\\work\\project1'), P('D:\\stale')],
    });
    // 写 D:\stale（effective 列了但 provider 没有）→ deny（物理兜底）
    const res = await canUseTool(
      'Write',
      { file_path: P('D:\\stale\\e.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    // 写 C:\work\project1（effective + provider 都有）→ allow
    const res2 = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\project1\\f.txt') },
      { signal: undefined },
    );
    expect(res2).toMatchObject({ behavior: 'allow' });
  });

  it('effectiveAllowedRoots 单独（无 provider/policyEngine）不启用写守卫（向后兼容）', async () => {
    // 边界：allowedRootsProvider 未注入 + policyEngine 未注入 → writeGuardEnabled=false
    // → canUseTool 不注入。effectiveAllowedRoots 只在 fallback 路径（已有 provider）
    // 生效，不单独启用写守卫（避免改变"未注入守卫=读自由"的默认行为）。
    // 生产路径 policyEngine 注入时，overlay 收紧由 backend 下推 PolicyCache 做，
    // 不经 SessionManager.effectiveAllowedRoots（task-14 主路径，本任务不碰）。
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        allowedRootsProvider: undefined,
      },
    );
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-effective-only',
      manualApproval: false,
      effectiveAllowedRoots: [P('C:\\sandbox')],
    });
    const canUseTool = getStartOpts()?.canUseTool;
    // 未注入 provider/policyEngine → 无写守卫（向后兼容）。
    expect(canUseTool).toBeUndefined();
  });
});
