/**
 * task-07（2026-09-04-conflict-resolve-entry）：sillyspec 平台同步命令 daemon 侧
 * 全链路测试（FR-02/FR-03/FR-05 / D-001@v1 / D-004@v1 / design §5 Phase2、§7）。
 *
 * 来源：tasks/task-07.md acceptance + design.md §5 Phase 2 + §7 心跳结果字段。
 * 覆盖行为矩阵：
 *   - case 分发：SILLYSPEC_RESOLVE 合法 payload → executor.runResolve(change,
 *     strategy) 原样透传；缺 change/strategy 或值域外 → warn 丢弃不调用不记结果；
 *     SILLYSPEC_GHOST_CLEANUP → runGhostCleanup()；fire-and-forget（不 await
 *     不 reject）；executor 未接线（duck-type 探测未命中）warn 丢弃不崩。
 *   - guard 忙拒：命令 in-flight 或 isUpgradeInFlight → 执行方法不调、
 *     recordCommandResult 记 failed（error='another sillyspec command is
 *     running'，executed_at ISO）；guard finally 复位后放行下一条。
 *   - flag 映射（manager 执行器层）：keep_local→--keep-local、take_platform→
 *     --take-platform，execFile 数组形参不经 shell、cwd=主仓根、超时注入透传
 *     （缺省 120s）；运行时脏 strategy → failed 不 spawn。
 *   - 结果矩阵：exit 0→success(exit_code 0)；非零→failed 带 exit_code+输出尾段
 *     摘要；超时/spawn 失败→failed 无 exit_code；无根/bin 缺失→failed 不 spawn。
 *   - ghost 两步：doctor --cleanup-ghosts --confirm → platform sync 顺序；
 *     第一步失败/超时不进第二步。
 *   - 结果槽：latest-wins、error 截 ≤200、executed_at 缺省补 ISO、10min 终态窗
 *     惰性过期（过期后 getCommandResult→null、可再记录重开窗）。
 *   - 心跳携带：窗口内每跳第 7 参携带七键对象；过期后键不出现（无显式 null，
 *     D-004@v1 两态）；HubClient 层 body 键在场/缺席契约。
 *
 * 策略：daemon 层照 daemon-heartbeat-sillyspec.test.ts 惯例（真实构造 Daemon +
 * DaemonOptions.sillyspecManager 注入假 manager / 真 manager，makeConfig 拉满循环
 * 间隔，私有方法 as unknown 直调）；manager 执行器层照 sillyspec-manager.test.ts
 * 惯例（runProgressJson/resolveSillySpecBin/statusCwd/commandTimeoutMs 全依赖注入
 * 假实现，零真实 spawn / 零文件 IO / 时钟全注入）；hub-client 层照 hub-client
 * fetch stub 惯例。Windows 安全（无真实进程、无平台分支）。
 *
 * @module sillyspec-platform-command.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Daemon } from '../src/daemon.js';
import { HubClient } from '../src/hub-client.js';
import {
  SillySpecManager,
  SILLYSPEC_TERMINAL_WINDOW_MS,
  SILLYSPEC_COMMAND_TIMEOUT_MS,
} from '../src/sillyspec-manager.js';
import type { SillySpecProgressOutcome } from '../src/sillyspec-manager.js';
import type { DaemonConfig } from '../src/config.js';
import type { DaemonMessage } from '../src/types.js';
import { MSG, REST_PREFIX } from '../src/protocol.js';

// ── 公共 fixture ─────────────────────────────────────────────────────────────

/** 完整 DaemonConfig fixture（循环间隔拉满/关闭防噪音；照 daemon-heartbeat-sillyspec.test.ts）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task07-pc',
    profile: 'default',
    workspace_dir: '/tmp/ws-task07-pc',
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

/** 含空格 Windows 风格路径（NFR 数组形参 / 不经 shell 断言载体，照 sillyspec-manager.test.ts）。 */
const BIN = 'C:\\Users\\qinyi\\Idea Projects\\repo\\node_modules\\sillyspec\\bin\\sillyspec.js';
const CWD = 'C:\\Users\\qinyi\\Idea Projects\\repo';

/** 静音 daemon createLogger 的 console 输出（防刷屏，照既有惯例）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

/** 冲净微任务（void fire-and-forget 链的 finally 复位 / catch 收敛可见化）。 */
const flushAsync = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** ISO 时间戳宽松断言（executed_at 缺省补机器本地钟 ISO）。 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// ── daemon 层 harness：假 manager（四方法 executor + 心跳读口全可编程）─────────

