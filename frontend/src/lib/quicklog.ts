import { apiFetch } from "./api";
import type { components } from "./api-types";

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

// ── 轮询策略纯函数（FR-05：存在 in_progress|stale → 30s，全终态停轮）────

export function quicklogPollInterval(items: QuicklogEntryListItem[]): number | false {
  const active = items.some(
    (it) => it.status === "in_progress" || it.status === "stale",
  );
  return active ? 30_000 : false;
}
