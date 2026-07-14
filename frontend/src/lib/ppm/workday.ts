/**
 * PPM 工作日联动 helper — addWorkingDays。
 *
 * 对照源 `dept_project_front/src/utils/formatTime.ts` 的 `addWorkingDays`:
 * 从开始时间起算,加 N 个工作日(默认跳过周六周日),返回目标完成时间。
 * 支持整数天 + 小数天(小数部分按小时顺延,跨日继续跳周末)。
 *
 * 本任务范围(task-07):提供纯函数 + 单元测试,供 task-05 milestone 表单
 * (plan_begin_time + plan_workload → plan_complete_time)和 problem 表单
 * (plan_start_time + work_load → plan_end_time)调用。表单集成留给各自任务。
 *
 * 设计依据:tasks/task-07.md「工作日联动 helper」+ 源 addWorkingDays 实现。
 */

/** Date 构造可接受类型(毫秒数 / ISO 字符串 / Date 实例)。 */
export type WorkdayStart = number | string | Date;

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  // 0 = 周日, 6 = 周六
  return day === 0 || day === 6;
}

// ── 2026 节假日 / 调休(国务院办公厅 2026 年部分节假日安排,国办发明电〔2025〕8 号) ─
// 工作日判定的依据,kanban 甘特复用(re-export 自本模块)以保持单一数据源。
// 仅含 2026(国务院每年公布,需按年维护);非 2026 日期回退到周末判定。
/** 法定假日(放假休息):key=YYYY-MM-DD,value=节日名。 */
const HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "元旦", "2026-01-02": "元旦", "2026-01-03": "元旦",
  "2026-02-15": "春节", "2026-02-16": "春节", "2026-02-17": "春节", "2026-02-18": "春节",
  "2026-02-19": "春节", "2026-02-20": "春节", "2026-02-21": "春节", "2026-02-22": "春节", "2026-02-23": "春节",
  "2026-04-04": "清明", "2026-04-05": "清明", "2026-04-06": "清明",
  "2026-05-01": "劳动节", "2026-05-02": "劳动节", "2026-05-03": "劳动节", "2026-05-04": "劳动节", "2026-05-05": "劳动节",
  "2026-06-19": "端午", "2026-06-20": "端午", "2026-06-21": "端午",
  "2026-09-25": "中秋", "2026-09-26": "中秋", "2026-09-27": "中秋",
  "2026-10-01": "国庆", "2026-10-02": "国庆", "2026-10-03": "国庆", "2026-10-04": "国庆",
  "2026-10-05": "国庆", "2026-10-06": "国庆", "2026-10-07": "国庆",
};
/** 调休补班(周末调整为工作日)。 */
const ADJUSTED_WORKDAYS_2026 = new Set([
  "2026-01-04", // 元旦
  "2026-02-14", "2026-02-28", // 春节
  "2026-05-09", // 劳动节
  "2026-09-20", "2026-10-10", // 国庆
]);

/** Date → YYYY-MM-DD(本地时区)。 */
function dateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD 是否周末(原生 Date,无 dayjs 依赖)。 */
function weekendByKey(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  return isWeekend(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

export interface DayStatus {
  /** 是否休息(法定假日或普通周末,非调休补班)。 */
  rest: boolean;
  /** 是否调休补班(周末调整为上班)。 */
  adjustedWork: boolean;
  /** 标签(节日名 / 休 / 班)。 */
  label?: string;
}

/**
 * 当日状态(法定假日 / 调休补班 / 周末 / 工作日),key=YYYY-MM-DD。
 * 仅 2026 精确;其他年份回退到周末判定。kanban 甘特复用(re-export)。
 */
export function getDayStatus(key: string): DayStatus {
  const holiday = HOLIDAYS_2026[key];
  if (holiday) return { rest: true, adjustedWork: false, label: holiday };
  if (ADJUSTED_WORKDAYS_2026.has(key))
    return { rest: false, adjustedWork: true, label: "班" };
  if (weekendByKey(key)) return { rest: true, adjustedWork: false, label: "休" };
  return { rest: false, adjustedWork: false };
}

/**
 * 是否休息日(法定假日或普通周末;调休补班视为工作日)。
 * addWorkingDays 据此跳过休息日。仅 2026 精确,其他年份仅周末。
 */
export function isRestDay(date: Date): boolean {
  const key = dateToKey(date);
  if (HOLIDAYS_2026[key]) return true;
  if (ADJUSTED_WORKDAYS_2026.has(key)) return false;
  return isWeekend(date);
}

/**
 * 工作日跨度计算:工作量 N(工作日)对应的完成时间,返回毫秒时间戳。
 *
 * 语义:**起点算第 1 个工作日**,完成日 = 第 N 个工作日。
 * 即 N=1 → 当天;N=2 → 起点 +1 个工作日。
 * (用户口径:工作量 2 天、开始 7/1 → 完成 7/2。)
 *
 * 跳过休息日(周末 + 法定假日;调休补班视为工作日),仅 2026 节假日精确,
 * 其他年份仅跳周末。起点是休息日时顺延到下一个工作日作为第 1 天。
 *
 * @param start 开始时间(毫秒数 / ISO 字符串 / Date)
 * @param days 工作量(工作日数,取整数部分)
 * @param ignoreWeekend 是否跳过休息日(周末+法定假日),默认 true
 */
export function addWorkingDaysMs(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): number {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  const date = new Date(start);

  // 起点是休息日 → 顺延到下一个工作日(作为第 1 个工作日)
  while (ignoreWeekend && isRestDay(date)) {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
  }

  // 第 N 个工作日 = 起点之后再推进 (N-1) 个工作日
  for (let i = 0; i < n - 1; i++) {
    do {
      date.setDate(date.getDate() + 1);
    } while (ignoreWeekend && isRestDay(date));
  }

  return date.getTime();
}

/**
 * 加 N 个工作日,返回 YYYY-MM-DD 字符串(只取日期部分)。
 * 表单里 `plan_complete_time` / `plan_end_time` 多以日期粒度展示时使用。
 *
 * @param start 开始时间
 * @param days 工作日跨度
 * @param ignoreWeekend 是否跳过周六周日,默认 true
 */
export function addWorkingDaysDate(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): string {
  const ms = addWorkingDaysMs(start, days, ignoreWeekend);
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 加 N 个工作日,返回完整 ISO 字符串(YYYY-MM-DD HH:mm:ss)。
 * 表单字段需要带时间时使用。
 */
export function addWorkingDaysISO(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): string {
  const ms = addWorkingDaysMs(start, days, ignoreWeekend);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
