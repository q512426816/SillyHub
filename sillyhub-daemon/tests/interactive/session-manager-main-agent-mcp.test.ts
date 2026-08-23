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
//   - task-06（2026-08-23-agent-file-upload-mcp / FR-02）：双 server（sillyhub-daemon
//     + sillyhub-file）注入、两内置条目 env 均补 MCP_SESSION_ID、codex/mission_worker
//     不注入任何 server、mcpRefs 非空未列名被剔除（同语义）

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

// 主 agent MCP 配置 provider（模拟 cli.ts 注入的闭包）。
// task-06（2026-08-23-agent-file-upload-mcp）：cli.ts provider 现返回双 server 表
// （sillyhub-daemon 编排 + sillyhub-file 上传），此处 mock 对齐该形态。
const FAKE_DAEMON_MCP: Record<string, McpServerConfigForDriver> = {
  'sillyhub-daemon': {
    command: 'node',
    args: ['dist/mcp-server.js'],
    env: { MCP_SERVER_BACKEND_URL: 'http://localhost:8000', MCP_SERVER_DAEMON_TOKEN: 'token-x' },
  },
  'sillyhub-file': {
    command: 'node',
    args: ['dist/mcp-server.js'],
    env: {
      MCP_SERVER_BACKEND_URL: 'http://localhost:8000',
      MCP_SERVER_DAEMON_TOKEN: 'token-x',
      MCP_TOOLSET: 'file',
      MCP_ALLOWED_ROOT: 'C:\\work',
    },
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
    // task-06：sillyhub-file 与 sillyhub-daemon 并列注入（双 server 表）
    expect(opts!.mcpServers!['sillyhub-file']).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_TOOLSET).toBe('file');
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

// ── task-10（2026-08-22-team-session-unify / FR-04 / spike-01）：会话上下文 env 注入 ──
// MCP server 子进程只继承白名单 + per-server env（spike-01 结论），MCP_SESSION_ID
// 必须写进 mcpServers['sillyhub-daemon'].env。cli.ts provider（task-09 定型，不在
// task-10 allowed_paths）不传 sessionId，故由 _resolveMainAgentMcp 在 provider 返回后
// 按 ctx.sessionId 补写。provider 收到的 ctx 含 sessionId（构造侧契约）。
// task-06（2026-08-23-agent-file-upload-mcp）：sillyhub-file 与 sillyhub-daemon 同
// 管道补写（调用两次 injectMcpSessionId），其它外部 server 仍不注入。

describe('task-10: MCP_SESSION_ID 会话上下文注入', () => {
  it('create 时 sillyhub-daemon 条目 env 含 MCP_SESSION_ID = ctx.sessionId', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-ctx-1', stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SESSION_ID).toBe('sess-ctx-1');
    // 既有 env 不被覆盖
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SERVER_DAEMON_TOKEN).toBe('token-x');
  });

  it('task-06: create 时 sillyhub-file 条目 env 同样含 MCP_SESSION_ID（双条目补写）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-ctx-2', stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_SESSION_ID).toBe('sess-ctx-2');
    // sillyhub-file 既有 env（allowedRoot / toolset）不被补写覆盖
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_TOOLSET).toBe('file');
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_ALLOWED_ROOT).toBe('C:\\work');
  });

  it('restoreAndReconnect 时同样注入（daemon 重启后恢复会话上下文）', async () => {
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
      sessionId: 'sess-restore-ctx',
      leaseId: 'lease-restore-ctx',
      agentSessionId: 'sdk-sess-ctx',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
      stage: 'orchestrator',
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SESSION_ID).toBe('sess-restore-ctx');
    // task-06：restore 路径双条目同补写
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_SESSION_ID).toBe('sess-restore-ctx');
  });

  it('provider 返回的外部 MCP server 不注入 MCP_SESSION_ID（env 卫生，仅两个内置条目补写）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const multi: Record<string, McpServerConfigForDriver> = {
      ...FAKE_DAEMON_MCP,
      'workspace-mcp': { command: 'node', args: ['ws.js'], env: { WS_TOKEN: 't' } },
    };
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => multi,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-hygien', stage: 'orchestrator' });

    const opts = getStartOpts();
    // 外部 server 原样（env 卫生）
    expect(opts!.mcpServers!['workspace-mcp'].env).toEqual({ WS_TOKEN: 't' });
    // 两个 daemon 内置条目均补写 MCP_SESSION_ID
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SESSION_ID).toBe('sess-hygien');
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_SESSION_ID).toBe('sess-hygien');
  });

  it('注入后的 env 穿过 mcpRefs 子集过滤保留（sillyhub-daemon 在 refs 内）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-refs-ctx',
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon'],
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-daemon'].env?.MCP_SESSION_ID).toBe('sess-refs-ctx');
    // task-06（design §9）：mcpRefs 非空未列 sillyhub-file → 同语义剔除（不单独豁免）
    expect(opts!.mcpServers!['sillyhub-file']).toBeUndefined();
  });

  it('task-06: mcpRefs 列入双 server 时均保留；空数组不过滤', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    // 显式列名 → 双条目均保留
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-refs-both',
      stage: 'orchestrator',
      mcpRefs: ['sillyhub-daemon', 'sillyhub-file'],
    });
    let opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-daemon']).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-file']).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-file'].env?.MCP_SESSION_ID).toBe('sess-refs-both');

    // 空数组 → 不过滤（FR-15 行为同今天）
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-refs-empty',
      stage: 'orchestrator',
      mcpRefs: [],
    });
    opts = getStartOpts();
    expect(opts!.mcpServers!['sillyhub-daemon']).toBeDefined();
    expect(opts!.mcpServers!['sillyhub-file']).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-06（2026-08-23-agent-file-upload-mcp / FR-02 / D-002@v1）：谓词门控下
// sillyhub-file 注入的排除面。用 cli.ts isMainAgentSession 同款谓词验证：
//   - provider=codex → 一律不注入任何 server（D-008@v1：codex 不消费 mcpServers）
//   - stage=mission_worker → 不注入任何 server（防 worker 递归派发，CC-12）
// ════════════════════════════════════════════════════════════════════════════

describe('task-06: codex / mission_worker 不注入任何 server', () => {
  /** cli.ts isMainAgentSession 同款谓词（startAction 注入形态）。 */
  const cliPredicate = (ctx: { provider: string; stage?: string }) => {
    if (ctx.provider !== 'claude') return false;
    const stage = ctx.stage ?? '';
    return stage === '' || stage === 'orchestrator';
  };

  it('provider=codex（stage 空或 orchestrator）→ mcpServers undefined（不注入任何 server）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    // provider=codex 路由 drivers.codex（单 driver 入参只映射 claude），同一 mock 复用。
    const sm = new SessionManager(
      { ...deps, drivers: { claude: driver, codex: driver } } as ConstructorParameters<
        typeof SessionManager
      >[0],
      {
        isMainAgentSession: cliPredicate,
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-codex', provider: 'codex' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('provider=claude 且 stage=mission_worker → mcpServers undefined（分身不注入）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: cliPredicate,
        mainAgentMcpConfigProvider: () => FAKE_DAEMON_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-worker', stage: 'mission_worker' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });
});
