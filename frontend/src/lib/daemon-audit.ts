/**
 * Daemon filesystem-policy 审计查询 API client（task-19 / D-006@v1）。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-02-daemon-filesystem-policy/tasks/task-19.md
 *     (frontend lib/daemon-audit.ts API client)
 *   - design.md §7.3(GET policy-audit 端点)+ §7.4(AuditLogRead 字段)
 *   - backend/app/modules/daemon/audit/schema.py(AuditLogRead / AuditPageResponse)
 *   - backend/app/modules/daemon/audit/router.py(实际 Query 参数名)
 *
 * ⚠️ 关键偏差(task-10 已记录):
 *   实际 GET 路径含 /daemon 段 ——
 *   GET /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit
 *   design §7.3 原写 /api/workspaces/...,但 audit router include 在 daemon
 *   router 下,继承 /daemon prefix(allowed_paths 禁止改 main.py 挂到根)。
 *   前端必须用 /daemon 前缀路径,否则 404。
 *
 * 参数命名对齐后端实际 Query(非 design 文案的 startTime/endTime/page/pageSize):
 *   - since / until(ISO 8601 时间范围)
 *   - limit / offset(分页,默认 limit=50 / offset=0)
 *   返回分页字段为 total/limit/offset(无 page/pageSize)。
 *
 * fetch 封装风格对齐现有 lib/daemon.ts(走 @/lib/api 的 apiFetch,query 选项
 * 由 apiFetch 拼到 URL;错误由 apiFetch 归一化抛 ApiError)。
 */
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";

/** 审计决策(D-006@v1):ALLOW=放行 / DENY=拒绝(命中策略违规)。 */
export type AuditDecision = "ALLOW" | "DENY";

/**
 * 单条审计日志读模型,对齐 backend AuditLogRead(design §7.4)。
 * 字段全部来自 daemon 写策略拦截时的 AuditEvent(design §5.1.5)。
 */
export interface AuditLogRead {
  id: string;
  runtime_id: string;
  /** workspace 可空:daemon 上报时若未关联 workspace 则为 null(best-effort 解析)。 */
  workspace_id: string | null;
  decision: string; // AuditDecision 字面量,后端按 str 存,放宽以兼容未来扩展
  provider: string;
  tool: string;
  path: string;
  /** deny 原因 / 备注;ALLOW 时通常为 ""。 */
  reason: string;
  /** ISO 8601,后端 created_at(入库时间),按 created_at DESC 排序。 */
  created_at: string;
}

/**
 * 审计查询分页响应,对齐 backend AuditPageResponse。
 * 注意:后端用 limit/offset 分页(非 page/pageSize)。
 */
