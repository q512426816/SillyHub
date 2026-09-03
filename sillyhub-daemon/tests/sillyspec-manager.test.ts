/**
 * task-04（2026-08-31-machine-sillyspec-version）：sillyspec-manager 模块测试。
 *
 * 来源：tasks/task-04.md acceptance + design.md §1 daemon 侧（状态机表 / R2 缓存 /
 * R4 探测失败自愈 / F14 终态 10min 展示窗）。
 * 覆盖：
 *   - probeLocal / probeLatest 探测：trim 归一、失败 null、latest 10min TTL 缓存
 *     （TTL 内复用不重探、过期重探、失败不缓存即重试）。
 *   - getSnapshot 键存在性：version/latest_version 恒在（未探测=null 未知语义），
 *     update 键在无升级态时缺席（undefined，backend 清除语义）。
 *   - requestUpgrade 状态机全流转：空闲 running→success（from/to + version 刷新）、
 *     忙 deferred + 30s 复查定时（29.999s 不触发、到点转空闲走 running，原 trigger
 *     保持）、复查仍忙再推迟（定时器单实例不叠）、安装后探测失败→failed、install
 *     抛错→failed（error 截断 200）、终态 10min 惰性过期回 idle（过期后可再入）。
 *   - in-flight 去重：running（install 挂起门）与 deferred 期间新请求仅记日志
 *     skipped_inflight，install 恰一次（CLEANUP 惯例）。
 *   - checkAndUpgrade：未安装/落后（真实 preflight isOutdated 参与）→
 *     requestUpgrade('auto')；已最新 no-op；latest 不可达 warn no-op；缓存使连续
 *     检查不重探 npm。
 *
 * 策略（依赖注入，task-04 DI 契约）：不 vi.mock preflight——runCommand / install /
 * isBusy / now 全经构造注入假实现（零真实 spawn / 零文件 IO）；deferred 30s 复查
 * 用 fake timers 驱动，TTL 与终态窗用注入时钟推进（不依赖真实时间流逝）。
 *
 * @module sillyspec-manager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SillySpecManager,
  SILLYSPEC_LATEST_CACHE_TTL_MS,
  SILLYSPEC_DEFERRED_RECHECK_MS,
  SILLYSPEC_TERMINAL_WINDOW_MS,
  SILLYSPEC_STATUS_CHANGES_MAX,
  SILLYSPEC_STATUS_BUDGET_BYTES,
  buildSillySpecStatusSummary,
} from '../src/sillyspec-manager.js';
import type {
  SillySpecProgressOutcome,
  SillySpecStatusSummary,
} from '../src/sillyspec-manager.js';
import type { PreflightLogger } from '../src/preflight.js';

// ── harness（全依赖注入：零真实 spawn / 零文件 IO）────────────────────────────

/** harness 可选项：探测返回值 / 忙标志 / 自定义安装行为。 */
interface HarnessOptions {
  /** `sillyspec --version` 返回（默认 '3.26.15'；null=未安装）。 */
  local?: string | null;
  /** `npm view sillyspec version` 返回（默认 '3.27.11'；null=不可达）。 */
  latest?: string | null;
  /** 初始忙标志（isBusy 回调读它，测试中翻转模拟任务起止）。 */
  busy?: boolean;
  /** 自定义安装行为（默认：本机版本翻到 '3.27.11' 模拟安装成功）。 */
  install?: (logger: PreflightLogger) => Promise<void>;
}

/**
 * 构造测试 harness：可变探测状态 + 可翻忙标志 + 注入时钟（advance 推进）+
 * 事件收集 logger + runCommand/install spy。
 */
