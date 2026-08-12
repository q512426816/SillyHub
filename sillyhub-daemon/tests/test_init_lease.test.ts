// tests/test_init_lease.ts
// 2026-07-02-workspace-config-flow task-07：daemon init lease 处理单测。
// + 2026-07-07-platform-json-contract-align（D-001@v1）：daemon 退出 .sillyspec-platform.json，
//   状态独立到 resolveSpecDir(workspaceId)/.runtime/spec-version.json（2 字段 spec_version + synced_at）。
//
// 覆盖（design §5 / §9 生命周期契约 / §10 W2 验收）：
//   - handleInitLease：成功 → 返回 { ok, specVersion, daemonState }（验证返回值，不读落盘——
//     handleInitLease 内部 writeDaemonState 写 resolveSpecDir(wsId) 即真实家目录缓存区，
//     用测试 wsId 隔离 + afterAll 清理，避免污染真实工作区 UUID）。
//   - writeDaemonState 单元：直接传 tmp specCacheRoot，验证落盘 2 字段。
//   - TaskRunner.runLease mode='init'：不 spawn agent，终态 completed，stats init_synced_*。
//
// 注：不 mock node:os.homedir（vitest ESM 下 vi.mock 对 spec-sync.ts 内部 homedir 穿透不稳），
// 改用真实 resolveSpecDir + 测试 wsId（非真实 UUID）隔离 + afterAll 清理。
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));

// task-12：local-yaml-writer 模块级 mock——默认透传真实实现（成功/url 用例真实落盘到 tmp rootPath，
// afterEach 清理），失败用例内联 mockRejectedValueOnce 令 writeLocalYaml 抛 Error('write boom')，
// 验证 handleInitLease 第4步 try/catch 转 ok:false（D-003 严格契约，逐步 catch 非顶层 catch）。
// 既有用例不传 local_yaml → handleInitLease 第4步跳过 → writeLocalYaml 不被调，mock 互不影响（扩展非重写）。
const { localYamlWriterMock } = vi.hoisted(() => ({ localYamlWriterMock: vi.fn() }));
vi.mock('../src/local-yaml-writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/local-yaml-writer.js')>();
  // 默认透传：成功/url 用例依赖真实写盘以断言落盘内容（D-002 url 来源）
  localYamlWriterMock.mockImplementation(
    (...args: Parameters<typeof actual.writeLocalYaml>) => actual.writeLocalYaml(...args),
  );
  return { ...actual, writeLocalYaml: localYamlWriterMock };
});

import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import {
  handleInitLease,
  writeDaemonState,
  DAEMON_STATE_FILENAME,
  resolveSpecDir,
} from '../src/spec-sync.js';

// 测试用 workspaceId 前缀（非真实 UUID，不碰撞真实工作区缓存）。afterAll 统一清理。
const TEST_WS_IDS = [
  'ws-init-ok', 'ws-init-defaults', 'ws-init-404', 'ws-init-5xx', 'ws-init-postfail',
  'ws-runner-ver', 'ws-init-1',
  // task-12：handleInitLease 第4步 writeLocalYaml 新增用例（仍经 resolveSpecDir 写 daemon 状态文件）
  'ws-init-yaml-ok', 'ws-init-yaml-fail', 'ws-init-yaml-url',
];
afterAll(async () => {
  await Promise.all(
    TEST_WS_IDS.map((wsId) =>
      rm(resolveSpecDir(wsId), { recursive: true, force: true }).catch(() => {}),
    ),
  );
});

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

