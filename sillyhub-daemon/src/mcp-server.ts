/**
 * daemon 内置 stdio MCP server（task-05 / D-007@v2）。
 *
 * 主 agent（claude/codex）经 ``--mcp-config`` 注入本 server，tool_call 路由到
 * hub-client → backend mcp_tools.py 5 endpoint（派 worker / 读产出 / 列 worker /
 * 收敛 / 报进度）。
 *
 * spike-01（spikes/06-mcp-server）验证了 stdio MCP server + 1 tool 的协议链路；
 * 本文件扩展到生产 5 tool，handler 调 HubClient 方法（非 spike 的直接 fetch），
 * 鉴权 / 非 2xx / snake_case body 全复用 hub-client 既有语义。
 *
 * 设计依据：
 *   - backend ``app/modules/agent/mcp_tools.py`` 5 endpoint 真实契约（task-03 建，
 *     task-09 P0 鉴权 gap 闭合：require_permission → get_current_principal 双路径
 *     鉴权 JWT + X-API-Key）
 *   - ``hub-client.ts`` ``_request``（:274 非 2xx 抛 HubHttpError）+ ``_headers``
 *     （:252 Bearer token / X-API-Key 鉴权）
 *   - spike-01 README：tool schema 对齐 backend 真实契约（dispatch_worker 无
 *     worker_id）；token 用 user token（WORKSPACE_WRITE，非 daemon apiKey）；
 *     tsc 编译产物供 Node <24 兼容
 *
 * 运行：``node dist/mcp-server.js``（daemon engines.node>=20，需 tsc 编译）
 * env:
 *   MCP_SERVER_BACKEND_URL  backend 根 URL（如 http://localhost:8000）
 *   MCP_SERVER_DAEMON_API_KEY  长期 API Key（X-API-Key，task-09 P0：daemon apiKey
 *     优先走此路径，backend get_current_principal 解析 apiKey → User。cli.ts:692
 *     优先 config.api_key 写入此 env）
 *   MCP_SERVER_DAEMON_TOKEN  Bearer token（回落；apiKey 缺失时用 daemon Bearer
 *     token，backend mcp_tools 走 WORKSPACE_WRITE 权限校验）
 *
 * @module mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { HubClient, HubHttpError } from './hub-client.js';

// ── 配置（env）─────────────────────────────────────────────────────────────

/**
 * daemon 内置 MCP server 对外名称。mcp-config.ts platform_default 用同名 key
 * 注册（``mergeMcpConfigs`` 平台默认 server 自动入白名单）。
 */
export const DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon';

interface McpServerEnv {
  backendUrl: string;
  daemonToken: string;
  daemonApiKey: string;
}

/**
 * 从 process.env 读 backend URL + token。空值返回空串（不抛错，server 仍启动，
 * tool 调用时返回结构化错误便于诊断）。task-09 P0：apiKey 优先（X-API-Key 路径，
 * backend get_current_principal 解析 apiKey → User），token 回落（Bearer JWT）。
 */
function readEnv(): McpServerEnv {
  return {
    backendUrl: (process.env.MCP_SERVER_BACKEND_URL ?? '').replace(/\/+$/, ''),
    daemonApiKey: process.env.MCP_SERVER_DAEMON_API_KEY ?? '',
    daemonToken: process.env.MCP_SERVER_DAEMON_TOKEN ?? '',
  };
}

// ── tool handler 错误回执 ────────────────────────────────────────────────────

/**
 * tool 调用结果（McpServer registerTool handler 返回形态）。
 * content[0].text 是 JSON 字符串，主 agent parse 后读字段。
 *
 * index signature ``[x: string]: unknown`` 是 SDK ``registerTool`` handler
 * 返回类型的结构性要求（content + 可选 isError/_meta 之外允许扩展字段）。
 */
interface ToolResult {
  [x: string]: unknown;
  isError?: boolean;
  content: { type: 'text'; text: string }[];
}

/**
 * 成功回执：把 backend 响应（snake_case dict）原样 JSON 序列化到 text。
 * 主 agent 读字段（如 worker_run_id / status / error_code）决定下一步。
 */
