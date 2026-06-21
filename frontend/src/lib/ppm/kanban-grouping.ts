/**
 * 看板列内任务按日期(截止/deadline)分组 —— 两重维度之日期维度(列内二级分组)。
 *
 * 源项目 task-kanban 的 KanbanColumn 内卡片是按拖拽顺序平铺,没有按日期分组;
 * 用户要求"人员+日期两重维度查看",这里在源人员列布局之上增强:每列内按
 * 截止日期分桶渲染(逾期/今天/明天/本周/下周/未来/无截止),逾期桶置顶并标红。
 *
 * 分组仅影响展示;拖拽落点语义不变(落点落在某卡之前/列尾,由 page 统一处理)。
 */
import type { KanbanTaskCard } from "./types";

export type TaskDateBucketKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "future"
  | "noDeadline";

export interface TaskDateBucket {
  key: TaskDateBucketKey;
  label: string;
  /** 标题色 (tailwind class,用于左侧色条 + 文字) */
  colorClass: string;
  tasks: KanbanTaskCard[];
}

const BUCKET_META: Record<
  TaskDateBucketKey,
  { label: string; colorClass: string }
> = {
  overdue: { label: "逾期", colorClass: "text-destructive" },
  today: { label: "今天", colorClass: "text-red-500" },
  tomorrow: { label: "明天", colorClass: "text-orange-500" },
  thisWeek: { label: "本周", colorClass: "text-blue-500" },
  nextWeek: { label: "下周", colorClass: "text-cyan-600" },
  future: { label: "未来", colorClass: "text-muted-foreground" },
  noDeadline: { label: "无截止", colorClass: "text-muted-foreground" },
};

/** 顺序决定列内自上而下的展示顺序。 */
const BUCKET_ORDER: TaskDateBucketKey[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "future",
  "noDeadline",
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 取以周一为起点的本周范围 [weekStart, weekEnd]。 */
function weekRange(d: Date): [Date, Date] {
  const s = startOfDay(d);
  const day = (s.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const weekStart = new Date(s);
  weekStart.setDate(s.getDate() - day);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return [weekStart, weekEnd];
}

function classifyDeadline(deadline: string | null, today: Date): TaskDateBucketKey {
  if (!deadline) return "noDeadline";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return "noDeadline";
  const dl = startOfDay(d);
  const t = startOfDay(today);
  const diffDays = Math.round((dl.getTime() - t.getTime()) / 86_400_000);

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";

  const [ws, we] = weekRange(today);
  const [nws, nwe] = (() => {
    const a = new Date(ws);
    a.setDate(ws.getDate() + 7);
    const b = new Date(we);
    b.setDate(we.getDate() + 7);
    return [a, b];
  })();

  if (dl >= ws && dl <= we) return "thisWeek";
  if (dl >= nws && dl <= nwe) return "nextWeek";
  return "future";
}

// ===========================================================================
// 矩阵专用:人员 × 自然日 二维分组
// ===========================================================================

/** 自然日(YYYY-MM-DD,本地时区)。 */
export type DateKey = string;

/** 矩阵单元格:某人员 × 某日期下的任务列表。 */
export interface MatrixCell {
  user_id: string;
  date: DateKey;
  tasks: KanbanTaskCard[];
}

/** 取任务的"归属日期"(YYYY-MM-DD)。优先 deadline/end_time;无则 null。 */
export function taskDateKey(task: KanbanTaskCard): DateKey | null {
  // KanbanTaskCard.deadline ← PlanTask.end_time;无独立 end_time 字段
  const raw = task.deadline;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 生成 [start, end] 闭区间的连续自然日列表(YYYY-MM-DD)。 */
export function dateRangeKeys(start: Date, end: Date): DateKey[] {
  const out: DateKey[] = [];
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  if (e < s) return out;
  const cur = new Date(s);
  while (cur <= e) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** 周几(中文) + 是否周末。基于本地时区。 */
export function weekdayMeta(dateKey: DateKey): {
  label: string;
  isWeekend: boolean;
} {
  const d = new Date(dateKey);
  // 周日 getDay()=0,周六=6
  const day = d.getDay();
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  return { label: `周${labels[day] ?? "?"}`, isWeekend: day === 0 || day === 6 };
}

/**
 * 把全员任务按 (user_id × date) 分组成二维矩阵。
 * - user_ids 决定行顺序;行内每个 date 一个 cell(空 cell 也返回,长度=dates.length)
 * - 没有 deadline / 不在 dates 范围内的任务 → 不进矩阵(由 SearchBar 日期筛选保证)
 * - cell.tasks 按 kanban_order 升序
 */
export function groupByUserAndDate(
  tasks: KanbanTaskCard[],
  user_ids: string[],
  dates: DateKey[],
): Map<string, Map<DateKey, KanbanTaskCard[]>> {
  const matrix = new Map<string, Map<DateKey, KanbanTaskCard[]>>();
  for (const uid of user_ids) {
    const row = new Map<DateKey, KanbanTaskCard[]>();
    for (const dk of dates) row.set(dk, []);
    matrix.set(uid, row);
  }
  for (const t of tasks) {
    const uid = t.user_id;
    if (!uid) continue;
    const dk = taskDateKey(t);
    if (!dk) continue;
    const row = matrix.get(uid);
    if (!row) continue;
    const cell = row.get(dk);
    if (!cell) continue; // 不在选中日期范围
    cell.push(t);
  }
  for (const row of matrix.values()) {
    for (const arr of row.values()) {
      arr.sort((a, b) => a.kanban_order - b.kanban_order);
    }
  }
  return matrix;
}

/**
 * 把一列任务按截止日期分桶。桶内保持传入顺序(由调用方按 kanban_order 排好)。
 * 空桶不返回。
 */
export function groupTasksByDate(
  tasks: KanbanTaskCard[],
  now: Date = new Date(),
): TaskDateBucket[] {
  const buckets = new Map<TaskDateBucketKey, KanbanTaskCard[]>();
  for (const key of BUCKET_ORDER) buckets.set(key, []);
  for (const t of tasks) {
    const key = classifyDeadline(t.deadline, now);
    buckets.get(key)!.push(t);
  }
  const out: TaskDateBucket[] = [];
  for (const key of BUCKET_ORDER) {
    const arr = buckets.get(key)!;
    if (arr.length > 0) {
      out.push({
        key,
        label: BUCKET_META[key].label,
        colorClass: BUCKET_META[key].colorClass,
        tasks: arr,
      });
    }
  }
  return out;
}
