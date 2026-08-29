/**
 * MachineCard —— 手风琴机器卡组件。
 *
 * 2026-07-07-daemon-machine-runtime-hierarchy task-08：守护进程运行时页 Machine→Runtime
 * 两级重构方案 A 的「机器卡」。视觉 1:1 对齐 prototype-machine-runtime.html 方案 A
 * 机器卡（折叠头 + 展开体内嵌 RuntimeCard 网格），精确 Tailwind 色阶（slate/blue/emerald）。
 *
 * 受控组件：expanded 由 page 持有。不在此拉用量——usageByRuntime 由 page 注入（D-004）。
 * 不内联 RuntimeCard 实现，import { RuntimeCard } from "./runtime-card"。
 *
 * 2026-08-29-daemon-selfupdate-safety task-07 / FR-05：machine.pending_update
 * 非空时折叠头下渲染推迟升级横幅（server_command=warning / disk_change=info
 * 主题语义色阶，文案对照 prototype-machine-update-status.html）并禁用升级按钮。
 */
import {
  ChevronRight,
  HardDrive,
  Hourglass,
  Pencil,
  RefreshCw,
  Server,
  ServerOff,
  Trash2,
} from "lucide-react";

import { RuntimeCard } from "@/components/daemon/runtime-card";
import {
  formatCost,
  formatRelativeTime,
  getStatusMeta,
} from "@/components/daemon/runtime-card-helpers";
import { cn } from "@/lib/utils";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
  DaemonVersionInfo,
  RuntimeUsageItem,
  RuntimeUsageWindow,
} from "@/lib/daemon";

