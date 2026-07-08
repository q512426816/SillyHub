/**
 * MachineCard —— 手风琴机器卡组件（task-08 / D-006 / FR-4）。
 *
 * 2026-07-07-daemon-machine-runtime-hierarchy task-08：守护进程运行时页 Machine→Runtime
 * 两级重构方案 A 的「机器卡」。视觉 1:1 对齐 prototype-machine-runtime.html 方案 A
 * 机器卡（折叠头 + 展开体内嵌 RuntimeCard 网格）。
 *
 * 结构：
 * - 折叠头（点击整头 onToggleExpand）：
 *   · 机器图标（lucide Server，status→底色，复用 getStatusMeta 的 iconBg 风格）
 *   · 名称（display_alias ?? hostname）+ 别名小字（hostname，有别名时显示）
 *   · 状态徽章（getStatusMeta + Badge + dot）
 *   · 行2 meta（slate-500 小字）：os·arch · 心跳 · daemon 版本+build 短码 · 负责人
 *   · 右侧 actions：聚合费用胶囊（蓝）+ runtime 数胶囊（slate，在线绿/总数）+
 *     别名按钮 + 升级 daemon 按钮（offline disabled）+ chevron（展开 rotate-90）
 * - 展开体：
 *   · runtimes 非空 → RuntimeCard 网格（xl:grid-cols-2 gap-3），逐 runtime 透传
 *     usage / sessionStats / actioning / latestVersion / upgrading / onRuntime* 回调。
 *   · 0-runtime 机器 → 空态（slate 图标 + 「该机器暂无运行时」）。
 *
 * 受控组件：expanded 由 page 持有。不在此拉用量——usageByRuntime 由 page 注入（D-004）。
 * 不内联 RuntimeCard 实现，import { RuntimeCard } from "./runtime-card"。
 */
import {
  ChevronRight,
  Pencil,
  RefreshCw,
  Server,
  ServerOff,
} from "lucide-react";

import { RuntimeCard } from "@/components/daemon/runtime-card";
import {
  formatCost,
  formatRelativeTime,
  getStatusMeta,
} from "@/components/daemon/runtime-card-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
  DaemonVersionInfo,
  RuntimeUsageItem,
  RuntimeUsageWindow,
} from "@/lib/daemon";

// 活跃会话状态集合（与 runtime-session-helpers.tsx ACTIVE_SESSION_VIEW_STATUSES 对齐）。
// 机器卡内聚合 sessionStats.active 用 —— 因 allowed_paths 仅本文件，不能 import helper，
// 故在此内联常量集合（逻辑零差异：active/pending/reconnecting 计为活跃）。
const ACTIVE_SESSION_STATUSES: ReadonlySet<AgentSessionRead["status"]> = new Set([
  "active",
  "pending",
  "reconnecting",
]);

export interface MachineCardProps {
  machine: DaemonMachineRead;
  expanded: boolean;
  onToggleExpand: () => void;
  // 用量注入（D-004）：runtime_id → usage，由 page 注入。
  usageByRuntime: Map<string, RuntimeUsageItem>;
  usageWindow: RuntimeUsageWindow; // 透传 RuntimeCard
  usageLoading?: boolean; // 透传 RuntimeCard
  latestVersion?: DaemonVersionInfo; // 透传 RuntimeCard（版本徽标比对）
  upgrading?: boolean; // 透传 RuntimeCard（升级中态）
  actioning: boolean; // 透传 RuntimeCard（按钮 loading）
  // 会话列表：按 runtime_id 聚合 sessionStats（{ total, active }）。
  sessions: AgentSessionRead[];
  // 机器级回调。
  onEditAlias: (machine: DaemonMachineRead) => void;
  onUpgrade: (machine: DaemonMachineRead) => void;
  isPlatformAdmin: boolean;
  // runtime 级回调（透传每个 RuntimeCard）。
  onRuntimeToggle: (runtime: DaemonRuntimeRead) => Promise<void>;
  onRuntimeOpenSession: (runtime: DaemonRuntimeRead) => void;
  onRuntimeDelete: (runtime: DaemonRuntimeRead) => void;
  onRuntimeEditAlias: (runtime: DaemonRuntimeRead) => void;
  onRuntimeEditRoots: (runtime: DaemonRuntimeRead) => void;
}

/**
 * 聚合指定 runtime 的会话统计：total = 该 runtime 全部会话数；
 * active = 状态属 active/pending/reconnecting 的会话数。
 * 逻辑与 page.tsx sessionStatsByRuntime 一致。
 */
function computeSessionStats(
  sessions: AgentSessionRead[],
  runtimeId: string,
): { total: number; active: number } {
  let total = 0;
  let active = 0;
  for (const s of sessions) {
    if (s.runtime_id !== runtimeId) continue;
    total += 1;
    if (ACTIVE_SESSION_STATUSES.has(s.status)) active += 1;
  }
  return { total, active };
}

