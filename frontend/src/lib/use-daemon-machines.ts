/**
 * useDaemonMachines — daemon 机器列表 + 会话组合查询（机器级，覆盖 FR-4,6）。
 *
 * 机器级数据 hook，对齐 useDaemonRuntimes 结构：Promise.all 并发 listDaemonMachines
 * + listAgentSessions（sessions 失败 .catch(null) 降级为 []，不阻塞列表渲染）。
 * params 进 queryKey，过滤/分页变化即新查询（react-query 自动停旧启新 R-02）。
 * 15s 无条件轮询。用量（用量统计）不走本 hook，由 page 单独调
 * getRuntimesUsage(window) 管理（D-004，不内联 /machines）。
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  type AgentSessionRead, type DaemonMachineListParams,
  type DaemonMachineRead, listAgentSessions, listDaemonMachines,
} from "@/lib/daemon";
import { queryKeys } from "./query-keys";

interface DaemonMachinesData {
  items: DaemonMachineRead[];
  total: number;
  sessions: AgentSessionRead[];
}

export function useDaemonMachines(params: DaemonMachineListParams) {
  const q = useQuery<DaemonMachinesData, ApiError>({
    queryKey: queryKeys.daemonMachines.list(params),
    queryFn: async () => {
      const [resp, sessionsResp] = await Promise.all([
        listDaemonMachines(params),
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
