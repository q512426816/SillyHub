/**
 * 集中 react-query key 工厂（D-004@v1）。
 *
 * hook 的 useQuery 与后续 mutation 的 invalidate/setQueryData 共用同一组 key，
 * 避免「key 拼错 → 静默去重到不存在的缓存」的坑，也留出唯一演进 key 结构的入口。
 *
 * 规则：凡影响查询结果的变量都进 key。daemon runtimes 的完整过滤/分页 params
 * 进 key，params 变化即产生新查询（react-query 自动停旧启新，最新胜出）。
 */
import type { DaemonRuntimeListParams } from "@/lib/daemon";

export const queryKeys = {
  agentRuns: {
    all: ["agentRuns"] as const,
    list: (workspaceId: string) => ["agentRuns", "list", workspaceId] as const,
  },
  daemonRuntimes: {
    all: ["daemonRuntimes"] as const,
    list: (params: DaemonRuntimeListParams) =>
      ["daemonRuntimes", "list", params] as const,
  },
} as const;
