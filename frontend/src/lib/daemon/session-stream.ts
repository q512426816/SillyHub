/**
 * Daemon API client —— 会话 SSE 流实现（streamSession 490 行单体按设计
 * 原样搬移不顺手重构 + subscribeAgentSessionsEvents + 事件 parse* 私有助手）。
 * 类型/常量在 ./session-sse，重连内部工具在 ./sse-internals。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { getApiBaseUrl } from "@/lib/api";
import { useSession } from "@/stores/session";
import { fetchSse, type FetchSseConnection } from "@/lib/fetch-sse";
import { getAgentSessionLogs, listSessionRuns } from "./sessions";
import type {
  SessionPermissionRequest,
  SessionPermissionResolved,
  SessionRunRead,
} from "./sessions";
import {
  isPermanentRestError,
  RESYNC_REST_TIMEOUT_MS,
  timeoutSignal,
} from "./sse-internals";
import {
  parseSessionPermissionEvent,
  PERMANENT_SSE_ERROR_STATUSES,
  RECONNECT_BACKOFF_MS,
  type AgentTaskStatusEvent,
  type BashChunkEvent,
  type BashStatusEvent,
  type PlanModeEnteredEvent,
  type PlanSummary,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
  type SessionStreamHandlers,
  type SessionStreamStatus,
} from "./session-sse";
/**
 * task-05 / 2026-08-24-platform-session-feedback-fix：把 SSE payload 归一化为
 * PlanModeEnteredEvent。dispatch 已校验 session_id / run_id，本函数只做字段兜底。
 */
function parsePlanModeEnteredEvent(
  data: unknown,
  sessionId: string,
): PlanModeEnteredEvent {
  const evt = data as Record<string, unknown>;
  const rawSummary =
    evt.summary && typeof evt.summary === "object"
      ? (evt.summary as Record<string, unknown>)
      : {};
  const summary: PlanSummary = {
    objective: typeof rawSummary.objective === "string" ? rawSummary.objective : "",
    tasks: Array.isArray(rawSummary.tasks)
      ? rawSummary.tasks.filter((t): t is string => typeof t === "string")
      : [],
    design_snippet:
      typeof rawSummary.design_snippet === "string"
        ? rawSummary.design_snippet
        : null,
  };
  return {
    event: "plan_mode_entered",
    session_id: sessionId,
    run_id: String(evt.run_id),
    summary,
    requested_at: typeof evt.requested_at === "string" ? evt.requested_at : "",
  };
}

/** 把 SSE payload 归一化为 BashStatusEvent。 */
function parseBashStatusEvent(
  data: unknown,
  sessionId: string,
): BashStatusEvent {
  const evt = data as Record<string, unknown>;
  const status =
    evt.status === "running" ||
    evt.status === "completed" ||
    evt.status === "failed"
      ? evt.status
      : "running";
  return {
    event: "bash_status",
    session_id: sessionId,
    run_id: String(evt.run_id),
    command: typeof evt.command === "string" ? evt.command : "",
    status,
    exit_code: typeof evt.exit_code === "number" ? evt.exit_code : null,
    elapsed_ms: typeof evt.elapsed_ms === "number" ? evt.elapsed_ms : null,
  };
}

/** 把 SSE payload 归一化为 BashChunkEvent。 */
function parseBashChunkEvent(
  data: unknown,
  sessionId: string,
): BashChunkEvent {
  const evt = data as Record<string, unknown>;
  return {
    event: "bash_chunk",
    session_id: sessionId,
    run_id: String(evt.run_id),
    command: typeof evt.command === "string" ? evt.command : "",
    channel: evt.channel === "stderr" ? "stderr" : "stdout",
    content: typeof evt.content === "string" ? evt.content : "",
    is_final: Boolean(evt.is_final),
  };
}

/**
 * 把 SSE payload 归一化为 AgentTaskStatusEvent（verify P1 返工 / FR-03）。
 * 2026-08-27-background-subagent-progress task-10（FR-04）：status 增补 stopped，
 * 透传异步子代理生命周期扩展字段（全可选——旧 daemon 不下发时归一为 null，
 * 消费方按可选语义兜底）。
 */
