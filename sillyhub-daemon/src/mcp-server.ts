/**
 * daemon 内置 stdio MCP server（task-05 / D-007@v2）。
 *
 * 主 agent（claude/codex）经 ``--mcp-config`` 注入本 server，tool_call 路由到
 * hub-client → backend mcp_tools.py 5 endpoint（派 worker / 读产出 / 列 worker /
 * 收敛 / 报进度）。
 *
 * task-05（2026-08-23-agent-file-upload-mcp / D-005@v1）：``MCP_TOOLSET`` 双模式——
 *   - ``orchestration``（缺省）：上述 5 编排工具，行为零变化（兼容约束）；
 *   - ``file``：仅注册 ``upload_file`` / ``list_uploaded_files``（D-003@v1），
 *     供会话主 agent / 批任务 worker 把工作目录内产物上传给用户。sillyhub-file
 *     server 条目由 mcp-config.ts ``buildFileMcpServerConfig`` 构造（env 注入
 *     MCP_TOOLSET=file + 上下文），会话注入归 task-06、worker 注入归 task-07。
 *
 * spike-01（spikes/06-mcp-server）验证了 stdio MCP server + 1 tool 的协议链路；
 * 本文件扩展到生产 5 tool，handler 调 HubClient 方法（非 spike 的直接 fetch），
 * 鉴权 / 非 2xx / snake_case body 全复用 hub-client 既有语义。
 *
 * 设计依据：
 *   - backend ``app/modules/agent/mcp_tools.py`` 5 endpoint 真实契约（task-03 建，
 *     task-09 P0 鉴权 gap 闭合：require_permission → get_current_principal 双路径
 *     鉴权 JWT + X-API-Key）
 *   - backend ``app/modules/agent/file_artifacts.py``（本变更 task-03）上传/列表
 *     端点契约（multipart file/description/run_id + X-Session-Id；GET 二选一 query）
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
 *   MCP_TOOLSET  工具集模式（task-05 本变更）：'file' = 仅文件 2 工具；
 *     未设 / 其它值 = orchestration（5 编排工具，缺省零回归）
 *   MCP_RUN_ID  worker run id（file 模式：批任务 worker 场景，上传时作 multipart
 *     run_id 字段、列表时作 run_id query；task-07 task-runner 注入）
 *   MCP_ALLOWED_ROOT  上传允许根目录（file 模式；会话=cwd、worker=worktree 根，
 *     注入方解析为绝对路径写入；**缺失拒绝一切上传**——R-01 fail-closed）
 *
 * @module mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HubClient, HubHttpError, type HubClientAuth } from './hub-client.js';

// ── 配置（env）─────────────────────────────────────────────────────────────

/**
 * daemon 内置 MCP server 对外名称。mcp-config.ts platform_default 用同名 key
 * 注册（``mergeMcpConfigs`` 平台默认 server 自动入白名单）。
 */
export const DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon';

/**
 * 文件 MCP server 对外名称（task-05 2026-08-23-agent-file-upload-mcp / D-005@v1）。
 * mcp-config.ts ``buildFileMcpServerConfig`` 用同名 key 构造 server 条目，
 * 调用方（task-06 会话注入 / task-07 worker 注入）并入 platform_default 即自动
 * 入 ``mergeMcpConfigs`` 白名单（与 DAEMON_MCP_SERVER_NAME 同惯例）。
 */
export const FILE_MCP_SERVER_NAME = 'sillyhub-file';

/** 工具集模式：orchestration（5 编排工具，缺省）| file（文件 2 工具）。 */
export type McpToolset = 'orchestration' | 'file';

interface McpServerEnv {
  backendUrl: string;
  daemonToken: string;
  daemonApiKey: string;
  /** task-10（2026-08-22-team-session-unify / FR-04）：主 agent 会话 id。 */
  sessionId: string;
  /** task-05（本变更）：工具集模式；仅 'file' 显式开启文件工具，其余归 orchestration。 */
  toolset: McpToolset;
  /** task-05（本变更）：worker run id（file 模式，MCP_RUN_ID 注入）。 */
  runId: string;
  /** task-05（本变更）：上传允许根目录（file 模式，MCP_ALLOWED_ROOT 注入；缺失拒一切）。 */
  allowedRoot: string;
}

/**
 * 从 process.env 读 backend URL + token + 会话 id。空值返回空串（不抛错，server
 * 仍启动，tool 调用时返回结构化错误便于诊断）。task-09 P0：apiKey 优先（X-API-Key
 * 路径，backend get_current_principal 解析 apiKey → User），token 回落（Bearer JWT）。
 * task-10：MCP_SESSION_ID 经 mcpServers['sillyhub-daemon'].env per-server 注入
 * （spike-01 验证管道：CLI spawn MCP 子进程时白名单 env + per-server env 合并）。
 * task-05（本变更）：MCP_TOOLSET 仅字面量 'file' 切文件模式（拼写错误容错回落
 * orchestration，不 crash）；MCP_RUN_ID / MCP_ALLOWED_ROOT 空值返回空串（file
 * 工具内 fail-closed 处理）。
 * 导出供单测断言注入链终点（session-manager → driver spawn → 本函数）。
 */
