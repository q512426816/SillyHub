// tests/interactive/mcp-server-worker-done.test.ts
// task-15（2026-08-25-team-subsession-governance）/ task-06 D-003@v1 验收：
// mission_worker 受限模式的 env 门控、单工具注册（递归闸守护）与 worker_done
// 转发契约。
//
// 测试策略（对齐 tests/mcp-server.test.ts）：createMcpServer(mockClient,
// { toolset: 'mission_worker' }) 注入 mock HubClient，InMemoryTransport 连接
// MCP Client + server（不 spawn 子进程）。断言：
//   1. env 门控：MCP_TOOLSET=mission_worker 切受限模式（readEnv 终点）；
//      未设 / 拼写错误回落 orchestration 不 crash；
//   2. 单工具注册：listTools 恰好 1 个 worker_done；dispatch_worker /
//      converge_mission 等编排工具与 file 工具一律不注册（递归闸铁律——
//      分身拿不到派发能力，design §3 非目标 / §7 风险表）；
//   3. worker_done 转发：callTool → client.workerDone(ws, mid, {summary})
//      参数透传 + 回执原样 JSON；缺省参数 undefined 透传（X-Session-Id 定位）；
//      409（迟到调用）/ 网络错误 → 结构化 isError 不 crash；
//   4. hub-client workerDone 端点契约（对齐 backend task-07 端点）：session-scoped
//      POST /api/missions/worker_done（X-Session-Id 附头，body 只含 summary）；
//      显式参数 POST /api/workspaces/{ws}/missions/{mid}/worker_done（body 含
//      workspace_id/mission_id 越权校验锚）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createMcpServer,
  readEnv,
  WORKER_MCP_SERVER_NAME,
} from '../../src/mcp-server';
import { HubClient, HubHttpError } from '../../src/hub-client';

// ── mock HubClient（同 tests/mcp-server.test.ts 模式）────────────────────────

function makeMockClient(): { client: HubClient; workerDoneCalls: unknown[][] } {
  const client = new HubClient('http://mock', 'mock-token');
  const workerDoneCalls: unknown[][] = [];
  return { client, workerDoneCalls };
}

function spyWorkerDone(
  client: HubClient,
  calls: unknown[][],
  returnValue: unknown = {
    mission_id: 'mis-1',
    session_id: 'sess-1',
    run_id: 'run-1',
    artifact_id: 'art-1',
    worker_done_at: '2026-08-25T12:00:00Z',
    all_workers_done: true,
    orchestrator_notified: true,
  },
): void {
  vi.spyOn(client, 'workerDone').mockImplementation(
    async (...args: unknown[]) => {
      calls.push(args);
      return returnValue as Record<string, unknown>;
    },
  );
}

/** 以 mission_worker 受限模式连接 Client + server（内存 transport）。 */
async function connectWorker(
  client: HubClient,
): Promise<{
  mcpClient: Client;
  close: () => Promise<void>;
}> {
  const { server } = createMcpServer(client, { toolset: 'mission_worker' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: 'test-worker-client', version: '0.0.1' },
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

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── 1. env 门控（readEnv 注入管道终点）──────────────────────────────────────

describe('mission_worker 受限模式：env 门控', () => {
  afterEach(() => {
    delete process.env.MCP_TOOLSET;
  });

  it("MCP_TOOLSET=mission_worker → readEnv.toolset='mission_worker'", () => {
    process.env.MCP_TOOLSET = 'mission_worker';
    expect(readEnv().toolset).toBe('mission_worker');
  });

  it('MCP_TOOLSET 未设 → orchestration（缺省主控 6 工具，零回归）', () => {
    delete process.env.MCP_TOOLSET;
    expect(readEnv().toolset).toBe('orchestration');
  });

  it('MCP_TOOLSET 拼写错误（mission-worker）→ 容错回落 orchestration 不 crash', () => {
    process.env.MCP_TOOLSET = 'mission-worker'; // 连字符拼写错误
    expect(readEnv().toolset).toBe('orchestration');
  });

  it("受限 server 名 = sillyhub-worker（WORKER_MCP_SERVER_NAME）", () => {
    expect(WORKER_MCP_SERVER_NAME).toBe('sillyhub-worker');
  });
});

// ── 2. 单工具注册（递归闸守护，D-003@v1 验收）──────────────────────────────

describe('mission_worker 受限模式：单工具注册（递归闸守护）', () => {
  it('listTools 恰好 1 个工具：worker_done', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connectWorker(client);
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toEqual(['worker_done']);
      expect(names).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('不注册任何编排 / 派发 / 文件工具（分身拿不到递归下放能力）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connectWorker(client);
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name);
      // 递归闸铁律：编排 6 工具 + file 2 工具一律缺席
      for (const forbidden of [
        'dispatch_worker',
        'get_worker_result',
        'list_workers',
        'converge_mission',
        'report_progress',
        'mission_status',
        'upload_file',
        'list_uploaded_files',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    } finally {
      await close();
    }
  });

  it('worker_done inputSchema：summary 必填，workspace_id/mission_id 可选（越权校验锚）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connectWorker(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'worker_done');
      expect(tool).toBeDefined();
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
        'mission_id',
        'summary',
        'workspace_id',
      ]);
      expect(schema?.required).toContain('summary');
      expect(schema?.required ?? []).not.toContain('workspace_id');
      expect(schema?.required ?? []).not.toContain('mission_id');
    } finally {
      await close();
    }
  });

  it('描述含完成信号口径（干完再调 / 追问重开工后可再调 / 无派发工具）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connectWorker(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'worker_done');
      const desc = tool?.description ?? '';
      expect(desc).toContain('确保真的干完再调');
      expect(desc).toContain('再次调用');
      expect(desc).toContain('all_workers_done');
    } finally {
      await close();
    }
  });
});

