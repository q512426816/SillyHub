// tests/test_init_lease.ts
// 2026-07-02-workspace-config-flow task-07：daemon init lease 处理单测。
//
// 覆盖（design §5 / §7 / §9 生命周期契约 / §10 W2 验收）：
//   - handleInitLease（spec-sync.ts 纯函数 + client 注入）：
//       * 成功 → 写 .sillyspec-platform.json（6 字段）+ pullSpecBundle + postSpecSync，
//         返回 { ok:true, specVersion=latestSpecVersion, platformConfig }。
//       * platform.json 写失败（rootPath 不可写）→ ok=false abort。
//       * pullSpecBundle 抛错（5xx，非 404）→ ok=false abort，platform.json 已写。
//       * postSpecSync 抛错 → ok 不变（R-03 软失败，仅 warn）。
//       * 404 容错：getSpecBundle 404 → pullSpecBundle 内 mkdir 空目录返回非 null，init 仍成功。
//   - TaskRunner.runLease mode='init' 分支（task-runner.ts）：
//       * mode='init' → 不 spawn agent（getBackend 不被调），终态 completed，
//         stats 携带 init_synced_at + init_synced_spec_version。
//       * 缺 workspaceId/rootPath → failed，stats.init_synced=false。
//       * 非 init mode（缺省）→ 落入既有 spawn 编排（init 分支不触发）。
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。
//   （task-16：原文件名缺 .test 后缀 → 被 include glob 漏选 → 重命名为 .test.ts 纳入默认套件。）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── handleInitLease 单测（spec-sync.ts，纯函数）────────────────────────────────

import {
  handleInitLease,
  writePlatformConfig,
  readPlatformConfig,
  PLATFORM_CONFIG_FILENAME,
} from '../src/spec-sync.js';

/** 构造 mock client：getSpecBundle 返回最小 tar / postSpecSync 返回 { ok, reparsed }。 */
function makeClient(overrides: {
  getSpecBundle?: ReturnType<typeof vi.fn>;
  postSpecSync?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getSpecBundle:
      overrides.getSpecBundle ?? vi.fn().mockResolvedValue(Buffer.alloc(0)),
    postSpecSync:
      overrides.postSpecSync ??
      vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
  };
}

