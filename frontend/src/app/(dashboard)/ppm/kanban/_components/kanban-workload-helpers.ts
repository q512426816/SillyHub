/**
 * kanban 工时热力网格 helper — 锚点偏离式颜色映射 (task-07)。
 *
 * 设计依据:design.md §7.4 + prototype-kanban-workload-heatmap.html(同一套函数逻辑)。
 *
 * 配色规则(基准 1 人天 = 8h,先 round(hours,1) 防浮点闪烁 R-07):
 * - h <= 0   → 绿(最闲)
 * - h === 1  → 无色/达标(transparent)
 * - 0 < h < 1 → 绿(140°)→黄(45°) HSL 插值,t = h(越接近 0 越绿,越接近 1 越黄)
 * - h > 1    → 浅红(0°,72%)→黑(0°,8%),t = min((h-1)/2, 1),≥3 人天趋黑;深底白字
 * - 休息态(周末/法定假日)→ 灰底不染色;调休补班按正常工作日染色
 *
 * 工作日状态复用 `@/lib/ppm/workday` 的 getDayStatus(单一数据源,后端不重复维护)。
 */
import { getDayStatus } from "@/lib/ppm/workday";

export interface WorkloadCellColor {
  /** 背景色(CSS 颜色值;达标为 transparent,休息态为灰)。 */
  bg: string;
  /** 前景(文字)色。 */
  fg: string;
}

/** 休息态(周末/法定假日)灰底,不染色。 */
export const REST_CELL_COLOR: WorkloadCellColor = {
  bg: "#f3f4f6",
  fg: "#d1d5db",
};

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${s}%, ${Math.round(l)}%)`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 工时(人天)→ 单元格颜色(锚点偏离式)。
 *
 * 仅做颜色判断,工作日/休息态由调用方用 `workloadCellColorForDay` 或自行
 * 判断 getDayStatus 后覆盖为 REST_CELL_COLOR。
 */
export function workloadCellColor(hours: number): WorkloadCellColor {
  // round 到 1 位小数:0.95→1.0 达标无色,防浮点闪烁 (R-07)
  const h = Math.round(hours * 10) / 10;
  if (h <= 0) return { bg: hsl(140, 60, 82), fg: "#14532d" }; // 0 = 绿(最闲)
  if (h === 1.0) return { bg: "transparent", fg: "#374151" }; // 达标 = 无色
  if (h < 1.0) {
    // 不足: 绿140° → 黄45°
    const hue = lerp(140, 45, h);
    return { bg: hsl(hue, 65, 80), fg: "#3f3f06" };
  }
  // 超出: 浅红(0°,72%) → 黑(0°,8%),1→3 人天映射 0..1
  const t = Math.min((h - 1.0) / 2.0, 1.0);
  const light = lerp(72, 8, t);
  const fg = t > 0.55 ? "#f9fafb" : "#7f1d1d";
  return { bg: hsl(0, 70, light), fg };
}

/**
 * 带工作日判断的单元格颜色:休息态(周末/法定假日)灰底不染色,
 * 调休补班(getDayStatus.adjustedWork)按正常工作日染色。
 *
 * @param dateKey YYYY-MM-DD
 * @param hours 当日工时(人天)
 */
export function workloadCellColorForDay(
  dateKey: string,
  hours: number,
): WorkloadCellColor {
  if (getDayStatus(dateKey).rest) return REST_CELL_COLOR;
  return workloadCellColor(hours);
}
