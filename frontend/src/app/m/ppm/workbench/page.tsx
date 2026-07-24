"use client";

/**
 * 个人工作台 · 移动视图（task-08 / FR-04 / D-001 / D-003 / D-008）。
 *
 * 桌面三栏（左：个人信息/待办；中：指标/我的任务；右：工作日历/快捷入口）在手机重排为
 * **纵向单列卡片流**，无横向滚动。
 *
 * - 数据层 100% 复用 @/lib/ppm/workbench（D-003，禁止自写请求）：
 *     fetchWorkbenchProfile / fetchWorkbenchSummary(range) / fetchWorkbenchCalendar(yearMonth)
 *   类型取 @/lib/ppm/types。
 * - 沿用桌面 BlockState<T> 装配（apiFetch + useEffect + 每块独立 try/catch）：profile /
 *   summary / calendar 三块互不阻塞；summaryRange（本周/本月/全部）与 calendarMonth（YYYY-MM）
 *   切换分别重载 summary / calendar。
 * - 渲染层独立（D-001）：移动卡片自绘，不复用桌面 (dashboard)/ppm/workbench/** 组件
 *   （桌面零回归硬约束）。仅复用 UI 无关的通用小工具 useToast/Toast/taskStatusTag
 *   （@/app/(dashboard)/ppm/shared，纯逻辑无桌面样式依赖）。
 * - 触摸热区 ≥ 44×44px、正文 ≥ 14px（R-04）。
 * - 入口与桌面对齐（D-008）：待办 → 任务计划/问题清单；我的任务 → 任务计划（执行回跳入口）；
 *   快捷入口 → 问题清单/任务计划（平台切换由底部 TabBar 全局提供，不重复）。
 * - 容器由 task-05 MobileLayoutShell（app/m/layout.tsx）自动包裹，本页只渲染卡片流本身。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import {
  Bug,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Hourglass,
  ListChecks,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { ApiError } from "@/lib/api";
import {
  fetchWorkbenchCalendar,
  fetchWorkbenchProfile,
  fetchWorkbenchSummary,
  fetchWorkbenchSwitchableUsers,
  fetchWorkbenchTodos,
} from "@/lib/ppm/workbench";
import type {
  CalendarDay,
  PageResp,
  WorkbenchCalendar,
  WorkbenchProfile,
  WorkbenchSummary,
  WorkbenchSwitchableUser,
  WorkbenchTodoItem,
} from "@/lib/ppm/types";
import { cn } from "@/lib/utils";
import { taskStatusTag } from "@/app/(dashboard)/ppm/shared";

/** 单区块加载状态：独立 loading/error + data（三块互不阻塞，镜像桌面 page.tsx BlockState）。 */
interface BlockState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function initialBlock<T>(): BlockState<T> {
  return { loading: true, error: null, data: null };
}

/** 指标统计范围（对齐 fetchWorkbenchSummary 的 range 入参）。 */
type MetricRange = "week" | "month" | "all";

const RANGE_OPTIONS: { value: MetricRange; label: string }[] = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "all", label: "全部" },
];

/** null/空串兜底「—」（对齐桌面 ProfileSummaryCard.placeholder）。 */
function placeholder(v: string | null | undefined): string {
  return v && v.trim() !== "" ? v : "—";
}