describe('handleInitLease / platform.json 读写 (task-07)', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'init-lease-root-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('成功：写 platform.json（6 字段）+ pull + post，返回 ok + specVersion', async () => {
    const client = makeClient();
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-ok',
      rootPath: rootDir,
      serverOrigin: 'https://platform.example.com',
      strategy: 'platform-managed',
      latestSpecVersion: 3,
    });

    // 终态成功，specVersion 透传 latestSpecVersion
    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(3);
    expect(result.platformConfig).not.toBeNull();
    expect(result.specDir).not.toBeNull();

    // platform.json 落盘 6 字段（design §7 schema）
    const cfg = JSON.parse(
      await readFile(join(rootDir, PLATFORM_CONFIG_FILENAME), 'utf-8'),
    ) as Record<string, unknown>;
    expect(cfg.workspace_id).toBe('ws-init-ok');
    expect(cfg.server_origin).toBe('https://platform.example.com');
    expect(cfg.strategy).toBe('platform-managed');
    expect(cfg.spec_version).toBe(3);
    expect(typeof cfg.cache_root).toBe('string');
    expect((cfg.cache_root as string).length).toBeGreaterThan(0);
    expect(typeof cfg.synced_at).toBe('string');
    expect((cfg.synced_at as string).length).toBeGreaterThan(0);

    // pull + post 均被调用一次
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
    expect(client.getSpecBundle).toHaveBeenCalledWith('ws-init-ok');
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(client.postSpecSync).toHaveBeenCalledWith('ws-init-ok', expect.any(Buffer));
  });

  it('strategy 缺省 → platform-managed；latestSpecVersion 缺省 → spec_version=0', async () => {
    const client = makeClient();
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-defaults',
      rootPath: rootDir,
      serverOrigin: 'http://test:8000',
    });

    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(0);
    const cfg = result.platformConfig!;
    expect(cfg.strategy).toBe('platform-managed');
    expect(cfg.spec_version).toBe(0);
  });

  it('getSpecBundle 404 → pullSpecBundle 容错 mkdir 空目录，init 仍成功（首次未扫描）', async () => {
    // 404 容错在 pullSpecBundle 内部：抛 {status:404} 被捕获 → mkdir 空目录返回路径。
    // handleInitLease 不感知 404，只看 pullSpecBundle 是否抛错。
    const client = makeClient({
      getSpecBundle: vi.fn().mockRejectedValue({ status: 404 }),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-404',
      rootPath: rootDir,
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.specDir).not.toBeNull(); // 404 容错返回空 specDir
    // post 仍触发（specDir 非空 → 尝试回灌空目录，best-effort）
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
  });

  it('pullSpecBundle 抛 5xx → ok=false abort，platform.json 已写', async () => {
    const client = makeClient({
      getSpecBundle: vi.fn().mockRejectedValue({ status: 500, bodyText: 'boom' }),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-5xx',
      rootPath: rootDir,
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/spec_bundle_pull_failed/);
    // platform.json 已在步骤 1 写入（abort 不回滚）
    const cfg = await readPlatformConfig(rootDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.workspace_id).toBe('ws-init-5xx');
    // post 不应被调用（pull 失败 abort 在 post 之前）
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('postSpecSync 抛错 → ok 不变（R-03 软失败，init 主体成功）', async () => {
    const client = makeClient({
      postSpecSync: vi.fn().mockRejectedValue(new Error('post boom')),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-postfail',
      rootPath: rootDir,
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 1,
    });

    // post 失败仅 warn，不改写 ok
    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(1);
  });

  it('writePlatformConfig + readPlatformConfig 往返一致', async () => {
    const written = await writePlatformConfig(rootDir, {
      workspace_id: 'ws-rt',
      server_origin: 'http://x',
      strategy: 'repo-mirrored',
      spec_version: 7,
      cache_root: '/home/me/.sillyhub/daemon/specs/ws-rt',
    });
    expect(written.synced_at).toBeTruthy();

    const read = await readPlatformConfig(rootDir);
    expect(read).toEqual(written);
  });

  it('readPlatformConfig 文件不存在 → null', async () => {
    const read = await readPlatformConfig(rootDir);
    expect(read).toBeNull();
  });

  it('writePlatformConfig 缺 rootPath → 抛错（init lease 必带 root_path）', async () => {
    await expect(
      writePlatformConfig('', {
        workspace_id: 'ws',
        server_origin: 'http://x',
        strategy: 'platform-managed',
        spec_version: 0,
        cache_root: '/c',
      }),
    ).rejects.toThrow(/rootPath/);
  });

  it('已存在的 rootPath 写 platform.json 不破坏既有目录内容', async () => {
    // rootPath 下已有其他文件 → writePlatformConfig 不应清空
    await mkdir(join(rootDir, 'sub'), { recursive: true });
    await writeFile(join(rootDir, 'sub', 'keep.md'), 'keep me');

    await writePlatformConfig(rootDir, {
      workspace_id: 'ws-keep',
      server_origin: 'http://x',
      strategy: 'platform-managed',
      spec_version: 0,
      cache_root: '/c',
    });

    const kept = await readFile(join(rootDir, 'sub', 'keep.md'), 'utf-8');
    expect(kept).toBe('keep me');
  });
});

// ── TaskRunner.runLease mode='init' 分支（task-runner.ts）───────────────────────
//
// mock node:child_process.spawn + adapters/getBackend，断言 init 分支不 spawn agent。

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
import { TaskRunner } from '../src/task-runner.js';
import type { LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    getSpecBundle: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
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
    ...overrides,
  };
}

function setupRunner(opts: {
  client?: Record<string, unknown>;
  config?: DaemonConfig;
} = {}) {
  const client = opts.client ?? makeMockClient();
  const workspace = makeMockWorkspace();
  const cred = makeMockCred();
  mockAdapter = { parse: vi.fn(), buildArgs: vi.fn(() => []), buildInput: vi.fn() };
  const config = opts.config ?? makeConfig();
  const runner = new TaskRunner(client as never, workspace as never, cred as never, config);
  return { runner, client };
}

function makeInitLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-init-1',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    prompt: '',
    // @ts-expect-error mode 不在 LeaseCtx 接口（鸭子类型探测，task-07 未改 types.ts）
    mode: 'init',
    workspaceId: 'ws-init-1',
    rootPath: '', // 测试运行时注入 tmp 目录
    ...overrides,
  } as LeaseCtx & { mode: string };
}