/**
 * 假 SillySpecManager：SillySpecCommandExecutor 四方法全 vi.fn（忙拒/分发断言
 * 载体），getSnapshot/getStatusSnapshot 供心跳读口缺省零值（不携带任何 sillyspec_* 键）。
 */
function makeFakeExecutorManager() {
  return {
    getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
    probeLocal: vi.fn(async () => null),
    probeLatest: vi.fn(async () => null),
    requestUpgrade: vi.fn(async () => undefined),
    requestManualUpgrade: vi.fn(async () => undefined),
    checkAndUpgrade: vi.fn(async () => undefined),
    getStatusSnapshot: vi.fn(() => undefined),
    runResolve: vi.fn(
      async (_change: string, _strategy: 'keep_local' | 'take_platform'): Promise<void> => undefined,
    ),
    runGhostCleanup: vi.fn(async (): Promise<void> => undefined),
    isUpgradeInFlight: vi.fn(() => false),
    recordCommandResult: vi.fn(),
    getCommandResult: vi.fn((): null => null),
  };
}

/** daemon 分发 harness：真实构造 Daemon，注入假 executor manager。 */
function makeDispatchHarness() {
  const manager = makeFakeExecutorManager();
  const daemon = new Daemon(makeConfig(), { heartbeat: vi.fn(async () => ({})) } as never, null as never, {
    sessionManager: null,
    sillyspecManager: manager as never,
  });
  const handleWsMessage = (msg: DaemonMessage): Promise<void> =>
    (daemon as unknown as { _handleWsMessage: (m: DaemonMessage) => Promise<void> })
      ._handleWsMessage(msg);
  return { daemon, manager, handleWsMessage };
}

// ── case 分发（daemon._handleWsMessage 直连路由）──────────────────────────────

