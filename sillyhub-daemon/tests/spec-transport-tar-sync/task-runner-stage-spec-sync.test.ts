// tests/spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts
// task-11（2026-06-23-spec-transport-tar-sync）E 组：task-runner batch 路径对 stage
// lease 的 spec-sync 触发测试。
//
// 守护 task-05（runLease 改调 spec-sync utility）对 stage 类型 lease 生效 —— 证明
// stage（propose/plan/execute）经 batch 路径自动获得 tar 覆盖（§0 修正结论 +
// D-007@v1 X-001 连带收益）。
//
// 区别于 task-09 测试组：
//   - task-09 spec-sync.test.ts（A 组）：spec-sync.ts 纯函数单测（utility 内部行为）
//   - task-09 daemon-interactive-spec-sync.test.ts（B 组）：daemon.ts interactive 接入（scan）
//   - task-09 task-09-spec-pull-push.test.ts：task-runner batch pull/push（用真实 spec-sync，
//     测 client.getSpecBundle/postSpecSync 调用，非 stage 专属场景）
//   - 本组（E）：task-runner batch 路径 + **vi.mock spec-sync 为 spy**，只验 task-runner
//     对 stage 类型 lease 的调用契约（stage 子阶段/transport/shared 零触发/容错）
//
// 铁律：
//   - vi.mock spec-sync.ts：E 组只验 task-runner 调用契约（utility 内部行为是 A 组职责）
//   - 复用 task-09-spec-pull-push.test.ts 的 createFakeChild + lease payload 构造模式
//   - 不真实网络、不真实 driver spawn（mock node:child_process.spawn）
//   - 守护 §0：stage 经 batch（TaskRunner.runLease），不构造 interactive session

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── vi.mock spec-sync.ts：替换为 spy（E 组只验 task-runner 调用契约）────────────
// pullSpecBundle 默认 resolve 到非 null 路径（让 task-runner 走 sync 分支：specRoot 非空）。
// 各用例按需 vi.mocked(...).mockResolvedValueOnce / mockRejectedValueOnce / mockResolvedValue 覆盖。
const specSyncMocks = vi.hoisted(() => ({
  pullSpecBundle: vi.fn<(c: unknown, ws: string | undefined) => Promise<string | null>>()
    .mockResolvedValue('/fake/spec/dir'),
  postSpecSync: vi.fn<(c: unknown, ws: string, root: string) => Promise<{ ok: boolean; reparsed: number } | null>>()
    .mockResolvedValue({ ok: true, reparsed: 0 }),
  resolveSpecDir: vi.fn<(ws: string) => string>((ws: string) => `/fake/spec/dir/${ws}`),
}));
vi.mock('../../src/spec-sync.js', () => ({
  pullSpecBundle: specSyncMocks.pullSpecBundle,
  postSpecSync: specSyncMocks.postSpecSync,
  resolveSpecDir: specSyncMocks.resolveSpecDir,
}));

// node:child_process.spawn 必须在 task-runner import 前 mock（task-09 同模式）。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

// getBackend 返回 mock adapter（task-09 同模式），避免真实 provider 解析。
let mockAdapter: Record<string, unknown> = {};
vi.mock('../../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner } from '../../src/task-runner.js';
import { createFakeChild, type FakeChild } from '../helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../../src/types.js';
import type { DaemonConfig } from '../../src/config.js';

// ── 测试工具 ──────────────────────────────────────────────────────────────────

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

/**
 * stage lease 鸭子类型：LeaseCtx + workspaceId/specRoot（task-07 未合并到 types.ts，
 * task-runner 用 `(ctx as {workspaceId?: string})` 读取，对齐 task-09 LooseLeaseCtx）。
 *
 * stage 特征（§0 修正表）：kind='batch' + agent_run_id 非空 + metadata 含 stage。
 * transport/workspaceId/spec_root 从 daemon execution-context 透传到 ctx。
 */
interface StageLeaseCtx extends LeaseCtx {
  workspaceId?: string;
  specRoot?: string | null;
  transport?: string;
  stage?: string;
}

/**
 * 构造一个 stage 类型的 batch lease payload。
 *
 * - workspaceId 非空 + specRoot=null：触发 task-runner 步骤 1.5 pull（tar 模式约定，
 *   daemon-client execution-context 不透传 spec_root，留空触发 pull）。
 * - stage: propose/plan/execute 等（证明 stage 子阶段不影响 spec-sync）。
 * - transport: tar/shared（task-runner 自身不读 transport，transport 决定的是
 *   pullSpecBundle 是否返回非 null —— 本组通过 mock pullSpecBundle 返回值模拟）。
 */
function makeStageLease(overrides: Partial<StageLeaseCtx> = {}): StageLeaseCtx {
  return {
    leaseId: 'lease-stage-1',
    runtimeId: 'rt-stage-1',
    claimToken: 'tok-stage',
    workspaceName: 'stage-ws',
    claudeMd: '',
    prompt: 'stage prompt',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: '00000000-0000-0000-0000-000000000001', // batch 特征：非空
    workspaceId: 'ws-stage-1',
    specRoot: null, // tar 模式留空触发 pull
    transport: 'tar',
    stage: 'propose',
    ...overrides,
  };
}

interface SpecClient {
  startLease: ReturnType<typeof vi.fn>;
  submitMessages: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  leaseHeartbeat?: ReturnType<typeof vi.fn>;
  // 注：E 组 vi.mock 了 spec-sync，client 的 getSpecBundle/postSpecSync 不再被
  // task-runner 直接调用（utility 内部调），但保留字段以匹配 ClientLike 形状。
  getSpecBundle: ReturnType<typeof vi.fn>;
  postSpecSync: ReturnType<typeof vi.fn>;
}

function makeMockClient(overrides: Partial<SpecClient> = {}): SpecClient {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({}),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    getSpecBundle: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    ...overrides,
  };
}

