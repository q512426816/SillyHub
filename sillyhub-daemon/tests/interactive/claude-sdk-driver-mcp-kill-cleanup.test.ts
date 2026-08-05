// tests/interactive/claude-sdk-driver-mcp-kill-cleanup.test.ts
// task-15 验收项 (1) + (2)（change 2026-08-05-daemon-kill-channel-unify / R-04 升级项 /
// decisions D-003 / D-004）：注入 mcpServers 场景下 kill 后的清理 hook 接线证据。
//
// R-04（design §10）：主 agent session（role=orchestrator）注入 options.mcpServers 后，
// SDK 会为每个 MCP server spawn 一个**孙进程**（claude.exe 是子进程，MCP server 是孙进程）。
// kill 时若只杀 claude.exe 主进程，孙进程可能残留。D-004 决策：**不**自建 taskkill
// 通杀（CONVENTIONS 陷阱），全平台只调 SDK ``query.close()``——SDK close 内部级联
// 收尾 claude.exe（win32 TerminateProcess / 非 win32 SIGTERM→SIGKILL）及其资源，
// MCP 孙进程的清理责任落在 SDK close() 的资源释放路径上。
//
// 本文件验证「hook 接线」（mock-based，跨平台，无真实 subprocess / 无 API key）：
//   - 驱动层（driver）：mcpServers 注入的 start 返回的 handle，其 ``close`` 仍绑定到
//     本次 start 创建的 query、调用 ``query.close()``（接通 SDK kill 链入口；证明
//     mcpServers 注入路径**没有**绕过/替换 close hook）。
//   - 会话层（SessionManager）：主 agent session（stage=orchestrator，经
//     mainAgentMcpConfigProvider 注入 mcpServers）在 end() 时仍触发 ``close?.()``
//     （kill 链在 R-04 场景仍可达）。
//
// 与既有测试分工（不重复）：
//   - claude-driver-close-contract.test.ts（task-03）：close→query.close 契约，**未注入
//     mcpServers**；本文件补「注入 mcpServers 后 hook 仍接线」这一 R-04 维度。
//   - session-manager-main-agent-mcp.test.ts（task-06）：mcpServers 注入，但 fakeQuery
//     **无 close**、不测 kill；本文件补「注入 mcpServers 的主 agent session 上 kill
//     链仍触发 close」这一交叉维度。
//   - session-manager-terminate-close.test.ts（task-03）：SM 层 close→terminate，**无
//     mcpServers**；本文件补「mcpServers 场景」。
//
// 诚实可行性说明（task-15 约束：不伪造真实 spawn 测试）：
//   真正的「kill 后 claude.exe / MCP 孙进程在 OS 进程树里消失」是 **SDK ``query.close()``
//   运行时行为**，需要真实 claude.exe + 真实 MCP server + 有效 ANTHROPIC 凭证 + 跨平台
//   进程树枚举才能验证，在单测环境不可行。本测试只证明**守护进程侧的 kill hook
//   被正确接通到 SDK close 入口**（这是 daemon 侧唯一可控的代码契约）；OS 级进程树
//   清理的真机验证留给 Windows CI / 手工实机（见文件末尾「platform 记录」用例）。
//   残留风险：若 SDK close 对 MCP 孙进程级联清理不彻底，daemon 侧无法补偿（不自建
//   taskkill，守 D-004）——此类残留按 task-15 约束记录到 QUICKLOG（task-14），不阻塞。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { UserTurnInput, McpServerConfigForDriver } from '../../src/interactive/driver.js';

// ════════════════════════════════════════════════════════════════════════════
// 第一部分：驱动层（driver）—— vi.mock SDK query + node:fs，验 mcpServers 注入下
// handle.close 仍绑定到本次 start 的 query 并调 query.close()。
// ════════════════════════════════════════════════════════════════════════════

const { fsExists, fsRead } = vi.hoisted(() => ({
  fsExists: vi.fn((_: unknown) => false),
  fsRead: vi.fn((_: unknown) => '' as unknown as Buffer),
}));
vi.mock('node:fs', () => ({
  existsSync: fsExists,
  readFileSync: fsRead,
}));

