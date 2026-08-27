/**
 * mcp-config.ts —— MCP 三件套拉取 + 预净化 + 白名单过滤合并 + 内置 server 工厂。
 *
 * 真实链路（2026-08-26-workspace-mcp-edit 修正旧「未接线」宣称，规则 18）：
 *   1. 拉取：``fetchMcpBundle`` 一次调 ``GET /api/daemon/mcp/config?workspace_id=``
 *      取「平台默认 + 白名单 + 工作区配置」三件套（daemon token 认证）；全链路
 *      容错回落——platform → 本地 ``~/.sillyhub/daemon/mcp.json``、workspace →
 *      空配置、whitelist → []，任何失败仅 warn 不阻塞会话创建（R-03）。
 *   2. 预净化：workspace 配置中非 stdio server 剔除 + warn 不抛错（D-005@v2，
 *      防存量/手改 ``.mcp.json`` 含 sse/http 条目在会话创建路径抛错）。
 *   3. 合并注入：daemon.ts 会话创建路径按 workspaceId 预取 bundle 存会话级
 *      缓存，cli.ts ``mainAgentMcpConfigProvider`` 消费缓存，``mergeMcpConfigs``
 *      按 platform < workspace < 内置（sillyhub-daemon/sillyhub-file）优先级
 *      合并 + 白名单过滤后注入 spawn 的 claude（task-07 已接线）。
 *
 * 设计依据：2026-07-07-daemon-skill-execution design.md §5.3（MCP 配置注入）、
 * §7（接口定义）、D-003（平台+workspace 合并策略）；2026-08-26-workspace-mcp-edit
 * design.md §5 Wave2 / §7.3（fetchMcpBundle）、D-005@v2（非 stdio 预净化）。
 *
 * @module mcp-config
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonFromResponse } from './hub-client.js';

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  /**
   * MCP server 传输类型（D-017）。仅允许 'stdio'（防 SSE/HTTP SSRF）。
   * 缺省视为 'stdio'（向后兼容旧配置不含 type 字段）。
   * mergeMcpConfigs 校验：非 stdio 值抛错（安全边界，不静默跳过）。
   */
  type?: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface MergedMcpResult {
  config: McpConfig;
  rejected: string[]; // 被白名单剔除的 server 名
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type McpConfigLogger = (level: LogLevel, msg: string, data?: Record<string, unknown>) => void;

// ── 平台默认配置 ──────────────────────────────────────────────────────────────

/**
 * 平台默认 MCP 配置路径（admin 全局）。
 * ~/.sillyhub/daemon/mcp.json（所有 workspace 共享）。
 */
function platformMcpConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.sillyhub', 'daemon', 'mcp.json');
}

/**
 * 读取平台默认 MCP 配置（admin 全局）。文件不存在/解析失败 → 返回空配置。
 */
export async function loadPlatformMcpConfig(
  logger?: McpConfigLogger,
): Promise<McpConfig> {
  return loadMcpConfigFile(platformMcpConfigPath(), logger);
}

/**
 * task-07（2026-07-07-skills-mcp-management-ui / D-004）：从 backend 拉平台 MCP 配置。
 * 调 `GET /api/daemon/mcp/config`（daemon token 认证），返回 platform_default 的 mcpServers。
 * 网络/非 200/解析失败 → 返回 null（调用方回落本地文件 fallback）。
 *
 * @param serverUrl  backend 根 URL
 * @param token      daemon Bearer token（与 lease/heartbeat 同源）
 */
export async function fetchPlatformMcpConfig(
  serverUrl: string,
  token: string | null,
  logger?: McpConfigLogger,
): Promise<McpConfig | null> {
  const url = `${serverUrl.replace(/\/$/, '')}/api/daemon/mcp/config`;
  try {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      logger?.('warn', 'mcp_config_fetch_failed', { url, status: resp.status });
      return null;
    }
    const body = await parseJsonFromResponse<{
      platform_default?: { mcpServers?: Record<string, unknown> };
    }>(resp);
    const mcpServers = (body.platform_default?.mcpServers ?? {}) as Record<string, McpServerConfig>;
    return { mcpServers };
  } catch (e) {
    logger?.('warn', 'mcp_config_fetch_unreachable', { url, error: String(e) });
    return null;
  }
}

/**
 * task-07：加载平台 MCP 配置——先尝试 backend 拉（最新，admin UI 配置源），
 * 失败回落本地文件 `~/.sillyhub/daemon/mcp.json`（offline / 旧 backend 兼容）。
 */
export async function loadPlatformMcpConfigFromBackend(
  serverUrl: string,
  token: string | null,
  logger?: McpConfigLogger,
): Promise<McpConfig> {
  const fetched = await fetchPlatformMcpConfig(serverUrl, token, logger);
  if (fetched !== null) {
    logger?.('debug', 'mcp_config_loaded_from_backend');
    return fetched;
  }
  logger?.('debug', 'mcp_config_fallback_local_file');
  return loadPlatformMcpConfig(logger);
}