function makeHarness(opts: HarnessOptions = {}) {
  const state = {
    // ?? 会吞显式 null（未安装语义），须用 === undefined 判缺省。
    local: opts.local === undefined ? '3.26.15' : opts.local,
    latest: opts.latest === undefined ? '3.27.11' : opts.latest,
  };
  const busyFlag = { busy: opts.busy ?? false };
  let clockNow = 1_700_000_000_000;
  const events: string[] = [];
  const logger: PreflightLogger = (_level, msg) => {
    events.push(msg);
  };
  const runCommand = vi.fn(async (cmd: string): Promise<string | null> => {
    if (cmd === 'sillyspec --version') return state.local;
    if (cmd === 'npm view sillyspec version') return state.latest;
    return null;
  });
  const install = vi.fn(
    opts.install ??
      (async () => {
        // 默认假安装：本机版本翻到默认 latest，供 success/版本刷新断言。
        state.local = '3.27.11';
      }),
  );
  const manager = new SillySpecManager({
    runCommand,
    install,
    isBusy: () => busyFlag.busy,
    now: () => clockNow,
    logger,
  });
  return {
    manager,
    runCommand,
    install,
    state,
    busy: busyFlag,
    events,
    /** 推进注入时钟（毫秒）——TTL/终态窗判定用，不涉定时器。 */
    advance: (ms: number) => {
      clockNow += ms;
    },
    /** `npm view sillyspec version` 被真实执行的次数（缓存断言用）。 */
    npmViewCalls: () =>
      runCommand.mock.calls.filter(([c]) => c === 'npm view sillyspec version')
        .length,
  };
}

// ── 探测 ──────────────────────────────────────────────────────────────────────

describe('task-04 probeLocal / probeLatest 探测', () => {
  it('probeLocal：成功返回 trim 后版本串并刷新快照 version', async () => {
    const h = makeHarness({ local: '  3.26.15 \r\n' });
    await expect(h.manager.probeLocal()).resolves.toBe('3.26.15');
    expect(h.manager.getSnapshot().version).toBe('3.26.15');
  });

  it('probeLocal：失败返回 null（未安装语义），快照 version=null', async () => {
    const h = makeHarness({ local: null });
    await expect(h.manager.probeLocal()).resolves.toBeNull();
    expect(h.manager.getSnapshot().version).toBeNull();
    expect(h.events).toContain('sillyspec_local_probe_failed');
  });

  it('probeLatest：成功返回 trim 后版本并写入缓存（快照 latest_version 可见）', async () => {
    const h = makeHarness({ latest: ' 3.27.11 \n' });
    await expect(h.manager.probeLatest()).resolves.toBe('3.27.11');
    expect(h.manager.getSnapshot().latest_version).toBe('3.27.11');
  });

  it('probeLatest 失败（npm 不可达）：返回 null 且不缓存——下次调用即重试', async () => {
    const h = makeHarness({ latest: null });
    await expect(h.manager.probeLatest()).resolves.toBeNull();
    await expect(h.manager.probeLatest()).resolves.toBeNull();
    expect(h.npmViewCalls()).toBe(2); // 失败不进缓存
    expect(h.events).toContain('sillyspec_latest_probe_failed');

    // 恢复可达后缓存生效：再调不重探。
    h.state.latest = '3.27.11';
    await h.manager.probeLatest();
    await h.manager.probeLatest();
    expect(h.npmViewCalls()).toBe(3);
  });
});

// ── latest 10min 缓存 TTL ─────────────────────────────────────────────────────

describe('task-04 probeLatest 10min 缓存 TTL', () => {
  it('TTL 内复用缓存不重探；到 10min 过期重探', async () => {
    const h = makeHarness({});
    await h.manager.probeLatest();
    expect(h.npmViewCalls()).toBe(1);

    h.advance(SILLYSPEC_LATEST_CACHE_TTL_MS - 1);
    await expect(h.manager.probeLatest()).resolves.toBe('3.27.11');
    expect(h.npmViewCalls()).toBe(1); // 窗内命中缓存

    h.advance(1); // 恰到 TTL
    h.state.latest = '3.28.0';
    await expect(h.manager.probeLatest()).resolves.toBe('3.28.0');
    expect(h.npmViewCalls()).toBe(2); // 过期重探取到新值
    expect(h.manager.getSnapshot().latest_version).toBe('3.28.0');
  });
});

// ── getSnapshot 键存在性 ──────────────────────────────────────────────────────