const { mockQuery, setMockQueryImpl } = vi.hoisted(() => {
  const defaultQuery = (): Query =>
    ({
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: async () => {},
      close: () => {},
    }) as unknown as Query;
  let impl:
    | ((p: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options?: Record<string, unknown>;
      }) => Query)
    | null = null;
  const mockQuery = vi.fn(
    (p: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Record<string, unknown>;
    }): Query => (impl ? impl(p) : defaultQuery()),
  );
  return {
    mockQuery,
    setMockQueryImpl: (
      fn:
        | ((p: {
            prompt: string | AsyncIterable<SDKUserMessage>;
            options?: Record<string, unknown>;
          }) => Query)
        | null,
    ) => {
      impl = fn;
    },
  };
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type { ClaudeDriverHandle } from '../../src/interactive/claude-sdk-driver.js';

const REAL_EXE = 'C:\\bin\\claude.exe';

const MCP_CONFIG: Record<string, McpServerConfigForDriver> = {
  'sillyhub-daemon': {
    command: 'node',
    args: ['dist/mcp-server.js'],
    env: {
      MCP_SERVER_BACKEND_URL: 'http://localhost:8000',
      MCP_SERVER_DAEMON_TOKEN: 'token-x',
    },
  },
  'workspace-fs': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\work'],
  },
};

/** 构造带 close spy 的 fakeQuery 并注入 SDK mock 返回它；同时捕获 options 供断言。 */
function makeQueryWithCloseSpyAndCapture(): {
  query: Query;
  closeSpy: ReturnType<typeof vi.fn>;
  capturedOpts: () => Record<string, unknown> | undefined;
} {
  const closeSpy = vi.fn(() => {});
  const query = {
    [Symbol.asyncIterator]: () =>
      (async function* (): AsyncGenerator<SDKMessage, void> {})(),
    interrupt: vi.fn(async () => {}),
    close: closeSpy,
  } as unknown as Query;
  let captured: Record<string, unknown> | undefined;
  setMockQueryImpl((p) => {
    captured = p.options;
    return query;
  });
  return { query, closeSpy, capturedOpts: () => captured };
}

/** 空 AsyncIterable<UserTurnInput>（start 只拿句柄，不消费 prompt）。 */
function emptyInput(): AsyncIterable<UserTurnInput> {
  return {
    [Symbol.asyncIterator]: () =>
      (async function* (): AsyncGenerator<UserTurnInput, void> {})(),
  };
}

beforeEach(() => {
  mockQuery.mockClear();
  setMockQueryImpl(null);
  fsExists.mockReset();
  fsRead.mockReset();
  fsExists.mockReturnValue(true);
  fsRead.mockReturnValue('' as unknown as Buffer);
});

describe('task-15 / R-04 (1): mcpServers 注入的 driver.start 返回的 handle.close 仍调 query.close（hook 未被 mcpServers 路径绕过）', () => {
  it('mcpServers 注入时 SDK query 收到 options.mcpServers 且值正确（注入链路打通）', async () => {
    const { capturedOpts } = makeQueryWithCloseSpyAndCapture();
    const driver = new ClaudeSdkDriver();
    await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
      mcpServers: MCP_CONFIG,
    });

    const opts = capturedOpts();
    expect(opts, 'SDK query 应被调').toBeDefined();
    expect(opts!.mcpServers).toEqual(MCP_CONFIG);
    // 两个 MCP server 都透传（主 agent discover 多个 tool 的场景）
    expect(Object.keys(opts!.mcpServers as object)).toHaveLength(2);
  });

  it('handle.close() → query.close() 调一次（mcpServers 注入下 kill 链入口仍接通）', async () => {
    const { closeSpy } = makeQueryWithCloseSpyAndCapture();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
      mcpServers: MCP_CONFIG,
    });

    expect(closeSpy).not.toHaveBeenCalled();
    handle.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('handle.close 绑定到 mcpServers 注入 start 创建的同一 query（不串句柄、不漏杀）', async () => {
    // R-04 关键：孙进程清理依赖 close 绑到正确 query。若 mcpServers 路径误把 close
    // 绑到别的 / 共享的 query，会漏杀本次 spawn 的 claude.exe + 其 MCP 孙进程。
    const { query, closeSpy } = makeQueryWithCloseSpyAndCapture();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
      mcpServers: MCP_CONFIG,
    });

    expect((handle as ClaudeDriverHandle).query).toBe(query);
    handle.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('mcpServers 注入下 close 抛异常不被 driver 层吞（R-01：由调用方 _terminateSession 兜底，与 task-03 非 mcp 场景一致）', async () => {
    const closeSpy = vi.fn(() => {
      throw new Error('sdk close boom under mcp scenario');
    });
    const query = {
      [Symbol.asyncIterator]: () =>
        (async function* (): AsyncGenerator<SDKMessage, void> {})(),
      interrupt: vi.fn(async () => {}),
      close: closeSpy,
    } as unknown as Query;
    setMockQueryImpl(() => query);

    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
      mcpServers: MCP_CONFIG,
    });

    expect(() => handle.close()).toThrow('sdk close boom under mcp scenario');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 第二部分：会话层（SessionManager）—— 主 agent session（注入 mcpServers）在
