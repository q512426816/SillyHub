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

  it('task-09 P0：apiKey 透传到 MCP_SERVER_DAEMON_API_KEY（X-API-Key 路径）', () => {
    // daemon apiKey（admin 签发长期 key）优先于 token，经 X-API-Key 发，
    // backend get_current_principal 解析 apiKey → User（Bearer 路径只解 JWT 会 401）。
    const cfg = buildDaemonMcpServerConfig(
      'http://localhost:8000',
      'fallback-token',
      '/fake/dist/mcp-server.js',
      'shk_live_daemon_key',
    );
    expect(cfg.env?.MCP_SERVER_DAEMON_API_KEY).toBe('shk_live_daemon_key');
    // token 仍写入（回落），apiKey 缺失时 mcp-server.ts 用 token。
    expect(cfg.env?.MCP_SERVER_DAEMON_TOKEN).toBe('fallback-token');
  });

  it('task-09 P0：apiKey 缺省时不写 MCP_SERVER_DAEMON_API_KEY（零回归）', () => {
    const cfg = buildDaemonMcpServerConfig('http://x:8000', 'tok', '/x/mcp-server.js');
    expect(cfg.env?.MCP_SERVER_DAEMON_API_KEY).toBeUndefined();
    expect(cfg.env?.MCP_SERVER_DAEMON_TOKEN).toBe('tok');
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

// ── task-10（2026-08-22-team-session-unify / FR-04）：MCP_SESSION_ID env 注入 ──
import {
  MCP_SESSION_ID_ENV,
  injectMcpSessionId,
} from '../src/mcp-config.js';

describe('mcp-config: buildDaemonMcpServerConfig MCP_SESSION_ID（task-10）', () => {
  it('传入 sessionId → env.MCP_SESSION_ID = sessionId', () => {
    // spike-01 结论：MCP server 子进程只继承白名单 + per-server env，
    // MCP_SESSION_ID 必须写进 mcpServers['sillyhub-daemon'].env 才能到达子进程。
    const cfg = buildDaemonMcpServerConfig(
      'http://localhost:8000',
      'tok',
      '/fake/dist/mcp-server.js',
      undefined,
      'sess-abc-1',
    );
    expect(cfg.env?.MCP_SESSION_ID).toBe('sess-abc-1');
  });

  it('sessionId 缺省 → 不写 MCP_SESSION_ID（旧调用零回归）', () => {
    const cfg = buildDaemonMcpServerConfig('http://x:8000', 'tok', '/x/mcp-server.js');
    expect(cfg.env?.MCP_SESSION_ID).toBeUndefined();
  });

  it('sessionId 空串 → 不写 MCP_SESSION_ID（守卫风格）', () => {
    const cfg = buildDaemonMcpServerConfig(
      'http://x:8000',
      'tok',
      '/x/mcp-server.js',
      undefined,
      '',
    );
    expect(cfg.env?.MCP_SESSION_ID).toBeUndefined();
  });

  it('MCP_SESSION_ID_ENV 常量 = "MCP_SESSION_ID"（键名单一来源）', () => {
    expect(MCP_SESSION_ID_ENV).toBe('MCP_SESSION_ID');
  });
});

describe('mcp-config: injectMcpSessionId（task-10 session-manager 补写路径）', () => {
  it('给 sillyhub-daemon 条目补 MCP_SESSION_ID，其余 server 不动', () => {
    const servers = {
      'sillyhub-daemon': {
        command: 'node',
        args: ['dist/mcp-server.js'],
        env: { MCP_SERVER_DAEMON_TOKEN: 'tok' },
      },
      'workspace-mcp': {
        command: 'node',
        args: ['dist/ws.js'],
        env: { WS_TOKEN: 'ws-tok' },
      },
    };
    const out = injectMcpSessionId(servers, 'sess-inject-1');
    expect(out['sillyhub-daemon'].env?.MCP_SESSION_ID).toBe('sess-inject-1');
    // 既有 env 保留
    expect(out['sillyhub-daemon'].env?.MCP_SERVER_DAEMON_TOKEN).toBe('tok');
    // 其它 server 不注入（env 卫生：只有 daemon 内置 server 读该 env）
    expect(out['workspace-mcp'].env).toEqual({ WS_TOKEN: 'ws-tok' });
  });

  it('不修改入参（返回新对象，provider 闭包配置不被污染）', () => {
    const servers = {
      'sillyhub-daemon': { command: 'node', env: { A: 'a' } },
    };
    const out = injectMcpSessionId(servers, 'sess-x');
    expect(servers['sillyhub-daemon'].env).toEqual({ A: 'a' });
    expect(out).not.toBe(servers);
    expect(out['sillyhub-daemon'].env).toEqual({ A: 'a', MCP_SESSION_ID: 'sess-x' });
  });

  it('无 env 的条目 → 创建 env 对象', () => {
    const servers = { 'sillyhub-daemon': { command: 'node' } };
    const out = injectMcpSessionId(servers, 'sess-y');
    expect(out['sillyhub-daemon'].env).toEqual({ MCP_SESSION_ID: 'sess-y' });
  });

  it('sessionId 空串 → 原样返回（守卫）', () => {
    const servers = { 'sillyhub-daemon': { command: 'node', env: { A: 'a' } } };
    expect(injectMcpSessionId(servers, '')).toBe(servers);
  });

  it('目标 server 不存在 → 原样返回（provider 未含 daemon server）', () => {
    const servers = { 'other-mcp': { command: 'node' } };
    expect(injectMcpSessionId(servers, 'sess-z')).toBe(servers);
  });
});

// ── task-08 / D-017：mcp_refs 子集过滤 + type 校验 ──────────────────────────

describe('mcp-config: mergeMcpConfigs mcp_refs 子集过滤（task-08 / D-017）', () => {
  it('提供 mcp_refs → 仅保留交集（profile 收紧）', () => {
    const platform: McpConfig = {
      mcpServers: {
        web: server('web-bin'),
        db: server('db-bin'),
        fs: server('fs-bin'),
      },
    };
    // 三 server 都在白名单（platform 自动入白名单），但 profile.mcp_refs 只留两个
    const result = mergeMcpConfigs([], ['web', 'db'], platform);
    expect(Object.keys(result.config.mcpServers).sort()).toEqual(['db', 'web']);
    // 被剔除的 fs 进 rejected
    expect(result.rejected).toContain('fs');
  });

  it('mcp_refs 含白名单外 server → 该 server 不出现（白名单先生效）', () => {
    const platform: McpConfig = { mcpServers: { allowed: server('a') } };
    const ws: McpConfig = { mcpServers: { extra: server('e') } };
    // mcp_refs 请求 extra，但 extra 非白名单 → 白名单层已剔除，mcp_refs 层不再加回
    const result = mergeMcpConfigs(['allowed'], ['allowed', 'extra'], platform, ws);
    expect(Object.keys(result.config.mcpServers)).toEqual(['allowed']);
  });

  it('mcp_refs 空数组 → 不过滤（向后兼容，等价不传）', () => {
    const platform: McpConfig = {
      mcpServers: { web: server('web-bin'), db: server('db-bin') },
    };
    const result = mergeMcpConfigs([], [], platform);
    // 空 mcp_refs 不收紧 → 两 server 都保留
    expect(Object.keys(result.config.mcpServers).sort()).toEqual(['db', 'web']);
    expect(result.rejected).toHaveLength(0);
  });

  it('不传 mcp_refs（旧式调用）→ 行为不变（向后兼容 cli.ts:709）', () => {
    // cli.ts:709 形态：mergeMcpConfigs([], { mcpServers: { ... } })
    const cfg: McpConfig = { mcpServers: { daemon: server('node') } };
    const result = mergeMcpConfigs([], cfg);
    expect(Object.keys(result.config.mcpServers)).toEqual(['daemon']);
    expect(result.rejected).toHaveLength(0);
  });

  it('mcp_refs 收紧 platform_default server（platform 默认也受限）', () => {
    // design §9：(workspace ∪ 平台默认) ∩ whitelist ∩ profile.mcp_refs
    // platform server 虽自动入白名单，仍受 mcp_refs 限制
    const platform: McpConfig = {
      mcpServers: { [DAEMON_MCP_SERVER_NAME]: server('node'), web: server('w') },
    };
    const result = mergeMcpConfigs([], [DAEMON_MCP_SERVER_NAME], platform);
    expect(Object.keys(result.config.mcpServers)).toEqual([DAEMON_MCP_SERVER_NAME]);
    expect(result.rejected).toContain('web');
  });
});

describe('mcp-config: McpServerConfig type 校验（task-08 / D-017 防 SSRF）', () => {
  it('type 缺省（stdio）→ 通过', () => {
    const cfg: McpConfig = { mcpServers: { web: { command: 'w', args: [] } } };
    const result = mergeMcpConfigs(['web'], cfg);
    expect(result.config.mcpServers.web).toBeDefined();
  });

  it('type=stdio 显式 → 通过', () => {
    const cfg: McpConfig = {
      mcpServers: { web: { type: 'stdio', command: 'w', args: [] } },
    };
    const result = mergeMcpConfigs(['web'], cfg);
    expect(result.config.mcpServers.web).toBeDefined();
  });

  it('type=sse → 抛错（防 SSRF，fail-loud 不静默跳过）', () => {
    // 运行时 backend/config JSON 可能注入 type:'sse'/'http'，tsc 拦不住（any 来源）
    const cfg = {
      mcpServers: { evil: { type: 'sse', command: 'x', args: [], url: 'http://evil' } },
    };
    expect(() => mergeMcpConfigs(['evil'], cfg as unknown as McpConfig)).toThrow(
      /unsupported type "sse"/,
    );
  });

  it('type=http → 抛错', () => {
    const cfg = {
      mcpServers: { evil: { type: 'http', command: 'x', args: [] } },
    };
    expect(() => mergeMcpConfigs(['evil'], cfg as unknown as McpConfig)).toThrow(
      /unsupported type "http"/,
    );
  });

  it('非 stdio 抛错在 mcp_refs 过滤前（fail-fast 安全边界）', () => {
    // 即使 mcp_refs 不含该 server，type 校验仍抛（合并阶段校验所有 server）
    const cfg = {
      mcpServers: { evil: { type: 'sse', command: 'x', args: [] } },
    };
    expect(() =>
      mergeMcpConfigs([], ['other-server'], cfg as unknown as McpConfig),
    ).toThrow(/unsupported type "sse"/);
  });
});