describe('handleInitLease / daemon 状态文件 (task-07 / D-001@v1)', () => {
  it('成功：写状态文件 + pull + post，返回 ok + specVersion + daemonState（2 字段）', async () => {
    const client = makeClient();
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-ok',
      rootPath: '/tmp/init-lease-rootpath-unused', // D-001@v1：rootPath 不再被 daemon 写
      serverOrigin: 'https://platform.example.com',
      strategy: 'platform-managed',
      latestSpecVersion: 3,
    });

    // 终态成功，specVersion 透传 latestSpecVersion，daemonState 含 2 字段
    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(3);
    expect(result.daemonState).not.toBeNull();
    expect(result.daemonState!.spec_version).toBe(3);
    expect(typeof result.daemonState!.synced_at).toBe('string');
    expect(result.daemonState!.synced_at.length).toBeGreaterThan(0);
    expect(result.specDir).not.toBeNull();

    // pull + post 均被调用一次
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
    expect(client.getSpecBundle).toHaveBeenCalledWith('ws-init-ok');
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(client.postSpecSync).toHaveBeenCalledWith('ws-init-ok', expect.any(Buffer));

    // D-001@v1：不再写 {rootPath}/.sillyspec-platform.json（rootPath 是 dummy，验证不产生该文件）
    await expect(readFile(join('/tmp/init-lease-rootpath-unused', '.sillyspec-platform.json'))).rejects.toThrow();
  });

  it('latestSpecVersion 缺省 → spec_version=0', async () => {
    const client = makeClient();
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-defaults',
      rootPath: '/tmp/x',
      serverOrigin: 'http://test:8000',
    });

    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(0);
    expect(result.daemonState!.spec_version).toBe(0);
  });

  it('getSpecBundle 404 → pullSpecBundle 容错 mkdir 空目录，init 仍成功（首次未扫描）', async () => {
    const client = makeClient({
      getSpecBundle: vi.fn().mockRejectedValue({ status: 404 }),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-404',
      rootPath: '/tmp/x',
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.specDir).not.toBeNull(); // 404 容错返回空 specDir
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
  });

  it('pullSpecBundle 抛 5xx → ok=false abort，daemonState 已写（步骤 1 完成）', async () => {
    const client = makeClient({
      getSpecBundle: vi.fn().mockRejectedValue({ status: 500, bodyText: 'boom' }),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-5xx',
      rootPath: '/tmp/x',
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/spec_bundle_pull_failed/);
    // daemonState 在 pull 失败返回中仍透传（步骤 1 已完成）
    expect(result.daemonState).not.toBeNull();
    expect(result.daemonState!.spec_version).toBe(2);
    // post 不应被调用（pull 失败 abort 在 post 之前）
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('postSpecSync 抛错 → ok 不变（R-03 软失败，init 主体成功）', async () => {
    const client = makeClient({
      postSpecSync: vi.fn().mockRejectedValue(new Error('post boom')),
    });
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-postfail',
      rootPath: '/tmp/x',
      serverOrigin: 'http://test:8000',
      latestSpecVersion: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.specVersion).toBe(1);
  });

  // ── writeDaemonState 单元（取代旧 writePlatformConfig/readPlatformConfig 往返用例）──
  // 直接传 tmp specCacheRoot（不经 resolveSpecDir），验证落盘 2 字段。

  it('writeDaemonState 写 2 字段并落盘到 {specCacheRoot}/.runtime/spec-version.json', async () => {
    const specCacheRoot = await mkdtemp(join(tmpdir(), 'wds-root-'));
    try {
      const written = await writeDaemonState(specCacheRoot, { spec_version: 7 });
      expect(written.spec_version).toBe(7);
      expect(typeof written.synced_at).toBe('string');

      const st = JSON.parse(
        await readFile(join(specCacheRoot, DAEMON_STATE_FILENAME), 'utf-8'),
      ) as Record<string, unknown>;
      expect(st.spec_version).toBe(7);
      expect(st.synced_at).toBe(written.synced_at);
      // D-001@v1：只 2 字段，无旧 6 字段残留
      expect(st.workspace_id).toBeUndefined();
      expect(st.server_origin).toBeUndefined();
    } finally {
      await rm(specCacheRoot, { recursive: true, force: true });
    }
  });

  it('writeDaemonState 缺 specCacheRoot → 抛错（init lease 必带 workspaceId 解析缓存根）', async () => {
    await expect(writeDaemonState('', { spec_version: 0 })).rejects.toThrow(/specCacheRoot/);
  });

  it('writeDaemonState 不破坏缓存目录既有内容', async () => {
    const specCacheRoot = await mkdtemp(join(tmpdir(), 'wds-keep-'));
    try {
      await mkdir(join(specCacheRoot, 'docs'), { recursive: true });
      await writeFile(join(specCacheRoot, 'docs', 'keep.md'), 'keep me');

      await writeDaemonState(specCacheRoot, { spec_version: 0 });

      const kept = await readFile(join(specCacheRoot, 'docs', 'keep.md'), 'utf-8');
      expect(kept).toBe('keep me');
    } finally {
      await rm(specCacheRoot, { recursive: true, force: true });
    }
  });
});

// ── handleInitLease 第4步 writeLocalYaml（task-12 / D-003 / D-002）──────────────
//
// 覆盖 design §5.4（init lease 第4步 writeLocalYaml）+ §7.3（local.yaml writer 契约）+
// decisions.md D-003（严格契约：写盘失败=init 失败，handleInitLease 逐步 try/catch 返 ok:false，
// 非顶层 catch 不上抛）+ D-002（url 用 task-runner 透传的 serverOrigin=config.server_url，
// 不读 payload.platform_config.server_origin）。
//
// localYamlWriterMock 默认透传真实 writeLocalYaml（成功/url 用例真实落盘到 tmp rootPath，
// afterEach 清理）；失败用例 mockRejectedValueOnce 令其抛 Error('write boom')。既有用例不传
// local_yaml → handleInitLease 第4步跳过 → mock 不被调（扩展非重写，零回归）。

describe('handleInitLease 第4步 writeLocalYaml (task-12 / D-003 / D-002)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    // 清上一用例调用计数（mockClear 不动 factory 设的 standing passthrough 实现）
    localYamlWriterMock.mockClear();
    tmpRoot = await mkdtemp(join(tmpdir(), 'init-yaml-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('写 local.yaml 成功 → ok:true（platform url=serverOrigin + mcp url=serverOrigin/mcp 两段 token 正确）', async () => {
    const client = makeClient();
    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-yaml-ok',
      rootPath: tmpRoot,
      serverOrigin: 'https://hub.example.com',
      local_yaml: { platform_token: 'shpsync_x', mcp_token: 'shmcp_y' },
    });

    // 第4步被调一次，透传 rootPath + tokens + serverOrigin
    expect(result.ok).toBe(true);
    expect(localYamlWriterMock).toHaveBeenCalledTimes(1);
    expect(localYamlWriterMock).toHaveBeenCalledWith(
      tmpRoot,
      { platform_token: 'shpsync_x', mcp_token: 'shmcp_y' },
      'https://hub.example.com',
    );

    // 落盘 local.yaml：platform 段 url=serverOrigin token=shpsync_x，mcp 段 url=serverOrigin+'/mcp' token=shmcp_y
    const written = await readFile(join(tmpRoot, '.sillyspec', 'local.yaml'), 'utf-8');
    expect(written).toContain('platform:');
    expect(written).toContain('url: https://hub.example.com\n  token: shpsync_x');
    expect(written).toContain('mcp:');
    expect(written).toContain('url: https://hub.example.com/mcp\n  token: shmcp_y');
  });

  it('writeLocalYaml 抛错 → result.ok===false（D-003：第4步 try/catch 逐步返 ok:false，非顶层 catch 不上抛）', async () => {
    const client = makeClient();
    // 一次性令 writeLocalYaml 抛 Error('write boom')（standing passthrough 不变，仅本次用例）
    localYamlWriterMock.mockRejectedValueOnce(new Error('write boom'));

    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-yaml-fail',
      rootPath: tmpRoot,
      serverOrigin: 'https://hub.example.com',
      local_yaml: { platform_token: 'shpsync_x', mcp_token: 'shmcp_y' },
    });

    // D-003：写盘失败 = init 整体失败，但 handleInitLease 逐步 catch 返 ok:false（不抛错）
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/local_yaml_write_failed/);
    expect(result.error).toMatch(/write boom/);
    // 步骤 1-3 已完成：daemonState / specDir 仍透传（证明非顶层 catch 一锅端 null）
    expect(result.daemonState).not.toBeNull();
    expect(result.specDir).not.toBeNull();
    expect(localYamlWriterMock).toHaveBeenCalledTimes(1);
  });

  it('url 用 task-runner 透传的 serverOrigin（D-002：不读 payload.platform_config.server_origin）', async () => {
    const client = makeClient();
    const runnerOrigin = 'https://from-runner.example.com';

    const result = await handleInitLease(client as never, {
      workspaceId: 'ws-init-yaml-url',
      rootPath: tmpRoot,
      serverOrigin: runnerOrigin,
      // D-002：handleInitLease 入参仅 serverOrigin（task-runner 从 config.server_url 透传，
      // 本机可达地址）；handleInitLease 不读 backend 下发的 platform_config.server_origin
      //（docker/远程部署时可能与本机可达地址不一致）——url 只取 serverOrigin。
      local_yaml: { platform_token: 'shpsync_r', mcp_token: 'shmcp_m' },
    });

    expect(result.ok).toBe(true);
    // 透传给 writeLocalYaml 的 url 正是 task-runner 透传的 serverOrigin
    expect(localYamlWriterMock).toHaveBeenCalledWith(
      tmpRoot,
      { platform_token: 'shpsync_r', mcp_token: 'shmcp_m' },
      runnerOrigin,
    );
    // 落盘 platform 段 url=runnerOrigin（非 backend 的 server_origin），mcp 段 url=runnerOrigin+'/mcp'
    const written = await readFile(join(tmpRoot, '.sillyspec', 'local.yaml'), 'utf-8');
    expect(written).toContain('url: https://from-runner.example.com\n  token: shpsync_r');
    expect(written).toContain('url: https://from-runner.example.com/mcp\n  token: shmcp_m');
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
    rootPath: '/tmp/init-lease-rootpath', // D-001@v1：rootPath 不再被 daemon 写，仅 lease payload 完整性
    ...overrides,
  } as LeaseCtx & { mode: string };
}