// end() 时触发 close?.()（kill 链在 R-04 场景仍可达）。
// ════════════════════════════════════════════════════════════════════════════

import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

/**
 * 组合 mock driver：start 返回的 fakeQuery 同时挂 close spy（kill 链入口）+ interrupt
 * spy（软中断），并捕获 start opts（断言 mcpServers 注入）。复用 task-03
 * terminate-close 与 task-06 main-agent-mcp 的 mock 形态合并。
 */
function makeMockDriverMcpWithClose() {
  let capturedStartOpts: StartOptions | null = null;
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const interruptSpy = vi.fn(async () => {});
  const closeSpy = vi.fn(() => {});
  const fakeQuery = {
    interrupt: interruptSpy,
    close: closeSpy,
  } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedStartOpts = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    interruptSpy,
    closeSpy,
    getStartOpts: () => capturedStartOpts,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const MAIN_AGENT_BASE = {
  sessionId: 'sess-mcp-kill',
  leaseId: 'lease-mcp-kill',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
  stage: 'orchestrator' as const,
};

const MCP_PROVIDER = (): Record<string, McpServerConfigForDriver> => MCP_CONFIG;

describe('task-15 / R-04 (2): 主 agent session（注入 mcpServers）end → close?.() 触发（kill 链在孙进程场景仍可达）', () => {
  it('主 agent session create 注入 mcpServers（R-04 场景前置：孙进程会 spawn）', async () => {
    const { driver, getStartOpts } = makeMockDriverMcpWithClose();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );

    await sm.create(MAIN_AGENT_BASE);

    const opts = getStartOpts();
    expect(opts).not.toBeNull();
    expect(opts!.mcpServers).toEqual(MCP_CONFIG);
  });

  it('主 agent session end → state.query.close 调一次（claude.exe kill 链入口触发）', async () => {
    const { driver, closeSpy } = makeMockDriverMcpWithClose();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );
    await sm.create(MAIN_AGENT_BASE);

    expect(closeSpy).not.toHaveBeenCalled();
    await sm.end('sess-mcp-kill');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-mcp-kill')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-mcp-kill', 'ended');
  });

  it('主 agent session fail → close 调一次（driver_error 也走 kill 链）', async () => {
    const { driver, closeSpy } = makeMockDriverMcpWithClose();
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );
    await sm.create(MAIN_AGENT_BASE);

    await sm.fail('sess-mcp-kill');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-mcp-kill')!.status).toBe('failed');
  });

  it('卡死 turn（status=running，未吐 result）end → close 仍触发（止血 P0：mcpServers 场景下卡死也能强杀）', async () => {
    // R-04 最痛场景：主 agent 注入了 MCP server（有孙进程），当前 turn 卡死（如 MCP
    // tool hang）。end 必须在 running 态也触发 close，让 SDK kill 链强杀 claude.exe。
    const { driver, closeSpy } = makeMockDriverMcpWithClose();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );
    await sm.create(MAIN_AGENT_BASE);
    expect(sm.get('sess-mcp-kill')!.status).toBe('running');

    await sm.end('sess-mcp-kill');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-mcp-kill')!.status).toBe('ended');
  });

  it('close 抛错时 end 不冒泡（R-01：_terminateSession try/catch，mcpServers 场景同守）', async () => {
    const { driver, closeSpy } = makeMockDriverMcpWithClose();
    closeSpy.mockImplementation(() => {
      throw new Error('query.close boom in mcp main-agent');
    });
    const deps = makeDeps();
    const sm = new SessionManager(
      { driver, ...deps },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );
    await sm.create(MAIN_AGENT_BASE);

    await expect(sm.end('sess-mcp-kill')).resolves.toBeUndefined();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-mcp-kill')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-mcp-kill', 'ended');
  });

  it('普通 session（不注入 mcpServers）end 也触发 close（kill 链通用，非主 agent 专用）', async () => {
    // 对照：不是 R-04 场景（无孙进程），kill 链同样触发——证明 close hook 是通用
    // 终止通道，mcpServers 只决定「有无孙进程」不决定「kill 链是否接线」。
    const { driver, closeSpy, getStartOpts } = makeMockDriverMcpWithClose();
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      {
        isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
        mainAgentMcpConfigProvider: MCP_PROVIDER,
      },
    );
    await sm.create({ ...MAIN_AGENT_BASE, stage: undefined }); // 普通会话

    expect(getStartOpts()!.mcpServers).toBeUndefined();
    await sm.end('sess-mcp-kill');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 第三部分：平台无关性记录 + 诚实可行性说明（task-15：不伪造真机测试）。
// ════════════════════════════════════════════════════════════════════════════

describe('task-15 / R-04 (1)+(2) 平台无关性 + 可行性边界（mock-only，不伪造真机）', () => {
  it('daemon kill 路径无平台分支：close hook 在当前运行平台（' + process.platform + '）触发，等价于全平台', async () => {
    // D-004：daemon 不按 process.platform 自建 kill（不 taskkill / 不显式 SIGTERM/SIGKILL），
    // 全平台只调 query.close()。故本 mock 测试在任何平台跑结果一致——此处记录当前
    // 平台用于审计追踪（实机跑在 win32 即代表 Windows hook 已验证接线）。
    const platform = process.platform;
    expect(['win32', 'linux', 'darwin']).toContain(platform);

    const { closeSpy } = makeQueryWithCloseSpyAndCapture();
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(emptyInput(), {
      pathToClaudeCodeExecutable: REAL_EXE,
      cwd: 'C:\\work',
      mcpServers: MCP_CONFIG,
    });
    handle.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // 平台不影响 hook 接线（无 if(platform) 分支）；OS 级进程树清理由 SDK close 负责。
  });

  it('诚实边界声明：OS 级 claude.exe + MCP 孙进程进程树清理不在本测试覆盖（属 SDK close 运行时行为）', () => {
    // task-15 约束：不伪造真实 spawn 测试。本用例显式记录「未覆盖」范围，避免被误读
    // 为「已自动验证孙进程零残留」。需真机验证的项（留 Windows CI / 手工）：
    //   - 真实 claude.exe + 真实 MCP server spawn → kill → 进程树枚举确认零残留；
    //   - 跨平台：win32 TerminateProcess 级联性 / linux SIGCHLD 收割 / darwin 行为。
    // daemon 侧已验证（本文件 + task-03）：kill hook 接通到 SDK query.close() 入口，
    // 且代码无 taskkill（见 d004-no-taskkill-source-gate.test.ts）。daemon 能做的到此
    // 为止——孙进程残留风险若在真机出现，按 task-15 约束记录 QUICKLOG（task-14）。
    const daemonSideCoverage = {
      hookWiredToQueryClose: true, // 本文件第一部分 + task-03
      killCascadeReachableInMcpScenario: true, // 本文件第二部分
      noTaskkillInSource: true, // d004-no-taskkill-source-gate.test.ts
      osLevelProcessTreeVerified: false, // 需真机（不在单测覆盖）
      mcpGrandchildCleanupVerified: false, // 属 SDK close 行为，需真机
    };
    // 结构化断言：daemon 侧 3 项已覆盖，OS 级 2 项未覆盖（透明声明）。
    expect(daemonSideCoverage.hookWiredToQueryClose).toBe(true);
    expect(daemonSideCoverage.killCascadeReachableInMcpScenario).toBe(true);
    expect(daemonSideCoverage.noTaskkillInSource).toBe(true);
    expect(daemonSideCoverage.osLevelProcessTreeVerified).toBe(false);
    expect(daemonSideCoverage.mcpGrandchildCleanupVerified).toBe(false);
  });
});
