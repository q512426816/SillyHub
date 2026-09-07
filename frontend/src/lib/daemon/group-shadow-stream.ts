/**
 * Daemon API client —— 群聊/影子会话 SSE 流（streamGroupChat /
 * streamShadowSession + 群流事件/信封类型；群身份/附件/引用类型定义在
 * ./group-chat）。类型/常量在 ./session-sse，重连内部工具在 ./sse-internals。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { getApiBaseUrl } from "@/lib/api";
import type { AgentRunLogEntry } from "@/lib/agent";
import { useSession } from "@/stores/session";
import { fetchSse, type FetchSseConnection } from "@/lib/fetch-sse";
import { getAgentSessionLogs } from "./sessions";
import {
  isPermanentRestError,
  RESYNC_REST_TIMEOUT_MS,
  timeoutSignal,
} from "./sse-internals";
import {
  PERMANENT_SSE_ERROR_STATUSES,
  RECONNECT_BACKOFF_MS,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
  type SessionStreamStatus,
} from "./session-sse";
import type {
  GroupMessageAttachmentSummary,
  GroupMessageReplySnapshot,
} from "./group-chat";
/**
 * 群流 SSE 信封（design §6.2 envelope 扩展）：在 SessionStreamEnvelope 基础上
 * 增群身份可选字段——存量单聊事件不带（向后兼容，运行时 undefined/null）。
 *   - log(user_input 行)：sender_member_name / sender_user_id（发送者身份）；
 *   - log(投影行)：member_id / member_name / member_session_id（agent 成员身份，
 *     log_id=投影行 id——与回放读库同 id）；stale 撤回令箭行（[ASSISTANT_OVERRIDE]
 *     前缀，log_id=null）按 segment_id 撤回已渲染半截行；
 *   - turn_completed：member_id / member_name / member_session_id（哪个成员说完）；
 *   - typing：member_name / member_kind / typing / preview / ts（task-06 合流帧）。
 */
export interface GroupChatStreamEnvelope extends SessionStreamEnvelope {
  member_id?: string | null;
  member_name?: string | null;
  member_session_id?: string | null;
  sender_member_name?: string | null;
  sender_user_id?: string | null;
  member_kind?: string | null;
  typing?: boolean | null;
  preview?: string | null;
  /**
   * typing 帧（agent 事件）回复锚点（群聊运行态可见 quick，2026-09-02）：
   * 触发消息的群时间线 user_input 行 id——「agent 正在响应哪句话」；互@路径
   * 触发源是 agent 投影行，不带锚点；用户手动 typing 恒不带；止息帧不带。
   */
  reply_to_log_id?: string | null;
  /** FR-05 补遗：user_input 行附件摘要（无附件缺省 null/undefined 不渲染）。 */
  attachments?: GroupMessageAttachmentSummary[] | null;
  /**
   * 引用回复快照（群 P2 第二波，2026-09-02）：user_input 行发送带
   * ``reply_to_log_id`` 时后端随群频道 log 事件下发 ``reply_to``
   * （{log_id, member_name, content_head}，与回放 metadata 同构）。
   */
  reply_to?: GroupMessageReplySnapshot | null;
  /**
   * presence 帧（群在线实时化 quick，2026-09-04）：成员上/下线即时通知——
   * user_id + online；事件不回放（pub/sub 即发即忘），断线重连靠列表重拉对账。
   */
  user_id?: string | null;
  online?: boolean | null;
  ts?: string | null;
}

/**
 * typing 分支事件（design §5.4 typing.ping payload；ts 供调试观测，TTL 归前端）。
 *
 * ``member_id``/``reply_to_log_id``（群聊运行态可见 quick，2026-09-02）：仅
 * agent 自动事件携带（止息帧带 member_id 不带锚点）；用户手动 typing 心跳
 * 与历史形态一致（两者 null）——消费侧按 member_kind 区分。
 */
