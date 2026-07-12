/**
 * spike-01: daemon 内置 stdio MCP server 最小可行验证。
 *
 * 目标：验证主 agent（claude/codex）经 --mcp-config 注入能否调到 daemon 内置
 * stdio MCP server，tool_call 能否路由到 hub-client → backend 派 worker。
 *
 * 这是 2026-07-12-team-main-agent-orchestration task-05 的前置 spike。通过 →
 * task-05 在此基础上扩展 5 tool；不通过 → 退方案 A（backend 主动 GLM 决策循环）。
 *
 * 设计依据：
 *   - mcp-config.ts McpServerConfig（{command, args, env}，spawn claude --mcp-config 注入）
 *   - hub-client.ts _headers()（:252 Bearer token / X-API-Key 鉴权 + Content-Type JSON）
 *     + _request()（:274 非 2xx 抛 HubHttpError，snake_case body）
 *   - backend mcp_tools.py dispatch_worker 真实契约：
 *       POST /workspaces/{workspace_id}/missions/{mission_id}/dispatch_worker
 *       body: {objective, role?, agent_type?, model?, read_only?}
 *       resp 201: {id, role, objective, status, agent_type, lease_id?, error_code?}
 *
 * 注意：task 描述的 schema 含 worker_id，但 backend 真实 endpoint 无此字段
 *（worker run id 由 backend 创建后返回，不在请求里）。spike 以 backend 真实契约为准。
 *
 * 运行：node server.ts（Node v24+ 原生 TS；低版本用 tsx 或 tsc 编译）
 * env:
 *   MCP_SERVER_BACKEND_URL  backend 根 URL（如 http://localhost:8000）
 *   MCP_SERVER_DAEMON_TOKEN  daemon Bearer token（透传主 agent run 的 user token）
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── 配置（env）─────────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.MCP_SERVER_BACKEND_URL ?? '').replace(/\/+$/, '');
const DAEMON_TOKEN = process.env.MCP_SERVER_DAEMON_TOKEN ?? '';

if (!BACKEND_URL) {
  // stderr 写诊断信息（不污染 stdout JSON-RPC 通道）；server 仍启动，
  // tool 调用时返回结构化错误（不 crash，便于诊断）。
  console.error('[mcp-server] MCP_SERVER_BACKEND_URL not set; tool calls will fail');
}
if (!DAEMON_TOKEN) {
  console.error('[mcp-server] MCP_SERVER_DAEMON_TOKEN not set; tool calls will fail');
}

// ── backend 调用（仿 hub-client _request 模式）──────────────────────────────

interface BackendDispatchResponse {
  id: string;
  role?: string | null;
  objective?: string | null;
  status: string;
  agent_type: string;
  lease_id?: string | null;
  error_code?: string | null;
}

/**
 * 调 backend dispatch_worker endpoint。
 *
 * 鉴权对齐 hub-client _headers()：Bearer token（主 agent run 的 user token 透传）。
 * 非 2xx / 网络错误 → 抛 Error（由 tool handler 捕获转结构化错误，不 crash server）。
 */
async function callDispatchWorker(params: {
  workspaceId: string;
  missionId: string;
  body: {
    objective: string;
    role?: string;
    agent_type?: string;
    model?: string;
    read_only?: boolean;
  };
}): Promise<BackendDispatchResponse> {
  const url =
    `${BACKEND_URL}/workspaces/${encodeURIComponent(params.workspaceId)}` +
    `/missions/${encodeURIComponent(params.missionId)}/dispatch_worker`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${DAEMON_TOKEN}`,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`backend ${resp.status}: ${bodyText}`);
  }
  return (await resp.json()) as BackendDispatchResponse;
}

// ── MCP server ─────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'sillyhub-daemon', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

/**
 * dispatch_worker tool：派一个 worker run。
 *
 * inputSchema 用 zod raw shape（McpServer.registerTool 约定），SDK 自动转 JSON Schema
 * 暴露给主 agent。字段对齐 backend DispatchWorkerRequest（mcp_tools.py:49）。
 */
server.registerTool(
  'dispatch_worker',
  {
    title: 'Dispatch Worker',
    description:
      'Dispatch a worker run for a mission. Routes via daemon MCP server to backend ' +
      '/workspaces/{workspace_id}/missions/{mission_id}/dispatch_worker. Returns worker ' +
      'run status receipt (id, status, lease_id, error_code).',
    inputSchema: {
      workspace_id: z.string().describe('Target workspace UUID'),
      mission_id: z.string().describe('Target mission UUID'),
      objective: z.string().describe('Worker objective / task description'),
      role: z.string().optional().describe('Worker role (default: worker)'),
      agent_type: z.string().optional().describe('Agent type (default: claude_code)'),
      model: z.string().optional().describe('Model override'),
      read_only: z.boolean().optional().describe('Read-only worker (default: false)'),
    },
  },
  async (args) => {
    try {
      if (!BACKEND_URL || !DAEMON_TOKEN) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'mcp_server_misconfigured',
                message:
                  'MCP_SERVER_BACKEND_URL / MCP_SERVER_DAEMON_TOKEN not set; ' +
                  'cannot route tool_call to backend',
              }),
            },
          ],
        };
      }

      const result = await callDispatchWorker({
        workspaceId: args.workspace_id,
        missionId: args.mission_id,
        body: {
          objective: args.objective,
          role: args.role,
          agent_type: args.agent_type,
          model: args.model,
          read_only: args.read_only,
        },
      });

      // 回执（worker 状态收据）。主 agent 读 status/error_code 决定下一步。
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              worker_run_id: result.id,
              status: result.status,
              role: result.role,
              agent_type: result.agent_type,
              lease_id: result.lease_id,
              error_code: result.error_code,
            }),
          },
        ],
      };
    } catch (e) {
      // backend 不可达 / 非 2xx → 结构化错误（不 crash server，主 agent 可重试/降级）
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'dispatch_worker_failed',
              message: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

// ── 启动 ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcp-server] sillyhub-daemon MCP server started (stdio)');