describe('task-04 getSnapshot 键存在性', () => {
  it('未探测：version/latest_version 均为 null（未知），update 键缺席', () => {
    const h = makeHarness({});
    const snap = h.manager.getSnapshot();
    expect(snap.version).toBeNull();
    expect(snap.latest_version).toBeNull();
    expect('update' in snap).toBe(false);
    expect(snap.update).toBeUndefined();
  });

  it('已探测无升级：version/latest_version 携带探测值，update 仍缺席', async () => {
    const h = makeHarness({});
    await h.manager.probeLocal();
    await h.manager.probeLatest();
    const snap = h.manager.getSnapshot();
    expect(snap.version).toBe('3.26.15');
    expect(snap.latest_version).toBe('3.27.11');
    expect('update' in snap).toBe(false);
  });

  it('running 态：update 携带 {state, trigger, from_version}，to_version/error 缺席', async () => {
    const h = makeHarness({});
    await h.manager.probeLocal();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.install.mockImplementationOnce(() => gate);
    const pending = h.manager.requestUpgrade('server_command');

    const snap = h.manager.getSnapshot();
    expect(snap.update).toMatchObject({
      state: 'running',
      trigger: 'server_command',
      from_version: '3.26.15',
    });
    expect(snap.update?.to_version).toBeUndefined();
    expect(snap.update?.error).toBeUndefined();

    release();
    await pending;
  });
});

// ── requestUpgrade 状态机（real timers：无定时器路径）──────────────────────────

describe('task-04 requestUpgrade 升级执行与终态', () => {
  it('空闲 → running → success：install 恰一次，from/to 齐全，快照 version 刷新', async () => {
    const h = makeHarness({});
    await h.manager.probeLocal(); // 起点 3.26.15

    await h.manager.requestUpgrade('server_command');

    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update).toEqual({
      state: 'success',
      trigger: 'server_command',
      from_version: '3.26.15',
      to_version: '3.27.11',
    });
    expect(h.manager.getSnapshot().version).toBe('3.27.11'); // 安装后 probeLocal 刷新
    expect(h.events).toContain('sillyspec_upgrade_started');
    expect(h.events).toContain('sillyspec_upgrade_success');
  });

  // ql-20260902-003：手动指令版本前置门（requestManualUpgrade）——已最新 no-op
  // 不白跑 npm；探测失败 / 未安装不阻断（宁装勿漏）。
  it('server_command 已最新（local == latest）→ no-op：install 不执行，无 update 状态，记 skipped_up_to_date', async () => {
    const h = makeHarness({ local: '3.27.12', latest: '3.27.12' });
    await h.manager.requestManualUpgrade();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().update).toBeUndefined();
    expect(h.events).toContain('sillyspec_upgrade_skipped_up_to_date');
  });

  it('server_command latest 不可达（null）→ 前置门放行照旧升级（网络失败不阻断）', async () => {
    const h = makeHarness({ latest: null });
    await h.manager.requestManualUpgrade();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update?.state).toBe('success');
  });

  it('server_command 未安装（local=null）→ 前置门放行补装', async () => {
    const h = makeHarness({ local: null });
    await h.manager.requestManualUpgrade();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update?.state).toBe('success');
  });

  it('未探测过本机版本：from_version=null 仍可升级成功（未安装补装路径）', async () => {
    const h = makeHarness({ local: null });
    await h.manager.requestUpgrade('auto');
    expect(h.manager.getSnapshot().update).toEqual({
      state: 'success',
      trigger: 'auto',
      from_version: null,
      to_version: '3.27.11',
    });
  });

  it('安装后探测失败 → failed（error 摘要，to_version 缺席），version 保留探测值', async () => {
    const h = makeHarness({
      install: async () => {
        h.state.local = null; // 安装未生效/CLI 不可用
      },
    });
    await h.manager.probeLocal(); // 旧版本 3.26.15 在位
    await h.manager.requestUpgrade('server_command');

    const update = h.manager.getSnapshot().update;
    expect(update?.state).toBe('failed');
    expect(update?.trigger).toBe('server_command');
    expect(update?.from_version).toBe('3.26.15');
    expect(update?.to_version).toBeUndefined();
    expect(update?.error).toBeTruthy();
    expect(h.events).toContain('sillyspec_upgrade_failed');
  });

  it('install 抛异常 → failed，error 截断至 200 字符', async () => {
    const h = makeHarness({
      install: async () => {
        throw new Error('x'.repeat(500));
      },
    });
    await h.manager.requestUpgrade('server_command');
    const update = h.manager.getSnapshot().update;
    expect(update?.state).toBe('failed');
    expect(update?.error).toHaveLength(200);
    expect(update?.error).toBe('x'.repeat(200));
  });

  it('in-flight 去重（running）：install 挂起期间新请求仅记日志，install 恰一次', async () => {
    const h = makeHarness({});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.install.mockImplementationOnce(() => gate);

    const pending = h.manager.requestUpgrade('server_command');
    // async 函数体同步执行到首个 await：running 已置位（门生效）。
    expect(h.manager.getSnapshot().update?.state).toBe('running');

    await h.manager.requestUpgrade('auto'); // in-flight → 立即去重返回
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.events.filter((m) => m === 'sillyspec_upgrade_skipped_inflight')).toHaveLength(1);

    release();
    await pending;
    expect(h.manager.getSnapshot().update?.state).toBe('success');
  });
});

