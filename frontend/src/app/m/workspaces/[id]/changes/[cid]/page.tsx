"use client";

/**
 * task-09 · 变更详情移动钻取页 changes/[cid]（FR-04 / FR-09 / design §5.1 / §5.3 /
 * §5.5，D-001@V1 / D-002@V1 / D-004@V1，change 2026-08-26-mobile-workspace-page）。
 *
 * 页面只做壳（constraints：返回顶栏 / 状态门控 / 装配），详情区块全部复用 task-08
 * 的 MobileChangeDetail（阶段条 / 审批 / 文档 / 时间线 / 关联会话 / quicklog 关联
 * 等零重复实现）：
 *  - 路由命中 task-01 DRILL_ROUTES（m/layout isDrillRoute）→ 裸容器直出（无
 *    MobileAppShell、无底部 Tab），页面自渲染返回顶栏（FR-09）；
 *  - 顶栏 MobileTopBar（mobile-top-bar.tsx:16 props title/onBack）：返回 →
 *    router.push 回列表页 /m/workspaces/[id]/changes；标题 = 变更名（title 优先，
 *    change_key 兜底）；
 *  - 页面级 useQuery getChange（lib/changes.ts:112）与 MobileChangeDetail 内部查询
 *    同 key ["change", workspaceId, changeId]（桌面 [cid]/page.tsx:43 同构）——
 *    react-query 共享缓存不双请求，驱动顶栏标题与整页加载骨架 / 错误重试态；
 *  - ⋯ 菜单（MobileActionMenu 承载，design §5.3 对齐桌面既有动作）：重解析
 *    （reparseChanges + invalidate ["changes", wid] 前缀与本详情 key，语义对齐
 *    桌面列表页 handleReparse）/ 复制变更名（clipboard，展示名口径同标题）。
 *    MobileTopBar 无动作槽——页面以 sticky 包裹层 + 右侧预留 44px 热区组合 ⋯
 *    触发，不侵入组件内部；
 *  - 关联会话入口：onOpenSession → /m/workspaces/[id]/sessions（会话列表）。
 */
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";

import { MobileActionMenu, type MobileAction } from "@/components/mobile/mobile-action-menu";
import { MobileChangeDetail } from "@/components/mobile/mobile-change-detail";
import { MobileTopBar } from "@/components/mobile/mobile-top-bar";
import { ApiError } from "@/lib/api";
import { getChange, reparseChanges } from "@/lib/changes";

