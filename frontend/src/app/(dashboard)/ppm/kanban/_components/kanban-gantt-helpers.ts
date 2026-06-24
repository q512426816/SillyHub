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
export const DAY_WIDTH = 120;
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

  const clippedStart = dayStart.isBefore(rangeStart.startOf("day"));
  const clippedEnd = dayEnd.isAfter(rangeEnd.startOf("day"));
  const effStart = (clippedStart ? rangeStart : dayStart).startOf("day");
  const effEnd = (clippedEnd ? rangeEnd : dayEnd).startOf("day");

  const left = effStart.diff(rangeStart.startOf("day"), "day") * dayWidth;
  const width =
    (effEnd.diff(effStart, "day") + 1) * dayWidth - BAR_GAP;

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
  const sorted = [...items].sort((a, b) => {
    if (a.start.isBefore(b.start)) return -1;
    if (a.start.isAfter(b.start)) return 1;
    return 0;
  });
  const laneEnds: Dayjs[] = []; // laneEnds[i] = 第 i 行最后任务的 end
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