describe('task-07 case 分发：SILLYSPEC_RESOLVE / SILLYSPEC_GHOST_CLEANUP 直连路由', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('合法 payload → runResolve(change, strategy) 原样透传（各恰一次）', async () => {
    const h = makeDispatchHarness();
    await expect(
      h.handleWsMessage({
        type: MSG.SILLYSPEC_RESOLVE,
        payload: {
          change: '2026-09-02-changes-overview-card',
          strategy: 'keep_local',
          workspace_id: 'b97f8231-9404-43bd-89de-38c281c4d875',
        },
      }),
    ).resolves.toBeUndefined();
    expect(h.manager.runResolve).toHaveBeenCalledTimes(1);
    expect(h.manager.runResolve).toHaveBeenCalledWith(
      '2026-09-02-changes-overview-card',
      'keep_local',
      'b97f8231-9404-43bd-89de-38c281c4d875',
    );
    expect(h.manager.runGhostCleanup).not.toHaveBeenCalled();
  });

  it('take_platform 值域同样放行（payload 原样透传）', async () => {
    const h = makeDispatchHarness();
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'demo-change', strategy: 'take_platform' },
    });
    // 无 workspace_id（旧 backend）→ 归一空串 = legacy 单槽位（FR-03）。
    expect(h.manager.runResolve).toHaveBeenCalledWith('demo-change', 'take_platform', '');
  });

  it('缺 change / 缺 strategy / strategy 值域外 / 非法类型 → warn 丢弃：不调执行方法、不记结果', async () => {
    const h = makeDispatchHarness();
    const badPayloads: Record<string, unknown>[] = [
      { strategy: 'keep_local' }, // 缺 change
      { change: 'c1' }, // 缺 strategy
      { change: 'c1', strategy: 'keep-local' }, // 值域外（中划线脏值）
      { change: 'c1', strategy: 'bogus' }, // 值域外
      { change: 'c1', strategy: null }, // 非字符串 strategy
      { change: '', strategy: 'keep_local' }, // 空 change
      { change: 123, strategy: 'keep_local' }, // 非字符串 change
      {}, // 双缺
    ];
    for (const payload of badPayloads) {
      await expect(
        h.handleWsMessage({ type: MSG.SILLYSPEC_RESOLVE, payload }),
      ).resolves.toBeUndefined();
    }
    expect(h.manager.runResolve).not.toHaveBeenCalled();
    expect(h.manager.runGhostCleanup).not.toHaveBeenCalled();
    // 入口校验丢弃先于 executor——不产生 busy/failed 之类的结果写入。
    expect(h.manager.recordCommandResult).not.toHaveBeenCalled();
  });

  it('ghost_cleanup 消息 → runGhostCleanup() 恰一次（无参）', async () => {
    const h = makeDispatchHarness();
    await expect(
      h.handleWsMessage({ type: MSG.SILLYSPEC_GHOST_CLEANUP, payload: {} }),
    ).resolves.toBeUndefined();
    expect(h.manager.runGhostCleanup).toHaveBeenCalledTimes(1);
    expect(h.manager.runGhostCleanup).toHaveBeenCalledWith();
    expect(h.manager.runResolve).not.toHaveBeenCalled();
  });

  it('fire-and-forget：WS 处理先于命令完成返回（不 await exec）', async () => {
    const h = makeDispatchHarness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.manager.runResolve.mockImplementationOnce(() => gate);
    // handleWsMessage resolve 时 runResolve 仍挂起（同步链已触达执行方法）。
    await expect(
      h.handleWsMessage({
        type: MSG.SILLYSPEC_RESOLVE,
        payload: { change: 'c1', strategy: 'keep_local' },
      }),
    ).resolves.toBeUndefined();
    expect(h.manager.runResolve).toHaveBeenCalledTimes(1);
    release();
    await flushAsync();
  });

  it('执行方法 reject → 防御收敛不崩，guard 复位后下一条放行', async () => {
    const h = makeDispatchHarness();
    h.manager.runResolve.mockRejectedValueOnce(new Error('boom'));
    await expect(
      h.handleWsMessage({
        type: MSG.SILLYSPEC_RESOLVE,
        payload: { change: 'c1', strategy: 'keep_local' },
      }),
    ).resolves.toBeUndefined();
    await flushAsync(); // catch + finally 复位收敛
    // 第二条不再被 in-flight guard 拦（guard 已复位）。
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c2', strategy: 'take_platform' },
    });
    await flushAsync();
    expect(h.manager.runResolve).toHaveBeenCalledTimes(2);
  });

  it('executor 未接线（manager 缺四方法，duck-type 探测未命中）→ warn 丢弃不崩', async () => {
    const manager = {
      getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
      requestUpgrade: vi.fn(async () => undefined),
    };
    const daemon = new Daemon(makeConfig(), { heartbeat: vi.fn(async () => ({})) } as never, null as never, {
      sessionManager: null,
      sillyspecManager: manager as never,
    });
    const handleWsMessage = (msg: DaemonMessage): Promise<void> =>
      (daemon as unknown as { _handleWsMessage: (m: DaemonMessage) => Promise<void> })
        ._handleWsMessage(msg);
    await expect(
      handleWsMessage({
        type: MSG.SILLYSPEC_RESOLVE,
        payload: { change: 'c1', strategy: 'keep_local' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      handleWsMessage({ type: MSG.SILLYSPEC_GHOST_CLEANUP, payload: {} }),
    ).resolves.toBeUndefined();
  });
});

// ── guard 忙拒（design §5 Phase2 第4条：in-flight 串行 + 升级链共用判定）──────

describe('task-07 guard 忙拒：忙时立即记 failed 不排队', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('命令 in-flight（guard 在跑）→ 第二条不调执行方法，记 failed（文案精确 + identify 透传 + ISO 戳）', async () => {
    const h = makeDispatchHarness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.manager.runResolve.mockImplementationOnce(() => gate);
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c1', strategy: 'keep_local' },
    });
    // 第一条挂起期间第二条到达 → 忙拒。
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c2', strategy: 'take_platform' },
    });
    expect(h.manager.runResolve).toHaveBeenCalledTimes(1); // 第二条未执行
    expect(h.manager.recordCommandResult).toHaveBeenCalledTimes(1);
    expect(h.manager.recordCommandResult).toHaveBeenCalledWith({
      action: 'resolve',
      change: 'c2',
      strategy: 'take_platform',
      state: 'failed',
      error: 'another sillyspec command is running',
      executed_at: expect.any(String),
    });
    const recorded = h.manager.recordCommandResult.mock.calls[0]![0] as {
      executed_at: string;
    };
    expect(recorded.executed_at).toMatch(ISO_RE);
    release();
    await flushAsync();
  });

  it('isUpgradeInFlight()=true（npm 升级链在跑）→ 忙拒第二臂：不调执行方法、记 failed busy', async () => {
    const h = makeDispatchHarness();
    h.manager.isUpgradeInFlight.mockReturnValue(true);
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c1', strategy: 'keep_local' },
    });
    expect(h.manager.runResolve).not.toHaveBeenCalled();
    expect(h.manager.recordCommandResult).toHaveBeenCalledWith({
      action: 'resolve',
      change: 'c1',
      strategy: 'keep_local',
      state: 'failed',
      error: 'another sillyspec command is running',
      executed_at: expect.any(String),
    });
  });

  it('ghost_cleanup 忙拒：failed 结果只含 action/state/error/executed_at（无 change/strategy 键）', async () => {
    const h = makeDispatchHarness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.manager.runGhostCleanup.mockImplementationOnce(() => gate);
    await h.handleWsMessage({ type: MSG.SILLYSPEC_GHOST_CLEANUP, payload: {} });
    await h.handleWsMessage({ type: MSG.SILLYSPEC_GHOST_CLEANUP, payload: {} });
    expect(h.manager.runGhostCleanup).toHaveBeenCalledTimes(1);
    expect(h.manager.recordCommandResult).toHaveBeenCalledWith({
      action: 'ghost_cleanup',
      state: 'failed',
      error: 'another sillyspec command is running',
      executed_at: expect.any(String),
    });
    release();
    await flushAsync();
  });

  it('升级链忙拒同样拦截 ghost_cleanup（共用判定跨命令种类）', async () => {
    const h = makeDispatchHarness();
    h.manager.isUpgradeInFlight.mockReturnValue(true);
    await h.handleWsMessage({ type: MSG.SILLYSPEC_GHOST_CLEANUP, payload: {} });
    expect(h.manager.runGhostCleanup).not.toHaveBeenCalled();
    expect(h.manager.recordCommandResult).toHaveBeenCalledWith({
      action: 'ghost_cleanup',
      state: 'failed',
      error: 'another sillyspec command is running',
      executed_at: expect.any(String),
    });
  });

  it('resolve 完成后 guard 复位 → 下一条放行（不误锁）', async () => {
    const h = makeDispatchHarness();
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c1', strategy: 'keep_local' },
    });
    await flushAsync(); // 默认 mock 立即 resolve，finally 复位
    await h.handleWsMessage({
      type: MSG.SILLYSPEC_RESOLVE,
      payload: { change: 'c2', strategy: 'keep_local' },
    });
    expect(h.manager.runResolve).toHaveBeenCalledTimes(2);
    expect(h.manager.recordCommandResult).not.toHaveBeenCalled();
  });
});