function makeMockWorkspace(): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/stage'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/ws/stage'),
  };
}

function makeMockCred(): Record<string, unknown> {
  return { get: vi.fn(() => undefined), buildEnv: vi.fn().mockReturnValue({}) };
}

function makeNoRetryConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
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
    ...overrides,
  };
}

function setupRunner(opts: {
  client?: SpecClient;
  adapter?: Record<string, unknown>;
  config?: DaemonConfig;
}): {
  runner: TaskRunner;
  client: SpecClient;
} {
  const client = opts.client ?? makeMockClient();
  const workspace = makeMockWorkspace();
  const cred = makeMockCred();
  mockAdapter = opts.adapter ?? defaultMockAdapter();
  const config = opts.config ?? makeNoRetryConfig();
  const runner = new TaskRunner(client as never, workspace as never, cred as never, config);
  return { runner, client };
}

function mockSpawnReturn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child as never);
}

/**
 * 等到 spawn 被调用一次（calls 数量 > baseline）。
 * spec pull 是 async（task-runner 步骤 1.5 await pullSpecBundle），spawn 比
 * prepareWorkspace 晚一拍；显式等 calls 增加避免 exit emit 早于 spawn 死锁
 * （对齐 task-09-spec-pull-push.test.ts 的 waitForNextSpawn 模式）。
 */
