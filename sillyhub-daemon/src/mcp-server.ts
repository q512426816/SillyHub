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
 *   MCP_SESSION_ID  主 agent 会话 id（task-10 / FR-04：session-manager 经
 *     mcpServers['sillyhub-daemon'].env per-server 注入（spike-01 管道），
 *     hub-client 给 MCP 5 端点附 X-Session-Id，backend 按会话定位活跃 mission）
 *
 * @module mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { HubClient, HubHttpError, type HubClientAuth } from './hub-client.js';

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
  /** task-10（2026-08-22-team-session-unify / FR-04）：主 agent 会话 id。 */
  sessionId: string;
}

/**
 * 从 process.env 读 backend URL + token + 会话 id。空值返回空串（不抛错，server
 * 仍启动，tool 调用时返回结构化错误便于诊断）。task-09 P0：apiKey 优先（X-API-Key
 * 路径，backend get_current_principal 解析 apiKey → User），token 回落（Bearer JWT）。
 * task-10：MCP_SESSION_ID 经 mcpServers['sillyhub-daemon'].env per-server 注入
 * （spike-01 验证管道：CLI spawn MCP 子进程时白名单 env + per-server env 合并）。
 * 导出供单测断言注入链终点（session-manager → driver spawn → 本函数）。
 */