// 活跃会话状态集合（与 runtime-session-helpers ACTIVE_SESSION_VIEW_STATUSES 对齐）。
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
  usageByRuntime: Map<string, RuntimeUsageItem>;
  usageWindow: RuntimeUsageWindow;
  usageLoading?: boolean;
  latestVersion?: DaemonVersionInfo;
  upgrading?: boolean;
  actioning: boolean;
  sessions: AgentSessionRead[];
  onEditAlias: (machine: DaemonMachineRead) => void;
  onUpgrade: (machine: DaemonMachineRead) => void;
  onCleanup: (machine: DaemonMachineRead) => void;
  /** ql-20260829-006-6a9e：删除机器条目（仅离线机器可触发，page 层 modal.confirm）。 */
  onDeleteMachine: (machine: DaemonMachineRead) => void;
  onRuntimeToggle: (runtime: DaemonRuntimeRead) => Promise<void>;
  onRuntimeOpenSession: (runtime: DaemonRuntimeRead) => void;
  onRuntimeDelete: (runtime: DaemonRuntimeRead) => void;
  onRuntimeEditAlias: (runtime: DaemonRuntimeRead) => void;
  onRuntimeEditRoots: (runtime: DaemonRuntimeRead) => void;
}

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
  onCleanup,
  onDeleteMachine,
  onRuntimeToggle,
  onRuntimeOpenSession,
  onRuntimeDelete,
  onRuntimeEditAlias,
  onRuntimeEditRoots,
}: MachineCardProps) {
  const status = getStatusMeta(machine.status);
  const StatusIcon = machine.status === "offline" ? ServerOff : Server;
  const isOffline = machine.status === "offline";

  // task-07 / FR-05：pending_update 非空 = 推迟升级期（机器忙，daemon 自更新
  // 安全层等待空闲）。server_command 与 disk_change 共用同一横幅位，仅文案/
  // 色阶不同（原型②③）；缺省（旧后端）按 null 消费。未知 reason 兜底走
  // warning 升级等待文案（reason 保持 string 不收紧，见 lib/daemon.ts）。
  const pendingUpdate = machine.pending_update ?? null;
  const isDiskChange = pendingUpdate?.reason === "disk_change";

  // 聚合费用：该机器所有 runtime 在 usageByRuntime 中的 total_cost_usd 之和。
  const totalCost = machine.runtimes.reduce((sum, r) => {
    const usage = usageByRuntime.get(r.id);
    return sum + (usage?.summary.total_cost_usd ?? 0);
  }, 0);

  const buildShort = machine.build_id ? `#${machine.build_id.slice(0, 7)}` : null;
  const ownerName = machine.owner?.display_name ?? null;

  // prototype .btn-outline btn-tiny（机器头别名/升级按钮）。
  const btnOutlineTiny =
    "inline-flex items-center gap-1 rounded border border-slate-300 bg-card px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-card";

  // 删除按钮（ql-20260829-006-6a9e）：危险红字，同 outline 尺寸；仅离线机器可点
  // （后端 45s 心跳守卫同语义，在线机器删了也会被下次心跳复活 + 产生僵尸心跳）。
  const btnDangerTiny =
    "inline-flex items-center gap-1 rounded border border-slate-300 bg-card px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-card";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-slate-200 bg-card shadow-sm",
        expanded && "ring-1 ring-brand-100",
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
        className="flex cursor-pointer items-center gap-3.5 px-[18px] py-3.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset"
      >
        {/* 机器图标（status→底色，对齐 prototype .machine-icon 42×42） */}
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
            <h3 className="text-[15px] font-bold text-slate-900">
              {machine.display_alias ?? machine.hostname}
            </h3>
            {machine.display_alias ? (
              <span className="font-mono text-[11.5px] text-slate-500">{machine.hostname}</span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                status.badgeClass,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              {[machine.os, machine.arch].filter(Boolean).join(" · ") || "未知环境"}
            </span>
            <span className="inline-flex items-center gap-1">
              心跳 {formatRelativeTime(machine.last_heartbeat_at)}
            </span>
            {/*
              进程启动时间（task-07 / FR-03）：直接显示绝对时间（用户需求：看准确启动时刻，
              不要相对「几分钟前」）；null（旧 daemon 未上报）显「—」。
            */}
            <span className="inline-flex items-center gap-1">
              启动{" "}
              {machine.started_at
                ? new Date(machine.started_at).toLocaleString("zh-CN", { hour12: false })
                : "—"}
            </span>
            {machine.version ? (
              <span className="inline-flex items-center gap-1">
                daemon {machine.version}
                {buildShort ? <span className="font-mono text-slate-400">{buildShort}</span> : null}
              </span>
            ) : null}
            {ownerName ? <span>负责人：{ownerName}</span> : null}
          </div>
        </div>

        {/* 右侧 actions（对齐 prototype .machine-actions） */}
        <div className="flex shrink-0 items-center gap-2">
          {/* 聚合费用胶囊（brand 阶强调，对齐 .machine-cost） */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {usageWindow === "7d" ? "7天费用 " : usageWindow === "1d" ? "当日费用 " : "30天费用 "}
            {formatCost(totalCost)}
          </span>

          {/* runtime 数胶囊（slate，对齐 .rt-count：在线绿/总数） */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            <span className="text-emerald-700">{machine.online_runtime_count}</span>
            <span className="text-slate-400">/</span>
            <span>{machine.runtime_count}</span>
            <span className="text-slate-500">runtime</span>
          </span>

          {/* 别名按钮（对齐 .btn-outline btn-tiny） */}
          <button
            type="button"
            className={btnOutlineTiny}
            onClick={(e) => {
              e.stopPropagation();
              onEditAlias(machine);
            }}
            title="编辑展示别名"
          >
            <Pencil className="h-3.5 w-3.5" />
            别名
          </button>

          {/* 升级 daemon 按钮（对齐 .btn-outline btn-tiny，offline disabled）。
              task-07 / FR-05：pending_update 期也 disabled——升级已由安全层接管
              （等待空闲自动执行），手动指令此时无意义，title 提示等待原因。 */}
          <button
            type="button"
            className={btnOutlineTiny}
            disabled={isOffline || upgrading || pendingUpdate !== null}
            onClick={(e) => {
              e.stopPropagation();
              onUpgrade(machine);
            }}
            title={
              isOffline
                ? "离线，无法升级"
                : upgrading
                  ? "升级中…"
                  : pendingUpdate
                    ? "升级进行中"
                    : "下发 daemon 自更新指令"
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            升级 daemon
          </button>

          {/* 清理缓存按钮（对齐 .btn-outline btn-tiny，offline disabled） */}
          <button
            type="button"
            className={btnOutlineTiny}
            disabled={isOffline}
            onClick={(e) => {
              e.stopPropagation();
              onCleanup(machine);
            }}
            title={isOffline ? "离线，无法清理" : "清理本地缓存（specs / 会话日志 / 备份）"}
          >
            <HardDrive className="h-3.5 w-3.5" />
            清理
          </button>

          {/* 删除机器按钮（ql-20260829-006-6a9e，online disabled） */}
          <button
            type="button"
            className={btnDangerTiny}
            disabled={!isOffline}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteMachine(machine);
            }}
            title={
              isOffline
                ? "删除该机器条目（连带清除其下全部运行时与会话/任务记录）"
                : "在线机器不可删除，请先停止该机器上的守护进程"
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>

          {/* chevron（对齐 .chevron，展开 rotate-90） */}
          <ChevronRight
            className={cn(
              "h-[18px] w-[18px] shrink-0 text-slate-400 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        </div>
      </header>

      {/* ===== pending_update 三状态横幅（task-07 / FR-05 / D-003@v2 + D-004@v1）=====
       * daemon 自更新安全层推迟升级期对运维可见。置于折叠头之外（expanded 两侧都
       * 渲染）——pending 期升级按钮被禁用，原因需要始终可见。同一横幅位两种文案
       * （原型②③）：server_command → warning 色阶「等待空闲后自动升级」；
       * disk_change → info 色阶「程序文件已变更，等待空闲加载」。色阶用主题语义
       * token（warning/info，session-panel 横幅同款写法），双主题随 data-theme
       * 换肤。刷新走 useDaemonMachines 既有 15s 轮询——升级完成后 pending_update
       * 置 null，横幅自然消失（接受 30-60s 残留窗口）。null/缺省不渲染。 */}
      {pendingUpdate ? (
        <div
          role="status"
          data-machine-pending-banner={pendingUpdate.reason}
          className={cn(
            "border-b px-[18px] py-2 text-xs",
            isDiskChange
              ? "border-info/30 bg-info/10 text-info"
              : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          <div className="flex items-center gap-2">
            {isDiskChange ? (
              <RefreshCw aria-hidden className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {isDiskChange
                ? "检测到程序文件已变更，等待空闲自动加载新版本"
                : "等待空闲后自动升级（每 30s 复查）"}
            </span>
          </div>
          <p
            className={cn(
              "ml-[22px] mt-0.5 text-[11px] leading-4",
              isDiskChange ? "text-info/80" : "text-warning/80",
            )}
          >
            {isDiskChange
              ? `来源：磁盘旁路探测——${pendingUpdate.target_version}`
              : `新版本 ${pendingUpdate.target_version} 已就绪（当前 ${pendingUpdate.current_version}），空闲即自动升级生效`}
          </p>
        </div>
      ) : null}

      {/* ===== 展开体（对齐 .machine-body） ===== */}
      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50 px-[18px] py-4">
          {machine.runtimes.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
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
                />
              ))}
            </div>
          ) : (
            // D-003 空态：0-runtime 机器。
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                <ServerOff className="h-5 w-5" />
              </span>
              <p className="text-sm text-slate-500">该机器暂无运行时</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default MachineCard;
