/**
 * kanban-gantt-helpers — 甘特图条形定位 + 多行泳道算法(纯函数,可单测)。
 *
 * 依据 design.md §4.2/§4.3 + D-005/D-006。
 *  - computeBarLayout:把任务 [start, end] 映射到 [rangeStart, rangeEnd] 的像素
 *    {left, width, clippedStart, clippedEnd};单边缺失/无效 → null(归未排期)。
 *  - assignLanes:贪心多行泳道,按 start 排序分配首个 end≤start 的槽位。
 *  - 常量 LANE_HEIGHT/DATE_ROW_HEIGHT/DAY_WIDTH 统一驱动左右布局(D-006)。
 */
import dayjs, { type Dayjs } from "dayjs";

/** 唯一行高常量:驱动左侧行头与右侧条形,避免错位(D-006)。 */
export const LANE_HEIGHT = 36;
export const DATE_ROW_HEIGHT = 48;
export const DAY_WIDTH = 450;
export const ROW_HEAD_WIDTH = 220;
export const BAR_HEIGHT = 26;
export const BAR_TOP_PAD = 5;
export const BAR_GAP = 4;
/** 条形过窄时只显色点的阈值。 */
export const BAR_MIN_TEXT_WIDTH = 48;

export interface BarLayout {
  left: number;
  width: number;
  /** 条形左端被范围裁剪(任务早于 rangeStart)。 */
  clippedStart: boolean;
  /** 条形右端被范围裁剪(任务晚于 rangeEnd)。 */
  clippedEnd: boolean;
}

/**
 * 条形定位:start/end 任一缺失或无效 → null(归未排期区)。
 * start>end(异常数据)→ 按 end 单日兜底,不报错(design §4.4)。
 */
export function computeBarLayout(
  taskStart: string | null | undefined,
  taskEnd: string | null | undefined,
  rangeStart: Dayjs,
  rangeEnd: Dayjs,
  dayWidth: number = DAY_WIDTH,
): BarLayout | null {
  if (!taskStart || !taskEnd) return null;
  const start = dayjs(taskStart);
  const end = dayjs(taskEnd);
  if (!start.isValid() || !end.isValid()) return null;

  // start>end 异常:按 end 单日兜底
  const s = start.isAfter(end) ? end : start;
  const dayStart = s.startOf("day");
  const dayEnd = end.startOf("day");
  const rStart = rangeStart.startOf("day");
  const rEnd = rangeEnd.startOf("day");

  // 完全在范围外(本周之外)→ 不渲染:避免范围外任务被裁剪堆到首/末列
  if (dayEnd.isBefore(rStart) || dayStart.isAfter(rEnd)) return null;

  const clippedStart = dayStart.isBefore(rStart);
  const clippedEnd = dayEnd.isAfter(rEnd);
  const effStart = clippedStart ? rStart : dayStart;
  const effEnd = clippedEnd ? rEnd : dayEnd;

  const left = effStart.diff(rStart, "day") * dayWidth;
  const width = (effEnd.diff(effStart, "day") + 1) * dayWidth - BAR_GAP;

  return {
    left: Math.max(0, left),
    width: Math.max(dayWidth - BAR_GAP, width),
    clippedStart,
    clippedEnd,
  };
}

export interface LaneItem {
  id: string;
  start: Dayjs;
  end: Dayjs;
}

export interface LaneResult {
  /** taskId → 行槽 index。 */
  laneMap: Map<string, number>;
  /** 该组需要的行数(至少 1)。 */
  rowCount: number;
}

/**
 * 贪心多行泳道(design §4.3):按 start 升序,每个任务分配首个
 * 「该行最后任务 end ≤ 当前 start」的槽位,无则新增行。
 * 同人并行任务分到不同行,排期冲突一目了然。
 */
export function assignLanes(items: LaneItem[]): LaneResult {
  if (items.length === 0) return { laneMap: new Map(), rowCount: 1 };
  // 按日期粒度(整天)排序与比较:同日算重叠,避免 datetime 时分导致
  // 同日(A 上午结束+B 下午开始)被误判"不冲突"放同一行,而 computeBarLayout
  // 按整天画条形(同日都占满)造成同行重叠。
  const dayItems = items.map((it) => ({
    id: it.id,
    start: it.start.startOf("day"),
    end: it.end.startOf("day"),
  }));
  const sorted = [...dayItems].sort((a, b) => {
    if (a.start.isBefore(b.start)) return -1;
    if (a.start.isAfter(b.start)) return 1;
    return 0;
  });
  const laneEnds: Dayjs[] = []; // laneEnds[i] = 第 i 行最后任务的 end(整天)
  const laneMap = new Map<string, number>();
  for (const it of sorted) {
    let slot = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      // 不冲突:该行最后任务 end 严格早于当前 start(同日算重叠,因任务占整天)
      if (laneEnds[i]!.isBefore(it.start)) {
        slot = i;
        break;
      }
    }
    if (slot === -1) {
      slot = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[slot] = it.end;
    }
    laneMap.set(it.id, slot);
  }
  return { laneMap, rowCount: Math.max(laneEnds.length, 1) };
}

/** 今天 YYYY-MM-DD。 */
export function todayKey(): string {
  return dayjs().format("YYYY-MM-DD");
}

/** 范围内日期 keys(YYYY-MM-DD[],含首尾)。 */
export function rangeDateKeys(rangeStart: Dayjs, rangeEnd: Dayjs): string[] {
  const keys: string[] = [];
  let cur = rangeStart.startOf("day");
  const end = rangeEnd.startOf("day");
  while (cur.isBefore(end) || cur.isSame(end)) {
    keys.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return keys;
}

/** 周末判定(周六/周日)。 */
export function isWeekendKey(key: string): boolean {
  const d = dayjs(key);
  const dow = d.day(); // 周日=0, 周六=6
  return dow === 0 || dow === 6;
}

// 2026 年国务院节假日安排(国办发明电〔2025〕8 号,2025-11-04 公布)。
// 注:仅含 2026 数据(国务院每年公布,需按年维护);非 2026 日期回退到周末判定。
// 来源:国务院办公厅关于 2026 年部分节假日安排的通知(人民网/中国政府网)。
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

export interface DayStatus {
  /** 是否休息(法定假日或普通周末,非调休补班)。 */
  rest: boolean;
  /** 是否调休补班(周末调整为上班)。 */
  adjustedWork: boolean;
  /** 标签(节日名 / 休 / 班)。 */
  label?: string;
}

/**
 * 当日状态(法定假日休息 / 调休补班 / 周末 / 工作日)。
 * 仅 2026 数据精确;其他年份回退到周末判定(无节假日/调休)。
 */
export function getDayStatus(key: string): DayStatus {
  const holiday = HOLIDAYS_2026[key];
  if (holiday) return { rest: true, adjustedWork: false, label: holiday };
  if (ADJUSTED_WORKDAYS_2026.has(key))
    return { rest: false, adjustedWork: true, label: "班" };
  if (isWeekendKey(key)) return { rest: true, adjustedWork: false, label: "休" };
  return { rest: false, adjustedWork: false };
}
