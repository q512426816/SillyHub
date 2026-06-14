// tests/execution-context.test.ts
// task-05: daemon fetch execution-context + CLAUDE.md / clone 生效。
//
// 测试策略（task-05 §实现要求 5 + §TDD）：
//   - mock 6 个 Daemon 依赖（detector/client/taskRunner/wsClient）+ HubClient.getExecutionContext
//   - 4 个 case：
//     case1: fetch 注入 claude_md/repo_url/branch/tool_config → ctx 覆盖 + runLease 收到
//     case2: fetch 抛 HubHttpError(500) → 仍调 runLease，ctx 回落 undefined，lease 不中断
//     case3: ctx.claudeMd 非空 → TaskRunner.runLease 写 .claude/CLAUDE.md（spy fs/promises.writeFile）
//     case4: ctx.claudeMd 空字符串 → writeFile 不被调
//
// case1/2 在 Daemon 编排层测（mock TaskRunner，断言 runLease 收到的 ctx）；
// case3/4 在 TaskRunner 编排层测（mock HubClient/workspace/credential，断言 fs.writeFile 调用）。
//
// @module execution-context.test

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import { HubHttpError, HubClient } from '../src/hub-client.js';
import { TaskRunner } from '../src/task-runner.js';
import type { TaskRunnerResult } from '../src/task-runner.js';
import { sep } from 'node:path';

// fs/promises mock（vi.mock 被提升到文件顶部，工厂函数内不能直接引用顶层 const，
// 用 vi.hoisted 把 mock 句柄一起提升，让工厂能拿到引用）。
// TaskRunner 用 `import { writeFile } from 'node:fs/promises'` 具名导入，
// 无法用 vi.spyOn（具名 export 不可重新定义），用 vi.mock 透传 + 覆盖 writeFile。
const { fsWriteFileMock, fsMkdirMock } = vi.hoisted(() => ({
  fsWriteFileMock: vi.fn(async () => undefined),
  fsMkdirMock: vi.fn(async () => undefined),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: fsWriteFileMock,
    // mkdir 也透传（实际写入 CLAUDE.md 前会 mkdir .claude/）
    mkdir: fsMkdirMock,
  };
});
import type {
  DetectedAgent,
} from '../src/agent-detector.js';
import type {
  ExecutionContextPayload,
  LeaseCtx,
  LeasePayload,
} from '../src/types.js';
import type {
  WsClientCallbacks,
} from '../src/ws-client.js';

// ── Daemon 测试 fixture（对齐 tests/daemon.test.ts 的 mock 模式）──────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://test:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function mockAgent(provider: string): DetectedAgent {
  return {
    provider,
    path: `/usr/bin/${provider}`,
    version: '1.0.0',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface MockClient {
  register: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  claimLease: ReturnType<typeof vi.fn>;
  startLease: ReturnType<typeof vi.fn>;
  submitMessages: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  getPendingLeases: ReturnType<typeof vi.fn>;
  getExecutionContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 'token-default',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async (): Promise<ExecutionContextPayload> => ({
      agent_run_id: '',
      claude_md: '',
    })),
    close: vi.fn(),
  };
}

function createMockDetector(
  agents: DetectedAgent[] = [mockAgent('claude')],
): { detectAgents: ReturnType<typeof vi.fn> } {
  return { detectAgents: vi.fn(async () => agents) };
}

function createMockTaskRunner(): { runLease: ReturnType<typeof vi.fn> } {
  return {
    runLease: vi.fn(async (): Promise<TaskRunnerResult> => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: 'diff --git',
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
      output: 'done',
      error: '',
      durationMs: 500,
      sessionId: 'sess-1',
      metadata: { session_id: 'sess-1' },
    })),
  };
}

function createMockWsClient() {
  let callbacks: WsClientCallbacks = {};
  return {
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test_close');
    }),
    send: vi.fn(() => true),
    _injectMessage(msg: { type: string; payload: unknown }): void {
      callbacks.onMessage?.(msg as never);
    },
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
}

function buildDaemon(opts: {
  client?: MockClient;
  taskRunner?: { runLease: ReturnType<typeof vi.fn> } | null;
  config?: Partial<DaemonConfig>;
}) {
  const client = opts.client ?? createMockClient();
  const detector = createMockDetector();
  const taskRunner = opts.taskRunner === undefined ? createMockTaskRunner() : opts.taskRunner;
  const config = { ...mockConfig, ...(opts.config ?? {}) };

  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((opts2: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(opts2.callbacks);
    return wsClientMock;
  });

  const daemon = new Daemon(config, client as never, taskRunner as never, {
    detector: detector as never,
    wsClientFactory: wsClientFactory as never,
  });

  return { daemon, client, detector, taskRunner, wsClientMock, wsClientFactory, config };
}