// ── 终态 10min 展示窗（注入时钟，惰性过期）────────────────────────────────────

describe('task-04 终态 10min 展示窗', () => {
  it('success：窗内（10min-1ms）保留，到 10min 惰性过期回 idle（update 键缺席）', async () => {
    const h = makeHarness({});
    await h.manager.requestUpgrade('server_command');
    expect(h.manager.getSnapshot().update?.state).toBe('success');

    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS - 1);
    expect(h.manager.getSnapshot().update?.state).toBe('success');

    h.advance(1);
    const snap = h.manager.getSnapshot();
    expect(snap.update).toBeUndefined();
    expect(snap.version).toBe('3.27.11'); // 版本不受展示窗过期影响
    expect(h.events).toContain('sillyspec_update_window_expired');
  });

  it('failed：同样 10min 过期回 idle', async () => {
    const h = makeHarness({
      install: async () => {
        throw new Error('npm down');
      },
    });
    await h.manager.requestUpgrade('auto');
    expect(h.manager.getSnapshot().update?.state).toBe('failed');

    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS);
    expect(h.manager.getSnapshot().update).toBeUndefined();
  });

  it('过期回 idle 后：新升级请求可再入（不被旧终态挡住）', async () => {
    const h = makeHarness({});
    await h.manager.requestUpgrade('server_command');
    h.advance(SILLYSPEC_TERMINAL_WINDOW_MS);
    expect(h.manager.getSnapshot().update).toBeUndefined();

    await h.manager.requestUpgrade('auto');
    expect(h.install).toHaveBeenCalledTimes(2);
    expect(h.manager.getSnapshot().update?.state).toBe('success');
    expect(h.manager.getSnapshot().update?.trigger).toBe('auto');
  });
});

// ── deferred 30s 复查（fake timers）───────────────────────────────────────────

