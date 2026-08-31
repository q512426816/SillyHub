/**
 * useDaemonMachines — daemon 机器列表 + 会话组合查询（机器级，覆盖 FR-4,6）。
 *
 * 机器级数据 hook：Promise.all 并发 listDaemonMachines
 * + listAgentSessions（sessions 失败 .catch(null) 降级为 []，不阻塞列表渲染）。
 * params 进 queryKey，过滤/分页变化即新查询（react-query 自动停旧启新 R-02）。
 * 15s 无条件轮询。用量（用量统计）不走本 hook，由 page 单独调
 * getRuntimesUsage(window) 管理（D-004，不内联 /machines）。
 *
 * task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2）：machines 响应的
 * shared_to_me 共享机器块透传为 sharedToMe，并融合出 machineCandidates（自有 +
 * 共享给我的，共享条目带 sharedMeta 标识元数据供消费端渲染共享徽标）。既有
 * items/total/sessions 字段类型与 15s 轮询/queryKey/sessions 降级语义零变化；
 * 旧调用点不取新字段即零感知。
 *
 * task-13（契约修复）：SharedMachineView 行新增 runtimes 明细
 * （runtime_id/provider/online），共享候选合成条目携带真实 runtimes（此前恒
 * []——picker 第二步共享机器无 runtime 可选的缺口收口）；旧响应缺省字段按
 * 空 list 消费，合成条目形态不变。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import {
  type AgentSessionRead, type DaemonMachineListParams,
  type DaemonMachineRead, type DaemonRuntimeRead,
  listAgentSessions, listDaemonMachines,
} from "@/lib/daemon";
import { queryKeys } from "./query-keys";

/** 「共享给我的」机器行 DTO（task-08 生成 api-types 单一来源，禁止手写字段）。 */
export type SharedMachineView = components["schemas"]["SharedMachineView"];

/**
 * machines 响应本地视图：后端 task-07 起响应末位附加 shared_to_me 块（design
 * §5 Phase 2.2）。daemon.ts 手写的 DaemonMachineListResponse 未含该字段（该文件
 * 属 task-09 领地，此处不越界修改）——本地叠加可选字段读取真实响应，task-09
 * 封装落地后语义不变（同一响应块）。
 */
type MachinesResponseWithShared = Awaited<ReturnType<typeof listDaemonMachines>> & {
  shared_to_me?: SharedMachineView[];
};

/** 共享机器标识元数据（task-10：融合候选中共享条目携带，消费端渲染徽标）。 */
export interface SharedMachineMeta {
  /** 共享人（lender）显示名；后端缺省为 null。 */
  lenderDisplayName: string | null;
  /** 来源工作区 id（授权的 grantee workspace，仅标识用途）。 */
  sourceWorkspaceId: string | null;
}

/**
 * 机器候选条目：自有机器原样（无 sharedMeta）；共享机器合成条目带 sharedMeta。
 * 既有字段与 DaemonMachineRead 完全一致（交叉类型，非改写）。
 */
export type MachineCandidate = DaemonMachineRead & { sharedMeta?: SharedMachineMeta };

/**
 * SharedMachineView → 机器候选合成条目（纯函数，组件外便于单测推理）。
 *
 * task-13：共享行携带真实 runtimes（runtime_id/provider/online）——合成为
 * DaemonRuntimeRead 形态（消费端 picker 第二步/config-bar 机器·智能体下拉按
 * r.status==="online" + provider 过滤，status 由 online 布尔映射）；计数同步
 * 派生。显示名并入共享人标注（PreSessionPicker 等不可改的 DaemonMachineRead
 * 消费端凭显示名即可见「共享」标识），hostname 保留净名供消费端配徽标渲染。
 */
export function toSharedMachineCandidate(row: SharedMachineView): MachineCandidate {
  const lender = row.lender_display_name?.trim() || null;
  const runtimes: DaemonRuntimeRead[] = (row.runtimes ?? []).map((rt) => ({
    id: rt.runtime_id,
    name: null,
    provider: rt.provider ?? null,
    version: null,
    os: null,
    arch: null,
    status: rt.online ? "online" : "offline",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    daemon_instance_id: row.machine_id,
    created_at: "1970-01-01T00:00:00Z",
    updated_at: "1970-01-01T00:00:00Z",
  }));
  return {
    id: row.machine_id,
    hostname: row.display_name,
    display_alias: lender
      ? `${row.display_name} · ${lender} 共享`
      : `${row.display_name} · 共享`,
    os: null,
    arch: null,
    status: row.online ? "online" : "offline",
    last_heartbeat_at: null,
    version: null,
    build_id: null,
    started_at: null,
    created_at: "1970-01-01T00:00:00Z",
    runtime_count: runtimes.length,
    online_runtime_count: runtimes.filter((r) => r.status === "online").length,
    runtimes,
    sharedMeta: {
      lenderDisplayName: lender,
      sourceWorkspaceId: row.source_workspace_id ?? null,
    },
  };
}

interface DaemonMachinesData {
  items: DaemonMachineRead[];
  total: number;
  sessions: AgentSessionRead[];
  /** task-10：shared_to_me 透传（无共享授权/旧响应缺块 → []）。 */
  sharedToMe: SharedMachineView[];
}

export function useDaemonMachines(params: DaemonMachineListParams) {
  const q = useQuery<DaemonMachinesData, ApiError>({
    queryKey: queryKeys.daemonMachines.list(params),
    queryFn: async () => {
      const [resp, sessionsResp] = await Promise.all([
        listDaemonMachines(params) as Promise<MachinesResponseWithShared>,
        // ql-20260831-015：后端 HTTP 默认改三态（不传=全部含已归档）——机器
        // 分组/会话计数只统计未归档，显式 false 保持原语义。
        listAgentSessions({ limit: 100, archived: false }).catch(() => null),
      ]);
      return {
        items: resp.items,
        total: resp.total,
        sessions: sessionsResp?.items ?? [],
        sharedToMe: resp.shared_to_me ?? [],
      };
    },
    refetchInterval: 15000,
  });

  // task-10：机器候选融合——自有机器在前，共享机器垫底（按 machine_id 去重，
  // 防后端异常数据把自有机器重复列出）。共享条目共享元数据见 sharedMeta。
  const machineCandidates = useMemo<MachineCandidate[]>(() => {
    const items = q.data?.items ?? [];
    const ownIds = new Set(items.map((m) => m.id));
    const shared = (q.data?.sharedToMe ?? [])
      .filter((row) => !ownIds.has(row.machine_id))
      .map(toSharedMachineCandidate);
    return [...items, ...shared];
  }, [q.data]);

  return {
    items: q.data?.items ?? [],
    total: q.data?.total ?? 0,
    sessions: q.data?.sessions ?? [],
    /** task-10 新增：共享机器块透传（消费端渲染「共享」徽标 / 徽标元数据）。 */
    sharedToMe: q.data?.sharedToMe ?? [],
    /** task-10 新增：机器候选 = 自有 + 共享给我的（共享条目带 sharedMeta）。 */
    machineCandidates,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