// ── TaskRunner fixture（对齐 tests/task-runner.test.ts 的 mock 模式）───────────

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { getBackend } from '../src/adapters/index.js';
import { createFakeChild, waitForSpawn, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent } from '../src/types.js';

function defaultMockAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    provider: 'claude',
    parse: vi.fn((line: string): AgentEvent[] | null => {
      if (line.startsWith('hello') || line.includes('"text"')) {
        return [{ type: 'text', content: line.startsWith('hello') ? line : 'parsed' }];
      }
      return null;
    }),
    buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    ...overrides,
  };
}

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-ec-1',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'ar-1',
    ...overrides,
  };
}

function makeMockClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({}),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeMockWorkspace(): Record<string, unknown> {
  return {
    // 返回一个稳定的 fake 路径（与既有 task-runner.test.ts 一致）
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/execution-context-test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/ws/execution-context-test'),
  };
}

function makeMockCred(): Record<string, unknown> {
  // task-09：buildSpawnEnv 调 get 读 token，mock 返回 undefined（无 token 配置）
  return { get: vi.fn(() => undefined), buildEnv: vi.fn().mockReturnValue({}) };
}

function setupRunner(): {
  runner: TaskRunner;
  client: Record<string, unknown>;
  workspace: Record<string, unknown>;
  cred: Record<string, unknown>;
} {
  const client = makeMockClient();
  const workspace = makeMockWorkspace();
  const cred = makeMockCred();
  mockAdapter = defaultMockAdapter();
  const runner = new TaskRunner(client as never, workspace as never, cred as never);
  return { runner, client, workspace, cred };
}

function mockSpawnReturn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child as never);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// case1 + case2: Daemon 编排层 —— fetch execution-context 覆盖 / 失败降级
// ─────────────────────────────────────────────────────────────────────────────

describe('task-05 execution-context: daemon 编排层', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  // case1: fetch 注入 claude_md/repo_url/branch/tool_config → ctx 字段被覆盖
  it('case1: fetch execution-context 返回的字段覆盖 ctx（claudeMd/repoUrl/branch/toolConfig）', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-ec-1',
      payload: {
        // payload 字段（camelCase）刻意空，证明覆盖来自 fetch
        agentRunId: 'ar-1',
        prompt: 'do task',
        provider: 'claude',
      },
    });
    client.getExecutionContext.mockResolvedValueOnce({
      agent_run_id: 'ar-1',
      claude_md: '# Hi',
      repo_url: 'https://github.com/x/y',
      branch: 'dev',
      tool_config: { K: 'V' },
    });
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-ec-1',
        runtimeId: 'srv-rid-1',
        agentRunId: 'ar-1',
        prompt: 'do task',
      } satisfies Partial<LeasePayload>,
    });
    await sleep(60);

    // fetch 用 agentRunId 调
    expect(client.getExecutionContext).toHaveBeenCalledWith('ar-1');
    // runLease 收到的 ctx 含被 fetch 覆盖的字段
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctx = taskRunner.runLease.mock.calls[0]?.[0] as LeaseCtx;
    expect(ctx.claudeMd).toBe('# Hi');
    expect(ctx.repoUrl).toBe('https://github.com/x/y');
    expect(ctx.branch).toBe('dev');
    expect(ctx.toolConfig).toEqual({ K: 'V' });
    // prompt 不从 fetch 覆盖（保留 payload 的最终意图）
    expect(ctx.prompt).toBe('do task');
    // claimToken / leaseId / agentRunId 仍正确
    expect(ctx.leaseId).toBe('lease-ec-1');
    expect(ctx.claimToken).toBe('token-ec-1');
    expect(ctx.agentRunId).toBe('ar-1');

    await daemon.stop();
  });

  // case2: fetch 抛 HubHttpError(500) → 仍调 runLease，ctx 回落 undefined，lease 不中断
  it('case2: fetch 抛 HubHttpError(500) → 字段回落 undefined，仍调 runLease + completeLease', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-ec-2',
      payload: { prompt: 'fallback', provider: 'claude' },
    });
    client.getExecutionContext.mockRejectedValueOnce(
      new HubHttpError(500, 'server boom', 'http://test/api/agent-runs/ar-2/execution-context', 'GET'),
    );
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-ec-2',
        runtimeId: 'srv-rid-1',
        agentRunId: 'ar-2',
        prompt: 'fallback',
      },
    });
    await sleep(60);

    // fetch 被调但失败
    expect(client.getExecutionContext).toHaveBeenCalledWith('ar-2');
    // runLease 仍被调（lease 不中断）
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctx = taskRunner.runLease.mock.calls[0]?.[0] as LeaseCtx;
    // execCtx=null → 字段回落 payload，payload 也没提供 → undefined
    expect(ctx.repoUrl).toBeUndefined();
    expect(ctx.branch).toBeUndefined();
    expect(ctx.claudeMd).toBeUndefined();
    expect(ctx.toolConfig).toBeUndefined();
    // prompt 保留
    expect(ctx.prompt).toBe('fallback');
    // completeLease 被调（lease 正常收尾）
    expect(client.completeLease).toHaveBeenCalledWith(
      'lease-ec-2',
      'token-ec-2',
      expect.objectContaining({ success: true }),
    );

    await daemon.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// case3 + case4: TaskRunner 编排层 —— CLAUDE.md 写入生效 / 空不写