function parseAgentTaskStatusEvent(
  data: unknown,
  sessionId: string,
): AgentTaskStatusEvent {
  const evt = data as Record<string, unknown>;
  const status =
    evt.status === "completed" ||
    evt.status === "failed" ||
    evt.status === "stopped"
      ? evt.status
      : "running";
  return {
    event: "agent_task_status",
    session_id: sessionId,
    run_id: String(evt.run_id),
    task_id: typeof evt.task_id === "string" ? evt.task_id : "",
    task_name: typeof evt.task_name === "string" ? evt.task_name : "",
    status,
    progress: typeof evt.progress === "number" ? evt.progress : null,
    message: typeof evt.message === "string" ? evt.message : null,
    // FR-04 扩展字段（旧 daemon 缺字段 → null）：
    tool_use_id: typeof evt.tool_use_id === "string" ? evt.tool_use_id : null,
    summary: typeof evt.summary === "string" ? evt.summary : null,
    last_tool_name:
      typeof evt.last_tool_name === "string" ? evt.last_tool_name : null,
    elapsed_ms: typeof evt.elapsed_ms === "number" ? evt.elapsed_ms : null,
    total_tokens:
      typeof evt.total_tokens === "number" ? evt.total_tokens : null,
    tool_uses: typeof evt.tool_uses === "number" ? evt.tool_uses : null,
    async: typeof evt.async === "boolean" ? evt.async : null,
  };
}

/**
 * 订阅 session 级 SSE（贯穿整个会话多 turn）。
 *
 * - URL 走 Next route handler proxy（/api/daemon/sessions/{id}/stream），
 *   task-12：token 走 Authorization header（fetch-sse），不再拼 URL query。
 * - backend 对 turn_started/log/turn_completed/session_status/session_ended/permission_*
 *   统一发**默认 data 帧**（无 `event:` 行），payload 内 `event` 字段标识类型。
 *   故前端必须用 `es.onmessage` 接收并按 `parsed.event` dispatch —— 命名事件
 *   （addEventListener）只会收到带 `event:` 行的 done/error，收不到上述 turn 事件，
 *   会导致 InteractiveSessionPanel 的 onTurnStarted/onLog/onTurnCompleted 收不到事件。
 * - 校验 session_id 匹配；turn_started/log/turn_completed 必须有 run_id。
 * - turn_completed 不 close；session_ended close + 回调幂等。
 * - ql-20260820-009：onerror 自动重连（指数退避）——fetch-sse 无自动重连、
 *   backend Redis Pub/Sub 无补发，断连期间事件对本连接永久丢失；重连前经
 *   listSessionRuns + getAgentSessionLogs 全量回放/终态合成补齐缺口（调用方
 *   按 log_id 去重，合成 turn 事件在页面侧终态幂等）。close()/session_ended
 *   后不再重连。F7：resync 快照拉取带 10s 超时（options.resyncTimeoutMs 可覆盖）。
 * - ql-20260827-018：cursor / initialSync 首连缺口同步——调用方先回灌历史再
 *   建流（修 page 模式并行竞态：SSE 先到建 turn 致历史被整体丢弃），本函数在
 *   首次建连前跑一次 DB 缺口同步，补「历史快照 → SSE 订阅」窗口内发布的事件。
 * - task-09 / design A6：可选 onStatusChange 外露连接状态（reconnecting 携
 *   attempt / reconnected / live），仅观测不改退避 / resync 行为；连接对象新增
 *   resync() 供运行轮看门狗主动对账（复用 DB 缺口同步路径）。
 *
 * P0-1（2026-06-18）：从 addEventListener(kind) 改为 onmessage 单通道 dispatch，
 * 与 backend stream_session_logs 的 default data: 帧对齐。done/error 仍走命名事件
 * （backend 发 `event: done`/`event: error`），permission_request/permission_resolved
 * 兼容旧 task-08 onmessage 通道，已统一进 onmessage 解析。
 */
