/**
 * useAgentRuns — Agent 运行记录查询（D-003@v1 / FR-04）。
 *
 * 封装 listAgentRuns，5s 条件轮询：仅当 data 含 status==="running" 的 run 时
 * 才轮询（对齐 agent/page.tsx:313-317 原行为；runningRuns 过滤亦只认 running，
 * 见 agent/page.tsx:255）。queryFn 直接复用 lib/agent，鉴权/ApiError 天然衔接。
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { type AgentRun, listAgentRuns } from "@/lib/agent";
import { queryKeys } from "./query-keys";

/**
 * refetchInterval 谓词（纯函数，便于单测）：仅当 data 含 status==="running"
 * 的 run 时返回 5000，否则 false（停止轮询）。对齐 agent/page.tsx:255 runningRuns
 * 只认 running 的过滤；undefined/空 → 不轮询（R-06 首渲未加载不轮询）。
 */
export function agentRunsRefetchInterval(
  runs: AgentRun[] | undefined,
): number | false {
  return runs?.some((r) => r.status === "running") ? 5000 : false;
}

export function useAgentRuns(workspaceId: string) {
  const q = useQuery<AgentRun[], ApiError>({
    queryKey: queryKeys.agentRuns.list(workspaceId),
    queryFn: () => listAgentRuns(workspaceId),
    refetchInterval: (query) => agentRunsRefetchInterval(query.state.data),
  });
  return {
    runs: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
