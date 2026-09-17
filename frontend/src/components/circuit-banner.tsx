"use client";

/**
 * CircuitBreakerBanner — 全局熔断横幅（ql-20260917-011）。
 *
 * 订阅 api-circuit：开闸时在视口顶部显示细条提示「连接中断、已暂停自动
 * 请求、稍后自动恢复」；半开探测成功关闸后自动消失。用户无操作负担——
 * 部署窗口/后端劣化的几分钟里，查询与 SSE 已被熔断暂停，横幅解释页面
 * 数据为何静止。
 */

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

import { subscribeCircuit } from "@/lib/api-circuit";

export function CircuitBreakerBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return subscribeCircuit((s) => setOpen(s.open));
  }, []);

  if (!open) return null;
  return (
    <div
      data-testid="circuit-banner"
      className="fixed inset-x-0 top-0 z-[1100] flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-1.5 text-xs text-warning backdrop-blur-sm"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>与服务器的连接暂时中断，已暂停自动请求，稍后自动恢复…</span>
    </div>
  );
}
