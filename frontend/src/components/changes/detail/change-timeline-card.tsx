"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { getChangeTimeline, type TimelineEventItem } from "@/lib/changes";

// ── 真实留痕时间线（2026-09-26-change-real-timeline / FR-02~03）──────────────
// 复刻 CLI `sillyspec watcher timeline --change <名>` 的合成展示：事件轴
// （watcher 观测流）× 任务面（tasks.md 勾选 × 提交锚）× 脚注统计。挂在变更
// 详情页 steps 为空处（thin 轻量变更进度不落库、steps 恒空，主线叙事由本卡
// 承担）；观测事件卡同款范式——useQuery 自取数 30s 轮询、失败静默隐藏。
//
// 红线 D-004 延续：事件恒 provisional（观测语义），本卡只展示不消费、
// 无 mutation；kind → 图标/中文映射对齐 CLI 输出语义（detail 已是 CLI 同源
// 中文文案，label 直显，kind 只决定图标与强调色）。
//
// 2026-09-29-change-detail-timeline-files-polish：展示效果重做——事件轴从
// border-dashed 平铺改「节点圆点 + 连线」竖向时间轴（借 primer Timeline 的
// 节点/连线/tone 视觉语言，行距收紧——事件密集场景 primer 本体 pb-5 太占
// 空间，不直接复用）；卡内容区限高内部滚动（事件/任务多不再撑爆详情页）；
// 事件超过阈值默认只渲染最近一段 +「展开全部」切换；时刻带日期（跨天变更
// 不再只有时分秒产生歧义）。

/** kind → 图标 + 强调态（对齐 CLI watcher timeline 输出行首图标语义）。 */
const KIND_ICON: Record<string, { icon: string; warn?: boolean }> = {
  "file-update": { icon: "📝" },
  "task-done": { icon: "✅" },
  warning: { icon: "⚠️", warn: true },
  commit: { icon: "🔀" },
  archived: { icon: "📦" },
  // watcher-signal-widen 新事件面（2026-09-28-timeline-anchor-scope 补图标）
  "gate-run": { icon: "🔬" },
  "config-change": { icon: "🔧" },
  "fake-check-cleared": { icon: "🩹" },
  verify: { icon: "🧾" },
  // 诞生锚（工件 created_at 补位行，非事件流 kind）
  born: { icon: "🌱" },
};

function eventIcon(kind: string) {
  return KIND_ICON[kind] ?? { icon: "ℹ️" };
}

/** ISO ts → 本地 MM-dd HH:mm:ss（带日期防跨天歧义；失败回退原文）。 */
function eventTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${mm}-${dd} ${d.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

/** 秒 → 中文时长（<60s 显秒；<1h 显分；否则时+分）。 */
function dur(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.floor(seconds / 3600)}h${Math.round((seconds % 3600) / 60)}min`;
}

/** 事件折叠阈值：超过则默认只渲染最近 N 条（较早的可展开）。 */
const EVENT_COLLAPSE_LIMIT = 30;

/** 时间轴节点色调：告警 amber / 提交 brand / 诞生 success / 其余中性。 */
function dotTone(kind: string, warn?: boolean): string {
  if (warn) return "bg-amber-500";
  if (kind === "commit") return "bg-brand-500";
  if (kind === "born") return "bg-success";
  return "bg-muted-foreground/60";
}

/**
 * 时间轴单行：左侧「节点圆点 + 向下连线」（末行不画连线）+ 时刻 + 图标 +
 * 标签。warn 行 amber 强调整行（既有测试锚点：li 级 text-amber-700）。
 */
function TimelineRow({
  testId,
  ts,
  icon,
  label,
  kind,
  warn,
  isLast,
  children,
}: {
  testId?: string;
  ts: string;
  icon: string;
  label: React.ReactNode;
  kind: string;
  warn?: boolean;
  isLast: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li
      data-testid={testId}
      className={`flex gap-2 ${warn ? "text-amber-700" : "text-foreground"}`}
    >
      <span aria-hidden className="flex shrink-0 flex-col items-center self-stretch">
        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dotTone(kind, warn)}`} />
        {!isLast && <span className="mt-0.5 w-px flex-1 bg-border" />}
      </span>
      <div className="min-w-0 flex-1 pb-2 pl-0.5">
        <div className="flex items-baseline gap-2 py-0.5 text-xs leading-5">
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {ts}
          </span>
          <span className="shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

/** 事件行标签：commit 行哈希（brand mono）+ 标题；其余 label 直显。 */
function EventLabel({ e }: { e: TimelineEventItem }) {
  if (e.kind === "commit") {
    return (
      <>
        <span className="font-mono text-[10.5px] text-brand-700">{e.label}</span>
        {e.commit_title ? (
          <span className="ml-1 text-muted-foreground">{e.commit_title}</span>
        ) : null}
      </>
    );
  }
  return <span title={e.label ?? ""}>{e.label ?? e.kind}</span>;
}

