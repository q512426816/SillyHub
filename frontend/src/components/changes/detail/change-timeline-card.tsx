"use client";

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

/** kind → 图标 + 强调态（对齐 CLI watcher timeline 输出行首图标语义）。 */
const KIND_ICON: Record<string, { icon: string; warn?: boolean }> = {
  "file-update": { icon: "📝" },
  "task-done": { icon: "✅" },
  warning: { icon: "⚠️", warn: true },
  commit: { icon: "🔀" },
  archived: { icon: "📦" },
};

function eventIcon(kind: string) {
  return KIND_ICON[kind] ?? { icon: "ℹ️" };
}

/** ISO ts → 本地 HH:mm:ss（失败回退原文，页面既有步骤时间线同款宽容）。 */
function hhmmss(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

/** 秒 → 中文时长（<60s 显秒；<1h 显分；否则时+分）。 */
function dur(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.floor(seconds / 3600)}h${Math.round((seconds % 3600) / 60)}min`;
}

function EventRow({ e }: { e: TimelineEventItem }) {
  const { icon, warn } = eventIcon(e.kind);
  return (
    <li
      data-testid={`change-timeline-event-${e.kind}`}
      className={`flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 ${
        warn ? "text-amber-700" : "text-foreground"
      }`}
    >
      <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {hhmmss(e.ts)}
      </span>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate" title={e.commit_title ?? e.label ?? ""}>
        {e.kind === "commit" ? (
          <>
            <span className="font-mono text-[10.5px] text-brand-700">{e.label}</span>
            {e.commit_title ? (
              <span className="ml-1 text-muted-foreground">{e.commit_title}</span>
            ) : null}
          </>
        ) : (
          (e.label ?? e.kind)
        )}
      </span>
    </li>
  );
}

export function ChangeTimelineCard({
  workspaceId,
  changeId,
}: {
  workspaceId: string;
  changeId: string;
}) {
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
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">事件时间轴</p>
        <ul className="mb-3">
          {d.born_at ? (
            <li
              data-testid="change-timeline-event-born"
              className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs"
            >
              <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {hhmmss(d.born_at)}
              </span>
              <span className="shrink-0">🁢</span>
              <span>变更诞生（工件 created_at）</span>
            </li>
          ) : null}
          {events.map((e, i) => (
            <EventRow key={`${e.ts}-${i}`} e={e} />
          ))}
          {events.length === 0 && !d.born_at ? (
            <li className="py-1 text-xs text-muted-foreground">暂无观测事件。</li>
          ) : null}
        </ul>

        {tasks.length > 0 ? (
          <>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              任务面（勾选 × 提交锚，顺序推断）
            </p>
            <ul data-testid="change-timeline-tasks">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0"
                >
                  <span className="w-4 shrink-0">{t.checked ? "☑" : "☐"}</span>
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
          </>
        ) : null}

        <p className="mt-2 text-[10px] text-muted-foreground/70">
          观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；任务勾选与提交锚为顺序推断。
        </p>
      </div>
    </section>
  );
}
