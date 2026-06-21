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
