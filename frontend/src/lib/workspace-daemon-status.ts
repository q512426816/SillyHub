/**
 * workspace-daemon-status — daemon 在线状态批量聚合（R-02 落地）。
 *
 * 2026-07-09-workspace-prioritization task-03 / FR-06 / R-02 / CB-4：
 * `MemberBindingView`（lib/workspace-binding.ts）只携带 daemon_id / root_path /
 * path_source，**无 online 字段**——无法单接口拿全。需客户端做
 * 「binding 列表（按 workspace_id 索引）→ daemon 实例列表（带 status）」映射，
 * 得出每个 workspace 绑定的 daemon 是否在线，供切换器（task-08）/ 列表页徽标
 * （task-07）/ context hook（task-04）统一消费（单数据源，不重复请求）。
 *
 * 在线判定（CB-4 已核实）：`DaemonInstanceRead.status === "online"`（枚举
 * online/offline/maintenance/disabled）。maintenance/disabled/offline 统一视为
 * 「离线」（online=false），与 design D-005「离线仅显示不阻断」一致。instance 级
 * 别不带 last_heartbeat_at（那是 runtime 级 DaemonRuntimeRead 的字段）。
 *
 * 只读消费：不新增任何 daemon 生命周期事件 / lease / session 改动（design §7.5）。
 *
 * refetchInterval = 30000（30s）：
 * 切换器常驻顶栏，需反映 daemon 上下线；但 daemon status 由后端心跳驱动（非秒级
 * 变化），30s 轮询足以让徽标跟上「daemon 掉线/重连」，又不会高频打满后端
 * （/api/workspaces/my-bindings + /api/daemon/instances 各 30s 一次）。
 * 对齐既有 hook cadence（use-daemon-machines=15s 偏紧，本 hook 关心的是
 * 跨 ws 的 daemon 存在性而非活跃度，30s 更合适）。
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  type MemberBindingView,
  fetchMyBindings,
} from "@/lib/workspace-binding";
import { type DaemonInstanceRead, listDaemonInstances } from "@/lib/daemon";

/**
 * 单个 workspace 的 daemon 状态条目（statusMap 值）。
 * - daemon_id: 绑定的 daemon 实例 id（未绑定为 null）
 * - online: 是否在线（status==="online"）；离线/维护/禁用/未绑定/实例缺失 全为 false
 * - status: 透传 DaemonInstanceRead.status；未绑定或实例缺失为 null
 */
export interface DaemonStatusEntry {
  daemon_id: string | null;
  online: boolean;
  status: string | null;
}

/**
 * 聚合 daemon 状态的纯函数（不依赖 React，可单测）。
 *
 * 入参：
 *   - bindings: fetchMyBindings() 返回的当前用户全部 workspace binding
 *   - instances: listDaemonInstances() 返回的 daemon 实例列表
 * 输出：Record<workspace_id, DaemonStatusEntry>（按 binding.workspace_id 索引）。
 *
 * 规则：
 *   - 先建 instanceById: Map<instance.id, DaemonInstanceRead>
 *   - daemon_id=null → { daemon_id: null, online: false, status: null }（未绑定）
 *   - daemon_id 指向的 instance 不在列表（已下线/无权）→ online=false, status=null（不抛错）
 *   - 否则 online = (instance.status === "online")，status 透传
 */
export function aggregateDaemonStatus(
  bindings: MemberBindingView[],
  instances: DaemonInstanceRead[],
): Record<string, DaemonStatusEntry> {
  const instanceById = new Map<string, DaemonInstanceRead>();
  for (const inst of instances) {
    instanceById.set(inst.id, inst);
  }

  const out: Record<string, DaemonStatusEntry> = {};
  for (const b of bindings) {
    const wsId = b.workspace_id;
    const daemonId = b.daemon_id;
    if (!daemonId) {
      out[wsId] = { daemon_id: null, online: false, status: null };
      continue;
    }
    const inst = instanceById.get(daemonId);
    if (!inst) {
      // 实例不在列表（已下线 / 无权）→ 视为离线，不抛错（验收标准）
      out[wsId] = { daemon_id: daemonId, online: false, status: null };
      continue;
    }
    out[wsId] = {
      daemon_id: daemonId,
      online: inst.status === "online",
      status: inst.status,
    };
  }
  return out;
}

/**
 * 缓存 key（单数据源，列表页/切换器共用，避免重复请求）。
 * 注：allowed_paths 只允许新建本文件，故不进 query-keys.ts 工厂，就地常量。
 */
export const WORKSPACE_DAEMON_STATUS_QUERY_KEY = ["workspace-daemon-status"] as const;

/**
 * useDaemonStatusMap — 批量聚合当前用户每个 workspace 绑定 daemon 的在线状态。
 *
 * 并行调用 fetchMyBindings（自身已 catch 降级为 []）+ listDaemonInstances（本 hook
 * 内部 .catch(() => []) 降级，保证 instances 失败不阻塞 UI）。任一降级为 [] 时
 * statusMap 退化为「全离线 / 空」，UI 不崩。用 aggregateDaemonStatus 纯函数做映射，
 * 便于单测。30s 轮询（见文件头注释）。
 *
 * 返回：
 *   - statusMap: Record<workspace_id, DaemonStatusEntry>（loading/未拉到时为 {}）
 *   - isLoading / isError: react-query 状态（任一接口抛错且未被 catch 降级才 isError=true；
 *     因两接口都被 catch 成 []，正常情况下 isError 恒 false，仅作透传）
 */
export function useDaemonStatusMap(): {
  statusMap: Record<string, DaemonStatusEntry>;
  isLoading: boolean;
  isError: boolean;
} {
  const q = useQuery<Record<string, DaemonStatusEntry>, ApiError>({
    queryKey: WORKSPACE_DAEMON_STATUS_QUERY_KEY,
    queryFn: async () => {
      const [bindings, instances] = await Promise.all([
        fetchMyBindings(),
        listDaemonInstances().catch(() => [] as DaemonInstanceRead[]),
      ]);
      return aggregateDaemonStatus(bindings, instances);
    },
    refetchInterval: 30_000,
  });
  return {
    statusMap: q.data ?? {},
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
