/**
 * 工作区 Git 日志（git-log）— 前端取数入口（只读端点）。
 *
 * - ``fetchGitLogCommits`` / ``fetchGitLogCommitDetail`` / ``fetchGitLogDiff``：
 *   走 ``apiFetch``（相对路径经 Next.js rewrite proxy，自带 401 单飞刷新），
 *   query 参数由 apiFetch 统一编码（``undefined``/``null``/空串自动省略不传）。
 * - 列表端点带 ``skip``/``limit``/``branch``/``author`` query（branch/author 空 =
 *   不过滤，由 apiFetch 省略空参实现）；详情/diff 按 ``sha`` 路径段、diff 另带
 *   ``path`` query；``sha``/``path`` 均 ``encodeURIComponent``。
 * - TanStack Query hook：列表随 ``workspaceId`` 就绪即拉；详情/diff 按需触发
 *   （``enabled`` 由组件层随选中/文件树展开态传入，对齐 ``useExplorerFile`` 形态）。
 * - queryKey 含 skip/limit/branch/author 与 sha/path 维度——分页或过滤条件变更
 *   天然换 key 失效缓存。
 * - ``fetchGitLogStatus`` / ``useGitLogStatus``（2026-08-26-workspace-git-status
 *   task-03 增量）：第四端点 status 的取数与 hook——staleTime 60s 显式覆盖全局
 *   15s（每次请求含 daemon 侧远程 git fetch，两页共享缓存单次远程同步），
 *   queryKey 追加 ``"status"`` 维度。
 *
 * 类型一律引用 ``@/lib/api-types`` 生成 schema（pnpm gen:types 产出），禁止手写。
 * 依据：design.md §7.1 / §7.4 + tasks/task-05.md；
 *       status 增量 design.md（2026-08-26-workspace-git-status）§5.4。
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type GitLogCommitsResponse = components["schemas"]["GitLogCommitsResponse"];
export type GitLogCommitItem = components["schemas"]["GitLogCommitItem"];
export type GitLogEdgeItem = components["schemas"]["GitLogEdgeItem"];
export type GitLogRefItem = components["schemas"]["GitLogRefItem"];
export type GitLogBranchItem = components["schemas"]["GitLogBranchItem"];
export type GitLogCommitDetailResponse =
  components["schemas"]["GitLogCommitDetailResponse"];
export type GitLogFileStatItem = components["schemas"]["GitLogFileStatItem"];
export type GitLogDiffResponse = components["schemas"]["GitLogDiffResponse"];
// status 系三类型（2026-08-26-workspace-git-status task-03）：同样零手写，
// 全部经 components.schemas 引用。
export type GitLogStatusResponse =
  components["schemas"]["GitLogStatusResponse"];
export type GitLogDirtyItem = components["schemas"]["GitLogDirtyItem"];
export type GitLogFetchItem = components["schemas"]["GitLogFetchItem"];

/** git-log 查询 key（本文件内定义，供 hook 与组件层失效/复用缓存）。 */
export const gitLogQueryKeys = {
  commits: (
    workspaceId: string,
    skip: number,
    limit: number,
    branch: string,
    author: string,
  ) => ["git-log", workspaceId, "commits", skip, limit, branch, author] as const,
  detail: (workspaceId: string, sha: string) =>
    ["git-log", workspaceId, "detail", sha] as const,
  diff: (workspaceId: string, sha: string, path: string) =>
    ["git-log", workspaceId, "diff", sha, path] as const,
  // status（task-03）：workspaceId 维度下的轻状态——git-log 页刷新按钮
  // invalidate 的 ["git-log", wid] 前缀天然覆盖本 key（commits 前缀兼容不变）。
  status: (workspaceId: string) => ["git-log", workspaceId, "status"] as const,
};

// ── fetch 封装 ────────────────────────────────────────────────────────

/**
 * 提交列表 + 泳道（GET /api/workspaces/{wid}/git-log/commits）。
 * ``branch``/``author`` 为空即不过滤（空参不传，由 apiFetch 省略）；
 * ``skip``/``limit`` 为全局绝对序分页窗口。
 */
export function fetchGitLogCommits(
  workspaceId: string,
  skip = 0,
  limit = 100,
  branch = "",
  author = "",
): Promise<GitLogCommitsResponse> {
  return apiFetch<GitLogCommitsResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/git-log/commits`,
    // branch/author 空串由 apiFetch 统一省略（空 = 全部分支 / 不过滤作者）。
    { query: { skip, limit, branch, author } },
  );
}

/**
 * 提交详情 + 变更文件列表（GET /api/workspaces/{wid}/git-log/commits/{sha}）。
 * ``sha`` 为全长或短哈希（后端白名单校验），``encodeURIComponent`` 编码。
 */
export function fetchGitLogCommitDetail(
  workspaceId: string,
  sha: string,
): Promise<GitLogCommitDetailResponse> {
  return apiFetch<GitLogCommitDetailResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/git-log/commits/${encodeURIComponent(sha)}`,
  );
}