// 用 vi.spyOn(fs/promises, 'writeFile') 验证写入语义（对齐 task-05 §实现要求 5）。
// ─────────────────────────────────────────────────────────────────────────────

describe('task-05 execution-context: TaskRunner CLAUDE.md 写入', () => {
  /** 路径尾段 `.claude/CLAUDE.md` 在当前 OS 的形态。 */
  const claudeMdTail = `.claude${sep}CLAUDE.md`;

  it('case3: ctx.claudeMd 非空 → fs.writeFile 被调用且内容含 claudeMd 文本', async () => {
    fsWriteFileMock.mockClear();
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner();

    const lease = makeLease({ claudeMd: '# Hi\nProject instructions.' });
    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // 至少一次 writeFile，且某次调用的第一个参数路径以 .claude/CLAUDE.md 结尾
    expect(fsWriteFileMock).toHaveBeenCalled();
    const claudeCalls = fsWriteFileMock.mock.calls.filter(
      (c) => String(c[0]).endsWith(claudeMdTail),
    );
    expect(claudeCalls.length).toBeGreaterThanOrEqual(1);
    // 第二参数（内容）含 '# Hi'
    const writtenContent = claudeCalls[0]![1];
    expect(String(writtenContent)).toContain('# Hi');
    expect(String(writtenContent)).toContain('Project instructions.');
  });

  it('case4: ctx.claudeMd 为空字符串 → fs.writeFile（CLAUDE.md）不被调用', async () => {
    fsWriteFileMock.mockClear();
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner();

    const lease = makeLease({ claudeMd: '' });
    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // 不应出现任何写到 .claude/CLAUDE.md 的调用
    const claudeCalls = fsWriteFileMock.mock.calls.filter(
      (c) => String(c[0]).endsWith(claudeMdTail),
    );
    expect(claudeCalls).toHaveLength(0);
  });
});

// ── 端点路径前缀约束（task-05 §边界处理 6）──────────────────────────────────────
// 不用 REST_PREFIX（/api/daemon），用 /api/agent-runs/{id}/execution-context

describe('task-05 execution-context: 端点路径前缀约束', () => {
  it('getExecutionContext 调用真实 fetch 时 URL 形如 {base}/api/agent-runs/{id}/execution-context', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ agent_run_id: 'ar-x', claude_md: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HubClient('http://hub:8000', 'tok-1');
    await client.getExecutionContext('ar-x');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toBe('http://hub:8000/api/agent-runs/ar-x/execution-context');
    // 反证：不含 /api/daemon（REST_PREFIX）
    expect(url).not.toContain('/api/daemon');

    fetchSpy.mockRestore();
  });

  it('getExecutionContext 带 Bearer token 鉴权（沿用 _headers）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ agent_run_id: 'ar-y', claude_md: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HubClient('http://hub:8000', 'tok-2');
    await client.getExecutionContext('ar-y');

    const reqInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = reqInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-2');
    expect(headers['Content-Type']).toBe('application/json');

    fetchSpy.mockRestore();
  });
});
