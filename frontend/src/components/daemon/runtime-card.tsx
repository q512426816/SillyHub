/**
 * RuntimeCard —— 单个智能体运行时卡片（task-07 / D-006 视觉对齐原型）。
 *
 * 2026-07-07-daemon-machine-runtime-hierarchy task-07：从 app/(dashboard)/runtimes/page.tsx
 * 抽出为独立组件，视觉零改动。唯一差异：meta 网格删除「Daemon 版本」行（C-002）——
 * 该信息（daemon 进程版本 + build_id 短码 + 版本徽标）将上提到 task-08 的机器头聚合块。
 *
 * daemon_version / daemon_build_id 字段在 DaemonRuntimeRead 上保留（向后兼容，其它消费方
 * 仍可读），仅本组件不再渲染该 meta 行。
 *
 * 依赖说明：
 * - helper（getStatusMeta / getCapabilityChips / getProtocol / getDisplayVersion /
 *   formatRelativeTime / formatTokens / formatCost / formatCache / ProviderBadge /
 *   AgentsList / VersionCell / RuntimeMeta / UsageStat）从 ./runtime-card-helpers 引入。
 * - 外部依赖（shortId / RuntimeUsageLineChart / WINDOW_LABELS / lucide 图标 / cn /
 *   Badge / Button / Link / 类型）保持从原来源引入，不改路径。
 */
import {
  Cpu,
  MessageSquare,
  Power,
  Ban,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";

import { RuntimeUsageLineChart } from "@/components/charts"; // task-13 桶导出(dynamic ssr:false),非原始组件
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  type DaemonRuntimeRead,
  type DaemonVersionInfo,
  type RuntimeUsageItem,
  type RuntimeUsageWindow,
} from "@/lib/daemon";
import { shortId } from "@/components/daemon/runtime-session-helpers";
import { cn } from "@/lib/utils";

import {
  AgentsList,
  formatCache,
  formatCost,
  formatRelativeTime,
  formatTokens,
  getCapabilityChips,
  getDisplayVersion,
  getProtocol,
  getStatusMeta,
  ProviderBadge,
  RuntimeMeta,
  UsageStat,
  VersionCell,
} from "./runtime-card-helpers";

// WINDOW_LABELS 仍由 page.tsx 拥有（task-07 allowed_paths 仅含本组件 + helpers + page）；
// 此处复声明类型契约，组件渲染用量统计区标题需要它。
const WINDOW_LABELS: Record<RuntimeUsageWindow, string> = {
  "1d": "当日",
  "7d": "7 天",
  "30d": "30 天",
};

export type RuntimeCardProps = {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  sessionStats: { total: number; active: number };
  usage?: RuntimeUsageItem;
  usageWindow: RuntimeUsageWindow;
  usageLoading?: boolean;
  latestVersion?: DaemonVersionInfo;
  upgrading?: boolean;
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
  onOpenSession: (runtime: DaemonRuntimeRead) => void;
  // task-06：签名从 Promise<void> 改 void —— modal.confirm 同步触发，删除在 onOk 异步回调里。
  onDelete: (runtime: DaemonRuntimeRead) => void;
  // task-07 / FR-03：别名编辑入口（由 RuntimesPage 弹 modal 编辑，避免卡片内状态膨胀）。
  onEditAlias: (runtime: DaemonRuntimeRead) => void;
  // task-06 / FR-04 / D-006@v1：可写目录（allowed_roots 沙箱）编辑入口，仅 admin 可见。
  onEditAllowedRoots: (runtime: DaemonRuntimeRead) => void;
  // 2026-07-04-daemon-version-management task-09：daemon 进程升级（self-update 端点）。
  onUpgrade: (runtime: DaemonRuntimeRead) => void;
  // task-06 / FR-04：是否平台管理员（控制「可写目录」编辑按钮显隐）。
  isPlatformAdmin: boolean;
};

