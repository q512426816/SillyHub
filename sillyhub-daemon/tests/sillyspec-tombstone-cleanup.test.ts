/**
 * 2026-10-09-tombstone-conflict-root-fix task-03：daemon 墓碑收敛执行器全链路测试
 * （FR-03 / D-001@v1 / design Phase 2 第 3 步）。
 *
 * 覆盖行为矩阵：
 *   - manager 执行器（runTombstoneCleanup）：目录定位（活跃区→归档区）→ 隔离区
 *     移动（tombstone-quarantine/<名>-<时间戳>/，移动不删除）→ doctor 归档 →
 *     成功回执（action='tombstone_cleanup' 携 change）；幂等（目录不在 = success
 *     零副作用，重放安全）；rename 失败 → failed 带错误摘要；根解析（带 ws 未
 *     命中 → failed 不回退单槽位，同 runResolve 铁律）。
 *   - daemon case 分发：SILLYSPEC_TOMBSTONE_CLEANUP 合法 payload →
 *     executor.runTombstoneCleanup(change, workspaceId) 原样透传；缺
 *     change/workspace_id → warn 丢弃不调用。
 *
 * 策略：manager 层照 sillyspec-platform-command.test.ts 惯例（依赖注入 +
 * runProgressJson 假实现，文件 IO 用 tmpdir 真实目录断言 rename 结果）；
 * daemon 层照 makeDispatchHarness 假 executor 惯例。Windows 安全（无真实进程）。
 *
 * @module sillyspec-tombstone-cleanup.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Daemon } from '../src/daemon.js';
import { SillySpecManager } from '../src/sillyspec-manager.js';
import type { SillySpecProgressOutcome } from '../src/sillyspec-manager.js';
import type { DaemonConfig } from '../src/config.js';
import type { DaemonMessage } from '../src/types.js';
import { MSG } from '../src/protocol.js';

// ── 公共 fixture ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-tomb03',
    profile: 'default',
    workspace_dir: '/tmp/ws-tomb03',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'debug',
    default_timeout_seconds: 1800,
    max_retries: 1,
    retry_max_attempts: 3,
    retry_base_delay_ms: 1000,
    retry_backoff_factor: 2,
    retry_jitter: 0.2,
    loop_restart_backoff_ms: 5000,
    max_loop_restarts: 10,
    outbox_max_per_run: 500,
    outbox_max_total: 5000,
    disconnect_log_threshold_sec: 30,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: [],
    spec_root_map: '',
    self_reload_check_interval_sec: 600,
    sillyspec_update_interval_sec: 9999,
    sillyspec_status_interval_sec: 0,
    sillyspec_command_timeout_sec: 120,
    ...overrides,
  };
}

const BIN = 'C:\\Users\\qinyi\\Idea Projects\\repo\\node_modules\\sillyspec\\bin\\sillyspec.js';

const tmpRoots: string[] = [];
function makeRepoFixture(withChange = true, archived = false): string {
  const repo = mkdtempSync(join(tmpdir(), `tomb-cleanup-${process.pid}-`));
  tmpRoots.push(repo);
  const rel = archived
    ? join('.sillyspec', 'changes', 'archive', 'demo-chg')
    : join('.sillyspec', 'changes', 'demo-chg');
  if (withChange) {
    const dir = join(repo, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), 'deleted content\n', 'utf8');
  }
  return repo;
}
afterEach(() => {
  for (const t of tmpRoots.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** manager harness：runProgressJson 假实现记录 spawn 调用，cwd=repo 根。 */
