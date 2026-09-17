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
/**
 * quick（ql-20260916-008）：对同一轮的对账轮次上限——达到即停表（清计时器，只留
 * stalledHint 提示）。stale run 永不终态时（daemon 崩溃/锁死遗留 running）对账
 * 永远查不出终态，无上限会每 30s 拉 getAgentSession+listSessionRuns 永不停止
 * （约 12 轮 ≈ 6min：3 轮提示门槛 ×4，给用户足够观察窗又不无限轮询）。
 */
const TURN_WATCHDOG_MAX_ROUNDS = 12;
/**
 * quick（2026-09-17 24h 风险审查）：安静对账阈值——连接健康（心跳在场）但无
 * 真实 SSE 事件持续本时长时，仍对账 DB 一次。Redis publish 是 best-effort
 * （session-stream.ts AC-06 注释自证实测丢过尾部事件），健康连接也可能丢
 * turn_completed；若心跳把轮活动时间一并重置，90s 连接门永不开启，丢终态的轮
 * 将永久卡「运行中」。本阈值的轮活动时间只由真实事件重置（见 lastEventRef）。
 * 取 300s 折中：常规思考间隙（<5min）零额外请求，保留 ql-008 健康连接免打扰收益。
 */
const TURN_QUIET_RECONCILE_MS = 300_000;
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
 * - 看门狗：currentRunId 非空（turn running）且满足任一门槛 → getAgentSession +
 *   listSessionRuns 对账：①90s 无任何信号（含心跳，疑似死连接）；②300s 无真实
 *   事件但心跳在场（疑似丢终态——Redis publish best-effort，quick 2026-09-17）。
 *   此后每 30s 复核一轮，连续 3 轮仍 running 且 SSE 断开 →
 *   stalledHint（accent 提示，不伪造终态）。对账发现 run 已终态 → 走既有 resync
 *   路径（connection.resync()，streamSession DB 缺口同步合成 turn_completed）刷新
 *   轮次；发现会话非 active → onSessionReconciled（page：invalidate 详情查询）。
 *   连续 12 轮无终态停表；新真实事件重启（心跳不重启，详见 effect 注释）。
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
  // quick（2026-09-17 24h 风险审查）：轮活动时间——只由真实 SSE 事件推进；心跳
  // 不重置（心跳只证明连接活着，不证明轮在推进——丢终态兜底依赖本 ref 计安静时长）。
  const lastEventRef = useRef(Date.now());
  const sseDownRef = useRef(false);
  const roundsRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // quick（2026-09-17 24h 风险审查）：停表重启钩子——轮次上限停表后计时链已断，
  // 新真实事件（进度唯一证据）经包装层重置轮次并重挂计时链；由看门狗 effect
  // 装载/清空（cleanup 置空防停表后复活陈旧 tick）。
  const watchdogRearmRef = useRef<() => void>(() => {});
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
    lastEventRef.current = Date.now();
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
  // quick（2026-09-17 24h 风险审查）：双门对账——①连接门：90s 无任何信号（含
  // 心跳）→ 疑似死连接，对账兜底；②安静门：连接健康但 300s 无真实事件 → 疑似
  // 丢终态（Redis publish best-effort），对账兜底。心跳只重置连接门计时。
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
    lastEventRef.current = Date.now();
    const tick = () => {
      watchdogTimerRef.current = null;
      const connQuiet = Date.now() - lastActivityRef.current >= TURN_WATCHDOG_FIRST_MS;
      const turnQuiet = Date.now() - lastEventRef.current >= TURN_QUIET_RECONCILE_MS;
      if (connQuiet || turnQuiet) {
        roundsRef.current += 1;
        reconcileRef.current();
        if (roundsRef.current >= TURN_WATCHDOG_HINT_ROUNDS && sseDownRef.current) {
          setStalledHint(true);
        }
        // quick（ql-20260916-008）：对账轮次上限——stale run 永不终态时（对账永远
        // 查不出终态）不再无限 30s 一轮，停表只留 stalledHint。quick（2026-09-17
        // 24h 风险审查）：停表后由**新真实事件**重启（watchdogRearmRef，轮次归零
        // + 重挂计时链）；心跳不重启——心跳不是进度证据，重启只会让 stale run
        // 白烧新一轮上限。
        if (roundsRef.current >= TURN_WATCHDOG_MAX_ROUNDS) return;
      }
      watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_INTERVAL_MS);
    };
    watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_FIRST_MS);
    watchdogRearmRef.current = () => {
      if (watchdogTimerRef.current) return; // 计时链未断（正常巡检中）
      if (!sessionIdRef.current || !currentRunIdRef.current) return;
      watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_INTERVAL_MS);
    };
    return () => {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      // 防停表/换轮后陈旧 rearm 复活已清理的计时链
      watchdogRearmRef.current = () => {};
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
          // 任一事件回调触发 = SSE 有新事件：活动时间推进 + 连续轮次归零 +
          // 重启已停表的计时链（quick 2026-09-17 24h 风险审查；心跳不享受此
          // 待遇——见 onHeartbeat）。
          lastActivityRef.current = Date.now();
          lastEventRef.current = Date.now();
          roundsRef.current = 0;
          setStalledHint(false);
          watchdogRearmRef.current();
          (fn as (...a: unknown[]) => void)(...args);
        };
      }
      // quick（ql-20260916-008）：心跳注释帧计连接存活——backend 每 25-30s 发
      // `: keepalive`，fetch-sse 不解析注释帧、handler onmessage 永不触发，原实现
      // 下健康空闲连接 90s 后必触发对账。无 event 字段的 envelope 即心跳帧（dispatch
      // 对非 session 事件提前 return，见 session-stream.ts）。
      // quick（2026-09-17 24h 风险审查）：心跳**只**计连接存活——仅重置活动时间
      // （连接门）与 stalledHint；不重置轮活动时间（lastEventRef，安静门计时时基）
      // 与连续轮次：健康连接也可能丢终态事件（Redis publish best-effort，实测过
      // 尾事件未发布），若心跳连这两项一并重置，丢终态兜底与轮次上限会被 25-30s
      // 一拍的心跳 perpetual 重置成永不生效的死状态。SSE 断连时本包装层不再被
      // 调用，死连接仍走连接门对账兜底。
      // onHeartbeat 由 streamSession 在注释帧到达时显式调用（经 tap 包装注入）。
      wrapped.onHeartbeat = () => {
        lastActivityRef.current = Date.now();
        setStalledHint(false);
      };
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