export function readEnv(): McpServerEnv {
  return {
    backendUrl: (process.env.MCP_SERVER_BACKEND_URL ?? '').replace(/\/+$/, ''),
    daemonApiKey: process.env.MCP_SERVER_DAEMON_API_KEY ?? '',
    daemonToken: process.env.MCP_SERVER_DAEMON_TOKEN ?? '',
    sessionId: process.env.MCP_SESSION_ID ?? '',
    toolset: process.env.MCP_TOOLSET === 'file' ? 'file' : 'orchestration',
    runId: process.env.MCP_RUN_ID ?? '',
    allowedRoot: process.env.MCP_ALLOWED_ROOT ?? '',
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

/**
 * file 工具集本地校验错误回执（task-05 2026-08-23-agent-file-upload-mcp）。
 *
 * 与 ``errorContent`` 同构（isError + JSON content），但 error 码是 design §7.1
 * 枚举的业务码（``path_out_of_root`` / ``file_not_found`` 等），供主 agent 区分
 * 「改路径重试可恢复」与「传输/后端失败」。非本地校验错误（backend 非 2xx /
 * 网络异常）仍走 ``errorContent``（http / network / internal）。
 */
function fileToolError(tool: string, code: string, message: string): ToolResult {
  return {
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify({ error: code, tool, message }) },
    ],
  };
}

// ── file 工具集：MIME 猜测（Node 20 无内建 mime db，小表覆盖常见产物）───────

/**
 * 扩展名 → MIME 小表（task-05）。图片类型影响前端卡片形态（图片内联缩略图，
 * design 目标 1），其余覆盖常见报告/数据导出产物；未知扩展名回落
 * ``application/octet-stream``（backend 同款兜底值）。
 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function guessMimeType(filename: string): string {
  return MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

// ── server 构造（导出供测试注入 mock hub-client）──────────────────────────────

/** file 工具集上下文（task-05：注入方经 per-server env 写入，runMcpServer 从 env 读）。 */
export interface FileToolsetContext {
  /** 会话场景：主 agent 会话 id（列表 query session_id）。 */
  sessionId?: string;
  /** worker 场景：run id（上传 multipart run_id 字段 / 列表 query run_id）。 */
  runId?: string;
  /** 上传允许根目录（缺失拒绝一切上传，R-01 fail-closed）。 */
  allowedRoot?: string;
}

/**
 * ``createMcpServer`` 选项（task-05 双模式）。全字段可选——旧调用
 * ``createMcpServer(client)`` 等价 ``{ toolset: 'orchestration' }``（5 编排
 * 工具，零回归）。
 */
export interface CreateMcpServerOptions extends FileToolsetContext {
  /** 工具集模式，缺省 'orchestration'；'file' = 仅文件 2 工具。 */
  toolset?: McpToolset;
}

/**
 * 构造 daemon MCP server 并注册工具（双模式，task-05）。
 *
 * - ``orchestration``（缺省）：5 编排工具（本方法内既有注册，行为零变化）；
 * - ``file``：仅 ``upload_file`` / ``list_uploaded_files``（D-003@v1），server
 *   名切换为 ``FILE_MCP_SERVER_NAME``（sillyhub-file，供客户端/日志识别）。
 *
 * @param client  HubClient 实例（测试可传 mock）；生产由 ``runMcpServer`` 用 env
 *   构造。tool handler 全部经此 client 调 backend。
 * @param opts    可选：toolset / sessionId / runId / allowedRoot（file 模式上下文，
 *   生产由 ``runMcpServer`` 从 env 读入注入；测试直接传）
 * @returns ``{ server, transport }``，调用方 ``await server.connect(transport)``
 *   启动。分离构造与连接便于测试断言 tool 注册（``listTools``）无需 stdio。
 */
