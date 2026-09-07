"use client";

/**
 * 连接状态横幅 + 运行轮看门狗 hook（task-09 / design A6；自 session-panel.tsx
 * 拆出，task-14 / 2026-09-07-arch-large-file-split，原样搬移零行为变化）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAgentSession, listSessionRuns, type SessionStreamConnection,
  type SessionStreamHandlers, type SessionStreamStatus,
} from "@/lib/daemon";


/* ── task-09 / design A6（2026-08-29-daemon-platform-resilience）：连接横幅 + 运行轮看门狗（page / dialog 共用） ── */

/** 运行轮看门狗：turn running 且 90s 无新日志 / SSE 事件 → 首次对账。 */
const TURN_WATCHDOG_FIRST_MS = 90_000;
/** 看门狗复核间隔：首次触发后每 30s 一轮。 */
const TURN_WATCHDOG_INTERVAL_MS = 30_000;
/** 连续 N 轮对账仍 running 且 SSE 断开 → 显示「本轮长时间无响应」提示。 */
const TURN_WATCHDOG_HINT_ROUNDS = 3;
/** 「连接已恢复」横幅自动消失时长（design A6：约 2 秒）。 */
const RECONNECTED_BANNER_MS = 2_000;

/**
 * 看门狗判定 run 终态的词表（lib/daemon.ts streamSession 内 TERMINAL_RUN_STATUSES
 * 同款五值）。不复用 runTerminalTurnStatus——它对 completed 返回 null（只映射失败族）。
 */
const WATCHDOG_TERMINAL_RUN_STATUSES: ReadonlySet<string | null> = new Set([
  "completed",
  "failed",
  "killed",
  "cancelled",
  "interrupted",
]);

interface StreamConnectionGuard {
  /** SSE 连接状态（onStatusChange 驱动；live = 无横幅）。 */
  connStatus: SessionStreamStatus;
  /** 当前重连尝试次数（reconnecting 横幅「第 N 次尝试」）。 */
  reconnectAttempt: number;
  /** 看门狗提示：本轮长时间无响应，正在与平台核对（不伪造终态，原型④）。 */
  stalledHint: boolean;
  /**
   * streamSession handlers 装配 tap：每个事件回调触发即推进看门狗活动时间 +
   * 连续轮次归零，并注入 onStatusChange 驱动横幅。原 handler 逐字透传（后兼容，
   * 不改既有事件语义）。
   */
  tapStreamHandlers: (handlers: SessionStreamHandlers) => SessionStreamHandlers;
}

/**
 * task-09 / design A6：连接状态横幅 + 运行轮看门狗（page / dialog 共用 hook）。
 *
 * - 横幅：onStatusChange('reconnecting', N) → warning 常驻「正在重连…（第 N 次）」；
 *   'reconnected' → success「连接已恢复，正在同步…」2s 自动消失（期间转 live 同样收起）。
 * - 看门狗：currentRunId 非空（turn running）且 90s 无事件 → getAgentSession +
 *   listSessionRuns 对账；此后每 30s 复核一轮，连续 3 轮仍 running 且 SSE 断开 →
 *   stalledHint（accent 提示，不伪造终态）。对账发现 run 已终态 → 走既有 resync
 *   路径（connection.resync()，streamSession DB 缺口同步合成 turn_completed）刷新
 *   轮次；发现会话非 active → onSessionReconciled（page：invalidate 详情查询）。
 * - 清理：轮终态（currentRunId 清空）/ 会话切换 / 卸载即停看门狗计时器。
 */