function makeManagerHarness(repo: string, opts: { rootFor?: (ws: string) => string | null } = {}) {
  const calls: { bin: string; args: string[]; cwd: string }[] = [];
  const runProgressJson = async (
    _exec: string,
    [bin, ...args]: string[],
    runOpts: { cwd?: string },
  ): Promise<SillySpecProgressOutcome> => {
    calls.push({ bin, args, cwd: runOpts.cwd ?? '' });
    return { code: 0, stdout: '', timedOut: false };
  };
  const manager = new SillySpecManager({
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => 1_700_000_000_000,
    logger: () => undefined,
    runProgressJson,
    resolveSillySpecBin: () => BIN,
    statusCwd: () => repo,
    statusRootFor: opts.rootFor ?? (() => repo),
    statusTimeoutMs: 5,
    commandTimeoutMs: 120_000,
  });
  return { manager, calls };
}

function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

// ── manager 执行器 ───────────────────────────────────────────────────────────

describe('task-03 runTombstoneCleanup：隔离区收敛执行器', () => {
  let restoreConsole: () => void;
  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('活跃区目录在位 → 移动到 tombstone-quarantine/<名>-<时间戳>/ + doctor 归档 + success 回执', async () => {
    const repo = makeRepoFixture(true);
    const h = makeManagerHarness(repo);

    await h.manager.runTombstoneCleanup('demo-chg');

    // 源目录已移走（移动不删除：隔离区可寻回）
    expect(existsSync(join(repo, '.sillyspec', 'changes', 'demo-chg'))).toBe(false);
    const runtime = join(repo, '.sillyspec', '.runtime', 'tombstone-quarantine');
    const entries = existsSync(runtime) ? lsDir(runtime) : [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^demo-chg-\d{8}-\d{6}$/);
    expect(
      existsSync(join(runtime, entries[0], 'proposal.md')),
    ).toBe(true);

    // doctor 归档链（runGhostCleanup 同款）
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].args).toEqual(['doctor', '--cleanup-ghosts', '--confirm']);
    expect(h.calls[0].cwd).toBe(repo);

    const result = h.manager.getCommandResult();
    expect(result?.action).toBe('tombstone_cleanup');
    expect(result?.change).toBe('demo-chg');
    expect(result?.state).toBe('success');
    expect(result?.exit_code).toBe(0);
  });

  it('活跃区不在、归档区在 → 归档区目录被收敛', async () => {
    const repo = makeRepoFixture(true, /* archived */ true);
    const h = makeManagerHarness(repo);

    await h.manager.runTombstoneCleanup('demo-chg');

    expect(existsSync(join(repo, '.sillyspec', 'changes', 'archive', 'demo-chg'))).toBe(false);
    const runtime = join(repo, '.sillyspec', '.runtime', 'tombstone-quarantine');
    const entries = existsSync(runtime) ? lsDir(runtime) : [];
    expect(entries).toHaveLength(1);
    expect(h.manager.getCommandResult()?.state).toBe('success');
  });

  it('幂等：目录不在（已收敛/从未存在）→ success + error 注明，零 spawn 零副作用', async () => {
    const repo = makeRepoFixture(/* withChange */ false);
    const h = makeManagerHarness(repo);

    await h.manager.runTombstoneCleanup('demo-chg');

    expect(h.calls).toHaveLength(0);
    expect(existsSync(join(repo, '.sillyspec', '.runtime', 'tombstone-quarantine'))).toBe(false);
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('success');
    expect(result?.error).toContain('目录已不在本地');
  });

  it('隔离区路径被文件占位 → mkdir/rename 失败走 failed 带错误摘要，源目录保留', async () => {
    const repo = makeRepoFixture(true);
    const h = makeManagerHarness(repo);
    // 预占：tombstone-quarantine 本身是一个文件 → mkdirSync(recursive) 抛
    // ENOTDIR/EEXIST → 与 renameSync 同 catch → failed 回执（移动不产生半态）。
    const blocker = join(repo, '.sillyspec', '.runtime', 'tombstone-quarantine');
    mkdirSync(join(repo, '.sillyspec', '.runtime'), { recursive: true });
    writeFileSync(blocker, 'not a dir\n', 'utf8');

    await h.manager.runTombstoneCleanup('demo-chg');

    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('隔离区移动失败');
    // 源目录未被破坏（失败不产生半态）；doctor 不进（移动失败提前终止）
    expect(existsSync(join(repo, '.sillyspec', 'changes', 'demo-chg', 'proposal.md'))).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it('带 ws 且映射未命中 → failed（尚未认领）不回退单槽位不 spawn', async () => {
    const repo = makeRepoFixture(true);
    const otherRepo = makeRepoFixture(false); // 单槽位根（不应被用）
    const h = makeManagerHarness(otherRepo, { rootFor: () => null });

    await h.manager.runTombstoneCleanup('demo-chg', 'ws-uuid-1');

    expect(h.calls).toHaveLength(0);
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('尚未被本机会话认领');
    // repo（映射应指向的根）未被误动
    expect(existsSync(join(repo, '.sillyspec', 'changes', 'demo-chg'))).toBe(true);
  });
});

