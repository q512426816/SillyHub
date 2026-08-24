// tests/mcp-server.test.ts
// task-05 / D-007@v2: daemon 内置 stdio MCP server 5 tool 单测。
// task-11（2026-08-24-session-team-mission-context / FR-02）：+mission_status
// 第 6 常驻工具（只读查询，参数全可选，X-Session-Id 定位）。
//
// 测试策略：createMcpServer(mockClient) 注入 mock HubClient，用
// InMemoryTransport 连接 MCP Client + server（不 spawn 子进程，比 spike-01 的
// stdio spawn 更快更稳）。断言：
//   1. 5 tool 注册（listTools 可见 + inputSchema 含必填字段）
//   2. tool_call 路由到对应 hub-client 方法 + 参数透传
//   3. 成功回执（backend 响应原样 JSON）
//   4. 错误处理：backend 不可达（TypeError）→ network；非 2xx → http；不 crash
//
// 对照 spike-01（spikes/06-mcp-server/spike.test.ts）的 stdio spawn 模式：
// 本测试改用内存 transport 避免子进程开销 + 跨 Node 版本编译依赖，专注 handler 逻辑。
// 端到端 stdio 链路由 spike-01 覆盖（5/5 passed）。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createMcpServer,
  DAEMON_MCP_SERVER_NAME,
  readEnv,
} from '../src/mcp-server';
import { HubClient, HubHttpError } from '../src/hub-client';

// ── mock HubClient ──────────────────────────────────────────────────────────
// 用 vi.spyOn 拦截 5 方法，断言参数 + 返回可控响应。空 HubClient（无真实 fetch）
// 仅作 spy 宿主，方法被 spy 后原实现不调用。

function makeMockClient(): {
  client: HubClient;
  calls: Record<string, unknown[]>;
} {
  const client = new HubClient('http://mock', 'mock-token');
  const calls: Record<string, unknown[]> = {
    dispatchWorker: [],
    getWorkerResult: [],
    listWorkers: [],
    convergeMission: [],
    reportProgress: [],
    getMissionStatus: [],
  };
  for (const m of Object.keys(calls) as (keyof typeof calls)[]) {
    calls[m] = [];
  }
  return { client, calls };
}

/** spy 单个方法：记录 args + 返回给定 value（默认 { ok: true }）。 */
function spyMethod(
  client: HubClient,
  calls: unknown[],
  method: keyof HubClient,
  returnValue: unknown = { ok: true },
): void {
  // @ts-expect-error spy 任意方法
  vi.spyOn(client, method).mockImplementation(async (...args: unknown[]) => {
    calls.push(args);
    return returnValue;
  });
}

/** 连接 Client + server（内存 transport），返回 client + 关闭函数。 */
async function connect(
  client: HubClient,
): Promise<{
  mcpClient: Client;
  close: () => Promise<void>;
}> {
  const { server } = createMcpServer(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: 'test-client', version: '0.0.1' },
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

// ── 1. tool 注册（listTools）──────────────────────────────────────────────

describe('mcp-server: 6 tool 注册（task-11 前为 5）', () => {
  it('listTools 暴露 6 tool（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress + mission_status）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'dispatch_worker',
          'get_worker_result',
          'list_workers',
          'converge_mission',
          'report_progress',
          'mission_status',
        ]),
      );
      expect(names).toHaveLength(6);
    } finally {
      await close();
    }
  });

  it('server name = sillyhub-daemon', async () => {
    expect(DAEMON_MCP_SERVER_NAME).toBe('sillyhub-daemon');
  });

  it('dispatch_worker inputSchema：objective 必填，workspace_id/mission_id 可选（task-10）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'dispatch_worker');
      expect(tool).toBeDefined();
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema?.properties).toHaveProperty('objective');
      expect(schema?.properties).toHaveProperty('workspace_id');
      expect(schema?.properties).toHaveProperty('mission_id');
      // backend 真实契约无 worker_id（spike-01 修正）
      expect(schema?.properties).not.toHaveProperty('worker_id');
      // task-10（审查 B1）：mission_id/workspace_id 转可选（会话上下文 X-Session-Id 定位）
      expect(schema?.required).toContain('objective');
      expect(schema?.required).not.toContain('workspace_id');
      expect(schema?.required).not.toContain('mission_id');
    } finally {
      await close();
    }
  });

  it('dispatch_worker inputSchema 含可选 target_workspace_id（task-10）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'dispatch_worker');
      expect(tool).toBeDefined();
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema?.properties).toHaveProperty('target_workspace_id');
      // target_workspace_id 是可选字段
      expect(schema?.required).not.toContain('target_workspace_id');
    } finally {
      await close();
    }
  });

  it('report_progress inputSchema：message 必填，run_id 可选（task-10，非 note）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'report_progress');
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema?.properties).toHaveProperty('run_id');
      expect(schema?.properties).toHaveProperty('message');
      expect(schema?.properties).not.toHaveProperty('note');
      // task-10（审查 B1）：run_id 转可选（backend 按 X-Session-Id 解析主控 run）
      expect(schema?.required).not.toContain('run_id');
      expect(schema?.required).toContain('message');
    } finally {
      await close();
    }
  });

  it('get_worker_result inputSchema 含必填 worker_id', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'get_worker_result');
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema?.properties).toHaveProperty('worker_id');
      expect(schema?.required).toContain('worker_id');
    } finally {
      await close();
    }
  });
});