describe('task-04 requestUpgrade deferred 30s 复查', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('忙 → deferred（install 未调）+ 30s 复查：转空闲走 running → success（原 trigger 保持）', async () => {
    const h = makeHarness({ busy: true });
    await h.manager.probeLocal();
    await h.manager.requestUpgrade('server_command');

    const deferred = h.manager.getSnapshot().update;
    expect(deferred).toEqual({
      state: 'deferred',
      trigger: 'server_command',
      from_version: '3.26.15',
    });
    expect(h.install).not.toHaveBeenCalled();

    h.busy.busy = false; // 复查前释放忙
    await vi.advanceTimersByTimeAsync(SILLYSPEC_DEFERRED_RECHECK_MS - 1);
    expect(h.install).not.toHaveBeenCalled(); // 29.999s 未到点

    await vi.advanceTimersByTimeAsync(1);
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update).toEqual({
      state: 'success',
      trigger: 'server_command', // 复查转 running 保持首条 trigger
      from_version: '3.26.15',
      to_version: '3.27.11',
    });
  });

  it('复查仍忙 → 再推迟：定时器单实例不叠（60s 恰两次复查、install 零调用）', async () => {
    const h = makeHarness({ busy: true });
    await h.manager.requestUpgrade('auto');

    await vi.advanceTimersByTimeAsync(2 * SILLYSPEC_DEFERRED_RECHECK_MS);
    expect(h.install).not.toHaveBeenCalled();
    expect(
      h.events.filter((m) => m === 'sillyspec_upgrade_still_deferred'),
    ).toHaveLength(2); // 30s/60s 各一次（叠了会翻倍）
    expect(h.manager.getSnapshot().update?.state).toBe('deferred');
  });

  it('in-flight 去重（deferred）：期间新请求仅记日志，不叠定时器/不改 trigger', async () => {
    const h = makeHarness({ busy: true });
    await h.manager.requestUpgrade('server_command');
    await h.manager.requestUpgrade('auto'); // deferred → 去重

    expect(h.events.filter((m) => m === 'sillyspec_upgrade_skipped_inflight')).toHaveLength(1);
    expect(h.manager.getSnapshot().update?.trigger).toBe('server_command');

    h.busy.busy = false;
    await vi.advanceTimersByTimeAsync(SILLYSPEC_DEFERRED_RECHECK_MS);
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update?.trigger).toBe('server_command');
  });
});

// ── checkAndUpgrade 自动检查入口 ─────────────────────────────────────────────

describe('task-04 checkAndUpgrade 自动检查', () => {
  it('未安装（probe null）→ requestUpgrade(auto) 补装成功', async () => {
    const h = makeHarness({ local: null });
    await h.manager.checkAndUpgrade();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update).toEqual({
      state: 'success',
      trigger: 'auto',
      from_version: null,
      to_version: '3.27.11',
    });
    expect(h.events).toContain('sillyspec_not_installed');
  });

  it('落后（3.26.15 < 3.27.11，真实 preflight isOutdated 参与）→ 升级', async () => {
    const h = makeHarness({});
    await h.manager.checkAndUpgrade();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().update?.state).toBe('success');
    expect(h.events).toContain('sillyspec_outdated');
  });

  it('已最新 → no-op（install 零调用，update 缺席）', async () => {
    const h = makeHarness({ local: '3.27.11', latest: '3.27.11' });
    await h.manager.checkAndUpgrade();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().update).toBeUndefined();
    expect(h.events).toContain('sillyspec_up_to_date');
  });

  it('latest 不可达 → warn no-op（不做离线重试/退避）', async () => {
    const h = makeHarness({ latest: null });
    await h.manager.checkAndUpgrade();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().update).toBeUndefined();
    expect(h.events).toContain('sillyspec_latest_unavailable');
  });

  it('缓存联动：10min 内连续两次检查，npm view 只探一次', async () => {
    const h = makeHarness({});
    await h.manager.checkAndUpgrade(); // 落后 → 升级到 3.27.11
    await h.manager.checkAndUpgrade(); // 已最新（latest 走缓存）
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.npmViewCalls()).toBe(1);
    expect(h.events).toContain('sillyspec_up_to_date');
  });

  it('忙时检查同走 deferred（升级不打断运行中任务）', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ busy: true });
      await h.manager.checkAndUpgrade();
      expect(h.manager.getSnapshot().update?.state).toBe('deferred');
      expect(h.install).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 2026-09-02-changes-overview-card task-04：progress 采集三态矩阵 + 截断降级 ──
// 策略同上全依赖注入：runProgressJson / resolveSillySpecBin / statusCwd /
// statusTimeoutMs 假实现（零真实 spawn，Windows 安全）；超时注入毫秒级（5ms），
// 不依赖真实 30s/60s 时钟推进。

/** 合法 envelope fixture（含真实 schema 的 stages/readable/command 字段——采集
 * 容忍，摘要不透传）。 */
