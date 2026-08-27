"use client";

/**
 * task-12 · 会话列表移动页（FR-06 / FR-08 / design §5.4 列表页 + 新建两步 + §7，
 * D-003@V1 / D-004@V1，change 2026-08-26-mobile-workspace-page）。
 *
 * 装配（W1/W2 已就绪产物，本页纯接线零重绘）：
 *  - 顶栏 MobileWorkspaceHeader（task-04 契约，tab="sessions"；工作区数据来自
 *    task-02 段 layout Provider 预取，预取未完成渲染轻量占位）；
 *  - 列表 MobileSessionList（task-11 契约：同 key query + 机器分组 + 状态Tab +
 *    菜单三操作）；点卡片 onSelect → 钻取 /m/workspaces/[id]/sessions/[sid]；
 *  - 新建两步浮层 PreSessionPicker variant="bottomSheet"（task-13 契约）：
 *    ＋（原型 .fab 悬浮右下）或列表空态引导 → machines 同源注入弹贴底抽屉。
 *
 * 页内预会话态（design §5.4 两选项裁决：列表页内状态切换，少一个路由文件，
 * 不新增 /sessions/new 路由）：
 *  - onPick(runtimeId) 置 preContext（对齐 sessions-portal.tsx:369 workspace
 *    入口语义：workspaceId + runtimeId）→ 整页切 SessionPanel（sessionId=null +
 *    preContext，第四宿主形态 variant="mobile"），隐藏列表 + 返回列表入口；
 *  - 首句创建成功 handlePreSessionCreated（对齐门户 :396-405 语义）：清
 *    preContext + router.replace 到 /m/workspaces/[id]/sessions/[sid]（key={sid}
 *    变化重挂载自然接管，SSE/队列干净重建）+ invalidate ["agentSessions"]。
 *
 * 页面级数据与悬浮宿主同源同 key（floating-session-host.tsx:84-96）：
 *  - machines：useDaemonMachines({limit:100})（内部 15s 无条件轮询）；
 *  - providers：useQuery ["llmProviders","floating-session"] + listProviders
 *    （staleTime 30s，与悬浮宿主共享缓存零重复请求）。
 */
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus } from "lucide-react";

import { useMobileWorkspace } from "@/app/m/workspaces/[id]/layout";
import { MobileSessionList } from "@/components/mobile/mobile-session-list";
import { MobileWorkspaceHeader } from "@/components/mobile/mobile-workspace-header";
import {
  SessionPanel,
  type SessionPreContext,
} from "@/components/daemon/session-panel";
import { PreSessionPicker } from "@/components/sessions/pre-session-picker";
import { listProviders, type LlmProviderRead } from "@/lib/api/llm-providers";
import { type SessionCreateResponse } from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";

export default function MobileWorkspaceSessionsPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  // 顶栏工作区数据：task-02 段 layout Provider 预取注入（URL 是真相源）。
  const { workspace } = useMobileWorkspace();

  // ── 页面级数据（与悬浮宿主同源同 key，见文件头）──────────────────────
  const { items: machines } = useDaemonMachines({ limit: 100 });
  const providersQ = useQuery({
    queryKey: ["llmProviders", "floating-session"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers: LlmProviderRead[] = useMemo(
    () => providersQ.data ?? [],
    [providersQ.data],
  );

  // ── 新建两步浮层 + 页内预会话态（见文件头；约束：不新增 /sessions/new 路由）──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preContext, setPreContext] = useState<SessionPreContext | null>(null);

  /** 浮层两步选完（对齐门户 handlePickerPick）：合成 preContext 切预会话态并关浮层。 */
  const handlePickerPick = (runtimeId: string) => {
    setPreContext({ workspaceId, runtimeId });
    setPickerOpen(false);
  };

  /**
   * 预会话首句创建成功（对齐 sessions-portal.tsx:396-405 门户语义）：清预会话
   * 态 + replace 到真会话钻取页 + invalidate ["agentSessions"]（新会话落列表
   * 分组顶部；与桌面门户/移动列表同前缀全覆盖）。
   */
  const handlePreSessionCreated = (resp: SessionCreateResponse) => {
    setPreContext(null);
    router.replace(`/m/workspaces/${workspaceId}/sessions/${resp.session_id}`);
    void qc.invalidateQueries({ queryKey: ["agentSessions"] });
  };

  // ── 预会话视图：整页切 SessionPanel（复用第四宿主形态），隐藏列表 ──────
  if (preContext) {
    return (
      <div
        data-testid="m-sessions-pre-view"
        className="flex h-full min-h-0 flex-col"
      >
        {/* 返回列表入口（design §5.4：预会话视图提供返回列表路径） */}
        <div className="sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-border bg-card px-1 py-1 shadow-[var(--shadow-sm)]">
          <button
            type="button"
            onClick={() => setPreContext(null)}
            aria-label="返回会话列表"
            data-testid="m-sessions-pre-back"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-[14px] text-foreground transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
            返回列表
          </button>
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
            新建会话
          </span>
        </div>
        {/* SessionPanel 根 flex-col h-full 天然贴底（variant="mobile" 满宽贴屏） */}
        <div className="min-h-0 flex-1">
          <SessionPanel
            key={`pre:${workspaceId}:${preContext.runtimeId}`}
            mode="page"
            variant="mobile"
            sessionId={null}
            machines={machines}
            llmProviders={providers}
            preContext={preContext}
            onPreSessionCreated={handlePreSessionCreated}
          />
        </div>
      </div>
    );
  }

  // ── 列表视图：顶栏 + 分组卡片列表 + ＋ 新建（两步浮层） ─────────────────
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* 顶栏：tab="sessions" 高亮；切「变更中心」push 对应路由（task-04 契约）。
          预取未完成时渲染轻量占位，不阻塞下方列表渲染。 */}
      {workspace ? (
        <MobileWorkspaceHeader
          workspace={workspace}
          tab="sessions"
          onTabChange={(t) => {
            if (t === "changes") {
              router.push(`/m/workspaces/${workspaceId}/changes`);
            }
          }}
          onBack={() => router.push("/m/workspaces")}
        />
      ) : (
        <div
          data-testid="m-sessions-header-fallback"
          className="sticky top-0 z-30 -mx-4 -mt-3 border-b border-border bg-card px-4 py-3 text-[14px] text-muted-foreground"
        >
          工作区加载中…
        </div>
      )}

      {/* 会话分组卡片列表（task-11 契约；onSelect 钻取真会话 / onNew 接新建） */}
      <MobileSessionList
        workspaceId={workspaceId}
        onSelect={(sid) =>
          router.push(`/m/workspaces/${workspaceId}/sessions/${sid}`)
        }
        onNew={() => setPickerOpen(true)}
      />

      {/* ＋ 新建会话（原型 .fab：悬浮右下、底部 Tab 上方留白；触摸热区 ≥44px） */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-label="新建会话"
        data-testid="m-sessions-fab"
        className="fixed bottom-24 right-4 z-30 inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-lg)] transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </button>

      {/* 新建两步浮层（贴底抽屉形态；machines 同源注入，两步逻辑零分叉） */}
      <PreSessionPicker
        variant="bottomSheet"
        open={pickerOpen}
        machines={machines}
        onCancel={() => setPickerOpen(false)}
        onPick={handlePickerPick}
      />
    </div>
  );
}
