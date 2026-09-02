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
 *
 * 2026-08-31-machine-sillyspec-version task-07 / FR-01~FR-03：meta 行 daemon
 * 版本后加 sillyspec 版本徽标三形态（最新常色 / 落后 warning「当前 → 最新」+
 * 「有新版本」/ 未安装 destructive），按钮组加「升级 sillyspec」（离线 /
 * running / deferred 禁用；未安装换「安装 sillyspec」、失败换「重试升级」），
 * pending 横幅后加 sillyspec_update 四态横幅（独立 data-machine-sillyspec-banner
 * 槽位，色阶走主题语义 token），文案对照 prototype-machine-sillyspec.html 场景①-⑧。
 */
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Download,
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

/**
 * 本地 semver 比较（2026-08-31-machine-sillyspec-version task-07 / FR-01）：
 * split 按数字段逐段比较，不引第三方库。返回 -1 / 0 / 1（a<b / 相等 / a>b）；
 * 不等长缺省段按 0 处理（3.27 < 3.27.1），非数字后缀截断数字前缀
 * （"3.27.0-beta" → 3.27.0，与 lib/daemon.ts isVersionBelow 同款解析口径）。
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((seg) => Number.parseInt(seg.replace(/\D.*$/, ""), 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const x = va[i] ?? 0;
    const y = vb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export interface MachineCardProps {
  machine: DaemonMachineRead;
  expanded: boolean;
  onToggleExpand: () => void;
  usageByRuntime: Map<string, RuntimeUsageItem>;
  usageWindow: RuntimeUsageWindow;
  usageLoading?: boolean;
  latestVersion?: DaemonVersionInfo;
  upgrading?: boolean;
  /**
   * 升级 sillyspec 回调（2026-08-31-machine-sillyspec-version task-07 / FR-02）。
   * 可选（对齐既有 upgrading 先例）：page 注入；缺省按钮仍渲染但点击无动作，
   * 不破坏既有测试构造。
   */
  onUpgradeSillySpec?: (machine: DaemonMachineRead) => void;
  /**
   * 本地 sillyspec 升级中标记（page 点击确认后即时禁用按钮，指令生效前的
   * 反馈空窗由它兜底，之后 15s 轮询 sillyspec_update running 态接管）。
   */
  upgradingSillySpec?: boolean;
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
  onUpgradeSillySpec,
  upgradingSillySpec,
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

  // ql-20260902-002：daemon 已是最新判定——心跳上报 build_id 与服务端分发
  // latest_build_id 都已知且相等。此时下发自更新指令在 daemon 侧是静默 no-op
  //（preflight runDaemonSelfUpdate 同版本直接返回，不写任何状态），按钮须前置
  // 拦截；任一侧未知（null/缺省）不比较，按钮保持可点（宁宽勿断，对齐下方
  // sillyspecOutdated 同款语义）。
  const daemonUpToDate =
    machine.build_id !== null &&
    machine.build_id !== undefined &&
    latestVersion?.latest_build_id !== undefined &&
    machine.build_id === latestVersion.latest_build_id;

  // 2026-08-31-machine-sillyspec-version task-07 / FR-01~FR-03：sillyspec 三字段
  // 消费（version/latest 兄弟语义 + update 状态机投影，语义同 pending_update；
  // 旧后端无这些字段 → undefined，徽标按未安装、横幅不渲染，零回归）。
  const sillyspecVersion = machine.sillyspec_version ?? null;
  const sillyspecLatest = machine.sillyspec_latest_version ?? null;
  const sillyspecUpdate = machine.sillyspec_update ?? null;
  const sillyspecState = sillyspecUpdate?.state ?? null;
  const sillyspecRunning = sillyspecState === "running";
  const sillyspecDeferred = sillyspecState === "deferred";
  // 落后判定：版本与 latest 都已知且本机 < latest（本地 semver 比较）；
  // latest 未知（null/缺省）不比较，按常色显示（场景①，宁宽勿断）。
  const sillyspecOutdated =
    sillyspecVersion !== null &&
    sillyspecLatest !== null &&
    compareSemver(sillyspecVersion, sillyspecLatest) < 0;

  // 「升级 sillyspec」按钮五态（FR-02，原型①-⑧）：离线 / running / deferred /
  // 本地 upgrading 禁用（title 说明原因）；未安装换文案「安装 sillyspec」（⑦）、
  // 失败后换「重试升级」（⑥）；落后 / 未安装 / 升级进行中 warning 高亮（原型
  // .btn.sp-up / .hot，已是最新回 btnOutlineTiny 底色——原型②注）。禁用窗口
  // 间隙的重复点击由 daemon 侧 in-flight 门去重，无害。
  const sillyspecRunningLike = sillyspecRunning || Boolean(upgradingSillySpec);
  const sillyspecBtnDisabled =
    isOffline || sillyspecRunningLike || sillyspecDeferred;
  const sillyspecBtnLabel = sillyspecRunningLike
    ? "升级中…"
    : sillyspecDeferred
      ? "等待空闲"
      : sillyspecState === "failed"
        ? "重试升级"
        : sillyspecVersion === null
          ? "安装 sillyspec"
          : "升级 sillyspec";
  const sillyspecBtnTitle = isOffline
    ? "离线，无法升级；下次启动时会自动升级"
    : sillyspecRunningLike
      ? "升级中…"
      : sillyspecDeferred
        ? "等待空闲执行"
        : sillyspecState === "failed"
          ? "重新下发 sillyspec 升级指令"
          : sillyspecVersion === null
            ? "远程安装最新版 sillyspec"
            : sillyspecOutdated
              ? `立即升级到 ${sillyspecLatest}`
              : "下发 sillyspec 升级指令（升级到 npm 最新版）";
  const sillyspecBtnHot =
    sillyspecOutdated ||
    sillyspecVersion === null ||
    sillyspecRunningLike ||
    sillyspecDeferred ||
    sillyspecState === "failed";

  // sillyspec_update 四态横幅描述（task-07 / FR-03，原型③④⑤⑥）：running=info
  // 旋转 / deferred=warning / success=success / failed=destructive（带 error 摘要）。
  // state 未知或 null → 不渲染（四态之外无文案，不误示）。from/to 全 nullable
  //（running/deferred 可无 to_version），兜底「—」/「latest」。
  const sillyspecFrom = sillyspecUpdate?.from_version ?? null;
  const sillyspecTo = sillyspecUpdate?.to_version ?? null;
  // QA 返工（原型⑤）：success 副行的完成时刻——since 由 backend 首落库盖值，
  // 格式化口径对齐卡内启动时间（zh-CN 绝对时间，hour12: false）；null 不渲染。
  const sillyspecSince = sillyspecUpdate?.since ?? null;
  let sillyspecBanner: {
    state: string;
    cls: string;
    subCls: string;
    icon: ReactNode;
    main: string;
    sub: string;
  } | null = null;
  if (sillyspecRunning) {
    sillyspecBanner = {
      state: "running",
      cls: "border-info/30 bg-info/10 text-info",
      subCls: "text-info/80",
      icon: <RefreshCw aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin" />,
      main: `正在升级 sillyspec（${sillyspecFrom ?? "—"} → ${sillyspecTo ?? "latest"}）`,
      sub: "执行 npm install -g sillyspec@latest，通常 10～60 秒；完成后版本号自动刷新",
    };
  } else if (sillyspecDeferred) {
    sillyspecBanner = {
      state: "deferred",
      cls: "border-warning/30 bg-warning/10 text-warning",
      subCls: "text-warning/80",
      icon: <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />,
      main: "机器忙（有会话/任务运行中），升级已排队等待空闲自动执行（每 30s 复查）",
      sub: `不打断运行中的任务；新版本 ${sillyspecTo ?? "latest"} 已就绪（当前 ${sillyspecFrom ?? "—"}）`,
    };
  } else if (sillyspecState === "success") {
    sillyspecBanner = {
      state: "success",
      cls: "border-success/30 bg-success/10 text-success",
      subCls: "text-success/80",
      icon: <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />,
      main: `sillyspec 已升级到 ${sillyspecTo ?? "最新版"}`,
      sub: `${sillyspecSince ? `升级完成于 ${new Date(sillyspecSince).toLocaleTimeString("zh-CN", { hour12: false })}；` : ""}横幅展示 10 分钟后自动消失，版本徽标常驻`,
    };
  } else if (sillyspecState === "failed") {
    sillyspecBanner = {
      state: "failed",
      cls: "border-destructive/30 bg-destructive/10 text-destructive",
      subCls: "text-destructive/80",
      icon: <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />,
      main: `sillyspec 升级失败：${sillyspecUpdate?.error ?? "未知原因"}`,
      sub: "可点击「重试升级」再次尝试；daemon 每小时自动检查也会自动重试",
    };
  }

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
            {/*
              sillyspec 版本徽标三形态（task-07 / FR-01，原型①②⑦）：
              - 未安装（version null/缺省，含旧后端）→ destructive「sillyspec 未安装」；
              - 落后（version+latest 都已知且 < latest）→ warning「当前 → 最新」+
                「有新版本」小标签（原型 .sp-out / .ver-tag）；
              - 已最新 / 无法比较（latest 未知）→ 常色仅显示本机版本（.sp-ok）。
            */}
            {sillyspecVersion === null ? (
              <span
                data-machine-sillyspec-badge="none"
                className="inline-flex items-center gap-1 font-semibold text-destructive"
              >
                sillyspec 未安装
              </span>
            ) : sillyspecOutdated ? (
              <span
                data-machine-sillyspec-badge="outdated"
                className="inline-flex items-center gap-1 font-semibold text-warning"
              >
                sillyspec {sillyspecVersion}
                <span aria-hidden className="font-bold">→</span>
                {sillyspecLatest}
                <span className="ml-1 rounded-full bg-warning/10 px-1.5 text-[10px] font-bold leading-4">
                  有新版本
                </span>
              </span>
            ) : (
              <span
                data-machine-sillyspec-badge="ok"
                className="inline-flex items-center gap-1"
              >
                sillyspec {sillyspecVersion}
              </span>
            )}
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
              （等待空闲自动执行），手动指令此时无意义，title 提示等待原因。
              ql-20260902-002：已是最新（build_id == latest_build_id）也 disabled
              + 换文案——daemon 侧同版本 no-op 静默，不拦会让用户误以为在升级。 */}
          <button
            type="button"
            className={btnOutlineTiny}
            disabled={
              isOffline || upgrading || pendingUpdate !== null || daemonUpToDate
            }
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
                    : daemonUpToDate
                      ? `已是最新 ${machine.build_id}`
                      : "下发 daemon 自更新指令"
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {daemonUpToDate ? "已是最新" : "升级 daemon"}
          </button>

          {/* 升级 sillyspec 按钮（task-07 / FR-02，原型①-⑧）。落后/未安装/升级
              进行中 warning 高亮（原型 .btn.sp-up[.hot]，已是最新回底色）；离线 /
              running / deferred / 本地 upgrading 禁用（title 说明原因）；未安装
              文案「安装 sillyspec」（⑦）、失败后「重试升级」（⑥）。 */}
          <button
            type="button"
            className={cn(
              btnOutlineTiny,
              sillyspecBtnHot && "border-warning bg-warning/10 text-warning",
            )}
            disabled={sillyspecBtnDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onUpgradeSillySpec?.(machine);
            }}
            title={sillyspecBtnTitle}
          >
            {sillyspecRunningLike ? (
              <ArrowUp aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : sillyspecDeferred ? (
              <Hourglass aria-hidden className="h-3.5 w-3.5" />
            ) : sillyspecVersion === null ? (
              <Download aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp aria-hidden className="h-3.5 w-3.5" />
            )}
            {sillyspecBtnLabel}
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

      {/* ===== sillyspec_update 四态横幅（2026-08-31-machine-sillyspec-version
       * task-07 / FR-03，原型③④⑤⑥）=====
       * daemon sillyspec-manager 状态机经心跳 sillyspec_update 字段投影。置于
       * pending_update 横幅之后（同折叠头外、expanded 两侧都渲染——升级按钮被
       * 禁用的原因需始终可见）。running=info 旋转 / deferred=warning / success=
       * success / failed=destructive（带 error 摘要），色阶走主题语义 token
       *（与 pending 横幅同款写法），双主题随 data-theme 换肤。独立
       * data-machine-sillyspec-banner 定位（不复用 pending 槽位选择器）。
       * null/缺省/未知 state 不渲染；终态由 daemon 10 分钟后回 idle 置 null
       * 自然消失，刷新走 useDaemonMachines 既有 15s 轮询。 */}
      {sillyspecBanner ? (
        <div
          role="status"
          data-machine-sillyspec-banner={sillyspecBanner.state}
          className={cn("border-b px-[18px] py-2 text-xs", sillyspecBanner.cls)}
        >
          <div className="flex items-center gap-2">
            {sillyspecBanner.icon}
            <span>{sillyspecBanner.main}</span>
          </div>
          <p
            className={cn(
              "ml-[22px] mt-0.5 text-[11px] leading-4",
              sillyspecBanner.subCls,
            )}
          >
            {sillyspecBanner.sub}
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
