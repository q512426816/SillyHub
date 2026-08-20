"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { StatusBadge } from "@/components/ui/status-badge";
import { listQuicklogEntries } from "@/lib/quicklog";

// 状态徽标映射（与 quicklog-table / quicklog-drawer 同口径，D-007 派生后 4 态）
const STATUS_META: Record<
  string,
  { label: string; kind: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  completed: { label: "已完成", kind: "success" },
  in_progress: { label: "进行中", kind: "info" },
  partial_done: { label: "已暂存", kind: "warning" },
  stale: { label: "疑似中断", kind: "error" },
};

interface QuicklogLinkedCardProps {
  workspaceId: string;
  /** 本变更 change_key（作为 linked_change 筛选参数）。 */
  changeKey: string;
}

/**
 * 变更详情页反向「关联的快速任务」区块（task-10 / FR-07）。
 * linked_change 筛选拉取，只读展示；点击条目跳变更中心快速修复 tab。
 * 拉取失败静默降级（区块隐藏），不影响详情主内容。
 */
export function QuicklogLinkedCard({
  workspaceId,
  changeKey,
}: QuicklogLinkedCardProps) {
  const query = useQuery({
    queryKey: ["quicklogLinked", workspaceId, changeKey],
    queryFn: () =>
      listQuicklogEntries(workspaceId, {
        linked_change: changeKey,
        // 含空壳占位（ql-20260820-008）：进行中关联 quick 任务也可见
        include_placeholder: true,
        page_size: 20,
      }),
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // 失败静默：区块隐藏（约束：不影响详情主内容）
  if (query.isError) return null;

  const items = query.data?.items ?? [];

  return (
    <section
      data-testid="quicklog-linked-card"
      className="rounded-md border bg-card"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">⚡ 关联的快速任务</h2>
        {query.data && items.length > 0 && (
          <span className="inline-block min-w-[18px] rounded-full bg-muted px-1.5 text-center text-[11px] text-muted-foreground">
            {query.data.total}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {query.isPending ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无关联快速任务</p>
        ) : (
          items.map((it) => {
            const m = STATUS_META[it.status] ?? {
              label: it.status,
              kind: "neutral" as const,
            };
            return (
              <Link
                key={it.ql_id}
                href={`/workspaces/${workspaceId}/changes?tab=quicklog`}
                prefetch={false}
                className="group flex items-center gap-2"
                title={it.title}
              >
                <StatusBadge kind={m.kind}>{m.label}</StatusBadge>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground group-hover:underline">
                  {it.placeholder ? (
                    <span className="italic text-muted-foreground">
                      （空壳占位）
                    </span>
                  ) : (
                    it.title
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {it.timestamp
                    ? new Date(it.timestamp).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