export function createMcpServer(
  client: HubClient,
  opts: CreateMcpServerOptions = {},
): {
  server: McpServer;
} {
  const toolset: McpToolset = opts.toolset ?? 'orchestration';
  const server = new McpServer(
    {
      name: toolset === 'file' ? FILE_MCP_SERVER_NAME : DAEMON_MCP_SERVER_NAME,
      version: '0.1.0',
    },
    { capabilities: { tools: {} } },
  );

  if (toolset === 'file') {
    registerFileTools(server, client, {
      sessionId: opts.sessionId,
      runId: opts.runId,
      allowedRoot: opts.allowedRoot,
    });
    return { server };
  }

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
        '返回 busy，等待即可。【等待方式】派发完分身后直接结束本轮等待——全部分身完成时' +
        '平台会自动向本会话注入一条【系统通知·团队任务】唤醒你，届时再 list_workers ' +
        '核对、get_worker_result 读产出并收敛。不要在单轮内反复调 list_workers 轮询烧' +
        'token（每轮询问都是一次模型往返）。' +
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
        '读取单个分身 run 的结构化产出。worker_id 必填（dispatch_worker 响应返回的 run id）。' +
        '【产出双通道——向用户汇报时两条都要看】①artifacts[].kind=summary：分身收尾时写的' +
        '结论文本（通常含产出文件路径与 commit 号）；②文件通道：分身在隔离 worktree 分支' +
        '（workers/<run_id 前 8 位>）上的 git 提交——summary 里提到的文件（如 results.md）' +
        '就是它的产物，调 converge_mission 后平台自动把分支合并进工作区主分支。' +
        'artifacts 只有 summary 而没有独立的"文件条目"是正常的——文件产出在分支上，' +
        '不要因此向用户说"无文件产出"，按 summary 里写明的文件路径如实汇报即可。' +
        '优先按当前会话上下文定位 mission；mission_id/workspace_id 可选，仅作显式越权校验锚。' +
        '分身可能仍在运行（status 非 completed）——此时不要轮询等待：结束本轮，' +
        '等平台注入的【系统通知·团队任务】（全部分身完成时自动到达）后再来读。',
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
        '【使用时机】①派发前核对已有分身；②收到平台注入的【系统通知·团队任务】' +
        '（全部分身完成时自动唤醒）后核对明细并调 converge_mission 收敛。' +
        '不要在等待分身期间反复调用本工具轮询——结束本轮等系统通知即可。' +
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

  // ── mission_status ────────────────────────────────────────────────────────
  // task-11（2026-08-24-session-team-mission-context / FR-02 / D-005@v1）：第 6
  // 个常驻工具——只读查询当前会话团队任务状态。参数全可选（X-Session-Id 会话
  // 上下文定位，显式传参仅作越权校验锚，同 task-10 审查 B1 模式）。无活跃
  // mission 时 backend 200 active=false（D-012 不走 404），handler 不报错。
  server.registerTool(
    'mission_status',
    {
      title: 'Mission Status',
      description:
        '查询当前会话团队任务状态（只读，随时可调）。' +
        '【返回内容】mission 概要（objective/status/budget_usd）；派发范围工作区列表 ' +
        'scope_workspaces（每项含绑定机器名 daemon_name、在线状态 daemon_online、' +
        'git 模式 git_mode=git隔离|直通|未知）；分身列表 workers（role/status/' +
        'objective/费用）。' +
        '【何时使用】派团队前可先查 scope 与机器状态（确认目标工作区已绑机器且在线）；' +
        '无活跃任务返回 active=false，可先查再派；派发后与 list_workers 互补查看整体进展。' +
        '优先按当前会话上下文定位 mission；mission_id/workspace_id 可选，' +
        '仅作显式越权校验锚。',
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
        const result = await client.getMissionStatus(
          args.workspace_id,
          args.mission_id,
        );
        return okContent(result);
      } catch (e) {
        return errorContent('mission_status', e);
      }
    },
  );

  return { server };
}

// ── file 工具集注册（task-05 2026-08-23-agent-file-upload-mcp / D-003@v1）─────

/**
 * 注册 file 工具集 2 工具（仅 ``MCP_TOOLSET=file`` 模式调用）。
 *
 * 安全边界（design §7.1 / R-01）：
 *   - ``allowedRoot`` 缺失 → 拒绝一切上传（fail-closed，不降级放行）；
 *   - ``resolvePath(allowedRoot, path)`` 结果必须以 ``allowedRoot + 平台分隔符``
 *     为前缀——绝对路径与含 ``..`` 的逃逸经 resolve 归一后自然落根外，统一拒绝
 *     （``path_out_of_root``）；
 *   - 本地读文件后才经 hub-client multipart 直传（文件内容不经 agent 上下文）。
 */
