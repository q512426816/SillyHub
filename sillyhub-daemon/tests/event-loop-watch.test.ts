// FR-06（2026-10-21-daemon-sync-hardening）：事件循环 lag 监控测试。
//
// 覆盖：
//   - summarizeLagHistogram 纯函数：ns → ms 归一（一位小数）、超阈值判定。
//   - runEventLoopWatch 循环体：假直方图 + 假 sleep 注入——超阈值窗口 warn
//     event_loop_lag 且统计字段齐全、正常窗口仅 debug、退出时 disable 直方图。
//
// 零真实定时器、零真实 monitorEventLoopDelay（factory 注入假直方图）。

import { describe, it, expect } from 'vitest';
import { getEventListeners } from 'node:events';
import {
  defaultSleep,
  summarizeLagHistogram,
  runEventLoopWatch,
} from '../src/event-loop-watch.js';

/** 假直方图（IntervalHistogram 形的极小子集）。 */
function fakeHisto(opts: { maxNs: number; meanNs: number; p99Ns: number }) {
  return {
    enable: () => undefined,
    disable: () => undefined,
    reset: () => undefined,
    mean: opts.meanNs,
    max: opts.maxNs,
    percentile: (p: number) => (p === 99 ? opts.p99Ns : opts.maxNs),
  };
}

describe('summarizeLagHistogram', () => {
  it('ns → ms 归一并超阈值判 warn', () => {
    const { fields, shouldWarn } = summarizeLagHistogram(
      fakeHisto({ maxNs: 6_000_000_000, meanNs: 1_000_000, p99Ns: 900_000_000 }),
      5_000,
      60_000,
    );
    expect(fields).toEqual({
      window_ms: 60_000,
      threshold_ms: 5_000,
      max_ms: 6_000,
      mean_ms: 1,
      p99_ms: 900,
    });
    expect(shouldWarn).toBe(true);
  });

  it('低于阈值不 warn', () => {
    const { shouldWarn } = summarizeLagHistogram(
      fakeHisto({ maxNs: 100_000_000, meanNs: 1_000, p99Ns: 90_000_000 }),
      5_000,
      60_000,
    );
    expect(shouldWarn).toBe(false);
  });
});

describe('runEventLoopWatch', () => {
  it('超阈值窗口 warn event_loop_lag、正常窗口静默、退出 disable', async () => {
    const controller = new AbortController();
    const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
    let ticks = 0;
    let resets = 0;
    let disabled = 0;
    let enabled = 0;
    const histo = {
      ...fakeHisto({ maxNs: 6_000_000_000, meanNs: 1_000_000, p99Ns: 900_000_000 }),
      enable: () => {
        enabled++;
      },
      disable: () => {
        disabled++;
      },
      reset: () => {
        resets++;
      },
    };
    await runEventLoopWatch(controller.signal, {
      log: (level, msg, data) => logs.push({ level, msg, data }),
      intervalMs: 60_000,
      warnThresholdMs: 5_000,
      histogramFactory: () => histo,
      sleep: async () => {
        ticks++;
        if (ticks >= 3) controller.abort();
      },
    });
    expect(enabled).toBe(1);
    expect(disabled).toBe(1);
    expect(resets).toBe(3);
    const warns = logs.filter((l) => l.msg === 'event_loop_lag');
    expect(warns).toHaveLength(3);
    expect(warns[0]?.level).toBe('warn');
    expect(warns[0]?.data?.['max_ms']).toBe(6_000);
    expect(warns[0]?.data?.['threshold_ms']).toBe(5_000);
    expect(warns[0]?.data?.['window_ms']).toBe(60_000);
    expect(warns[0]?.data?.['p99_ms']).toBe(900);
  });

  it('正常窗口不 warn（仅 debug tick）', async () => {
    const controller = new AbortController();
    const logs: Array<{ level: string; msg: string }> = [];
    let ticks = 0;
    await runEventLoopWatch(controller.signal, {
      log: (level, msg) => logs.push({ level, msg }),
      intervalMs: 60_000,
      warnThresholdMs: 5_000,
      histogramFactory: () =>
        fakeHisto({ maxNs: 100_000_000, meanNs: 1_000, p99Ns: 90_000_000 }),
      sleep: async () => {
        ticks++;
        if (ticks >= 2) controller.abort();
      },
    });
    expect(logs.filter((l) => l.msg === 'event_loop_lag')).toHaveLength(0);
    expect(logs.filter((l) => l.msg === 'event_loop_lag_tick')).toHaveLength(2);
  });

  it('FR-02：sleep 因 abort reject（reason 形态不限）时优雅 resolve，disable 恰一次', async () => {
    const controller = new AbortController();
    let disabled = 0;
    let ticks = 0;
    // reason 为非 AbortError 的通用 Error——旧行为会把循环炸出去被 _fire 记 loop_crashed。
    const result = await runEventLoopWatch(controller.signal, {
      log: () => undefined,
      intervalMs: 60_000,
      warnThresholdMs: 5_000,
      histogramFactory: () => ({
        ...fakeHisto({ maxNs: 1_000, meanNs: 1, p99Ns: 1 }),
        disable: () => {
          disabled++;
        },
      }),
      sleep: async () => {
        ticks++;
        if (ticks >= 2) {
          controller.abort();
          throw new Error('aborted');
        }
      },
    });
    expect(result).toBeUndefined();
    expect(disabled).toBe(1);
  });

  it('FR-03（2026-10-22-review-risk-fixes）：defaultSleep 正常到期路径摘除 abort 监听器——连续窗口后计数归零（修复前每窗 +1 静默滞留）', async () => {
    const controller = new AbortController();
    for (let i = 0; i < 3; i += 1) {
      await defaultSleep(2, controller.signal);
    }
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('FR-03：defaultSleep 挂起中被 abort → 立即 reject（P3② 语义不变），且不残留监听器', async () => {
    const controller = new AbortController();
    const pending = defaultSleep(5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    // abort 触发后 once 监听器自摘；已被 clearTimeout 的 timer 不再 resolve。
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('FR-03：真实 defaultSleep 走 runEventLoopWatch——abort 前正常窗口循环运转、abort 后优雅退出（不注入 sleep，覆盖缺省路径）', async () => {
    const controller = new AbortController();
    let disabled = 0;
    let resets = 0;
    const logs: Array<{ level: string; msg: string }> = [];
    const stopper = setTimeout(() => controller.abort(), 40);
    await runEventLoopWatch(controller.signal, {
      log: (level, msg) => logs.push({ level, msg }),
      intervalMs: 5, // 真实定时器 5ms 窗口（此前用例全注入 sleep，未覆盖缺省 defaultSleep）
      warnThresholdMs: 5_000,
      histogramFactory: () => ({
        ...fakeHisto({ maxNs: 1_000, meanNs: 1, p99Ns: 1 }),
        disable: () => {
          disabled++;
        },
        reset: () => {
          resets++;
        },
      }),
    });
    clearTimeout(stopper);
    expect(disabled).toBe(1);
    expect(resets).toBeGreaterThanOrEqual(1); // 至少跑完一个正常窗口后才被外部 abort
    expect(logs.every((l) => l.msg === 'event_loop_lag_tick')).toBe(true); // 全程未超阈
  });
});