/**
 * 单文件 unified diff（GET /api/workspaces/{wid}/git-log/commits/{sha}/diff）。
 * ``path`` 为仓库内文件相对路径（必填）；超 64KB 截断（``truncated``）、二进制
 * 文件 ``diff`` 为空串且 ``binary=true``。
 */
export function fetchGitLogDiff(
  workspaceId: string,
  sha: string,
  path: string,
): Promise<GitLogDiffResponse> {
  return apiFetch<GitLogDiffResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/git-log/commits/${encodeURIComponent(sha)}/diff`,
    { query: { path } },
  );
}

/**
 * 工作区 Git 健康状态（GET /api/workspaces/{wid}/git-log/status，
 * 2026-08-26-workspace-git-status task-03）：分支/未推送↑/远程新提交↓/
 * 未提交改动 ±/未跟踪计数/自动 fetch 结果。status 端点经 daemon 侧
 * ``git fetch``（15s 超时降级），非 git 工作区返回 ``git_mode="no_git"`` 空态。
 */
export function fetchGitLogStatus(
  workspaceId: string,
): Promise<GitLogStatusResponse> {
  return apiFetch<GitLogStatusResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/git-log/status`,
  );
}

// ── TanStack Query hook（enabled 按需触发）────────────────────────────

/** ``useGitLogCommits`` 列表查询参数（分页窗口 + 过滤，全量入 queryKey）。 */
export interface GitLogCommitsQueryOptions {
  skip?: number;
  limit?: number;
  branch?: string;
  author?: string;
}

/**
 * 提交列表查询——工作区就绪即拉（``workspaceId`` 非空才 enabled）。
 * skip/limit/branch/author 任一变更即换 key 重新请求，结果按 key 进缓存。
 */
export function useGitLogCommits(
  workspaceId: string,
  options: GitLogCommitsQueryOptions = {},
) {
  const { skip = 0, limit = 100, branch = "", author = "" } = options;
  return useQuery<GitLogCommitsResponse, ApiError>({
    queryKey: gitLogQueryKeys.commits(workspaceId, skip, limit, branch, author),
    queryFn: () => fetchGitLogCommits(workspaceId, skip, limit, branch, author),
    enabled: workspaceId !== "",
  });
}

/**
 * 提交详情查询——点击行选中才拉（``enabled`` 由组件层随选中态传入，
 * ``sha`` 非空才发起，对齐 ``useExplorerFile`` 形态）。
 */
export function useGitLogCommitDetail(
  workspaceId: string,
  sha: string,
  enabled = true,
) {
  return useQuery<GitLogCommitDetailResponse, ApiError>({
    queryKey: gitLogQueryKeys.detail(workspaceId, sha),
    queryFn: () => fetchGitLogCommitDetail(workspaceId, sha),
    enabled: enabled && workspaceId !== "" && sha !== "",
  });
}

/**
 * 单文件 diff 查询——文件树叶子展开才拉（``enabled`` 由组件层随展开态传入）。
 * 同一 (workspaceId, sha, path) 的结果进缓存，重复折叠/展开不重复请求。
 */
export function useGitLogDiff(
  workspaceId: string,
  sha: string,
  path: string,
  enabled = true,
) {
  return useQuery<GitLogDiffResponse, ApiError>({
    queryKey: gitLogQueryKeys.diff(workspaceId, sha, path),
    queryFn: () => fetchGitLogDiff(workspaceId, sha, path),
    enabled: enabled && workspaceId !== "" && sha !== "" && path !== "",
  });
}

/**
 * 工作区 Git 状态查询——git-log 页与 sessions 门户共享缓存（D-003）。
 *
 * - ``staleTime`` 60s **显式覆盖**全局 15s（query-client.ts）：status 端点
 *   每次请求都会触发 daemon 侧 ``git fetch``（网络同步），两页 60s 内共享
 *   一次结果只 fetch 一次远程；``refetchOnWindowFocus`` 沿用全局——超 60s
 *   后窗口聚焦再取一次（含远程 fetch）属预期（design §5.4 / Grill CC-09）；
 * - 不设 ``refetchInterval``（design §3 非目标：无自动轮询，新鲜度由
 *   staleTime + git-log 页刷新按钮 ``["git-log", wid]`` 前缀 invalidate 控制）。
 */
export function useGitLogStatus(workspaceId: string) {
  return useQuery<GitLogStatusResponse, ApiError>({
    queryKey: gitLogQueryKeys.status(workspaceId),
    queryFn: () => fetchGitLogStatus(workspaceId),
    enabled: workspaceId !== "",
    staleTime: 60_000,
  });
}
