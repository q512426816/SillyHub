/**
 * 跨天填报执行记录的「结束时间」挑选 (ql-20260730-001)。
 *
 * 背景:任务计划 / 问题清单的「跨天拆分填报」会把一段连续工作按天拆成多条
 * TaskExecute 记录。此前为绕过后端 D-004「执行起止不可跨天」校验,把每条
 * 记录的结束时间写成等于开始时间,导致执行记录显示「开始=结束」。
 *
 * 现按用户确认的规则挑选结束时间,既不跨天、又让开始≠结束:
 *  - 中间天(非最后一天) → 当天日末 23:59:59Z
 *  - 最后一天(=提交当天) → 提交时刻 now;兜底:若 now 早于当天 start
 *    (上午提交且 start 占位在 12:00),退回当天日末,避免 end<start 倒置。
 *
 * 拆分循环保证「最后一条即今天、中间天均在过去日期」,故 start/end 天然同日,
 * 不触发后端跨天校验。
 */
import dayjs from "dayjs";

/**
 * 为某一天的执行记录挑选 actual_end_time。
 *
 * @param date     该天日期 "YYYY-MM-DD"
 * @param isLast   是否最后一天(提交当天)
 * @param startIso 该天执行记录的开始时间 ISO(首条=in-flight 真实启动时刻;
 *                 后续天=当天 12:00 占位)
 * @param now      提交时刻(可注入便于单测;默认 dayjs() 当前时刻)
 * @returns 结束时间 ISO 字符串(UTC,带 Z)
 */
export function pickExecuteEndIso(
  date: string,
  isLast: boolean,
  startIso: string,
  now: dayjs.Dayjs = dayjs(),
): string {
  const dayEnd = `${date}T23:59:59Z`;
  if (!isLast) return dayEnd;
  // 最后一天 = 提交当天,优先用提交时刻;倒置兜底退回日末
  return now.isBefore(startIso) ? dayEnd : now.toISOString();
}
