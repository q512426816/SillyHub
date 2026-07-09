/**
 * use-workspace-context — 工作区上下文组合 hook（task-04）。
 *
 * 2026-07-09-workspace-prioritization task-04 / FR-01 / D-002：
 * 统一串起 URL 派生（真相源）、store 缓存（task-01）、daemon 在线聚合
 * （task-03），并实现 switchWorkspace 切同模块路径替换。供
 * WorkspaceSwitcher（task-08）与 app-shell（task-10）消费。
 *
 * 设计依据：
 *   - design.md §5 数据流：URL → useWorkspaceId 解析 → store 缓存 ←
 *     React Query（列表）写入；switchWorkspace 重写 URL。
 *   - design.md §7 接口定义（useWorkspaceContext / switchWorkspace 注释）。
 *   - 用户硬约束：URL 是真相源，store 仅叠加缓存；刷新由本 hook 从 URL 重建。
 *
 * current 字段填充策略（design §5 数据流的本地化取舍）：
 *   完整 name/daemon_id 由消费方（task-08 切换器有列表项 / task-10 app-shell）
 *   用 React Query 写入。本 task allowed_paths 仅本文件，不引入列表查询；
 *   effect 内写 store 时做最小但自洽的填充——id 对齐 URL，并优先从
 *   useDaemonStatusMap().statusMap[workspaceId] 反查真实 daemon_id / online
 *   （本 hook 已消费 statusMap，不引入新数据源），name 暂空留给列表数据补全。
 *   这样 daemonOnline 聚合在 task-04 内即可自洽可测，不阻断 task-08/task-10
 *   后续用列表项覆盖更完整的 current（只要 id 一致 effect 不会回写覆盖）。
 *
 * useWorkspaceId 逻辑在本文件内重新实现（app-shell 未导出，task-10 接入时
 * app-shell 改为 import 本文件导出，消除重复——见 task-04 约束）。
 */
import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceStore, type CurrentWorkspace } from "@/stores/workspace";
import { useDaemonStatusMap } from "@/lib/workspace-daemon-status";

/**
 * 从 pathname 解析当前 workspaceId（URL 派生，真相源）。
 *
 * 与 app-shell.tsx:104-108 现有实现一致：`/^\/workspaces\/([^/]+)/`。
 * 非 /workspaces/* 路径返回 null。
 */
export function useWorkspaceId(): string | null {
  const pathname = usePathname();
  return useMemo(() => {
    if (!pathname) return null;
    const match = pathname.match(/^\/workspaces\/([^/]+)/);
    return match?.[1] ?? null;
  }, [pathname]);
}

/**
 * 构造切换工作区后的目标路径（D-002 纯函数，便于单测）。
 *
 * 规则：
 *   - 匹配 `^/workspaces/([^/]+)(/([^/]+))?`，替换 wsId 段为 targetId。
 *   - **保留首个模块段**（如 /changes），**截断更深子路径**（/changes/123 →
 *     /changes），避免目标工作区无对应条目时 404（D-002 / R-05 已接受）。
 *   - 无模块段（/workspaces/A）→ /workspaces/{targetId}（概览）。
 *   - 非 /workspaces/* 路径 → 降级 /workspaces/{targetId}（守卫兜底）。
 *
 * 不做 URL 编码：targetId 原样作为段拼接，编码由 router.push 处理。
 */
export function buildSwitchPath(pathname: string, targetId: string): string {
  // group1 = wsId, group3 = 首个模块段（若有）
  const match = pathname.match(/^\/workspaces\/([^/]+)(?:\/([^/]+))?/);
  if (!match) {
    // 非 /workspaces/* 路径：降级到目标工作区概览（守卫兜底）
    return `/workspaces/${targetId}`;
  }
  const moduleSegment = match[2];
  if (!moduleSegment) {
    return `/workspaces/${targetId}`;
  }
  return `/workspaces/${targetId}/${moduleSegment}`;
}

/**
 * useWorkspaceContext — 组合 hook。
 *
 * 返回：
 *   - workspaceId: string | null —— URL 派生（真相源）
 *   - current: CurrentWorkspace | null —— store 缓存（task-01）
 *   - daemonOnline: boolean —— 聚合自 useDaemonStatusMap().statusMap[workspaceId]
 *   - switchWorkspace: (id: string) => void —— router.push(buildSwitchPath)
 *
 * daemonOnline 聚合（task-04 验收）：按 workspaceId 查 statusMap（statusMap
 * 是 Record<workspace_id, DaemonStatusEntry>，按 workspace_id 索引，非按
 * daemon_id）。无 workspaceId 或 statusMap 无条目 → false。
 *
 * effect：workspaceId 变化（与 current.id 不一致）时 setCurrent 写 store，
 * 做最小但自洽填充（见文件头"current 字段填充策略"）。id 一致则不重写
 * （幂等，避免覆盖 task-08/task-10 已写入的完整 current）。
 */
export function useWorkspaceContext(): {
  workspaceId: string | null;
  current: CurrentWorkspace | null;
  daemonOnline: boolean;
  switchWorkspace: (id: string) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceId = useWorkspaceId();
  const current = useWorkspaceStore((s) => s.current);
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  const { statusMap } = useDaemonStatusMap();

  // daemonOnline：按 workspaceId 查 statusMap（实时，每次渲染从 statusMap 读）
  const daemonOnline = (() => {
    if (!workspaceId) return false;
    return statusMap[workspaceId]?.online ?? false;
  })();

  // 进入 ws 时写 store（URL 变化 → store 跟随真相源）
  useEffect(() => {
    if (!workspaceId) return;
    // id 一致则不重写（幂等：避免覆盖 task-08/task-10 写入的完整 current）
    if (current?.id === workspaceId) return;
    // 最小但自洽填充：从 statusMap 反查 daemon_id / online，name 留空
    // （id 已变化，旧 current.name 属于另一工作区，不可沿用）
    const status = statusMap[workspaceId];
    const next: CurrentWorkspace = {
      id: workspaceId,
      name: "",
      daemon_id: status?.daemon_id ?? null,
      daemon_online: status?.online ?? false,
    };
    setCurrent(next);
  }, [workspaceId, current?.id, statusMap, setCurrent]);

  const switchWorkspace = (targetId: string): void => {
    router.push(buildSwitchPath(pathname ?? "/", targetId));
  };

  return { workspaceId, current, daemonOnline, switchWorkspace };
}