// ── task-10（2026-08-22-team-session-unify / 审查 B1）：参数可选化 + 描述重写 + env ──

describe('mcp-server: task-10 参数可选化与会话上下文', () => {
  it('5 工具 mission_id/workspace_id 均不在 required（会话上下文定位，B1）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      for (const name of [
        'dispatch_worker',
        'get_worker_result',
        'list_workers',
        'converge_mission',
        'report_progress',
      ]) {
        const tool = tools.tools.find((t) => t.name === name);
        expect(tool, `tool ${name} 应注册`).toBeDefined();
        const schema = tool?.inputSchema as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        // 属性仍存在（显式传参透传作越权校验锚），只是不再必填
        expect(schema?.properties).toHaveProperty('mission_id');
        expect(schema?.properties).toHaveProperty('workspace_id');
        expect(schema?.required ?? []).not.toContain('mission_id');
        expect(schema?.required ?? []).not.toContain('workspace_id');
      }
    } finally {
      await close();
    }
  });

  it('dispatch_worker 描述含「仅用户明确要求时派团队」文案（能力说明书）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'dispatch_worker');
      expect(tool?.description).toContain('仅用户明确要求时派团队');
    } finally {
      await close();
    }
  });

  it('dispatch_worker 缺省 workspace_id/mission_id → undefined 透传（hub-client 守卫不下发）', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.dispatchWorker, 'dispatchWorker', {
      id: 'run-lazy',
      status: 'pending',
      lease_id: null,
      error_code: null,
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: { objective: 'lazy mission dispatch' },
      });
      expect(result.isError).toBeFalsy();
      expect(calls.dispatchWorker[0]).toEqual([
        undefined,
        undefined,
        {
          objective: 'lazy mission dispatch',
          role: undefined,
          agent_type: undefined,
          model: undefined,
          read_only: undefined,
          worktree_path: undefined,
          branch: undefined,
          worker_prompt: undefined,
          target_workspace_id: undefined,
        },
      ]);
    } finally {
      await close();
    }
  });

  it('report_progress 缺省 run_id → undefined 透传（backend 按 X-Session-Id 解析主控 run）', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.reportProgress, 'reportProgress', {
      run_id: 'run-1',
      log_id: 'log-1',
    });
    const { mcpClient, close } = await connect(client);
    try {
      await mcpClient.callTool({
        name: 'report_progress',
        arguments: { message: 'decided to wait' },
      });
      expect(calls.reportProgress[0]).toEqual([
        undefined,
        undefined,
        { run_id: undefined, message: 'decided to wait', decision: undefined },
      ]);
    } finally {
      await close();
    }
  });

  it('readEnv 读 process.env.MCP_SESSION_ID（spike-01 注入管道终点）', async () => {
    process.env.MCP_SESSION_ID = 'sess-env-1';
    try {
      const env = readEnv();
      expect(env.sessionId).toBe('sess-env-1');
    } finally {
      delete process.env.MCP_SESSION_ID;
    }
  });

  it('MCP_SESSION_ID 未设 → readEnv.sessionId 空串（容错，不抛）', async () => {
    const prev = process.env.MCP_SESSION_ID;
    delete process.env.MCP_SESSION_ID;
    try {
      expect(readEnv().sessionId).toBe('');
    } finally {
      if (prev !== undefined) process.env.MCP_SESSION_ID = prev;
    }
  });
});

