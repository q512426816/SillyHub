/**
 * Daemon API client —— 会话消息队列域（排队消息六函数 + 条目类型）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";

/** ql-20260825-011：服务端排队消息条目（GET /sessions/{id}/queue）。 */
export interface SessionQueueEntry {
  id: string;
  prompt: string;
  attachment_ids?: string[];
  agent_profile_id?: string | null;
  llm_provider_id?: string | null;
  status: string;
  error_msg?: string | null;
  /**
   * 2026-08-31-session-queue-ux D-002：队列序键（与派发序同源，backend 按
   * ORDER BY position, created_at 回派发序）。task-04 起后端必回填；声明可选——
   * use-message-queue 测试的 entry() 工厂（task-10 范围）尚未带该字段，必填会
   * 令本卡 tsc 红，task-10 mock 适配时补齐。前端渲染以服务端返回序为准，
   * 不依赖该字段本地重排。
   */
  position?: number;
  /** 2026-09-12-chat-turn-auto-recovery：auto_resume:<源 run uuid> = 系统自动恢复入队；null/缺省 = 用户排队（旧后端兼容）。 */
  origin?: string | null;
  created_at: string;
}

/** ql-20260825-011：列出会话排队消息（created_at 升序 = 派发顺序）。 */
export async function fetchSessionQueue(sessionId: string): Promise<SessionQueueEntry[]> {
  const resp = await apiFetch<{ items: SessionQueueEntry[] }>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue`,
  );
  return resp.items ?? [];
}

/** ql-20260825-011：删除一条排队消息（队列条上的 ×）。 */
export async function deleteSessionQueueEntry(
  sessionId: string,
  entryId: string,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
}

/** ql-20260825-011：failed 条目重试（翻 pending 并立即尝试派发，忙则留队）。 */
export async function retrySessionQueueEntry(
  sessionId: string,
  entryId: string,
): Promise<SessionQueueEntry> {
  return apiFetch<SessionQueueEntry>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}/retry`,
    { method: "POST" },
  );
}

/**
 * 2026-08-31-session-queue-ux D-001：dispatch-now 响应体。
 * interrupted = true 表示插队派发时打断了当时运行中的轮。
 */
export interface QueueDispatchNowResponse {
  interrupted: boolean;
}

/**
 * 2026-08-31-session-queue-ux FR-04 / D-003：队列拖拽重排——entryIds 全量有序
 * （backend 按上传序重写 position 0..n-1）。PATCH /queue/reorder，204 无响应体；
 * 上传集合与现存待派发条目不一致时 422 QUEUE_ORDER_MISMATCH（调用方捕获后
 * 重拉 fetchSessionQueue 对齐服务端序）。写法对齐 retrySessionQueueEntry。
 */
export async function reorderSessionQueue(
  sessionId: string,
  entryIds: string[],
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/reorder`,
    { method: "PATCH", json: { entry_ids: entryIds } },
  );
}

/**
 * 2026-08-31-session-queue-ux FR-06：编辑排队消息 prompt（1..8000 字——空/超长
 * 422；TASK_WAKEUP 派发中条目 409）。响应体为 { entry } 包裹键（区别于 retry
 * 端点的裸 DTO），返回更新后条目（含回填 position）。
 */
export async function updateSessionQueueEntry(
  sessionId: string,
  entryId: string,
  prompt: string,
): Promise<SessionQueueEntry> {
  const resp = await apiFetch<{ entry: SessionQueueEntry }>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}`,
    { method: "PATCH", json: { prompt } },
  );
  return resp.entry;
}

/**
 * 2026-08-31-session-queue-ux FR-05 / D-001：插队立即派发——条目跳过队列直接
 * 起轮（会话非 active 409；条目不存在 404）。interrupted = true 表示打断了
 * 当时运行中的轮（前端据此提示）。
 */
export async function dispatchNowSessionQueueEntry(
  sessionId: string,
  entryId: string,
): Promise<QueueDispatchNowResponse> {
  return apiFetch<QueueDispatchNowResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}/dispatch-now`,
    { method: "POST" },
  );
}