export default function MobileChangeDetailPage() {
  const params = useParams<{ id: string; cid: string }>();
  const workspaceId = params.id;
  const changeId = params.cid;
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── 页面级详情 query（key 与 MobileChangeDetail 内部逐字一致：共享缓存，
  //    两个 observer 同 key 只发一次请求；轮询由 MobileChangeDetail 侧驱动）──
  const changeQuery = useQuery({
    queryKey: ["change", workspaceId, changeId],
    queryFn: () => getChange(workspaceId, changeId),
  });
  const change = changeQuery.data ?? null;
  // 加载/错误语义对齐桌面 [cid]/page.tsx:93：仅初次加载（尚无数据）进骨架/错误屏
  const loading = changeQuery.isPending;
  const loadError =
    changeQuery.isError && !changeQuery.data
      ? changeQuery.error instanceof ApiError
        ? changeQuery.error.message
        : "加载变更详情失败"
      : null;

  // ── ⋯ 菜单 state（重解析 / 复制变更名）─────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleBackToList = () => {
    router.push(`/m/workspaces/${workspaceId}/changes`);
  };

  // 重解析（对齐桌面列表页 handleReparse）：workspace 级 reparseChanges，成功后
  // 失效主列表前缀 ["changes", workspaceId] + 本详情 key（变更名/阶段可能变化）。
  const handleReparse = async () => {
    if (reparsing) return;
    setReparsing(true);
    setActionMsg(null);
    setActionError(null);
    try {
      await reparseChanges(workspaceId);
      await Promise.all([
        queryClient
          .invalidateQueries({ queryKey: ["changes", workspaceId] })
          .catch(() => undefined),
        queryClient
          .invalidateQueries({ queryKey: ["change", workspaceId, changeId] })
          .catch(() => undefined),
      ]);
      setActionMsg("已重新解析变更目录");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  // 复制变更名（展示名口径与顶栏标题一致：title 优先，change_key 兜底）
  const handleCopyName = async () => {
    const name = change ? change.title || change.change_key : "";
    if (!name) return;
    try {
      await navigator.clipboard.writeText(name);
      setActionMsg("已复制变更名");
    } catch {
      setActionError("复制失败，请手动复制");
    }
  };

  const menuActions: MobileAction[] = [
    {
      key: "reparse",
      label: reparsing ? "重新解析中…" : "重新解析变更",
      onPress: () => {
        void handleReparse();
      },
    },
    {
      key: "copy-name",
      label: "复制变更名",
      onPress: () => {
        void handleCopyName();
      },
    },
  ];

  const barTitle = loading
    ? "加载中…"
    : change
      ? change.title || change.change_key
      : "变更详情";

  return (
    // ql-20260827-012：父级（m/layout 钻取裸容器）已 fixed inset-0 + overflow-hidden，
    // 本页 h-full 撑满视口：顶栏 shrink-0 固定，main 自管滚动（原 min-h-[100dvh] 靠
    // body 整页滚，顶栏 sticky 跟滚、底部无锚，手感松垮）。
    <div className="flex h-full w-full min-w-0 flex-1 flex-col">
      {/* 顶栏：MobileTopBar（title/onBack）+ 右侧 ⋯ 触发（pr 预留 44px 热区，
          按钮自带 border-b 与顶栏底分隔线连成一线；触摸热区 ≥44px，design §5.5） */}
      <div className="relative shrink-0">
        <div className="relative pr-11">
          <MobileTopBar title={barTitle} onBack={handleBackToList} />
        </div>
        <button
          type="button"
          aria-label="更多操作"
          data-testid="m-change-menu-trigger"
          onClick={() => setMenuOpen(true)}
          className="absolute inset-y-0 right-0 flex w-[44px] items-center justify-center border-b border-border bg-card text-foreground transition-colors hover:bg-muted"
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-6 pt-3">
        {/* ⋯ 菜单动作反馈（重解析 / 复制结果） */}
        {actionMsg ? (
          <p
            data-testid="m-change-action-feedback"
            className="text-xs text-success"
          >
            {actionMsg}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-xs text-destructive">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          // 整页加载骨架（页面级 query 驱动；MobileChangeDetail 未挂载不重复出加载态）
          <div
            data-testid="m-change-detail-page-loading"
            className="flex flex-col gap-3"
            aria-label="变更详情加载中"
          >
            <div className="h-[52px] animate-pulse rounded-[var(--radius-lg)] bg-muted/60" />
            <div className="h-44 animate-pulse rounded-[var(--radius-lg)] bg-muted/60" />
            <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-muted/60" />
          </div>
        ) : loadError ? (
          // 错误态：可重试（refetch 同 key）+ 返回列表兜底
          <div
            data-testid="m-change-detail-page-error"
            role="alert"
            className="flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-destructive/30 bg-destructive/10 px-3 py-4"
          >
            <p className="text-[14px] text-destructive">{loadError}</p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="m-change-detail-page-retry"
                onClick={() => void changeQuery.refetch()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                重试
              </button>
              <button
                type="button"
                onClick={handleBackToList}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-muted"
              >
                返回列表
              </button>
            </div>
          </div>
        ) : (
          // 详情内容全部来自 MobileChangeDetail（task-08 契约：changeId/workspaceId/
          // onOpenSession）；关联会话入口跳移动会话列表
          <MobileChangeDetail
            changeId={changeId}
            workspaceId={workspaceId}
            onOpenSession={() =>
              router.push(`/m/workspaces/${workspaceId}/sessions`)
            }
          />
        )}
      </main>

      {/* ⋯ 菜单（底部 ActionSheet）：重解析 / 复制变更名（design §5.3） */}
      <MobileActionMenu
        open={menuOpen}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
        title="变更操作"
      />
    </div>
  );
}
