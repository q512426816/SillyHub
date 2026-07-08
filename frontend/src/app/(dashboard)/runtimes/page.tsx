"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import {
  isActiveSession,
} from "@/components/daemon/runtime-session-helpers";
import { RuntimeSessionDialog } from "@/components/daemon/runtime-session-dialog";
// task-09：MachineCard 两级手风琴（machine + 内嵌 RuntimeCard 网格）。
// RuntimeCard 不再在 page 内联渲染，仅由 MachineCard 展开体透传 props 调用。
import { MachineCard } from "@/components/daemon/machine-card";
import {
  formatRelativeTime,
} from "@/components/daemon/runtime-card-helpers";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  browseFolder,
  deleteDaemonRuntime,
  disableDaemonRuntime,
  enableDaemonRuntime,
  getAgentSession,
  getDaemonVersion,
  getRuntimesUsage,
  listDir,
  PROVIDER_META,
  triggerMachineSelfUpdate,
  updateDaemonMachine,
  updateRuntimeAllowedRoots,
  type AgentSessionRead,
  type DaemonMachineListParams,
  type DaemonMachineRead,
  type DaemonRuntimeRead,
  type DaemonVersionInfo,
  type RuntimeUsageItem,
  type RuntimeUsageWindow,
} from "@/lib/daemon";
// task-09：数据源从 useDaemonRuntimes 切到 useDaemonMachines（机器级，D-005 完全替换平铺）。
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
// task-06 / FR-03 / D-003@v1：antd Modal.confirm（删除二次确认）+ useNotify（成功/失败 toast）。
// Modal 走 App.useApp().modal 拿到主题上下文实例（非静态 Modal），由 antd-providers.tsx 的 <AntApp> 注入。
import { App, Input, Modal, Spin, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { useNotify } from "@/lib/errors";
// task-07 / D-003@v1：平台管理员人员搜索复用既有 admin 用户列表。
import { listUsers, type UserRead } from "@/lib/admin";

/** 时间窗中文 label（FR-04，CLAUDE.md 规则 11 中文 UI）。
 *  task-09：其余 RuntimeCard/MachineCard 专属 helper（getStatusMeta / getProviderLabel /
 *  formatRelativeTime 等）已迁出到 @/components/daemon/runtime-card-helpers。 */
const WINDOW_LABELS: Record<RuntimeUsageWindow, string> = {
  "1d": "当日",
  "7d": "7 天",
  "30d": "30 天",
};

function CopyDaemonCommand({ compact = false }: { compact?: boolean }) {
  const accessToken = useSession((s) => s.accessToken);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getLatestActiveApiKey } = await import("@/lib/api-keys");
        const latest = await getLatestActiveApiKey();
        if (!cancelled) setApiKey(latest ? latest.key_prefix + "…" : null);
      } catch {
        // 非 admin 或尚未签发：fallback 到 access_token
        if (!cancelled) setApiKey(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 渲染所需：apiKey（优先）或 accessToken（fallback）
  if (!apiKey && !accessToken) return null;

  const frontendUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const serverUrl = frontendUrl.replace(/:3001$/, ":8001");
  // 优先用长期 API Key；fallback 到浏览器短期 access_token（TTL 15min，不适合长期运行）。
  const useApiKey = !!apiKey;
  const placeholderCred = useApiKey ? (apiKey as string) : "<access_token>";
  const cmd = useApiKey
    ? `sillyhub-daemon start --server ${serverUrl} --api-key <粘贴你的 API Key>`
    : `sillyhub-daemon start --server ${serverUrl} --token ${accessToken}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", compact && "w-full")}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 shadow-sm">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            sillyhub-daemon start --server {serverUrl}{" "}
            {useApiKey ? "--api-key" : "--token"} {placeholderCred}
          </code>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5"
          onClick={handleCopy}
          title={copied ? "已复制" : "复制完整命令"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? "已复制" : "复制命令"}</span>
        </Button>
      </div>
      {!useApiKey && (
        <p className="text-[10px] text-amber-600">
          ⚠️ 当前显示的 --token 是浏览器 access_token（15 分钟过期），守护进程长期运行建议{" "}
          <a href="/settings/api-keys" className="underline">
            签发 API Key
          </a>{" "}
          后用 --api-key。
        </p>
      )}
    </div>
  );
}

/**
 * InstallDaemonBlock —— 「首次安装 daemon」折叠区块。
 *
 * 显示一键安装命令 `curl -fsSL <server>/daemon/install.sh | bash`，由 nginx 托管
 * 的 install.sh 执行（下载 ncc 单文件 bundle + 写 wrapper + 加 PATH）。
 *
 * serverUrl 从 window.location.origin 推导（:3001 前端 → :8001 后端/nginx），
 * 不硬编码 IP。用 mounted state 避免服务端/客户端 hydration 不一致。
 */
function InstallDaemonBlock() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    const frontendUrl = window.location.origin;
    // 前端 :3001 → 后端/nginx :8001，与 CopyDaemonCommand 的 serverUrl 推导一致。
    setServerUrl(frontendUrl.replace(/:3001$/, ":8001"));
  }, []);

  const cmd = serverUrl
    ? `curl -fsSL ${serverUrl}/daemon/install.sh | bash -s -- --server-url ${serverUrl}`
    : "";

  const handleCopy = async () => {
    if (!cmd) return;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">首次安装 daemon（新机器）</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <div className="flex min-w-0 items-center gap-2 border-t border-border/70 px-2.5 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 shadow-sm">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {cmd || "curl -fsSL <server>/daemon/install.sh | bash"}
            </code>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 px-2.5"
            onClick={handleCopy}
            disabled={!cmd}
            title={copied ? "已复制" : "复制安装命令"}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? "已复制" : "复制"}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  meta?: string;
  tone?: "neutral" | "online" | "warning" | "offline" | "disabled";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-700",
    online: "border-emerald-500 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    offline: "border-slate-200 bg-slate-50 text-slate-600",
    disabled: "border-rose-200 bg-rose-50 text-rose-700",
  }[tone];

  return (
    <div className={cn("flex min-h-[92px] items-center justify-between rounded-md border px-4 py-3", toneClass)}>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-none text-foreground">{value}</p>
        {meta && <p className="mt-1 truncate text-[11px] text-muted-foreground">{meta}</p>}
      </div>
      <Icon className="h-5 w-5 shrink-0 opacity-80" />
    </div>
  );
}

function formatRefreshTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}


function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {["a", "b", "c", "d"].map((key) => (
        <div key={key} className="min-h-[92px] animate-pulse rounded-md border bg-card p-4">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="mt-4 h-6 w-12 rounded bg-muted" />
          <div className="mt-3 h-3 w-28 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-md border border-dashed bg-card px-6 py-10">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Server className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-base font-semibold">尚未注册任何守护进程</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          启动本地守护进程后，平台会在这里以「机器」为单位展示每台主机及其承载的运行时（提供方、版本、心跳和可用代理）。runtime 上线后，进入 workspace 详情页可在「默认 Agent」下拉里选择本次启动的提供方。
        </p>
      </div>
      <div className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">启动入口</h2>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          守护进程是 Node.js/TypeScript 实现，需要 Node ≥ 20。如果之前装过 Python 旧版的 <code className="font-mono">sillyhub-daemon</code>（脚本目录里残留 <code className="font-mono">sillyhub-daemon.exe</code>），先用 <code className="font-mono">pip uninstall sillyhub-daemon</code> 卸载，否则会冲突报 <code className="font-mono">ModuleNotFoundError: No module named &#39;sillyhub_daemon.__main__&#39;</code>。
        </p>
        <ol className="mt-4 space-y-3 text-xs text-muted-foreground">
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">1.</span> cd sillyhub-daemon
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">2.</span> pnpm install &amp;&amp; pnpm build
            <span className="ml-2 block font-sans text-[10px] text-muted-foreground/80">没有 pnpm 时改用：npm install &amp;&amp; npx tsc</span>
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">3.</span> npm link
            <span className="ml-2 block font-sans text-[10px] text-muted-foreground/80">让本机 <code className="font-mono">sillyhub-daemon</code> 命令指向此项目；验证：<code className="font-mono">sillyhub-daemon --version</code></span>
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2">
            <span className="font-medium text-foreground">4.</span> 复制右上角守护进程启动命令，在本机终端运行
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-muted-foreground">
          详细说明见仓库 <code className="font-mono">sillyhub-daemon/README.md</code>。
        </p>
      </div>
    </section>
  );
}

export default function RuntimesPage() {
  // task-09：items/total/sessions 由 useDaemonMachines 管（机器级，D-005 完全替换平铺）。
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  // D-007：机器级分页，默认 20/页。
  const PAGE_SIZE = 20;
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<UserRead[]>([]);
  const [page, setPage] = useState(0);
  // task-09：别名编辑改机器级（aliasEditing 类型 DaemonMachineRead）。
  const [aliasEditing, setAliasEditing] = useState<DaemonMachineRead | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  // task-06 / FR-04 / D-006@v1：可写目录（allowed_roots 沙箱）编辑态（仍 runtime 级）。
  // rootsEditing：当前编辑的 runtime（null=关闭）；rootsValue：路径数组（每行一个）。
  const [rootsEditing, setRootsEditing] = useState<DaemonRuntimeRead | null>(null);
  const [rootsValue, setRootsValue] = useState<string[]>([]);
  const [rootsSaving, setRootsSaving] = useState(false);
  // ql-20260706-006：目录浏览器状态。browseRuntimeId=null 表示关闭。
  const [browseRuntimeId, setBrowseRuntimeId] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const browseTargetRef = useRef<number>(-1);
  // ql-20260706-006：树形目录浏览器状态。
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [treeSelectedPath, setTreeSelectedPath] = useState("");
  const [browseManualPath, setBrowseManualPath] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeActionId, setRuntimeActionId] = useState<string | null>(null);
  // task-09：daemon 升级中标记（机器卡按钮 loading，按 instance.id 记）。
  const [upgradeActionId, setUpgradeActionId] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  // task-04 / D-001：单例弹窗 runtime（null=关闭）。切换 runtime 即替换 dialogRuntime，
  // RuntimeSessionDialog 内部 key 随 runtime.id 重 mount 清旧状态。
  const [dialogRuntime, setDialogRuntime] = useState<DaemonRuntimeRead | null>(null);
  // task-04 / D-003：URL ?session= 恢复点，仅 URL 恢复时传入弹窗默认态 attach。
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  // task-09：展开态记忆（Set<machine.id>），切页/刷新不丢。
  const [expandedMachineIds, setExpandedMachineIds] = useState<Set<string>>(() => new Set());

  // task-14 / FR-04 / D-004@v1：用量统计页面级状态。
  // usageWindow:时间窗(默认 7d);usageByRuntime:按 runtime_id 聚合的用量 Map。
  // 非实时刷新(D-004@v1):仅进页面 + 切窗时调 getRuntimesUsage,不订阅 SSE、不轮询。
  const [usageWindow, setUsageWindow] = useState<RuntimeUsageWindow>("7d");
  const [usageByRuntime, setUsageByRuntime] = useState<Map<string, RuntimeUsageItem>>(new Map());
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // task-06 / FR-03 / D-003@v1 / D-007@v1：notify（操作类 toast，封装 errMessage）
  // 与 modal（antd Modal.confirm 二次确认，走 <AntApp> 主题实例）。
  const notify = useNotify();
  const { modal } = App.useApp();

  // task-04 / D-003：URL 恢复编排（从原 SessionListSection 上移到 page）
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlRestoreDoneRef = useRef(false);

  // task-04 / D-003：清 URL ?session= param（onClose 时序 C-3 + 降级共用）
  const clearSessionParam = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("session");
    const qs = next.toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    router.replace(target, { scroll: false });
  }, [router, searchParams]);

  // task-04 / D-003 C-3：用户主动关闭 = 放弃恢复点。先清 state（关弹窗触发 dialog
  // 内部 SSE/轮询 cleanup，FR-05 / R-02），再清 param（刷新不再自动弹出）。
  const handleCloseDialog = useCallback(() => {
    setDialogRuntime(null);
    setInitialSessionId(null);
    clearSessionParam();
  }, [clearSessionParam]);

  // task-09：机器级 listParams（q/status/provider/user_id/limit/offset），queryKey 经
  // hook 内部走 daemonMachines.list。
  const listParams = useMemo<DaemonMachineListParams>(
    () => ({
      q: query.trim() || undefined,
      status: statusFilter || undefined,
      provider: providerFilter || undefined,
      user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [query, statusFilter, providerFilter, ownerUserId, page, isPlatformAdmin],
  );
  const { items: machines, total, sessions, isLoading, error: listError, refetch } = useDaemonMachines(listParams);

  // 2026-07-04-daemon-version-management task-09：页面级拉 daemon 分发元数据
  //（最新版本号 + build_id），传给每个 MachineCard → RuntimeCard 做版本徽标比对。
  // staleTime 5min：版本不会频繁变；心跳 15s 轮询自带刷新。
  const { data: latestVersion } = useQuery<DaemonVersionInfo>({
    queryKey: queryKeys.daemonVersion.all,
    queryFn: getDaemonVersion,
    staleTime: 5 * 60 * 1000,
    refetchInterval: false,
    retry: false,
  });

  useEffect(() => {
    setError(listError ? (listError instanceof ApiError ? listError.message : "加载列表失败") : null);
  }, [listError]);
  // lastRefreshedAt：用 length 做 dep（避免 new Date() 无限 OOM 循环）。
  useEffect(() => {
    setLastRefreshedAt(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines?.length, total, sessions?.length]);

  // task-09：machines cache 形状（嵌套 runtimes + sessions），供 patchItems/patchRuntimeInMachines 用。
  type MachinesCache = { items: DaemonMachineRead[]; total: number; sessions: AgentSessionRead[] };

  /** 嵌套定位 runtime 并就地更新（runtime 级 handler 复用，patch machines cache 内层 runtime）。
   *  不变 machine 及其下其它 runtime（浅拷其它 runtime，保留嵌套引用稳定性）。 */
  const patchRuntimeInMachines = useCallback(
    (updater: (rt: DaemonRuntimeRead) => DaemonRuntimeRead, runtimeId: string) => {
      queryClient.setQueryData<MachinesCache>(queryKeys.daemonMachines.list(listParams), (old) => {
        if (!old) return old;
        const items = old.items.map((m) => {
          if (!m.runtimes.some((r) => r.id === runtimeId)) return m;
          return { ...m, runtimes: m.runtimes.map((r) => (r.id === runtimeId ? updater(r) : r)) };
        });
        return { ...old, items };
      });
    },
    [queryClient, listParams],
  );

  const patchSessions = useCallback(
    (updater: (prev: AgentSessionRead[]) => AgentSessionRead[]) => {
      queryClient.setQueryData<MachinesCache>(queryKeys.daemonMachines.list(listParams), (old) => ({
        items: old?.items ?? [],
        total: old?.total ?? 0,
        sessions: updater(old?.sessions ?? []),
      }));
    },
    [queryClient, listParams],
  );

  // reload：手动刷新/操作后调用，保留 500ms 最短时长 spinner 语义。
  const reload = useCallback(
    async (options: { showFeedback?: boolean } = {}) => {
      setError(null);
      const showFeedback = options.showFeedback ?? false;
      if (!showFeedback) { void refetch(); return; }
      setRefreshing(true);
      const startedAt = Date.now();
      try {
        await Promise.all([
          refetch(),
          new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt)))),
        ]);
      } finally {
        setRefreshing(false);
      }
    },
    [refetch],
  );

  const handleToggleRuntime = useCallback(async (runtime: DaemonRuntimeRead) => {
    setError(null);
    setRuntimeActionId(runtime.id);
    try {
      const updated = runtime.status === "disabled"
        ? await enableDaemonRuntime(runtime.id)
        : await disableDaemonRuntime(runtime.id);
      patchRuntimeInMachines((r) => (r.id === updated.id ? updated : r), updated.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "运行时状态操作失败");
    } finally {
      setRuntimeActionId(null);
    }
  }, [patchRuntimeInMachines]);

  // task-09：升级 daemon 改调机器级端点 triggerMachineSelfUpdate(instance.id)，按
  // instance 路由 WS，不再借道 runtime_id。invalidateQueries daemonMachines.all。
  const handleUpgrade = useCallback(
    async (machine: DaemonMachineRead) => {
      if (machine.status !== "online") return;
      setUpgradeActionId(machine.id);
      try {
        await triggerMachineSelfUpdate(machine.id);
        notify.success("升级指令已下发，daemon 重启后版本将自动更新");
        // 软刷新 machines + version：daemon 重启需要数秒，这里只触发 invalidate，
        // 实际新版本要等心跳/re-register（15s 轮询自然看到）。
        void queryClient.invalidateQueries({ queryKey: queryKeys.daemonMachines.all });
      } catch (err) {
        notify.error(err, "下发升级指令失败");
      } finally {
        setUpgradeActionId(null);
      }
    },
    [notify, queryClient],
  );

  // ql-012 / task-06 / FR-03 / D-003@v1 / D-007@v1：移除运行时（物理删除，级联清会话/lease）。
  // 二次确认改 antd Modal.confirm（走主题 + destructive 红按钮），替代浏览器原生 window.confirm。
  // 失败走 notify.error toast（409 后端中文 / network 中文兜底），成功补 notify.success。
  // runtime 级端点复用 deleteDaemonRuntime，patch 改在 machines cache 内嵌套移除该 runtime。
  const handleDeleteRuntime = useCallback(
    (runtime: DaemonRuntimeRead) => {
      modal.confirm({
        title: "移除运行时",
        content: `确定移除运行时「${runtime.name ?? runtime.provider}」？将同时清除该运行时下的会话与任务记录，且不可恢复。daemon 下次心跳会重新注册。`,
        okText: "移除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          setRuntimeActionId(runtime.id);
          try {
            await deleteDaemonRuntime(runtime.id);
            // 嵌套移除 runtime + 重算 runtime_count/online_runtime_count（保守降 1/视状态）。
            queryClient.setQueryData<MachinesCache>(queryKeys.daemonMachines.list(listParams), (old) => {
              if (!old) return old;
              const items = old.items.map((m) => {
                if (!m.runtimes.some((r) => r.id === runtime.id)) return m;
                const remaining = m.runtimes.filter((r) => r.id !== runtime.id);
                return {
                  ...m,
                  runtime_count: Math.max(0, m.runtime_count - 1),
                  online_runtime_count: Math.max(
                    0,
                    m.online_runtime_count - (runtime.status === "online" ? 1 : 0),
                  ),
                  runtimes: remaining,
                };
              });
              return { ...old, items };
            });
            patchSessions((prev) => prev.filter((s) => s.runtime_id !== runtime.id));
            if (dialogRuntime?.id === runtime.id) setDialogRuntime(null);
            notify.success("运行时已移除");
          } catch (err) {
            notify.error(err, "移除运行时失败");
          } finally {
            setRuntimeActionId(null);
          }
        },
      });
    },
    [dialogRuntime?.id, listParams, modal, notify, patchSessions, queryClient],
  );

  // task-04 / D-001：卡片「会话」→ 打开单例弹窗。
  const handleOpenSession = useCallback((runtime: DaemonRuntimeRead) => {
    setInitialSessionId(null);
    setDialogRuntime(runtime);
  }, []);

  // task-07 / FR-04：改筛选条件时重置到第一页，避免筛选后停在空页。
  const updateFilter = useCallback(
    <T,>(setter: (v: T) => void) => (v: T) => {
      setter(v);
      setPage(0);
    },
    [],
  );

  // task-09：切换机器展开态（add/delete expandedMachineIds）。
  const handleToggleExpand = useCallback((machineId: string) => {
    setExpandedMachineIds((prev) => {
      const next = new Set(prev);
      if (next.has(machineId)) next.delete(machineId);
      else next.add(machineId);
      return next;
    });
  }, []);

  // task-09：机器级别名编辑（modal 弹层，由 MachineCard onEditAlias 触发）。
  const handleOpenAlias = useCallback((machine: DaemonMachineRead) => {
    setAliasEditing(machine);
    setAliasValue(machine.display_alias ?? "");
  }, []);

  const handleSaveAlias = useCallback(async () => {
    if (!aliasEditing) return;
    setAliasSaving(true);
    try {
      const updated = await updateDaemonMachine(aliasEditing.id, {
        display_alias: aliasValue.trim() || null,
      });
      // patch machines cache：替换该 machine（保留其下 runtimes 嵌套引用，用 updated 整体替换）。
      queryClient.setQueryData<MachinesCache>(queryKeys.daemonMachines.list(listParams), (old) => {
        if (!old) return old;
        return { ...old, items: old.items.map((m) => (m.id === updated.id ? updated : m)) };
      });
      notify.success("别名已更新");
      setAliasEditing(null);
    } catch (err) {
      notify.error(err, "更新别名失败");
    } finally {
      setAliasSaving(false);
    }
  }, [aliasEditing, aliasValue, listParams, notify, queryClient]);

  // task-06 / FR-04 / D-006@v1：可写目录（allowed_roots 沙箱）编辑（runtime 级，端点不变）。
  // 复用 display_alias 模式：page 顶层 state + antd Modal + useNotify。
  const handleOpenAllowedRoots = useCallback((runtime: DaemonRuntimeRead) => {
    setRootsEditing(runtime);
    setRootsValue([...(runtime.allowed_roots ?? [])]);
  }, []);

  // ── 树形目录浏览器 ────────────────────────────────────────────────────────
  // ql-20260706-006：用 antd Tree 实现类似 Windows 资源管理器的目录树。

  /** 递归更新树数据（antd Tree loadData 模式需要）。 */
  const updateTreeData = useCallback((list: DataNode[], key: React.Key, children: DataNode[]): DataNode[] =>
    list.map((node) => {
      if (node.key === key) return { ...node, children };
      if (node.children) return { ...node, children: updateTreeData(node.children, key, children) };
      return node;
    }), []);

  const handleBrowseDir = useCallback(async (runtimeId: string, _path: string, idx: number) => {
    browseTargetRef.current = idx;
    setBrowseRuntimeId(runtimeId);
    setBrowseError(null);
    setTreeSelectedPath("");
    setBrowseManualPath("");
    // 初始化根节点：尝试 Windows 盘符（A:\~Z:\） + Unix 根 /。listDir 不存在的盘
    // 会抛错，catch 后自动排除。
    const drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\'];
    const initNodes: DataNode[] = [];
    for (const d of drives) {
      try {
        await listDir(runtimeId, d);
        initNodes.push({ title: d, key: d, isLeaf: false, icon: <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> });
      } catch { /* 盘不存在或不可达 */ }
    }
    setTreeData(initNodes);
    if (initNodes.length > 0 && initNodes[0]) {
      const first = initNodes[0].key as string;
      setTreeSelectedPath(first);
      setBrowseManualPath(first);
    }
  }, []);

  /** Tree loadData：展开节点时异步加载子目录列表。 */
  const handleLoadTreeData = useCallback(async (node: DataNode): Promise<void> => {
    if (!browseRuntimeId) return;
    const path = node.key as string;
    try {
      const resp = await listDir(browseRuntimeId, path);
      const children: DataNode[] = resp.entries
        .filter((e) => e.type === "dir")
        .map((e) => ({
          title: e.name,
          key: path.endsWith("\\") || path.endsWith("/") ? path + e.name : path + "\\" + e.name,
          isLeaf: false,
          icon: <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />,
        }));
      setTreeData((prev) => updateTreeData(prev, node.key, children));
    } catch {
      setTreeData((prev) => updateTreeData(prev, node.key, []));
    }
  }, [browseRuntimeId, updateTreeData]);

  /** 选中树节点时同步 selectedPath。 */
  const handleTreeSelect = useCallback((keys: React.Key[]) => {
    if (keys.length > 0) {
      const p = keys[0] as string;
      setTreeSelectedPath(p);
      setBrowseManualPath(p);
    }
  }, []);

  const handleSelectBrowseDir = useCallback(() => {
    const idx = browseTargetRef.current;
    const path = treeSelectedPath;
    if (idx >= 0 && path) {
      setRootsValue((prev) => prev.map((v, i) => (i === idx ? path : v)));
    }
    setBrowseRuntimeId(null);
    setBrowseError(null);
    setTreeData([]);
    setBrowseManualPath("");
  }, [treeSelectedPath]);

  /** 手动输入路径后跳转（直接填入选中，点确认即可使用）。 */
  const handleJumpToPath = useCallback(() => {
    const p = browseManualPath.trim();
    if (!p) return;
    setTreeSelectedPath(p);
  }, [browseManualPath]);

  /** ql-20260706-006：调系统原生文件夹选择对话框（daemon PowerShell FolderBrowserDialog）。 */
  const handleBrowseNative = useCallback(async (runtimeId: string, idx: number, currentPath?: string) => {
    setRuntimeActionId(runtimeId);
    try {
      const path = await browseFolder(runtimeId, currentPath);
      if (path) {
        setRootsValue((prev) => prev.map((v, i) => (i === idx ? path : v)));
      }
    } catch (err) {
      notify.error(err, "打开系统目录选择器失败");
    } finally {
      setRuntimeActionId(null);
    }
  }, [notify]);

  const handleSaveAllowedRoots = useCallback(async () => {
    if (!rootsEditing) return;
    // 去空白 + 去重（保留顺序），空数组=清空沙箱（daemon 回退任意目录）。
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of rootsValue) {
      const trimmed = raw.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
    setRootsSaving(true);
    try {
      const updated = await updateRuntimeAllowedRoots(rootsEditing.id, cleaned);
      patchRuntimeInMachines((r) => (r.id === updated.id ? updated : r), updated.id);
      notify.success("可写目录已更新");
      setRootsEditing(null);
    } catch (err) {
      notify.error(err, "更新可写目录失败");
    } finally {
      setRootsSaving(false);
    }
  }, [rootsEditing, rootsValue, notify, patchRuntimeInMachines]);

  // task-07 / D-003@v1：平台管理员人员搜索选项；失败降级为空（控件由 isPlatformAdmin 控制显隐）。
  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    listUsers({ limit: 50 })
      .then((resp) => {
        if (!cancelled) setUserOptions(resp.items);
      })
      .catch(() => {
        if (!cancelled) setUserOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin]);

  // task-14 / FR-04 / D-004@v1：拉取所有 runtime 的用量(进页面 + 切窗时触发,非实时)。
  // cancelled 守卫防竞态(快速切窗时旧请求 resolve 跳过 set,只采最新窗)。
  // 失败降级:usageByRuntime 清空(卡片显示空用量,不崩)、setUsageError 供顶部提示。
  const reloadUsage = useCallback((window: RuntimeUsageWindow) => {
    setUsageLoading(true);
    setUsageError(null);
    let cancelled = false;
    getRuntimesUsage(window)
      .then((resp) => {
        if (cancelled) return;
        // 按 runtime_id 聚合成 Map。
        const map = new Map<string, RuntimeUsageItem>();
        for (const item of resp.runtimes) map.set(item.runtime_id, item);
        setUsageByRuntime(map);
      })
      .catch((err) => {
        if (cancelled) return;
        setUsageByRuntime(new Map()); // 失败:空 Map,卡片 usage=undefined → 数字全「—」、sparkline「暂无数据」
        setUsageError(err instanceof ApiError ? err.message : "加载用量统计失败");
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return reloadUsage(usageWindow);
  }, [usageWindow, reloadUsage]);

  // task-09：所有 runtime 扁平化（跨机器），供 ?session 恢复 + RuntimeSessionDialog runtimes 用。
  const allRuntimes = useMemo(
    () => machines.flatMap((m) => m.runtimes),
    [machines],
  );

  // task-04 / FR-06 / D-003：mount 读 ?session=<id> → 查 status，活跃 → 开对应 runtime
  // 弹窗（initialSessionId 接弹窗默认态 attach）；ended/failed/不存在/已删 → 清 param
  // 降级不开。urlRestoreDoneRef 保证只执行一次。
  // task-09：matched 从 machines.flatMap(m=>m.runtimes) 查找，命中则展开所属 machine。
  useEffect(() => {
    if (urlRestoreDoneRef.current) return;
    const sessionId = searchParams.get("session");
    if (!sessionId) return;
    // 等 machines 加载完成（首屏 loading 期内不处理 URL 恢复）
    if (isLoading) return;
    urlRestoreDoneRef.current = true;
    void (async () => {
      let session: AgentSessionRead | null =
        sessions.find((s) => s.id === sessionId) ?? null;
      if (!session) {
        try {
          session = await getAgentSession(sessionId);
        } catch {
          session = null;
        }
      }
      if (session && isActiveSession(session)) {
        const matched = allRuntimes.find((r) => r.id === session!.runtime_id) ?? null;
        if (matched) {
          // task-09：找到所属 machine 并展开，再开弹窗。
          const ownerMachine = machines.find((m) =>
            m.runtimes.some((r) => r.id === matched.id),
          );
          if (ownerMachine) {
            setExpandedMachineIds((prev) => {
              const next = new Set(prev);
              next.add(ownerMachine.id);
              return next;
            });
          }
          setInitialSessionId(session.id);
          setDialogRuntime(matched);
        } else {
          // runtime 已离线/删除 → 降级清 param（R-03 兜底）
          clearSessionParam();
        }
      } else {
        // ended / failed / 不存在 → 降级清 param
        clearSessionParam();
      }
    })();
  }, [searchParams, allRuntimes, machines, sessions, isLoading, clearSessionParam]);

  // task-09：机器级 stats（按 machine.status 统计；providers 从 runtimes flatMap 收集；
  // latestHeartbeat 取 machine.last_heartbeat_at 最新）。
  const stats = useMemo(() => {
    const list = machines ?? [];
    const online = list.filter((m) => m.status === "online").length;
    const maintenance = list.filter((m) => m.status === "maintenance").length;
    const disabled = list.filter((m) => m.status === "disabled").length;
    const offline = list.filter((m) => m.status === "offline").length;
    const providers = new Set(
      list.flatMap((m) => m.runtimes.map((r) => r.provider).filter(Boolean)),
    );
    const latestHeartbeat = list
      .map((m) => m.last_heartbeat_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    return {
      total: list.length,
      online,
      maintenance,
      disabled,
      offline,
      providers: providers.size,
      latestHeartbeat: latestHeartbeat ? formatRelativeTime(latestHeartbeat) : "无心跳",
    };
  }, [machines]);

  // ql-012：按 runtime_id 聚合会话数（卡片展示），传入 MachineCard。
  const sessionStatsByRuntime = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const s of sessions) {
      if (!s.runtime_id) continue;
      const cur = map.get(s.runtime_id) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (isActiveSession(s)) cur.active += 1;
      map.set(s.runtime_id, cur);
    }
    return map;
  }, [sessions]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">系统</p>
          <h1 className="mt-1">守护进程运行时</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            以机器为单位展示守护进程主机及其承载的运行时、心跳状态和快速会话控制台。
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 lg:max-w-xl">
          <InstallDaemonBlock />
          <CopyDaemonCommand compact />
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {machines.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard label="机器总数" value={String(stats.total)} icon={Server} meta={`${stats.providers} 个提供方`} />
              <SummaryCard label="在线" value={String(stats.online)} icon={CheckCircle2} tone="online" meta={stats.latestHeartbeat} />
              <SummaryCard label="维护中" value={String(stats.maintenance)} icon={Wrench} tone="warning" />
              <SummaryCard label="禁用" value={String(stats.disabled)} icon={Ban} tone="disabled" />
              <SummaryCard label="离线" value={String(stats.offline)} icon={WifiOff} tone="offline" />
            </div>
          )}

          <div className="space-y-5">
            {machines.length === 0 ? (
              <EmptyState />
            ) : (
              <section className="min-w-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold">机器列表</h2>
                      <span className="text-[11px] text-muted-foreground">
                        {stats.online} 台在线 / {stats.total} 台机器
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {lastRefreshedAt ? `上次刷新：${formatRefreshTime(lastRefreshedAt)}` : "等待刷新"}
                    </p>
                  </div>
                  {/*
                    task-14 / FR-04：时间窗切换器(3 tab)。切窗触发页面级 usageWindow 变化 →
                    useEffect 重发 getRuntimesUsage(新窗) → 所有卡片用量区同步刷新。
                  */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5 rounded-md border border-slate-300 bg-white p-0.5">
                      {(Object.keys(WINDOW_LABELS) as RuntimeUsageWindow[]).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setUsageWindow(w)}
                          aria-label={`切换用量统计时间窗为${WINDOW_LABELS[w]}`}
                          title={`切换用量统计时间窗为${WINDOW_LABELS[w]}`}
                          className={cn(
                            "rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                            usageWindow === w
                              ? "bg-blue-600 text-white"
                              : "text-slate-500 hover:text-slate-700",
                          )}
                        >
                          {WINDOW_LABELS[w]}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void reload({ showFeedback: true })}
                      disabled={refreshing}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                      {refreshing ? "刷新中" : "刷新"}
                    </Button>
                  </div>
                </div>
                {usageError && (
                  <p className="text-[11px] text-amber-600">
                    用量统计加载失败：{usageError}（卡片用量区显示空）
                  </p>
                )}
                {/* task-09：机器级筛选条（搜索 hostname/display_alias/provider + 状态 + 提供方 + 人员）。 */}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="搜索资源"
                    placeholder="搜索主机名/别名/提供方"
                    value={query}
                    onChange={(e) => updateFilter(setQuery)(e.target.value)}
                    className="h-8 min-w-[12rem] flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 placeholder:text-slate-400"
                  />
                  <select
                    aria-label="筛选提供方"
                    value={providerFilter}
                    onChange={(e) => updateFilter(setProviderFilter)(e.target.value)}
                    className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
                  >
                    <option value="">全部提供方</option>
                    {Object.entries(PROVIDER_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="筛选状态"
                    value={statusFilter}
                    onChange={(e) => updateFilter(setStatusFilter)(e.target.value)}
                    className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
                  >
                    <option value="">全部状态</option>
                    <option value="online">在线</option>
                    <option value="maintenance">维护中</option>
                    <option value="offline">离线</option>
                    <option value="disabled">禁用</option>
                  </select>
                  {isPlatformAdmin ? (
                    <select
                      aria-label="筛选人员"
                      value={ownerUserId ?? ""}
                      onChange={(e) => updateFilter(setOwnerUserId)(e.target.value || null)}
                      className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
                    >
                      <option value="">全部人员</option>
                      {userOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name ?? u.email ?? u.username}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <div
                  data-testid="runtime-list-scroll"
                  className="space-y-4 pr-1"
                >
                  {machines.map((machine) => (
                    <MachineCard
                      key={machine.id}
                      machine={machine}
                      expanded={expandedMachineIds.has(machine.id)}
                      onToggleExpand={() => handleToggleExpand(machine.id)}
                      usageByRuntime={usageByRuntime}
                      usageWindow={usageWindow}
                      usageLoading={usageLoading}
                      latestVersion={latestVersion}
                      upgrading={upgradeActionId === machine.id}
                      actioning={
                        // 该机器下任一 runtime 正在操作 → 全机器卡 RuntimeCard 都 loading（保守粗粒度）。
                        machine.runtimes.some((r) => runtimeActionId === r.id)
                      }
                      sessions={sessions}
                      isPlatformAdmin={isPlatformAdmin}
                      onEditAlias={handleOpenAlias}
                      onUpgrade={handleUpgrade}
                      onRuntimeToggle={handleToggleRuntime}
                      onRuntimeOpenSession={handleOpenSession}
                      onRuntimeDelete={handleDeleteRuntime}
                      onRuntimeEditAlias={(rt) => {
                        // task-09：runtime 卡内无别名按钮（别名上提机器），保留契约兜底。
                        // runtime 别名即 display_alias 仍是 runtime 字段，但 UI 已上提机器卡。
                        // 这里转译为：找到所属 machine 触发机器别名 modal。
                        const owner = machines.find((m) => m.runtimes.some((r) => r.id === rt.id));
                        if (owner) handleOpenAlias(owner);
                      }}
                      onRuntimeEditRoots={handleOpenAllowedRoots}
                    />
                  ))}
                  {/* task-07 / FR-04：机器级分页器（D-007，PAGE_SIZE=20）。 */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-muted-foreground">
                      共 {total} 台机器 · 第 {page + 1} 页
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        aria-label="上一页"
                      >
                        上一页
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={(page + 1) * PAGE_SIZE >= total}
                        onClick={() => setPage((p) => p + 1)}
                        aria-label="下一页"
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <RuntimeSessionDialog
        key={dialogRuntime?.id ?? "closed"}
        runtime={dialogRuntime}
        open={dialogRuntime !== null}
        onClose={handleCloseDialog}
        runtimes={allRuntimes}
        initialSessionId={initialSessionId ?? undefined}
      />

      {/* task-09：机器别名编辑 modal（MachineCard onEditAlias 触发，改调 updateDaemonMachine）。 */}
      <Modal
        title="编辑展示别名"
        open={aliasEditing !== null}
        onOk={handleSaveAlias}
        onCancel={() => setAliasEditing(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSaving}
        okButtonProps={{ disabled: aliasSaving }}
        destroyOnClose
      >
        <Input
          value={aliasValue}
          onChange={(e) => setAliasValue(e.target.value)}
          placeholder="留空清除别名，回退原始主机名"
          maxLength={200}
          onPressEnter={handleSaveAlias}
          aria-label="别名输入"
        />
        {aliasEditing?.hostname ? (
          <p className="mt-2 text-xs text-muted-foreground">原始主机名：{aliasEditing.hostname}</p>
        ) : null}
      </Modal>

      {/* task-06 / FR-04 / D-006@v1：可写目录（allowed_roots 沙箱）编辑 modal（runtime 级，端点不变）。
          每个路径一行 Input + 删除按钮 + 底部添加按钮。
          daemon 仅允许在此白名单内 list_dir / 创建 workspace（D-002@v1 越界 403）。
          清空全部路径 = 回退任意目录可访问（提示已说明）。 */}
      <Modal
        title="配置可写目录"
        open={rootsEditing !== null}
        onOk={handleSaveAllowedRoots}
        onCancel={() => setRootsEditing(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={rootsSaving}
        okButtonProps={{ disabled: rootsSaving }}
        destroyOnClose
        width={560}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          配置该运行时（daemon）允许写入的根目录白名单。读取不受限，仅在白名单内的目录可创建/修改文件，越界写入将被拒绝。清空全部路径则回退为「任意目录可写」。
        </p>
        <div className="space-y-2">
          {rootsValue.map((path, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={path}
                onChange={(e) =>
                  setRootsValue((prev) =>
                    prev.map((v, i) => (i === idx ? e.target.value : v)),
                  )
                }
                placeholder="例如 ~/.sillyhub 或 F:/WorkNew/SillyHub"
                aria-label={`可写目录路径 ${idx + 1}`}
                onPressEnter={handleSaveAllowedRoots}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1"
                onClick={() => rootsEditing && handleBrowseNative(rootsEditing.id, idx, path)}
                disabled={runtimeActionId === rootsEditing?.id}
                title="打开系统文件夹选择对话框"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                浏览
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setRootsValue((prev) => prev.filter((_, i) => i !== idx))
                }
                title="删除该路径"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </Button>
            </div>
          ))}
          {rootsValue.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              当前未配置任何可写目录，daemon 可写任意路径
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5"
          onClick={() => setRootsValue((prev) => [...prev, ""])}
          title="添加一个路径"
        >
          <Plus className="h-3.5 w-3.5" />
          添加路径
        </Button>
      </Modal>

      {/* ql-20260706-006：目录浏览器 modal（基于 daemon list_dir 遍历子目录）。 */}
      <Modal
        title="选择目录"
        open={browseRuntimeId !== null}
        onOk={handleSelectBrowseDir}
        onCancel={() => { setBrowseRuntimeId(null); setBrowseError(null); }}
        okText="选择此目录"
        cancelText="取消"
        destroyOnClose
        width={560}
      >
        {/* 地址栏：可手动输入路径 */}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={browseManualPath}
              onChange={(e) => setBrowseManualPath(e.target.value)}
              onPressEnter={handleJumpToPath}
              placeholder="输入路径直接跳转，如 D:/ 或 C:/Users"
              size="small"
              className="pr-8"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleJumpToPath} className="h-7 shrink-0">
            跳转
          </Button>
        </div>
        {browseError ? (
          <div className="mb-2 px-2 py-1.5 text-xs text-destructive rounded border border-destructive/30 bg-destructive/5">
            {browseError}
          </div>
        ) : null}
        {treeData.length === 0 && !browseError ? (
          <div className="flex justify-center py-8">
            <Spin size="small" />
          </div>
        ) : (
          <div className="overflow-auto rounded border" style={{ maxHeight: 300 }}>
            <Tree
              treeData={treeData}
              loadData={handleLoadTreeData}
              onSelect={handleTreeSelect}
              selectedKeys={treeSelectedPath ? [treeSelectedPath] : []}
              showIcon
              blockNode
              height={300}
              defaultExpandedKeys={treeData.length > 0 ? [treeData[0]?.key as string] : []}
            />
          </div>
        )}
        {treeSelectedPath ? (
          <div className="mt-2 flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs font-mono">
            <span className="text-muted-foreground shrink-0">已选路径：</span>
            <code className="truncate">{treeSelectedPath}</code>
          </div>
        ) : (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            在目录树中选择一个文件夹，或在上方输入路径后点「跳转」
          </div>
        )}
      </Modal>
    </main>
  );
}