export interface GroupChatTypingEvent {
  member_name: string | null;
  /** user=用户成员 / agent=后端代发的「成员正在生成回复」。 */
  member_kind: string | null;
  typing: boolean;
  preview: string | null;
  ts: string | null;
  /** agent 事件：成员行 id（止息帧恒携带）；用户事件 null。 */
  member_id: string | null;
  /** agent 事件：触发消息的 user_input 行 id（回复锚点）；止息/用户事件 null。 */
  reply_to_log_id: string | null;
}

/**
 * presence 分支事件（群在线实时化 quick，2026-09-04；design §5.4 群实时频道）。
 *
 * SSE 连接建立/断开触发（后端 ``publish_member_presence``）——前端按 user_id
 * 即时覆盖在线绿点；事件不可回放，断线重连由消费方作废覆盖层 + 重拉列表快照
 * 对账。
 */
export interface GroupChatPresenceEvent {
  /** 上/下线用户 id（对齐群成员 user_id 匹配在线绿点）。 */
  user_id: string | null;
  online: boolean;
  ts: string | null;
}

/** 群流回调集（task-08 group-chat-panel 消费面）。 */
export interface GroupChatStreamHandlers {
  /** log 分支：user_input 行 / 投影行 / stale 撤回令箭（调用方 seenLogIds 去重）。 */
  onLog(envelope: GroupChatStreamEnvelope, cursor: string | null): void;
  /** turn_completed 分支：member 身份收口（成员流式光标停止）。 */
  onTurnCompleted(envelope: GroupChatStreamEnvelope): void;
  /** typing 分支（可选）：谁正在输入 + 草稿预览。 */
  onTyping?(event: GroupChatTypingEvent): void;
  /** presence 分支（可选，群在线实时化 quick）：成员上/下线即时覆盖在线集。 */
  onPresence?(event: GroupChatPresenceEvent): void;
  /** queue_changed 分支（可选）：群内不展示队列 UI（design §9.8），透传备消费。 */
  onQueueChanged?(envelope: GroupChatStreamEnvelope): void;
  /** session_ended 分支（可选）：群解散（连接自动关闭不再重连）。 */
  onSessionEnded?(envelope: GroupChatStreamEnvelope): void;
  onError(error: Error): void;
  /** 连接状态（同 streamSession 语义：reconnecting 携 attempt / reconnected / live）。 */
  onStatusChange?(status: SessionStreamStatus, attempt?: number): void;
}

/**
 * 群回放日志行：/logs DTO（AgentRunLogEntry）+ 群投影行 metadata 透传位。
 *
 * 2026-09-01-session-group-chat 收口：后端 AgentRunLogEntry DTO 已补
 * metadata/segment_id 列并经 gen:types 进生成版 schema——本类型不再承担
 * 「运行时缺省 undefined 的容错位」职责，保留原因：基类是 @/lib/agent 手写
 * AgentRunLogEntry（单聊路径共用，未含两新列），且生成版 metadata 是松散
 * 索引签名 `{[key: string]: unknown}`，此处窄化为投影行/user_input 行的
 * 具名键视图（消费面 group-chat-panel 免逐处 cast）。字段名与生成版严格
 * 同名（metadata/segment_id），后端演进经 gen:types 对账。
 */
export interface GroupReplayLogEntry extends AgentRunLogEntry {
  segment_id?: string | null;
  metadata?: {
    member_id?: string | null;
    member_name?: string | null;
    source_log_id?: string | null;
    sender_member_name?: string | null;
    sender_user_id?: string | null;
    projection?: boolean;
    /** FR-05 补遗：user_input 行附件摘要（与 SSE 实时事件 payload 同形态）。 */
    attachments?: GroupMessageAttachmentSummary[] | null;
    /** 引用回复快照（群 P2 第二波；与实时事件 payload 同形态）。 */
    reply_to?: GroupMessageReplySnapshot | null;
  } | null;
}

