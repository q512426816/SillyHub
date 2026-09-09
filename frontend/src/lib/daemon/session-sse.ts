/**
 * Daemon API client —— 会话 SSE 流域·类型与解析核心（事件/信封/handler 类型、
 * parseSessionPermissionEvent、重连常量、zod schema；zod import 随本模块走）。
 * 流实现在 ./session-stream（streamSession / subscribeAgentSessionsEvents）与
 * ./group-shadow-stream（streamGroupChat / streamShadowSession），
 * 重连内部共享工具在 ./sse-internals。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { z } from "zod";
import type {
  SessionPermissionRequest,
  SessionPermissionResolved,
} from "./sessions";
/**
 * task-08：解析 SSE 事件数据为 SessionPermissionRequest / SessionPermissionResolved。
 *
 * backend 在 agent_session:{session_id} channel publish 的 payload 形如：
 *   { event: "permission_request", session_id, run_id, request_id, tool_name, input, tool_use_id? }
 *   { event: "permission_resolved", session_id, request_id, decision, reason? }
 *   { event: "session_ended", ... }
 *
 * 非 permission_* 事件返回 null（让上层 SSE 订阅按其它事件类型自行处理）。
 */
export function parseSessionPermissionEvent(
  data: unknown,
): SessionPermissionRequest | SessionPermissionResolved | null {
  if (!data || typeof data !== "object") return null;
  const evt = data as Record<string, unknown>;
  if (evt.event === "permission_request") {
    const req: SessionPermissionRequest = {
      session_id: String(evt.session_id ?? ""),
      run_id: String(evt.run_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      tool_name: String(evt.tool_name ?? ""),
      input:
        evt.input && typeof evt.input === "object"
          ? (evt.input as Record<string, unknown>)
          : {},
    };
    if (typeof evt.tool_use_id === "string") {
      req.tool_use_id = evt.tool_use_id;
    }
    // AskUserQuestion 对话变体：dialog_kind 存在即渲染结构化问答卡。
    if (typeof evt.dialog_kind === "string") {
      req.dialog_kind = evt.dialog_kind;
    }
    if (evt.dialog_payload && typeof evt.dialog_payload === "object") {
      req.dialog_payload = evt.dialog_payload as Record<string, unknown>;
    }
    return req;
  }
  if (evt.event === "permission_resolved") {
    const decision = evt.decision === "allow" ? "allow" : "deny";
    return {
      session_id: String(evt.session_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      decision,
      ...(typeof evt.reason === "string" ? { reason: evt.reason } : {}),
      // 2026-09-09-askuser-pi-cursor task-11：透传实际答题人 user_id（backend
      // task-09 契约；群聊答题卡关闭态「×× 已回答」人名数据源）。事件缺省时
      // 不带键，消费方降级不带名。
      ...(typeof evt.answered_by_actual_user === "string"
        ? { answered_by_actual_user: evt.answered_by_actual_user }
        : {}),
    };
  }
  return null;
}

/* ---------- session SSE (streamSession) ---------- */

export type SessionEventKind =
  | "turn_started"
  | "log"
  | "turn_completed"
  | "session_status"
  | "session_ended"
  | "tokens"
  | "plan_mode_entered"
  | "bash_status"
  | "bash_chunk"
  | "agent_task_status"
  | "queue_changed";

/** Plan 模式摘要（plan_mode_entered 事件 payload）。 */
export interface PlanSummary {
  objective: string;
  tasks: string[];
  design_snippet?: string | null;
}

/** plan_mode_entered 事件：Agent 进入 plan 模式，需用户确认/修改/取消。 */
export interface PlanModeEnteredEvent {
  event: "plan_mode_entered";
  session_id: string;
  run_id: string;
  summary: PlanSummary;
  requested_at: string;
}

/** bash_status 事件：Bash 命令开始/结束/失败。 */
export interface BashStatusEvent {
  event: "bash_status";
  session_id: string;
  run_id: string;
  command: string;
  status: "running" | "completed" | "failed";
  exit_code: number | null;
  elapsed_ms: number | null;
}

/** bash_chunk 事件：Bash 命令实时 stdout/stderr 片段。 */
export interface BashChunkEvent {
  event: "bash_chunk";
  session_id: string;
  run_id: string;
  command: string;
  channel: "stdout" | "stderr";
  content: string;
  is_final: boolean;
}

/**
 * agent_task_status 事件：后台 Agent 任务（Task/Agent 工具派发的子代理）状态。
 * verify P1 返工（FR-03）：daemon 在 Task/Agent tool_use 时上报，前端渲染任务卡片。
 * 2026-08-27-background-subagent-progress task-10（FR-04，对齐 api-types 生成类型）：
 * status 增补 stopped 终态，透传异步子代理生命周期扩展字段
 * （tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async）。
 * 新字段均可选——旧 daemon 只发 running + task_id/task_name 载荷不受影响
 * （解析侧缺字段归一为 null）。
 */
export interface AgentTaskStatusEvent {
  event: "agent_task_status";
  session_id: string;
  run_id: string;
  task_id: string;
  task_name: string;
  status: "running" | "completed" | "failed" | "stopped";
  progress: number | null;
  message: string | null;
  /** FR-04：以下扩展字段全可选（旧 daemon 事件解析为 null）。 */
  tool_use_id?: string | null;
  summary?: string | null;
  last_tool_name?: string | null;
  elapsed_ms?: number | null;
  total_tokens?: number | null;
  tool_uses?: number | null;
  /** 后端 DTO 字段名 async_ + alias async，daemon 下发键名为 async。 */
  async?: boolean | null;
}

export interface SessionStreamEnvelope {
  event: SessionEventKind;
  session_id: string;
  run_id: string | null;
  turn: number | null;
  log_id: string | null;
  timestamp: string | null;
  channel: string | null;
  content: string | null;
  status: string | null;
  exit_code: number | null;
  reason: string | null;
  /**
   * task-05 / 2026-08-24-platform-session-feedback-fix：plan 模式进入事件携带的
   * 计划摘要与请求时间。
   */
  summary?: PlanSummary | null;
  requested_at?: string | null;
  /**
   * task-05：Bash 进度事件携带的命令行、运行时长。
   * status / channel / content / exit_code 已复用既有同名字段。
   */
  command?: string | null;
  elapsed_ms?: number | null;
  is_final?: boolean;
  /**
   * agent task 状态事件字段（task-05 引入；2026-08-27-background-subagent-progress
   * FR-04 task-10 已接线）：dispatch 经 parseAgentTaskStatusEvent 归一后交给
   * onAgentTaskStatus 回调消费。扩展字段（stopped 终态 / tool_use_id / summary /
   * last_tool_name / elapsed_ms / total_tokens / tool_uses / async）以
   * AgentTaskStatusEvent 接口为准，不在 envelope 重复声明。
   */
  task_id?: string | null;
  task_name?: string | null;
  progress?: number | null;
  message?: string | null;
  /**
   * ql-20260621：实时 / 终态 token。`tokens` 事件（执行中累积）与
   * `turn_completed` 事件（终态）都会带这两个字段；其它事件为 null。
   */
  input_tokens?: number | null;
  output_tokens?: number | null;
  /**
   * prompt cache 维度（Claude）：tokens / turn_completed 事件携带；
   * codex / OpenAI 系无缓存 → null。供徽标四维展示。
   */
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
  /**
   * 2026-08-27-session-token-usage-fix task-07 / FR-01：该 run 期间最近一次
   * API 调用的提示词大小（上下文环）。tokens / turn_completed 事件携带；
   * 仅 main 桶上报（子代理桶不下发）；旧 backend 不下发此字段时为 undefined，
   * 消费方（task-08 onTokens / 终态回填）按 undefined 保持环未知态。
   */
  ctx_tokens?: number | null;
  /**
   * 2026-08-03-session-stream-partial-revoke / FR-03 / design §5 Phase2 / §7.2：
   * 流式分片 segment_id。backend（task-01 透传 log_entry.segment_id）对 partial 半截
   * 行下发非空（形如 "main:<msg_id>" 或 "<tool_use_id>:<seq>"），对 complete/其他行
   * 下发 null。前端 onLog 据此识别「半截」并记录起点，收到对应 override 令箭时精确撤回。
   *
   * 可选（design §9 兼容策略）：未升级的旧 backend 不下发此字段，运行时为 undefined，
   * onLog 守卫 `env.segment_id` 非空才记 Map，undefined 空转不误撤回。
   */
  segment_id?: string | null;
  /**
   * 2026-08-03-session-stream-partial-revoke / design §7.3：override 撤回令箭行
   * （[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 前缀，task-02 publish-only 不落库）
   * 此字段为 true，标识该行是撤回信号而非正文日志。
   *
   * 可选：同 segment_id，旧 backend 缺此字段时 undefined，onLog 不依赖它（改由
   * classifySessionLog 识别 override 前缀 kind==="override" 触发撤回），stale 仅供
   * 日志/调试观测，避免与正文日志混淆。
   */
  stale?: boolean;
  /**
   * 2026-06-28-daemon-subagent-transcript task-09 / FR-08：归属三字段（backend run_sync
   * session channel publish 已透传，前端此前漏声明）。主 agent / 旧 backend →
   * null/undefined，消费方（session-log-assembler）按主 agent 平铺。
   */
  parent_tool_use_id?: string | null;
  subagent_type?: string | null;
  depth?: number | null;
  /**
   * 2026-07-05-agent-log-type-tags：工具种类标签
   * （与 lib/agent.ts AgentRunLogEntry.tool_kind 同语义）。
   */
  tool_kind?: string | null;
  /**
   * ql-20260824-020：Edit 工具结果 structuredPatch JSON 串（真实文件行号 hunks），
   * backend run_sync session channel publish 透传。仅 Edit tool_result 行有值，
   * 旧 backend / 其他工具 → null/undefined，Edit 展开区回退 LCS 自算。
   */
  edit_patch?: string | null;
  /**
   * 2026-08-31-session-queue-ux FR-03：queue_changed 事件载荷键 action——
   * enqueued / merged / dispatched / failed / deleted / reordered / edited /
   * dispatch_now，透传不解析（消费方按需读取，缺省为 null/undefined——旧
   * backend 不发该事件）。会话级事件，无 run_id。
   */
  action?: string | null;
}

/**
 * task-09 / design A6（2026-08-29-daemon-platform-resilience）：streamSession
 * 外露的连接状态。断线重连循环本就内建（对调用方只表现为事件暂停），本类型让
 * 调用方（session-panel 连接横幅）可观测：
 * - "reconnecting"：onerror → 进入退避重连（attempt = 即将进行的第 N 次尝试）；
 * - "reconnected"：resync 完成、SSE 连接重建（横幅「连接已恢复，正在同步…」）；
 * - "live"：重建后收到任一实时事件（恢复正常，无横幅）。
 */
export type SessionStreamStatus = "reconnecting" | "reconnected" | "live";

export interface SessionStreamHandlers {
  onTurnStarted(event: SessionStreamEnvelope): void;
  onLog(event: SessionStreamEnvelope, cursor: string | null): void;
  onTurnCompleted(event: SessionStreamEnvelope): void;
  onSessionEnded(event: SessionStreamEnvelope): void;
  onError(error: Error): void;
  /**
   * ql-20260621：backend 在每次 submit_messages 时往 session channel 推送的
   * `tokens` 事件（累积 input_tokens / output_tokens）。父组件据此实时更新
   * 当前 turn 的 token 显示，无需等 turn_completed 或轮询 DB。
   */
  onTokens?(event: SessionStreamEnvelope): void;
  /**
   * task-11 / ql-20260621：backend 通过同一 session SSE channel 推送的
   * permission_request 事件（Claude Code AskUserQuestion 远程人审 / 普通工具审批）。
   * 当 req.dialog_kind 存在时父组件应渲染 AskUserDialogCard（结构化问答），
   * 否则渲染普通 PermissionApprovalCard（allow/deny 二选一）。
   *
   * 仅监听本回调即可——不必再为 permission_request 建第二条 EventSource。
   */
  onPermissionRequest?(request: SessionPermissionRequest): void;
  /**
   * task-11 / ql-20260621：permission_resolved 事件——backend 确认请求已收口
   *（用户操作 manual 或 5min 超时 timeout）。父组件据此移除对应卡片。
   */
  onPermissionResolved?(resolved: SessionPermissionResolved): void;
  /**
   * task-05 / 2026-08-24-platform-session-feedback-fix：Agent 进入 plan 模式，
   * 父组件渲染 PlanApprovalCard 供用户 confirm / revise / cancel。
   */
  onPlanModeEntered?(event: PlanModeEnteredEvent): void;
  /**
   * task-05：Bash 命令状态变更（running / completed / failed）。
   */
  onBashStatus?(event: BashStatusEvent): void;
  /**
   * task-05：Bash 命令实时输出片段（stdout / stderr）。
   */
  onBashChunk?(event: BashChunkEvent): void;
  /**
   * verify P1 返工（FR-03）：后台 Agent 任务状态（running / completed / failed /
   * stopped）。父组件按 task_id 维护任务卡片列表；存在 running 任务时会话不显示
   * 「已完成」。
   * 2026-08-27-background-subagent-progress / FR-04（task-10）：携带异步子代理
   * 生命周期扩展字段 tool_use_id / summary / last_tool_name / elapsed_ms /
   * total_tokens / tool_uses / async（全可选，旧 daemon 事件为 null）。
   */
  onAgentTaskStatus?(event: AgentTaskStatusEvent): void;
  /**
   * task-09 / design A6（2026-08-29-daemon-platform-resilience）：连接状态回调
   * （可选，不传不影响既有退避 / resync 行为）。进入退避重连上报
   * "reconnecting"（attempt = 即将进行的第 N 次尝试，1 起）；resync 完成建连
   * 上报 "reconnected"；重建后收到任一实时事件转 "live"。首连（未断过线）不
   * 上报——调用方初始态即视为 live，不显示横幅。
   */
  onStatusChange?(status: SessionStreamStatus, attempt?: number): void;
  /**
   * 2026-08-31-session-queue-ux FR-03：queue_changed 事件（会话级，无 run_id）——
   * 服务端排队消息入队/合并/派发/失败/删除/重排/编辑/插队时推送，消费方
   * （use-message-queue）据此即时刷新队列（替代纯 5s 轮询；轮询保留兜底，
   * 双源并发由 use-message-queue 既有 epoch 丢弃兜底）。envelope.action 透传
   * 变更种类，透传不解析。可选回调——不传的既有调用方零影响。
   */
  onQueueChanged?(event: SessionStreamEnvelope): void;
}

export interface SessionStreamConnection {
  close(): void;
  getLastEventId(): string | null;
  /**
   * task-09 / design A6：立即对账一次——复用断线 resync 的 DB 缺口同步
   * （syncGapFromDb：运行中 run 合成 turn_started、终态 run 合成
   * turn_completed、增量回放日志），**不重建 SSE 连接**。运行轮看门狗 90s
   * 无事件时对账发现 run 已终态，经此走既有 resync 刷新路径收敛轮次（终态
   * 以 backend 数据为准，调用方不本地伪造）。对账失败静默（看门狗下一轮再兜）。
   *
   * 可选成员：既有调用方 / 测试桩不构造它也不受影响（看门狗按缺省跳过）。
   */
  resync?(): void;
}

/**
 * SSE 断线重连退避档位（ql-20260820-009）。原为 streamSession 内局部常量，
 * 2026-08-24-sessions-live-updates task-05 提升为模块级导出，供
 * subscribeAgentSessionsEvents 复用同一张档位表（不再各持一份）。
 */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * SSE 永久性 HTTP 错误停连名单（R7 / 2026-08-30 审计，对齐审批面板
 * ql-20260829-005 的同名常量语义）：命中即停本订阅重连循环——必败请求
 * 每 30s 重打无意义且刷日志。401/403/404 由 fetch-sse 的 onerror ev.status
 * 携带；网络断/流正常结束无 status，保持退避重连路径。
 */
export const PERMANENT_SSE_ERROR_STATUSES = new Set([401, 403, 404]);

// 内部 dev-time 校验（不暴露给业务层，避免与 backend DTO 双重维护）。
export const AgentSessionListResponseSchema = z.object({
  items: z.array(z.object({}).passthrough()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