function okContent(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/**
 * 结构化错误回执（不 crash server）。
 *
 * - backend 不可达 / 网络/超时 → ``error='network'``
 * - backend 非 2xx → ``error='http'`` + status + bodyText
 * - 其余异常 → ``error='internal'``
 *
 * 对齐 spike-01 已验证模式（isError: true + JSON content）。
 */
function errorContent(tool: string, err: unknown): ToolResult {
  let code: string;
  let message: string;
  let extra: Record<string, unknown> = {};
  if (err instanceof HubHttpError) {
    code = 'http';
    message = `backend ${err.status}: ${err.bodyText.slice(0, 500)}`;
    extra = { status: err.status };
  } else if (err instanceof TypeError) {
    // Node fetch 网络错误（fetch failed / ECONNREFUSED / 超时）→ TypeError
    code = 'network';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    message = cause?.message ?? err.message;
    if (cause?.code) extra.code = cause.code;
  } else if (err instanceof Error) {
    code = 'internal';
    message = err.message;
  } else {
    code = 'internal';
    message = String(err);
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: code, tool, message, ...extra }),
      },
    ],
  };
}

// ── server 构造（导出供测试注入 mock hub-client）──────────────────────────────

/**
 * 构造 daemon MCP server 并注册 5 tool。
 *
 * @param client  HubClient 实例（测试可传 mock）；生产由 ``runMcpServer`` 用 env
 *   构造。tool handler 全部经此 client 调 backend。
 * @returns ``{ server, transport }``，调用方 ``await server.connect(transport)``
 *   启动。分离构造与连接便于测试断言 tool 注册（``listTools``）无需 stdio。
 */