export interface AuditPageResponse {
  items: AuditLogRead[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * fetchPolicyAudit 的筛选 + 分页参数。
 *
 * 字段名严格对齐 backend Query(router.py):decision/provider/tool/path/since
 * /until/limit/offset。decision 字面量类型收敛为 AuditDecision。
 */
export interface FetchPolicyAuditParams {
  decision?: AuditDecision;
  provider?: string;
  tool?: string;
  /** 子串匹配(backend path_contains)。 */
  path?: string;
  /** 时间范围下界(ISO 8601)。 */
  since?: string;
  /** 时间范围上界(ISO 8601)。 */
  until?: string;
  /** 分页大小,backend 默认 50,范围 [1, 200]。 */
  limit?: number;
  /** 分页偏移,backend 默认 0,范围 >= 0。 */
  offset?: number;
}

/**
 * GET /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit
 *
 * 拉取指定 workspace + runtime 下的策略审计日志(分页 + 筛选)。
 * 结果按 created_at DESC。需 RUNTIME_ADMIN 权限(backend 网关)。
 *
 * @param workspaceId workspace 标识(UUID 或可编码字符串)
 * @param runtimeId  runtime 标识(UUID 或可编码字符串)
 * @param params     筛选 + 分页参数(全部可选)
 * @throws ApiError 401 未登录 / 403 无权限 / 422 参数非法 / 5xx 后端故障
 */
export async function fetchPolicyAudit(
  workspaceId: string | number,
  runtimeId: string,
  params: FetchPolicyAuditParams,
): Promise<AuditPageResponse> {
  return apiFetch<AuditPageResponse>(
    `/api/daemon/workspaces/${encodeURIComponent(workspaceId)}/runtimes/${encodeURIComponent(runtimeId)}/policy-audit`,
    {
      // apiFetch 内部已忽略 undefined / null / "" 的 query 项
      query: params as Record<string, string | number | undefined>,
    },
  );
}

/**
 * GET /api/daemon/runtimes/{runtime_id}/policy-audit
 *
 * ql-20260703-003：免 workspace_id 的审计查询（后端 ql-003 新增路由）。
 * 适用于前端审计页可能无 workspace_id 上下文（task-21 入口 /runtimes/{id}/audit）。
 * 返回指定 runtime 的所有审计记录（不限 workspace，service.query(workspace_id=None)）。
 */
export async function fetchPolicyAuditByRuntime(
  runtimeId: string,
  params: FetchPolicyAuditParams,
): Promise<AuditPageResponse> {
  return apiFetch<AuditPageResponse>(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}/policy-audit`,
    { query: params as Record<string, string | number | undefined> },
  );
}

function auditByRuntimeQueryKey(runtimeId: string, params: FetchPolicyAuditParams) {
  return ["daemonAuditByRuntime", runtimeId, params] as const;
}

export function usePolicyAuditByRuntime(
  runtimeId: string | null | undefined,
  params: FetchPolicyAuditParams = {},
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const enabled = options?.enabled ?? !!runtimeId;
  const q = useQuery<AuditPageResponse, ApiError>({
    queryKey: auditByRuntimeQueryKey(runtimeId ?? "", params),
    queryFn: () => fetchPolicyAuditByRuntime(runtimeId!, params),
    enabled,
    refetchInterval: options?.refetchInterval,
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return { items, total, isLoading: q.isLoading, isError: q.isError, error: q.error, refetch: q.refetch };
}


// ── TanStack Query hook ──────────────────────────────────────────────────────
//
// queryKey 内联在本模块(query-keys.ts 不在本任务 allowed_paths 内)。
// params 进 key:筛选/分页变化即新查询(react-query 自动停旧启新)。
// 风格对齐 lib/use-daemon-runtimes.ts(useQuery + ApiError 类型 + 暴露常用态)。

/** 本模块内联 queryKey(workspaceId + runtimeId + params 全进 key)。 */
function auditQueryKey(
  workspaceId: string | number,
  runtimeId: string,
  params: FetchPolicyAuditParams,
) {
  return ["daemonAudit", "page", String(workspaceId), runtimeId, params] as const;
}

/**
 * usePolicyAudit — 审计日志分页查询 hook(D-006@v1)。
 *
 * 默认不轮询(审计是回看场景,非实时);调用方需要刷新用 refetch 或自行加 refetchInterval。
 *
 * @returns 与 use-daemon-runtimes 同构的扁平返回(items/total/isXxx/error/refetch)
 */
export function usePolicyAudit(
  workspaceId: string | number | null | undefined,
  runtimeId: string | null | undefined,
  params: FetchPolicyAuditParams = {},
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const enabled =
    options?.enabled ??
    (workspaceId !== null && workspaceId !== undefined && !!runtimeId);

  const q = useQuery<AuditPageResponse, ApiError>({
    queryKey: auditQueryKey(
      workspaceId ?? "",
      runtimeId ?? "",
      params,
    ),
    queryFn: () =>
      fetchPolicyAudit(workspaceId as string | number, runtimeId as string, params),
    enabled,
    refetchInterval: options?.refetchInterval,
  });

  return {
    items: q.data?.items ?? [],
    total: q.data?.total ?? 0,
    limit: q.data?.limit ?? 0,
    offset: q.data?.offset ?? 0,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
