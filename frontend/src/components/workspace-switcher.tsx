"use client";

/**
 * task-08（2026-07-09-workspace-prioritization / FR-04 / D-002 / D-003 / D-005 / R-03）
 *
 * 顶栏全局工作区切换器 —— 登录后「顶层会话」的可视入口。
 *
 * 设计依据：
 *   - design.md §5 P4：顶栏 WorkspaceSwitcher（当前 ws 名 + daemon 徽标 +
 *     下拉切同模块 + 未绑定弹窗）接入 top-bar（task-09 职责，本组件只建）。
 *   - design.md §7 WorkspaceSwitcher 接口定义。
 *   - design.md §11 D-002（切同模块保留模块段）/ D-003（未绑定弹窗）/
 *     D-005（离线仅标红不阻断）。
 *   - 原型 prototype-workspace-prioritization.html 画面②（顶栏切换器下拉）+
 *     画面③（未绑定弹窗触发）：.switcher-btn + .switcher-menu(.mhead/.mitem/
 *     .current/.new) 三态徽标（success/error/warn）。
 *
 * 上游契约（已就绪，import 消费）：
 *   - @/lib/use-workspace-context（task-04）：useWorkspaceContext() →
 *     {workspaceId, current, daemonOnline, switchWorkspace}。
 *     **注意 current.name 是空字符串**（task-04 留空），由本组件用列表
 *     数据补全（见 fillCurrentName 注释）。
 *   - @/lib/workspace-daemon-status（task-03）：useDaemonStatusMap() →
 *     {statusMap: Record<workspace_id, DaemonStatusEntry>, isLoading}。
 *   - @/components/workspace-binding-dialog（task-06）：受控弹窗，未绑定项
 *     点击时打开；onBound 回调 → 绑定成功 → 切进入。
 *
 * 数据来源（design §5 P5 / task-03 已批量聚合，本组件复用不新增端点）：
 *   - listWorkspaces()：拿 workspace id→name 映射（MemberBindingView 无 name 字段，
 *     列表项 + 按钮态 name 都需此映射）。
 *   - fetchMyBindings()：当前用户的全部 workspace binding（含 daemon_id）。
 *   - 两者 30s 轮询由 useDaemonStatusMap 统一驱动徽标；列表数据本组件独立
 *     useQuery（切换器常驻顶栏，需及时反映新建工作区）。
 *
 * 边界（task-08「不做」）：
 *   - 不实现 switchWorkspace 路径解析（task-04 职责，本组件只调用）。
 *   - 不实现 daemon 状态聚合（task-03 职责，本组件只消费 statusMap）。
 *   - 不重写绑定表单（task-06 包裹 AccessGuide，本组件只控弹窗 open/target）。
 *   - 不改 top-bar.tsx 接入（task-09 职责）。
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/lib/use-workspace-context";
import { useDaemonStatusMap } from "@/lib/workspace-daemon-status";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";
import { fetchMyBindings } from "@/lib/workspace-binding";
import { useWorkspaceStore } from "@/stores/workspace";
import { WorkspaceBindingDialog } from "@/components/workspace-binding-dialog";

/** 下拉项呈现所需的最小信息（由列表 + binding + statusMap 聚合得出）。 */
interface SwitcherEntry {
  id: string;
  name: string;
  daemonId: string | null;
  online: boolean;
  bound: boolean;
}

/** daemon 徽标三态（对齐原型 .b-success/.b-error/.b-warn）。 */
function statusBadgeLabel(entry: Pick<SwitcherEntry, "bound" | "online">): {
  dotClass: string;
  text: string;
  textClass: string;
} {
  if (!entry.bound) {
    return {
      dotClass: "bg-amber-400",
      text: "未绑定",
      textClass: "text-amber-600",
    };
  }
  if (entry.online) {
    return {
      dotClass: "bg-emerald-500",
      text: "在线",
      textClass: "text-emerald-600",
    };
  }
  return {
    dotClass: "bg-red-500",
    text: "离线",
    textClass: "text-red-600",
  };
}

/**
 * WorkspaceSwitcher —— 顶栏工作区切换器。
 *
 * 三态：
 *   1. 平台页引导态（workspaceId === null 且 current 为空，即从未选过）：显示「选择工作区」灰底，点击跳 /workspaces。
 *      若 current 有值（跳平台页前选过 ws），保留显示 current（会话级，不因跳平台页清空）。
 *   2. 已选工作区：按钮显示当前 ws 名 + daemon 徽标，下拉切同模块。
 *   3. 下拉内：列可切换工作区，未绑定项点击触发绑定弹窗（D-003）。
 *
 * 切换：已绑定项 → switchWorkspace(id)（task-04 重写 URL，D-002 切同模块）。
 *       未绑定项 → 打开 WorkspaceBindingDialog，绑定成功 onBound → switchWorkspace。
 *       daemon 离线项 → 仅徽标标红，仍可点击（D-005 不阻断）。
 */