export function createMcpServer(client: HubClient): {
  server: McpServer;
} {
  const server = new McpServer(
    { name: DAEMON_MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ── dispatch_worker ──────────────────────────────────────────────────────
  // schema 对齐 backend DispatchWorkerRequest（mcp_tools.py:49）：无 worker_id
  //（worker run id 由 backend 创建后返回）。
  server.registerTool(
    'dispatch_worker',
    {
      title: 'Dispatch Worker',
      description:
        'Dispatch a worker run for a mission. Routes via daemon MCP server to ' +
        'backend POST /workspaces/{workspace_id}/missions/{mission_id}/dispatch_worker. ' +
        'Returns worker run status receipt (id, status, lease_id, error_code). ' +
        'error_code=no_online_daemon means run created but no daemon online (retry later).',
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
        const result = await client.dispatchWorker(
          args.workspace_id,
          args.mission_id,
          {
            objective: args.objective,
            role: args.role,
            agent_type: args.agent_type,
            model: args.model,
            read_only: args.read_only,
          },
        );
        return okContent(result);
      } catch (e) {
        return errorContent('dispatch_worker', e);
      }
    },
  );

  // ── get_worker_result ────────────────────────────────────────────────────
  server.registerTool(
    'get_worker_result',
    {
      title: 'Get Worker Result',
      description:
        'Read a single worker run structured output (artifacts: patch/summary). ' +
        'Routes to backend GET /workspaces/{workspace_id}/missions/{mission_id}/workers/{worker_id}/result.',
      inputSchema: {
        workspace_id: z.string().describe('Target workspace UUID'),
        mission_id: z.string().describe('Target mission UUID'),
        worker_id: z.string().describe('Worker run UUID (AgentRun.id)'),
      },
    },
    async (args) => {
      try {
        const result = await client.getWorkerResult(
          args.workspace_id,
          args.mission_id,
          args.worker_id,
        );
        return okContent(result);
      } catch (e) {
        return errorContent('get_worker_result', e);
      }
    },
  );

  // ── list_workers ─────────────────────────────────────────────────────────
  server.registerTool(
    'list_workers',
    {
      title: 'List Workers',
      description:
        'List all worker runs (including main orchestrator run) under a mission with status. ' +
        'Routes to backend GET /workspaces/{workspace_id}/missions/{mission_id}/workers.',
      inputSchema: {
        workspace_id: z.string().describe('Target workspace UUID'),
        mission_id: z.string().describe('Target mission UUID'),
      },
    },
    async (args) => {
      try {
        const result = await client.listWorkers(
          args.workspace_id,
          args.mission_id,
        );
        return okContent(result);
      } catch (e) {
        return errorContent('list_workers', e);
      }
    },
  );

  // ── converge_mission ─────────────────────────────────────────────────────
  server.registerTool(
    'converge_mission',
    {
      title: 'Converge Mission',
      description:
        'Trigger mission convergence (merge worker artifacts via FinalizerService + GLM/concat). ' +
        'Routes to backend POST /workspaces/{workspace_id}/missions/{mission_id}/converge. ' +
        'Returns { mission_id, status, converged, artifact_id? }.',
      inputSchema: {
        workspace_id: z.string().describe('Target workspace UUID'),
        mission_id: z.string().describe('Target mission UUID'),
      },
    },
    async (args) => {
      try {
        const result = await client.convergeMission(
          args.workspace_id,
          args.mission_id,
        );
        return okContent(result);
      } catch (e) {
        return errorContent('converge_mission', e);
      }
    },
  );

  // ── report_progress ──────────────────────────────────────────────────────
  // backend ProgressRequest 要 run_id（主 agent run.id），非 task 草案的 note。
  server.registerTool(
    'report_progress',
    {
      title: 'Report Progress',
      description:
        'Append a decision log entry for the main orchestrator run (AgentRunLog channel=tool_call). ' +
        'Routes to backend POST /workspaces/{workspace_id}/missions/{mission_id}/progress. ' +
        'Call after each main-agent decision (dispatch / judge / converge) for audit trail. ' +
        'Returns { run_id, log_id }.',
      inputSchema: {
        workspace_id: z.string().describe('Target workspace UUID'),
        mission_id: z.string().describe('Target mission UUID'),
        run_id: z.string().describe('Main orchestrator AgentRun.id (log owner)'),
        message: z.string().describe('Decision message text'),
        decision: z
          .string()
          .optional()
          .describe('Decision tag (prefixed to message for filtering, e.g. dispatch/judge/converge)'),
      },
    },
    async (args) => {
      try {
        const result = await client.reportProgress(
          args.workspace_id,
          args.mission_id,
          {
            run_id: args.run_id,
            message: args.message,
            decision: args.decision,
          },
        );
        return okContent(result);
      } catch (e) {
        return errorContent('report_progress', e);
      }
    },
  );

  return { server };
}

// ── 启动入口（生产：env 构造 HubClient + stdio transport）─────────────────────

/**
 * 启动 daemon MCP server（stdio transport）。
 *
 * 从 env 读 backend URL + token 构造 HubClient，注册 5 tool，连接
 * StdioServerTransport。env 缺失时仍启动（tool 调用返回结构化错误，不 crash）。
 *
 * 仅在作为独立进程运行（``node dist/mcp-server.js``）时调用；测试用
 * ``createMcpServer`` + mock client 直接断言 tool 注册，不经 stdio。
 */
export async function runMcpServer(): Promise<void> {
  const env = readEnv();
  if (!env.backendUrl) {
    console.error('[mcp-server] MCP_SERVER_BACKEND_URL not set; tool calls will fail');
  }
  // task-09 P0 鉴权 gap 闭合：apiKey（X-API-Key）优先，token（Bearer）回落。
  // apiKey 是 daemon 长期 admin 签发的 key，backend get_current_principal 解析
  // apiKey → User → has_permission(WORKSPACE_WRITE)。旧实现把 apiKey 当 Bearer
  // 发（string → HubClient Bearer），backend Bearer 路径只解 JWT，apiKey 非 JWT
  // → 401，mcp_tools 5 endpoint 不可达（task-06 遗留端到端阻塞）。
  if (!env.daemonApiKey && !env.daemonToken) {
    console.error(
      '[mcp-server] MCP_SERVER_DAEMON_API_KEY / MCP_SERVER_DAEMON_TOKEN not set; tool calls will fail',
    );
  }
  const auth = env.daemonApiKey
    ? { apiKey: env.daemonApiKey }
    : { token: env.daemonToken };
  const client = new HubClient(env.backendUrl || 'http://localhost:8000', auth);
  const { server } = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-server] sillyhub-daemon MCP server started (stdio)');
}

// ── 直接运行入口（node dist/mcp-server.js）──────────────────────────────────
// tsc 编译 CommonJS/ESM 后，作为入口脚本直接执行时启动 server。
// 用 import.meta.url 判断主模块（NodeNext ESM 约定）。

const isMain = (() => {
  try {
    // 跨平台主模块判断（CLAUDE.md 规则13 三平台兼容）。Windows 下 process.argv[1]
    // 是反斜杠绝对路径（C:\...\mcp-server.js），字符串拼接 `file://${argv[1]}` 得
    // 两斜杠 file://C:\...，与 import.meta.url 的三斜杠 file:///C:/... 不匹配 →
    // isMain 恒 false → runMcpServer 不调 → MCP server 子进程不启动 → team 主 agent
    // 5 tool 链路在 Windows 完全断（ql-20260712-002-mcpwin）。Linux/macOS 因 argv[1]
    // 是 /abs 正斜杠，拼接恰成三斜杠，原写法侥幸匹配。pathToFileURL 规范化为标准
    // file:// URL，跨平台稳定匹配。
    if (!process.argv[1]) return false;
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runMcpServer().catch((e) => {
    console.error('[mcp-server] fatal:', e);
    process.exit(1);
  });
}