export function RuntimeCard({
  runtime,
  actioning,
  sessionStats,
  usage,
  usageWindow,
  usageLoading,
  latestVersion,
  upgrading,
  onToggleEnabled,
  onOpenSession,
  onDelete,
  onEditAlias,
  onEditAllowedRoots,
  onUpgrade,
  isPlatformAdmin,
}: RuntimeCardProps) {
  const status = getStatusMeta(runtime.status);
  const StatusIcon = status.icon;
  const capabilityChips = getCapabilityChips(runtime);
  const heartbeat = formatRelativeTime(runtime.last_heartbeat_at);
  const displayVersion = getDisplayVersion(runtime);
  const protocol = getProtocol(runtime);
  const isDisabled = runtime.status === "disabled";
  const ActionIcon = isDisabled ? Power : Ban;
  const binPath =
    typeof runtime.capabilities?.bin_path === "string" && runtime.capabilities.bin_path
      ? runtime.capabilities.bin_path
      : null;
  const envLabel = [runtime.os, runtime.arch].filter(Boolean).join(" · ") || null;
  const createdLabel = formatRelativeTime(runtime.created_at);
  const canOpenSession =
    runtime.status === "online" &&
    (runtime.provider === "claude" || runtime.provider === "codex");

  // task-14 / FR-01：用量区数字（summary 缺失 → 「—」，费用恒 $xx.xx）。
  const summary = usage?.summary;
  const inputLabel = summary ? formatTokens(summary.input_tokens) : "—";
  const outputLabel = summary ? formatTokens(summary.output_tokens) : "—";
  const cacheLabel = formatCache(usage);
  const costLabel = summary ? formatCost(summary.total_cost_usd) : "$0.00";

  return (
    <article className="overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/30">
      <header className="flex items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", status.iconBg)}>
            <StatusIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ProviderBadge provider={runtime.provider} />
              <Badge variant={status.badge}>{status.label}</Badge>
            </div>
            <h3 className="mt-2 truncate font-mono text-sm font-semibold">
              {runtime.display_alias ?? runtime.name ?? "未命名运行时"}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {shortId(runtime.id)} · 注册 {createdLabel}
            </p>
            {runtime.display_alias && runtime.name ? (
              <p className="truncate text-[10px] text-muted-foreground">原名：{runtime.name}</p>
            ) : null}
            {runtime.owner ? (
              <p className="truncate text-[10px] text-muted-foreground">
                负责人：{runtime.owner.display_name ?? runtime.owner.email ?? "未记录"}
              </p>
            ) : null}
          </div>
        </div>
        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", status.dot)} />
      </header>

      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <RuntimeMeta label="运行环境">
          {envLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3 w-3 shrink-0 text-muted-foreground" />
              {envLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">未上报</span>
          )}
        </RuntimeMeta>
        <RuntimeMeta label="心跳">{heartbeat}</RuntimeMeta>
        <RuntimeMeta label="版本">
          {displayVersion ? (
            <VersionCell provider={runtime.provider} version={displayVersion} />
          ) : (
            <span className="text-muted-foreground">待识别</span>
          )}
        </RuntimeMeta>
        <RuntimeMeta label="协议">{protocol}</RuntimeMeta>
        {/* task-07 / C-002：原「Daemon 版本」meta 行已删除 —— daemon_version / build_id
            信息上提至 task-08 机器头聚合块。daemon_version / daemon_build_id 字段在
            DaemonRuntimeRead 上保留（向后兼容），仅本组件不再渲染。 */}
        {binPath && (
          <RuntimeMeta label="可执行路径">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{binPath}</span>
            </span>
          </RuntimeMeta>
        )}
        <RuntimeMeta label="会话">
          <span className="inline-flex items-center gap-1">
            {sessionStats.total}
            {sessionStats.active > 0 && (
              <span className="text-emerald-600">（{sessionStats.active} 活跃）</span>
            )}
          </span>
        </RuntimeMeta>
      </div>

      {/*
        task-14 / FR-01 / FR-04：用量区（4 数字 + sparkline）。
        - 数字:输入 / 输出 / 缓存(合并 read+creation,D-001@v1 无数据显示「—」) / 费用(USD)。
        - sparkline:task-13 桶导出的 RuntimeUsageLineChart,传该 runtime 的 daily 序列(输入/输出双线)。
        - usage=undefined(新 runtime / 窗口内无 run / 拉取失败)→ 数字全「—」、费用 $0.00、sparkline「暂无数据」。
      */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            用量统计（{WINDOW_LABELS[usageWindow]}）
          </p>
          <span className="text-[11px] text-muted-foreground">
            {usageLoading ? "加载中" : ""}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <UsageStat label="输入" value={inputLabel} />
          <UsageStat label="输出" value={outputLabel} />
          <UsageStat label="缓存" value={cacheLabel} />
          <UsageStat label="费用" value={costLabel} />
        </div>
        <div className="mt-2">
          <RuntimeUsageLineChart
            points={usage?.daily ?? []}
            loading={usageLoading}
          />
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">运行能力</p>
          <span className="text-[11px] text-muted-foreground">{capabilityChips.length}</span>
        </div>
        <div className="mt-2">
          <AgentsList agents={capabilityChips} compact />
        </div>
      </div>

      {/* task-06 / FR-04 / D-006@v1：可写目录（allowed_roots 沙箱）展示。
          daemon 在此白名单内才能 list_dir / 创建 workspace（D-002@v1 越界 403）。
          空 → 「未配置（任意目录可访问）」；非空 → 逐行 Tag 列出根路径。 */}
      <div className="border-t px-4 py-3">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">
          可写目录（读取不受限）
        </p>
        <div className="mt-2">
          {(runtime.allowed_roots ?? []).length > 0 ? (
            <span className="inline-flex flex-wrap gap-1.5">
              {(runtime.allowed_roots ?? []).map((root, idx) => (
                <span
                  key={`${root}-${idx}`}
                  className="inline-flex min-w-0 items-center gap-1 rounded border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground"
                  title={root}
                >
                  <Terminal className="h-3 w-3 shrink-0" />
                  <span className="truncate">{root}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              未配置（任意目录可写）
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => onEditAlias(runtime)}
          title="编辑展示别名"
        >
          别名
        </Button>
        {/* task-06 / FR-04 / D-006@v1：仅平台管理员可配置 daemon 可写目录沙箱。 */}
        {isPlatformAdmin ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onEditAllowedRoots(runtime)}
            title="配置该运行时可写的目录沙箱（读取不受限）"
          >
            可写目录
          </Button>
        ) : null}
        {/* 2026-07-04-daemon-version-management task-09：升级 daemon 到最新版（self-update）。
            离线 runtime 禁用（后端 WS 下发不达）；upgrading 态 loading 防重复点。 */}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={runtime.status !== "online" || upgrading}
          onClick={() => onUpgrade(runtime)}
          title={
            runtime.status !== "online"
              ? "离线，无法升级"
              : "下发 daemon 自更新指令，重启后版本将自动更新"
          }
        >
          {upgrading ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {upgrading ? "下发中" : "升级到最新版"}
        </Button>
        {/* task-21：审计日志入口，所有可访问 runtime 的用户可见（平台用户功能）。
            跳转 /runtimes/{id}/audit（task-20 路由）。与「可写目录」同级，风格一致。 */}
        <Link
          href={`/runtimes/${runtime.id}/audit`}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          title="查看该运行时的审计日志"
        >
          审计日志
        </Link>
        {canOpenSession && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onOpenSession(runtime)}
            title="打开该运行时的会话窗口"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            会话
          </Button>
        )}
        <Button
          size="sm"
          variant={isDisabled ? "outline" : "destructive"}
          className="gap-1.5"
          disabled={actioning}
          onClick={() => void onToggleEnabled(runtime)}
          title={isDisabled ? "启用此智能体运行时" : "禁用此智能体运行时"}
        >
          {actioning ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ActionIcon className="h-3.5 w-3.5" />
          )}
          {actioning ? "处理中" : isDisabled ? "启用" : "禁用"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={actioning}
          onClick={() => onDelete(runtime)}
          title="移除此运行时记录（连带清除其下会话与任务记录）"
        >
          <Trash2 className="h-3.5 w-3.5" />
          移除
        </Button>
      </div>
    </article>
  );
}
