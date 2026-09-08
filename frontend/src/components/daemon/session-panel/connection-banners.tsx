"use client";

/**
 * 连接状态横幅 + 看门狗提示条（task-09 / design A6 原型②③④；自 session-panel.tsx
 * 拆出，task-14 / 2026-09-07-arch-large-file-split，原样搬移零行为变化）。
 */

import { CheckCircle2, Hourglass, TriangleAlert } from "lucide-react";
import { type SessionStreamStatus } from "@/lib/daemon";
import { cn } from "@/lib/utils";


/**
 * task-09 / design A6（原型②③）：连接状态横幅。reconnecting = warning 常驻
 * 「正在重连…（第 N 次尝试）」；reconnected = success「连接已恢复，正在同步…」
 * 2s 自动消失（useStreamConnectionGuard 内计时）。复用「离线只读」横幅样式位
 * （border-b + 12px 文案 + 图标，warning 同 amber 阶；success 走 emerald 阶）。
 */
export function StreamConnectionBanner(props: {
  connStatus: SessionStreamStatus;
  attempt: number;
  mobile?: boolean;
}) {
  if (props.connStatus === "reconnecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-conn-banner="reconnecting"
        className={cn(
          "flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800",
          props.mobile && "px-3",
        )}
      >
        <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>
          实时连接已断开，正在重连…（第 {props.attempt} 次尝试）—— 已发送的消息不会丢失，恢复后将自动同步错过的内容
        </span>
      </div>
    );
  }
  if (props.connStatus === "reconnected") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-conn-banner="reconnected"
        className={cn(
          "flex items-center gap-2 border-b border-emerald-300 bg-emerald-50 px-5 py-2 text-xs text-emerald-800",
          props.mobile && "px-3",
        )}
      >
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>连接已恢复，正在同步断线期间的消息…（同步完成后此提示自动消失）</span>
      </div>
    );
  }
  return null;
}

/**
 * task-09 / design A6（原型④）：运行轮看门狗提示——本轮长时间无响应仅提示
 * 「正在与平台核对」，不伪造终态（终态以 backend 数据经 resync 刷新为准）。
 * accent 色走 brand 主题阶（border-brand-200 bg-brand-50 text-brand-700，
 * runtimes 页 info 徽标同款组合）。
 */
export function TurnStalledWatchdogBanner(props: { mobile?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-watchdog-hint="true"
      className={cn(
        "flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-5 py-2 text-xs text-brand-700",
        props.mobile && "px-3",
      )}
    >
      <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        本轮长时间无响应，正在与平台核对…（核对期间无需操作；若确认已中断，轮次会按平台数据更新，会话仍可继续）
      </span>
    </div>
  );
}