async function loadMcpConfigFile(path: string, logger?: McpConfigLogger): Promise<McpConfig> {
  try {
    const text = await readFile(path, 'utf-8');
    const parsed = JSON.parse(text) as Partial<McpConfig>;
    const mcpServers = parsed.mcpServers ?? {};
    return { mcpServers };
  } catch {
    // 文件不存在或解析失败 → 空配置（不报错）
    logger?.('debug', 'mcp_config_load_skipped', { path });
    return { mcpServers: {} };
  }
}

// ── 三件套拉取（2026-08-26-workspace-mcp-edit task-05）───────────────────────

/**
 * MCP「三件套」bundle（design §7.3）：一次拉取的完整 MCP 配置视图。
 *
 * daemon.ts 会话创建路径按 workspaceId 预取存会话级缓存、cli.ts provider
 * 消费（task-07 接线）；quick-chat/legacy shared 无 workspaceId → workspace
 * 为空配置（D-007@v2/D-008@v1）。
 */
export interface McpBundle {
  /** 平台默认（admin 全局）；拉取失败回落本地 ~/.sillyhub/daemon/mcp.json。 */
  platform: McpConfig;
  /** admin 白名单（设置 → MCP）；失败回落 []。 */
  whitelist: string[];
  /** 工作区配置（specDir/.mcp.json 明文真值，不脱敏——注入需 env 真值）；失败/
   *  缺省回落 {mcpServers:{}}；产出前已经预净化（非 stdio 条目剔除，D-005@v2）。 */
  workspace: McpConfig;
}

/**
 * task-05（2026-08-26-workspace-mcp-edit / design §5 Wave2 第 4 条 / §7.3）：
 * 一次拉取「平台默认 + 白名单 + 工作区配置」三件套。
 *
 * 复用 ``fetchPlatformMcpConfig`` 的 fetch 范式（同 base url 拼接
 * ``/api/daemon/mcp/config``、同 Bearer 头）；workspaceId 有值时带 query 参数
 * （backend 响应追加 workspace 键，task-03），缺省（undefined/null/空串）不带——
 * quick-chat/legacy shared 场景 workspace 维度自然为空（D-008@v1）。
 *
 * 预净化（D-005@v2，Grill CC-03）：``workspace.mcpServers`` 中 type 非
 * undefined 且非 'stdio'（sse/http 等）的条目剔除 + logger warn（事件
 * ``mcp_server_prepurged_non_stdio``，带 server 名），**不抛错**——防存量/
 * 手改 .mcp.json 含非 stdio 条目时 ``assertMcpServerType`` 在会话创建路径抛错
 * 阻塞（R-03）。type 缺省视为 stdio 保留（与 ``assertMcpServerType`` 向后
 * 兼容口径一致）。
 *
 * 回落链（R-03：任何失败不阻塞会话创建，仅 warn）：fetch 失败 / 非 200 /
 * 解析失败 / 响应缺 platform_default|whitelist 键 → platform 回落本地
 * ``~/.sillyhub/daemon/mcp.json``（``loadPlatformMcpConfig``）、whitelist=[]
 * 、workspace={mcpServers:{}}。响应仅缺 workspace 键（旧 backend，R-07）→
 * 只 workspace 维度回落空配置，platform/whitelist 照常用。
 *
 * @param serverUrl   backend 根 URL
 * @param token       daemon Bearer token（与 lease/heartbeat 同源）
 * @param workspaceId 可选工作区 UUID；缺省不带 query 参数
 * @param logger      可选结构化日志（事件名蛇形）
 */
export async function fetchMcpBundle(
  serverUrl: string,
  token: string | null,
  workspaceId?: string,
  logger?: McpConfigLogger,
  apiKey?: string,
): Promise<McpBundle> {
  const base = serverUrl.replace(/\/$/, '');
  const url = workspaceId
    ? `${base}/api/daemon/mcp/config?workspace_id=${encodeURIComponent(workspaceId)}`
    : `${base}/api/daemon/mcp/config`;
  try {
    const headers: Record<string, string> = {};
    // task-09 / D-004@v2：daemon 鉴权优先级对齐 hub-client._headers()——
    // apiKey（X-API-Key，长期凭证）优先于 token（Authorization: Bearer，JWT）。
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      logger?.('warn', 'mcp_bundle_fetch_failed', { url, status: resp.status });
      return fallbackMcpBundle(logger);
    }
    const body = await parseJsonFromResponse<{
      platform_default?: { mcpServers?: Record<string, unknown> };
      whitelist?: unknown;
      workspace?: { mcpServers?: Record<string, unknown> };
    }>(resp);
    // 响应缺键（非预期结构）→ 整体回落（platform → 本地文件）。
    if (body.platform_default === undefined || !Array.isArray(body.whitelist)) {
      logger?.('warn', 'mcp_bundle_response_invalid', { url });
      return fallbackMcpBundle(logger);
    }
    const platformServers = (body.platform_default.mcpServers ?? {}) as Record<
      string,
      McpServerConfig
    >;
    const whitelist = body.whitelist.filter((x): x is string => typeof x === 'string');
    // 缺 workspace 键（旧 backend，R-07）→ 空配置；有则取 mcpServers（子键缺容错 {}）。
    const workspaceServers = (body.workspace?.mcpServers ?? {}) as Record<
      string,
      McpServerConfig
    >;
    return {
      platform: { mcpServers: platformServers },
      whitelist,
      workspace: { mcpServers: prepurgeNonStdioServers(workspaceServers, logger) },
    };
  } catch (e) {
    logger?.('warn', 'mcp_bundle_fetch_unreachable', { url, error: String(e) });
    return fallbackMcpBundle(logger);
  }
}

