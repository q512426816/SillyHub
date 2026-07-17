/**
 * PPM 日期/时间格式化工具。
 *
 * 后端日期字段多返回 ISO 字符串(如 ``2025-03-31T00:00:00Z``),直接渲染会显示
 * 原始 ISO,可读性差。统一在此格式化为中文可读格式。时区沿用 dayjs 本地
 * (配合 ``antd-providers`` 的 ``zh-cn`` locale;中国用户 UTC+8)。
 *
 * 注意:日期字段统一存取 ``YYYY-MM-DD`` 本地字符串,无时区错位。
 */
import dayjs from "dayjs";

/** 空值/非法值兜底。 */
const FALLBACK = "—";

/**
 * 格式化为日期 ``YYYY-MM-DD``;空或非法返回 ``fallback``(默认 ``—``)。
 *
 * 用于计划开始/结束等纯日期字段。
 */
export function fmtDate(
  v: string | number | Date | null | undefined,
  fallback: string = FALLBACK,
): string {
  if (v === null || v === undefined || v === "") return fallback;
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DD") : fallback;
}

/**
 * 格式化为日期时间 ``YYYY-MM-DD HH:mm``;空或非法返回 ``fallback``。
 *
 * 用于含时间的字段(如创建时间/处理时间)。
 */
export function fmtDateTime(
  v: string | number | Date | null | undefined,
  fallback: string = FALLBACK,
): string {
  if (v === null || v === undefined || v === "") return fallback;
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : fallback;
}

/**
 * 把预估工时字符串(work_load)换算成人天数,用于与"已消耗(人天)"对比。
 *
 * ``work_load`` 是自由字符串,约定(与后端 ``_parse_workload_hours`` 一致,
 * 1 人天 = 8 小时):
 * - 纯数字 / 带 ``d`` / ``天`` → 视为人天,原值返回;
 * - 带 ``h`` / ``小时`` → 视为小时,÷8 换算成人天;
 * - 空 / 非数字(如 "一" / "约3") → 返回 ``null``,调用方据此跳过对比。
 *
 * 列头"工作量(人/天)"与"已消耗(人天)"均按人天展示,故对比在同一量纲。
 */
export function parseWorkLoadPersonDays(workLoad: string | null | undefined): number | null {
  if (workLoad === null || workLoad === undefined) return null;
  const m = workLoad.trim().match(/^([\d.]+)\s*(h|d|小时|天)?$/i);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "h" || unit === "小时" ? val / 8 : val;
}

/**
 * 已消耗人天是否超过预估工时(超预算 → 列表标红用)。
 *
 * 任一值为空 / 无法解析 / 已消耗 ≤ 0 → 返回 ``false``(不高亮,避免误报)。
 */
export function isOverEstimate(
  spent: number | null | undefined,
  workLoad: string | null | undefined,
): boolean {
  if (spent === null || spent === undefined || spent <= 0) return false;
  const est = parseWorkLoadPersonDays(workLoad);
  if (est === null) return false;
  return spent > est;
}