/**
 * 订阅群会话 SSE 流（task-08 / FR-09 / FR-12，design §5.2-§5.4）。
 *
 * 照 streamSession 的 fetchSse 骨架独立实现（**不动单聊路径**，共享常量仅
 * import——task 卡 constraints）：
 *   - URL 走 Next 代理 /api/daemon/sessions/{群会话id}/stream（群频道
 *     agent_session:{gid} 与 typing 频道已在 backend 生成器侧合流，同一连接
 *     收 log / turn_completed / typing / queue_changed / session_ended）；
 *   - 默认 data 帧 onmessage 单通道 dispatch（同 streamSession P0-1）；
 *   - 断线退避重连（复用 RECONNECT_BACKOFF_MS 档位）+ resync：重连前经
 *     getAgentSessionLogs 增量回放（after = lastLogTs - 2s 重叠窗口，首次全量）
 *     补断连缺口，合成 log 事件经 onLog 分发（调用方 seenLogIds 去重）；
 *     群不消费 run 分组装配（D-011），无需 runs 快照合成 turn 事件；
 *   - turn_completed 后 1.5s 轮后对账（同 streamSession ql-20260820-010：
 *     Redis publish best-effort，轮边界重拉 DB 兜尾部日志丢失）；
 *   - `event: done`（终态会话连上即发）→ 关连接不重连（终态群不刷重连循环）。
 *
 * 与 streamSession 的差异（群形态）：无 runs 快照 / turn_started 合成（群时间
 * 线是平铺消息流模型，design §9.8）；无 permission_* 分支（群不进审批，§9.1）；
 * typing 分支合流消费。
 */
