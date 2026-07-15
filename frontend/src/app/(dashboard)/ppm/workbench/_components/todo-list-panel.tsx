"use client";

/**
 * TodoListPanel — 个人工作台待办列表 (task-10 / FR-06 / D-005@v1 / D-006@v1)。
 *
 * 左栏「我的待办」:渲染 summary.todos(后端 task-04 派生,top N),每条 name +
 * type 徽标。type 徽标按 source/type 分支映射颜色(参照原型 type 标签「计划/
 * 缺陷/工时/任务」)。
 *
 * 组件为纯展示(不调接口,不派生):todos 由 task-08 page.tsx 装配
 * fetchWorkbenchSummary → summary.todos 后下传(constraints:避免双重请求)。
 * todos 为空/null → EmptyState「暂无待办」不报错。
 *
 * 点击待办按来源跳转(D-增强):plan_task→/ppm/task-plans,problem_change→
 * /ppm/problem-changes,其余 problem_*→/ppm/problem-list,便于从工作台下钻到具体业务列表。
 *
 * type 徽标映射:
 *   source="plan_task"              → warning  「任务」
 *   source="problem_audit"/"change" → destructive 「缺陷」
 *   type 含「工时」                  → info      「工时」
 *   type 含「计划」                  → default   「计划」
 *   其余                            → outline   type 原文
 */
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkbenchTodoItem } from "@/lib/ppm/types";

export interface TodoListPanelProps {
  /** 后端派生的待办列表;null/空数组渲染空态。 */
  todos: WorkbenchTodoItem[] | null;
  /** 加载态(预留,当前由 page 控制 SectionCard 文案)。 */
  loading?: boolean;
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

export function TodoListPanel({ todos, loading }: TodoListPanelProps) {
  const router = useRouter();
  const count = todos?.length ?? 0;
  const isEmpty = !loading && count === 0;

  /** 按来源跳转:任务待办→任务计划页,问题变更→问题变更页,其余问题→问题清单页。 */
  const goTodo = (todo: WorkbenchTodoItem) => {
    const src = todo.source ?? "";
    if (src === "plan_task") {
      router.push("/ppm/task-plans");
    } else if (src === "problem_change") {
      router.push("/ppm/problem-changes");
    } else if (src.startsWith("problem")) {
      router.push("/ppm/problem-list");
    }
  };

  return (
    <SectionCard
      title="我的待办"
      extra={
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      }
      bodyPadding="p-0"
    >
      {isEmpty ? (
        <EmptyState title="暂无待办" />
      ) : (
        <ul className="divide-y divide-border">
          {todos?.map((todo) => {
            const badge = todoBadge(todo);
            const clickable =
              todo.source === "plan_task" ||
              (todo.source ?? "").startsWith("problem");
            return (
              <li
                key={todo.id}
                className={`flex items-center gap-2 px-3 py-2 ${
                  clickable
                    ? "cursor-pointer hover:bg-muted/50"
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
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