// ── manager 执行器 harness（runProgressJson 注入，零真实 spawn）────────────────

/**
 * 命令执行器 harness：runProgressJson 假实现捕获 (file,args,options) 逐调用，
 * outcomes 按步序出结果（缺省 exit 0）；时钟注入可推进（10min 过期判定）。
 */
function makeCommandHarness(
  opts: {
    bin?: string | null;
    cwd?: string | null;
    timeoutMs?: number;
    /** 逐次执行的 outcome 序列（ghost 两步用 [doctor, sync]）。 */
    outcomes?: SillySpecProgressOutcome[];
    /** workspace 级根解析器（2026-09-09-conflict-root-workspace-scoping task-01）：按 wsId 查映射根。 */
    rootFor?: (workspaceId: string) => string | null;
  } = {},
) {
  const bin = opts.bin === undefined ? BIN : opts.bin;
  const cwd = opts.cwd === undefined ? CWD : opts.cwd;
  const calls: {
    file: string;
    args: string[];
    options: { cwd: string; timeoutMs: number; maxBufferBytes: number };
  }[] = [];
  const runProgressJson = vi.fn(
    async (
      file: string,
      args: string[],
      options: { cwd: string; timeoutMs: number; maxBufferBytes: number },
    ): Promise<SillySpecProgressOutcome> => {
      calls.push({ file, args, options });
      if (opts.outcomes !== undefined) {
        return opts.outcomes[calls.length - 1] ?? { code: 0, stdout: '', timedOut: false };
      }
      return { code: 0, stdout: '', timedOut: false };
    },
  );
  let clockNow = 1_700_000_000_000;
  const deps = {
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => clockNow,
    logger: () => undefined,
    runProgressJson,
    resolveSillySpecBin: () => bin,
    statusCwd: () => cwd,
    statusRootFor: opts.rootFor,
    statusTimeoutMs: 5,
    commandTimeoutMs: opts.timeoutMs,
  };
  const manager = new SillySpecManager(deps);
  return {
    manager,
    calls,
    runProgressJson,
    advance: (ms: number) => {
      clockNow += ms;
    },
  };
}

// ── workspace_id 取根（2026-09-09-conflict-root-workspace-scoping task-01 / FR-02/FR-03）──

