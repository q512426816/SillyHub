/**
 * spike-01 测试：验证 daemon 内置 stdio MCP server 可行性。
 *
 * 验证链路：MCP Client（模拟主 agent）→ StdioClientTransport spawn server.ts
 * → server 注册 dispatch_worker tool → tool_call 路由到 mock backend HTTP
 * → 回执返回 client。
 *
 * 通过标准（task 描述）：
 *   1. MCP 客户端能调 dispatch_worker tool 并收到 worker 状态回执。
 *   2. server 收到 tool_call → 调 mock backend → 返回响应给 client。
 *
 * 运行：
 *   pnpm vitest run spikes/06-mcp-server/spike.test.ts --config vitest.spikes.config.ts
 *   （spikes 不在默认 vitest.config.ts 的 include 里，需专用 config）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';

// ── mock backend ────────────────────────────────────────────────────────────

interface MockRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

function startMockBackend(
  handler: (req: MockRequest) => { status: number; body: unknown },
): Promise<{ server: HttpServer; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let body: unknown = undefined;
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        }
        const reqInfo: MockRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers['authorization'],
          body,
        };
        const { status, body: respBody } = handler(reqInfo);
        const payload = JSON.stringify(respBody);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to bind mock backend'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ── spawn MCP server 子进程 ────────────────────────────────────────────────

function spawnMcpServer(backendUrl: string, token: string): StdioClientTransport {
  const serverPath = join(process.cwd(), 'spikes', '06-mcp-server', 'server.ts');
  // StdioClientTransport.getDefaultEnvironment 只继承"安全"env，会丢 PATH。
  // 显式构造 env：继承关键 env + 注入 MCP_SERVER_*。
  const env: Record<string, string> = {
    ...process.env,
    MCP_SERVER_BACKEND_URL: backendUrl,
    MCP_SERVER_DAEMON_TOKEN: token,
  } as Record<string, string>;
  // 用 process.execPath（绝对 node 路径）避免 PATH 依赖；Node v24+ 原生跑 .ts。
  return new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
    stderr: 'pipe', // 不让 server stderr 污染测试输出
  });
}

async function withClient<T>(
  transport: StdioClientTransport,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(
    { name: 'spike-test-client', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

// ── 测试 ──────────────────────────────────────────────────────────────────

describe('spike-01: daemon 内置 stdio MCP server', () => {
  let mockBackend: {
    server: HttpServer;
    port: number;
    close: () => Promise<void>;
  } | null = null;
  const receivedRequests: MockRequest[] = [];

  beforeEach(() => {
    receivedRequests.length = 0;
  });

  afterEach(async () => {
    if (mockBackend) {
      await mockBackend.close();
      mockBackend = null;
    }
  });

  it('exposes dispatch_worker tool via listTools', async () => {
    mockBackend = await startMockBackend(() => ({
      status: 200,
      body: { ok: true },
    }));
    const transport = spawnMcpServer(
      `http://127.0.0.1:${mockBackend.port}`,
      'test-daemon-token',
    );
    await withClient(transport, async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('dispatch_worker');
      const tool = tools.tools.find((t) => t.name === 'dispatch_worker');
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/dispatch/i);
      // inputSchema 应含 backend 真实契约字段（objective 必填）
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema?.properties).toHaveProperty('objective');
      expect(schema?.properties).toHaveProperty('workspace_id');
      expect(schema?.properties).toHaveProperty('mission_id');
      expect(schema?.required).toContain('objective');
    });
  });

  it('routes dispatch_worker tool_call to backend and returns worker status receipt', async () => {
    // mock backend dispatch_worker endpoint：记录请求 + 返回 201 WorkerRunResponse
    mockBackend = await startMockBackend((req) => {
      receivedRequests.push(req);
      // 校验路径 + 方法
      if (
        req.method === 'POST' &&
        /\/workspaces\/ws-123\/missions\/mis-456\/dispatch_worker$/.test(req.url)
      ) {
        return {
          status: 201,
          body: {
            id: 'run-abc',
            role: 'coder',
            objective: 'implement feature X',
            status: 'pending',
            agent_type: 'claude_code',
            lease_id: 'lease-xyz',
            error_code: null,
          },
        };
      }
      return { status: 404, body: { detail: 'not found' } };
    });

    const transport = spawnMcpServer(
      `http://127.0.0.1:${mockBackend.port}`,
      'test-daemon-token',
    );

    await withClient(transport, async (client) => {
      const result = await client.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-123',
          mission_id: 'mis-456',
          objective: 'implement feature X',
          role: 'coder',
          agent_type: 'claude_code',
        },
      });

      // 1. tool_call 到达 server 并被处理（非错误）
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const block = result.content[0] as { type: string; text: string };
      expect(block.type).toBe('text');

      // 2. 回执结构（worker 状态收据）
      const receipt = JSON.parse(block.text) as {
        worker_run_id: string;
        status: string;
        lease_id: string | null;
        error_code: string | null;
        role: string;
        agent_type: string;
      };
      expect(receipt.worker_run_id).toBe('run-abc');
      expect(receipt.status).toBe('pending');
      expect(receipt.lease_id).toBe('lease-xyz');
      expect(receipt.error_code).toBeNull();
      expect(receipt.role).toBe('coder');
      expect(receipt.agent_type).toBe('claude_code');

      // 3. server 确实调了 mock backend（路由验证）
      expect(receivedRequests).toHaveLength(1);
      const backendReq = receivedRequests[0]!;
      expect(backendReq.method).toBe('POST');
      expect(backendReq.url).toContain('/workspaces/ws-123/missions/mis-456/dispatch_worker');

      // 4. 鉴权头透传（Bearer token，仿 hub-client _headers）
      expect(backendReq.authorization).toBe('Bearer test-daemon-token');

      // 5. 请求体对齐 backend DispatchWorkerRequest（snake_case）
      const body = backendReq.body as Record<string, unknown>;
      expect(body.objective).toBe('implement feature X');
      expect(body.role).toBe('coder');
      expect(body.agent_type).toBe('claude_code');
      expect(body.read_only).toBeUndefined(); // 未传 → 不发
    });
  });

  it('returns structured error when backend unreachable (no crash)', async () => {
    // 指向一个没人监听的端口 → fetch 网络错误 → handler 捕获 → 结构化错误
    const transport = spawnMcpServer(
      'http://127.0.0.1:59998',
      'test-daemon-token',
    );

    await withClient(transport, async (client) => {
      const result = await client.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'will fail to dispatch',
        },
      });

      // server 不 crash，返回结构化 isError 回执
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text) as { error: string; message: string };
      expect(err.error).toBe('dispatch_worker_failed');
      expect(err.message).toMatch(/backend|fetch|ECONNREFUSED/i);
    });
  });

  it('returns structured error when backend returns non-2xx', async () => {
    mockBackend = await startMockBackend((req) => {
      receivedRequests.push(req);
      return {
        status: 403,
        body: { detail: 'workspace_write permission denied' },
      };
    });

    const transport = spawnMcpServer(
      `http://127.0.0.1:${mockBackend.port}`,
      'test-daemon-token',
    );

    await withClient(transport, async (client) => {
      const result = await client.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'will be denied',
        },
      });

      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      const err = JSON.parse(block.text) as { error: string; message: string };
      expect(err.error).toBe('dispatch_worker_failed');
      expect(err.message).toMatch(/403/);
    });
  });

  it('handles no_online_daemon error_code from backend (worker run still created)', async () => {
    // backend dispatch_worker 在 daemon 离线时返回 201 + error_code=no_online_daemon
    //（run 仍建为 pending，主 agent 可重派）。验证 server 透传 error_code 不当错误。
    mockBackend = await startMockBackend((req) => {
      receivedRequests.push(req);
      return {
        status: 201,
        body: {
          id: 'run-def',
          role: 'worker',
          objective: 'stalled',
          status: 'pending',
          agent_type: 'claude_code',
          lease_id: null,
          error_code: 'no_online_daemon',
        },
      };
    });

    const transport = spawnMcpServer(
      `http://127.0.0.1:${mockBackend.port}`,
      'test-daemon-token',
    );

    await withClient(transport, async (client) => {
      const result = await client.callTool({
        name: 'dispatch_worker',
        arguments: {
          workspace_id: 'ws-1',
          mission_id: 'mis-1',
          objective: 'stalled',
        },
      });

      // HTTP 201 → 非 isError（backend 业务层 error_code 不等于 transport 错误）
      expect(result.isError).toBeFalsy();
      const block = result.content[0] as { type: string; text: string };
      const receipt = JSON.parse(block.text) as { error_code: string | null };
      expect(receipt.error_code).toBe('no_online_daemon');
    });
  });
});
