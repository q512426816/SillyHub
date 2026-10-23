"use client";

/**
 * PendingDialogDock：真会话底部输入框位置的待答提问 dock（2026-10-22-askuser-dock-inputbar）。
 *
 * 演化轨迹：ql-20260621 起提问卡在 TurnTimeline 滚动容器 sticky 钉顶 →
 * 2026-10-22-askuser-card-inline 改内嵌内容流顶部（用户反馈长日志时看不到）→
 * 本变更整体迁出 TurnTimeline，渲染在输入框位置（互斥替换 SessionInputBar，
 * 用户裁决：问答期间输入框不可用，答完自动恢复）。
 *
 * 承载能力（自 turn-timeline 原样迁移，逻辑零改写）：
 *   - pending AskUser 卡列（AskUserDialogCard + ErrorBoundary 兜底）；
 *   - 最小化（会话内存态 minimizedIds：收起为右下角浮动胶囊，已填内容随挂载
 *     保留，胶囊点击还原——ql-20260825-006）；
 *   - 待决策 pill 定位还原（2026-10-16-session-decision-pill FR-03）：focusRequest
 *     nonce 触发「无条件还原 + 卡区 ring 闪烁 ~1.2s 自清」；原「滚动容器滚顶」
 *     步骤随位置迁移移除（卡区不在时间线滚动区内）。dialog 挂载点不传
 *     focusRequest（无决策 pill），缺省 null 零行为。
 *
 * 布局：外层与 SessionInputBar 同款视觉（shrink-0 bg-card px-5 pb-4 pt-1 对齐
 * 输入栏）；内层卡列区 max-h-[45vh] overflow-y-auto overscroll-contain（用户
 * 裁决：固定最大高度，超出区内上下滚动，不穿透到日志区）。
 *
 * ended/failed 会话不渲染（残留 pending 行为死卡——ql-20260623 改动三门控随迁）；
 * 全部最小化时外层仅作挂载占位（保卡片 state），胶囊在右下角承担还原入口。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  MinimizedDialogCapsule,
  resolvePendingTitle,
} from "@/components/permissions/minimized-dialog-capsule";
import type { SessionPermissionRequest } from "@/lib/daemon";

export interface PendingDialogDockProps {
  /** 待答 permission_request 队列（dialog_kind 存在的 AskUser 提问）。 */
  pendingRequests: SessionPermissionRequest[];
  /** 会话状态：ended/failed 不渲染（残留 pending 行为死卡）。 */
  sessionStatus: string | undefined;
  /** 卡片提交 / SSE resolved 后由父级过滤 pendingRequests（迁移自 TurnTimeline onDialogResolved）。 */
  onResolved: (_requestId: string) => void;
  /**
   * 待决策 pill 定位还原请求（受控触发式——nonce 递增驱动 effect，requestId 不变
   * 重复点击也生效）。effect：①若该卡在 minimizedIds 中先还原；②卡区高亮闪烁
   * ~1.2s 自清。缺省 / null 零行为。旧消费方零回归（自清节奏约定同
   * highlightTurnKey 先例——清除归本组件定时器）。
   */
  focusRequest?: { requestId: string; nonce: number } | null;
}

export function PendingDialogDock({
  pendingRequests,
  sessionStatus,
  onResolved,
  focusRequest = null,
}: PendingDialogDockProps) {
  // ── 最小化集合（会话内存态，自 turn-timeline 原样迁移）──────────────────
  // AskUserDialogCard 收 minimized=true 渲染 null 但保持挂载 → 已选选项 / 手动
  // 输入 state 保留，还原后继续作答。
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());

  const handleMinimize = useCallback((requestId: string) => {
    setMinimizedIds((prev) => {
      if (prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });
  }, []);

  const handleRestore = useCallback((requestId: string) => {
    setMinimizedIds((prev) => {
      if (!prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);

  // 卡片移除（提交成功 / permission_resolved SSE 由父级过滤 pendingRequests）
  // 后同步清最小化集合，胶囊计数不残留。集合为空时跳过（避免无谓重渲染）。
  useEffect(() => {
    setMinimizedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(pendingRequests.map((r) => r.request_id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingRequests]);

  // ended/failed 会话不回显 pending 卡（既有门控随迁）→ 胶囊同步不渲染。
  const showDock =
    pendingRequests.length > 0 &&
    sessionStatus !== "ended" &&
    sessionStatus !== "failed";

  // ── 待决策 pill 定位还原（nonce 触发式）─────────────────────────────────
  // 还原→闪烁两步（原第三步「滚动容器滚顶」随卡区迁出时间线滚动区移除）。
  // 挂载首帧 nonce 变化（初始 -1 → 值）会触发一次——无害（无卡可闪时
  // showDock 门控本就不渲染卡区）。
  const dockListRef = useRef<HTMLDivElement>(null);
  const focusNonceRef = useRef<number>(-1);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === focusNonceRef.current) return;
    focusNonceRef.current = focusRequest.nonce;
    handleRestore(focusRequest.requestId);
    const el = dockListRef.current;
    if (!el) return;
    el.classList.add("ring-2", "ring-brand-500");
    const t = window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-brand-500");
    }, 1200);
    return () => window.clearTimeout(t);
  }, [focusRequest, handleRestore]);

  const minimizedPending = showDock
    ? pendingRequests.filter((r) => minimizedIds.has(r.request_id))
    : [];
  // 全部最小化时卡列区只剩挂载占位（保卡片 state），高度趋零——胶囊为唯一
  // 还原入口（评审 P3 收敛：原迁移残留 visiblePendingCount 死变量已删）。

  if (!showDock) return null;

  return (
    <>
      {/* 外层与 SessionInputBar 同款视觉（shrink-0 bg-card px-5 pb-4 pt-1），
          输入框位置的等宽替代。 */}
      <div className="shrink-0 bg-card px-5 pb-4 pt-1">
        <div
          ref={dockListRef}
          data-testid="pending-dialog-dock"
          className="max-h-[45vh] space-y-2 overflow-y-auto overscroll-contain"
        >
          {pendingRequests.map((req) => (
            <ErrorBoundary
              key={req.request_id}
              label="ask-user-dialog-card"
              fallback={() => (
                <div className="text-[11px] text-red-600/70">提问卡片渲染失败</div>
              )}
            >
              <AskUserDialogCard
                request={req}
                minimized={minimizedIds.has(req.request_id)}
                onMinimize={handleMinimize}
                onResolved={onResolved}
              />
            </ErrorBoundary>
          ))}
        </div>
      </div>
      {/* 最小化 pending 提问卡的右下角浮动胶囊（fixed 定位锚 viewport，不随日志
          滚动），点击主体还原最近一条，chevron 展开明细定点还原。会话页 pending
          卡恒为 AskUser 提问（无普通工具审批），isDialog 按请求实际携带判断以
          保持组件契约。（自 turn-timeline 原样迁移，含全部最小化时 visiblePendingCount
          为 0 的占位语义——胶囊为唯一还原入口。） */}
      {minimizedPending.length > 0 && (
        <MinimizedDialogCapsule
          items={minimizedPending.map((req) => ({
            requestId: req.request_id,
            title: resolvePendingTitle(req),
            isDialog: Boolean(req.dialog_kind),
          }))}
          onRestore={handleRestore}
        />
      )}
    </>
  );
}