export function MachineCard({
  machine,
  expanded,
  onToggleExpand,
  usageByRuntime,
  usageWindow,
  usageLoading,
  latestVersion,
  upgrading,
  actioning,
  sessions,
  onEditAlias,
  onUpgrade,
  isPlatformAdmin,
  onRuntimeToggle,
  onRuntimeOpenSession,
  onRuntimeDelete,
  onRuntimeEditAlias,
  onRuntimeEditRoots,
}: MachineCardProps) {
  const status = getStatusMeta(machine.status);
  const StatusIcon = machine.status === "offline" ? ServerOff : Server;
  const isOffline = machine.status === "offline";

  // 聚合费用：该机器所有 runtime 在 usageByRuntime 中的 total_cost_usd 之和。
  const totalCost = machine.runtimes.reduce((sum, r) => {
    const usage = usageByRuntime.get(r.id);
    return sum + (usage?.summary.total_cost_usd ?? 0);
  }, 0);

  const buildShort = machine.build_id ? `#${machine.build_id.slice(0, 7)}` : null;
  const ownerName = machine.owner?.display_name ?? null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-sm",
        expanded && "ring-1 ring-primary/10",
      )}
    >
      {/* ===== 折叠头（点击整头切换 expanded） ===== */}
      <header
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4.5"
      >
        {/* 机器图标（status→底色） */}
        <span
          className={cn(
            "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md",
            status.iconBg,
          )}
        >
          <StatusIcon className="h-5 w-5" />
        </span>

        {/* 标题块：row1 名称+别名+状态徽章；row2 meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-[15px] font-bold text-foreground">
              {machine.display_alias ?? machine.hostname}
            </h3>
            {machine.display_alias ? (
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {machine.hostname}
              </span>
            ) : null}
            <Badge variant={status.badge}>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle bg-current opacity-70" />
              {status.label}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {[machine.os, machine.arch].filter(Boolean).join(" · ") || "未知环境"}
            </span>
            <span className="inline-flex items-center gap-1">
              心跳 {formatRelativeTime(machine.last_heartbeat_at)}
            </span>
            {machine.version ? (
              <span className="inline-flex items-center gap-1">
                daemon {machine.version}
                {buildShort ? (
                  <span className="font-mono text-muted-foreground/80">{buildShort}</span>
                ) : null}
              </span>
            ) : null}
            {ownerName ? <span>负责人：{ownerName}</span> : null}
          </div>
        </div>

        {/* 右侧 actions（flex-shrink-0） */}
        <div className="flex shrink-0 items-center gap-2">
          {/* 聚合费用胶囊（蓝） */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            {usageWindow === "7d" ? "7天费用 " : usageWindow === "1d" ? "当日费用 " : "30天费用 "}
            {formatCost(totalCost)}
          </span>

          {/* runtime 数胶囊（slate，在线绿 / 总数） */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
            <span className="text-emerald-700">{machine.online_runtime_count}</span>
            <span className="text-muted-foreground">/</span>
            <span>{machine.runtime_count}</span>
            <span className="text-muted-foreground">runtime</span>
          </span>

          {/* 别名按钮 */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onEditAlias(machine);
            }}
            title="编辑展示别名"
          >
            <Pencil className="h-3.5 w-3.5" />
            别名
          </Button>

          {/* 升级 daemon 按钮（offline disabled） */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={isOffline}
            onClick={(e) => {
              e.stopPropagation();
              onUpgrade(machine);
            }}
            title={isOffline ? "离线，无法升级" : "下发 daemon 自更新指令"}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            升级 daemon
          </Button>

          {/* chevron（展开 rotate-90） */}
          <ChevronRight
            className={cn(
              "h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        </div>
      </header>

      {/* ===== 展开体 ===== */}
      {expanded ? (
        <div className="border-t bg-muted/30 px-4 py-4 sm:px-4.5">
          {machine.runtimes.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {machine.runtimes.map((runtime) => (
                <RuntimeCard
                  key={runtime.id}
                  runtime={runtime}
                  actioning={actioning}
                  sessionStats={computeSessionStats(sessions, runtime.id)}
                  usage={usageByRuntime.get(runtime.id)}
                  usageWindow={usageWindow}
                  usageLoading={usageLoading}
                  latestVersion={latestVersion}
                  upgrading={upgrading}
                  onToggleEnabled={onRuntimeToggle}
                  onOpenSession={onRuntimeOpenSession}
                  onDelete={onRuntimeDelete}
                  onEditAlias={onRuntimeEditAlias}
                  onEditAllowedRoots={onRuntimeEditRoots}
                  onUpgrade={() => onUpgrade(machine)}
                  isPlatformAdmin={isPlatformAdmin}
                />
              ))}
            </div>
          ) : (
            // D-003 空态：0-runtime 机器。
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ServerOff className="h-5 w-5" />
              </span>
              <p className="text-sm text-muted-foreground">该机器暂无运行时</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default MachineCard;