const ENVELOPE_OK = {
  schema_version: 1,
  ok: true,
  errors: [] as string[],
  warnings: ['w1', 'w2'],
  generated_at: '2026-09-02T12:51:03+00:00',
  command: 'progress show --json',
  data: {
    project: 'multi-agent-platform',
    active_changes: 2,
    changes: [
      {
        name: '2026-09-02-changes-overview-card',
        ghost: false,
        current_stage: 'execute',
        stage_label: '执行',
        last_active: '2026-09-02T12:50:59+00:00',
        readable: '执行 (3/8)',
        command: 'progress show',
        stages: { scan: { status: 'done' }, plan: { status: 'done' } },
        steps: { total: 8, completed: 3 },
      },
      {
        name: 'ghost-legacy-change',
        ghost: true,
        current_stage: 'archive',
        stage_label: '归档',
        last_active: '2026-08-01T00:00:00+00:00',
        steps: { total: 4, completed: 4 },
      },
    ],
    pending_conflicts: [
      { change: 'demo-a', created_at: '2026-08-21T10:00:00+00:00', type: 'spec-tree' },
      { change: 'demo-b', created_at: '2026-08-22T10:00:00+00:00', type: 'progress' },
      { change: 'demo-c', created_at: '2026-08-23T10:00:00+00:00', type: 'progress' },
    ],
  },
};

/** ENVELOPE_OK 的期望摘要（三态①字段全齐基准；readable/command/stages 不透传）。 */
const SUMMARY_OF_ENVELOPE_OK: SillySpecStatusSummary = {
  ok: true,
  errors_count: 0,
  warnings_count: 2,
  generated_at: '2026-09-02T12:51:03+00:00',
  active_changes: 2,
  healthy_count: 1,
  ghost_count: 1,
  conflict_count: 3,
  conflict_types: { 'spec-tree': 1, progress: 2 },
  changes: [
    {
      name: '2026-09-02-changes-overview-card',
      ghost: false,
      current_stage: 'execute',
      stage_label: '执行',
      last_active: '2026-09-02T12:50:59+00:00',
      steps: { total: 8, completed: 3 },
    },
    {
      name: 'ghost-legacy-change',
      ghost: true,
      current_stage: 'archive',
      stage_label: '归档',
      last_active: '2026-08-01T00:00:00+00:00',
      steps: { total: 4, completed: 4 },
    },
  ],
  pending_conflicts: [
    { change: 'demo-a', created_at: '2026-08-21T10:00:00+00:00', type: 'spec-tree' },
    { change: 'demo-b', created_at: '2026-08-22T10:00:00+00:00', type: 'progress' },
    { change: 'demo-c', created_at: '2026-08-23T10:00:00+00:00', type: 'progress' },
  ],
};

const STATUS_BIN =
  'C:\\Users\\qinyi\\Idea Projects\\repo\\node_modules\\sillyspec\\bin\\sillyspec.js';
const STATUS_CWD = 'C:\\Users\\qinyi\\Idea Projects\\repo';

/** 采集 harness：假 bin/cwd/runner（可编程 outcome，逐拍翻转模拟三态流转）。
 * 默认 bin/cwd 为含空格 Windows 风格路径（NFR-02 数组形参断言载体）；timeoutMs
 * 默认 5（毫秒级注入）。 */
function makeStatusHarness(
  opts: {
    bin?: string | null;
    cwd?: string | null;
    timeoutMs?: number;
    outcome?: SillySpecProgressOutcome;
    stdout?: string;
  } = {},
) {
  const events: string[] = [];
  const logger: PreflightLogger = (_level, msg) => {
    events.push(msg);
  };
  const bin = opts.bin === undefined ? STATUS_BIN : opts.bin;
  const cwd = opts.cwd === undefined ? STATUS_CWD : opts.cwd;
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
      if (opts.outcome !== undefined) return opts.outcome;
      return { code: 0, stdout: opts.stdout ?? JSON.stringify(ENVELOPE_OK), timedOut: false };
    },
  );
  const manager = new SillySpecManager({
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => 1_700_000_000_000,
    logger,
    runProgressJson,
    resolveSillySpecBin: () => bin,
    statusCwd: () => cwd,
    statusTimeoutMs: opts.timeoutMs ?? 5,
  });
  return {
    manager,
    events,
    calls,
    runProgressJson,
    /** 翻转下一拍 outcome（三态流转 ①→③ 序列用）。 */
    setOutcome: (o: SillySpecProgressOutcome) => {
      opts.outcome = o;
    },
  };
}

