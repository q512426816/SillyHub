/**
 * useDaemonRuntimes — daemon runtime 列表 + 会话组合查询（D-005@v1 / FR-05）。
 *
 * 封装 runtimes/page.tsx 原 reload 的数据获取：Promise.all 并发 listDaemonRuntimesPage
 * + listAgentSessions（sessions 失败 .catch(null) 降级，对齐 page.tsx:940）。
 * params 进 queryKey，过滤/分页变化即新查询（react-query 自动停旧启新 R-02）。
 * 15s 无条件轮询（对齐 page.tsx:1106）。lastRefreshedAt/showFeedback 等 UX 态归页面管。
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  type AgentSessionRead, type DaemonRuntimeListParams,
  type DaemonRuntimeRead, listAgentSessions, listDaemonRuntimesPage,
} from "@/lib/daemon";
import { queryKeys } from "./query-keys";

interface DaemonRuntimesData {
  items: DaemonRuntimeRead[];
  total: number;
  sessions: AgentSessionRead[];
}

export function useDaemonRuntimes(params: DaemonRuntimeListParams) {
  const q = useQuery<DaemonRuntimesData, ApiError>({
    queryKey: queryKeys.daemonRuntimes.list(params),
    queryFn: async () => {
      const [resp, sessionsResp] = await Promise.all([
        listDaemonRuntimesPage(params),
        listAgentSessions({ limit: 100 }).catch(() => null),
      ]);
      return {
        items: resp.items,
        total: resp.total,
        sessions: sessionsResp?.items ?? [],
      };
    },
    refetchInterval: 15000,
  });
  return {
    items: q.data?.items ?? [],
    total: q.data?.total ?? 0,
    sessions: q.data?.sessions ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