function registerFileTools(
  server: McpServer,
  client: HubClient,
  ctx: FileToolsetContext,
): void {
  // ── upload_file ──────────────────────────────────────────────────────────
  server.registerTool(
    'upload_file',
    {
      title: 'Upload File',
      description:
        '把工作目录内的一个文件上传给用户（平台文件中心，聊天流/运行详情出现文件卡片）。' +
        '【何时使用】生成报告、图表、数据导出等用户需要的产物文件后调用。' +
        '【路径规则】path 必须是相对当前工作目录的路径；绝对路径或含 .. 越出工作目录的路径' +
        '会被拒绝（path_out_of_root），文件不存在返回 file_not_found。' +
        '【描述】description 一句话说明文件内容，展示在文件卡片上（可选）。' +
        '响应 { file_id, original_name, size, mime_type, description }。',
      inputSchema: {
        path: z
          .string()
          .describe(
            'File path relative to the working directory (absolute paths and ' +
              '".." escapes outside the allowed root are rejected)',
          ),
        description: z
          .string()
          .optional()
          .describe(
            'Optional one-line description shown on the file card (e.g. what the file contains)',
          ),
      },
    },
    async (args: { path: string; description?: string }) => {
      const tool = 'upload_file';
      // R-01 fail-closed：allowedRoot 缺失拒绝一切上传（空串/未注入同罪）。
      const root = (ctx.allowedRoot ?? '').trim();
      if (!root) {
        return fileToolError(
          tool,
          'path_out_of_root',
          'MCP_ALLOWED_ROOT is not set; all uploads are rejected (fail-closed)',
        );
      }
      // resolve + 平台分隔符前缀校验：绝对路径（resolve 直接采纳）与 .. 逃逸
      //（resolve 归一上跳）都落根外；根自身是目录，也必须带分隔符才视为根内。
      const resolvedRoot = resolvePath(root);
      const resolved = resolvePath(resolvedRoot, args.path);
      if (!resolved.startsWith(resolvedRoot + sep)) {
        return fileToolError(
          tool,
          'path_out_of_root',
          `path "${args.path}" resolves outside the allowed root`,
        );
      }
      // 本地读文件（内容不经 agent 对话上下文，daemon 直传 backend）。
      let data: Buffer;
      try {
        data = await readFile(resolved);
      } catch (e) {
        if ((e as { code?: unknown }).code === 'ENOENT') {
          return fileToolError(tool, 'file_not_found', `file not found: ${args.path}`);
        }
        return errorContent(tool, e);
      }
      try {
        const result = await client.uploadFileArtifact({
          filename: basename(resolved),
          data,
          mimeType: guessMimeType(resolved),
          description: args.description,
          // worker 场景经 env 注入 runId；会话场景空 → 不发 run_id 字段，
          // backend 走 X-Session-Id（hub-client auth.sessionId）。
          runId: ctx.runId || undefined,
        });
        return okContent(result);
      } catch (e) {
        return errorContent(tool, e);
      }
    },
  );

  // ── list_uploaded_files ──────────────────────────────────────────────────
  server.registerTool(
    'list_uploaded_files',
    {
      title: 'List Uploaded Files',
      description:
        '列出当前上下文（会话或批任务 run）已上传给用户的全部文件制品，按上传时间倒序。' +
        '用于确认此前 upload_file 的结果或向用户汇总已交付文件。' +
        '响应 { files: [{ file_id, original_name, size, mime_type, description, created_at }] }。',
      inputSchema: {},
    },
    async () => {
      const tool = 'list_uploaded_files';
      const sessionId = ctx.sessionId ?? '';
      const runId = ctx.runId ?? '';
      // 注入方（task-06 会话 / task-07 worker）必写其一；均缺 → 结构化错误
      //（不发无 query 的请求白吃 backend 422）。
      if (!sessionId && !runId) {
        return fileToolError(
          tool,
          'missing_context',
          'neither MCP_SESSION_ID nor MCP_RUN_ID is set; cannot resolve uploaded files owner',
        );
      }
      try {
        const result = await client.listFileArtifacts(
          sessionId ? { sessionId } : { runId },
        );
        return okContent(result);
      } catch (e) {
        return errorContent(tool, e);
      }
    },
  );
}

// ── 启动入口（生产：env 构造 HubClient + stdio transport）─────────────────────

/**
 * 启动 daemon MCP server（stdio transport）。
 *
 * 从 env 读 backend URL + token 构造 HubClient，按 ``MCP_TOOLSET`` 注册工具
 *（缺省 orchestration = 5 编排工具；file = 2 文件工具，task-05），连接
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
  // task-05（本变更）：双模式——env 全量透传（toolset + file 上下文），
  // 缺省 orchestration 与旧调用完全一致（零回归）。
  const { server } = createMcpServer(client, {
    toolset: env.toolset,
    sessionId: env.sessionId,
    runId: env.runId,
    allowedRoot: env.allowedRoot,
  });
  if (env.toolset === 'file' && !env.allowedRoot) {
    // R-01 fail-closed 提示：server 照常启动，upload_file 一律结构化报错。
    console.error(
      '[mcp-server] MCP_ALLOWED_ROOT not set; upload_file will reject all paths (fail-closed)',
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[mcp-server] ${env.toolset === 'file' ? FILE_MCP_SERVER_NAME : DAEMON_MCP_SERVER_NAME} MCP server started (stdio)`,
  );
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
