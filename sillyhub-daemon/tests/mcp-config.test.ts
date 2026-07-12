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

import { describe, it, expect, vi } from 'vitest';
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

// task-07: backend 拉 + 回落
import { fetchPlatformMcpConfig, loadPlatformMcpConfigFromBackend } from '../src/mcp-config.js';

describe('mcp-config: fetchPlatformMcpConfig（task-07 backend 拉）', () => {
  it('200 + platform_default → 返回 mcpServers', async () => {
    const body = { platform_default: { mcpServers: { web: { command: 'w', args: [] } } } };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const cfg = await fetchPlatformMcpConfig('http://hub:8000', 'tok');
    expect(cfg?.mcpServers.web).toBeDefined();
    // 带 Authorization header
    const calledUrl = String(spy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('/api/daemon/mcp/config');
    spy.mockRestore();
  });

  it('非 200 → null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 500 }));
    const cfg = await fetchPlatformMcpConfig('http://hub:8000', 'tok');
    expect(cfg).toBeNull();
  });

  it('网络错 → null 不抛', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    const cfg = await fetchPlatformMcpConfig('http://hub:8000', 'tok');
    expect(cfg).toBeNull();
  });
});

describe('mcp-config: loadPlatformMcpConfigFromBackend 回落', () => {
  it('backend 拉 null → 回落本地文件（不抛）', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    const cfg = await loadPlatformMcpConfigFromBackend('http://hub:8000', null);
    expect(cfg.mcpServers).toBeDefined();
  });
});

// ── task-05 / D-007@v2：daemon 内置 MCP server 配置工厂 ──────────────────────
import {
  buildDaemonMcpServerConfig,
  DAEMON_MCP_SERVER_NAME,
} from '../src/mcp-config.js';

describe('mcp-config: buildDaemonMcpServerConfig（task-05）', () => {
  it('构造 {command=node, args=[mcp-server.js 路径], env={MCP_SERVER_*}}', () => {
    const cfg = buildDaemonMcpServerConfig(
      'http://localhost:8000',
      'user-token-xyz',
      '/fake/dist/mcp-server.js',
    );
    expect(cfg.command).toBe('node');
    expect(cfg.args).toEqual(['/fake/dist/mcp-server.js']);
    expect(cfg.env).toEqual({
      MCP_SERVER_BACKEND_URL: 'http://localhost:8000',
      MCP_SERVER_DAEMON_TOKEN: 'user-token-xyz',
    });
  });

  it('backendUrl 去尾斜杠', () => {
    const cfg = buildDaemonMcpServerConfig(
      'http://localhost:8000///',
      'tok',
      '/x/mcp-server.js',
    );
    expect(cfg.env?.MCP_SERVER_BACKEND_URL).toBe('http://localhost:8000');
  });

  it('空 token 仍构造配置（server 启动后 tool 调用返回结构化错误）', () => {
    const cfg = buildDaemonMcpServerConfig('http://x:8000', '', '/x/mcp-server.js');
    expect(cfg.env?.MCP_SERVER_DAEMON_TOKEN).toBe('');
    // 配置本身不报错（容错，便于诊断）
    expect(cfg.command).toBe('node');
  });

  it('默认 args 路径指向 dist/mcp-server.js（与 mcp-config.js 同目录）', () => {
    // 不传 serverModulePath → 用 import.meta.url 推导默认路径
    const cfg = buildDaemonMcpServerConfig('http://x:8000', 'tok');
    // 编译产物在 dist/，本测试编译后跑或 tsx 跑都应指向 mcp-server.js
    expect(cfg.args[0]).toMatch(/mcp-server\.js$/);
  });

  it('DAEMON_MCP_SERVER_NAME = sillyhub-daemon', () => {
    expect(DAEMON_MCP_SERVER_NAME).toBe('sillyhub-daemon');
  });

  it('daemon 内置 server 进 platform_default → mergeMcpConfigs 自动入白名单', () => {
    // 模拟主 agent spawn 时合并：platform_config 含 daemon 内置 server
    const platform: McpConfig = {
      mcpServers: {
        [DAEMON_MCP_SERVER_NAME]: buildDaemonMcpServerConfig(
          'http://x:8000',
          'tok',
          '/dist/mcp-server.js',
        ),
      },
    };
    // 白名单为空（仅靠 platform_default 自动入白名单）
    const result = mergeMcpConfigs([], platform);
    expect(result.config.mcpServers[DAEMON_MCP_SERVER_NAME]).toBeDefined();
    expect(result.rejected).toHaveLength(0);
  });
});