const WS_ID = 'b97f8231-9404-43bd-89de-38c281c4d875';
const MAPPED_CWD = 'C:\\Users\\qinyi\\Idea Projects\\mapped-repo';

describe('task-01 runResolve workspace_id 取根：未命中 failed 不 spawn，命中用映射根', () => {
  it('带 ws 且映射未命中 → 记 failed（尚未认领）且不 spawn（FR-02 铁律：不回退单槽位）', async () => {
    // 单槽位有合法值（cwd），但映射未命中 → 必须失败而非在单槽位执行。
    const h = makeCommandHarness({ cwd: CWD, rootFor: () => null });

    await h.manager.runResolve('demo-change', 'keep_local', WS_ID);

    expect(h.calls).toHaveLength(0);
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('尚未被本机会话认领');
  });

  it('带 ws 且映射命中 → spawn cwd=映射根（单槽位不参与）', async () => {
    const h = makeCommandHarness({ cwd: CWD, rootFor: () => MAPPED_CWD });

    await h.manager.runResolve('demo-change', 'keep_local', WS_ID);

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.options.cwd).toBe(MAPPED_CWD);
  });

  it('不带 ws → cwd=单槽位（FR-03 legacy 回归）', async () => {
    const h = makeCommandHarness({ cwd: CWD, rootFor: () => MAPPED_CWD });

    await h.manager.runResolve('demo-change', 'keep_local');

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.options.cwd).toBe(CWD);
  });
});

// ── flag 映射与执行形态（strategy→CLI flag 单点映射，NFR 数组形参不经 shell）──

describe('task-07 flag 映射：payload 下划线 strategy → CLI 中划线 flag', () => {
  it('keep_local → execFile 数组参数 [bin, platform, resolve, --change, 变更名, --keep-local]（不经 shell）+ cwd + 注入超时', async () => {
    const h = makeCommandHarness({ timeoutMs: 7000 });
    await h.manager.runResolve('2026-09-02-changes-overview-card', 'keep_local');
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    // NFR：file=node 本体、bin 是 args[0] 单元素（含空格路径不分裂，无 shell 拼接）。
    expect(call.file).toBe(process.execPath);
    expect(Array.isArray(call.args)).toBe(true);
    expect(call.args).toEqual([
      BIN,
      'platform',
      'resolve',
      '--change',
      '2026-09-02-changes-overview-card',
      '--keep-local',
    ]);
    expect(call.options.cwd).toBe(CWD);
    expect(call.options.timeoutMs).toBe(7000);
  });

  it('take_platform → --take-platform（单点映射唯一两个出口）', async () => {
    const h = makeCommandHarness({ timeoutMs: 7000 });
    await h.manager.runResolve('demo-change', 'take_platform');
    expect(h.calls[0]!.args).toEqual([
      BIN,
      'platform',
      'resolve',
      '--change',
      'demo-change',
      '--take-platform',
    ]);
  });

  it('未注入 commandTimeoutMs → 每步超时回退默认 120s（SILLYSPEC_COMMAND_TIMEOUT_MS）', async () => {
    const h = makeCommandHarness({ timeoutMs: undefined });
    await h.manager.runResolve('c1', 'keep_local');
    expect(h.calls[0]!.options.timeoutMs).toBe(SILLYSPEC_COMMAND_TIMEOUT_MS);
    expect(SILLYSPEC_COMMAND_TIMEOUT_MS).toBe(120_000);
  });

  it('运行时脏 strategy（绕过入口校验的防御兜底）→ 记 failed 不 spawn', async () => {
    const h = makeCommandHarness();
    await h.manager.runResolve('c1', 'keep-local' as 'keep_local');
    expect(h.runProgressJson).not.toHaveBeenCalled();
    const result = h.manager.getCommandResult();
    expect(result?.action).toBe('resolve');
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('未知的裁决策略');
    expect('exit_code' in (result ?? {})).toBe(false);
  });
});

// ── runResolve 结果矩阵（全收敛不 reject：exit 0 / 非零 / 超时 / spawn 失败）──

