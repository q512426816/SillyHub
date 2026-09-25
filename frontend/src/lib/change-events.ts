import { apiFetch } from "./api";

// ── Types（对齐 backend platform_sync schema.py 事件 DTO，snake_case 原样）──

/** GET /api/changes/{name}/events 单条事件（task-02 ChangeEventItem）。 */
export interface ChangeEventItem {
  id: string;
  kind: string;
  rule: string;
  severity: string;
  provisional: boolean;
  detail: string | null;
  ts: string;
}

/** GET /api/changes/{name}/events 200 响应（ts 正序；since 严格大于增量）。 */
export interface ChangeEventListResponse {
  change_name: string;
  count: number;
  items: ChangeEventItem[];
}

// ── API 封装（2026-09-26-change-events-r18-full task-03 / FR-07）────────

/**
 * 拉取变更旁路观测事件（只读；红线 D-004：调用方只展示不消费）。
 *
 * 路径 /api/changes/{name}/events（platform_sync router 无 prefix、main 挂 /api）；
 * 鉴权走 apiFetch 默认 Authorization（浏览器 JWT 会话 → GET 读 scope 通道）。
 * since 可选增量游标（ts 严格大于）；缺省回最新 200 条（后端反转正序）。
 */
export function listChangeEvents(
  changeKey: string,
  since?: string,
): Promise<ChangeEventListResponse> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiFetch<ChangeEventListResponse>(
    `/api/changes/${encodeURIComponent(changeKey)}/events${qs}`,
  );
}