export default function WorkbenchMobilePage() {
  const [profile, setProfile] = useState<BlockState<WorkbenchProfile>>(initialBlock);
  const [summary, setSummary] = useState<BlockState<WorkbenchSummary>>(initialBlock);
  // 指标范围（默认本月）：切换重载 summary。
  const [summaryRange, setSummaryRange] = useState<MetricRange>("month");
  const [calendar, setCalendar] = useState<BlockState<WorkbenchCalendar>>(initialBlock);
  // 工作日历当前月份（默认当月，可切换重载）。
  const [calendarMonth, setCalendarMonth] = useState<string>(() =>
    dayjs().format("YYYY-MM"),
  );
  // 切换用户（FR-02）：null=我自己；否则目标用户 id。整页 profile/指标/日历/待办跟随。
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  // 可切换用户列表（登录人可见集；非经理/非超管为空）。
  const [switchableUsers, setSwitchableUsers] = useState<WorkbenchSwitchableUser[]>([]);

  const loadProfile = useCallback(async () => {
    setProfile((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchProfile(targetUserId);
      setProfile({ loading: false, error: null, data });
    } catch (err) {
      setProfile({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载个人信息失败",
        data: null,
      });
    }
  }, [targetUserId]);

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchSummary(summaryRange, targetUserId);
      setSummary({ loading: false, error: null, data });
    } catch (err) {
      setSummary({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载指标失败",
        data: null,
      });
    }
  }, [summaryRange, targetUserId]);

  const loadCalendar = useCallback(async () => {
    setCalendar((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchCalendar(calendarMonth, targetUserId);
      setCalendar({ loading: false, error: null, data });
    } catch (err) {
      setCalendar({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载日历失败",
        data: null,
      });
    }
  }, [calendarMonth, targetUserId]);

  // 首屏：profile + summary 并行装配（任务表不在工作台内装配，见「我的任务」入口卡）。
  useEffect(() => {
    void loadProfile();
    void loadSummary();
  }, [loadProfile, loadSummary]);

  // 日历跟随 calendarMonth 切换重载。
  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  // 可切换用户列表（一次拉；仅登录人能力相关，不随 target 变）。
  useEffect(() => {
    void fetchWorkbenchSwitchableUsers()
      .then(setSwitchableUsers)
      .catch(() => {
        // 忽略：切换入口缺失不影响工作台
      });
  }, []);

  // can_view_others 始终反映登录人（后端 profile.can_view_others = actor 能力）
  const canViewOthers = profile.data?.can_view_others ?? false;
  const isViewingOther = targetUserId !== null;

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1 pb-1">
        <h1 className="text-[18px] font-semibold text-foreground">个人工作台</h1>
        <p className="text-[12px] text-muted-foreground">
          我的任务 / 指标 / 工作日历
        </p>
      </header>

      {/* 切换查看他人时提示条 + 返回我自己 */}
      {isViewingOther ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <span className="min-w-0 truncate">
            查看「{profile.data?.display_name ?? "他人"}」的工作台
          </span>
          <button
            type="button"
            onClick={() => setTargetUserId(null)}
            className="inline-flex min-h-[36px] shrink-0 items-center rounded-md border border-amber-400 bg-white px-3 text-[12px] font-medium text-amber-700"
          >
            返回我自己
          </button>
        </div>
      ) : null}

      {/* ① 个人信息（左栏顶） + 切换用户入口 */}
      {profile.loading || profile.error ? (
        <BlockFallback
          title="个人信息"
          loading={profile.loading}
          error={profile.error}
          onRetry={loadProfile}
        />
      ) : (
        <ProfileCard
          profile={profile.data}
          canViewOthers={canViewOthers}
          switchableUsers={switchableUsers}
          targetUserId={targetUserId}
          onSwitchUser={setTargetUserId}
        />
      )}

      {/* ② 我的待办（分页，跟随 target；当前页独有，桌面左栏对齐） */}
      <TodoCard targetUserId={targetUserId} />

      {/* ③ 指标（中栏）：range 切换重载 summary */}
      {summary.loading || summary.error ? (
        <BlockFallback
          title="指标"
          loading={summary.loading}
          error={summary.error}
          onRetry={loadSummary}
        />
      ) : (
        <MetricsCard
          summary={summary.data}
          range={summaryRange}
          onRangeChange={setSummaryRange}
        />
      )}

      {/* ③ 工作日历（右栏）：月份切换重载 calendar */}
      {calendar.data ? (
        <CalendarBlock
          calendar={calendar.data}
          loading={calendar.loading}
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
        />
      ) : (
        <BlockFallback
          title="工作日历"
          loading={calendar.loading}
          error={calendar.error}
          onRetry={loadCalendar}
        />
      )}

      {/* ④ 快捷入口（右栏）：与桌面 QuickEntryGrid 对齐 */}
      <QuickEntriesCard />
    </div>
  );
}

/* ============================== 通用移动卡片 ============================== */

/**
 * 移动卡片容器：圆角描边 + 标题栏（可选 extra，如 range 切换器）+ body。
 * 不复用桌面 SectionCard（D-001 独立渲染）；正文 ≥ 14px。
 */