describe('task-07 runResolve 结果矩阵', () => {
  it('exit 0 → success + exit_code 0 + identify 齐全 + executed_at ISO 补全', async () => {
    const h = makeCommandHarness({
      outcomes: [{ code: 0, stdout: '{"ok":true}', timedOut: false }],
    });
    await h.manager.runResolve('c1', 'keep_local');
    expect(h.manager.getCommandResult()).toEqual({
      action: 'resolve',
      change: 'c1',
      strategy: 'keep_local',
      state: 'success',
      exit_code: 0,
      executed_at: expect.any(String),
    });
    expect(h.manager.getCommandResult()!.executed_at).toMatch(ISO_RE);
    // 执行器全收敛不 reject（异常路径另行覆盖）。
    await expect(h.manager.runResolve('c1', 'take_platform')).resolves.toBeUndefined();
  });

  it('非零退出 → failed + exit_code + 输出尾段摘要（error ≤200 字符）', async () => {
    const h = makeCommandHarness({
      outcomes: [{ code: 2, stdout: '前段噪音…'.padEnd(300, 'x') + '\n冲突文件校验失败', timedOut: false }],
    });
    await h.manager.runResolve('c1', 'take_platform');
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.exit_code).toBe(2);
    expect(result?.error).toContain('exit 2');
    // cliOutputSnippet 取尾 120 字符 + recordCommandResult 截 ≤200。
    expect(result?.error!.length).toBeLessThanOrEqual(200);
    expect(result?.error).toContain('冲突文件校验失败');
  });

  it('超时（timedOut）→ failed 无 exit_code，error 含超时秒数（注入 7s 不真等）', async () => {
    const h = makeCommandHarness({
      timeoutMs: 7000,
      outcomes: [{ code: null, stdout: '', timedOut: true }],
    });
    await h.manager.runResolve('c1', 'keep_local');
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect('exit_code' in (result ?? {})).toBe(false);
    expect(result?.error).toContain('7s');
    expect(result?.action).toBe('resolve');
    expect(result?.change).toBe('c1');
  });

  it('spawn 失败（code=null + errorCode）→ failed 无 exit_code，error 含错误码', async () => {
    const h = makeCommandHarness({
      outcomes: [{ code: null, stdout: '', timedOut: false, errorCode: 'ENOENT' }],
    });
    await h.manager.runResolve('c1', 'keep_local');
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect('exit_code' in (result ?? {})).toBe(false);
    expect(result?.error).toContain('ENOENT');
  });

  it('无 statusCwd 根 → 不 spawn 直接记 failed（错误可回显重试）', async () => {
    const h = makeCommandHarness({ cwd: null });
    await h.manager.runResolve('c1', 'keep_local');
    expect(h.runProgressJson).not.toHaveBeenCalled();
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('workspace 主仓根');
  });

  it('bin 解析失败（CLI 未安装）→ 不 spawn 直接记 failed', async () => {
    const h = makeCommandHarness({ bin: null });
    await h.manager.runResolve('c1', 'keep_local');
    expect(h.runProgressJson).not.toHaveBeenCalled();
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.error).toContain('sillyspec CLI');
  });
});

// ── runGhostCleanup 两步顺序（doctor → platform sync，失败不进第二步）──────────

describe('task-07 runGhostCleanup 两步顺序', () => {
  it('两步成功 → 先 doctor --cleanup-ghosts --confirm 再 platform sync，终态 success', async () => {
    const h = makeCommandHarness({
      outcomes: [
        { code: 0, stdout: '', timedOut: false },
        { code: 0, stdout: '', timedOut: false },
      ],
    });
    await h.manager.runGhostCleanup();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]!.args).toEqual([BIN, 'doctor', '--cleanup-ghosts', '--confirm']);
    expect(h.calls[1]!.args).toEqual([BIN, 'platform', 'sync']);
    expect(h.manager.getCommandResult()).toEqual({
      action: 'ghost_cleanup',
      state: 'success',
      exit_code: 0,
      executed_at: expect.any(String),
    });
    // ghost_cleanup 结果不带 change/strategy 键（identify 空展开）。
    const result = h.manager.getCommandResult() as Record<string, unknown>;
    expect('change' in result).toBe(false);
    expect('strategy' in result).toBe(false);
  });

  it('第一步（doctor）非零退出 → 不进第二步，failed 带第一步 exit_code', async () => {
    const h = makeCommandHarness({
      outcomes: [{ code: 3, stdout: 'ghost db locked', timedOut: false }],
    });
    await h.manager.runGhostCleanup();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.args[1]).toBe('doctor');
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect(result?.exit_code).toBe(3);
    expect(result?.error).toContain('ghost db locked');
  });

  it('第一步（doctor）超时 → 不进第二步，failed 无 exit_code', async () => {
    const h = makeCommandHarness({
      timeoutMs: 7000,
      outcomes: [{ code: null, stdout: '', timedOut: true }],
    });
    await h.manager.runGhostCleanup();
    expect(h.calls).toHaveLength(1);
    const result = h.manager.getCommandResult();
    expect(result?.state).toBe('failed');
    expect('exit_code' in (result ?? {})).toBe(false);
    expect(result?.error).toContain('超时');
  });
});