// ── 2. tool_call 路由 + 参数透传 ──────────────────────────────────────────

describe('mcp-server: tool_call 路由到 hub-client 方法', () => {
  it('dispatch_worker → client.dispatchWorker(ws, mid, {objective, role, ...})', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.dispatchWorker, 'dispatchWorker', {
      id: 'run-1',
      status: 'pending',
      lease_id: null,
      error_code: null,
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'impl feature X',
          role: 'coder',
          agent_type: 'claude_code',
        },
      });
      // 路由到 hub-client 方法
      expect(calls.dispatchWorker).toHaveLength(1);
      expect(calls.dispatchWorker[0]).toEqual([
        'ws-1',
        'mis-1',
        {
          objective: 'impl feature X',
          role: 'coder',
          agent_type: 'claude_code',
          model: undefined,
          read_only: undefined,
          target_workspace_id: undefined,
        },
      ]);
      // 回执：backend 响应原样 JSON
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt).toEqual({
        id: 'run-1',
        status: 'pending',
        lease_id: null,
        error_code: null,
      });
    } finally {
      await close();
    }
  });

  it('dispatch_worker 带 target_workspace_id → body 含 target_workspace_id', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.dispatchWorker, 'dispatchWorker', {
      id: 'run-2',
      status: 'pending',
      lease_id: null,
      error_code: null,
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'cross-ws task',
          target_workspace_id: 'ws-target',
        },
      });
      expect(calls.dispatchWorker).toHaveLength(1);
      expect(calls.dispatchWorker[0]).toEqual([
        'ws-1',
        'mis-1',
        {
          objective: 'cross-ws task',
          role: undefined,
          agent_type: undefined,
          model: undefined,
          read_only: undefined,
          worktree_path: undefined,
          branch: undefined,
          worker_prompt: undefined,
          target_workspace_id: 'ws-target',
        },
      ]);
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt.id).toBe('run-2');
    } finally {
      await close();
    }
  });

  it('get_worker_result → client.getWorkerResult(ws, mid, wid)', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.getWorkerResult, 'getWorkerResult', {
      worker_id: 'w-1',
      status: 'completed',
      artifacts: [{ kind: 'patch', id: 'art-1' }],
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'get_worker_result',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1', worker_id: 'w-1' },
      });
      expect(calls.getWorkerResult[0]).toEqual(['ws-1', 'mis-1', 'w-1']);
      const block = result.content[0] as { type: string; text: string };
      expect(JSON.parse(block.text)).toMatchObject({ worker_id: 'w-1', status: 'completed' });
    } finally {
      await close();
    }
  });

  it('list_workers → client.listWorkers(ws, mid)', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.listWorkers, 'listWorkers', {
      mission_id: 'mis-1',
      workers: [{ id: 'w-1', status: 'completed' }],
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'list_workers',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(calls.listWorkers[0]).toEqual(['ws-1', 'mis-1']);
      const block = result.content[0] as { type: string; text: string };
      expect(JSON.parse(block.text)).toMatchObject({ mission_id: 'mis-1' });
    } finally {
      await close();
    }
  });

  it('converge_mission → client.convergeMission(ws, mid)', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.convergeMission, 'convergeMission', {
      mission_id: 'mis-1',
      status: 'done',
      converged: true,
      artifact_id: 'art-9',
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'converge_mission',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(calls.convergeMission[0]).toEqual(['ws-1', 'mis-1']);
      const block = result.content[0] as { type: string; text: string };
      expect(JSON.parse(block.text)).toMatchObject({ converged: true });
    } finally {
      await close();
    }
  });

  it('report_progress → client.reportProgress(ws, mid, {run_id, message, decision})', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.reportProgress, 'reportProgress', {
      run_id: 'run-1',
      log_id: 'log-9',
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'report_progress',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          run_id: 'run-1',
          message: 'dispatched worker',
          decision: 'dispatch',
        },
      });
      expect(calls.reportProgress[0]).toEqual([
        'ws-1',
        'mis-1',
        { run_id: 'run-1', message: 'dispatched worker', decision: 'dispatch' },
      ]);
      const block = result.content[0] as { type: string; text: string };
      expect(JSON.parse(block.text)).toEqual({ run_id: 'run-1', log_id: 'log-9' });
    } finally {
      await close();
    }
  });
});