export function streamGroupChat(
  sessionId: string,
  handlers: GroupChatStreamHandlers,
  options?: {
    /** 已回灌历史的最大 log timestamp（ISO）——首连增量游标起点。 */
    cursor?: string;
    resyncTimeoutMs?: number;
  },
): SessionStreamConnection {
  const base = getApiBaseUrl();
  const url = new URL(
    `${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);

  let lastEventId: string | null = null;
  let sessionEndedFired = false;
  // 增量回放游标（同 streamSession：-2s 重叠窗口兜同批 timestamp，重复行由
  // 调用方 seenLogIds 按 log_id 去重）。
  let lastLogTs: string | null = options?.cursor ?? null;
  const REPLAY_OVERLAP_MS = 2000;

  let es: FetchSseConnection | null = null;
  let closed = false;
  let retryCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let postTurnTimer: ReturnType<typeof setTimeout> | null = null;
  let connStatus: SessionStreamStatus = "live";
  const setStatus = (s: SessionStreamStatus, attempt?: number): void => {
    if (s === "reconnecting") {
      connStatus = s;
      handlers.onStatusChange?.(s, attempt);
      return;
    }
    if (connStatus === s) return;
    connStatus = s;
    handlers.onStatusChange?.(s);
  };

  const dispatch = (raw: { data: string; lastEventId?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      handlers.onError(new Error("Failed to parse group SSE event"));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      handlers.onError(new Error("Invalid group SSE payload"));
      return;
    }
    const env = parsed as Partial<GroupChatStreamEnvelope>;
    const kind = env.event;
    if (!kind) return; // 无 event 字段：非本通道事件（backend summary 帧等），忽略
    if (env.session_id !== undefined && env.session_id !== sessionId) {
      handlers.onError(new Error(`Session id mismatch on ${kind} event`));
      return;
    }
    // typing 帧 session_id 可能缺省（_typing_payload 不带）——身份按频道归属
    // 信任，不因缺 session_id 丢弃。
    if (kind === "log" && raw.lastEventId) {
      lastEventId = raw.lastEventId;
    }
    if (kind === "log" && typeof env.timestamp === "string" && env.timestamp) {
      if (!lastLogTs || env.timestamp > lastLogTs) lastLogTs = env.timestamp;
    }
    const envelope = env as GroupChatStreamEnvelope;
    // typing/presence 不在 SessionEventKind（task-06 群新增帧类型）——switch
    // 穷尽前以字符串比较分流（对齐 permission_* 同款先例，避免联合收窄误判）。
    if (String(kind) === "typing") {
      const event: GroupChatTypingEvent = {
        member_name:
          typeof envelope.member_name === "string" ? envelope.member_name : null,
        member_kind:
          typeof envelope.member_kind === "string" ? envelope.member_kind : null,
        typing: envelope.typing !== false,
        preview: typeof envelope.preview === "string" ? envelope.preview : null,
        ts: typeof envelope.timestamp === "string" ? envelope.timestamp : null,
        member_id:
          typeof envelope.member_id === "string" ? envelope.member_id : null,
        reply_to_log_id:
          typeof envelope.reply_to_log_id === "string"
            ? envelope.reply_to_log_id
            : null,
      };
      handlers.onTyping?.(event);
      return;
    }
    if (String(kind) === "presence") {
      const tsRaw =
        typeof envelope.ts === "string"
          ? envelope.ts
          : typeof envelope.timestamp === "string"
            ? envelope.timestamp
            : null;
      const event: GroupChatPresenceEvent = {
        user_id: typeof envelope.user_id === "string" ? envelope.user_id : null,
        online: envelope.online === true,
        ts: tsRaw,
      };
      handlers.onPresence?.(event);
      return;
    }
    switch (kind) {
      case "log":
        handlers.onLog(envelope, raw.lastEventId ?? null);
        break;
      case "turn_completed":
        handlers.onTurnCompleted(envelope);
        // 轮完成即对账（Redis publish best-effort，尾部日志可能丢——重拉 DB 兜）。
        schedulePostTurnReconcile();
        break;
      case "queue_changed":
        // 影子会话队列事件（无 run_id；群 UI 不展示队列，design §9.8）——透传
        // 备消费，不入 run_id 必填白名单。
        handlers.onQueueChanged?.(envelope);
        break;
      case "session_status":
        break; // 无状态变更消费（群状态经列表信号通道刷新）
      case "session_ended":
        if (!sessionEndedFired) {
          sessionEndedFired = true;
          handlers.onSessionEnded?.(envelope);
          closed = true;
          es?.close();
        }
        break;
      default:
        // permission_*（群不进审批 §9.1）/ tokens / plan / bash 等单聊事件不消费。
        break;
    }
  };

  /** DB 日志 → log 事件回放（resync 与轮后对账共用；调用方 seenLogIds 去重）。 */
  const replayLogsFromDb = async (signal?: AbortSignal) => {
    let afterParam: string | undefined;
    if (lastLogTs) {
      const ts = Date.parse(lastLogTs);
      if (!Number.isNaN(ts)) {
        afterParam = new Date(Math.max(0, ts - REPLAY_OVERLAP_MS)).toISOString();
      }
    }
    const logs = (await getAgentSessionLogs(
      sessionId,
      afterParam ? { after: afterParam, signal } : signal ? { signal } : {},
    )) as GroupReplayLogEntry[];
    if (closed) return;
    for (const log of logs) {
      if (log.timestamp && (!lastLogTs || log.timestamp > lastLogTs)) {
        lastLogTs = log.timestamp;
      }
      const meta = log.metadata ?? null;
      dispatch({
        data: JSON.stringify({
          event: "log",
          session_id: sessionId,
          run_id: log.run_id,
          log_id: log.id,
          timestamp: log.timestamp,
          channel: log.channel,
          content: log.content_redacted ?? "",
          // 群身份透传（回放与实时渲染一致）：投影行 member_* / 用户行
          // sender_*（后端 DTO 暴露 metadata 前运行时为 null，前端容错回退）。
          // FR-05 补遗：user_input 行附件摘要同透传（实时事件 payload 同形态）；
          // 群 P2 第二波：reply_to 引用快照同透传（同构）。
          segment_id: log.segment_id ?? null,
          member_id: meta?.member_id ?? null,
          member_name: meta?.member_name ?? null,
          sender_member_name: meta?.sender_member_name ?? null,
          sender_user_id: meta?.sender_user_id ?? null,
          attachments: meta?.attachments ?? null,
          reply_to: meta?.reply_to ?? null,
        }),
      });
    }
  };

  /** 轮完成后对账（1.5s 缓冲重拉日志，补「连接活着但发布丢失」的尾部行）。 */
  const schedulePostTurnReconcile = () => {
    if (closed) return;
    if (postTurnTimer) clearTimeout(postTurnTimer);
    postTurnTimer = setTimeout(() => {
      void replayLogsFromDb().catch(() => {
        /* 静默：下一次轮完成 / 断连对账再兜 */
      });
    }, 1500);
  };

  const wireConnection = () => {
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    es.onmessage = (e) => {
      retryCount = 0;
      setStatus("live");
      dispatch({ data: e.data, lastEventId: e.lastEventId || undefined });
    };
    es.addEventListener("done", () => {
      // 终态会话（群解散 backend 发 event: done）——关连接不重连。
      closed = true;
      es?.close();
    });
    es.onerror = (ev) => {
      // R7（ql-20260903-021，同 streamSession）：永久性 HTTP 错误（401/403/404）
      // 停本订阅重连循环——无权限/已删除群每 30s 重打必败请求无意义且刷日志；
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
    setStatus("reconnecting", retryCount);
    reconnectTimer = setTimeout(() => {
      void resyncAndReconnect();
    }, delay);
  };

  /** 断线恢复：增量回放补缺口 → 重建 SSE 连接（无 runs 合成，群无 run 模型）。 */
  const resyncAndReconnect = async () => {
    if (closed) return;
    const signal = timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS);
    try {
      await replayLogsFromDb(signal);
      if (closed) return;
      retryCount = 0;
      wireConnection();
      setStatus("reconnected");
      reconcileTimer = setTimeout(() => {
        void replayLogsFromDb().catch(() => {
          /* 静默 */
        });
      }, 5000);
    } catch (err) {
      // ql-20260904-H2（R7 补口，同 streamSession）：resync 阶段的永久性 REST
      // 错误（会话/群已删/权限收回）停订阅终态——es.onerror 的停连分支建连前
      // 走不到，不停则每 30s 一轮必败 resync 永久循环。清三定时器对齐 close()。
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

  wireConnection();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (postTurnTimer) clearTimeout(postTurnTimer);
      es?.close();
    },
    getLastEventId: () => lastEventId,
    // 主动对账入口（同 streamSession 语义：不重建连接，仅补 DB 缺口）。
    resync: () => {
      if (closed) return;
      void replayLogsFromDb().catch(() => {
        /* 静默 */
      });
    },
  };
}

/* ---------- 影子会话 SSE 流（quick 影子直聊，2026-09-02） ---------- */

/** 影子会话流回调集——单聊事件面的收敛子集。 */
export interface ShadowSessionStreamHandlers {
  /** log 分支：实时 / 回放行（调用方按 log_id 去重合并进本地 rows）。 */
  onLog(envelope: SessionStreamEnvelope, cursor: string | null): void;
  /** turn_completed 分支（可选）：轮收口信号（lib 内部另排 1.5s 轮后对账补尾行）。 */
  onTurnCompleted?(envelope: SessionStreamEnvelope): void;
  onError(error: Error): void;
  /** 连接状态（同 streamSession 语义：reconnecting 携 attempt / reconnected / live）。 */
  onStatusChange?(status: SessionStreamStatus, attempt?: number): void;
}

/**
 * 订阅影子会话 SSE 流（quick 影子直聊，2026-09-02）——影子会话 Drawer 形态
 * 的实时数据源。
 *
 * 端点同单聊 GET /api/daemon/sessions/{sid}/stream（backend 权限：影子属主=
 * 群主 + workspace admin 放行；普通成员 403——调用方按 canDirectMessage 门控
 * 不建流）。骨架照 streamGroupChat 收敛（同一 URL 形态 / 默认 data 帧
 * onmessage 单通道 / 断线退避重连 + 增量回放 resync（after = lastLogTs - 2s
 * 重叠窗口）/ turn_completed 后 1.5s 轮后对账 / `event: done` 终态不重连），
 * 与 streamGroupChat 的差异：
 *   - 信封用 SessionStreamEnvelope（影子会话无群身份 / typing 帧；tokens /
 *     permission_* 等单聊事件本流不消费——查看器只喂 rows 重装配）；
 *   - 回放透传子代理归属 / 工具字段（对齐 streamSession 的 replayLogsFromDb
 *     ——影子 logs 含子代理行，缺字段装配会平铺错位）；
 *   - R7 永久性 HTTP 错误（401/403/404，PERMANENT_SSE_ERROR_STATUSES）停连
 *     不重试——普通成员误建流时必败请求不进退避循环（subscribeAgentSessions
 *     Events 同款惯例；群形态流未收编该守卫，此处收敛版带上）。
 */
export function streamShadowSession(
  sessionId: string,
  handlers: ShadowSessionStreamHandlers,
  options?: {
    /** 已回灌历史的最大 log timestamp（ISO）——resync 增量回放游标起点。 */
    cursor?: string;
    resyncTimeoutMs?: number;
  },
): SessionStreamConnection {
  const base = getApiBaseUrl();
  const url = new URL(
    `${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);

  let lastEventId: string | null = null;
  let sessionEndedFired = false;
  // 增量回放游标（同 streamGroupChat：-2s 重叠窗口兜同批 timestamp，重复行由
  // 调用方按 log_id 去重）。
  let lastLogTs: string | null = options?.cursor ?? null;
  const REPLAY_OVERLAP_MS = 2000;

  let es: FetchSseConnection | null = null;
  let closed = false;
  let retryCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let postTurnTimer: ReturnType<typeof setTimeout> | null = null;
  let connStatus: SessionStreamStatus = "live";
  const setStatus = (s: SessionStreamStatus, attempt?: number): void => {
    if (s === "reconnecting") {
      connStatus = s;
      handlers.onStatusChange?.(s, attempt);
      return;
    }
    if (connStatus === s) return;
    connStatus = s;
    handlers.onStatusChange?.(s);
  };

  const dispatch = (raw: { data: string; lastEventId?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      handlers.onError(new Error("Failed to parse shadow session SSE event"));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      handlers.onError(new Error("Invalid shadow session SSE payload"));
      return;
    }
    const env = parsed as Partial<SessionStreamEnvelope>;
    const kind = env.event;
    if (!kind) return; // 无 event 字段：非本通道事件（backend summary 帧等），忽略
    if (env.session_id !== undefined && env.session_id !== sessionId) {
      handlers.onError(new Error(`Session id mismatch on ${kind} event`));
      return;
    }
    if (kind === "log" && raw.lastEventId) {
      lastEventId = raw.lastEventId;
    }
    if (kind === "log" && typeof env.timestamp === "string" && env.timestamp) {
      if (!lastLogTs || env.timestamp > lastLogTs) lastLogTs = env.timestamp;
    }
    const envelope = env as SessionStreamEnvelope;
    switch (kind) {
      case "log":
        handlers.onLog(envelope, raw.lastEventId ?? null);
        break;
      case "turn_completed":
        // 轮收口：数据面由调用方决定（查看器 rows 全量重装配无轮状态机），此处
        // 只透传信号 + 排轮后对账。
        handlers.onTurnCompleted?.(envelope);
        schedulePostTurnReconcile();
        break;
      case "session_status":
        break; // 影子会话状态经群详情 / 成员卡徽标刷新，本流不消费
      case "session_ended":
        // 影子会话被结束（移除成员 / 重置记忆 / 切机器重建）——关连接不重连，
        // 一次性收口信号。
        if (!sessionEndedFired) {
          sessionEndedFired = true;
          closed = true;
          es?.close();
        }
        break;
      default:
        // tokens / permission_* / plan / bash / agent_task / queue_changed 等
        // 单聊富事件查看器不消费（时间线只吃 log 行），静默忽略。
        break;
    }
  };

  /** DB 日志 → log 事件回放（resync 与轮后对账共用；调用方按 log_id 去重）。 */
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
          // 归属 / 工具字段透传（对齐 streamSession replayLogsFromDb）：影子
          // logs 含子代理行与 Edit patch，缺字段重装配会平铺错位。
          parent_tool_use_id: log.parent_tool_use_id ?? null,
          subagent_type: log.subagent_type ?? null,
          depth: log.depth ?? null,
          tool_kind: log.tool_kind ?? null,
          edit_patch: log.edit_patch ?? null,
        }),
      });
    }
  };

  /** 轮完成后对账（1.5s 缓冲重拉日志，补「连接活着但发布丢失」的尾部行）。 */
  const schedulePostTurnReconcile = () => {
    if (closed) return;
    if (postTurnTimer) clearTimeout(postTurnTimer);
    postTurnTimer = setTimeout(() => {
      void replayLogsFromDb().catch(() => {
        /* 静默：下一次轮完成 / 断连对账再兜 */
      });
    }, 1500);
  };

  const wireConnection = () => {
    // token 每次重连现取（对齐 streamSession / streamGroupChat）。
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    es.onmessage = (e) => {
      retryCount = 0;
      setStatus("live");
      dispatch({ data: e.data, lastEventId: e.lastEventId || undefined });
    };
    es.addEventListener("done", () => {
      // 终态会话（影子已被结束）连上即发 `event: done`——关连接不重连。
      closed = true;
      es?.close();
    });
    es.onerror = (ev) => {
      // R7：永久性 HTTP 错误（普通成员 403 / 会话不存在 404 / 未登录 401）停
      // 连——必败请求不进退避循环；无 status（网络断 / 服务端关流）保持重连。
      if (
        ev &&
        typeof ev.status === "number" &&
        PERMANENT_SSE_ERROR_STATUSES.has(ev.status)
      ) {
        closed = true;
        es?.close();
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
    setStatus("reconnecting", retryCount);
    reconnectTimer = setTimeout(() => {
      void resyncAndReconnect();
    }, delay);
  };

  /** 断线恢复：增量回放补缺口 → 重建 SSE 连接（无 runs 合成——查看器无轮状态机）。 */
  const resyncAndReconnect = async () => {
    if (closed) return;
    const signal = timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS);
    try {
      await replayLogsFromDb(signal);
      if (closed) return;
      retryCount = 0;
      wireConnection();
      setStatus("reconnected");
      reconcileTimer = setTimeout(() => {
        void replayLogsFromDb().catch(() => {
          /* 静默 */
        });
      }, 5000);
    } catch (err) {
      // ql-20260904-H2（R7 补口，同 streamSession）：resync 阶段的永久性 REST
      // 错误（会话/群已删/权限收回）停订阅终态——es.onerror 的停连分支建连前
      // 走不到，不停则每 30s 一轮必败 resync 永久循环。清三定时器对齐 close()。
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

  wireConnection();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (postTurnTimer) clearTimeout(postTurnTimer);
      es?.close();
    },
    getLastEventId: () => lastEventId,
    // 主动对账入口（同 streamGroupChat 语义：不重建连接，仅补 DB 缺口）。
    resync: () => {
      if (closed) return;
      void replayLogsFromDb().catch(() => {
        /* 静默 */
      });
    },
  };
}