// ── 结果槽（latest-wins / error 截断 / executed_at 缺省 / 10min 惰性过期）──────

describe('task-07 结果槽：latest-wins 与 10min 终态窗', () => {
  it('latest-wins：新结果覆盖旧（含规范化字段），getCommandResult 返回浅拷贝', async () => {
    const h = makeCommandHarness();
    h.manager.recordCommandResult({
      action: 'resolve',
      change: 'c1',
      strategy: 'keep_local',
      state: 'success',
      exit_code: 0,
    });
    h.manager.recordCommandResult({
      action: 'ghost_cleanup',
      state: 'failed',
      error: 'demo',
    });
    const result = h.manager.getCommandResult();
    expect(result).toEqual({
      action: 'ghost_cleanup',
      state: 'failed',
      error: 'demo',
      executed_at: expect.any(String),
    });
    // 浅拷贝：调用方改写不影响槽内值。
    result!.error = 'mutated';
    expect(h.manager.getCommandResult()!.error).toBe('demo');
  });

  it('error 截断 ≤200 字符（协议契约，边界 ==200 不截）', () => {
    const h = makeCommandHarness();
    h.manager.recordCommandResult({
      action: 'resolve',
      change: 'c1',
      strategy: 'keep_local',
      state: 'failed',
      error: 'x'.repeat(500),
    });
    expect(h.manager.getCommandResult()?.error).toHaveLength(200);
    h.manager.recordCommandResult({
      state: 'failed',
      error: 'y'.repeat(200),
    });
    expect(h.manager.getCommandResult()?.error).toHaveLength(200);
  });

  it('executed_at 缺省 → 补机器本地钟 ISO 串；显式提供则原样保留', () => {
    const h = makeCommandHarness();
    h.manager.recordCommandResult({ state: 'success', exit_code: 0 });
    expect(h.manager.getCommandResult()?.executed_at).toMatch(ISO_RE);
    h.manager.recordCommandResult({
      state: 'success',
      exit_code: 0,
      executed_at: '2026-09-04T13:20:00+08:00',
    });
    expect(h.manager.getCommandResult()?.executed_at).toBe('2026-09-04T13:20:00+08:00');
  });

  it('10min 惰性过期：窗内（-1ms）保留，到窗清槽 → getCommandResult 返回 null；再记录重开窗', () => {
    const h = makeCommandHarness();
    h.manager.recordCommandResult({ action: 'resolve', state: 'success', exit_code: 0 });
    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS - 1);
    expect(h.manager.getCommandResult()?.state).toBe('success');
    h.advance(1); // 恰到 10min
    expect(h.manager.getCommandResult()).toBeNull();
    // 过期后新结果可再入（窗口重开）。
    h.manager.recordCommandResult({ action: 'ghost_cleanup', state: 'success', exit_code: 0 });
    expect(h.manager.getCommandResult()?.action).toBe('ghost_cleanup');
    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS);
    expect(h.manager.getCommandResult()).toBeNull();
  });
});

// ── 心跳携带（daemon 集成：真 manager → 槽 → _sendHeartbeatOnce 第 7 参）──────

/**
 * daemon 心跳集成 harness：注入真 SillySpecManager（执行器依赖全假），零真实
 * spawn；_registeredRuntimes 直填绕过注册循环（照 daemon-heartbeat-sillyspec.test.ts）。
 */
function makeHeartbeatCommandHarness() {
  // 剩参签名：第 7 参（sillyspecCommandResult）位索引断言可过类型层。
  const heartbeatMock = vi.fn(async (..._args: unknown[]) => ({}));
  const inner = makeCommandHarness({ timeoutMs: 7000 });
  const daemon = new Daemon(makeConfig(), { heartbeat: heartbeatMock } as never, null as never, {
    sessionManager: null,
    sillyspecManager: inner.manager,
  });
  (daemon as unknown as { _registeredRuntimes: Map<string, string> })._registeredRuntimes.set(
    'claude',
    'rt-task07-pc-1',
  );
  const sendHeartbeatOnce = (): Promise<boolean> =>
    (daemon as unknown as { _sendHeartbeatOnce: () => Promise<boolean> })._sendHeartbeatOnce();
  return { daemon, manager: inner.manager, heartbeatMock, advance: inner.advance, sendHeartbeatOnce };
}