/**
 * 三件套回落 bundle（R-03）：platform 走本地文件，其余维度空值。
 * ``loadPlatformMcpConfig`` 对文件不存在/解析失败也返回空配置，故本函数永不抛。
 */
async function fallbackMcpBundle(logger?: McpConfigLogger): Promise<McpBundle> {
  logger?.('debug', 'mcp_bundle_fallback_local');
  return {
    platform: await loadPlatformMcpConfig(logger),
    whitelist: [],
    workspace: { mcpServers: {} },
  };
}

/**
 * workspace 配置预净化（D-005@v2）：type 非 undefined 且非 'stdio' 的条目剔除
 * + warn（事件 ``mcp_server_prepurged_non_stdio``，带 server 名）；type 缺省视为
 * stdio 保留。返回新对象（不改入参）；**永不抛错**（会话创建路径安全，R-03）。
 */
function prepurgeNonStdioServers(
  servers: Record<string, McpServerConfig>,
  logger?: McpConfigLogger,
): Record<string, McpServerConfig> {
  const kept: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const t = cfg?.type;
    if (t !== undefined && t !== 'stdio') {
      logger?.('warn', 'mcp_server_prepurged_non_stdio', {
        server: name,
        type: String(t),
      });
      continue;
    }
    kept[name] = cfg;
  }
  return kept;
}

// ── 白名单过滤 ────────────────────────────────────────────────────────────────

/**
 * 按白名单过滤 MCP servers。非白名单 server 被剔除并记 warn 日志（不静默，不崩）。
 */
export function validateMcpServers(
  mcpServers: Record<string, McpServerConfig>,
  whitelist: string[],
  logger?: McpConfigLogger,
): { validated: Record<string, McpServerConfig>; rejected: string[] } {
  const allowSet = new Set(whitelist);
  const validated: Record<string, McpServerConfig> = {};
  const rejected: string[] = [];
  for (const [name, cfg] of Object.entries(mcpServers)) {
    if (allowSet.has(name)) {
      validated[name] = cfg;
    } else {
      rejected.push(name);
      logger?.('warn', 'mcp_server_rejected_by_whitelist', { server: name });
    }
  }
  return { validated, rejected };
}

// ── 合并 ──────────────────────────────────────────────────────────────────────

/**
 * 校验 MCP server 传输类型仅 stdio（D-017：防 SSE/HTTP SSRF）。
 * type 缺省视为 'stdio'（向后兼容旧配置不含 type 字段）。非 stdio 抛错
 * （安全边界：配置错误或攻击注入 SSE/HTTP server 时 fail-loud，不静默跳过）。
 */
function assertMcpServerType(name: string, cfg: McpServerConfig): void {
  const t = cfg.type ?? 'stdio';
  if (t !== 'stdio') {
    throw new Error(
      `MCP server "${name}" has unsupported type "${t}": only "stdio" is allowed (D-017, SSRF prevention)`,
    );
  }
}

/**
 * 合并多个 MCP 配置（D-003 + D-017 task-08 第三层过滤）：
 *   1. 传入顺序为优先级从低到高（如 [platform, workspace]）。
 *   2. 同名 server 以后续配置覆盖前面。
 *   3. 所有 server（含 platform 默认）均需通过白名单。
 *   4. 平台默认 server 自动加入白名单（隐式允许）。
 *   5. task-08/D-017：McpServerConfig.type 仅允许 'stdio'（防 SSE/HTTP SSRF），非 stdio 抛错。
 *   6. task-08/D-017：若提供 mcp_refs（profile 子集），merge 结果再 ∩ mcp_refs。
 *
 * **向后兼容**：旧调用 `mergeMcpConfigs(whitelist, ...configs)` 不传 mcp_refs，
 * 等价不过滤（行为同 task-08 前）。cli.ts ``workerMcpConfigProvider`` 的
 * `mergeMcpConfigs([], { mcpServers })` 不需改动（主控 provider 的调用形自
 * 2026-08-26-workspace-mcp-edit task-07 起升格为三件套 + 内置名显式入白名单）。
 *
 * @param whitelist admin 配置的白名单 server 名列表。
 * @param configs   MCP 配置列表，按优先级从低到高（mergeMcpConfigs(wl, platform, workspace)）。
 */