// ── 3. worker_done 转发契约（mock hub-client）───────────────────────────────

describe('mission_worker：worker_done 转发契约', () => {
  it('callTool → client.workerDone(ws, mid, {summary}) 参数透传 + 回执原样 JSON', async () => {
    const { client, workerDoneCalls } = makeMockClient();
    spyWorkerDone(client, workerDoneCalls);
    const { mcpClient, close } = await connectWorker(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          summary: '完成 X；产出 backend/app/foo.py；无风险',
        },
      });
      expect(result.isError).toBeFalsy();
      expect(workerDoneCalls).toHaveLength(1);
      expect(workerDoneCalls[0]).toEqual([
        'ws-1',
        'mis-1',
        { summary: '完成 X；产出 backend/app/foo.py；无风险' },
      ]);
      // 回执：backend WorkerDoneResponse 原样 JSON 透传
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt).toMatchObject({
        mission_id: 'mis-1',
        session_id: 'sess-1',
        all_workers_done: true,
        orchestrator_notified: true,
      });
    } finally {
      await close();
    }
  });

  it('缺省 workspace_id/mission_id → undefined 透传（X-Session-Id 会话定位）', async () => {
    const { client, workerDoneCalls } = makeMockClient();
    spyWorkerDone(client, workerDoneCalls);
    const { mcpClient, close } = await connectWorker(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: { summary: 'done by session context' },
      });
      expect(result.isError).toBeFalsy();
      expect(workerDoneCalls[0]).toEqual([
        undefined,
        undefined,
        { summary: 'done by session context' },
      ]);
    } finally {
      await close();
    }
  });

  it('backend 409（mission 已终态的迟到调用）→ isError + error=http + status=409', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'workerDone').mockImplementation(async () => {
      throw new HubHttpError(
        409,
        '{"message":"该团队任务已收敛或已取消"}',
        'http://x/api/missions/worker_done',
        'POST',
      );
    });
    const { mcpClient, close } = await connectWorker(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: { summary: 'late' },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('http');
      expect(err.tool).toBe('worker_done');
      expect(err.status).toBe(409);
    } finally {
      await close();
    }
  });

  it('backend 不可达（TypeError fetch failed）→ isError + error=network（不 crash）', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'workerDone').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const { mcpClient, close } = await connectWorker(client);
    try {
      const result = await mcpClient.callTool({
        name: 'worker_done',
        arguments: { summary: 'x' },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('network');
      expect(err.message).toMatch(/fetch failed/);
    } finally {
      await close();
    }
  });
});

// ── 4. hub-client workerDone 端点契约（对齐 backend task-07 端点）───────────

describe('hub-client workerDone：task-07 端点契约（mock fetch）', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ mission_id: 'mis-1', ok: true }), {
          status: 200,
        }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('session-scoped 形态：POST /api/missions/worker_done，body 只含 summary，附 X-Session-Id', async () => {
    const client = new HubClient('http://mock-hub', {
      apiKey: 'key-1',
      sessionId: 'sess-worker-1',
    });
    await client.workerDone(undefined, undefined, { summary: 'done' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe('http://mock-hub/api/missions/worker_done');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ summary: 'done' });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Session-Id']).toBe('sess-worker-1');
    expect(headers['X-API-Key']).toBe('key-1');
  });

  it('显式参数形态：POST /api/workspaces/{ws}/missions/{mid}/worker_done，body 含越权校验锚', async () => {
    const client = new HubClient('http://mock-hub', {
      apiKey: 'key-1',
      sessionId: 'sess-worker-1',
    });
    await client.workerDone('ws-1', 'mis-1', { summary: 'done explicit' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe(
      'http://mock-hub/api/workspaces/ws-1/missions/mis-1/worker_done',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      summary: 'done explicit',
      workspace_id: 'ws-1',
      mission_id: 'mis-1',
    });
  });

  it('空串参数等同缺省（守卫不下发 workspace_id/mission_id）', async () => {
    const client = new HubClient('http://mock-hub', { token: 'tok-1' });
    await client.workerDone('', '', { summary: 'guarded' });

    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe('http://mock-hub/api/missions/worker_done');
    expect(JSON.parse(String(init?.body))).toEqual({ summary: 'guarded' });
  });
});