// ── 3. 错误处理（不 crash，结构化 isError 回执）──────────────────────────────

describe('mcp-server: 错误处理', () => {
  it('backend 不可达（TypeError fetch failed）→ isError + error=network', async () => {
    const { client, calls } = makeMockClient();
    // @ts-expect-error mock 抛 TypeError
    vi.spyOn(client, 'dispatchWorker').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'will fail',
        },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('network');
      expect(err.tool).toBe('dispatch_worker');
      expect(err.message).toMatch(/fetch failed/);
      expect(calls.dispatchWorker).toHaveLength(0); // spy 替换后 calls 不记（直接抛）
    } finally {
      await close();
    }
  });

  it('backend 非 2xx（HubHttpError 403）→ isError + error=http + status', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'dispatchWorker').mockImplementation(async () => {
      throw new HubHttpError(403, '{"detail":"denied"}', 'http://x/api/...', 'POST');
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1', objective: 'x' },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('http');
      expect(err.status).toBe(403);
      expect(err.message).toMatch(/403/);
    } finally {
      await close();
    }
  });

  it('backend 业务 error_code=no_online_daemon（HTTP 201）→ 非 isError，error_code 透传', async () => {
    // backend dispatch_worker daemon 离线时仍 201 + error_code（spike-01 验证模式）：
    // hub-client dispatchWorker 2xx 不抛，error_code 在响应体里，server 原样透传。
    const { client } = makeMockClient();
    spyMethod(client, [], 'dispatchWorker', {
      id: 'run-def',
      status: 'pending',
      lease_id: null,
      error_code: 'no_online_daemon',
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'dispatch_worker',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1', objective: 'stalled' },
      });
      // 2xx → 非 isError（业务 error_code 不等于 transport 错误）
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt.error_code).toBe('no_online_daemon');
    } finally {
      await close();
    }
  });

  it('未知内部异常 → isError + error=internal', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'listWorkers').mockImplementation(async () => {
      throw new Error('unexpected boom');
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'list_workers',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('internal');
      expect(err.message).toMatch(/unexpected boom/);
    } finally {
      await close();
    }
  });

  it('一个 tool 报错不影响后续 tool 调用（server 不 crash）', async () => {
    const { client, calls } = makeMockClient();
    let callCount = 0;
    vi.spyOn(client, 'listWorkers').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new HubHttpError(500, 'server error', 'http://x', 'GET');
      }
      return { mission_id: 'mis-1', workers: [] };
    });
    const { mcpClient, close } = await connect(client);
    try {
      // 第一次报错
      const r1 = await mcpClient.callTool({
        name: 'list_workers',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(r1.isError).toBe(true);
      // 第二次成功（server 仍活着）
      const r2 = await mcpClient.callTool({
        name: 'list_workers',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(r2.isError).toBeFalsy();
      void calls; // calls 不用（spy 直接抛/返）
    } finally {
      await close();
    }
  });
});

// ── task-11（2026-08-24-session-team-mission-context / FR-02 / D-005@v1）：mission_status 第 6 工具 ──
// 只读查询当前会话团队任务状态：mission 概要 / scope 工作区（绑定机器+在线+
// git 模式）/ workers。参数全可选（X-Session-Id 会话上下文定位）；无活跃
// mission → backend 200 active=false（非 404，D-012），工具不报错。