export function mergeMcpConfigs(
  whitelist: string[],
  ...configs: McpConfig[]
): MergedMcpResult;
/**
 * task-08（D-017）：带 mcp_refs 子集过滤的合并。
 *
 * @param mcpRefs  profile 限定的 MCP server name 子集；空数组/undefined 则不过滤
 *                 （向后兼容，等价于不收紧）。非空时 merge 结果 ∩ mcp_refs。
 * @param configs  MCP 配置列表，按优先级从低到高。
 */
export function mergeMcpConfigs(
  whitelist: string[],
  mcpRefs: string[],
  ...configs: McpConfig[]
): MergedMcpResult;
export function mergeMcpConfigs(
  whitelist: string[],
  mcpRefsOrFirstConfig?: string[] | McpConfig,
  ...restConfigs: McpConfig[]
): MergedMcpResult {
  // 区分旧式调用 (whitelist, ...configs) 与新式调用 (whitelist, mcpRefs, ...configs)。
  // string[]（Array.isArray）= mcp_refs；McpConfig 对象 = 旧式首个 config。
  let mcpRefs: string[] | undefined;
  let configs: McpConfig[];
  if (mcpRefsOrFirstConfig === undefined) {
    // mergeMcpConfigs(whitelist) — 无 config（等价旧 mergeMcpConfigs([])）
    configs = [];
  } else if (Array.isArray(mcpRefsOrFirstConfig)) {
    // 第二参数是 string[] → mcp_refs（task-08 新式调用）
    mcpRefs = mcpRefsOrFirstConfig;
    configs = restConfigs;
  } else {
    // 第二参数是 McpConfig → 旧式调用（不传 mcp_refs，行为不变）
    configs = [mcpRefsOrFirstConfig, ...restConfigs];
  }

  // 步骤 1：合并所有配置（浅合并，同名 server 后者覆盖前者）+ type 校验（D-017）
  const raw: Record<string, McpServerConfig> = {};
  for (const cfg of configs) {
    for (const [name, serverCfg] of Object.entries(cfg.mcpServers)) {
      assertMcpServerType(name, serverCfg);
      raw[name] = serverCfg;
    }
  }

  // 步骤 2：构造白名单（平台默认 server 自动加入）
  const platformConfig = configs[0];
  const platformServers = platformConfig ? platformConfig.mcpServers : {};
  const autoAllowed = new Set(Object.keys(platformServers));
  const combinedWhitelist = new Set<string>(whitelist);
  for (const name of autoAllowed) {
    combinedWhitelist.add(name);
  }

  // 步骤 3：白名单过滤
  const rejected: string[] = [];
  const validated: Record<string, McpServerConfig> = {};
  for (const [name, serverCfg] of Object.entries(raw)) {
    if (combinedWhitelist.has(name)) {
      validated[name] = serverCfg;
    } else {
      rejected.push(name);
    }
  }

  // 步骤 4（task-08/D-017）：mcp_refs 子集过滤（profile 限定，只能收紧）
  // mcp_refs 为空/undefined → 不过滤（向后兼容）；非空 → 已过白名单结果再 ∩ mcp_refs。
  // 设计依据 design §9：profile.mcp_refs 经 claim payload 透传，daemon 端第三层过滤。
  let final = validated;
  if (mcpRefs && mcpRefs.length > 0) {
    const refsSet = new Set(mcpRefs);
    final = {};
    for (const [name, serverCfg] of Object.entries(validated)) {
      if (refsSet.has(name)) {
        final[name] = serverCfg;
      } else {
        rejected.push(name);
      }
    }
  }

  return { config: { mcpServers: final }, rejected };
}

// ── 注入 ──────────────────────────────────────────────────────────────────────

/**
 * 快速判断是否有任何 MCP server（决定是否需要注入）。
 */
export function hasAnyMcpServers(...configs: McpConfig[]): boolean {
  return configs.some((c) => Object.keys(c.mcpServers).length > 0);
}

// ── task-05 / D-007@v2：daemon 内置 MCP server 配置工厂 ────────────────────────

/**
 * daemon 内置 MCP server 对外名称（与 ``src/mcp-server.ts`` ``DAEMON_MCP_SERVER_NAME``
 * 对齐）。
 *
 * 白名单口径（task-07 / 2026-08-26-workspace-mcp-edit 起的会话注入链）：cli.ts
 * ``mainAgentMcpConfigProvider`` 把内置 server 放**最后一个** config 位（优先级
 * 最高防覆盖，D-006@v2），``mergeMcpConfigs`` 的 configs[0]（platform 位）自动
 * 加白覆盖不到 → 调用方必须把本名字**显式并入白名单参数**（D-006@v2 / Grill
 * CC-02，漏并会把内置剔除、破坏注入链）。旧「并入 platform_config 即隐式允许」
 * 惯例仅剩历史参考。
 */
export const DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon';

