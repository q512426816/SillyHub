// FR-06（2026-10-21-daemon-sync-hardening）：事件循环 lag 监控测试。
//
// 覆盖：
//   - summarizeLagHistogram 纯函数：ns → ms 归一（一位小数）、超阈值判定。
//   - runEventLoopWatch 循环体：假直方图 + 假 sleep 注入——超阈值窗口 warn
//     event_loop_lag 且统计字段齐全、正常窗口仅 debug、退出时 disable 直方图。
//
// 零真实定时器、零真实 monitorEventLoopDelay（factory 注入假直方图）。

import { describe, it, expect } from 'vitest';
import {
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
});
