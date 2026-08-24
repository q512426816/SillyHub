"use client";

/**
 * FloatingSessionHost — 全局悬浮会话宿主（2026-08-25-unified-floating-session
 * task-05 / FR-1~4 / D-001/003/004）。
 *
 * 一个内核 · N 宿主：本组件是 SessionPanel(mode="page") 的第三个消费方
 * （另两个：SessionsPortal 三入口；先例 /runtimes 弹窗为 dialog 形态）。
 * 挂载于 (dashboard)/layout.tsx（AppShell 内），跨页面常驻。
 *
 * 三条硬约束（design §2/§6）：
 *   1. 互斥协议：pathname 命中门户三路由（/sessions、/workspaces/:id/sessions、
 *      /workspaces/:id/changes/:cid/sessions）→ 整体不渲染（卸载球+抽屉，防
 *      同会话双 SSE/双队列 409）；进门时 closeDrawer() 落壳态（有会话→保活
 *      最小化，离开门户由球恢复）。
 *   2. 最小化保活：抽屉容器 translate + visibility 隐藏而非卸载——SessionPanel
 *      的 SSE/消息队列/运行中任务全程保活（R6：会话态 100% 组件内部）。
 *   3. 挂载门控：open||minimized||sessionId 才挂载抽屉主体（含 machines/
 *      providers/列表查询）——关闭且无会话时全站零后台查询（降载 v1 策略）。
 *
 * 壳层状态全部来自 stores/floating-session（D-002：壳态与 R6 边界见该文件头）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  X,
} from "lucide-react";

import {
  SessionPanel,
  type SessionPreContext,
} from "@/components/daemon/session-panel";
import { PreSessionPicker } from "@/components/sessions/pre-session-picker";
import { resolveDefaultMachineId } from "@/components/sessions/sessions-portal";
import {
  listAgentSessions,
  type AgentSessionRead,
  type DaemonMachineRead,
  type SessionCreateResponse,
} from "@/lib/daemon";
import { listProviders } from "@/lib/api/llm-providers";
import type { LlmProviderRead } from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { usePageSessionContext } from "@/hooks/use-page-session-context";
import { useFloatingSessionStore } from "@/stores/floating-session";
import { cn } from "@/lib/utils";

/** 门户三路由（互斥；离开即恢复悬浮层）。 */
const PORTAL_ROUTE_RE =
  /^\/sessions(\/|$)|^\/workspaces\/[^/]+\/sessions(\/|$)|^\/workspaces\/[^/]+\/changes\/[^/]+\/sessions(\/|$)/;

/**
 * 抽屉主体（数据查询 + SessionPanel）——仅 mounted 时渲染（门控约束 3）。
 * 拆出为子组件：查询 hooks 不能在条件分支内调用。
 */