/**
 * task-05（2026-08-23-agent-file-upload-mcp / D-005@v1）：文件 MCP server 对外
 * 名称（与 ``src/mcp-server.ts`` ``FILE_MCP_SERVER_NAME`` 对齐）。
 *
 * 白名单口径按链路二分（task-07 / 2026-08-26-workspace-mcp-edit 起修正旧宣称）：
 *   - 会话注入（cli.ts ``mainAgentMcpConfigProvider``）：与 DAEMON_MCP_SERVER_NAME
 *     同位——内置放最后一个 config 位，名字**显式并入白名单参数**（D-006@v2）；
 *   - worker .mcp.json（task-runner ``_writeFileMcpTmpConfig``）：直接写文件
 *     （``--mcp-config``，不走 ``mergeMcpConfigs``），无白名单环节。
 */
export const FILE_MCP_SERVER_NAME = 'sillyhub-file';

/**
 * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design §5.C.1）：
 * 分身受限 MCP server 对外名称（与 ``src/mcp-server.ts`` ``WORKER_MCP_SERVER_NAME``
 * 对齐）。白名单口径：cli.ts ``workerMcpConfigProvider`` 调
 * ``mergeMcpConfigs([], { mcpServers: { [本名]: ... } })``——worker server 即
 * configs[0]（platform 位），走既有自动入白名单路径（与主控内置的显式白名单
 * 参数不同形，两者语义等价）。
 */
export const WORKER_MCP_SERVER_NAME = 'sillyhub-worker';

/**
 * task-05（2026-08-26-team-subsession-recursion / FR-04 / D-002@v1，design §5.C）：
 * daemon 侧最大派发深度——分身工具集两档分层依据。
 *
 * **单源口径（与 backend 同值，改值必须两侧同步防漂移）**：backend
 * ``app/modules/agent/mcp_tools.py`` ``MAX_DISPATCH_DEPTH``（task-02 定义，
 * ``_dispatch_worker_core`` 派发门 O(1) 拒绝超深）与本常量各守一端——backend
 * 拦「派得出但超深」的增量请求，daemon 拦「叶分身物理拿不到 dispatch_worker」
 * 的工具面（双保险，design §7 递归风暴缓解行）。
 *
 * 语义：``worker_depth < MAX_DISPATCH_DEPTH`` → 非叶分身（1 层，可派孙层，
 * 派工集 5 件）；``worker_depth >= MAX_DISPATCH_DEPTH`` → 叶（2 层孙，仅
 * worker_done）。总深 3 层（主控 0 / 分身 1 / 孙 2，D-001@v1）。
 */
export const MAX_DISPATCH_DEPTH = 2;

/**
 * task-05（本卡）：分身深度 per-server env 键名（单一来源，mcp-config 写侧
 * ``buildWorkerMcpServerConfig`` 与 mcp-server ``readEnv`` 读侧共用，对齐
 * ``MCP_SESSION_ID_ENV`` 惯例）。**undefined 不写键 = 叶档兜底**（旧 lease 无
 * worker_depth 宁少勿多，design §7 风险表）。
 */
export const MCP_WORKER_DEPTH_ENV = 'MCP_WORKER_DEPTH';

/**
 * task-05（本卡）：归一化分身深度——非负整数原样返回；undefined / 非整数 /
 * 负数 / 空串 / 非数字字符串一律 ``undefined``（= 叶档兜底，宁少勿多）。
 *
 * 写侧（builder 收 ``ctx.workerDepth``）与读侧（mcp-server ``readEnv`` 解
 * ``MCP_WORKER_DEPTH`` env 字符串）共用同一口径，防「写侧放行读侧拒绝」漂移。
 */