describe('task-04(2026-09-02) 三态①成功：摘要落快照（readable/command 不透传）', () => {
  it('exit 0 + 合法 envelope → 深比较期望摘要；execFile 数组形参（含空格 bin 路径不分裂）+ 注入超时透传', async () => {
    const h = makeStatusHarness();
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toEqual(SUMMARY_OF_ENVELOPE_OK);
    // NFR-02 跨平台：bin 是 args[0] 单元素（空格路径不分裂，无 shell 拼接）；
    // file=node 本体；注入毫秒级 timeoutMs 原样透传；cwd=主仓根。
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.file).toBe(process.execPath);
    expect(h.calls[0]!.args).toEqual([STATUS_BIN, 'progress', 'show', '--json']);
    expect(h.calls[0]!.options.cwd).toBe(STATUS_CWD);
    expect(h.calls[0]!.options.timeoutMs).toBe(5);
    // readable/command/stages 被容忍但绝不透传（changes 项恰六键）。
    const change = h.manager.getStatusSnapshot()!.changes[0]!;
    expect(Object.keys(change).sort()).toEqual([
      'current_stage',
      'ghost',
      'last_active',
      'name',
      'stage_label',
      'steps',
    ]);
  });
});

describe('task-04(2026-09-02) 三态②能力缺失：null + warn-once', () => {
  it('bin 不存在（未安装）→ 快照 null；warn 一次后同类静默（第二次 debug）', async () => {
    const h = makeStatusHarness({ bin: null });
    await h.manager.collectStatusOnce();
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toBeNull();
    expect(
      h.events.filter((e) => e === 'sillyspec_status_capability_missing').length,
    ).toBe(1);
    expect(h.events).toContain('sillyspec_status_capability_missing_repeat');
  });

  it('spawn ENOENT（code=null + errorCode=ENOENT）→ 快照 null + warn 一次', async () => {
    const h = makeStatusHarness({
      outcome: { code: null, stdout: '', timedOut: false, errorCode: 'ENOENT' },
    });
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toBeNull();
    expect(h.events).toContain('sillyspec_status_capability_missing');
  });

  it('exit 0 但 stdout 非 JSON（旧版本无 --json）→ 快照 null + warn 一次', async () => {
    const h = makeStatusHarness({ stdout: '人类可读总览（非 JSON）' });
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toBeNull();
    expect(h.events).toContain('sillyspec_status_capability_missing');
  });

  it('无已知主仓根（statusCwd→null）→ 本拍跳过，快照保持 undefined（心跳不带键）', async () => {
    const h = makeStatusHarness({ cwd: null });
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toBeUndefined();
  });
});

describe('task-04(2026-09-02) 三态③瞬态失败：保留上次快照（不清除不上报 null）', () => {
  it('超时（timedOut）→ 上一拍摘要原样保留', async () => {
    const h = makeStatusHarness();
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toEqual(SUMMARY_OF_ENVELOPE_OK);
    h.setOutcome({ code: null, stdout: '', timedOut: true });
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toEqual(SUMMARY_OF_ENVELOPE_OK);
    expect(h.events).toContain('sillyspec_status_collect_timeout');
  });

  it('非零退出（code=1）→ 上一拍摘要原样保留', async () => {
    const h = makeStatusHarness();
    await h.manager.collectStatusOnce();
    h.setOutcome({ code: 1, stdout: 'boom', timedOut: false });
    await h.manager.collectStatusOnce();
    expect(h.manager.getStatusSnapshot()).toEqual(SUMMARY_OF_ENVELOPE_OK);
    expect(h.events).toContain('sillyspec_status_nonzero_exit');
  });

  it('瞬态失败不落能力缺失告警类（与②互不污染，快照非 null）', async () => {
    const h = makeStatusHarness();
    await h.manager.collectStatusOnce();
    h.setOutcome({ code: 1, stdout: '', timedOut: false });
    await h.manager.collectStatusOnce();
    expect(h.events).not.toContain('sillyspec_status_capability_missing');
    expect(h.manager.getStatusSnapshot()).not.toBeNull();
  });
});