function lsDir(p: string): string[] {
  return readdirSync(p);
}

// ── daemon case 分发 ─────────────────────────────────────────────────────────

describe('task-03 case 分发：SILLYSPEC_TOMBSTONE_CLEANUP 直连路由', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  function makeDispatchHarness() {
    const manager = {
      getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
      probeLocal: vi.fn(async () => null),
      probeLatest: vi.fn(async () => null),
      requestUpgrade: vi.fn(async () => undefined),
      requestManualUpgrade: vi.fn(async () => undefined),
      checkAndUpgrade: vi.fn(async () => undefined),
      getStatusSnapshot: vi.fn(() => undefined),
      runResolve: vi.fn(async (): Promise<void> => undefined),
      runGhostCleanup: vi.fn(async (): Promise<void> => undefined),
      runTombstoneCleanup: vi.fn(async (): Promise<void> => undefined),
      isUpgradeInFlight: vi.fn(() => false),
      recordCommandResult: vi.fn(),
      getCommandResult: vi.fn((): null => null),
    };
    const daemon = new Daemon(
      makeConfig(),
      { heartbeat: vi.fn(async () => ({})) } as never,
      null as never,
      {
        sessionManager: null,
        sillyspecManager: manager as never,
      },
    );
    const handleWsMessage = (msg: DaemonMessage): Promise<void> =>
      (daemon as unknown as { _handleWsMessage: (m: DaemonMessage) => Promise<void> })
        ._handleWsMessage(msg);
    return { daemon, manager, handleWsMessage };
  }

  it('合法 payload → runTombstoneCleanup(change, workspaceId) 原样透传', async () => {
    const h = makeDispatchHarness();
    await expect(
      h.handleWsMessage({
        type: MSG.SILLYSPEC_TOMBSTONE_CLEANUP,
        payload: {
          change: '2026-10-09-demo-change',
          workspace_id: 'b97f8231-9404-43bd-89de-38c281c4d875',
        },
      }),
    ).resolves.toBeUndefined();
    expect(h.manager.runTombstoneCleanup).toHaveBeenCalledTimes(1);
    expect(h.manager.runTombstoneCleanup).toHaveBeenCalledWith(
      '2026-10-09-demo-change',
      'b97f8231-9404-43bd-89de-38c281c4d875',
    );
  });

  it.each([
    ['缺 change', { workspace_id: 'ws-1' }],
    ['缺 workspace_id', { change: 'chg' }],
    ['空 change', { change: '', workspace_id: 'ws-1' }],
  ])('%s → warn 丢弃不调用执行器', async (_name, payload) => {
    const h = makeDispatchHarness();
    await expect(
      h.handleWsMessage({
        type: MSG.SILLYSPEC_TOMBSTONE_CLEANUP,
        payload: payload as Record<string, unknown>,
      }),
    ).resolves.toBeUndefined();
    expect(h.manager.runTombstoneCleanup).not.toHaveBeenCalled();
  });
});