export function ChangeTimelineCard({
  workspaceId,
  changeId,
}: {
  workspaceId: string;
  changeId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: ["changeTimeline", workspaceId, changeId],
    queryFn: () => getChangeTimeline(workspaceId, changeId),
    refetchInterval: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 失败/未就绪静默隐藏（观测事件卡同款范式，不阻断详情页）。
  if (query.isError || !query.data) return null;
  // api-types 生成字段保守标 optional（list/stats 带 default 仍可能 undefined）
  // ——运行时 ?? 兜底，旧后端过渡窗口不崩。
  const d = query.data;
  const events = d.events ?? [];
  const tasks = d.tasks ?? [];
  const stats =
    d.stats ?? {
      event_count: 0,
      commit_count: 0,
      checked: 0,
      total: 0,
      wall_clock_s: null,
    };
  if (events.length === 0 && tasks.length === 0 && !d.born_at) return null;
  const wall = dur(stats.wall_clock_s);

  // 事件轴行集：诞生锚（如有）置顶 + 事件流；超阈值折叠较早段（默认最近
  // EVENT_COLLAPSE_LIMIT 行，展开切换在轴顶提示行）。
  const allRows: { testId: string; ts: string; kind: string; label: React.ReactNode; warn?: boolean }[] = [];
  if (d.born_at) {
    allRows.push({
      testId: "change-timeline-event-born",
      ts: d.born_at,
      kind: "born",
      label: <span>变更诞生</span>,
    });
  }
  for (const e of events) {
    allRows.push({
      testId: `change-timeline-event-${e.kind}`,
      ts: e.ts,
      kind: e.kind,
      label: <EventLabel e={e} />,
      warn: eventIcon(e.kind).warn,
    });
  }
  const collapsed = !expanded && allRows.length > EVENT_COLLAPSE_LIMIT;
  const visibleRows = collapsed ? allRows.slice(allRows.length - EVENT_COLLAPSE_LIMIT) : allRows;
  const hiddenCount = allRows.length - visibleRows.length;

  return (
    <section data-testid="change-timeline-card" className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          🧭 真实留痕时间线
          {/* provisional 观测角标（FR-02）：事件流恒 provisional，只展示不消费 */}
          <span className="rounded-full border border-border/60 px-1.5 text-[9px] font-normal text-muted-foreground">
            观测
          </span>
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {wall ? `墙钟 ${wall} · ` : ""}事件 {stats.event_count} · 提交{" "}
          {stats.commit_count}
          {stats.total > 0 ? ` · 勾选 ${stats.checked}/${stats.total}` : ""}
        </span>
      </div>

      <div className="px-3 py-2.5">
        {/* 限高滚动容器：事件/任务多时卡内滚动，不再撑爆详情页 */}
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">事件时间轴</p>
          {hiddenCount > 0 && (
            <button
              type="button"
              data-testid="change-timeline-expand"
              className="mb-1 rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={() => setExpanded(true)}
            >
              已折叠较早的 {hiddenCount} 条事件，点击展开全部 {allRows.length} 条
            </button>
          )}
          {expanded && allRows.length > EVENT_COLLAPSE_LIMIT && (
            <button
              type="button"
              data-testid="change-timeline-collapse"
              className="mb-1 rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={() => setExpanded(false)}
            >
              收起较早事件，仅显示最近 {EVENT_COLLAPSE_LIMIT} 条
            </button>
          )}
          <ul>
            {visibleRows.map((r, i) => {
              const { icon, warn } = eventIcon(r.kind);
              return (
                <TimelineRow
                  key={`${r.testId}-${i}`}
                  testId={r.testId}
                  ts={eventTime(r.ts)}
                  icon={icon}
                  label={r.label}
                  kind={r.kind}
                  warn={warn}
                  isLast={i === visibleRows.length - 1}
                />
              );
            })}
            {visibleRows.length === 0 && (
              <li className="py-1 text-xs text-muted-foreground">暂无观测事件。</li>
            )}
          </ul>

          {tasks.length > 0 ? (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                任务进度（勾选时间 ≈ 为推断值）
              </p>
              <ul data-testid="change-timeline-tasks">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0"
                  >
                    <span className="w-4 shrink-0">{t.checked ? "☑" : "☐"}</span>
                    <span className="w-[6.5rem] shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {t.checked ? (t.time ? `≈${eventTime(t.time)}` : "?") : ""}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {t.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={t.desc}>
                      {t.desc}
                    </span>
                    {t.commit_sha ? (
                      <span className="shrink-0 font-mono text-[10px] text-brand-700">
                        {t.commit_sha}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <p className="mt-2 text-[10px] text-muted-foreground/70">
          时间线由文件监控自动记录，可能不完整（早期事件缺失属正常）；任务勾选时间为推断值。
        </p>
      </div>
    </section>
  );
}
