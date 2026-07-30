/**
 * 跨天填报执行记录的时间构造 (ql-20260730-001)。
 *
 * 关键:前端按「本地时区」把一段工作按天拆分,得到本地日期 ``date`` (YYYY-MM-DD)。
 * 不能直接拼 ``${date}T..Z`` —— 那会被当成 UTC,在 +8 时区显示偏移(如 23:59:59Z →
 * 次日 07:59:59、12:00:00Z → 当天 20:00)。这里统一用 dayjs 把「本地日期 + 本地时刻」
 * 解析成 local datetime 再转 UTC ISO,保证前端 ``dayjs(iso).format`` 回显停在当天原时刻。
 *
 * 结束时间规则(用户确认 ql-20260730-001):
 *  - 中间天(非最后一天) → 本地当天 23:59:59
 *  - 最后一天(=提交当天) → 提交时刻 now(用户明确按提交时间,不做倒置兜底)
 *
 * 拆分循环保证末条即今天、中间天均在过去日期 → start/end 同日,不触发后端
 * D-004「执行起止不可跨天」校验。
 */
import dayjs from "dayjs";

/**
 * 本地日期 + ``HH:mm:ss`` → UTC ISO。
 *
 * 用 dayjs 解析 ``${date} ${time}`` 为本地时刻,``toISOString`` 转 UTC。
 * 前端再 ``dayjs(iso)``(本地)格式化即回到当天原时刻,不跨日、不偏移。
 */
export function localDayTimeToIso(date: string, time: string): string {
  return dayjs(`${date} ${time}`).toISOString();
}

/**
 * 跨天填报某天的 actual_end_time。
 *
 * @param date   该天本地日期 "YYYY-MM-DD"
 * @param isLast 是否最后一天(提交当天)
 * @param now    提交时刻(可注入便于单测;默认 dayjs() 当前时刻)
 * @returns 结束时间 ISO 字符串(UTC,带 Z)
 */
export function pickExecuteEndIso(
  date: string,
  isLast: boolean,
  now: dayjs.Dayjs = dayjs(),
): string {
  // 中间天 → 本地当天 23:59:59;最后一天 → 提交时刻(不兜底,用户明确按提交时间)
  return isLast ? now.toISOString() : localDayTimeToIso(date, "23:59:59");
}