export function useStreamConnectionGuard(opts: {
  sessionId: string | null;
  currentRunId: string | null;
  getConnection: () => SessionStreamConnection | null;
  /** 对账发现会话非 active（failed/ended 等）时回调（可选）。 */
  onSessionReconciled?: (status: string) => void;
}): StreamConnectionGuard {
  const [connStatus, setConnStatus] = useState<SessionStreamStatus>("live");
  const [reconnectAttempt, setReconnectAttempt] = useState(1);
  const [stalledHint, setStalledHint] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const sseDownRef = useRef(false);
  const roundsRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // 看门狗 timer / SSE 回调闭包读 ref（避免重建计时器 / 捕获过期 props）。
  const sessionIdRef = useRef(opts.sessionId);
  const currentRunIdRef = useRef(opts.currentRunId);
  const getConnectionRef = useRef(opts.getConnection);
  const onSessionReconciledRef = useRef(opts.onSessionReconciled);

  useEffect(() => {
    sessionIdRef.current = opts.sessionId;
    currentRunIdRef.current = opts.currentRunId;
    getConnectionRef.current = opts.getConnection;
    onSessionReconciledRef.current = opts.onSessionReconciled;
  });

  // 卸载清理（含 StrictMode 双挂载重锚）；轮终态清理在下方看门狗 effect 的
  // 「无运行轮」分支与 cleanup。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, []);

  // 会话切换：状态复位（横幅 / 提示 / 连续轮次不跨会话残留）。
  useEffect(() => {
    setConnStatus("live");
    setStalledHint(false);
    roundsRef.current = 0;
    sseDownRef.current = false;
    lastActivityRef.current = Date.now();
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
  }, [opts.sessionId]);

  // 看门狗对账（每轮执行）。终态一律以 backend 数据为准：run 终态走既有 resync
  // 路径刷新（不本地伪造 turn 状态）；会话非 active 仅回调消费方刷新详情。
  const reconcileRef = useRef<() => void>(() => {});
  useEffect(() => {
    reconcileRef.current = () => {
      const sid = sessionIdRef.current;
      const rid = currentRunIdRef.current;
      if (!sid || !rid) return;
      void (async () => {
        try {
          const [detail, runs] = await Promise.all([
            getAgentSession(sid),
            listSessionRuns(sid),
          ]);
          if (!mountedRef.current) return;
          if (sid !== sessionIdRef.current || rid !== currentRunIdRef.current) {
            return; // 对账窗口内轮次/会话已切换：丢弃过期结果
          }
          const run = runs.find((r) => r.id === rid);
          if (run && WATCHDOG_TERMINAL_RUN_STATUSES.has(run.status)) {
            getConnectionRef.current()?.resync?.();
          }
          if (detail.status !== "active") {
            onSessionReconciledRef.current?.(detail.status);
          }
        } catch {
          /* 对账失败静默：看门狗下一轮再兜 */
        }
      })();
    };
  });

  // 运行轮看门狗主体：90s 首查、每 30s 复核；任一 SSE 事件（tapStreamHandlers）
  // 推进活动时间并归零连续轮次；轮终态 / 预会话态停表并清提示。
  useEffect(() => {
    if (!opts.sessionId || !opts.currentRunId) {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      roundsRef.current = 0;
      setStalledHint(false);
      return;
    }
    lastActivityRef.current = Date.now();
    const tick = () => {
      watchdogTimerRef.current = null;
      if (Date.now() - lastActivityRef.current >= TURN_WATCHDOG_FIRST_MS) {
        roundsRef.current += 1;
        reconcileRef.current();
        if (roundsRef.current >= TURN_WATCHDOG_HINT_ROUNDS && sseDownRef.current) {
          setStalledHint(true);
        }
      }
      watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_INTERVAL_MS);
    };
    watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_FIRST_MS);
    return () => {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.sessionId, opts.currentRunId]);

  const tapStreamHandlers = useCallback(
    (handlers: SessionStreamHandlers): SessionStreamHandlers => {
      const wrapped: Record<string, unknown> = { ...handlers };
      for (const key of Object.keys(handlers)) {
        const fn = (handlers as unknown as Record<string, unknown>)[key];
        if (typeof fn !== "function") continue;
        wrapped[key] = (...args: unknown[]) => {
          // 任一事件回调触发 = SSE 有新事件：活动时间推进 + 连续轮次归零。
          lastActivityRef.current = Date.now();
          roundsRef.current = 0;
          setStalledHint(false);
          (fn as (...a: unknown[]) => void)(...args);
        };
      }
      wrapped.onStatusChange = (status: SessionStreamStatus, attempt?: number) => {
        if (status === "reconnecting") {
          sseDownRef.current = true;
          if (bannerTimerRef.current) {
            clearTimeout(bannerTimerRef.current);
            bannerTimerRef.current = null;
          }
          setReconnectAttempt(attempt ?? 1);
          setConnStatus("reconnecting");
          return;
        }
        sseDownRef.current = false;
        if (bannerTimerRef.current) {
          clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = null;
        }
        setConnStatus(status === "reconnected" ? "reconnected" : "live");
        if (status === "reconnected") {
          // 原型③：恢复横幅 2s 自动消失（期间收到实时事件转 live 亦收起）。
          bannerTimerRef.current = setTimeout(() => {
            bannerTimerRef.current = null;
            setConnStatus((prev) => (prev === "reconnected" ? "live" : prev));
          }, RECONNECTED_BANNER_MS);
        }
      };
      return wrapped as unknown as SessionStreamHandlers;
    },
    [],
  );

  return { connStatus, reconnectAttempt, stalledHint, tapStreamHandlers };
}