describe('mcp-server: task-11 mission_status 第 6 工具', () => {
  it('listTools 暴露 6 tool（既有 5 + mission_status）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'dispatch_worker',
          'get_worker_result',
          'list_workers',
          'converge_mission',
          'report_progress',
          'mission_status',
        ]),
      );
      expect(names).toHaveLength(6);
    } finally {
      await close();
    }
  });

  it('mission_status inputSchema：仅 workspace_id/mission_id 且均可选（会话上下文定位）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'mission_status');
      expect(tool).toBeDefined();
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      // 参数全可选，无必填字段
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
        'mission_id',
        'workspace_id',
      ]);
      expect(schema?.required ?? []).not.toContain('workspace_id');
      expect(schema?.required ?? []).not.toContain('mission_id');
    } finally {
      await close();
    }
  });

  it('mission_status 描述按能力说明书口径（无活跃任务 active=false / 可先查再派）', async () => {
    const { client } = makeMockClient();
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((t) => t.name === 'mission_status');
      const desc = tool?.description ?? '';
      expect(desc).toContain('当前会话团队任务状态');
      expect(desc).toContain('mission 概要');
      expect(desc).toContain('scope_workspaces');
      expect(desc).toContain('workers');
      expect(desc).toContain('无活跃任务返回 active=false');
      expect(desc).toContain('可先查再派');
    } finally {
      await close();
    }
  });

  it('mission_status → client.getMissionStatus(ws, mid)（显式传参透传越权校验锚）', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.getMissionStatus, 'getMissionStatus', {
      active: true,
      mission_id: 'mis-1',
      status: 'running',
      objective: 'team task',
      anchor_workspace: {
        id: 'ws-1',
        name: 'main',
        type: null,
        description: null,
        daemon_online: true,
        daemon_name: 'dev-box',
        git_mode: 'git',
      },
      scope_workspaces: [
        {
          id: 'ws-2',
          name: 'sub',
          type: null,
          description: null,
          daemon_online: false,
          daemon_name: null,
          git_mode: 'unknown',
        },
      ],
      workers: [{ id: 'w-1', role: 'worker', status: 'running' }],
      budget_usd: null,
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'mission_status',
        arguments: { workspace_id: 'ws-1', mission_id: 'mis-1' },
      });
      expect(result.isError).toBeFalsy();
      expect(calls.getMissionStatus).toHaveLength(1);
      expect(calls.getMissionStatus[0]).toEqual(['ws-1', 'mis-1']);
      // 回执：MissionStatusResponse 原样 JSON 透传
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text);
      expect(receipt).toMatchObject({ active: true, mission_id: 'mis-1' });
      expect(receipt.scope_workspaces[0]).toMatchObject({
        id: 'ws-2',
        daemon_online: false,
        git_mode: 'unknown',
      });
    } finally {
      await close();
    }
  });

  it('mission_status 缺省 workspace_id/mission_id → undefined 透传（X-Session-Id 定位）', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.getMissionStatus, 'getMissionStatus', {
      active: true,
      mission_id: 'mis-lazy',
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'mission_status',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(calls.getMissionStatus[0]).toEqual([undefined, undefined]);
    } finally {
      await close();
    }
  });

  it('mission_status 无活跃 mission（active=false）→ 非 isError（D-005 优雅返回）', async () => {
    const { client, calls } = makeMockClient();
    spyMethod(client, calls.getMissionStatus, 'getMissionStatus', {
      active: false,
      hint: 'no active mission for this session',
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'mission_status',
        arguments: {},
      });
      // active=false 是正常 2xx 响应，不是错误
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      expect(JSON.parse(block.text)).toMatchObject({ active: false });
    } finally {
      await close();
    }
  });

  it('mission_status backend 非 2xx → isError + error=http（errorContent 分支）', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'getMissionStatus').mockImplementation(async () => {
      throw new HubHttpError(403, '{"detail":"denied"}', 'http://x/api/missions/status', 'GET');
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'mission_status',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text);
      expect(err.error).toBe('http');
      expect(err.tool).toBe('mission_status');
      expect(err.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('mission_status 网络错误 → isError + error=network（不 crash server）', async () => {
    const { client } = makeMockClient();
    vi.spyOn(client, 'getMissionStatus').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const { mcpClient, close } = await connect(client);
    try {
      const result = await mcpClient.callTool({
        name: 'mission_status',
        arguments: {},
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