function FloatingDrawerBody({
  onPreSessionCreated,
}: {
  onPreSessionCreated: (resp: SessionCreateResponse) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const sessionId = useFloatingSessionStore((s) => s.sessionId);
  const preContext = useFloatingSessionStore((s) => s.preContext);
  const pageContext = useFloatingSessionStore((s) => s.pageContext);
  const selectSession = useFloatingSessionStore((s) => s.selectSession);
  const closeDrawer = useFloatingSessionStore((s) => s.closeDrawer);
  const minimize = useFloatingSessionStore((s) => s.minimize);
  const startPreSession = useFloatingSessionStore((s) => s.startPreSession);
  const { label: pageLabel } = usePageSessionContext();

  // 页面级数据（与门户同源）：machines 15s 轮询（SessionPanel 离线判定 +
  // 默认机器解析）；providers 30s（CtxUsageBar 分母）。
  const { items: machines, sessions, isLoading: machinesLoading } =
    useDaemonMachines({ limit: 100 });
  const providersQ = useQuery({
    queryKey: ["llmProviders", "floating-session"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers: LlmProviderRead[] = useMemo(
    () => providersQ.data ?? [],
    [providersQ.data],
  );

  // 紧凑最近会话列表（最近 10 条活跃会话，last_active_at 优先）。
  const recentQ = useQuery({
    queryKey: ["agentSessions", "floating-recent"],
    queryFn: () => listAgentSessions({ limit: 10, archived: false }),
    refetchInterval: 30_000,
  });
  const recent: AgentSessionRead[] = useMemo(() => {
    const items = recentQ.data?.items ?? [];
    return [...items].sort(
      (a, b) =>
        Date.parse(b.last_active_at ?? b.created_at ?? "0") -
        Date.parse(a.last_active_at ?? a.created_at ?? "0"),
    );
  }, [recentQ.data]);

  const refreshLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["agentSessions"] });
  }, [qc]);

  // 新会话：D-005 三级回退解析默认机器（默认 Claude），未命中弹两步浮层兜底。
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleNewSession = useCallback(() => {
    const machineId = resolveDefaultMachineId(machines, sessions);
    const runtimes = (
      machines.find((m) => m.id === machineId)?.runtimes ?? []
    ).filter(
      (r) =>
        r.status === "online" &&
        (r.provider === "claude" || r.provider === "codex"),
    );
    const runtime = runtimes.find((r) => r.provider === "claude") ?? runtimes[0];
    if (runtime) {
      startPreSession(
        { runtimeId: runtime.id, workspaceId: null },
        pageContext,
      );
    } else {
      setPickerOpen(true);
    }
  }, [machines, sessions, startPreSession, pageContext]);

  const handlePreSessionCreated = useCallback(
    (resp: SessionCreateResponse) => {
      onPreSessionCreated(resp);
      refreshLists();
    },
    [onPreSessionCreated, refreshLists],
  );

  // 页面入口一键唤起（task-07）：requestNewSession 挂起 → 机器数据就绪后
  // 自动解析默认机器进预会话（未命中弹两步浮层兜底，pageContext 已在壳态）。
  const autoNewPending = useFloatingSessionStore((s) => s.autoNewPending);
  const clearAutoNew = useFloatingSessionStore((s) => s.clearAutoNew);
  useEffect(() => {
    if (!autoNewPending || machinesLoading) return;
    clearAutoNew();
    handleNewSession();
  }, [autoNewPending, machinesLoading, clearAutoNew, handleNewSession]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：标题 + 上下文条 + 动作 */}
      <div className="border-b border-border-weak px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-info text-white shadow-primary"
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            智能会话助手
          </span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
            悬浮模式
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              title="去 /sessions 全屏门户（与悬浮互斥，抽屉自动收起）"
              onClick={() => router.push("/sessions")}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              全屏
            </button>
            <button
              type="button"
              title="最小化（会话保持运行，连接不断）"
              onClick={minimize}
              data-testid="floating-minimize"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              最小化
            </button>
            <button
              type="button"
              title="关闭（无运行会话时释放，有会话转为保活最小化）"
              onClick={closeDrawer}
              data-testid="floating-close"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* 上下文条：显式入口携带的页面上下文 > pathname 页面标签 > 降级文案 */}
        <div
          data-testid="floating-ctx-bar"
          className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 px-3 py-1.5"
        >
          <span className="text-[11px] text-muted-foreground">已感知页面</span>
          <span className="text-xs font-semibold text-brand-700">
            {pageContext ? "PPM · 项目详情" : (pageLabel ?? "未注册页面上下文")}
          </span>
          {pageContext && (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
              项目上下文将随首句注入（仅 AI 可见）
            </span>
          )}
        </div>
      </div>

      {/* 主体：紧凑列表 + 面板 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-border-weak lg:flex">
          <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-muted-foreground/70">
            最近会话
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="floating-session-list">
            {recent.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSession(s.id)}
                title={s.title?.trim() || "未命名会话"}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  sessionId === s.id
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : "text-muted-foreground hover:bg-brand-50/60 hover:text-brand-700",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 flex-none rounded-full",
                    s.status === "active" ? "bg-brand-600" : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate">
                  {s.title?.trim() || "未命名会话"}
                </span>
              </button>
            ))}
            {recent.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground/60">
                暂无会话
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            data-testid="floating-new-session"
            className="mx-3 mb-3 h-8 rounded-md border border-dashed border-brand-300 bg-brand-50/60 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            ＋ 新会话
          </button>
        </aside>

        <div className="min-h-0 min-w-0">
          {sessionId ? (
            <SessionPanel
              key={sessionId}
              mode="page"
              sessionId={sessionId}
              machines={machines as DaemonMachineRead[]}
              llmProviders={providers}
              onSessionListRefresh={refreshLists}
            />
          ) : preContext ? (
            <SessionPanel
              key={`pre:${preContext.workspaceId ?? "-"}:${preContext.runtimeId}`}
              mode="page"
              sessionId={null}
              machines={machines as DaemonMachineRead[]}
              llmProviders={providers}
              preContext={preContext as SessionPreContext}
              onPreSessionCreated={handlePreSessionCreated}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-sm font-semibold text-foreground">
                开始新会话
              </span>
              <p className="max-w-[300px] text-xs leading-5 text-muted-foreground">
                点左下「＋ 新会话」选择机器与智能体，发送第一句话即创建；
                也可以从最近列表继续一个会话。当前页面的上下文会自动带给
                AI（如适用）。
              </p>
              <button
                type="button"
                onClick={handleNewSession}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-700"
              >
                <Plus className="h-3.5 w-3.5" />
                新会话
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 机器兜底两步浮层（复用门户组件；fixed 全屏遮罩，v1 接受） */}
      <PreSessionPicker
        open={pickerOpen}
        machines={machines as DaemonMachineRead[]}
        onCancel={() => setPickerOpen(false)}
        onPick={(runtimeId) => {
          startPreSession({ runtimeId, workspaceId: null }, pageContext);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/** 悬浮宿主：球 + 最小化胶囊 + 抽屉 + 互斥门控。 */
export function FloatingSessionHost() {
  const pathname = usePathname();
  const open = useFloatingSessionStore((s) => s.open);
  const minimized = useFloatingSessionStore((s) => s.minimized);
  const sessionId = useFloatingSessionStore((s) => s.sessionId);
  const openDrawer = useFloatingSessionStore((s) => s.openDrawer);
  const restore = useFloatingSessionStore((s) => s.restore);
  const closeDrawer = useFloatingSessionStore((s) => s.closeDrawer);
  const preSessionCreated = useFloatingSessionStore(
    (s) => s.preSessionCreated,
  );

  const onPortal = PORTAL_ROUTE_RE.test(pathname ?? "");

  // 互斥协议（约束 1）：进门户落壳态（有会话→保活最小化；无→全清）。
  // 渲染层由下方 onPortal return null 卸载球+抽屉（同会话永不双挂载）。
  useEffect(() => {
    if (onPortal) {
      const s = useFloatingSessionStore.getState();
      if (s.open) s.closeDrawer();
    }
  }, [onPortal]);

  const handlePreSessionCreated = useCallback(
    (resp: SessionCreateResponse) => preSessionCreated(resp.session_id),
    [preSessionCreated],
  );

  if (onPortal) return null;

  // 挂载门控（约束 3）：全关且无会话 → 只渲染球，抽屉主体不挂载。
  const mounted = open || minimized || Boolean(sessionId);

  return (
    <>
      {/* 最小化保活胶囊（球上方分层，避开右下角待答审批胶囊语义区） */}
      {minimized && (
        <button
          type="button"
          data-testid="floating-capsule"
          onClick={restore}
          title="恢复悬浮会话（现场保留，连接未断）"
          className="fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-card px-4 py-1.5 text-xs font-semibold text-brand-700 shadow-md transition-transform hover:-translate-y-0.5"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
          会话进行中 · 点击恢复
        </button>
      )}

      {/* 悬浮球 */}
      <button
        type="button"
        data-testid="floating-ball"
        aria-label={minimized ? "恢复悬浮会话" : "打开悬浮会话助手"}
        title="智能会话助手"
        onClick={() => {
          if (open) closeDrawer();
          else if (minimized) restore();
          else openDrawer();
        }}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-info text-white shadow-primary transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <MessageSquare className="h-5 w-5" />
        {(sessionId !== null || minimized) && (
          <span
            aria-hidden
            data-testid="floating-ball-badge"
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card bg-info"
          />
        )}
      </button>

      {/* 抽屉（约束 2：最小化 hidden 保挂载，SSE/队列不断） */}
      {mounted && (
        <div
          role="dialog"
          aria-label="悬浮会话抽屉"
          data-testid="floating-drawer"
          data-open={open ? "true" : "false"}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-[min(720px,94vw)] flex-col border-l border-border bg-card shadow-lg transition-transform duration-300",
            open ? "translate-x-0" : "translate-x-full",
          )}
          style={open ? undefined : { visibility: "hidden" }}
        >
          <FloatingDrawerBody onPreSessionCreated={handlePreSessionCreated} />
        </div>
      )}
    </>
  );
}
