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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
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

export interface InjectResult {
  mcpConfigPath: string; // 临时 .mcp.json 路径，供 --mcp-config
  cleanup: () => Promise<void>; // 删除临时文件
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
    const body = (await resp.json()) as {
      platform_default?: { mcpServers?: Record<string, unknown> };
    };
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

/**
 * 读取 workspace 级 `.mcp.json`（specDir/docs/<ws>/.mcp.json 或 workspace specDir）。
 * 文件不存在/解析失败 → 返回空配置。
 */
export async function loadWorkspaceMcpConfig(
  workspaceSpecDir: string,
  logger?: McpConfigLogger,
): Promise<McpConfig> {
  return loadMcpConfigFile(join(workspaceSpecDir, '.mcp.json'), logger);
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
 * 合并多个 MCP 配置（D-003）：
 *   1. 传入顺序为优先级从低到高（如 [platform, workspace]）。
 *   2. 同名 server 以后续配置覆盖前面。
 *   3. 所有 server（含 platform 默认）均需通过白名单。
 *   4. 平台默认 server 自动加入白名单（隐式允许）。
 *
 * @param whitelist admin 配置的白名单 server 名列表。
 * @param configs   MCP 配置列表，按优先级从低到高（mergeMcpConfigs(wl, platform, workspace)）。
 */
export function mergeMcpConfigs(
  whitelist: string[],
  ...configs: McpConfig[]
): MergedMcpResult {
  // 步骤 1：合并所有配置（浅合并，同名 server 后者覆盖前者）
  const raw: Record<string, McpServerConfig> = {};
  for (const cfg of configs) {
    for (const [name, serverCfg] of Object.entries(cfg.mcpServers)) {
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

  return { config: { mcpServers: validated }, rejected };
}

// ── 注入 ──────────────────────────────────────────────────────────────────────

/**
 * 写合并后的 MCP 配置到临时 `.mcp.json`，供 spawn claude `--mcp-config <path>`。
 * 返回路径 + cleanup 函数（调用方负责清理）。
 */
export async function injectMcpConfig(
  mergedConfig: McpConfig,
): Promise<InjectResult> {
  const dir = await mkdtemp(join(tmpdir(), 'sillyhub-mcp-'));
  const mcpConfigPath = join(dir, '.mcp.json');
  await writeFile(mcpConfigPath, JSON.stringify(mergedConfig), 'utf-8');
  return {
    mcpConfigPath,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // cleanup 失败不致命
      }
    },
  };
}

/**
 * 快速判断是否有任何 MCP server（决定是否需要注入）。
 */
export function hasAnyMcpServers(...configs: McpConfig[]): boolean {
  return configs.some((c) => Object.keys(c.mcpServers).length > 0);
}