export function WorkspaceSwitcher(): JSX.Element {
  const router = useRouter();
  const { workspaceId, current, switchWorkspace } = useWorkspaceContext();
  const { statusMap } = useDaemonStatusMap();
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);

  // 列表数据（workspace id→name + 当前用户 binding），切换器常驻顶栏需及时
  // 反映新建/重命名工作区。失败降级为空（按钮 name 退化用 current.id）。
  const listQuery = useQuery({
    queryKey: ["workspace-switcher-list"] as const,
    queryFn: async () => {
      const [{ items }, bindings] = await Promise.all([
        listWorkspaces(),
        fetchMyBindings(),
      ]);
      return { items, bindings };
    },
    refetchInterval: 30_000,
  });

  const workspaceById = useMemo(() => {
    const m = new Map<string, Workspace>();
    for (const ws of listQuery.data?.items ?? []) {
      m.set(ws.id, ws);
    }
    return m;
  }, [listQuery.data?.items]);

  /**
   * current.name 补全（task-04 留空 name，由本组件用列表数据填）：
   *   - task-04 effect 写 store 时 id 一致则不重写（幂等，不会覆盖本组件写入）。
   *   - 本 effect 仅在 current.name 为空且列表已拉到当前 ws 时补 name 写回 store，
   *     保持 id/daemon 字段不变（只填 name），不引入新数据源。
   *   - id 不一致（current 已被 task-04 切到新 ws 但列表还没拉到 name）→ 跳过，
   *     等下一轮列表数据。
   */
  useEffect(() => {
    if (!workspaceId || !current) return;
    if (current.name) return; // 已有 name，不覆盖
    const ws = workspaceById.get(workspaceId);
    if (!ws) return; // 列表还没拉到，等下一轮
    setCurrent({
      ...current,
      name: ws.name,
      root_path: ws.root_path ?? current.root_path ?? null,
    });
  }, [workspaceId, current, workspaceById, setCurrent]);

  // 下拉项：聚合 列表 + binding + statusMap
  const entries = useMemo<SwitcherEntry[]>(() => {
    const items = listQuery.data?.items ?? [];
    const bindings = listQuery.data?.bindings ?? [];
    const bindingByWs = new Map(bindings.map((b) => [b.workspace_id, b]));
    return items.map((ws) => {
      const binding = bindingByWs.get(ws.id);
      const daemonId = binding?.daemon_id ?? null;
      const status = statusMap[ws.id];
      return {
        id: ws.id,
        name: ws.name,
        daemonId,
        // statusMap 由 task-03 按 workspace_id 索引提供 online；无条目 → false
        online: status?.online ?? false,
        bound: daemonId != null,
      };
    });
  }, [listQuery.data, statusMap]);

  // 当前工作区名（按钮显示）：优先 store current.name；空则从列表查；
  // 仍空则退化用 id（保证按钮始终有可读文本）。
  const currentName = (() => {
    if (current?.name) return current.name;
    if (workspaceId) {
      const ws = workspaceById.get(workspaceId);
      if (ws?.name) return ws.name;
    }
    return workspaceId ?? "";
  })();

  // daemon 当前状态徽标（按钮态）：优先 workspaceId（工作区页），平台页退化用
  // current.id（保留显示选中 ws 的 daemon 状态，不因跳平台页丢失）。
  const currentBadge = (() => {
    const effectiveId = workspaceId ?? current?.id ?? null;
    const status = effectiveId ? statusMap[effectiveId] : null;
    const bound = (status?.daemon_id ?? null) != null;
    return statusBadgeLabel({ bound, online: status?.online ?? false });
  })();

  const [bindingTargetId, setBindingTargetId] = useState<string | null>(null);

  // ── 平台页引导态（workspaceId === null 且无 current：从未选过工作区） ──
  // 若 current 有值（跳平台页前选过 ws），保留显示 current，不因跳平台页清空。
  if (!workspaceId && !current) {
    return (
      <button
        type="button"
        aria-label="选择工作区"
        onClick={() => router.push("/workspaces")}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:bg-white hover:text-slate-700"
      >
        <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden />
        <span>选择工作区</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </button>
    );
  }

  const handleClickEntry = (entry: SwitcherEntry) => {
    if (!entry.bound) {
      // 未绑定 → 打开绑定弹窗（D-003），不切工作区
      setBindingTargetId(entry.id);
      return;
    }
    // 已绑定（含离线，D-005 不阻断）→ 切同模块
    switchWorkspace(entry.id);
  };

  const handleBound = () => {
    // 绑定成功 → 切进入目标 ws（D-002 切同模块）
    if (bindingTargetId) switchWorkspace(bindingTargetId);
    setBindingTargetId(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="切换工作区"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm transition-colors hover:border-blue-400"
          >
            <span
              className={cn("h-2 w-2 rounded-full", currentBadge.dotClass)}
              aria-hidden
            />
            <span className="max-w-[160px] truncate font-medium text-slate-800">
              {currentName || "未命名工作区"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px]">
          <DropdownMenuLabel className="text-xs uppercase tracking-wide text-slate-500">
            全部工作区
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">暂无可切换工作区</div>
          ) : (
            entries.map((entry) => {
              const isCurrent = entry.id === (workspaceId ?? current?.id);
              const badge = statusBadgeLabel(entry);
              return (
                <DropdownMenuItem
                  key={entry.id}
                  // Radix DropdownMenuItem 默认 onSelect 会关闭菜单；点击切换/开弹窗
                  // 需在此触发，关闭后状态已更新（弹窗 open 由 state 控制独立于菜单）。
                  onSelect={(e) => {
                    e.preventDefault(); // 阻止默认关闭，保证未绑定弹窗/切换逻辑稳定
                    handleClickEntry(entry);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm",
                    isCurrent && "bg-blue-50 text-blue-700",
                  )}
                  disabled={false}
                >
                  <span className="truncate">{entry.name || "未命名"}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", badge.dotClass)}
                      aria-hidden
                    />
                    <span className={cn("text-xs", badge.textClass)}>{badge.text}</span>
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              router.push("/workspaces");
            }}
            className="cursor-pointer px-2.5 py-2 text-sm font-semibold text-blue-600"
          >
            查看全部工作区 →
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {bindingTargetId && (
        <WorkspaceBindingDialog
          workspaceId={bindingTargetId}
          open={true}
          onBound={handleBound}
          onClose={() => setBindingTargetId(null)}
        />
      )}
    </>
  );
}

export default WorkspaceSwitcher;
