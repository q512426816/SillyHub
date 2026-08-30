import { apiFetch } from "./api";
import type { components } from "./api-types";
import type { ChangeUsageRead } from "./changes";

// ── Types（gen:types 生成，backend change/schema.py quicklog DTOs）────

export type QuicklogEntryListItem = components["schemas"]["QuicklogEntryListItem"];
export type QuicklogEntryList = components["schemas"]["QuicklogEntryList"];
export type QuicklogEntryRead = components["schemas"]["QuicklogEntryRead"];
export type QuicklogFileItem = components["schemas"]["QuicklogFileItem"];

// 派生后 4 态（D-007）：completed | in_progress | partial_done | stale
export type QuicklogStatus = "completed" | "in_progress" | "partial_done" | "stale";

export type QuicklogListParams = {
  search?: string;
  status?: QuicklogStatus;
  author?: string;
  linked_change?: string;
  include_placeholder?: boolean;
  page?: number;
  page_size?: number;
};

// ── API 封装（FR-04 / FR-06）──────────────────────────────────────────

export function listQuicklogEntries(workspaceId: string, params: QuicklogListParams = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  if (params.status) search.set("status", params.status);
  if (params.author) search.set("author", params.author);
  if (params.linked_change) search.set("linked_change", params.linked_change);
  if (params.include_placeholder) search.set("include_placeholder", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<QuicklogEntryList>(
    `/api/workspaces/${workspaceId}/quicklog-entries${qs ? `?${qs}` : ""}`,
  );
}

export function getQuicklogDetail(workspaceId: string, qlId: string) {
  return apiFetch<QuicklogEntryRead>(
    `/api/workspaces/${workspaceId}/quicklog-entries/${encodeURIComponent(qlId)}`,
  );
}

/**
 * 快速修复条目执行用量 — GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/usage
 *
 * 响应为 ChangeUsageRead（两个 usage 详情端点共用，类型取自 lib/changes）。
 * 404 严格对齐 getQuicklogDetail：条目不存在（双源均未命中）→ 404；
 * 存在但无会话绑定/无用量 → 200 全零 totals + 空 by_model + 三元组 None
 * （前端按边界态降级），软删会话照常计入（D-006@v1 口径）。
 */
export function getQuicklogUsage(
  workspaceId: string,
  qlId: string,
): Promise<ChangeUsageRead> {
  return apiFetch<ChangeUsageRead>(
    `/api/workspaces/${workspaceId}/quicklog-entries/${encodeURIComponent(qlId)}/usage`,
  );
}

// ── 轮询策略纯函数（FR-05：存在 in_progress|stale → 30s，全终态停轮）────

export function quicklogPollInterval(items: QuicklogEntryListItem[]): number | false {
  const active = items.some(
    (it) => it.status === "in_progress" || it.status === "stale",
  );
  return active ? 30_000 : false;
}