export function streamSession(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options?: {
    /** 已回灌历史的最大 log timestamp（ISO）——首连缺口同步的增量游标起点。 */
    cursor?: string;
    resyncTimeoutMs?: number;
    /**
     * ql-20260827-018：建连前先跑一次 DB 缺口同步（runs 快照合成 + 全量 logs
     * 回放）。历史预取失败（无 cursor 可用）时的兜底路径；成功路径用 cursor
     * 增量同步即可，两者都置位时 cursor 优先（lastLogTs 已初始化）。
     */
    initialSync?: boolean;
  },
): SessionStreamConnection {
  const base = getApiBaseUrl();
  const url = new URL(
    `${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  // task-12：token 不再进 URL query（访问日志明文泄漏），cursor 业务参数保留。
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);

  let lastEventId: string | null = null;
  let sessionEndedFired = false;
  // ── P4（2026-08-24 会话审查）：增量回放游标 ──────────────────────────────
  // 最近一条已见 log 的 timestamp。回放（断线 resync / 轮后对账）只拉
  // `after = lastLogTs - 2s` 之后的增量，替代全量重放（5000 行 × 50KB）。
  // -2s 重叠窗口兜「submit_messages 同批日志共用同一 timestamp，纯 timestamp
  // 游标跳过同批后到行」的边界；重复行由页面装配器 seenLogIds（log_id）去重。
  // ql-20260827-018：调用方已回灌历史时传 cursor 初始化——首连缺口同步从该点
  // 增量拉取，避免无游标时的二次全量。
  let lastLogTs: string | null = options?.cursor ?? null;
  const REPLAY_OVERLAP_MS = 2000;
  // ── ql-20260820-009：断线重连（指数退避 + 全量回放 + 终态合成） ──────────
  // fetch-sse 无自动重连、backend Redis Pub/Sub 无补发：断连期间的 turn/log
  // 事件对本连接永久丢失。onerror → 退避后 resync 补缺口再重建 SSE 连接。
  let es: FetchSseConnection | null = null;
  let closed = false; // 调用方 close()/session_ended 后不再重连
  let retryCount = 0; // 退避档位（成功收到事件 / resync 后归零）
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let postTurnTimer: ReturnType<typeof setTimeout> | null = null;
  // task-09 / design A6：连接状态外露（onStatusChange）。初值 live——首连（未断
  // 过线）不上报，调用方初始态即视为 live（不显示横幅）。
  let connStatus: SessionStreamStatus = "live";
  const setStatus = (s: SessionStreamStatus, attempt?: number): void => {
    if (s === "reconnecting") {
      // 每次尝试都上报（横幅要显示第 N 次，attempt 变化不算重复态）。
      connStatus = s;
      handlers.onStatusChange?.(s, attempt);
      return;
    }
    if (connStatus === s) return;
    connStatus = s;
    handlers.onStatusChange?.(s);
  };

  const TERMINAL_RUN_STATUSES: ReadonlySet<string | null> = new Set([
    "completed",
    "failed",
    "killed",
    "cancelled",
    "interrupted",
  ]);

  const dispatch = (raw: { data: string; lastEventId?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      // 不泄露原始 payload（可能含敏感内容）
      handlers.onError(new Error("Failed to parse session SSE event"));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      handlers.onError(new Error("Invalid session SSE payload"));
      return;
    }
    const env = parsed as Partial<SessionStreamEnvelope>;
    const kind = env.event;
    if (!kind) {
      // 无 event 字段：非 session channel 事件（如 backend summary 帧），忽略。
      return;
    }
    // 校验 session_id（permission_* 等同样携带 session_id，统一校验）
    if (env.session_id !== undefined && env.session_id !== sessionId) {
      handlers.onError(new Error(`Session id mismatch on ${kind} event`));
      return;
    }
    // turn / plan / bash / agent_task 类事件必须有 run_id（缺 run_id 的畸形
    // payload 事件丢弃——否则 run_id: String(undefined) 归一成字符串 "undefined"
    // 挂到不存在的 run 上）。agent_task_status 2026-08-25 补入白名单。
    if (
      (kind === "turn_started" ||
        kind === "log" ||
        kind === "turn_completed" ||
        kind === "tokens" ||
        kind === "plan_mode_entered" ||
        kind === "bash_status" ||
        kind === "bash_chunk" ||
        kind === "agent_task_status") &&
      !env.run_id
    ) {
      handlers.onError(new Error(`Missing run_id on ${kind} event`));
      return;
    }
    if (kind === "log" && raw.lastEventId) {
      lastEventId = raw.lastEventId;
    }
    // P4：游标推进——实时 log 事件也计入（envelope.timestamp 是后端落库同源 ts）。
    if (kind === "log" && typeof env.timestamp === "string" && env.timestamp) {
      if (!lastLogTs || env.timestamp > lastLogTs) lastLogTs = env.timestamp;
    }
    const envelope = env as SessionStreamEnvelope;
    switch (kind) {
      case "turn_started":
        handlers.onTurnStarted(envelope);
        break;
      case "log":
        handlers.onLog(envelope, raw.lastEventId ?? null);
        break;
      case "turn_completed":
        handlers.onTurnCompleted(envelope);
        // ql-20260820-010：轮完成即对账——Redis publish 是 best-effort（AC-06
        // try/except 吞错），连接活着也可能丢尾部日志事件（实测最终答复文本
        // 入库但未发布），轮边界重拉 DB 兜底收敛。
        schedulePostTurnReconcile();
        break;
      case "tokens":
        // ql-20260621：实时累积 token（每次 submit_messages 推送）。
        handlers.onTokens?.(envelope);
        break;
      case "plan_mode_entered":
        handlers.onPlanModeEntered?.(parsePlanModeEnteredEvent(parsed, sessionId));
        break;
      case "bash_status":
        handlers.onBashStatus?.(parseBashStatusEvent(parsed, sessionId));
        break;
      case "bash_chunk":
        handlers.onBashChunk?.(parseBashChunkEvent(parsed, sessionId));
        break;
      case "agent_task_status":
        handlers.onAgentTaskStatus?.(parseAgentTaskStatusEvent(parsed, sessionId));
        break;
      case "queue_changed":
        // 2026-08-31-session-queue-ux FR-03：会话级队列变更事件——无 run_id，
        // 铁律不入上方 run_id 必填白名单（加入会在缺 run_id 时被误判丢弃）。
        // envelope.action 透传变更种类（enqueued/reordered/edited/dispatch_now…），
        // 消费方据此即时重拉队列；5s 轮询保留兜底。
        handlers.onQueueChanged?.(envelope);
        break;
      case "session_status":
        // session_status 不进入专门 handler（无 status 变更时静默），可选扩展。
        break;
      case "session_ended":
        if (!sessionEndedFired) {
          sessionEndedFired = true;
          handlers.onSessionEnded(envelope);
          closed = true; // 会话终局：不再重连（ql-20260820-009）
          es?.close();
        }
        break;
      default:
        // permission_request / permission_resolved / done / error 等其它事件。
        // done/error 不经 streamSession 契约，仍忽略。
        // permission_request / permission_resolved 在同一 session SSE channel
        // 推送（task-11 ql-20260621）：通过 parseSessionPermissionEvent 解析后
        // 分发给 onPermissionRequest / onPermissionResolved，避免父组件再建第二条
        // EventSource 订阅 permission 通道。
        // 注意：permission_* 不在 SessionEventKind 里（非 turn 类），运行时经
        // default 分支；用 String(kind) 做比较避免 TS 在穷尽 switch 后把 kind
        // 收窄成 undefined 触发 2367。
        const rawKind = String(kind);
        if (
          (rawKind === "permission_request" || rawKind === "permission_resolved") &&
          (handlers.onPermissionRequest || handlers.onPermissionResolved)
        ) {
          const perm = parseSessionPermissionEvent(parsed);
          if (perm) {
            // 区分 request / resolved：request 含 tool_name，resolved 含 decision
            if ((perm as SessionPermissionRequest).tool_name) {
              handlers.onPermissionRequest?.(perm as SessionPermissionRequest);
            } else {
              handlers.onPermissionResolved?.(
                perm as SessionPermissionResolved,
              );
            }
          }
        }
        break;
    }
  };

  /** run 快照 → 合成 turn 事件分发（ql-20260820-009 断线恢复路径）。 */
  const dispatchRunSynth = (
    run: SessionRunRead,
    event: "turn_started" | "turn_completed",
  ) => {
    dispatch({
      data: JSON.stringify({
        event,
        session_id: sessionId,
        run_id: run.id,
        turn: null,
        log_id: null,
        timestamp:
          event === "turn_completed" ? run.finished_at : run.started_at,
        channel: null,
        content: null,
        // interrupted/cancelled → killed（对齐页面 deriveTurnTerminalStatus 语义）
        status:
          event === "turn_completed"
            ? run.status === "interrupted" || run.status === "cancelled"
              ? "killed"
              : run.status
            : null,
        exit_code: run.exit_code,
        reason: null,
        input_tokens: run.input_tokens,
        output_tokens: run.output_tokens,
      }),
    });
  };

  const wireConnection = () => {
    // token 每次重连现取（原实现只在 streamSession 调用时取一次，长连接跨
    // token 刷新后重连会带旧值）。
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    // backend turn/log/permission_* 走默认 data 帧（无 event: 行）→ 必须用 onmessage 接。
    //（task-12 迁移 fetch-sse 后 onmessage 签名 {data, lastEventId}，与原一致。）
    es.onmessage = (e) => {
      retryCount = 0; // 收到事件 = 连接健康，退避档位归零
      setStatus("live"); // task-09：重建后首条实时事件 → live（横幅收起）
      dispatch({ data: e.data, lastEventId: e.lastEventId || undefined });
    };
    // 终态收口（ql-20260829-007）：backend stream_session_logs 对终态（ended/failed）
    // 会话连上即发命名事件 `event: done` 并关闭连接（连接时终态 race guard 与流中
    // session_ended 两场景同款）。done 是命名事件不进 onmessage/dispatch，此前无人
    // 监听 → 连接关闭触发 onerror → 无限重连循环（终态会话打开面板时反复打
    // runs/logs/stream）。与 session_ended 分支同语义置 closed 终止本流；
    // `event: error`（Redis 故障，AC-07）保持 onerror → 退避重连路径不变。
    es.addEventListener("done", () => {
      closed = true;
      es?.close();
    });
    es.onerror = (ev) => {
      // R7（ql-20260903-021，对齐下方审批流先例）：永久性 HTTP 错误（401/403/404，
      // PERMANENT_SSE_ERROR_STATUSES）停本订阅重连循环——无权限/已删除会话
      // 每 30s 重打必败请求（resync runs/logs + stream 三连）无意义且刷日志；
      // 无 status（网络断/服务端关流）保持退避重连路径不变。
      if (
        ev &&
        typeof ev.status === "number" &&
        PERMANENT_SSE_ERROR_STATUSES.has(ev.status)
      ) {
        es?.close();
        closed = true;
        return;
      }
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
      ]!;
    retryCount += 1;
    // task-09：进入退避重连——上报 reconnecting（attempt = 即将进行的第 N 次）。
    setStatus("reconnecting", retryCount);
    reconnectTimer = setTimeout(() => {
      void resyncAndReconnect();
    }, delay);
  };

  /** DB 日志 → log 事件回放（resync 与轮后对账共用；调用方 seenLogIds 去重）。
   *
   * P4：已有游标（lastLogTs）时改增量拉取（after = 游标 - 2s 重叠，后端
   * `timestamp > after` 严格过滤）；首次（无游标）仍全量。
   * F7：signal 仅 resync 路径传入（超时防卡死）；轮后对账不设超时（行为不变）。 */
  const replayLogsFromDb = async (signal?: AbortSignal) => {
    let afterParam: string | undefined;
    if (lastLogTs) {
      const ts = Date.parse(lastLogTs);
      if (!Number.isNaN(ts)) {
        afterParam = new Date(Math.max(0, ts - REPLAY_OVERLAP_MS)).toISOString();
      }
    }
    const logs = await getAgentSessionLogs(
      sessionId,
      afterParam ? { after: afterParam, signal } : signal ? { signal } : {},
    );
    if (closed) return;
    for (const log of logs) {
      if (log.timestamp && (!lastLogTs || log.timestamp > lastLogTs)) {
        lastLogTs = log.timestamp;
      }
      dispatch({
        data: JSON.stringify({
          event: "log",
          session_id: sessionId,
          run_id: log.run_id,
          turn: null,
          log_id: log.id,
          timestamp: log.timestamp,
          channel: log.channel,
          content: log.content_redacted ?? "",
          status: null,
          exit_code: null,
          reason: null,
          // ql-20260827-018：归属字段透传——回放日志与硬重载渲染一致（子代理
          // 嵌套 / 工具类型 / Edit patch）。此前只带 5 个基础字段，断线 resync /
          // 轮后对账补放的子代理日志平铺渲染、与刷新后不一致。segment_id/stale
          // 不在 /logs DTO（partial 行 content 自带标记、override 撤回由分类器
          // 解析 content 前缀），维持 undefined 语义。
          parent_tool_use_id: log.parent_tool_use_id ?? null,
          subagent_type: log.subagent_type ?? null,
          depth: log.depth ?? null,
          tool_kind: log.tool_kind ?? null,
          edit_patch: log.edit_patch ?? null,
        }),
      });
    }
  };

  /**
   * 轮完成后对账（ql-20260820-010）：1.5s 缓冲后重拉日志回放——补「连接活着但
   * Redis 发布丢失」的尾部事件（如最终答复文本）。页面 upsertTurn 允许 log 事件
   * 落在终态轮（终态幂等设计），已见日志由装配器 seenLogIds 去重，回放安全。
   */
  const schedulePostTurnReconcile = () => {
    if (closed) return;
    if (postTurnTimer) clearTimeout(postTurnTimer);
    postTurnTimer = setTimeout(() => {
      void replayLogsFromDb().catch(() => {
        /* 静默：下一次轮完成 / 断连对账再兜 */
      });
    }, 1500);
  };

  /**
   * ql-20260827-018：DB 缺口同步（断线 resync 与首连缺口共用）——runs 快照 →
   * 运行中 run 合成 turn_started（建轮 + 设 currentRunId）→ /logs 增量回放
   * （P4 游标-2s 重叠，首次全量；调用方 seenLogIds 去重补缺口）→ 终态 run 合成
   * turn_completed（补错过的完成事件；页面终态幂等，重复合成 no-op）。
   * 不含建连——调用方决定时序（resync：同步后 wireConnection；首连：wireConnection
   * 前同步，回放期间无实时事件竞争、段内时序干净，与 resync 同序）。
   */
  const syncGapFromDb = async (signal?: AbortSignal) => {
    const runs = await listSessionRuns(sessionId, { signal });
    if (closed) return;
    for (const run of runs) {
      if (!TERMINAL_RUN_STATUSES.has(run.status)) {
        dispatchRunSynth(run, "turn_started");
      }
    }
    await replayLogsFromDb(signal);
    if (closed) return;
    for (const run of runs) {
      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        dispatchRunSynth(run, "turn_completed");
      }
    }
  };

  /**
   * 断线恢复（ql-20260820-009）：runs 快照 → 运行中 run 合成 turn_started
   * （建轮 + 设 currentRunId）→ /logs 增量回放（P4 游标-2s 重叠，首次全量；调用方 seenLogIds 去重补缺口）
   * → 终态 run 合成 turn_completed（补错过的完成事件；页面终态幂等，重复合成
   * no-op）→ 重建 SSE 连接。订阅后 5s 延迟复核兜「快照与订阅之间完成」的 run。
   * 回放与实时事件的段内时序可能有微小交错（罕见，仅断连恢复瞬间）。
   */
  const resyncAndReconnect = async () => {
    if (closed) return;
    // F7：resync 快照拉取带超时——TCP 挂起时 abort 视为 resync 失败，走既有
    // catch 退避分支继续重连循环（不停摆数分钟）。仅作用于本轮两个 REST 调用。
    const signal = timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS);
    try {
      await syncGapFromDb(signal);
      if (closed) return;
      retryCount = 0;
      wireConnection();
      // task-09：resync 完成建连 → reconnected（「连接已恢复，正在同步…」；
      // 收到首条实时事件后再转 live）。
      setStatus("reconnected");
      reconcileTimer = setTimeout(() => void reconcileTerminalRuns(), 5000);
    } catch (err) {
      // ql-20260904-H2（R7 补口）：resync 阶段的永久性 REST 错误（会话已删/
      // 权限收回）与网络错误分流——es.onerror 的停连分支建连前走不到，此处
      // 不停会把必败 resync 变成每 30s 一轮的永久循环。停订阅终态（清三
      // 定时器，对齐 close() 收口口径）。
      if (isPermanentRestError(err)) {
        closed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (reconcileTimer) clearTimeout(reconcileTimer);
        if (postTurnTimer) clearTimeout(postTurnTimer);
        es?.close();
        return;
      }
      scheduleReconnect(); // 后端不可达 → 继续退避重试
    }
  };

  /** 订阅后延迟复核：补「快照与订阅之间」完成的 run（幂等，已终态 no-op）。 */
  const reconcileTerminalRuns = async () => {
    if (closed) return;
    try {
      const runs = await listSessionRuns(sessionId);
      if (closed) return;
      for (const run of runs) {
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          dispatchRunSynth(run, "turn_completed");
        }
      }
    } catch {
      /* 复核失败不重试（下一断连循环会再兜） */
    }
  };

  // ql-20260827-018：首连缺口同步——调用方已回灌历史（cursor）或预取失败
  // （initialSync）时，建连**前**跑一次 DB 缺口同步（同 resync 时序：回放期间
  // 无实时事件竞争，段内时序干净），补「历史快照 → SSE 订阅」窗口内发布的
  // 事件；同步失败不阻断建连（轮后对账 / 断线 resync 兜底）。建连后 5s 延迟
  // 复核兜「同步窗口内完成」的 run（同 resync）。
  if (options?.cursor || options?.initialSync) {
    void syncGapFromDb(
      timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS),
    )
      .catch(() => {
        /* 静默：轮后对账 / 断线 resync 再兜 */
      })
      .finally(() => {
        if (!closed && !es) wireConnection();
        if (!closed) {
          reconcileTimer = setTimeout(() => void reconcileTerminalRuns(), 5000);
        }
      });
  } else {
    wireConnection();
  }

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (postTurnTimer) clearTimeout(postTurnTimer);
      es?.close();
    },
    getLastEventId: () => lastEventId,
    // task-09：看门狗对账入口——复用断线 resync 的 DB 缺口同步路径（终态 run
    // 合成 turn_completed / 运行中 run 合成 turn_started / 增量日志回放），
    // 不重建 SSE 连接、不设超时（同轮后对账 1.5s 重放先例）。
    resync: () => {
      if (closed) return;
      void syncGapFromDb().catch(() => {
        /* 静默：看门狗下一轮再对账 */
      });
    },
  };
}

/* ---------- 会话列表变更信号订阅（2026-08-24-sessions-live-updates task-05） ----------
 *
 * GET /api/daemon/sessions/events：backend 在会话生命周期事件（创建 / 状态迁移 /
 * 删除）时经 Redis Pub/Sub 广播的哑信号，SSE 侧已按当前用户过滤。前端不解析
 * payload——收到即回调，由门户 invalidate ["agentSessions"] 前缀重拉列表
 * （design §2.2）。退避重连骨架抄 streamSession 的收敛版：fetchSse 无自动重连
 * （fetch-sse.ts 头注释），断连期间广播的信号对本连接永久丢失，靠 onReconnected
 * 补拉兜缺口。
 */

/**
 * 订阅会话列表变更信号（SSE，2026-08-24-sessions-live-updates task-05）。
 *
 * - onEvent：收到任一 data 帧（JSON 信号）触发一次。
 * - onReconnected：仅断开过才调，每个断连-恢复周期恰一次——重连成功（下一次
 *   连接建立 onopen 或首条消息，先到者）时触发，供调用方补拉断连期间丢失的
 *   信号（Redis Pub/Sub 无补发 / 无 Last-Event-ID 重放）。
 * - onConnected：F7（2026-08-25 后端审查遗留 B6）：每个连接周期恰一次（含**首次**
 *   订阅建立，onopen 或首条消息先到者）——调用方在订阅建立后补拉一次列表，兜
 *   「先拉快照（useQuery）后订阅（effect 建 SSE）」窗口内丢失的变更；重连建立
 *   时与 onReconnected 同点触发（调用方经同一去抖单点合并，不叠加刷新风暴）。
 * - close()：幂等终止（关连接 + 清退避定时器），之后不再重连。
 */
export function subscribeAgentSessionsEvents(opts: {
  onEvent: () => void;
  onReconnected?: () => void;
  onConnected?: () => void;
}): { close: () => void } {
  const url = new URL(`${getApiBaseUrl()}/api/daemon/sessions/events`);

  let es: FetchSseConnection | null = null;
  let closed = false; // 调用方 close() 后不再重连
  let retryCount = 0; // 退避档位（收到信号归零，对齐 streamSession）
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hadDisconnection = false; // 断开过 → 下一次连接成功补发一次 onReconnected
  let connectedFired = false; // 本连接周期 onConnected 已发（onopen / 首条消息先到者）

  /** 断开后首次「连接成功」（onopen 或首条消息，先到者）触发一次 onReconnected。 */
  const fireReconnectedOnce = () => {
    if (!hadDisconnection) return;
    hadDisconnection = false;
    opts.onReconnected?.();
  };

  /** 连接建立恰一次 onConnected（含首次订阅；fireReconnectedOnce 语义独立叠加）。 */
  const fireConnectedOnce = () => {
    fireReconnectedOnce();
    if (connectedFired) return;
    connectedFired = true;
    opts.onConnected?.();
  };

  const wireConnection = () => {
    connectedFired = false; // 新连接周期重置（onopen / 首条消息先到者触发）
    // token 每次重连现取（对齐 streamSession：长连接跨 token 刷新后重连不带旧值）。
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    es.onopen = () => {
      fireConnectedOnce();
    };
    // backend 信号统一发默认 data 帧（无 event: 行）→ onmessage 接收。
    es.onmessage = () => {
      retryCount = 0; // 收到信号 = 连接健康，退避档位归零
      fireConnectedOnce();
      opts.onEvent();
    };
    es.onerror = (ev) => {
      // R7（2026-08-30 审计）：永久性 HTTP 错误（401/403/404，见
      // PERMANENT_SSE_ERROR_STATUSES）停本订阅重连循环——此前对必败请求无限
      // 退避重打（8fab9af4 时的明确留置项）；无 status（网络断/服务端关流）
      // 保持退避重连路径不变（不额外 close，维持既有语义）。
      if (
        ev &&
        typeof ev.status === "number" &&
        PERMANENT_SSE_ERROR_STATUSES.has(ev.status)
      ) {
        es?.close();
        closed = true;
        return;
      }
      hadDisconnection = true;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
      ]!;
    retryCount += 1;
    reconnectTimer = setTimeout(() => {
      if (closed) return;
      wireConnection();
    }, delay);
  };

  wireConnection();

  return {
    close: () => {
      if (closed) return; // 幂等
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    },
  };
}