describe('task-07 心跳携带：终态窗口内每跳携带、过期后键不出现（D-004@v1 两态）', () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });
  afterEach(() => {
    restoreConsole();
    vi.restoreAllMocks();
  });

  it('runResolve 成功 → 窗口内每次心跳第 7 参携带七键对象', async () => {
    const h = makeHeartbeatCommandHarness();
    await h.manager.runResolve('c1', 'keep_local');
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    const expected = {
      action: 'resolve',
      change: 'c1',
      strategy: 'keep_local',
      state: 'success',
      exit_code: 0,
      executed_at: expect.any(String),
    };
    expect(h.heartbeatMock).toHaveBeenCalledTimes(2);
    // ql-20260909（顺手修存量债）：心跳已演进到 10 参（第 8 specCache / 9
    // statusError / 10 status_map，2026-09-08 总览工作区级化）——length 断言
    // 从 7/4 时代更新；commandResult 仍第 7 参（index 6）。
    expect(h.heartbeatMock.mock.calls[0]!.length).toBe(10);
    expect(h.heartbeatMock.mock.calls[0]![6]).toEqual(expected);
    // 窗口内每跳都携带（latest-wins 单槽重复发送）。
    expect(h.heartbeatMock.mock.calls[1]!.length).toBe(10);
    expect(h.heartbeatMock.mock.calls[1]![6]).toEqual(expected);
  });

  it('10min 过期后 → 第 7 参不占位（length 回 4，无显式 null）', async () => {
    const h = makeHeartbeatCommandHarness();
    await h.manager.runGhostCleanup();
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    expect(h.heartbeatMock.mock.calls[0]!.length).toBe(10);
    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS); // 时钟注入过 10min（不真等）
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    const call = h.heartbeatMock.mock.calls[1]!;
    expect(call.length).toBe(10);
    expect(call[4]).toBeUndefined();
    expect(call[5]).toBeUndefined();
    expect(call[6]).toBeUndefined();
  });

  it('无结果（未执行过命令）→ 第 7 参不占位（既有心跳形态零破坏）', async () => {
    const h = makeHeartbeatCommandHarness();
    await expect(h.sendHeartbeatOnce()).resolves.toBe(true);
    const call = h.heartbeatMock.mock.calls[0]!;
    expect(call.length).toBe(10);
    expect(call[6]).toBeUndefined();
  });
});

// ── HubClient heartbeat 第 7 参 body 契约（fetch stub，照 hub-client 惯例）────

let lastCall: { url: string; init: RequestInit } | null = null;

/** 构造返回 2xx JSON 的 fetch 替身（照 daemon-heartbeat-sillyspec.test.ts）。 */
function mockFetchOk(body: unknown): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

const COMMAND_RESULT = {
  action: 'resolve' as const,
  change: '2026-09-02-changes-overview-card',
  strategy: 'keep_local' as const,
  state: 'success' as const,
  exit_code: 0,
  executed_at: '2026-09-04T13:20:00+08:00',
};

describe('task-07 HubClient heartbeat 第 7 可选参数 sillyspec_command_result（body 契约）', () => {
  beforeEach(() => {
    lastCall = null;
    vi.stubGlobal('fetch', mockFetchOk({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('对象 → body 键出现且整包直写（终态窗内每跳形态）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], null, undefined, undefined, undefined, COMMAND_RESULT);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.sillyspec_command_result).toEqual(COMMAND_RESULT);
  });

  it('缺省（undefined）→ 键完全不出现且不发显式 null（终态窗过期=backend 置 NULL 清除）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], null, undefined, undefined, undefined);
    const body = JSON.parse(lastCall!.init.body as string);
    expect('sillyspec_command_result' in body).toBe(false);
    expect(body.sillyspec_command_result).toBeUndefined();
  });

  it('仅带 commandResult（sillyspec/status 缺席）→ 占位 undefined 后仍落第 7 参（位置参数陷阱回归守卫）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [], null, undefined, undefined, undefined, COMMAND_RESULT);
    const body = JSON.parse(lastCall!.init.body as string);
    // 其余 sillyspec_* 键不被误写（status 槽位静默吞参回归）。
    expect('sillyspec_status' in body).toBe(false);
    expect('sillyspec_version' in body).toBe(false);
    expect('sillyspec_update' in body).toBe(false);
    expect(body.sillyspec_command_result).toEqual(COMMAND_RESULT);
  });
});
