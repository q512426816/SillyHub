"use client";

/**
 * TodoListPanel — 个人工作台待办列表 (task-10 / FR-01 / D-001@v1)。
 *
 * 左栏「我的待办」:**自带 fetch** 调 `/workbench/todos`(分页,默认每页 10 条),
 * 支持 targetUserId(切换用户后跟随目标)。底部分页器上一页/下一页 + 共 N 条,
 * 标题徽标显示 total。
 *
 * type 徽标按 source/type 分支映射颜色(参照原型 type 标签「计划/缺陷/工时/任务」)。
 * 点击待办按来源跳转:plan_task→/ppm/task-plans,其余 problem_*→/ppm/problem-list。
 *
 * 空态「暂无待办」;loading/error 各独立兜底。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { fetchWorkbenchTodos } from "@/lib/ppm/workbench";
import type { WorkbenchTodoItem } from "@/lib/ppm/types";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

/** 默认每页条数(FR-1)。 */
const PAGE_SIZE = 10;

export interface TodoListPanelProps {
  /** 切换查看的目标用户 id;null/undefined=当前登录人。切换时重置到第 1 页。 */
  targetUserId?: string | null;
}

interface BadgeStyle {
  variant:
    | "default"
    | "info"
    | "success"
    | "warning"
    | "destructive"
    | "error"
    | "outline";
  label: string;
}

/**
 * type → Badge variant + 文案。
 *
 * source 是结构化来源(优先判),type 是后端给的标签字符串(按内容兜底)。
 */
function todoBadge(todo: WorkbenchTodoItem): BadgeStyle {
  const source = todo.source ?? "";
  const type = todo.type ?? "";

  // 1. 结构化来源优先
  if (source === "plan_task") {
    return { variant: "warning", label: "任务" };
  }
  if (source === "problem_audit" || source === "problem_change") {
    return { variant: "destructive", label: "缺陷" };
  }

  // 2. 标签文案兜底(后端 type 字符串按内容分支)
  if (type.includes("工时")) {
    return { variant: "info", label: "工时" };
  }
  if (type.includes("计划")) {
    return { variant: "default", label: "计划" };
  }
  if (type.includes("任务")) {
    return { variant: "warning", label: "任务" };
  }
  if (type.includes("缺陷") || type.includes("问题")) {
    return { variant: "destructive", label: "缺陷" };
  }

  // 3. 其余:outline + type 原文
  return { variant: "outline", label: type || "待办" };
}

export function TodoListPanel({ targetUserId }: TodoListPanelProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkbenchTodoItem[]>([]);
  const [total, setTotal] = useState(0);

  // targetUserId 变化 → 重置到第 1 页
  useEffect(() => {
    setPage(1);
  }, [targetUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWorkbenchTodos(targetUserId ?? null, page, PAGE_SIZE);
      setItems(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载待办失败");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && !error && items.length === 0;

  /** 按来源跳转:任务待办→任务计划页,其余问题待办→问题清单页。 */
  const goTodo = (todo: WorkbenchTodoItem) => {
    const src = todo.source ?? "";
    if (src === "plan_task") {
      router.push("/ppm/task-plans");
    } else {
      router.push("/ppm/problem-list");
    }
  };

  return (
    <SectionCard
      title="我的待办"
      extra={
        <Badge variant="info" className="tabular-nums">
          {total}
        </Badge>
      }
      bodyPadding="p-0"
    >
      {error ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-xs text-destructive">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      ) : isEmpty ? (
        <EmptyState title="暂无待办" />
      ) : (
        <ul className="divide-y divide-border">
          {loading && items.length === 0
            ? null
            : items.map((todo) => {
                const badge = todoBadge(todo);
                const clickable =
                  todo.source === "plan_task" ||
                  (todo.source ?? "").startsWith("problem");
                return (
                  <li
                    key={todo.id}
                    className={`flex items-center gap-2 px-4 py-2.5 ${
                      clickable
                        ? "group cursor-pointer transition-colors hover:bg-muted/50"
                        : "cursor-default"
                    }`}
                    onClick={() => clickable && goTodo(todo)}
                  >
                    <Badge variant={badge.variant} className="shrink-0">
                      {badge.label}
                    </Badge>
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-foreground"
                      title={todo.name}
                    >
                      {todo.name}
                    </span>
                    {clickable ? (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                    ) : null}
                  </li>
                );
              })}
        </ul>
      )}

      {/* 分页器:上一页 / 页码 / 下一页 / 共 N 条 / 每页 10 条 */}
      {total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            第 {page}/{totalPages} 页 · 共 {total} 条 · 每页 {PAGE_SIZE} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-border px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-border px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