export function normalizeWorkerDepth(raw: unknown): number | undefined {
  const n =
    typeof raw === 'string'
      ? raw.trim() === ''
        ? Number.NaN
        : Number(raw)
      : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * task-05（本卡）：非叶分身判定——深度有效且 ``< MAX_DISPATCH_DEPTH``（design
 * §5.C 两档分层）。``depth`` 应先经 ``normalizeWorkerDepth`` 归一（本函数只做
 * 档位比较，重复防御 ``>= 0`` 以容直接传入裸值）。
 */
export function isNonLeafWorkerDepth(depth: number | undefined): boolean {
  return depth !== undefined && depth >= 0 && depth < MAX_DISPATCH_DEPTH;
}

/**
 * task-05（本变更）：file 模式三个 per-server env 键名（mcp-config 写侧与
 * mcp-server ``readEnv`` 读侧共用的单一来源；对齐 ``MCP_SESSION_ID_ENV`` 惯例）。
 * MCP 子进程只继承白名单 env + per-server env（spike-01 结论），上下文必须走
 * ``mcpServers[FILE_MCP_SERVER_NAME].env``。
 */
export const MCP_TOOLSET_ENV = 'MCP_TOOLSET';
export const MCP_RUN_ID_ENV = 'MCP_RUN_ID';
export const MCP_ALLOWED_ROOT_ENV = 'MCP_ALLOWED_ROOT';

/**
 * task-10（2026-08-22-team-session-unify / FR-04 / spike-01）：MCP server 子进程
 * 读会话 id 的 env 键名（单一来源，mcp-config 写侧与 mcp-server 读侧共用）。
 *
 * spike-01 结论：MCP server 子进程**不继承** claude.exe 完整环境，只继承白名单
 * （PATH/HOME 等 12 个）+ per-server env——会话 id 必须写进
 * ``mcpServers['sillyhub-daemon'].env``（本模块构造/补写），放 SDK 顶层
 * ``options.env`` 无效。
 */
export const MCP_SESSION_ID_ENV = 'MCP_SESSION_ID';

/**
 * 构造 daemon 内置 MCP server 的 ``McpServerConfig``（task-05）。
 *
 * 主 agent spawn 时，调用方把本配置并入 platform_default（``mergeMcpConfigs(wl,
 * { mcpServers: { [DAEMON_MCP_SERVER_NAME]: buildDaemonMcpServerConfig(...) } },
 * workspaceCfg)``），经 ``injectMcpConfig`` 写临时 ``.mcp.json`` 供 ``--mcp-config``。
 *
 * server 命令：``node <dist/mcp-server.js 绝对路径>``。
 *   - daemon ``engines.node>=20``，Node 20 不支持原生 TS，必须用 tsc 编译产物
 *     （spike-01 用 .ts 直跑仅限 Node v24+，生产不兼容）
 *   - 编译产物路径用 ``import.meta.url`` 推导（本文件与 mcp-server.ts 同在 src/，
 *     编译后同在 dist/，相对位置稳定），跨平台绝对路径
 *
 * env：
 *   - ``MCP_SERVER_BACKEND_URL`` = 传入 backendUrl（daemon config 的 serverUrl）
 *   - ``MCP_SERVER_DAEMON_API_KEY`` = 传入 apiKey（task-09 P0：daemon 长期 apiKey，
 *     X-API-Key 路径，backend get_current_principal 解析 apiKey → User。优先于 token）
 *   - ``MCP_SERVER_DAEMON_TOKEN`` = 传入 token（回落；apiKey 缺失时 Bearer JWT）
 *   - ``MCP_SESSION_ID`` = 传入 sessionId（task-10：主 agent 会话 id，mcp-server
 *     读后经 hub-client 附 X-Session-Id 请求头；缺省不写键——旧调用零回归）
 *
 * **token 注入时机**：本函数只构造静态配置，token/apiKey 由调用方在 spawn 主 agent
 * 前从 daemon config 取传入。空值仍构造配置（server 启动后 tool 调用返回结构化错误，
 * 便于诊断）——与 mcp-server.ts ``runMcpServer`` 容错一致。
 *
 * @param backendUrl  backend 根 URL（如 http://localhost:8000）
 * @param token       daemon Bearer token（回落，apiKey 缺失时用）
 * @param serverModulePath  可选，覆盖默认编译产物路径（测试用，避免依赖 dist/）
 * @param apiKey      可选，daemon 长期 API Key（task-09 P0，优先于 token）
 * @param sessionId   可选，主 agent 会话 id（task-10，写 env MCP_SESSION_ID）
 */
export function buildDaemonMcpServerConfig(
  backendUrl: string,
  token: string,
  serverModulePath?: string,
  apiKey?: string,
  sessionId?: string,
): McpServerConfig {
  const args = [serverModulePath ?? defaultMcpServerModulePath()];
  const env: Record<string, string> = {
    MCP_SERVER_BACKEND_URL: backendUrl.replace(/\/+$/, ''),
    MCP_SERVER_DAEMON_TOKEN: token,
  };
  // task-09 P0：apiKey 独立 env，mcp-server.ts 优先 X-API-Key 路径。
  if (apiKey) {
    env.MCP_SERVER_DAEMON_API_KEY = apiKey;
  }
  // task-10：会话上下文 env（spike-01 验证的 per-server env 注入管道）。
  // 空串/undefined 不写键（守卫风格，旧调用零回归）。
  if (sessionId) {
    env[MCP_SESSION_ID_ENV] = sessionId;
  }
  return {
    command: 'node',
    args,
    env,
  };
}

// ── task-05（2026-08-23-agent-file-upload-mcp）：sillyhub-file server 工厂 ────

/** daemon → backend 凭证（task-05：``buildFileMcpServerConfig`` 入参形态）。 */
export interface DaemonMcpAuth {
  /** daemon Bearer token（回落凭证，apiKey 缺失时用）。 */
  token?: string;
  /** daemon 长期 API Key（X-API-Key 路径，优先于 token；task-09 P0 口径）。 */
  apiKey?: string;
}

/** sillyhub-file server 上下文（design §6：注入方按场景二选一写 env）。 */
export interface FileMcpServerContext {
  /** 会话场景：主 agent 会话 id（→ env MCP_SESSION_ID；task-06 session-manager 补写）。 */
  sessionId?: string;
  /** worker 场景：run id（→ env MCP_RUN_ID；task-07 task-runner 注入）。 */
  runId?: string;
  /** 上传允许根（→ env MCP_ALLOWED_ROOT；会话=cwd、worker=worktree 根，写入前
   *  resolve 成绝对路径；缺失 → mcp-server fail-closed 拒绝一切上传）。 */
  allowedRoot?: string;
}

/**
 * task-05（2026-08-23-agent-file-upload-mcp / design §6）：构造 sillyhub-file
 * MCP server 条目（``mcpServers[FILE_MCP_SERVER_NAME]`` 值）。
 *
 * 与 ``buildDaemonMcpServerConfig`` 共用 ``node dist/mcp-server.js`` 入口与
 * 鉴权 env（MCP_SERVER_BACKEND_URL / MCP_SERVER_DAEMON_API_KEY /
 * MCP_SERVER_DAEMON_TOKEN），差异仅三处：
 *   - ``MCP_TOOLSET=file``（mcp-server readEnv 切文件 2 工具模式）；
 *   - 上下文 env：sessionId（可选）/ runId（可选）/ allowedRoot（resolve 绝对
 *     路径后写入，mcp-server 前缀校验的基准）；
 *   - 调用方把本条目并入 platform_default（首个配置）即自动入
 *     ``mergeMcpConfigs`` 白名单（同 DAEMON_MCP_SERVER_NAME 惯例）。
 *
 * 空凭证仍构造配置（server 启动后 tool 调用返回结构化错误便于诊断，与
 * buildDaemonMcpServerConfig 容错一致）；sessionId/runId/allowedRoot 空值不写
 * 键（守卫风格，旧调用零回归）。
 *
 * @param backendUrl        backend 根 URL（如 http://localhost:8000）
 * @param auth              daemon 凭证（apiKey 优先 / token 回落）
 * @param ctx               可选上下文（sessionId / runId / allowedRoot）
 * @param serverModulePath  可选，覆盖默认 ``dist/mcp-server.js`` 编译产物路径（测试用）
 */
export function buildFileMcpServerConfig(
  backendUrl: string,
  auth: DaemonMcpAuth,
  ctx: FileMcpServerContext = {},
  serverModulePath?: string,
): McpServerConfig {
  const env: Record<string, string> = {
    MCP_SERVER_BACKEND_URL: backendUrl.replace(/\/+$/, ''),
    [MCP_TOOLSET_ENV]: 'file',
  };
  if (auth.token) {
    env.MCP_SERVER_DAEMON_TOKEN = auth.token;
  }
  // task-09 P0：apiKey 独立 env，mcp-server.ts 优先 X-API-Key 路径。
  if (auth.apiKey) {
    env.MCP_SERVER_DAEMON_API_KEY = auth.apiKey;
  }
  if (ctx.sessionId) {
    env[MCP_SESSION_ID_ENV] = ctx.sessionId;
  }
  if (ctx.runId) {
    env[MCP_RUN_ID_ENV] = ctx.runId;
  }
  // allowedRoot 归一为绝对路径再写入（相对路径会让 mcp-server 的
  // resolve+前缀校验基准漂移到 MCP 子进程 cwd，跨平台不稳定）。
  if (ctx.allowedRoot) {
    env[MCP_ALLOWED_ROOT_ENV] = resolve(ctx.allowedRoot);
  }
  return {
    command: 'node',
    args: [serverModulePath ?? defaultMcpServerModulePath()],
    env,
  };
}

// ── task-06（2026-08-25-team-subsession-governance）：分身受限 server 工厂 ────

/**
 * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design §5.C.1）：
 * 构造分身受限 MCP server 条目（``mcpServers[WORKER_MCP_SERVER_NAME]`` 值）。
 *
 * 与 ``buildDaemonMcpServerConfig`` 共用 ``node dist/mcp-server.js`` 入口与鉴权链
 * （MCP_SERVER_BACKEND_URL / MCP_SERVER_DAEMON_API_KEY 优先 / MCP_SERVER_DAEMON_TOKEN
 * 回落，task-09 P0 口径），差异：
 *   - ``MCP_TOOLSET=mission_worker``——mcp-server ``readEnv`` 切受限模式；task-05
 *     （2026-08-26-team-subsession-recursion / D-002@v1，design §5.C）起按深度两档：
 *     非叶（depth < MAX_DISPATCH_DEPTH）注册派工集 5 件，叶（depth 达上限或无键）
 *     仅 ``worker_done``（P1 形态）；
 *   - 供 cli.ts ``workerMcpConfigProvider`` 组装，session-manager 分身分支
 *     （stage=mission_worker）注入 create / restore / reload 三路；
 *   - 会话 id（可选 ctx.sessionId）经 per-server env 写 MCP_SESSION_ID——生产链路
 *     由 session-manager ``injectMcpSessionId(config, sessionId, WORKER_MCP_SERVER_NAME)``
 *     统一补写（provider 不拼，闭包配置不被污染），本参数留给非注入链路（如测试）。
 *   - 分身深度（可选 ctx.workerDepth，task-05 本卡）经 per-server env 写
 *     MCP_WORKER_DEPTH——cli.ts provider 从 ``ctx.worker_depth``（task-04 链路，
 *     lease.metadata.worker_depth → claim payload → daemon → snapshot 保档）透传；
 *     **非负整数才写键，undefined / 非法值不写键 = 叶档兜底**（旧 lease 宁少勿多）。
 *
 * 空凭证仍构造配置（server 启动后 tool 调用返回结构化错误便于诊断，与
 * buildDaemonMcpServerConfig 容错一致）；sessionId/workerDepth 非法或缺省不写键
 * （守卫风格）。
 *
 * @param backendUrl        backend 根 URL（如 http://localhost:8000）
 * @param auth              daemon 凭证（apiKey 优先 / token 回落）
 * @param ctx               可选上下文（sessionId / workerDepth；生产注入链路缺省不传 sessionId）
 * @param serverModulePath  可选，覆盖默认 ``dist/mcp-server.js`` 编译产物路径（测试用）
 */
export function buildWorkerMcpServerConfig(
  backendUrl: string,
  auth: DaemonMcpAuth,
  ctx: { sessionId?: string; workerDepth?: number } = {},
  serverModulePath?: string,
): McpServerConfig {
  const env: Record<string, string> = {
    MCP_SERVER_BACKEND_URL: backendUrl.replace(/\/+$/, ''),
    [MCP_TOOLSET_ENV]: 'mission_worker',
  };
  if (auth.token) {
    env.MCP_SERVER_DAEMON_TOKEN = auth.token;
  }
  // 鉴权链同 buildDaemonMcpServerConfig：apiKey（X-API-Key）优先，token 回落。
  if (auth.apiKey) {
    env.MCP_SERVER_DAEMON_API_KEY = auth.apiKey;
  }
  if (ctx.sessionId) {
    env[MCP_SESSION_ID_ENV] = ctx.sessionId;
  }
  // task-05（本卡）：分身深度 env——normalizeWorkerDepth 非负整数才写键；
  // undefined 不写键 = mcp-server 侧叶档兜底（旧 lease 兼容，宁少勿多）。
  const workerDepth = normalizeWorkerDepth(ctx.workerDepth);
  if (workerDepth !== undefined) {
    env[MCP_WORKER_DEPTH_ENV] = String(workerDepth);
  }
  return {
    command: 'node',
    args: [serverModulePath ?? defaultMcpServerModulePath()],
    env,
  };
}

/**
 * task-10（2026-08-22-team-session-unify / FR-04 / spike-01）：给 MCP server 配置表
 * 中的 daemon 内置 server（``DAEMON_MCP_SERVER_NAME``）条目补 ``MCP_SESSION_ID`` env。
 *
 * 背景：cli.ts 的 ``mainAgentMcpConfigProvider``（task-09 定型，不在 task-10
 * allowed_paths）调 ``buildDaemonMcpServerConfig`` 时不传 sessionId；session-manager
 * ``_resolveMainAgentMcp`` 在 provider 返回后按 ``ctx.sessionId`` 调本函数补写
 * （design §6 数据流 producer=session-manager）。create / restore / reload 三路共用，
 * 每次 spawn 重构造 → session id 变化即 env 变化。
 *
 * 语义：
 *   - 仅补 ``serverName``（默认 sillyhub-daemon）条目——只有 daemon 内置 server 读
 *     该 env，其它 MCP server 不注入（env 卫生）；
 *   - 不修改入参（浅拷贝条目 + 新 env 对象），provider 闭包持有的配置不被污染；
 *   - sessionId 空串 / 目标条目缺失 → 原样返回同一引用（零开销短路）。
 *
 * 泛型 ``T`` 兼容 ``McpServerConfig`` 与 driver 契约 ``McpServerConfigForDriver``
 * （两者 env 字段同构 ``Record<string, string>``）。
 */
export function injectMcpSessionId<T extends { env?: Record<string, string> }>(
  servers: Record<string, T>,
  sessionId: string,
  serverName: string = DAEMON_MCP_SERVER_NAME,
): Record<string, T> {
  const target = servers[serverName];
  if (!target || !sessionId) return servers;
  return {
    ...servers,
    [serverName]: {
      ...target,
      env: { ...target.env, [MCP_SESSION_ID_ENV]: sessionId },
    },
  };
}

/**
 * 推导 ``dist/mcp-server.js`` 绝对路径。
 *
 * 本文件编译后在 ``dist/mcp-config.js``，``mcp-server.ts`` 编译后在
 * ``dist/mcp-server.js``（同目录）。用 ``import.meta.url`` 取本模块绝对路径，
 * ``dirname`` 取目录，再拼 ``mcp-server.js``。file:// URL → path 用
 * ``node:url`` ``fileURLToPath``。
 *
 * 跨平台：Windows 下 fileURLToPath 产出 ``C:\...\dist\mcp-config.js``，
 * ``dirname`` 得 ``C:\...\dist``，``join`` 用平台 sep 拼 ``mcp-server.js``。
 */
function defaultMcpServerModulePath(): string {
  const thisPath = fileURLToPath(import.meta.url);
  return join(dirname(thisPath), 'mcp-server.js');
}
