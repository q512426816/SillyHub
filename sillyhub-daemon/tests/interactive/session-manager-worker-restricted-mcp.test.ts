// tests/interactive/session-manager-worker-restricted-mcp.test.ts
// task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design §5.C.1）：
// 分身受限 MCP server（worker_done 单工具）注入测试。
//
// 覆盖（TaskCard acceptance）：
//   1. session-manager 分身分支：stage=mission_worker 注入受限 server（仅
//      sillyhub-worker 条目 + injectMcpSessionId 补写 MCP_SESSION_ID）；
//      create / restoreAndReconnect / reloadWithProvider 三路共用点全部生效；
//   2. 递归闸：mcp-server mission_worker 模式 listTools 仅 worker_done 单工具，
//      不含 dispatch_worker / get_worker_result / list_workers / converge_mission /
//      report_progress / mission_status / upload_file / list_uploaded_files 任何一个；
//   3. worker_done 工具契约（对齐 task-07 backend WorkerDoneRequest）：summary 必填、
//      workspace_id/mission_id 可选；调用路由 hub-client workerDone；backend 非 2xx
//      （HubHttpError，如迟到 409）→ isError 结构化回执不 crash；
//   4. hub-client workerDone：缺参形态 POST /api/missions/worker_done 附
//      X-Session-Id；显式 ws/mid 走 /api/workspaces/{ws}/missions/{mid}/worker_done
//      且 body 携带越权校验锚（backend _worker_done_core 消费 payload 锚）；
//   5. 零回归：主控（orchestrator）双 server 注入不变且不含 sillyhub-worker；
//      普通会话 / codex / 谓词未注入 → 不注入任何 server。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { McpServerConfigForDriver } from '../../src/interactive/driver.js';
import {
  buildWorkerMcpServerConfig,
  WORKER_MCP_SERVER_NAME,
} from '../../src/mcp-config.js';
import {
  createMcpServer,
  readEnv,
  WORKER_MCP_SERVER_NAME as SERVER_NAME_FROM_SERVER,
} from '../../src/mcp-server.js';
import { HubClient, HubHttpError } from '../../src/hub-client.js';

// ── mock driver（捕获 start opts，断言 mcpServers；对齐 main-agent-mcp 测试）───

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
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

/** flush fire-and-forget 协程（对齐 reload-provider 测试的 flushMicrotasks）。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const BASE_INPUT = {
  sessionId: 'sess-worker-1',
  leaseId: 'lease-1',
  claimToken: 'claim-1',
  firstPrompt: '干活',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 主控 MCP 配置（对齐 cli.ts mainAgentMcpConfigProvider 双 server 形态）。 */
