"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listChangeEvents, type ChangeEventItem } from "@/lib/change-events";

/** provisional 徽标悬停文案（逐字，design 全局硬约束）。 */
const PROVISIONAL_TOOLTIP = "旁路观测信号，非流程真相";

/** 轮询间隔（30s，D-005；不做实时推送——非目标）。 */
const POLL_INTERVAL_MS = 30_000;

function isWarning(ev: ChangeEventItem): boolean {
  return ev.severity === "warning";
}

/** ISO ts 就地短显（去 T/Z 降噪音；畸形串回退原文——组件内防御）。 */
function shortTs(ts: string): string {
  return ts.length >= 16 ? `${ts.slice(5, 10)} ${ts.slice(11, 19)}` : ts;
}

interface ChangeObservationEventsCardProps {
  /** 本变更 change_key（sillyspec 变更名，事件通道 URL 段）。 */
  changeKey: string;
}

/**
 * 变更详情页「观测事件」折叠区（2026-09-26-change-events-r18-full task-03 / FR-07 / FR-08）。
 *
 * 红线 D-004：零业务逻辑——纯渲染组件，无 mutation/无路由跳转/无审批交互；
 * provisional 事件只展示不消费。
 *
 * - 打开 GET 一次 + 30s 轮询（useQuery refetchInterval，D-005）；
 * - 缺省收起；存在 severity=warning 事件时默认展开；
 * - 头部角标：有 warning 显 warning 计数（琥珀），无 warning 显事件总数；
 * - warning 行琥珀高亮；空态「暂无观测事件」；
 * - 拉取失败静默隐藏（return null），不阻断详情页主内容（QuicklogLinkedCard 同款先例）。
 */
export function ChangeObservationEventsCard({
  changeKey,
}: ChangeObservationEventsCardProps) {
  const query = useQuery({
    queryKey: ["changeObservationEvents", changeKey],
    queryFn: () => listChangeEvents(changeKey),
    retry: false,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  const events = query.data?.items ?? [];
  const warningCount = events.filter(isWarning).length;
  const [open, setOpen] = useState(false);
  // 首批数据到达且有 warning → 默认展开（仅首批生效：useState 惰性初始化后不再自动改，
  // 用户手动折叠不回弹；用 query.data 到达后的渲染态驱动首开，通过受控补偿实现：
  // open===null 表示「未被用户触碰」，null 时按 hasWarning 渲染）。
  const [touched, setTouched] = useState(false);
  const effectiveOpen = touched ? open : warningCount > 0;

  // 失败静默：区块隐藏（约束：不影响详情主内容）
  if (query.isError) return null;

  const badgeText = warningCount > 0 ? String(warningCount) : String(events.length);
  const badgeCls =
    warningCount > 0
      ? "bg-amber-500 text-white"
      : "bg-muted text-muted-foreground";

  return (
    <section
      data-testid="change-observation-events-card"
      className="rounded-md border bg-card"
    >
      <button
        type="button"
        data-testid="change-observation-events-toggle"
        aria-expanded={effectiveOpen}
        onClick={() => {
          // 相对「当前展示态」翻转（open 初值 false 与 warning 默认展开态解耦，
          // 首点即收起；touched 后不再随数据变化自动改——用户意图优先）。
          setTouched(true);
          setOpen(!effectiveOpen);
        }}
        className="flex w-full items-center justify-between border-b px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <h2 className="text-xs font-medium">📡 观测事件</h2>
        <span className="flex items-center gap-1.5">
          {events.length > 0 && (
            <span
              data-testid="change-observation-events-badge"
              title={warningCount > 0 ? "warning 事件数" : "事件总数"}
              className={`inline-block min-w-[18px] rounded-full px-1.5 text-center text-[11px] leading-[18px] ${badgeCls}`}
            >
              {badgeText}
            </span>
          )}
          <span
            className={`text-[11px] text-muted-foreground transition-transform ${effectiveOpen ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        </span>
      </button>
      {effectiveOpen && (
        <div
          data-testid="change-observation-events-body"
          className="flex flex-col gap-1.5 px-3 py-2.5"
        >
          {query.isPending ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : events.length === 0 ? (
            <p data-testid="change-observation-events-empty" className="text-xs text-muted-foreground">
              暂无观测事件
            </p>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                data-testid={`change-observation-event-${ev.id}`}
                data-severity={ev.severity}
                className={`rounded border px-2 py-1.5 text-xs ${
                  isWarning(ev)
                    ? "border-amber-300 bg-amber-50"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {shortTs(ev.ts)}
                  </span>
                  <span className="rounded border px-1 text-[10px] text-foreground/70">
                    {ev.kind}
                  </span>
                  <span className="text-foreground/80">{ev.rule}</span>
                  {ev.provisional && (
                    <span
                      title={PROVISIONAL_TOOLTIP}
                      className="cursor-help rounded border border-dashed border-brand-300 px-1 text-[10px] text-brand-600"
                    >
                      provisional
                    </span>
                  )}
                </div>
                {ev.detail && (
                  <p className="mt-1 break-all text-[11px] text-foreground/70">
                    {ev.detail}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