describe('task-04(2026-09-02) buildSillySpecStatusSummary 截断与 32KB 降级（纯函数直测）', () => {
  it(`changes 超 N=${SILLYSPEC_STATUS_CHANGES_MAX} 截至前 50（active_changes 回退全长，计数基于截断后列表）`, () => {
    const envelope = {
      ok: true,
      errors: [] as string[],
      warnings: [] as string[],
      generated_at: 'g',
      data: {
        active_changes: 60,
        changes: Array.from({ length: 60 }, (_, i) => ({
          name: `change-${i}`,
          ghost: i % 2 === 1,
          current_stage: 'scan',
          stage_label: '扫描',
          last_active: 't',
          steps: { total: 2, completed: 1 },
        })),
        pending_conflicts: [] as unknown[],
      },
    };
    const s = buildSillySpecStatusSummary(envelope);
    expect(s.changes).toHaveLength(SILLYSPEC_STATUS_CHANGES_MAX);
    expect(s.changes[0]!.name).toBe('change-0');
    expect(s.active_changes).toBe(60);
    // 截断后计数基于前 50：奇数下标 ghost → 25 ghost / 25 healthy。
    expect(s.ghost_count).toBe(25);
    expect(s.healthy_count).toBe(25);
  });

  it('active_changes 缺失 → 回退 changes 全长（截断前）；errors 计数走数组长度', () => {
    const envelope = {
      ok: false,
      errors: ['e1'],
      warnings: [] as string[],
      generated_at: 'g',
      data: { changes: Array.from({ length: 3 }, () => ({ name: 'c' })), pending_conflicts: [] as unknown[] },
    };
    const s = buildSillySpecStatusSummary(envelope);
    expect(s.active_changes).toBe(3);
    expect(s.ok).toBe(false);
    expect(s.errors_count).toBe(1);
  });

  it('摘要序化超 32KB 预算 → 降级纯计数（列表清空、计数保留、降级后低于预算）', () => {
    const bigName = 'x'.repeat(1000);
    const envelope = {
      ok: true,
      errors: [] as string[],
      warnings: [] as string[],
      generated_at: 'g',
      data: {
        changes: Array.from({ length: SILLYSPEC_STATUS_CHANGES_MAX }, () => ({
          name: bigName,
          ghost: false,
          current_stage: 'scan',
          stage_label: '扫描',
          last_active: 't',
          steps: { total: 9, completed: 9 },
        })),
        pending_conflicts: [{ change: bigName, created_at: 't', type: 'progress' }],
      },
    };
    const s = buildSillySpecStatusSummary(envelope);
    expect(s.changes).toEqual([]);
    expect(s.pending_conflicts).toEqual([]);
    expect(s.conflict_count).toBe(1);
    expect(s.active_changes).toBe(SILLYSPEC_STATUS_CHANGES_MAX);
    expect(Buffer.byteLength(JSON.stringify(s), 'utf8')).toBeLessThanOrEqual(
      SILLYSPEC_STATUS_BUDGET_BYTES,
    );
  });

  it('防御式解析：非 object envelope / 脏 data → 全兜底零计数不抛错', () => {
    expect(buildSillySpecStatusSummary(null)).toEqual({
      ok: false,
      errors_count: 0,
      warnings_count: 0,
      generated_at: '',
      active_changes: 0,
      healthy_count: 0,
      ghost_count: 0,
      conflict_count: 0,
      conflict_types: {},
      changes: [],
      pending_conflicts: [],
    });
    expect(buildSillySpecStatusSummary('not-json-object').changes).toEqual([]);
    expect(buildSillySpecStatusSummary({ data: 'oops' }).conflict_types).toEqual({});
  });
});