describe("TaskRunner.runLease mode='init' 分支 (task-07)", () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await mkdtemp(join(tmpdir(), 'init-lease-runner-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('mode=init → 不 spawn agent（getBackend/spawn 不调），终态 completed', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease({ rootPath: rootDir });

    const result = await runner.runLease(lease);

    // init 分支不 spawn agent
    expect(spawn).not.toHaveBeenCalled();
    expect(getBackend).not.toHaveBeenCalled();

    // 终态 completed
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);

    // stats 携带 init_synced_*（供 daemon completeLease 透传 backend 更新
    // WorkspaceMemberRuntime.init_synced_at/init_synced_spec_version）
    expect(result.stats).toBeDefined();
    expect(result.stats).toMatchObject({
      init_synced: true,
      init_synced_spec_version: 0,
    });
    expect(typeof result.stats!.init_synced_at).toBe('string');
    expect(result.stats!.init_synced_at.length).toBeGreaterThan(0);
  });

  it('platform_config 透传 latest_spec_version=5 → stats.init_synced_spec_version=5 + platform.json.spec_version=5', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease({
      rootPath: rootDir,
      // @ts-expect-error platform_config 鸭子类型（backend task-06 下发）
      platform_config: {
        server_origin: 'https://hub.example.com',
        strategy: 'repo-mirrored',
        latest_spec_version: 5,
      },
    });

    const result = await runner.runLease(lease);

    expect(result.success).toBe(true);
    expect(result.stats!.init_synced_spec_version).toBe(5);

    const cfg = JSON.parse(
      await readFile(join(rootDir, PLATFORM_CONFIG_FILENAME), 'utf-8'),
    ) as Record<string, unknown>;
    expect(cfg.spec_version).toBe(5);
    expect(cfg.server_origin).toBe('https://hub.example.com');
    expect(cfg.strategy).toBe('repo-mirrored');
  });

  it('缺 workspaceId → failed，stats.init_synced=false', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease({
      rootPath: rootDir,
      workspaceId: undefined,
    });

    const result = await runner.runLease(lease);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.stats).toMatchObject({ init_synced: false });
    expect(result.error).toMatch(/missing required fields/);
  });

  it('getSpecBundle 5xx → failed，stats.init_synced=false + init_error 含原因', async () => {
    const { runner, client } = setupRunner({
      client: makeMockClient({
        getSpecBundle: vi.fn().mockRejectedValue({ status: 500, bodyText: 'boom' }),
      }),
    });
    const lease = makeInitLease({ rootPath: rootDir });

    const result = await runner.runLease(lease);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.stats).toMatchObject({ init_synced: false });
    expect(typeof result.stats!.init_error).toBe('string');
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
  });

  it('非 init mode（缺省）→ 不走 init 分支（spawn 被调）', async () => {
    const { runner } = setupRunner();
    // 无 mode 字段的普通 batch lease → 走既有 spawn 编排（spawn 会被调用，虽因 mock 返回 null 失败）
    const lease: LeaseCtx = {
      leaseId: 'lease-batch-1',
      runtimeId: 'rt-1',
      claimToken: 'tok',
      provider: 'claude',
      cmdPath: '/usr/local/bin/claude',
      prompt: 'hello',
    };

    await runner.runLease(lease);

    // 非 init 路径触发了 spawn 调用（既有编排）
    expect(spawn).toHaveBeenCalled();
  });
});