describe("TaskRunner.runLease mode='init' 分支 (task-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mode=init → 不 spawn agent（getBackend/spawn 不调），终态 completed', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease();

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

  it('platform_config 透传 latest_spec_version=5 → stats.init_synced_spec_version=5', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease({
      workspaceId: 'ws-runner-ver',
      // @ts-expect-error platform_config 鸭子类型（backend task-06 下发）
      platform_config: {
        server_origin: 'https://hub.example.com',
        strategy: 'repo-mirrored',
        latest_spec_version: 5,
      },
    });

    const result = await runner.runLease(lease);

    expect(result.success).toBe(true);
    // D-001@v1：spec_version 透传到 stats（落盘到 resolveSpecDir('ws-runner-ver')/.runtime/，
    //   由 afterAll 统一清理，不在此读文件验证——避免 mock homedir 穿透问题）
    expect(result.stats!.init_synced_spec_version).toBe(5);
    // init_daemon_state 取代旧 init_platform_config（free-form stats，D-001@v1）
    expect(result.stats).toMatchObject({ init_synced: true });
  });

  it('缺 workspaceId → failed，stats.init_synced=false', async () => {
    const { runner } = setupRunner();
    const lease = makeInitLease({
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
    const lease = makeInitLease();

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

// 防止 "homedir 未使用" lint（清理路径预留扩展用）
void homedir;
