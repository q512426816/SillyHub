/**
 * 工作区文件浏览器（explorer）— 前端取数入口（只读四端点）。
 *
 * - ``fetchTree`` / ``fetchFile`` / ``fetchSearch``：走 ``apiFetch``（相对路径经
 *   Next.js rewrite proxy，自带 401 单飞刷新），query 参数由 apiFetch 统一编码。
 * - ``fetchDownload``：下载端点回二进制流，``apiFetch`` 只解析 JSON 不适合，
 *   照 ``lib/file/api.ts`` 的 ``fetchFileBlob`` 先例走裸 fetch + Bearer 头取
 *   ``Blob``，401 单飞刷新重试一次，失败抛 ``ApiError``；浏览器下载触发用
 *   ``<a download>`` + objectURL + revoke（JWT 鉴权裸 URL 会 401，design R-06）。
 * - TanStack Query hook：``enabled`` 按需触发（节点展开才拉树、选中文件才拉
 *   预览、搜索词非空才搜），query key 本文件内定义。
 *
 * 类型一律引用 ``@/lib/api-types`` 生成 schema（pnpm gen:types 产出），禁止手写。
 * 依据：design.md §7.2 / §7.3 + tasks/task-05.md。
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch, safeUUID } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

export type ExplorerEntry = components["schemas"]["ExplorerEntry"];
export type ExplorerTreeResponse = components["schemas"]["ExplorerTreeResponse"];
export type ExplorerFileResponse = components["schemas"]["ExplorerFileResponse"];
export type ExplorerSearchMatch = components["schemas"]["ExplorerSearchMatch"];
export type ExplorerSearchResponse = components["schemas"]["ExplorerSearchResponse"];

/** explorer 查询 key（本文件内定义，供 hook 与组件层失效/复用缓存）。 */
export const explorerQueryKeys = {
  tree: (workspaceId: string, path: string) =>
    ["explorer", workspaceId, "tree", path] as const,
  file: (workspaceId: string, path: string) =>
    ["explorer", workspaceId, "file", path] as const,
  search: (workspaceId: string, q: string) =>
    ["explorer", workspaceId, "search", q] as const,
};

// ── fetch 封装 ────────────────────────────────────────────────────────

/**
 * 列目录（GET /api/workspaces/{wid}/explorer/tree）。
 * ``path`` 相对工作区根，空串 = 根目录（懒加载逐层展开时每层调一次）。
 */
export function fetchTree(workspaceId: string, path = ""): Promise<ExplorerTreeResponse> {
  return apiFetch<ExplorerTreeResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/explorer/tree`,
    { query: { path } },
  );
}

/**
 * 读文件预览（GET /api/workspaces/{wid}/explorer/file，encoding=utf8）。
 * ``binary=true`` 时 content 为 base64 兜底；``truncated=true`` 表示超 10MB 截断。
 */
export function fetchFile(workspaceId: string, path: string): Promise<ExplorerFileResponse> {
  return apiFetch<ExplorerFileResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/explorer/file`,
    { query: { path } },
  );
}

/**
 * 取文件二进制（GET /api/workspaces/{wid}/explorer/download）——裸 fetch 带
 * Bearer 头取 ``Blob``，401 单飞刷新重试一次（``fetchFileBlob`` 先例）。
 * 调用方转 objectURL 供预览/下载（不拼裸 URL 直连，JWT 鉴权会 401）。
 */
export async function fetchDownload(workspaceId: string, path: string): Promise<Blob> {
  const url =
    `/api/workspaces/${encodeURIComponent(workspaceId)}/explorer/download` +
    `?path=${encodeURIComponent(path)}`;
  const doFetch = (token: string | null) =>
    fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  let token = useSession.getState().accessToken ?? null;
  let resp = await doFetch(token);
  if (resp.status === 401) {
    // 单飞刷新（并发 401 由 token-refresh 模块级 inflight 保证只发一次）。
    const fresh = await ensureFreshAccessToken();
    if (fresh) {
      token = fresh;
      resp = await doFetch(token);
    }
  }
  if (!resp.ok) {
    throw new ApiError(resp.status, {
      code: "download_failed",
      message: `下载失败（HTTP ${resp.status}）`,
      request_id: safeUUID(),
      details: null,
    });
  }
  return resp.blob();
}

/** 触发浏览器下载（fetch Blob → ``<a download>`` click → revoke）。 */
export async function downloadExplorerFile(
  workspaceId: string,
  path: string,
  filename?: string,
): Promise<void> {
  const blob = await fetchDownload(workspaceId, path);
  const name =
    filename ?? path.split(/[\\/]/).filter(Boolean).pop() ?? "file";
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * 按文件名全树搜索（GET /api/workspaces/{wid}/explorer/search）。
 * ``q`` 关键词（大小写不敏感子串），命中项 ``path`` 相对工作区根。
 */
export function fetchSearch(workspaceId: string, q: string): Promise<ExplorerSearchResponse> {
  return apiFetch<ExplorerSearchResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/explorer/search`,
    { query: { q } },
  );
}

// ── TanStack Query hook（enabled 按需触发）────────────────────────────

/**
 * 目录查询——节点展开才拉（``enabled`` 由组件层随 Tree loadData 传入）。
 * 同一 (workspaceId, path) 的结果进缓存，重复展开同一层不重复请求。
 */
export function useExplorerTree(workspaceId: string, path: string, enabled = true) {
  return useQuery<ExplorerTreeResponse, ApiError>({
    queryKey: explorerQueryKeys.tree(workspaceId, path),
    queryFn: () => fetchTree(workspaceId, path),
    enabled: enabled && workspaceId !== "",
  });
}

/**
 * 文件预览查询——选中文件才拉（``path`` 为 null/空即不发起）。
 */
export function useExplorerFile(workspaceId: string, path: string | null) {
  return useQuery<ExplorerFileResponse, ApiError>({
    queryKey: explorerQueryKeys.file(workspaceId, path ?? ""),
    queryFn: () => fetchFile(workspaceId, path as string),
    enabled: workspaceId !== "" && path != null && path !== "",
  });
}

/**
 * 搜索查询——搜索词非空才搜（去空白后为空即不发起）。
 */
export function useExplorerSearch(workspaceId: string, q: string) {
  const kw = q.trim();
  return useQuery<ExplorerSearchResponse, ApiError>({
    queryKey: explorerQueryKeys.search(workspaceId, kw),
    queryFn: () => fetchSearch(workspaceId, kw),
    enabled: workspaceId !== "" && kw !== "",
  });
}
