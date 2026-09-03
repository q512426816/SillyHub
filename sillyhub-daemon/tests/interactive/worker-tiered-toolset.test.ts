// tests/interactive/worker-tiered-toolset.test.ts
// task-05（2026-08-26-team-subsession-recursion / FR-04 / D-002@v1 / D-003@v2，
// design §5.C）：daemon 分层工具集——非叶 5 件 / 叶 1 件两档硬编码。
//
// 覆盖（TaskCard acceptance）：
//   1. mcp-server 两档——非叶（worker_depth < MAX_DISPATCH_DEPTH）listTools 恰
//      5 件派工集（dispatch_worker/list_workers/get_worker_result/mission_status/
//      worker_done）；叶（depth 达上限）恰 1 件 worker_done（P1 形态）；两档都无
//      converge_mission / report_progress（层 0 权不下放）；
//   2. 旧 lease 兜底——depth 无键 / 非法值一律叶档（宁少勿多）；
//   3. env 门控——MCP_WORKER_DEPTH 读侧（readEnv）+ 写侧（buildWorkerMcpServerConfig
//      ）往返闭环；MAX_DISPATCH_DEPTH=2 与 backend 派发门同值；
//   4. 注入档位保持——session-manager 分身分支（cli.ts workerMcpConfigProvider
//      同款接线）create / restoreAndReconnect 带 worker_depth → sillyhub-worker
//      env MCP_WORKER_DEPTH 保档（D-003@v2 M3：重启 restore 不降级）；
//      无 worker_depth → env 无键（叶档兜底）。
//
// 注：hub-client 转发路径零改动（分身调 dispatch_worker 与主控同端点同链路，
// design §5.C），转发契约由既有 tests/mcp-server.test.ts 守护，此处仅抽验
// 非叶档 dispatch_worker helper 复用后行为一致。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  InteractiveDriverCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { McpServerConfigForDriver } from '../../src/interactive/driver.js';
import {
  buildWorkerMcpServerConfig,
  MAX_DISPATCH_DEPTH,
  MCP_WORKER_DEPTH_ENV,
  WORKER_MCP_SERVER_NAME,
} from '../../src/mcp-config.js';
import { createMcpServer, readEnv } from '../../src/mcp-server.js';
import { HubClient } from '../../src/hub-client.js';

// ── mock hub-client / 连接（对齐 mcp-server-worker-done.test.ts 模式）────────

function makeMockHubClient(): HubClient {
  return new HubClient('http://mock', 'mock-token');
}

