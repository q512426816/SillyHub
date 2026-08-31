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