export function readEnv(): McpServerEnv {
  return {
    backendUrl: (process.env.MCP_SERVER_BACKEND_URL ?? '').replace(/\/+$/, ''),
    daemonApiKey: process.env.MCP_SERVER_DAEMON_API_KEY ?? '',
    daemonToken: process.env.MCP_SERVER_DAEMON_TOKEN ?? '',
    sessionId: process.env.MCP_SESSION_ID ?? '',
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
  // task-10（2026-08-22-team-session-unify / 审查 B1）：mission_id/workspace_id
  // 转可选——backend 按 X-Session-Id 定位活跃 mission（懒建兜底），显式传参仅作
  // 越权校验锚。objective 仍必填。描述重写为「能力说明书」（何时派团队 / 如何拆解 /
  // 何时 converge / 预算提示）。
  server.registerTool(
    'dispatch_worker',
    {
      title: 'Dispatch Worker',
      description:
        '派一个团队分身（worker run）执行独立子任务。能力与使用准则：' +
        '【何时使用】仅用户明确要求时派团队（如「派团队」「让分身做」「并行分析」）；' +
        '日常编码、问答、小改动默认自己完成，不要主动派团队。' +
        '【如何拆解】把任务拆成目标明确、可独立验收的子任务，每个分身一条自包含 ' +
        'objective（含上下文、目标、验收标准）；子任务之间尽量无依赖，有依赖则先做前置。' +
        '【何时收敛】全部分身终态后调 converge_mission 合并产出；未全终态时 converge ' +
        '返回 busy，等待即可。派发后可用 list_workers 轮询进度、get_worker_result 读产出。' +
        '【预算提示】每个分身消耗真实 token 费用，控制数量（建议 ≤5）；' +
        '只有目标较大（小时级以上）或可并行的任务才值得派团队。' +
        '【定位】优先按当前会话上下文定位 mission（无则懒建）；' +
        'mission_id/workspace_id 可选，仅作显式越权校验锚。' +
        '响应 { id, status, lease_id, error_code }；error_code=no_online_daemon 表示 ' +
        'run 已建但无在线 daemon（稍后重试）。跨工作区派发用 target_workspace_id。',
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe(
            'Optional anchor workspace UUID (validation anchor only; ' +
              'mission is resolved from session context when omitted)',
          ),
        mission_id: z
          .string()
          .optional()
          .describe(
            'Optional mission UUID (validation anchor only; backend resolves the ' +
              'active mission for this session and lazy-creates when omitted)',
          ),
        objective: z.string().describe('Worker objective / task description'),
        role: z.string().optional().describe('Worker role (default: worker)'),
        agent_type: z.string().optional().describe('Agent type (default: claude_code)'),
        model: z.string().optional().describe('Model override'),
        read_only: z.boolean().optional().describe('Read-only worker (default: false)'),
        // 路径A（caller-worktree / external 模式）增量可选参，对齐 backend
        // DispatchWorkerRequest（design §7.3）。不传 → backend None → team 模式不变。
        worktree_path: z
          .string()
          .optional()
          .describe(
            'Path-A: caller-provided worktree absolute path. When set, backend ' +
              'skips git_worktree_add and uses it as worker root_path. ' +
              'Unset → backend self-creates worktree (team mode, no regression).',
          ),
        branch: z
          .string()
          .optional()
          .describe(
            'Path-A: caller worktree branch (e.g. sillyspec/<change>). Recorded as ' +
              'lease metadata only; path-A does NOT write run.worktree_branch. ' +
              'Unset → team mode unchanged.',
          ),
        worker_prompt: z
          .string()
          .optional()
          .describe(
            'Path-A: override the worker prompt. When set, fully replaces ' +
              'render_worker_prompt (caller injects no-commit / stay-in-allowedPaths ' +
              'instructions). Unset → backend renders default prompt.',
          ),
        // task-10：跨工作区派发目标工作区 ID（可选，缺省用主工作区）
        target_workspace_id: z
          .string()
          .optional()
          .describe(
            'Cross-workspace dispatch: target workspace UUID. When set, worker runs ' +
              'in the specified workspace; unset → defaults to anchor workspace (workspace_id). ' +
              'Requires anchor workspace to have binding with target workspace.',
          ),
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
            // 路径A 透传：undefined → hub-client 守卫不写入 body（零回归）。
            worktree_path: args.worktree_path,
            branch: args.branch,
            worker_prompt: args.worker_prompt,
            // task-10：跨工作区派发透传
            target_workspace_id: args.target_workspace_id,
          },
        );
        return okContent(result);
      } catch (e) {
        return errorContent('dispatch_worker', e);
      }
    },
  );

  // ── get_worker_result ────────────────────────────────────────────────────
  // task-10（审查 B1）：ws/mid 转可选（会话上下文定位），worker_id 仍必填。
  server.registerTool(
    'get_worker_result',
    {
      title: 'Get Worker Result',
      description:
        '读取单个分身 run 的结构化产出（artifacts：patch/summary 等）。' +
        'worker_id 必填（dispatch_worker 响应返回的 run id）。' +
        '优先按当前会话上下文定位 mission；mission_id/workspace_id 可选，仅作显式越权校验锚。' +
        '分身可能仍在运行（status 非 completed）——此时先等待或轮询 list_workers。',
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe('Optional anchor workspace UUID (validation anchor only)'),
        mission_id: z
          .string()
          .optional()
          .describe('Optional mission UUID (resolved from session context when omitted)'),
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
  // task-10（审查 B1）：ws/mid 转可选（会话上下文定位）。
  server.registerTool(
    'list_workers',
    {
      title: 'List Workers',
      description:
        '列出当前 mission 下全部分身 run 状态（含主控行，role=orchestrator）。' +
        '用于轮询分身进度：全部终态（completed/failed）后即可调 converge_mission 收敛。' +
        '优先按当前会话上下文定位 mission；mission_id/workspace_id 可选，仅作显式越权校验锚。',
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe('Optional anchor workspace UUID (validation anchor only)'),
        mission_id: z
          .string()
          .optional()
          .describe('Optional mission UUID (resolved from session context when omitted)'),
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
  // task-10（审查 B1 / D-010）：ws/mid 转可选；converge 按会话上下文解析 mission，
  // 分身未全终态时 backend 返回 status=busy（等待后重试），全终态置 converged。
  server.registerTool(
    'converge_mission',
    {
      title: 'Converge Mission',
      description:
        '收敛合并分身产出（patch 合并 + 汇总报告）。' +
        '【何时调用】list_workers 确认全部分身终态（completed/failed）后调用；' +
        '分身未全终态时返回 status=busy（mission 状态不变，等待后重试，不要放弃）。' +
        '响应 { mission_id, status, converged, artifact_id? }，status 含 ' +
        'converged/busy/conflict/needs_manual。' +
        '优先按当前会话上下文定位 mission；mission_id/workspace_id 可选，仅作显式越权校验锚。',
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe('Optional anchor workspace UUID (validation anchor only)'),
        mission_id: z
          .string()
          .optional()
          .describe('Optional mission UUID (resolved from session context when omitted)'),
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
  // task-10（审查 B1）：ws/mid/run_id 转可选——backend 按 X-Session-Id 解析活跃
  // mission 与主控 run；message 仍必填。
  server.registerTool(
    'report_progress',
    {
      title: 'Report Progress',
      description:
        '记录主控决策日志（审计轨迹，AgentRunLog channel=tool_call）。' +
        '每次关键决策（派发 / 判定 / 收敛）后调用，便于事后审计与用户回看。' +
        '优先按当前会话上下文定位 mission 与主控 run；mission_id/workspace_id/run_id ' +
        '可选，仅作显式越权校验锚。响应 { run_id, log_id }。',
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe('Optional anchor workspace UUID (validation anchor only)'),
        mission_id: z
          .string()
          .optional()
          .describe('Optional mission UUID (resolved from session context when omitted)'),
        run_id: z
          .string()
          .optional()
          .describe(
            'Optional main orchestrator AgentRun.id (log owner; resolved from ' +
              'session context when omitted)',
          ),
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
  // task-10（FR-04 / spike-01）：会话 id 缺失与 token 缺失同模式——仍启动，
  // 仅 warn（session-scoped mission 定位不可用，backend 走显式参数路径）。
  if (!env.sessionId) {
    console.error(
      '[mcp-server] MCP_SESSION_ID not set; session-scoped mission resolution unavailable (backend falls back to explicit params)',
    );
  }
  const auth: HubClientAuth = {
    ...(env.daemonApiKey ? { apiKey: env.daemonApiKey } : { token: env.daemonToken }),
    // task-10：sessionId → hub-client 给 MCP 5 端点附 X-Session-Id（缺失不附）。
    ...(env.sessionId ? { sessionId: env.sessionId } : {}),
  };
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
