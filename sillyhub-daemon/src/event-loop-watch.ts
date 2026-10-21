// event-loop-watch.ts —— 事件循环卡顿监控（2026-10-21-daemon-sync-hardening FR-06）。
//
// 背景：2026-10-21 腾讯云会话实测 daemon 宿主冻结约 5 分钟——每秒 `_wsLoop` 与
// 60s status 循环同时停摆（假活回收迟至 stale 388s、日志 6 分钟零输出），事件循环
// 整体冻结却无任何本端观测面，事后只能靠时间戳反推。本模块以
// perf_hooks.monitorEventLoopDelay 周期采样留证：窗口最大 lag 超阈值即 warn
// event_loop_lag（含 max/p99/mean/window 统计），宿主冻结类事故自此有 dump 点。
//
// 接线：daemon `_startInternal` 以 `_fire` 挂第六循环，abort 生命周期与其余循环
// 一致；log/intervalMs/warnThresholdMs/histogramFactory/sleep 全部可注入，测试零
// 真实定时器、零真实直方图。

import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/** 采样窗口默认间隔（对齐 status 采集循环 60s 节拍）。 */
export const EVENT_LOOP_WATCH_INTERVAL_MS = 60_000;

/** warn 阈值：窗口最大 lag 达 5s 即判「宿主冻结级停顿」留证。 */
export const EVENT_LOOP_WATCH_WARN_THRESHOLD_MS = 5_000;

/** 一拍采样的统计字段（心跳/日志结构化面）。 */
export interface EventLoopLagFields extends Record<string, unknown> {
  window_ms: number;
  threshold_ms: number;
  max_ms: number;
  mean_ms: number;
  p99_ms: number;
}

/** summarizeLagHistogram 接受的最小直方形状（IntervalHistogram 子集）。 */
export interface LagHistogramLike {
  mean: number;
  max: number;
  percentile: (p: number) => number;
}

const nsToMs = (ns: number): number => Math.round((ns / 1e6) * 10) / 10;

/**
 * 纯函数：直方图 → 统计字段 + 是否超阈值（max_ms ≥ thresholdMs 判 warn）。
 * IntervalHistogram 的 mean/max/percentile 单位为纳秒，此处归一到毫秒（一位小数）。
 */
export function summarizeLagHistogram(
  histo: LagHistogramLike,
  thresholdMs: number,
  windowMs: number,
): { fields: EventLoopLagFields; shouldWarn: boolean } {
  const fields: EventLoopLagFields = {
    window_ms: windowMs,
    threshold_ms: thresholdMs,
    max_ms: nsToMs(histo.max),
    mean_ms: nsToMs(histo.mean),
    p99_ms: nsToMs(histo.percentile(99)),
  };
  return { fields, shouldWarn: fields.max_ms >= thresholdMs };
}

export interface EventLoopWatchDeps {
  /** 日志出口（daemon 接线为 logger[level]；测试收集断言）。 */
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    data?: Record<string, unknown>,
  ) => void;
  /** 采样窗口毫秒，默认 {@link EVENT_LOOP_WATCH_INTERVAL_MS}。 */
  intervalMs?: number;
  /** warn 阈值毫秒，默认 {@link EVENT_LOOP_WATCH_WARN_THRESHOLD_MS}。 */
  warnThresholdMs?: number;
  /** 直方图工厂（测试注入假直方图；缺省 monitorEventLoopDelay 分辨率 20）。 */
  histogramFactory?: () => LagHistogramLike & {
    enable: () => void;
    disable: () => void;
    reset: () => void;
  };
  /** 可中断睡眠（测试注入即时 tick；缺省本模块 abortable 实现）。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * 缺省 abortable sleep：signal 中止即 reject，循环顶部 while 条件收尾。
 *
 * 2026-10-22-review-risk-fixes：定时器**正常到期**路径必须摘除 abort 监听器——
 * `{once:true}` 只在 abort 触发后自摘，正常路径每窗口会在 daemon 生命周期的
 * signal 上滞留一个监听器+闭包（60s 节拍下每日 ~1.4k，AbortSignal 为
 * EventTarget 无 MaxListeners 告警，静默慢性泄漏）。
 */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 监控循环体：enable 直方图 → 每窗口采样一拍（超阈值 warn / 正常 debug）→
 * reset 开新窗；signal 中止或 sleep reject 时退出并在 finally disable 直方图。
 * 全路径不抛（sleep 的 abort reject 已被 while 结构吸收，其余异常交由 _fire
 * 的防御性 catch——对齐既有循环写法）。
 */
export async function runEventLoopWatch(
  signal: AbortSignal,
  deps: EventLoopWatchDeps,
): Promise<void> {
  const intervalMs = deps.intervalMs ?? EVENT_LOOP_WATCH_INTERVAL_MS;
  const thresholdMs = deps.warnThresholdMs ?? EVENT_LOOP_WATCH_WARN_THRESHOLD_MS;
  const histo =
    deps.histogramFactory?.() ??
    monitorEventLoopDelay({ resolution: 20 });
  histo.enable();
  try {
    while (!signal.aborted) {
      // FR-02（2026-10-21-spec-conflict-autoheal）：sleep 因 abort 被 reject（reason
      // 形态不限——AbortError/通用 Error/signal.reason）→ 循环内捕获优雅退出，不再
      // 向调用方抛出（此前通用 Error 会穿透到 _fire 被误记 loop_crashed，daemon 每次
      // stop 多一条假崩溃日志）。非 abort 的真实异常同样收敛在此——监控循环自身
      // 绝不炸宿主（对齐既有循环「异常 warn 不崩」哲学，此处静默 break 留 finally
      // disable 收尾）。
      try {
        await (deps.sleep ?? defaultSleep)(intervalMs, signal);
      } catch {
        break;
      }
      const { fields, shouldWarn } = summarizeLagHistogram(
        histo,
        thresholdMs,
        intervalMs,
      );
      histo.reset();
      if (shouldWarn) {
        deps.log('warn', 'event_loop_lag', fields);
      } else {
        deps.log('debug', 'event_loop_lag_tick', fields);
      }
    }
  } finally {
    histo.disable();
  }
}