async function waitForNextSpawn(baseline = 0): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (vi.mocked(spawn).mock.calls.length > baseline) {
      await new Promise<void>((r) => setImmediate(r));
      return;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
  await new Promise<void>((r) => setImmediate(r));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter = defaultMockAdapter();
  vi.mocked(spawn).mockReturnValue(null as never);
  // 恢复 spec-sync mock 默认行为（成功返回路径 + 成功 sync）
  specSyncMocks.pullSpecBundle.mockResolvedValue('/fake/spec/dir');
  specSyncMocks.postSpecSync.mockResolvedValue({ ok: true, reparsed: 0 });
  specSyncMocks.resolveSpecDir.mockImplementation((ws: string) => `/fake/spec/dir/${ws}`);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── E 组用例 ──────────────────────────────────────────────────────────────────

describe('task-11 E 组：task-runner batch stage lease spec-sync（task-05+task-11, D-007@v1）', () => {
  // ── E1: stage lease tar 模式 pull 触发 ──────────────────────────────────────
  it('E1: stage batch lease tar 模式 → pullSpecBundle 被调、wsId 正确', async () => {
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeStageLease({ leaseId: 'lease-e1', workspaceId: 'ws-e1' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    // task-runner 步骤 1.5：pullSpecBundle(client, wsId, { existingSpecRoot })
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledTimes(1);
    // 第一参数是 client，第二参数是 wsId
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledWith(expect.anything(), 'ws-e1', {
      existingSpecRoot: null,
    });
  });

  // ── E2: stage lease tar 模式 sync 触发（步骤 8.5）────────────────────────────
  it('E2: stage batch lease tar 模式 → child exit 0 后 postSpecSync 被调、wsId+specRoot 正确', async () => {
    // pullSpecBundle 返回非 null 路径 → specRoot 非空 → 触发步骤 8.5 sync
    specSyncMocks.pullSpecBundle.mockResolvedValue('/fake/spec/dir/ws-e2');
    specSyncMocks.resolveSpecDir.mockReturnValue('/fake/spec/dir/ws-e2');
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeStageLease({ leaseId: 'lease-e2', workspaceId: 'ws-e2' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    // 步骤 8.5：postSpecSync(client, wsId, specRoot)
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledWith(
      expect.anything(),
      'ws-e2',
      '/fake/spec/dir/ws-e2',
    );
    // agent exit=0 → success，sync 不改写结果
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });

  // ── E3: stage lease shared 模式零触发（D-004）────────────────────────────────
  it('E3: stage batch lease shared 模式 → pullSpecBundle 返回 null → postSpecSync 未调（D-004）', async () => {
    // shared 模式：pullSpecBundle 返回 null（模拟 shared 时 execution-context 已带
    // spec_root 或无 wsId 跳过）→ specRoot=null → 步骤 8.5 守卫 if(specRoot) 跳过 sync。
    specSyncMocks.pullSpecBundle.mockResolvedValue(null);
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(
      makeStageLease({ leaseId: 'lease-e3', workspaceId: 'ws-e3', transport: 'shared' }),
    );
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    // pull 仍被调（task-runner 无条件调），但返回 null
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledTimes(1);
    // shared 零触发核心：sync 未被调
    expect(specSyncMocks.postSpecSync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  // ── E4: stage 子阶段覆盖（propose/plan/execute 均触发）──────────────────────
  it.each([
    { stage: 'propose' },
    { stage: 'plan' },
    { stage: 'execute' },
  ])(
    'E4: stage=$stage batch lease tar 模式 → pull+sync 均触发（stage 类型不影响 spec-sync）',
    async ({ stage }) => {
      const client = makeMockClient();
      const { runner } = setupRunner({ client });
      const fakeChild = createFakeChild();
      mockSpawnReturn(fakeChild);

      const wsId = `ws-e4-${stage}`;
      const p = runner.runLease(
        makeStageLease({ leaseId: `lease-e4-${stage}`, workspaceId: wsId, stage }),
      );
      await waitForNextSpawn();
      fakeChild._emitExit(0);
      await p;

      // 证明 stage 类型不影响 spec-sync：kind=batch 才是生效条件
      expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledWith(expect.anything(), wsId, {
        existingSpecRoot: null,
      });
      expect(specSyncMocks.postSpecSync).toHaveBeenCalledWith(
        expect.anything(),
        wsId,
        expect.any(String),
      );
    },
  );

  // ── E5: stage lease tar 模式 pull 404 容错（R-02 连带，首次 stage 场景）──────
  it('E5: stage lease tar 模式 pull 404 容错 → utility 返回非 null → postSpecSync 仍触发', async () => {
    // 模拟 utility 404 容错后的行为：getSpecBundle 404 → utility mkdir 空目录返回
    // 非 null 路径（spec-sync.ts:85-88 isHubHttp404 分支）。task-runner 此时不
    // 知道是 404，按成功 specRoot 非空走 sync（agent 生成新 design.md/plan.md 后回传）。
    specSyncMocks.pullSpecBundle.mockResolvedValue('/fake/spec/dir/ws-e5-404-empty');
    specSyncMocks.resolveSpecDir.mockReturnValue('/fake/spec/dir/ws-e5-404-empty');
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeStageLease({ leaseId: 'lease-e5', workspaceId: 'ws-e5' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    // pull 返回非 null（404 容错后）→ specRoot 非空 → sync 触发
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledWith(expect.anything(), 'ws-e5', {
      existingSpecRoot: null,
    });
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledWith(
      expect.anything(),
      'ws-e5',
      '/fake/spec/dir/ws-e5-404-empty',
    );
  });

  // ── E6: stage lease tar 模式 sync 失败不阻塞（R-03 连带）────────────────────
  it('E6: stage lease tar 模式 postSpecSync reject → runLease 不抛错、success 按 child exitCode（R-03）', async () => {
    specSyncMocks.pullSpecBundle.mockResolvedValue('/fake/spec/dir/ws-e6');
    specSyncMocks.resolveSpecDir.mockReturnValue('/fake/spec/dir/ws-e6');
    // sync 失败（413/5xx 等）
    specSyncMocks.postSpecSync.mockRejectedValue(new Error('HTTP 413 POST .../sync'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeStageLease({ leaseId: 'lease-e6', workspaceId: 'ws-e6' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    // R-03：sync 失败仅 warn，_finish 仍按 agent exitCode/status 汇总
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    // task-runner.ts:499 容错日志
    const warnCalls = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(warnCalls).toContain('spec_sync_failed');
    warnSpy.mockRestore();
  });
});
