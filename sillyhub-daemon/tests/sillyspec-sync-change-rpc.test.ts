/**
 * 2026-10-13-change-files-refresh-sync task-03：daemon 定向上行同步全链路测试。
 *
 * 覆盖行为矩阵：
 *   - manager 执行器（runSyncChange）：无根映射 → {ok:false, reason:'no_workspace_root'}
 *     零 spawn；两条命令按序串行（platform sync --change → platform sync-docs
 *     --change，同 cwd）；成功回执 {ok:true, actions[2]}；首条失败短路（第二条
 *     不执行，cli_failed 带 failed_cmd/stderr_tail）；spawn 失败（code=null）
 *     同走 cli_failed；bin 解析失败 → cli_failed 带安装指引。
 *   - daemon handler 注册（sillyspec_sync_change 平名，与既有三 sillyspec_*
 *     同命名空间）：非法 change（../ 穿越 / 空串）→ RpcError invalid_params；
 *     非法 workspace_id → RpcError invalid_params。
 *   - 防抖（_runSyncChangeWithDebounce / D-004@v1）：in-flight 并发去重（慢
 *     promise 期间第二次回 skipped:'in_flight' 不重入 CLI）；完成后 15s TTL 内
 *     再调回 skipped:'debounced'（真实时钟，无需 fake timers）；硬帽淘汰
 *     （超 1000 条清过期 done 项）。
 *
 * 策略：manager 层照 sillyspec-tombstone-cleanup.test.ts 惯例（依赖注入 +
 * runProgressJson 假实现）；daemon 层手动调 _registerSillySpecRpcHandler 捕获
 * handler（不起 start() 循环）。Windows 安全（无真实进程）。
 *
 * @module sillyspec-sync-change-rpc.test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { Daemon } from '../src/daemon.js';
import { SillySpecManager } from '../src/sillyspec-manager.js';
import type { SillySpecProgressOutcome } from '../src/sillyspec-manager.js';
import type { DaemonConfig } from '../src/config.js';
import { RpcError } from '../src/ws-client.js';

// ── 公共 fixture ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-sync-chg',
    profile: 'default',
    workspace_dir: '/tmp/ws-sync-chg',
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

const BIN = 'C:\\repo\\node_modules\\sillyspec\\bin\\sillyspec.js';
const WS_ID = '11111111-2222-3333-4444-555555555555';
const CHANGE = '2026-10-13-demo-change';

/** manager harness：runProgressJson 假实现记录 spawn 调用（可编程 outcome）。 */
function makeManagerHarness(
  opts: {
    rootFor?: (ws: string) => string | null;
    bin?: string | null;
    outcomes?: SillySpecProgressOutcome[];
  } = {},
) {
  const calls: { bin: string; args: string[]; cwd: string }[] = [];
  const outcomes = opts.outcomes ?? [];
  let i = 0;
  const runProgressJson = async (
    _exec: string,
    [bin, ...args]: string[],
    runOpts: { cwd?: string },
  ): Promise<SillySpecProgressOutcome> => {
    calls.push({ bin, args, cwd: runOpts.cwd ?? '' });
    const o = outcomes[i++] ?? { code: 0, stdout: '', timedOut: false };
    return o;
  };
  const manager = new SillySpecManager({
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => 1_700_000_000_000,
    logger: () => undefined,
    runProgressJson,
    resolveSillySpecBin: () => (opts.bin === undefined ? BIN : opts.bin),
    statusCwd: () => 'C:\\repo',
    statusRootFor: opts.rootFor ?? (() => 'C:\\repo'),
    statusTimeoutMs: 5,
    commandTimeoutMs: 120_000,
  });
  return { manager, calls };
}

/** daemon harness：真实 Daemon 构造（假 client），手动注册捕获 handler。 */
function makeDaemonHarness(manager: unknown) {
  const registered = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const fakeWs = {
    registerRpcHandler: (method: string, handler: (p: Record<string, unknown>) => Promise<unknown>) => {
      registered.set(method, handler);
    },
  };
  const daemon = new Daemon(
    makeConfig(),
    { heartbeat: vi.fn(async () => ({})) } as never,
    null as never,
    { sessionManager: null, sillyspecManager: manager as never },
  );
  (daemon as unknown as { _registerSillySpecRpcHandler: (ws: unknown) => void })._registerSillySpecRpcHandler(fakeWs);
  return { daemon, registered };
}