const FAKE_MAIN_MCP: Record<string, McpServerConfigForDriver> = {
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

/** cli.ts 谓词同款（主控谓词对 mission_worker 返回 false，不变）。 */
function cliMainPredicate(ctx: { provider: string; stage?: string }): boolean {
  if (ctx.provider !== 'claude') return false;
  const stage = ctx.stage ?? '';
  return stage === '' || stage === 'orchestrator';
}

/** cli.ts 分身谓词同款（本卡新增，与主控谓词配对成三态）。 */
function cliWorkerPredicate(ctx: { provider: string; stage?: string }): boolean {
  return ctx.provider === 'claude' && (ctx.stage ?? '') === 'mission_worker';
}

/** 分身受限配置 provider（模拟 cli.ts workerMcpConfigProvider：buildWorkerMcpServerConfig 组装）。 */
function workerMcpProvider(): Record<string, McpServerConfigForDriver> {
  const built = buildWorkerMcpServerConfig(
    'http://localhost:8000/',
    { token: 'token-x', apiKey: 'key-x' },
  );
  return {
    [WORKER_MCP_SERVER_NAME]: {
      command: built.command,
      args: built.args,
      env: built.env,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. session-manager 分身分支（create / restore / reload 三路）
// ════════════════════════════════════════════════════════════════════════════

describe('task-06: 分身受限 MCP 注入（session-manager 三路共用点）', () => {
  it('create 时 stage=mission_worker 注入受限 server：仅 sillyhub-worker 条目 + MCP_SESSION_ID 补写', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker' });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toBeDefined();
    // 仅受限 server 条目（主控 5 工具 / file server 不进分身）
    expect(Object.keys(opts!.mcpServers!)).toEqual([WORKER_MCP_SERVER_NAME]);
    const workerServer = opts!.mcpServers![WORKER_MCP_SERVER_NAME];
    expect(workerServer.command).toBe('node');
    expect(workerServer.env?.MCP_TOOLSET).toBe('mission_worker');
    expect(workerServer.env?.MCP_SERVER_BACKEND_URL).toBe('http://localhost:8000');
    // injectMcpSessionId 补写受限 server 名
    expect(workerServer.env?.MCP_SESSION_ID).toBe(BASE_INPUT.sessionId);
  });

  it('受限 server env 鉴权链：apiKey 优先 + token 回落（buildWorkerMcpServerConfig）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-auth', stage: 'mission_worker' });

    const opts = getStartOpts();
    const env = opts!.mcpServers![WORKER_MCP_SERVER_NAME].env!;
    expect(env.MCP_SERVER_DAEMON_API_KEY).toBe('key-x');
    expect(env.MCP_SERVER_DAEMON_TOKEN).toBe('token-x');
  });

  it('restoreAndReconnect 时 stage=mission_worker 注入保持（daemon 重启恢复）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-worker-restore',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-w',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 3,
      lastActiveAt: Date.now(),
      stage: 'mission_worker',
    });

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(Object.keys(opts!.mcpServers!)).toEqual([WORKER_MCP_SERVER_NAME]);
    expect(opts!.mcpServers![WORKER_MCP_SERVER_NAME].env?.MCP_SESSION_ID).toBe(
      'sess-worker-restore',
    );
    // resume 仍透传（受限注入不影响恢复链路既有行为）
    expect(opts!.resume).toBe('sdk-sess-w');
  });

  it('reloadWithProvider 时 stage=mission_worker 重新注入受限 server（reload 路三路共用点）', async () => {
    const { driver, getStartOpts, emitMessage, emitResult } = makeMockDriver();
    const startCalls: StartOptions[] = [];
    (driver.start as ReturnType<typeof vi.fn>).mockImplementation(
      (_input: unknown, opts: StartOptions): Query => {
        startCalls.push(opts);
        return { interrupt: vi.fn(async () => {}) } as unknown as Query;
      },
    );
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );

    await sm.create({ ...BASE_INPUT, sessionId: 'sess-worker-reload', stage: 'mission_worker' });
    emitMessage({ type: 'system', subtype: 'init', session_id: 'sdk-sess-reload' } as unknown as SDKMessage);
    await flushMicrotasks();
    emitResult({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sdk-sess-reload',
    } as unknown as SDKResultMessage);
    await flushMicrotasks();

    await sm.reloadWithProvider('sess-worker-reload', {
      agent_kind: 'claude',
      base_url: 'https://new.example.com',
      api_key: 'sk-new',
      model: 'm1',
    } as never);

    expect(startCalls).toHaveLength(2);
    const reloadOpts = startCalls[1];
    expect(Object.keys(reloadOpts.mcpServers!)).toEqual([WORKER_MCP_SERVER_NAME]);
    expect(reloadOpts.mcpServers![WORKER_MCP_SERVER_NAME].env?.MCP_SESSION_ID).toBe(
      'sess-worker-reload',
    );
  });

  it('isWorkerSession true 但 workerMcpConfigProvider 未注入 → 不注入（容错）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('workerMcpConfigProvider 返回 undefined → 不注入（容错）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: () => undefined,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('isWorkerSession 未注入（旧构造）→ mission_worker 也不注入（向后兼容，既有谓词语义零回归）', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
      },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. 零回归：主控 / 普通会话 / codex
// ════════════════════════════════════════════════════════════════════════════

describe('task-06: 分身分支零回归（主控 / 普通 / codex）', () => {
  function makeSm(driver: ClaudeSdkDriver) {
    return new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );
  }

  it('主控（stage=orchestrator）注入 sillyhub-daemon + sillyhub-file 不变，不含 sillyhub-worker', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    await makeSm(driver).create({ ...BASE_INPUT, stage: 'orchestrator' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeDefined();
    expect(Object.keys(opts!.mcpServers!).sort()).toEqual(['sillyhub-daemon', 'sillyhub-file']);
    expect(opts!.mcpServers![WORKER_MCP_SERVER_NAME]).toBeUndefined();
  });

  it('普通会话（stage=scan，非 orchestrator / mission_worker）仍零注入', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    await makeSm(driver).create({ ...BASE_INPUT, stage: 'scan' });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });

  it('provider=codex（stage=mission_worker）不注入任何 server', async () => {
    const { driver, getStartOpts } = makeMockDriver();
    const sm = new SessionManager(
      { ...makeDeps(), drivers: { claude: driver, codex: driver } } as ConstructorParameters<
        typeof SessionManager
      >[0],
      {
        isMainAgentSession: cliMainPredicate,
        mainAgentMcpConfigProvider: () => FAKE_MAIN_MCP,
        isWorkerSession: cliWorkerPredicate,
        workerMcpConfigProvider: workerMcpProvider,
      },
    );
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-worker-codex',
      provider: 'codex',
      stage: 'mission_worker',
    });

    const opts = getStartOpts();
    expect(opts!.mcpServers).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. mcp-server mission_worker 受限工具集（递归闸）
// ════════════════════════════════════════════════════════════════════════════

/** 全量注册工具黑名单（递归闸铁律：任何一个出现即闸失效）。 */
const BANNED_TOOLS = [
  'dispatch_worker',
  'get_worker_result',
  'list_workers',
  'converge_mission',
  'report_progress',
  'mission_status',
  'upload_file',
  'list_uploaded_files',
];

function makeMockHubClient(): HubClient {
  return new HubClient('http://mock', 'mock-token');
}

async function connectWorkerServer(client: HubClient): Promise<{
  mcpClient: Client;
  close: () => Promise<void>;
}> {
  const { server } = createMcpServer(client, { toolset: 'mission_worker' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
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

describe('task-06: mcp-server mission_worker 受限工具集（递归闸）', () => {
  it('listTools 仅 worker_done 单工具，不含任何编排 / 文件工具', async () => {
    const { mcpClient, close } = await connectWorkerServer(makeMockHubClient());
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toEqual(['worker_done']);
      for (const banned of BANNED_TOOLS) {
        expect(names).not.toContain(banned);
      }
    } finally {
      await close();
    }
  });

  it('受限 server 名常量 = sillyhub-worker（mcp-server 与 mcp-config 两处对齐）', () => {
    expect(SERVER_NAME_FROM_SERVER).toBe('sillyhub-worker');
    expect(WORKER_MCP_SERVER_NAME).toBe('sillyhub-worker');
  });

  it('worker_done inputSchema：summary 必填，workspace_id / mission_id 可选（task-07 契约）', async () => {
    const { mcpClient, close } = await connectWorkerServer(makeMockHubClient());
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'worker_done');
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties).toBeDefined();
      expect(Object.keys(schema.properties!)).toEqual(
        expect.arrayContaining(['summary', 'workspace_id', 'mission_id']),
      );
      expect(schema.required).toEqual(['summary']);
    } finally {
      await close();
    }
  });

  it('缺 summary 的调用被 schema 拒绝（required 校验，isError 回执不达 handler）', async () => {
    const client = makeMockHubClient();
    const spy = vi.spyOn(client, 'workerDone');
    const { mcpClient, close } = await connectWorkerServer(client);
    try {
      // MCP SDK 把 zod required 校验失败转为 -32602 isError 回执（resolve 非 reject）。
      const result = await mcpClient.callTool({ name: 'worker_done', arguments: {} });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      expect(block.text).toContain('summary');
      // handler 未被调用（校验在注册层拦截，hub-client 零请求）。
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await close();
    }
  });

  it('worker_done 调用路由 hub-client workerDone（summary 透传，ws/mid 缺省 undefined）', async () => {
    const client = makeMockHubClient();
    const spy = vi.spyOn(client, 'workerDone').mockResolvedValue({
      mission_id: 'mis-1',
      session_id: 'sess-worker-1',
      run_id: 'run-1',
      artifact_id: 'art-1',
      worker_done_at: '2026-08-25T12:00:00Z',
      all_workers_done: false,
      orchestrator_notified: false,
    });
    const { mcpClient, close } = await connectWorkerServer(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: { summary: '已完成：实现 X 并自测通过' },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(undefined, undefined, {
        summary: '已完成：实现 X 并自测通过',
      });
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt.mission_id).toBe('mis-1');
      expect(receipt.all_workers_done).toBe(false);
    } finally {
      spy.mockRestore();
      await close();
    }
  });

  it('显式 workspace_id / mission_id 透传 workerDone（越权校验锚）', async () => {
    const client = makeMockHubClient();
    const spy = vi.spyOn(client, 'workerDone').mockResolvedValue({ ok: true });
    const { mcpClient, close } = await connectWorkerServer(client);
    try {
      await mcpClient.callTool({
        name: 'worker_done',
        arguments: {
          summary: 'done',
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
        },
      });
      expect(spy).toHaveBeenCalledWith('ws-1', 'mis-1', { summary: 'done' });
    } finally {
      spy.mockRestore();
      await close();
    }
  });

  it('backend 非 2xx（HubHttpError 409 迟到）→ isError 结构化回执不 crash', async () => {
    const client = makeMockHubClient();
    const spy = vi
      .spyOn(client, 'workerDone')
      .mockRejectedValue(
        new HubHttpError(409, '{"detail":"该团队任务已收敛或已取消"}', 'http://hub/api/missions/worker_done', 'POST'),
      );
    const { mcpClient, close } = await connectWorkerServer(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: { summary: 'late' },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt.error).toBe('http');
      expect(receipt.tool).toBe('worker_done');
      expect(receipt.status).toBe(409);
    } finally {
      spy.mockRestore();
      await close();
    }
  });

  it('readEnv 认 MCP_TOOLSET=mission_worker（拼写错误回落 orchestration 容错不变）', () => {
    const saved = process.env.MCP_TOOLSET;
    try {
      process.env.MCP_TOOLSET = 'mission_worker';
      expect(readEnv().toolset).toBe('mission_worker');
      process.env.MCP_TOOLSET = 'file';
      expect(readEnv().toolset).toBe('file');
      process.env.MCP_TOOLSET = 'typo_value';
      expect(readEnv().toolset).toBe('orchestration');
      delete process.env.MCP_TOOLSET;
      expect(readEnv().toolset).toBe('orchestration');
    } finally {
      if (saved === undefined) delete process.env.MCP_TOOLSET;
      else process.env.MCP_TOOLSET = saved;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. hub-client workerDone 转发（X-Session-Id 会话定位）
// ════════════════════════════════════════════════════════════════════════════

describe('task-06: hub-client workerDone 转发', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('缺参形态 POST /api/missions/worker_done，附 X-Session-Id，body={summary}', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ mission_id: 'mis-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new HubClient('http://hub', { token: 'tok', sessionId: 'sess-worker-1' });

    await client.workerDone(undefined, undefined, { summary: 'done' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hub/api/missions/worker_done');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Session-Id']).toBe('sess-worker-1');
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ summary: 'done' });
  });

  it('显式 ws/mid 走 /api/workspaces/{ws}/missions/{mid}/worker_done，body 携带越权校验锚', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ mission_id: 'mis-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new HubClient('http://hub', { apiKey: 'key-x', sessionId: 'sess-w' });

    await client.workerDone('ws-1', 'mis-1', { summary: 'done' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hub/api/workspaces/ws-1/missions/mis-1/worker_done');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('key-x');
    expect(headers['X-Session-Id']).toBe('sess-w');
    expect(JSON.parse(String(init.body))).toEqual({
      summary: 'done',
      workspace_id: 'ws-1',
      mission_id: 'mis-1',
    });
  });

  it('backend 非 2xx 抛 HubHttpError（走 errorContent 结构化回执链）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"detail":"该团队任务已收敛或已取消"}', { status: 409 })),
    );
    const client = new HubClient('http://hub', { token: 'tok', sessionId: 'sess-w' });

    await expect(
      client.workerDone(undefined, undefined, { summary: 'late' }),
    ).rejects.toThrow(HubHttpError);
  });
});