/** 以 mission_worker 模式 + 指定深度连接 Client + server（内存 transport）。 */
async function connectWorker(
  client: HubClient,
  workerDepth?: number,
): Promise<{
  mcpClient: Client;
  close: () => Promise<void>;
}> {
  const { server } = createMcpServer(client, {
    toolset: 'mission_worker',
    workerDepth,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: 'test-tiered-client', version: '0.0.1' },
    { capabilities: {} },
  );
  await Promise.all([
    mcpClient.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return {
    mcpClient,
    close: async () => {
      await mcpClient.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

async function listToolNames(
  client: HubClient,
  workerDepth?: number,
): Promise<string[]> {
  const { mcpClient, close } = await connectWorker(client, workerDepth);
  try {
    const tools = await mcpClient.listTools();
    return tools.tools.map((t) => t.name);
  } finally {
    await close();
  }
}

/** 非叶派工集 5 件（TaskCard 验收口径，顺序无关）。 */
const NON_LEAF_TOOLS = [
  'dispatch_worker',
  'list_workers',
  'get_worker_result',
  'mission_status',
  'worker_done',
];

/** 两档任何档位都禁入的工具（层 0 权 / 主控独有，D-002@v1）。 */
const NEVER_TOOLS = ['converge_mission', 'report_progress'];

// ════════════════════════════════════════════════════════════════════════════
// 1. mcp-server 两档工具集（D-002@v1 / design §5.C）
// ════════════════════════════════════════════════════════════════════════════

describe('task-05: mission_worker 两档工具集（非叶 5 件 / 叶 1 件）', () => {
  it('非叶（depth=1 < MAX_DISPATCH_DEPTH）listTools 恰 5 件派工集', async () => {
    const names = await listToolNames(makeMockHubClient(), 1);
    expect(names).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining(NON_LEAF_TOOLS));
    // 层 0 权不下放（D-002@v1）
    for (const banned of NEVER_TOOLS) {
      expect(names).not.toContain(banned);
    }
  });

  it('depth=0（< 上限边界）同为非叶 5 件', async () => {
    const names = await listToolNames(makeMockHubClient(), 0);
    expect(names).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining(NON_LEAF_TOOLS));
  });

  it('叶（depth=2 = MAX_DISPATCH_DEPTH）恰 1 件 worker_done（P1 形态）', async () => {
    const names = await listToolNames(makeMockHubClient(), 2);
    expect(names).toEqual(['worker_done']);
    for (const banned of NEVER_TOOLS) {
      expect(names).not.toContain(banned);
    }
  });

  it('叶（depth=3 超上限）恰 1 件 worker_done', async () => {
    const names = await listToolNames(makeMockHubClient(), 3);
    expect(names).toEqual(['worker_done']);
  });

  it('无 depth 键（undefined）→ 叶档兜底恰 1 件（旧 lease 宁少勿多）', async () => {
    const names = await listToolNames(makeMockHubClient(), undefined);
    expect(names).toEqual(['worker_done']);
    for (const banned of NEVER_TOOLS) {
      expect(names).not.toContain(banned);
    }
  });

  it('非法 depth（-1 / 1.5）→ 归一化 undefined 叶档兜底', async () => {
    expect(await listToolNames(makeMockHubClient(), -1)).toEqual(['worker_done']);
    expect(await listToolNames(makeMockHubClient(), 1.5)).toEqual(['worker_done']);
  });

  it('非叶 dispatch_worker 调用 → client.dispatchWorker 转发（helper 复用行为一致）', async () => {
    const client = makeMockHubClient();
    const spy = vi
      .spyOn(client, 'dispatchWorker')
      .mockResolvedValue({ id: 'run-w1', status: 'queued', lease_id: 'lease-w1' });
    const { mcpClient, close } = await connectWorker(client, 1);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: { objective: '给孙分身的子任务' },
      });
      expect(result.isError).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);
      // 缺省 ws/mid undefined 透传（X-Session-Id 会话定位，与主控同端点同链路）
      expect(spy).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({ objective: '给孙分身的子任务' }),
      );
    } finally {
      spy.mockRestore();
      await close();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. env 门控（MCP_WORKER_DEPTH：readEnv 读侧）
// ════════════════════════════════════════════════════════════════════════════

describe('task-05: MCP_WORKER_DEPTH env 门控（readEnv）', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[MCP_WORKER_DEPTH_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[MCP_WORKER_DEPTH_ENV];
    else process.env[MCP_WORKER_DEPTH_ENV] = saved;
  });

  it('MCP_WORKER_DEPTH=1 → readEnv.workerDepth=1（非叶档）', () => {
    process.env[MCP_WORKER_DEPTH_ENV] = '1';
    expect(readEnv().workerDepth).toBe(1);
  });

  it('MCP_WORKER_DEPTH=2 → readEnv.workerDepth=2（叶档）', () => {
    process.env[MCP_WORKER_DEPTH_ENV] = '2';
    expect(readEnv().workerDepth).toBe(2);
  });

  it('未设 / 空串 → undefined（叶档兜底，旧 lease 兼容）', () => {
    delete process.env[MCP_WORKER_DEPTH_ENV];
    expect(readEnv().workerDepth).toBeUndefined();
    process.env[MCP_WORKER_DEPTH_ENV] = '';
    expect(readEnv().workerDepth).toBeUndefined();
  });

  it('垃圾值（abc / -1 / 1.5）→ undefined（宁少勿多）', () => {
    for (const garbage of ['abc', '-1', '1.5']) {
      process.env[MCP_WORKER_DEPTH_ENV] = garbage;
      expect(readEnv().workerDepth).toBeUndefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. mcp-config 写侧（buildWorkerMcpServerConfig）+ 写读往返
// ════════════════════════════════════════════════════════════════════════════

describe('task-05: buildWorkerMcpServerConfig 深度透传（写侧）', () => {
  it('MAX_DISPATCH_DEPTH = 2（与 backend 派发门 mcp_tools.py 同值对齐）', () => {
    expect(MAX_DISPATCH_DEPTH).toBe(2);
  });

  it('workerDepth=1 → env MCP_WORKER_DEPTH=1（受限模式 env 不变）', () => {
    const cfg = buildWorkerMcpServerConfig(
      'http://localhost:8000/',
      { token: 'token-x' },
      { workerDepth: 1 },
    );
    expect(cfg.env?.[MCP_WORKER_DEPTH_ENV]).toBe('1');
    expect(cfg.env?.MCP_TOOLSET).toBe('mission_worker');
  });

  it('workerDepth=undefined → 不写键（叶档兜底）', () => {
    const cfg = buildWorkerMcpServerConfig('http://localhost:8000/', { token: 't' });
    expect(cfg.env).not.toHaveProperty(MCP_WORKER_DEPTH_ENV);
    // 显式传 undefined 同罪（旧 lease 键级缺席）
    const cfg2 = buildWorkerMcpServerConfig(
      'http://localhost:8000/',
      { token: 't' },
      { workerDepth: undefined },
    );
    expect(cfg2.env).not.toHaveProperty(MCP_WORKER_DEPTH_ENV);
  });

  it('workerDepth 非法（-1 / 1.5）→ 不写键（宁少勿多）', () => {
    for (const invalid of [-1, 1.5]) {
      const cfg = buildWorkerMcpServerConfig(
        'http://localhost:8000/',
        { token: 't' },
        { workerDepth: invalid },
      );
      expect(cfg.env).not.toHaveProperty(MCP_WORKER_DEPTH_ENV);
    }
  });

  it('写读往返：builder env → readEnv.workerDepth 复原（注入链闭环）', () => {
    const roundTrips: Array<[number, number | undefined]> = [
      [1, 1],
      [2, 2],
    ];
    const savedEnv = process.env[MCP_WORKER_DEPTH_ENV];
    try {
      for (const [input, expected] of roundTrips) {
        const cfg = buildWorkerMcpServerConfig(
          'http://localhost:8000/',
          { token: 't' },
          { workerDepth: input },
        );
        // 模拟 per-server env 注入管道（CLI spawn MCP 子进程白名单 + per-server 合并）
        process.env[MCP_WORKER_DEPTH_ENV] = cfg.env?.[MCP_WORKER_DEPTH_ENV];
        expect(readEnv().workerDepth).toBe(expected);
      }
      // 无键形态：builder 不写键 → 子进程 env 无 MCP_WORKER_DEPTH → readEnv undefined
      delete process.env[MCP_WORKER_DEPTH_ENV];
      const leafCfg = buildWorkerMcpServerConfig('http://localhost:8000/', { token: 't' });
      expect(leafCfg.env).not.toHaveProperty(MCP_WORKER_DEPTH_ENV);
      expect(readEnv().workerDepth).toBeUndefined();
    } finally {
      if (savedEnv === undefined) delete process.env[MCP_WORKER_DEPTH_ENV];
      else process.env[MCP_WORKER_DEPTH_ENV] = savedEnv;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. session-manager 注入档位（cli.ts workerMcpConfigProvider 同款接线）
// ════════════════════════════════════════════════════════════════════════════

function makeMockDriver() {
  let capturedStartOpts: StartOptions | null = null;
  const callbacksList: InteractiveDriverCallbacks[] = [];
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn((_input: AsyncIterable<unknown>, opts: StartOptions): Query => {
      capturedStartOpts = opts;
      return fakeQuery;
    }),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
      callbacksList.push(cb);
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    getStartOpts: () => capturedStartOpts,
    emitMessage: (m: SDKMessage) => {
      for (const cb of callbacksList) cb.onTurnMessage?.(m);
    },
  };
}

/** flush fire-and-forget 协程（对齐 worker-depth 测试的 flushMicrotasks）。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

/** cli.ts 分身谓词同款（判据不变：stage=mission_worker）。 */
function cliWorkerPredicate(ctx: { provider: string; stage?: string }): boolean {
  return ctx.provider === 'claude' && (ctx.stage ?? '') === 'mission_worker';
}

/**
 * cli.ts workerMcpConfigProvider 同款接线（task-05：ctx.worker_depth →
 * buildWorkerMcpServerConfig workerDepth → env MCP_WORKER_DEPTH）。
 */
function cliStyleWorkerProvider(ctx: {
  worker_depth?: number;
}): Record<string, McpServerConfigForDriver> {
  const built = buildWorkerMcpServerConfig(
    'http://localhost:8000/',
    { token: 'token-x', apiKey: 'key-x' },
    { workerDepth: ctx.worker_depth },
  );
  return {
    [WORKER_MCP_SERVER_NAME]: {
      command: built.command,
      args: built.args,
      env: built.env,
    },
  };
}

const BASE_INPUT = {
  sessionId: 'sess-tier-1',
  leaseId: 'lease-1',
  claimToken: 'claim-1',
  firstPrompt: '干活',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

describe('task-05: 分身深度档位注入（create / restore）', () => {
  it('create stage=mission_worker + worker_depth=1 → sillyhub-worker env MCP_WORKER_DEPTH=1', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: cliStyleWorkerProvider,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker', worker_depth: 1 });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(Object.keys(opts!.mcpServers!)).toEqual([WORKER_MCP_SERVER_NAME]);
    const env = opts!.mcpServers![WORKER_MCP_SERVER_NAME].env!;
    expect(env[MCP_WORKER_DEPTH_ENV]).toBe('1');
    expect(env.MCP_TOOLSET).toBe('mission_worker');
    // session-manager 补写的 MCP_SESSION_ID 不受影响
    expect(env.MCP_SESSION_ID).toBe(BASE_INPUT.sessionId);
  });

  it('restoreAndReconnect 带 worker_depth=1 → 注入档位保持（D-003@v2 M3 保档不降级）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: cliStyleWorkerProvider,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-tier-restore',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-t',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 3,
      lastActiveAt: Date.now(),
      stage: 'mission_worker',
      worker_depth: 1,
    });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers![WORKER_MCP_SERVER_NAME].env?.[MCP_WORKER_DEPTH_ENV]).toBe('1');
  });

  it('restore 无 worker_depth（旧 lease）→ env 无 MCP_WORKER_DEPTH 键（叶档兜底）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: cliStyleWorkerProvider,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-tier-legacy',
      leaseId: 'lease-legacy',
      agentSessionId: 'sdk-sess-l',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 1,
      lastActiveAt: Date.now(),
      stage: 'mission_worker',
    });

    const opts = getStartOpts();
    const env = opts!.mcpServers![WORKER_MCP_SERVER_NAME].env!;
    expect(env).not.toHaveProperty(MCP_WORKER_DEPTH_ENV);
    expect(env.MCP_TOOLSET).toBe('mission_worker');
  });

  it('snapshot → restore 档位保持：worker_depth=1 落 record 后重连仍非叶档 env', async () => {
    const mock = makeMockDriver();
    const workerPredicate = vi.fn(
      (ctx: { provider: string; stage?: string; worker_depth?: number }) =>
        cliWorkerPredicate(ctx),
    );
    const provider = vi.fn(cliStyleWorkerProvider);
    const sm = new SessionManager(
      { driver: mock.driver, ...makeDeps() },
      {
        isWorkerSession: workerPredicate,
        workerMcpConfigProvider: provider,
      },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-tier-snap',
      stage: 'mission_worker',
      worker_depth: 1,
    });
    // agentSessionId 落位（snapshotPersistable 过滤条件：system/init 后才可恢复）
    mock.emitMessage({
      events: [
        { type: 'status', subtype: 'session_started', content: '', session_id: 'sdk-sess-t' },
      ],
    } as unknown as Record<string, unknown>);
    await flushMicrotasks();

    // snapshot record 保档（task-04 已落；此处消费验证注入链档位一致）
    const recs = sm.snapshotPersistable();
    const rec = recs.find((r) => r.sessionId === 'sess-tier-snap');
    expect(rec?.worker_depth).toBe(1);
    // provider 收到的 ctx 档位与 record 一致（非叶档 env 由同一 ctx 派生）
    const lastCtx = provider.mock.calls.at(-1)?.[0] as { worker_depth?: number };
    expect(lastCtx?.worker_depth).toBe(1);
  });
});