function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── manager 执行器（task-01 面）──────────────────────────────────────────────

describe('runSyncChange：定向上行同步执行器', () => {
  it('无根映射 → no_workspace_root，零 spawn', async () => {
    const undo = silenceConsole();
    try {
      const { manager, calls } = makeManagerHarness({ rootFor: () => null });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r).toEqual({ ok: false, reason: 'no_workspace_root' });
      expect(calls).toEqual([]);
    } finally {
      undo();
    }
  });

  it('两条命令按序串行（sync → sync-docs，同 cwd），成功回执 actions[2]', async () => {
    const undo = silenceConsole();
    try {
      const root = 'C:\\repo\\project-a';
      const { manager, calls } = makeManagerHarness({
        rootFor: () => root,
        outcomes: [
          { code: 0, stdout: '', timedOut: false },
          { code: 0, stdout: '', timedOut: false },
        ],
      });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.actions).toHaveLength(2);
        expect(r.actions[0]).toMatchObject({ cmd: 'sync', code: 0 });
        expect(r.actions[1]).toMatchObject({ cmd: 'sync-docs', code: 0 });
      }
      expect(calls).toHaveLength(2);
      expect(calls[0].args).toEqual(['platform', 'sync', '--change', CHANGE]);
      expect(calls[1].args).toEqual(['platform', 'sync-docs', '--change', CHANGE]);
      expect(calls[0].cwd).toBe(root);
      expect(calls[1].cwd).toBe(root);
      // 数组序断言即串行序（假 runner 同步记录：第二条在第一条之后 push）
    } finally {
      undo();
    }
  });

  it('首条 sync 失败 → cli_failed 短路，sync-docs 不执行', async () => {
    const undo = silenceConsole();
    try {
      const { manager, calls } = makeManagerHarness({
        outcomes: [{ code: 1, stdout: '未连接平台', timedOut: false }],
      });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r).toMatchObject({
        ok: false,
        reason: 'cli_failed',
        failed_cmd: 'sync',
      });
      if (!r.ok && 'stderr_tail' in r) {
        expect(r.stderr_tail).toContain('exit 1');
        expect(r.stderr_tail).toContain('未连接平台');
      }
      expect(calls).toHaveLength(1);
    } finally {
      undo();
    }
  });

  it('第二条 sync-docs 失败 → failed_cmd=sync-docs', async () => {
    const undo = silenceConsole();
    try {
      const { manager, calls } = makeManagerHarness({
        outcomes: [
          { code: 0, stdout: '', timedOut: false },
          { code: 2, stdout: '', stderr: 'documents push failed', timedOut: false },
        ],
      });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r).toMatchObject({ ok: false, reason: 'cli_failed', failed_cmd: 'sync-docs' });
      if (!r.ok && 'stderr_tail' in r) {
        expect(r.stderr_tail).toContain('documents push failed');
      }
      expect(calls).toHaveLength(2);
    } finally {
      undo();
    }
  });

  it('spawn 失败（code=null）→ cli_failed 带 errorCode', async () => {
    const undo = silenceConsole();
    try {
      const { manager } = makeManagerHarness({
        outcomes: [{ code: null, stdout: '', timedOut: false, errorCode: 'ENOENT' }],
      });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r).toMatchObject({ ok: false, reason: 'cli_failed', failed_cmd: 'sync' });
      if (!r.ok && 'stderr_tail' in r) {
        expect(r.stderr_tail).toContain('ENOENT');
      }
    } finally {
      undo();
    }
  });

  it('bin 解析失败 → cli_failed 带安装指引（不 spawn）', async () => {
    const undo = silenceConsole();
    try {
      const { manager, calls } = makeManagerHarness({ bin: null });
      const r = await manager.runSyncChange(CHANGE, WS_ID);
      expect(r).toMatchObject({ ok: false, reason: 'cli_failed' });
      if (!r.ok && 'stderr_tail' in r) {
        expect(r.stderr_tail).toContain('sillyspec');
      }
      expect(calls).toEqual([]);
    } finally {
      undo();
    }
  });
});

// ── daemon handler 注册 + 参数守卫（task-02 面）──────────────────────────────

