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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  X,
} from "lucide-react";

import { SessionPanel } from "@/components/daemon/session-panel";
import { PreSessionPicker } from "@/components/sessions/pre-session-picker";
// FR-02/FR-03：抽屉左栏由紧凑列表换成 /sessions 同款工作区树。
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import { resolveDefaultMachineId } from "@/components/sessions/sessions-portal";
import {
  type SessionCreateResponse,
} from "@/lib/daemon";
import { listProviders } from "@/lib/api/llm-providers";
import type { LlmProviderRead } from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { usePageSessionContext } from "@/hooks/use-page-session-context";
import {
  FloatingMascot,
  getFloatingPet,
  setFloatingPet,
  type FloatingPet,
} from "@/components/floating/floating-mascot";
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
  onPreSessionCreated: (_resp: SessionCreateResponse) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const sessionId = useFloatingSessionStore((s) => s.sessionId);
  const preContext = useFloatingSessionStore((s) => s.preContext);
  const pageContext = useFloatingSessionStore((s) => s.pageContext);
  const lockedRuntime = useFloatingSessionStore((s) => s.lockedRuntime);
  const selectSession = useFloatingSessionStore((s) => s.selectSession);
  const closeDrawer = useFloatingSessionStore((s) => s.closeDrawer);
  const minimize = useFloatingSessionStore((s) => s.minimize);
  const startPreSession = useFloatingSessionStore((s) => s.startPreSession);
  // task-09：URL 派生通用页面上下文（generic_page/route_key）——显式入口
  // （store.pageContext，如 PPM 项目块）优先，派生值兜底；均空则不上送。
  const { pageContext: derivedPageCtx, label: derivedLabel } =
    usePageSessionContext();
  const effectivePageCtx = pageContext ?? derivedPageCtx;

  // 页面级数据（与门户同源）：machines 15s 轮询（SessionPanel 离线判定 +
  // 默认机器解析）；providers 30s（CtxUsageBar 分母）。
  // task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2）：机器候选 =
  // 自有 + 共享给我的（hook 融合，共享条目带 sharedMeta + 显示名「共享」标注）。
  const {
    items: machines,
    machineCandidates,
    sessions,
    isLoading: machinesLoading,
  } = useDaemonMachines({ limit: 100 });
  // 仅机器选择器/Picker 与 SessionPanel 展示消费融合候选；下方 D-005 三级回退
  // 解析（handleNewSession）仍用自有 machines——D-004@v2 用户显式选择，共享
  // 机器不做任何自动回退/默认选中。
  const machineOptions = machineCandidates ?? machines;
  const providersQ = useQuery({
    queryKey: ["llmProviders", "floating-session"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers: LlmProviderRead[] = useMemo(
    () => providersQ.data ?? [],
    [providersQ.data],
  );

  const refreshLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["agentSessions"] });
  }, [qc]);

  // 新会话：D-005 三级回退解析默认机器（默认 Claude），未命中弹两步浮层兜底。
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleNewSession = useCallback(() => {
    // FR-02：lockedRuntime 时钉死该 runtime，不弹 PreSessionPicker 两步浮层。
    if (lockedRuntime) {
      startPreSession(
        { runtimeId: lockedRuntime.id, workspaceId: null },
        effectivePageCtx,
      );
      return;
    }
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
        effectivePageCtx,
      );
    } else {
      setPickerOpen(true);
    }
  }, [lockedRuntime, machines, sessions, startPreSession, effectivePageCtx]);

  const handlePreSessionCreated = useCallback(
    (resp: SessionCreateResponse) => {
      onPreSessionCreated(resp);
      refreshLists();
    },
    [onPreSessionCreated, refreshLists],
  );

  // ── 左栏工作区树操作对齐全屏门户（用户反馈⑤：抽屉里会话新增操作没了）────
  // ca3a83ad 起左栏复用 SessionListPanel，但未接 onNewInGroup → 组头「＋」
  // 新建入口失效（选中会话后无任何新建路径）。此处按门户 handleNewInGroup
  // 同语义接线：筛选两层齐备直进预会话（携带页面上下文），否则两步浮层兜底
  // （pickerWorkspaceId 传组上下文，对齐门户 picker 语义）。
  const [pickerWorkspaceId, setPickerWorkspaceId] = useState<string | null>(null);
  const handleNewInGroup = useCallback(
    (workspaceId: string | null, filter?: { machineId: string; agent: string }) => {
      if (lockedRuntime) return; // runtime 锁定 scope 组头新建禁用（同 ca3a83ad 语义）
      if (filter?.machineId && filter.agent) {
        const machine = machines.find((m) => m.id === filter.machineId);
        const runtime = machine?.runtimes?.find(
          (r) => r.status === "online" && r.provider === filter.agent,
        );
        if (runtime) {
          startPreSession({ workspaceId, runtimeId: runtime.id }, effectivePageCtx);
          return;
        }
      }
      setPickerWorkspaceId(workspaceId);
      setPickerOpen(true);
    },
    [lockedRuntime, machines, startPreSession, effectivePageCtx],
  );

  /** 批量删除/归档/取消归档（门户同款：逐条调用 + invalidate + 选中被删则清）。 */
  const handleDeleteSessions = useCallback(
    async (ids: string[]) => {
      const { deleteAgentSession } = await import("@/lib/daemon");
      await Promise.allSettled(ids.map((id) => deleteAgentSession(id)));
      refreshLists();
      if (ids.includes(sessionId ?? "")) selectSession(null);
    },
    [refreshLists, sessionId, selectSession],
  );
  const handleArchiveSessions = useCallback(
    async (ids: string[]) => {
      const { archiveAgentSession } = await import("@/lib/daemon");
      await Promise.allSettled(ids.map((id) => archiveAgentSession(id)));
      refreshLists();
      if (ids.includes(sessionId ?? "")) selectSession(null);
    },
    [refreshLists, sessionId, selectSession],
  );
  const handleUnarchiveSessions = useCallback(
    async (ids: string[]) => {
      const { unarchiveAgentSession } = await import("@/lib/daemon");
      await Promise.allSettled(ids.map((id) => unarchiveAgentSession(id)));
      refreshLists();
      if (ids.includes(sessionId ?? "")) selectSession(null);
    },
    [refreshLists, sessionId, selectSession],
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
          {/* FR-01：runtime 锁定态——从 /runtimes 入口唤起时显示锁定徽标。 */}
          {lockedRuntime && (
            <span
              data-testid="floating-lock-badge"
              className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning"
              title={`锁定到 ${lockedRuntime.machineLabel} · ${lockedRuntime.providerLabel}`}
            >
              🔒 {lockedRuntime.machineLabel} · {lockedRuntime.providerLabel}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              title="去 /sessions 全屏门户（当前会话经 ?session= 深链直接打开）"
              data-testid="floating-fullscreen"
              // task-10（用户实测反馈：全屏后要重新找会话）：门户 ?session=
              // 深链直达当前会话（sessions-portal.tsx 深链恢复契约）；无选中
              // 会话（预会话/空态）落空门户由用户自选。
              onClick={() =>
                router.push(
                  sessionId ? `/sessions?session=${encodeURIComponent(sessionId)}` : "/sessions",
                )
              }
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
        {/* 上下文条：显式入口上下文（PPM 项目）> URL 派生页面 > 降级文案 */}
        <div
          data-testid="floating-ctx-bar"
          className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 px-3 py-1.5"
        >
          <span className="text-[11px] text-muted-foreground">已感知页面</span>
          <span className="text-xs font-semibold text-brand-700">
            {derivedLabel ?? "未注册页面上下文"}
          </span>
          {effectivePageCtx && (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
              页面上下文将随每句注入（仅 AI 可见）
            </span>
          )}
        </div>
      </div>

      {/* 主体：工作区树 + 面板（FR-02/FR-03：加宽至 960px，树栏固定 320px，
          无 md: 视口断点前缀——知识库坑：md: 是视口断点非容器断点，嵌入抽屉用固定 grid）。 */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        {/* FR-02/FR-03：左栏换 /sessions 同款工作区树 SessionListPanel。
            lockedRuntime 时传 scope=runtime（仅显示该 runtime 会话，组头新建禁用）；
            无锁时传全局 scope（对齐 ql-20260823-003 三入口一致裁决）。 */}
        <div className="hidden min-h-0 flex-col border-r border-border-weak md:flex">
          <SessionListPanel
            selectedSessionId={sessionId}
            onSelect={(s) => selectSession(s.id)}
            scope={lockedRuntime ? { kind: "runtime", runtimeId: lockedRuntime.id } : undefined}
            onNewInGroup={handleNewInGroup}
            onDeleteSessions={handleDeleteSessions}
            onArchiveSessions={handleArchiveSessions}
            onUnarchiveSessions={handleUnarchiveSessions}
          />
        </div>

        <div className="min-h-0 min-w-0">
          {sessionId ? (
            <SessionPanel
              key={sessionId}
              mode="page"
              sessionId={sessionId}
              machines={machineOptions}
              llmProviders={providers}
              onSessionListRefresh={refreshLists}
              pageContextOverride={derivedPageCtx}
            />
          ) : preContext ? (
            <SessionPanel
              key={`pre:${preContext.workspaceId ?? "-"}:${preContext.runtimeId}`}
              mode="page"
              sessionId={null}
              machines={machineOptions}
              llmProviders={providers}
              // task-12（用户实测反馈③：/workspaces 新建会话仍无注入）：store 的
              // preContext 与 pageContext 是两个独立字段——创建轮（预会话首句
              // createSession）读 preContext.pageContext，此前直传 store.preContext
              // 恒缺 pageContext，导致 UI 新建会话一律不注入（API 级 E2E 绕过
              // UI 故未暴露）。此处显式合并（显式入口上下文 ?? URL 派生兜底）。
              preContext={{
                ...preContext,
                pageContext: effectivePageCtx ?? undefined,
              }}
              onPreSessionCreated={handlePreSessionCreated}
              pageContextOverride={derivedPageCtx}
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

      {/* 机器兜底两步浮层（复用门户组件；fixed 全屏遮罩，v1 接受）。
          task-10：候选含共享机器（共享条目显示名带「共享 + 共享人」标注，
          PreSessionPicker 复用组件不改其渲染；在线过滤沿用其自身白名单）。 */}
      <PreSessionPicker
        open={pickerOpen}
        machines={machineOptions}
        onCancel={() => setPickerOpen(false)}
        onPick={(runtimeId) => {
          startPreSession(
            { runtimeId, workspaceId: pickerWorkspaceId },
            effectivePageCtx,
          );
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/**
 * 悬浮宿主：球 + 最小化胶囊 + 抽屉 + 互斥门控。
 *
 * 2026-08-25 悬浮球增强（用户反馈三连）：
 *   1. 可拖拽：球按住拖动到屏幕任意位置（拖拽阈值 6px，误触不误拖）；
 *      位置/吸附态持久化 localStorage（刷新不丢）。
 *   2. 边缘收起：松手时球心距左右边缘 ≤52px 自动吸附成「半藏发光条」
 *      （露出 14px），点一下照常开抽屉，再拖走即脱离边缘。
 *   3. 点外部自动收抽屉：open 时全局 pointerdown 捕获，落在抽屉/球之外
 *      即 closeDrawer（radix/antd 弹出层 portal 到 body，白名单放行，
 *      否则点面板内下拉会误收）。
 *   抽屉/胶囊跟随球所在半屏开合（球在左半屏 → 抽屉从左侧滑出）。
 */

/** 宠物按钮直径（h-[52px] w-[52px]，2026-08-26 宠物化放大）。 */
const BALL = 52;
/** 自由停靠时与视口边缘间距（对齐原 bottom-5 right-5）。 */
const EDGE_GAP = 20;
/** 判定「拖拽」而非「点击」的位移阈值（px）。 */
const DRAG_THRESHOLD = 6;
/** 松手吸附余量：球心距边缘 ≤ BALL/2 + 此值 → 收起到该边缘。 */
const DOCK_SLACK = 28;
/** 吸附后露出边缘的宽度（px），其余半藏在屏外。 */
const DOCK_VISIBLE = 14;
/** 球位置持久化键。 */
const BALL_STORAGE_KEY = "sillyhub:floating-ball";

type DockSide = "left" | "right";

/** 球锚点：x/y 为球心视口坐标（docked 时为「未隐藏时」的逻辑球心）。 */
interface BallAnchor {
  x: number;
  y: number;
  dock: DockSide | null;
}

/**
 * 点外部关闭的 portal 白名单：抽屉内 SessionPanel 的 radix 弹出层（下拉/气泡/
 * 对话框）与 antd 浮层均 portal 到 document.body，不在 drawerRef 子树内，
 * 不放行会被误判成「点外部」。
 */
const OUTSIDE_SAFE_SELECTOR =
  '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [role="tooltip"], [role="dialog"], [role="alertdialog"], .ant-dropdown, .ant-select-dropdown, .ant-popover, .ant-tooltip, .ant-modal, .ant-message, .ant-notification';

function clampAnchor(a: BallAnchor): BallAnchor {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  return {
    ...a,
    x: Math.min(Math.max(a.x, BALL / 2), Math.max(vw - BALL / 2, BALL / 2)),
    y: Math.min(Math.max(a.y, BALL / 2 + 8), Math.max(vh - BALL / 2, BALL / 2)),
  };
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

  // ── 悬浮球拖拽 / 边缘吸附 ────────────────────────────────────────────
  const [anchor, setAnchor] = useState<BallAnchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  /** 拖拽松手时刻（click 抑制：松手后 250ms 内的 click 视为拖拽尾音吞掉；
      时间窗比布尔位稳——拖出球外松手时 click 不触发，布尔位会误吞下一次真点击）。 */
  const lastDragEndRef = useRef(0);

  // ── 宠物形象（2026-08-26 用户需求：小狗/小猫双选 + 本地记忆 + 宠物交互）──
  const [pet, setPet] = useState<FloatingPet>("dog");
  /** 宠物选择器（右键球唤起；存 {x,y} 菜单位）。null = 关闭。 */
  const [petPicker, setPetPicker] = useState<{ x: number; y: number } | null>(null);
  // 挂载后读本地选择（effect 而非初值：SSR/水合一致，同球位置先例）。
  useEffect(() => {
    setPet(getFloatingPet());
  }, []);
  const pickPet = useCallback((next: FloatingPet) => {
    setPet(next);
    setFloatingPet(next);
    setPetPicker(null);
  }, []);

  // 挂载后读持久化位置（放 effect 而非 useState 初值：避免 SSR/水合不一致）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BALL_STORAGE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as Partial<BallAnchor>;
      if (typeof v.x === "number" && typeof v.y === "number") {
        setAnchor(
          clampAnchor({
            x: v.x,
            y: v.y,
            dock: v.dock === "left" || v.dock === "right" ? v.dock : null,
          }),
        );
      }
    } catch {
      // 损坏数据静默丢弃，回落默认右下角
    }
  }, []);

  // 位置/吸附态持久化。
  useEffect(() => {
    if (!anchor) return;
    try {
      window.localStorage.setItem(BALL_STORAGE_KEY, JSON.stringify(anchor));
    } catch {
      // 隐私模式写失败不影响功能
    }
  }, [anchor]);

  // 视口缩放时把球钳回屏内。
  useEffect(() => {
    const onResize = () => setAnchor((a) => (a ? clampAnchor(a) : a));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const defaultCenter = useCallback(() => {
    const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
    const vh = typeof window === "undefined" ? 768 : window.innerHeight;
    return { x: vw - EDGE_GAP - BALL / 2, y: vh - EDGE_GAP - BALL / 2 };
  }, []);

  const onBallPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const base = anchor ?? defaultCenter();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: base.x,
        baseY: base.y,
        moved: false,
      };
      // move/up 挂 window：不依赖 pointer capture（jsdom 无实现），拖出球也连续。
      window.addEventListener("pointermove", onBallPointerMove);
      window.addEventListener("pointerup", onBallPointerUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchor, defaultCenter],
  );

  const onBallPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    // 一拖即脱离吸附（dock 清 null），球心跟手。
    setAnchor(clampAnchor({ x: d.baseX + dx, y: d.baseY + dy, dock: null }));
  }, []);

  const onBallPointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    window.removeEventListener("pointermove", onBallPointerMove);
    window.removeEventListener("pointerup", onBallPointerUp);
    dragRef.current = null;
    setDragging(false);
    if (!d || e.pointerId !== d.pointerId || !d.moved) return;
    lastDragEndRef.current = Date.now();
    setAnchor((a) => {
      if (!a) return a;
      const vw = window.innerWidth;
      const dock: DockSide | null =
        a.x <= BALL / 2 + DOCK_SLACK
          ? "left"
          : a.x >= vw - BALL / 2 - DOCK_SLACK
            ? "right"
            : null;
      // 吸附后逻辑球心贴边（渲染时再半藏），脱离边缘时从此处复出。
      const x = dock === "left" ? BALL / 2 : dock === "right" ? vw - BALL / 2 : a.x;
      return clampAnchor({ ...a, x, dock });
    });
  }, [onBallPointerMove]);

  // ── 点击抽屉外自动收起 ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (drawerRef.current?.contains(t)) return;
      if (ballRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(OUTSIDE_SAFE_SELECTOR)) return;
      closeDrawer();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, closeDrawer]);

  if (onPortal) return null;

  // 挂载门控（约束 3）：全关且无会话 → 只渲染球，抽屉主体不挂载。
  const mounted = open || minimized || Boolean(sessionId);

  // 抽屉/胶囊跟随球所在半屏（吸附态优先；默认右下 → 右侧）。
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const side: DockSide = anchor
    ? (anchor.dock ?? (anchor.x < vw / 2 ? "left" : "right"))
    : "right";

  // 球定位：null → 默认右下（class）；否则 left/top 精确定位，吸附态半藏屏外。
  const ballStyle: React.CSSProperties | undefined = anchor
    ? anchor.dock === "left"
      ? { left: -(BALL - DOCK_VISIBLE), top: anchor.y - BALL / 2 }
      : anchor.dock === "right"
        ? { right: -(BALL - DOCK_VISIBLE), top: anchor.y - BALL / 2 }
        : { left: anchor.x - BALL / 2, top: anchor.y - BALL / 2 }
    : undefined;

  // 胶囊跟随球：贴同侧边缘、位于球下方（无锚点保持原 bottom-20 right-5）。
  const capsuleStyle: React.CSSProperties | undefined = anchor
    ? side === "left"
      ? { left: EDGE_GAP, top: anchor.y + BALL / 2 + 10 }
      : { right: EDGE_GAP, top: anchor.y + BALL / 2 + 10 }
    : undefined;

  return (
    <>
      {/* 最小化保活胶囊（球上方分层；经门户互斥后恢复=面板重挂载回放，现场
          语义仍是恢复选中会话——文案不承诺"连接未断"以免与互斥协议矛盾） */}
      {minimized && (
        <button
          type="button"
          data-testid="floating-capsule"
          onClick={restore}
          title="恢复悬浮会话"
          style={capsuleStyle}
          className={cn(
            "fixed z-40 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-card px-4 py-1.5 text-xs font-semibold text-brand-700 shadow-md transition-transform hover:-translate-y-0.5",
            // 无锚点（含 SSR/水合首帧）时保持原右下位（side 此时恒为 right）。
            anchor ? "" : "bottom-20 right-5",
          )}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
          会话进行中 · 点击恢复
        </button>
      )}

      {/* 悬浮球（可拖拽/边缘吸附；辉光环 + 呼吸浮动 + 高光三层叠出"能量球"质感） */}
      <button
        ref={ballRef}
        type="button"
        data-testid="floating-ball"
        data-dock={anchor?.dock ?? "none"}
        aria-label={minimized ? "恢复悬浮会话" : "打开悬浮会话助手"}
        title="智能会话助手（可拖拽，拖到屏幕边缘自动收起）"
        style={ballStyle}
        onPointerDown={onBallPointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragging) return;
          setPetPicker({ x: e.clientX, y: e.clientY });
        }}
        onClick={() => {
          if (Date.now() - lastDragEndRef.current < 250) return;
          if (open) closeDrawer();
          else if (minimized) restore();
          else openDrawer();
        }}
        className={cn(
          "group fixed z-40 flex h-[52px] w-[52px] touch-none items-end justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          anchor ? "" : "bottom-5 right-5",
          dragging
            ? "scale-110 cursor-grabbing"
            : "cursor-grab transition-[left,right,top,transform,opacity] duration-300 hover:scale-105",
          anchor?.dock && "opacity-75 hover:opacity-100",
        )}
      >
        {/* 2026-08-26 用户需求②：去能量球——按钮就是一整只宠物（自带浮动/
            投影/地面阴影与全部动画，见 floating-mascot.tsx）。items-end 让
            宠物脚下的地面阴影贴按钮底缘。 */}
        <FloatingMascot pet={pet} active={Boolean(sessionId) || minimized} size={50} />
        {(sessionId !== null || minimized) && (
          <span
            aria-hidden
            data-testid="floating-ball-badge"
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card bg-info"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-info/70" />
          </span>
        )}
      </button>

      {/* 宠物选择器（右键球唤起）：透明遮罩点外关闭 + 两个选项卡 */}
      {petPicker && (
        <>
          <div
            className="fixed inset-0 z-[55]"
            onClick={() => setPetPicker(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setPetPicker(null);
            }}
            aria-hidden
          />
          <div
            role="menu"
            aria-label="选择悬浮助手形象"
            data-testid="pet-picker"
            className="fixed z-[56] w-44 rounded-xl border border-border bg-card p-2 shadow-lg"
            style={{
              left: Math.min(petPicker.x, (typeof window !== "undefined" ? window.innerWidth : 1024) - 190),
              top: Math.max(8, petPicker.y - 96),
            }}
          >
            <div className="px-1.5 pb-1.5 text-[11px] font-semibold text-muted-foreground">
              选择你的小伙伴
            </div>
            {([
              { key: "dog" as FloatingPet, label: "小狗", emoji: "🐶" },
              { key: "cat" as FloatingPet, label: "小猫", emoji: "🐱" },
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="menuitemradio"
                aria-checked={pet === opt.key}
                data-testid={`pet-option-${opt.key}`}
                onClick={() => pickPet(opt.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                  pet === opt.key
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : "text-muted-foreground hover:bg-brand-50/60 hover:text-brand-700",
                )}
              >
                <span className="text-base leading-none">{opt.emoji}</span>
                {opt.label}
                {pet === opt.key && (
                  <span className="ml-auto text-brand-600" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 抽屉（约束 2：最小化 hidden 保挂载，SSE/队列不断；跟随球所在半屏） */}
      {mounted && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-label="悬浮会话抽屉"
          data-testid="floating-drawer"
          data-open={open ? "true" : "false"}
          data-side={side}
          className={cn(
            "fixed inset-y-0 z-50 flex w-[min(960px,92vw)] flex-col bg-card shadow-lg transition-transform duration-300",
            side === "right"
              ? cn("right-0 border-l border-border", open ? "translate-x-0" : "translate-x-full")
              : cn("left-0 border-r border-border", open ? "translate-x-0" : "-translate-x-full"),
          )}
          style={open ? undefined : { visibility: "hidden" }}
        >
          <FloatingDrawerBody onPreSessionCreated={handlePreSessionCreated} />
        </div>
      )}
    </>
  );
}
