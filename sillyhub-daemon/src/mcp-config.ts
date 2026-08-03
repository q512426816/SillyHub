/**
 * mcp-config.ts —— MCP 配置合并 + 白名单过滤 + 注入（task-05）。
 *
 * 平台默认 MCP（admin 全局）+ workspace 级 `.mcp.json`，按白名单过滤后合并，
 * spawn claude 时注入（写临时 `.mcp.json` 供 `--mcp-config`）。
 *
 * 设计依据：2026-07-07-daemon-skill-execution design.md §5.3（MCP 配置注入）、
 * §7（接口定义）、D-003（平台+workspace 合并策略）。
 *
 * @module mcp-config
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
 * 等价不过滤（行为同 task-08 前）。cli.ts:709 `mergeMcpConfigs([], { mcpServers })`
 * 不需改动。
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
 * 对齐）。``mergeMcpConfigs`` 平台默认 server 自动入白名单（:188），故本 server
 * 放进 platform_config 即隐式允许，无需额外改白名单逻辑。
 */
export const DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon';

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
 *
 * **token 注入时机**：本函数只构造静态配置，token/apiKey 由调用方在 spawn 主 agent
 * 前从 daemon config 取传入。空值仍构造配置（server 启动后 tool 调用返回结构化错误，
 * 便于诊断）——与 mcp-server.ts ``runMcpServer`` 容错一致。
 *
 * @param backendUrl  backend 根 URL（如 http://localhost:8000）
 * @param token       daemon Bearer token（回落，apiKey 缺失时用）
 * @param serverModulePath  可选，覆盖默认编译产物路径（测试用，避免依赖 dist/）
 * @param apiKey      可选，daemon 长期 API Key（task-09 P0，优先于 token）
 */
export function buildDaemonMcpServerConfig(
  backendUrl: string,
  token: string,
  serverModulePath?: string,
  apiKey?: string,
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
  return {
    command: 'node',
    args,
    env,
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