describe('sillyspec_sync_change handler：参数守卫', () => {
  it('非法 change（../ 穿越 / 空串）→ RpcError invalid_params', async () => {
    const undo = silenceConsole();
    try {
      const runSyncChange = vi.fn(async () => ({ ok: true, actions: [] }));
      const { registered } = makeDaemonHarness({ runSyncChange } as unknown as SillySpecManager);
      const handler = registered.get('sillyspec_sync_change');
      expect(handler).toBeDefined();
      await expect(handler!({ change: '../evil', workspace_id: WS_ID })).rejects.toThrow(RpcError);
      await expect(handler!({ change: '', workspace_id: WS_ID })).rejects.toThrow(RpcError);
      // 守卫在调执行器前抛出：runSyncChange 不应被触达
      expect(runSyncChange).not.toHaveBeenCalled();
    } finally {
      undo();
    }
  });

  it('非法 workspace_id（非 UUID）→ RpcError invalid_params', async () => {
    const undo = silenceConsole();
    try {
      const { manager } = makeManagerHarness();
      const { registered } = makeDaemonHarness(manager);
      const handler = registered.get('sillyspec_sync_change');
      await expect(
        handler!({ change: CHANGE, workspace_id: 'not-a-uuid' }),
      ).rejects.toThrow(RpcError);
    } finally {
      undo();
    }
  });
});

// ── 防抖（task-02 / D-004@v1 面）─────────────────────────────────────────────

describe('_runSyncChangeWithDebounce：15s TTL + in-flight 去重', () => {
  it('并发第二调回 in_flight；完成后 TTL 内再调回 debounced', async () => {
    const undo = silenceConsole();
    try {
      let resolveFirst!: (v: unknown) => void;
      const slowResult = { ok: true, actions: [] };
      const runSyncChange = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(slowResult);
          }),
      );
      const manager = { runSyncChange } as unknown as SillySpecManager;
      const { daemon } = makeDaemonHarness(manager);
      const debounced = (
        daemon as unknown as {
          _runSyncChangeWithDebounce: (c: string, ws: string) => Promise<unknown>;
        }
      )._runSyncChangeWithDebounce.bind(daemon);

      const p1 = debounced(CHANGE, WS_ID);
      const p2 = await debounced(CHANGE, WS_ID);
      expect(p2).toEqual({ skipped: 'in_flight' });
      expect(runSyncChange).toHaveBeenCalledTimes(1);

      resolveFirst(undefined);
      await expect(p1).resolves.toEqual(slowResult);

      // 完成后立即再调：15s TTL 窗口内 → debounced（真实时钟，无需 fake timers）
      const p3 = await debounced(CHANGE, WS_ID);
      expect(p3).toEqual({ skipped: 'debounced', last_sync_at: expect.any(Number) });
      expect(runSyncChange).toHaveBeenCalledTimes(1);
    } finally {
      undo();
    }
  });

  it('硬帽：超 1000 条时惰性清理过期 done 项', async () => {
    const undo = silenceConsole();
    try {
      const { manager } = makeManagerHarness();
      const { daemon } = makeDaemonHarness(manager);
      const map = (
        daemon as unknown as {
          _syncChangeDebounce: Map<string, { inFlight: true } | { inFlight: false; ts: number }>;
        }
      )._syncChangeDebounce;
      // 预填 1000 条过期 done 项（ts 远古）
      const now = Date.now();
      for (let i = 0; i < 1000; i++) {
        map.set(`ws-${i}:chg`, { inFlight: false, ts: now - 60_000 });
      }
      const runSyncChange = vi.fn(async () => ({ ok: true, actions: [] }));
      (daemon as unknown as { _sillyspecManager: unknown })._sillyspecManager = {
        runSyncChange,
      };
      const debounced = (
        daemon as unknown as {
          _runSyncChangeWithDebounce: (c: string, ws: string) => Promise<unknown>;
        }
      )._runSyncChangeWithDebounce.bind(daemon);
      await debounced('new-chg', WS_ID);
      // 过期项被清理，新项入 Map，总量不超硬帽 + 在飞 1 条
      expect(map.size).toBeLessThanOrEqual(1000);
      expect(runSyncChange).toHaveBeenCalledTimes(1);
    } finally {
      undo();
    }
  });
});
