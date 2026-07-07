// tests/mcp-config.test.ts
// task-05: MCP 配置合并 + 白名单过滤 + 注入单测。
//
// 覆盖 4 路径（task-05 §验收 C）：
//   1. 仅平台默认
//   2. 仅 workspace 配置
//   3. 两者合并去重（workspace 覆盖平台同名）
//   4. 非白名单被剔除
//
// @module mcp-config.test

import { describe, it, expect } from 'vitest';
import {
  mergeMcpConfigs,
  validateMcpServers,
  hasAnyMcpServers,
  loadPlatformMcpConfig,
  type McpConfig,
  type McpServerConfig,
} from '../src/mcp-config.js';

function server(command: string, args: string[] = []): McpServerConfig {
  return { command, args };
}

describe('mcp-config: mergeMcpConfigs', () => {
  it('仅平台默认 → 输出含平台 server（自动入白名单）', () => {
    const platform: McpConfig = { mcpServers: { web: server('web-bin') } };
    const result = mergeMcpConfigs([], platform);
    expect(Object.keys(result.config.mcpServers)).toEqual(['web']);
    expect(result.rejected).toHaveLength(0);
  });

  it('仅 workspace 配置 → 白名单内的 server 通过', () => {
    const ws: McpConfig = { mcpServers: { db: server('db-bin') } };
    const result = mergeMcpConfigs(['db'], ws);
    expect(result.config.mcpServers.db).toBeDefined();
    expect(result.rejected).toHaveLength(0);
  });

  it('两者合并去重 → workspace 覆盖平台同名 server', () => {
    const platform: McpConfig = {
      mcpServers: { shared: server('platform-ver') },
    };
    const ws: McpConfig = {
      mcpServers: { shared: server('ws-ver'), extra: server('extra-bin') },
    };
    const result = mergeMcpConfigs(['extra'], platform, ws);
    // workspace 覆盖平台同名
    expect(result.config.mcpServers.shared.command).toBe('ws-ver');
    // workspace 额外 server 白名单内通过
    expect(result.config.mcpServers.extra).toBeDefined();
  });

  it('非白名单 workspace server 被剔除', () => {
    const platform: McpConfig = { mcpServers: { allowed: server('a') } };
    const ws: McpConfig = { mcpServers: { rogue: server('evil') } };
    const result = mergeMcpConfigs([], platform, ws);
    expect(result.config.mcpServers.rogue).toBeUndefined();
    expect(result.rejected).toContain('rogue');
  });

  it('空配置 → 空输出不崩', () => {
    const result = mergeMcpConfigs([]);
    expect(Object.keys(result.config.mcpServers)).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});

describe('mcp-config: validateMcpServers', () => {
  it('白名单内 server 通过', () => {
    const servers = { a: server('a'), b: server('b') };
    const { validated, rejected } = validateMcpServers(servers, ['a', 'b']);
    expect(Object.keys(validated)).toEqual(['a', 'b']);
    expect(rejected).toHaveLength(0);
  });

  it('非白名单 server 剔除 + 记日志', () => {
    const logs: { level: string; msg: string; data?: Record<string, unknown> }[] = [];
    const logger = (level: string, msg: string, data?: Record<string, unknown>) =>
      logs.push({ level, msg, data });
    const servers = { good: server('g'), bad: server('b') };
    const { validated, rejected } = validateMcpServers(servers, ['good'], logger as never);
    expect(validated.good).toBeDefined();
    expect(validated.bad).toBeUndefined();
    expect(rejected).toEqual(['bad']);
    expect(logs.some((l) => l.msg === 'mcp_server_rejected_by_whitelist')).toBe(true);
  });
});

describe('mcp-config: hasAnyMcpServers', () => {
  it('空配置 → false', () => {
    expect(hasAnyMcpServers({ mcpServers: {} })).toBe(false);
  });

  it('非空配置 → true', () => {
    expect(hasAnyMcpServers({ mcpServers: { x: server('x') } })).toBe(true);
  });
});

describe('mcp-config: loadPlatformMcpConfig', () => {
  it('文件不存在 → 空配置不抛', async () => {
    const cfg = await loadPlatformMcpConfig();
    expect(cfg.mcpServers).toBeDefined();
  });
});
