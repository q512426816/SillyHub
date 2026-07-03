// tests/task-runner-policy-cache.test.ts
// 2026-07-02-daemon-filesystem-policy task-16：
// batch Claude spawn 改用 PolicyCache per-runtime 快照生成 CC --settings（D-002）。
//
// 覆盖：
//   1. 注入 policyCache 时 buildArgs 收到 PolicyCache.get(rid).allowedRoots（per-runtime 隔离）；
//   2. claude/codex 两个 runtime 各取各的 roots（不串扰）；
//   3. D-003 冻结语义：spawn 后热更新 PolicyCache 不影响在跑 batch 的 allowedRoots；
//   4. fallback：policyCache 未注入 / rid 未命中 → 回退 config.allowed_roots。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { TaskRunner } from '../src/task-runner.js';
import { createFakeChild, readStdin, waitForSpawn } from './helpers/fake-child.js';
import { PolicyCache } from '../src/policy/runtime-policy.js';
import type { LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

function defaultMockAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    provider: 'claude',
    parse: vi.fn((): null => null),
    // task-16：buildArgs 是被断言的核心 —— 记录调用时的 allowedRoots 参数。
    buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    ...overrides,
  };
}

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-1',
    runtimeId: 'rt-claude',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeMockWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    ...overrides,
  };
}

function makeMockCred(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://localhost:8000',
    token: null,
    runtime_id: 'rt-test',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 0,
    allowed_roots: ['/fallback/global'],
    ...overrides,
  } as unknown as DaemonConfig;
}

interface Setup {
  runner: TaskRunner;
  client: Record<string, unknown>;
  workspace: Record<string, unknown>;
  cred: Record<string, unknown>;
  config: DaemonConfig;
}

function setup(opts: {
  policyCache?: PolicyCache | null;
  config?: DaemonConfig;
}): Setup {
  mockAdapter = defaultMockAdapter();
  const client = makeMockClient();
  const workspace = makeMockWorkspace();
  const cred = makeMockCred();
  const config = opts.config ?? makeConfig();
  const runner = new TaskRunner(
    client as never,
    workspace as never,
    cred as never,
    config,
    null,
    opts.policyCache === undefined ? null : opts.policyCache,
  );
  return { runner, client, workspace, cred, config };
}

describe('task-16: batch spawn 用 PolicyCache per-runtime allowed_roots', () => {
  let fakeChild: ReturnType<typeof createFakeChild>;

  beforeEach(() => {
    vi.mocked(spawn).mockClear();
    fakeChild = createFakeChild();
    vi.mocked(spawn).mockImplementation(() => fakeChild as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T1 注入 policyCache → buildArgs 收到 rid 对应 allowedRoots（per-runtime 隔离）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-claude', ['/workspace/claude']);
    cache.set('rt-codex', ['/workspace/codex']);
    const expected = cache.get('rt-claude')!.allowedRoots;
    const { runner } = setup({ policyCache: cache });

    const resultP = runner.runLease(makeLease({ runtimeId: 'rt-claude' }));
    await waitForSpawn();
    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await resultP;

    const buildArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    expect(buildArgs).toHaveBeenCalled();
    const callOpts = buildArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    expect(callOpts.allowedRoots).toEqual(expected);
  });

  it('T2 claude/codex 各取各的 roots（不串扰）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-claude', ['/ws/claude']);
    cache.set('rt-codex', ['/ws/codex']);
    const { runner } = setup({ policyCache: cache });
    const expectedClaude = cache.get('rt-claude')!.allowedRoots;
    const expectedCodex = cache.get('rt-codex')!.allowedRoots;

    // claude batch（保存 buildArgs 引用 —— 第二轮会覆盖 mockAdapter）
    const p1 = runner.runLease(makeLease({ leaseId: 'l1', runtimeId: 'rt-claude' }));
    await waitForSpawn();
    const claudeBuildArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await p1;
    const claudeOpts = claudeBuildArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    expect(claudeOpts.allowedRoots).toEqual(expectedClaude);

    // codex batch（同一 runner，不同 rid，新建 fakeChild —— 上一个 stdout 已 end）
    fakeChild = createFakeChild();
    vi.mocked(spawn).mockImplementation(() => fakeChild as never);
    mockAdapter = defaultMockAdapter();
    const p2 = runner.runLease(
      makeLease({ leaseId: 'l2', runtimeId: 'rt-codex', provider: 'codex' }),
    );
    await waitForSpawn();
    fakeChild._emitLines(['{"type":"result","session_id":"s2"}']);
    fakeChild._emitExit(0);
    await p2;

    const codexArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    expect(codexArgs).toHaveBeenCalled();
    const codexOpts = codexArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    // claude/codex 各取各的 roots（PolicyCache per-runtime 隔离，不串扰）
    expect(codexOpts.allowedRoots).toEqual(expectedCodex);
    expect(codexOpts.allowedRoots).not.toEqual(claudeOpts.allowedRoots);
  });

  it('T3 D-003 冻结：spawn 后热更新 PolicyCache 不影响已取的 allowedRoots', async () => {
    // 注：runLease 在 spawn 前同步取快照，spawn 之后 POLICY_UPDATE 改 cache 不影响本次。
    const cache = new PolicyCache();
    cache.set('rt-claude', ['/ws/v1']);
    const expectedV1 = cache.get('rt-claude')!.allowedRoots;
    const { runner } = setup({ policyCache: cache });

    const resultP = runner.runLease(makeLease({ runtimeId: 'rt-claude' }));
    await waitForSpawn();
    // spawn 已发生（快照已取）→ 热更新 cache
    cache.set('rt-claude', ['/ws/v2', '/ws/extra']);
    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await resultP;

    const buildArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    const callOpts = buildArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    // 仍是 spawn 那一刻的 v1 快照（热更新不影响在跑 batch）
    expect(callOpts.allowedRoots).toEqual(expectedV1);
  });

  it('T4 fallback：policyCache 未注入 → 回退 config.allowed_roots', async () => {
    const config = makeConfig({ allowed_roots: ['/fallback/global'] } as unknown as Partial<DaemonConfig>);
    const { runner } = setup({ policyCache: null, config });

    const resultP = runner.runLease(makeLease({ runtimeId: 'rt-claude' }));
    await waitForSpawn();
    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await resultP;

    const buildArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    const callOpts = buildArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    expect(callOpts.allowedRoots).toEqual(['/fallback/global']);
  });

  it('T5 fallback：rid 未命中（runtime 尚未注册）→ 回退 config.allowed_roots', async () => {
    const cache = new PolicyCache();
    cache.set('rt-other', ['/ws/other']);
    const config = makeConfig({ allowed_roots: ['/fallback/global'] } as unknown as Partial<DaemonConfig>);
    const { runner } = setup({ policyCache: cache, config });

    const resultP = runner.runLease(makeLease({ runtimeId: 'rt-missing' }));
    await waitForSpawn();
    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await resultP;

    const buildArgs = mockAdapter.buildArgs as ReturnType<typeof vi.fn>;
    const callOpts = buildArgs.mock.calls[0]![0] as { allowedRoots?: string[] };
    expect(callOpts.allowedRoots).toEqual(['/fallback/global']);
  });
});
