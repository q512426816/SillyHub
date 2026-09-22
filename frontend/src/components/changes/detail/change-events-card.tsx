"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { listChangeEvents } from "@/lib/changes";

interface ChangeEventsCardProps {
  workspaceId: string;
  /** 本变更 change_key（观测事件流按 change 维度拉取）。 */
  changeKey: string;
}

/**
 * 变更详情页 aside「观测事件」折叠卡（task-06 / FR-05~07 / design D-006）。
 *
 * CLI watcher 旁路推送的 append-only 事件流只读展示：useQuery 自取数（30s 轮询），
 * 失败静默隐藏（QuicklogLinkedCard 同款降级，不影响详情主内容）。
 * D-004 红线：纯展示零业务逻辑——行不可点击、无 mutation、不触发通知/审批。
 */
export function ChangeEventsCard({
  workspaceId,
  changeKey,
}: ChangeEventsCardProps) {
  const query = useQuery({
    queryKey: ["changeEvents", workspaceId, changeKey],
    queryFn: () => listChangeEvents(workspaceId, changeKey, { limit: 200 }),
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  // 折叠态：默认收起；首轮数据含 warning → 自动展开一次（ref 防重置：
  // 之后轮询反复到达不得翻转用户手动折叠/展开的选择）。
  const [open, setOpen] = useState(false);
  const initialOpenSetRef = useRef(false);
  useEffect(() => {
    if (initialOpenSetRef.current || !query.data) return;
    initialOpenSetRef.current = true;
    if ((query.data.items ?? []).some((it) => it.severity === "warning")) {
      setOpen(true);
    }
  }, [query.data]);

  // 失败静默：区块隐藏（约束：不影响详情主内容）
  if (query.isError) return null;

  const items = query.data?.items ?? [];
  const warningCount = items.filter((it) => it.severity === "warning").length;

  return (
    <section
      data-testid="change-events-card"
      className="rounded-md border bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          🔭 观测事件
          {warningCount > 0 && (
            <span
              data-testid="change-events-warning-badge"
              title={`${warningCount} 条 warning 级观测信号`}
              className="inline-flex min-w-[18px] items-center justify-center rounded-full border border-amber-300 bg-amber-100 px-1.5 text-[11px] font-medium leading-4 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {warningCount}
            </span>
          )}
        </h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {open ? "收起 ▲" : "展开 ▼"}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          {query.isPending ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无观测事件</p>
          ) : (
            items.map((it) => {
              const isWarning = it.severity === "warning";
              return (
                <div
                  key={it.id}
                  data-testid={
                    isWarning ? "change-event-row-warning" : undefined
                  }
                  title={it.detail ?? undefined}
                  className={
                    isWarning
                      ? "flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 dark:bg-amber-950/30"
                      : "flex items-center gap-2"
                  }
                >
                  <span
                    className="shrink-0 font-mono text-[10px] text-muted-foreground"
                    title={new Date(it.ts).toISOString()}
                  >
                    {new Date(it.ts).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="shrink-0 text-xs text-foreground">
                    {it.kind}
                  </span>
                  {it.rule ? (
                    <span
                      className="shrink-0 text-[11px] text-muted-foreground"
                      title={it.rule}
                    >
                      ⚖ {it.rule}
                    </span>
                  ) : null}
                  {it.detail ? (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {it.detail}
                    </span>
                  ) : null}
                  {it.provisional && (
                    <Badge
                      variant="outline"
                      title="旁路观测信号，非流程真相"
                      className="shrink-0 cursor-help text-[10px] leading-3"
                    >
                      provisional
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