function MobileCard({
  title,
  extra,
  children,
  bodyClass = "p-3",
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <section
      data-testid="mobile-card"
      className="rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {extra}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** 区块兜底：loading 骨架文案 / error + 重新加载（触摸 ≥ 44px）。三块互不阻塞。 */
function BlockFallback({
  title,
  loading,
  error,
  onRetry,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <MobileCard title={title}>
      {loading ? (
        <div className="py-2 text-[14px] text-muted-foreground animate-pulse">
          加载中…
        </div>
      ) : (
        <div className="flex items-center gap-2 py-1">
          <span className="text-[14px] text-destructive">{error}</span>
          <button
            type="button"
            onClick={() => void onRetry()}
            className="inline-flex min-h-[44px] items-center rounded-md px-3 text-[14px] font-medium text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      )}
    </MobileCard>
  );
}

/* ============================== ① 个人信息 ============================== */

function ProfileCard({
  profile,
  canViewOthers,
  switchableUsers,
  targetUserId,
  onSwitchUser,
}: {
  profile: WorkbenchProfile | null;
  canViewOthers: boolean;
  switchableUsers: WorkbenchSwitchableUser[];
  targetUserId: string | null;
  onSwitchUser: (userId: string | null) => void;
}) {
  const role = profile?.role_name?.trim();
  const showSwitch = canViewOthers && switchableUsers.length > 0;
  return (
    <MobileCard title="个人信息" bodyClass="p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-[20px] font-bold text-white shadow-md shadow-blue-600/20"
          aria-hidden
        >
          {profile?.avatar_text && profile.avatar_text.trim() !== ""
            ? profile.avatar_text
            : "?"}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[16px] font-semibold text-foreground">
              {placeholder(profile?.display_name)}
            </span>
            {role ? (
              <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[12px] font-medium text-blue-600">
                {role}
              </span>
            ) : null}
          </div>
          <span className="text-[13px] text-muted-foreground">
            工号：{placeholder(profile?.employee_no)}
          </span>
          <span className="text-[13px] text-muted-foreground">
            部门：{placeholder(profile?.department_name)}
          </span>
        </div>
      </div>
      {/* 切换查看其他成员工作台（仅经理 ‖ super_admin 且有可切换用户） */}
      {showSwitch ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <label className="mb-1 block text-[12px] text-muted-foreground">
            切换查看其他成员
          </label>
          <select
            value={targetUserId ?? "__me__"}
            onChange={(e) =>
              onSwitchUser(e.target.value === "__me__" ? null : e.target.value)
            }
            className="min-h-[44px] w-full rounded-md border border-border bg-background px-2 text-[14px] text-foreground"
          >
            <option value="__me__">我自己</option>
            {switchableUsers.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {placeholder(u.display_name)}
                {u.department_name ? `（${u.department_name}）` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </MobileCard>
  );
}

/* ============================== ② 我的待办（分页） ============================== */

/** 待办 type → 移动徽标色（对齐桌面 TodoListPanel 映射）。 */
function todoTagCls(todo: WorkbenchTodoItem): { cls: string; label: string } {
  const src = todo.source ?? "";
  if (src === "plan_task") return { cls: "bg-amber-100 text-amber-700", label: "任务" };
  if (src === "problem_audit" || src === "problem_change")
    return { cls: "bg-red-100 text-red-700", label: "缺陷" };
  const t = todo.type ?? "";
  if (t.includes("工时")) return { cls: "bg-blue-100 text-blue-700", label: "工时" };
  if (t.includes("计划")) return { cls: "bg-slate-100 text-slate-700", label: "计划" };
  return { cls: "bg-slate-100 text-slate-700", label: t || "待办" };
}

/** 待办点击跳转目标（按来源）。 */
function todoHref(todo: WorkbenchTodoItem): string | null {
  const src = todo.source ?? "";
  if (src === "plan_task") return "/ppm/task-plans";
  if (src.startsWith("problem")) return "/ppm/problem-list";
  return null;
}

const TODO_PAGE_SIZE = 10;

function TodoCard({ targetUserId }: { targetUserId: string | null }) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkbenchTodoItem[]>([]);
  const [total, setTotal] = useState(0);

  // target 变化 → 重置第 1 页
  useEffect(() => {
    setPage(1);
  }, [targetUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWorkbenchTodos(targetUserId, page, TODO_PAGE_SIZE);
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

  const totalPages = Math.max(1, Math.ceil(total / TODO_PAGE_SIZE));
  const isEmpty = !loading && !error && items.length === 0;

  return (
    <MobileCard
      title="我的待办"
      extra={
        <span className="rounded-full bg-indigo-100 px-2 text-[12px] font-medium text-indigo-700 tabular-nums">
          {total}
        </span>
      }
    >
      {error ? (
        <div className="flex items-center gap-2 py-1">
          <span className="text-[14px] text-destructive">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[14px] text-blue-600"
          >
            重新加载
          </button>
        </div>
      ) : isEmpty ? (
        <div className="py-2 text-[14px] text-muted-foreground/70">暂无待办</div>
      ) : (
        <ul className="space-y-1">
          {items.map((todo) => {
            const tag = todoTagCls(todo);
            const href = todoHref(todo);
            const inner = (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium",
                    tag.cls,
                  )}
                >
                  {tag.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]" title={todo.name}>
                  {todo.name}
                </span>
              </div>
            );
            return (
              <li key={todo.id} className="min-h-[36px] py-1">
                {href ? (
                  <Link href={href} className="block active:opacity-70">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 移动分页器 */}
      {total > 0 ? (
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[12px] text-muted-foreground">
          <span>
            {page}/{totalPages} 页 · 共 {total} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded border border-border disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded border border-border disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </MobileCard>
  );
}

/* ============================== ③ 指标 ============================== */

/** 指标语义色（对齐桌面 PersonalMetricStrip 配色）。 */
type MetricColor = "blue" | "green" | "amber" | "cyan" | "red";
const METRIC_TILE: Record<MetricColor, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  cyan: "bg-cyan-50 text-cyan-600",
  red: "bg-red-50 text-red-600",
};
const METRIC_TEXT: Record<MetricColor, string> = {
  blue: "text-blue-600",
  green: "text-emerald-600",
  amber: "text-amber-600",
  cyan: "text-cyan-600",
  red: "text-red-600",
};

function MetricsCard({
  summary,
  range,
  onRangeChange,
}: {
  summary: WorkbenchSummary | null;
  range: MetricRange;
  onRangeChange: (r: MetricRange) => void;
}) {
  const metrics = summary?.metrics ?? null;
  const prefix = range === "week" ? "本周" : range === "month" ? "本月" : "";

  const items: {
    key: string;
    label: string;
    value: string;
    color: MetricColor;
    icon: LucideIcon;
    /** 存在即整块可点，跳转对应页面（指标下钻）。 */
    href?: string;
  }[] = [
    {
      key: "task_count",
      label: `${prefix}任务量`,
      value: metrics ? `${metrics.task_count}条` : "—",
      color: "blue",
      icon: ClipboardList,
      href: "/ppm/task-plans",
    },
    {
      key: "completion_rate",
      label: `${prefix}完成率`,
      value:
        !metrics || metrics.task_count === 0
          ? "—"
          : `${Math.round(metrics.completion_rate * 100)}%`,
      color: "green",
      icon: TrendingUp,
    },
    {
      key: "delay_rate",
      label: `${prefix}延期率`,
      value:
        !metrics || metrics.task_count === 0
          ? "—"
          : `${Math.round(metrics.delay_rate * 100)}%`,
      color: "amber",
      icon: Hourglass,
    },
    {
      key: "work_hours",
      label: `${prefix}工时`,
      value: metrics ? `${metrics.work_hours}天` : "—",
      color: "cyan",
      icon: Clock3,
    },
    {
      key: "defect_count",
      label: "缺陷数量",
      value: metrics ? `${metrics.defect_count}条` : "—",
      color: "red",
      icon: Bug,
      href: "/ppm/problem-list",
    },
  ];

  return (
    <MobileCard
      title="指标"
      extra={
        <div
          role="tablist"
          aria-label="指标范围"
          className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={range === opt.value}
              onClick={() => onRangeChange(opt.value)}
              className={cn(
                "min-h-[36px] rounded-md px-3 text-[13px] transition",
                range === opt.value
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {items.map((m) => {
          const Icon = m.icon;
          const inner = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground">{m.label}</span>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-lg",
                    METRIC_TILE[m.color],
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
              </div>
              <div
                className={cn(
                  "mt-1.5 text-[22px] font-bold leading-tight tabular-nums",
                  METRIC_TEXT[m.color],
                )}
              >
                {m.value}
              </div>
            </>
          );
          return m.href ? (
            <Link
              key={m.key}
              href={m.href}
              aria-label={`${m.label}，点击查看`}
              className="block cursor-pointer rounded-xl border border-border/60 bg-muted/30 p-2.5 transition hover:bg-muted/60 active:scale-[0.99]"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={m.key}
              className="rounded-xl border border-border/60 bg-muted/30 p-2.5"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </MobileCard>
  );
}

/* ============================== ③ 工作日历 ============================== */

const WEEK_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

/** 月历格子：1 号前按星期补前导空格 + 当月每日 + 尾部补齐到 42 格（固定高度防切换跳动）。 */
function buildMonthGrid(
  yearMonth: string,
  days: CalendarDay[],
): Array<{ type: "blank" } | { type: "day"; day: number; info: CalendarDay | null }> {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return [];

  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const dayMap = new Map<string, CalendarDay>();
  for (const d of days) {
    if (!d?.date) continue;
    dayMap.set(d.date.slice(8, 10), d);
  }

  const cells: Array<
    { type: "blank" } | { type: "day"; day: number; info: CalendarDay | null }
  > = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push({ type: "blank" });
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = String(day).padStart(2, "0");
    cells.push({ type: "day", day, info: dayMap.get(dd) ?? null });
  }
  while (cells.length < 42) cells.push({ type: "blank" });
  return cells;
}

/** 左点 · 任务负载（none 灰 / leisure 黄 / full 绿 / over 红）。 */
function loadDotClass(level: string | undefined): string {
  switch (level) {
    case "leisure":
      return "bg-amber-500";
    case "full":
      return "bg-emerald-500";
    case "over":
      return "bg-red-500";
    default:
      return "bg-slate-300";
  }
}

/** 右点 · 进度预警（none 灰 / green 绿 / yellow 黄 / red 红）。 */
function alertDotClass(level: string | undefined): string {
  switch (level) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-500";
    case "red":
      return "bg-red-500";
    default:
      return "bg-slate-300";
  }
}

function CalendarBlock({
  calendar,
  loading,
  month,
  onMonthChange,
}: {
  calendar: WorkbenchCalendar;
  loading: boolean;
  month: string;
  onMonthChange: (m: string) => void;
}) {
  const cells = useMemo(() => buildMonthGrid(month, calendar.days), [month, calendar.days]);
  const todayStr = useMemo(() => dayjs().format("YYYY-MM-DD"), []);
  const [selectedDay, setSelectedDay] = useState<string | null>(todayStr);

  // 切换月份：今天在新月则选中今天，否则清空（避免跨月残留旧选中）。
  useEffect(() => {
    setSelectedDay(todayStr.startsWith(month) ? todayStr : null);
  }, [month, todayStr]);

  const selectedInfo = selectedDay
    ? (calendar.days.find((d) => d.date === selectedDay) ?? null)
    : null;

  return (
    <MobileCard title="工作日历" bodyClass="p-2">
      {/* 月份导航：‹ 上月 | YYYY年M月 | 下月 ›（触摸 ≥ 44px） */}
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          aria-label="上个月"
          onClick={() =>
            onMonthChange(dayjs(month).subtract(1, "month").format("YYYY-MM"))
          }
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <span className="text-[14px] font-medium">
          {dayjs(month).format("YYYY年M月")}
          {loading ? (
            <span className="ml-2 text-[11px] font-normal text-muted-foreground animate-pulse">
              加载中…
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="下个月"
          onClick={() =>
            onMonthChange(dayjs(month).add(1, "month").format("YYYY-MM"))
          }
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      {/* 星期表头 */}
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] text-muted-foreground">
        {WEEK_HEADERS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {/* 日期 grid：aspect-square 双圆点（左负载 / 右预警） */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (cell.type === "blank") {
            return <div key={`blank-${idx}`} className="aspect-square" />;
          }
          const date = `${month}-${String(cell.day).padStart(2, "0")}`;
          const selected = selectedDay === date;
          const isToday = date === todayStr;
          return (
            <button
              type="button"
              key={`day-${cell.day}`}
              onClick={() => setSelectedDay(date)}
              aria-label={date}
              className={cn(
                "flex aspect-square flex-col rounded-lg border p-1 transition-colors",
                selected
                  ? "border-primary bg-accent shadow-sm"
                  : "border-transparent bg-card hover:border-slate-200 hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "mx-auto flex size-5 items-center justify-center rounded-full text-[12px]",
                  isToday && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {cell.day}
              </span>
              <span className="mt-auto flex items-center justify-center gap-0.5">
                <span
                  className={cn("size-1.5 rounded-full", loadDotClass(cell.info?.load_level))}
                  aria-label={`负载:${cell.info?.load_level ?? "none"}`}
                />
                <span
                  className={cn("size-1.5 rounded-full", alertDotClass(cell.info?.alert_level))}
                  aria-label={`预警:${cell.info?.alert_level ?? "none"}`}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="mt-2 space-y-1 px-1 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-muted-foreground/70">左·负载:</span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" /> 饱和
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500" /> 有空余
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-red-500" /> 过载
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-muted-foreground/70">右·进度:</span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" /> 正常
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500" /> 临期
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-red-500" /> 延期
          </span>
        </div>
      </div>

      {/* 当日详情：计划 / 缺陷 / 实际执行三类（D-009 数据同源） */}
      {selectedDay && selectedInfo ? (
        <div className="mt-2 space-y-2 border-t border-border px-1 pt-2">
          <div className="text-[12px] font-medium text-muted-foreground">
            {selectedDay} 详情
          </div>
          <DayDetailSection
            title={`计划任务（${selectedInfo.plan_items.length}）`}
            empty="无"
            items={selectedInfo.plan_items.map((p) => ({
              id: p.id,
              tag: taskStatusTag(p.status ?? "").text,
              tagCls: statusPillCls(taskStatusTag(p.status ?? "").color),
              main: p.content ?? "—",
              sub: p.project_name ?? "",
            }))}
          />
          <DayDetailSection
            title={`缺陷任务（${selectedInfo.problem_items.length}）`}
            empty="无"
            items={selectedInfo.problem_items.map((p) => ({
              id: p.id,
              tag: p.status === "4" ? "已关闭" : "未关闭",
              tagCls:
                p.status === "4"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700",
              main: p.pro_desc ?? "—",
              sub: p.project_name ?? "",
            }))}
          />
          <DayDetailSection
            title={`实际执行（${selectedInfo.execute_items.length}）`}
            empty="无"
            items={selectedInfo.execute_items.map((e) => ({
              id: e.id,
              tag: e.status === "90" ? "已完成" : (e.status ?? "—"),
              tagCls:
                e.status === "90"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-blue-100 text-blue-700",
              main: e.content ?? "(无关联任务)",
              sub: e.time_spent != null ? `${e.time_spent}人天` : "",
            }))}
          />
        </div>
      ) : null}
    </MobileCard>
  );
}

/** 日历当日详情小节：状态徽标 + 主文案 + 副文案。 */
function DayDetailSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; tag: string; tagCls: string; main: string; sub: string }[];
}) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/70">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="text-[13px]">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium",
                    it.tagCls,
                  )}
                >
                  {it.tag}
                </span>
                <span className="min-w-0 flex-1 truncate" title={it.main}>
                  {it.main}
                </span>
              </div>
              {it.sub ? (
                <div className="mt-0.5 truncate pl-1 text-[11px] text-muted-foreground" title={it.sub}>
                  {it.sub}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** taskStatusTag.color → 移动徽标色 class（antd Tag color → tailwind，不复用桌面 Tag）。 */
function statusPillCls(color: string): string {
  switch (color) {
    case "processing":
      return "bg-blue-100 text-blue-700";
    case "success":
      return "bg-emerald-100 text-emerald-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

/* ============================== ④ 快捷入口 ============================== */

interface QuickEntry {
  label: string;
  icon: LucideIcon;
  tile: string;
  /** 跳转目标。 */
  href: string;
}

function QuickEntriesCard() {
  const entries: QuickEntry[] = [
    {
      label: "问题清单",
      icon: ListChecks,
      tile: "bg-red-50 text-red-600",
      href: "/ppm/problem-list",
    },
    {
      label: "任务计划",
      icon: ClipboardCheck,
      tile: "bg-blue-50 text-blue-600",
      href: "/ppm/task-plans",
    },
    {
      label: "项目计划",
      icon: ClipboardList,
      tile: "bg-violet-50 text-violet-600",
      href: "/ppm/project-plans",
    },
  ];

  const tileCls =
    "group flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/30 py-2 text-center transition hover:bg-muted/70";

  return (
    <MobileCard title="快捷入口">
      <div className="grid grid-cols-3 gap-2">
        {entries.map((e) => {
          const Icon = e.icon;
          return (
            <Link key={e.label} href={e.href} className={tileCls}>
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  e.tile,
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="text-[13px] text-foreground">{e.label}</span>
            </Link>
          );
        })}
      </div>
    </MobileCard>
  );
}
